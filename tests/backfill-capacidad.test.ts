import { afterEach, describe, expect, it, vi } from 'vitest';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import {
  BASE_LOGICA_OBSERVADA_BYTES,
  evaluarCapacidad,
  GIB,
  MIB,
  proyectarCrecimiento,
  TASAS_CONSERVADORAS,
  tasasDesdeMedicion,
  umbralDePlan,
  diferenciaOcupacion,
  type Ocupacion,
} from '@/lib/ingest/backfill/capacidad';
import { consultaSqlDb, medirOcupacion, type ConsultaSql } from '@/lib/ingest/backfill/capacidad-db';

describe('planificador histórico puro de Neon, sin conexión ni política D1 (VAL-CAPACITY-002)', () => {
  it('con plan desconocido usa 0,4 GiB y lo declara no confirmado', () => {
    const u = umbralDePlan({ tipo: 'desconocido' });
    expect(u.umbralBytes).toBe(Math.round(0.4 * GIB));
    expect(u.confirmado).toBe(false);
    expect(u.descripcion).toMatch(/no verificad/i);
  });

  it('con Neon Free se detiene en 0,4 GiB aunque la cuota publicada sea 0,5 GiB', () => {
    const u = umbralDePlan({ tipo: 'free' });
    expect(u.umbralBytes).toBe(Math.round(0.4 * GIB));
    expect(u.confirmado).toBe(true);
  });

  it('con otro plan confirmado usa su umbral verificado', () => {
    const u = umbralDePlan({ tipo: 'otro', umbralVerificadoBytes: 8 * GIB, verificadoEn: '2026-10-01' });
    expect(u.umbralBytes).toBe(8 * GIB);
    expect(u.confirmado).toBe(true);
  });

  it('un umbral verificado no válido no relaja el límite: vuelve al conservador', () => {
    expect(umbralDePlan({ tipo: 'otro', umbralVerificadoBytes: 0, verificadoEn: 'x' }).umbralBytes).toBe(
      Math.round(0.4 * GIB),
    );
    expect(umbralDePlan({ tipo: 'otro', umbralVerificadoBytes: Number.NaN, verificadoEn: 'x' }).confirmado).toBe(false);
  });
});

describe('parada preventiva antes del umbral', () => {
  const plan = { tipo: 'desconocido' } as const;
  const umbral = Math.round(0.4 * GIB);

  it('permite el lote cuando actual + proyectado queda justo por debajo del umbral', () => {
    const d = evaluarCapacidad({ actualBytes: umbral - 1000, proyectadoBytes: 999, plan });
    expect(d.continuar).toBe(true);
    expect(d.motivo).toBe('ok');
    expect(d.restanteBytes).toBe(1);
  });

  it('para cuando el lote proyectado alcanza o rebasa el umbral', () => {
    expect(evaluarCapacidad({ actualBytes: umbral - 1000, proyectadoBytes: 1000, plan })).toMatchObject({
      continuar: false,
      motivo: 'lote_rebasa_umbral',
    });
    expect(evaluarCapacidad({ actualBytes: umbral - 1000, proyectadoBytes: 1001, plan }).continuar).toBe(false);
  });

  it('para si ya se está en o por encima del umbral, aunque el lote proyectado sea cero', () => {
    expect(evaluarCapacidad({ actualBytes: umbral, proyectadoBytes: 0, plan })).toMatchObject({
      continuar: false,
      motivo: 'umbral_alcanzado',
    });
    expect(evaluarCapacidad({ actualBytes: umbral + 1, proyectadoBytes: 0, plan }).continuar).toBe(false);
  });

  it('sin medición no se puede verificar el margen: no continúa', () => {
    expect(evaluarCapacidad({ actualBytes: null, proyectadoBytes: 10, plan })).toMatchObject({
      continuar: false,
      motivo: 'sin_medicion',
    });
  });

  it('la línea base observada (27,71 MiB) deja mucho margen bajo el umbral conservador', () => {
    expect(BASE_LOGICA_OBSERVADA_BYTES).toBeCloseTo(27.71 * MIB, -3);
    const d = evaluarCapacidad({ actualBytes: BASE_LOGICA_OBSERVADA_BYTES, proyectadoBytes: 5 * MIB, plan });
    expect(d.continuar).toBe(true);
  });

  it('el mensaje para el usuario da tamaño, plan no confirmado y alternativas sin ejecutar ninguna', () => {
    const d = evaluarCapacidad({
      actualBytes: umbral - 10,
      proyectadoBytes: 100,
      plan,
      pendientes: { unidades: 120, temporadas: ['2017-2018', '2018-2019'] },
    });
    expect(d.continuar).toBe(false);
    expect(d.mensaje).toContain('0.40 GiB');
    expect(d.mensaje).toMatch(/plan.*no (está )?(confirmado|verificado)/i);
    expect(d.mensaje).toMatch(/120 unidades/);
    expect(d.mensaje).toContain('2017-2018');
    expect(d.mensaje).toMatch(/no se ha (contratado|migrado)/i);
    expect(d.mensaje).toMatch(/D1|R2/);
  });
});

