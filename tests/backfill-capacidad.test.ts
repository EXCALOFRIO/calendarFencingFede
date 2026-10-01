import { describe, expect, it } from 'vitest';
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
import { medirOcupacion, type ConsultaSql } from '@/lib/ingest/backfill/capacidad-db';

describe('umbral de capacidad (VAL-CAPACITY-002)', () => {
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

describe('medición real de ocupación con una consulta SELECT de sólo lectura (VAL-CAPACITY-001)', () => {
  it('lee tamaños de tabla e índices y cuenta hechos sin leer filas ni PDF; sólo emite SELECT', async () => {
    const consultas: string[] = [];
    const consultar: ConsultaSql = async (texto) => {
      consultas.push(texto);
      if (/pg_total_relation_size/.test(texto)) {
        return [
          { tabla: 'sport_result', tabla_bytes: '8192', indices_bytes: '16384', total_bytes: '24576', filas: '3' },
          { tabla: 'sport_bout', tabla_bytes: '8192', indices_bytes: '8192', total_bytes: '16384', filas: '2' },
          { tabla: 'event', tabla_bytes: '100000', indices_bytes: '50000', total_bytes: '150000', filas: '400' },
        ];
      }
      if (/pg_database_size/.test(texto)) return [{ bytes: '2000000' }];
      if (/"sport_result"/.test(texto)) return [{ n: 3 }];
      if (/"sport_bout"/.test(texto)) return [{ n: 2 }];
      return [{ n: 0 }];
    };
    const o = await medirOcupacion(consultar, () => new Date('2026-10-01T10:00:00Z'));
    expect(o.logicoBytes).toBe(24576 + 16384 + 150000);
    expect(o.baseDatosBytes).toBe(2_000_000);
    expect(o.tablas.find((t) => t.tabla === 'sport_result')).toEqual({
      tabla: 'sport_result',
      tablaBytes: 8192,
      indicesBytes: 16384,
      totalBytes: 24576,
      filas: 3,
    });
    expect(o.conteos).toMatchObject({ puestos: 3, asaltos: 2 });
    expect(o.medidoEn).toBe('2026-10-01T10:00:00.000Z');
    expect(consultas.length).toBeGreaterThan(0);
    for (const c of consultas) expect(c.trim().toLowerCase()).toMatch(/^(select|with)\b/);
    for (const c of consultas) expect(c).not.toMatch(/\b(insert|update|delete|drop|alter|truncate)\b/i);
  });

  it('una tabla deportiva que aún no existe (0017 sin aplicar) cuenta cero y no rompe la medición', async () => {
    const consultar: ConsultaSql = async (texto) => {
      if (/pg_total_relation_size/.test(texto)) {
        return [{ tabla: 'event', tabla_bytes: '100', indices_bytes: '50', total_bytes: '150', filas: '4' }];
      }
      if (/pg_database_size/.test(texto)) return [{ bytes: '1000' }];
      throw new Error('relation does not exist');
    };
    const o = await medirOcupacion(consultar);
    expect(o.logicoBytes).toBe(150);
    expect(o.conteos).toEqual({ personas: 0, pruebas: 0, puestos: 0, asaltos: 0, documentos: 0, coberturas: 0 });
  });
});