describe('proyección y medición antes/después', () => {
  it('proyecta con tasas conservadoras por puesto, asalto, documento y unidad', () => {
    const t = TASAS_CONSERVADORAS;
    expect(proyectarCrecimiento(t, { puestos: 10, asaltos: 20, documentos: 1, unidades: 2 })).toBe(
      10 * t.bytesPorPuesto + 20 * t.bytesPorAsalto + t.bytesPorDocumento + 2 * t.bytesPorUnidad,
    );
    expect(t.origen).toBe('supuesto');
  });

  const ocupacion = (extra: Partial<Ocupacion> = {}): Ocupacion => ({
    medidoEn: '2026-10-01T00:00:00Z',
    logicoBytes: 30 * MIB,
    baseDatosBytes: 31 * MIB,
    tablas: [
      { tabla: 'sport_result', tablaBytes: 1000, indicesBytes: 500, totalBytes: 1500, filas: 10 },
      { tabla: 'sport_bout', tablaBytes: 2000, indicesBytes: 1000, totalBytes: 3000, filas: 20 },
    ],
    conteos: { personas: 5, pruebas: 2, puestos: 10, asaltos: 20, documentos: 1, coberturas: 3 },
    ...extra,
  });

  it('la diferencia reparte el crecimiento por tabla, índice y conteo, con unidades en bytes', () => {
    const antes = ocupacion();
    const despues = ocupacion({
      logicoBytes: 30 * MIB + 5500,
      tablas: [
        { tabla: 'sport_result', tablaBytes: 1800, indicesBytes: 900, totalBytes: 2700, filas: 20 },
        { tabla: 'sport_bout', tablaBytes: 3000, indicesBytes: 1800, totalBytes: 4800, filas: 40 },
        { tabla: 'sport_import_coverage', tablaBytes: 400, indicesBytes: 100, totalBytes: 500, filas: 4 },
      ],
      conteos: { personas: 9, pruebas: 3, puestos: 20, asaltos: 40, documentos: 2, coberturas: 7 },
    });
    const d = diferenciaOcupacion(antes, despues);
    expect(d.logicoDeltaBytes).toBe(5500);
    expect(d.porTabla.find((t) => t.tabla === 'sport_result')).toMatchObject({
      tablaDelta: 800,
      indicesDelta: 400,
      totalDelta: 1200,
      filasDelta: 10,
    });
    expect(d.porTabla.find((t) => t.tabla === 'sport_import_coverage')).toMatchObject({ totalDelta: 500, filasDelta: 4 });
    expect(d.conteosDelta).toEqual({ personas: 4, pruebas: 1, puestos: 10, asaltos: 20, documentos: 1, coberturas: 4 });
  });

  it('las tasas medidas sólo sustituyen a las supuestas con crecimiento suficiente', () => {
    const antes = ocupacion();
    const pequeno = tasasDesdeMedicion(antes, antes);
    expect(pequeno.origen).toBe('supuesto');

    const despues = ocupacion({
      tablas: [
        { tabla: 'sport_result', tablaBytes: 1000 + 100_000, indicesBytes: 500 + 50_000, totalBytes: 1500 + 150_000, filas: 10 + 500 },
        { tabla: 'sport_bout', tablaBytes: 2000, indicesBytes: 1000, totalBytes: 3000, filas: 20 },
      ],
    });
    const t = tasasDesdeMedicion(antes, despues);
    expect(t.origen).toBe('medido');
    expect(t.bytesPorPuesto).toBe(300);
    expect(t.bytesPorAsalto).toBe(TASAS_CONSERVADORAS.bytesPorAsalto);
  });
});

describe('medición D1 por metadata y conteos de sólo lectura (VAL-CAPACITY-001)', () => {
  const abiertos: ReturnType<typeof localD1>[] = [];
  function database() {
    const local = localD1();
    abiertos.push(local);
    return { ...local, db: createD1Database(local.binding) };
  }
  afterEach(() => abiertos.splice(0).forEach((local) => local.close()));

  it('usa el tamaño total reportado sin inventar tamaños por tabla ni leer los cuerpos de los hechos', async () => {
    const local = database();
    local.sqlite.exec(`
      INSERT INTO sport_person(id,display_name,name_normalized) VALUES ('persona','Sintética','sintetica');
      INSERT INTO sport_edition(id,source,season,tournament_key,name) VALUES ('edicion','fie','2026','1','Sintética');
      INSERT INTO sport_competition(id,edition_id,source,season,competition_key,weapon,gender,category,format)
        VALUES ('prueba','edicion','fie','2026','1','ESPADA','M','ABS','INDIVIDUAL');
      INSERT INTO sport_import_coverage(source,season,fact_kind,competition_key,status)
        VALUES ('rfee','2026','pdf','documento','completo');
    `);
    for (let n = 0; n < 3; n++) {
      local.sqlite.prepare(`INSERT INTO sport_result(competition_id,source,source_fact_key,source_name,content_hash)
        VALUES ('prueba','fie',?,'Sintética','hash')`).run(String(n));
    }
    for (let n = 0; n < 2; n++) {
      local.sqlite.prepare(`INSERT INTO sport_bout(competition_id,source,phase,round_key,fencer_a_ref,fencer_b_ref,
        fencer_a_name,fencer_b_name,score_a,score_b,content_hash)
        VALUES ('prueba','fie','TABLEAU',?,'a','b','Sintética A','Sintética B',11,15,'hash')`).run(String(n));
    }
    const bytes = await local.db.storageSize();
    local.calls.length = 0;
    const o = await medirOcupacion(consultaSqlDb(local.db), () => new Date('2026-10-01T10:00:00Z'));
    expect(o.logicoBytes).toBe(bytes);
    expect(o.baseDatosBytes).toBe(bytes);
    expect(o.tablas).toEqual([
      { tabla: 'd1_reported_storage', tablaBytes: bytes, indicesBytes: 0, totalBytes: bytes, filas: 0 },
    ]);
    expect(o.conteos).toEqual({ personas: 1, pruebas: 1, puestos: 3, asaltos: 2, documentos: 1, coberturas: 1 });
    expect(o.medidoEn).toBe('2026-10-01T10:00:00.000Z');
    expect(local.calls).toHaveLength(8);
    for (const { sql } of local.calls) {
      expect(sql.trim()).toMatch(/^select\b/i);
      expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter|truncate|pragma)\b|pg_/i);
    }
    expect(local.calls.slice(2).every(({ sql }) => /^select count\(\*\) as n /i.test(sql))).toBe(true);
  });

  it('una tabla deportiva ausente bloquea la medición en vez de inventar un conteo cero', async () => {
    const local = database();
    local.sqlite.exec('DROP TABLE sport_result');
    await expect(medirOcupacion(consultaSqlDb(local.db))).rejects.toThrow('sport_capacity_schema_missing');
  });

  it.each([undefined, 0, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'falla antes de consultar hechos si no hay un tamaño válido (%s)', async (bytes) => {
      const consultar = Object.assign(vi.fn<ConsultaSql>().mockResolvedValue([]),
        bytes === undefined ? {} : { storageSize: async () => bytes });
      await expect(medirOcupacion(consultar)).rejects.toThrow('sport_capacity_measurement_unknown');
      expect(consultar).not.toHaveBeenCalled();
    });

  it('sanitiza un fallo de metadata sin divulgar su excepción', async () => {
    const consultar = Object.assign(vi.fn<ConsultaSql>().mockResolvedValue([]), {
      storageSize: async () => { throw new Error('DETALLE_PRIVADO_SINTETICO'); },
    });
    await expect(medirOcupacion(consultar)).rejects.toThrow(/^sport_capacity_measurement_unknown$/);
    expect(consultar).not.toHaveBeenCalled();
  });
});
