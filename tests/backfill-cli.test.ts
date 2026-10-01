import { describe, expect, it, vi } from 'vitest';
import type { Ocupacion } from '@/lib/ingest/backfill/capacidad';
import { MIB } from '@/lib/ingest/backfill/capacidad';
import {
  ejecutarBackfillCli,
  parsearArgsBackfill,
  TOPE_TAREAS,
  type DepsBackfillCli,
  type OpcionesCli,
} from '@/lib/ingest/backfill/cli';
import type { FilaPlan } from '@/lib/ingest/backfill/plan';

const ocupacion = (mib: number): Ocupacion => ({
  medidoEn: '2026-12-01T00:00:00.000Z',
  logicoBytes: Math.round(mib * MIB),
  baseDatosBytes: null,
  tablas: [{ tabla: 'sport_result', tablaBytes: Math.round(mib * MIB), indicesBytes: 0, totalBytes: Math.round(mib * MIB), filas: 10 }],
  conteos: { personas: 0, pruebas: 0, puestos: 10, asaltos: 0, documentos: 0, coberturas: 1 },
});

const fila = (extra: Partial<FilaPlan> = {}): FilaPlan => ({
  source: 'fie',
  season: '2027',
  factKind: 'ranking',
  competitionKey: '99',
  status: 'error',
  publishedTotal: 100,
  importedTotal: 20,
  attempts: 1,
  cursor: null,
  lastCheckedAt: new Date('2026-11-01T00:00:00Z'),
  lastError: 'HTTP 503',
  sourceUrl: null,
  competitionDate: '2026-10-01',
  ...extra,
});

function opciones(extra: string[] = []): OpcionesCli {
  const r = parsearArgsBackfill(extra);
  if (!r.ok) throw new Error(r.error);
  return r.opciones;
}

function deps(extra: Partial<DepsBackfillCli> = {}) {
  const ejecutor = vi.fn(async () => ({ estado: 'completo' as const, peticiones: 3 }));
  const crearEjecutor = vi.fn(async () => ejecutor);
  const base: DepsBackfillCli = {
    leerFilas: async () => ({ filas: [fila()], truncado: false }),
    leerAgregada: async () => [
      { source: 'fie', factKind: 'ranking', status: 'error', claseCursor: null, consistente: true, n: 1, publicado: 100, importado: 20 },
    ],
    leerReferencias: async () => ({
      tablaDisponible: true,
      inscripcionesFie: 10,
      inscripcionesFieHistoricas: 8,
      conReferencia: 2,
      historicasSinReferencia: 6,
    }),
    esquema: async () => ({ identidad: true }),
    categoriasAmpliadas: async () => false,
    medir: async () => ocupacion(30),
    crearEjecutor,
    ahora: () => new Date('2026-12-01T00:00:00Z'),
    dormir: async () => {},
    ...extra,
  };
  return { base, ejecutor, crearEjecutor };
}

describe('argumentos del comando backfill', () => {
  it('por defecto es simulación y usa los límites acotados', () => {
    const o = opciones();
    expect(o.aplicar).toBe(false);
    expect(o.planNeon).toEqual({ tipo: 'desconocido' });
    expect(o.maxTareas).toBeLessThanOrEqual(TOPE_TAREAS);
  });

  it('rechaza límites por encima del tope, opciones desconocidas y valores sin forma', () => {
    expect(parsearArgsBackfill(['--max-tareas', String(TOPE_TAREAS + 1)])).toMatchObject({ ok: false });
    expect(parsearArgsBackfill(['--todo'])).toMatchObject({ ok: false });
    expect(parsearArgsBackfill(['--temporadas', "2027'; drop"])).toMatchObject({ ok: false });
    expect(parsearArgsBackfill(['--unidad', 'pdf:2027:x'])).toMatchObject({ ok: false });
    expect(parsearArgsBackfill(['--unidad', 'fie:2027'])).toMatchObject({ ok: false });
    expect(parsearArgsBackfill(['--plan-neon', 'launch'])).toMatchObject({ ok: false });
  });

  it('acepta varias unidades, releer acotado y un plan verificado completo', () => {
    const o = opciones([
      '--unidad', 'fie:2027:1478',
      '--unidad', 'engarde:2026:org/evt',
      '--releer', 'fie|2027|1478',
      '--neon-umbral-gib', '0.9',
      '--neon-verificado-en', '2026-12-01',
    ]);
    expect(o.unidades.map((u) => `${u.fuente}:${u.season}:${u.competitionKey}`)).toEqual(['fie:2027:1478', 'engarde:2026:org/evt']);
    expect(o.releer.claves).toEqual(['fie|2027|1478']);
    expect(o.planNeon).toMatchObject({ tipo: 'otro', verificadoEn: '2026-12-01' });
    expect(parsearArgsBackfill(['--neon-umbral-gib', '0.9'])).toMatchObject({ ok: false });
  });
});

describe('ejecución del comando backfill (VAL-CAPACITY-001, VAL-BACKFILL-007)', () => {
  it('la simulación no construye ejecutor, no ejecuta tareas y no pide nada a proveedores', async () => {
    const { base, ejecutor, crearEjecutor } = deps();
    const r = await ejecutarBackfillCli(base, opciones());
    expect(crearEjecutor).not.toHaveBeenCalled();
    expect(ejecutor).not.toHaveBeenCalled();
    expect(r.codigo).toBe(0);
    expect(r.informe?.modo).toBe('simulacion');
    expect(r.informe?.ejecutadas).toEqual([]);
    expect(r.informe?.pendientes.map((t) => t.clave)).toEqual(['fie|2027|99']);
    const texto = r.lineas.join('\n');
    expect(texto).toMatch(/SIMULACIÓN/);
    expect(texto).toMatch(/Cobertura puestos: unidades=1 publicado=100 importado=20/);
    expect(texto).toMatch(/históricas sin referencia=6 de 8/);
    expect(texto).toMatch(/Crecimiento proyectado.*supuesto/);
  });

  it('con --aplicar ejecuta el lote, mide antes y después e informa de la diferencia', async () => {
    let mediciones = 0;
    const { base, ejecutor } = deps({ medir: async () => ocupacion(30 + 5 * mediciones++) });
    const r = await ejecutarBackfillCli(base, opciones(['--aplicar']));
    expect(ejecutor).toHaveBeenCalledTimes(1);
    expect(r.informe?.modo).toBe('aplicado');
    expect(r.informe?.capacidad?.antes).not.toBeNull();
    expect(r.informe?.capacidad?.despues).not.toBeNull();
    expect(r.lineas.join('\n')).toMatch(/después: .*Δ/);
  });

  it('sin la migración 0017 no escribe ni ejecuta nada y sale con código 2', async () => {
    const { base, crearEjecutor } = deps({ esquema: async () => ({ identidad: false }) });
    const r = await ejecutarBackfillCli(base, opciones(['--aplicar']));
    expect(r.codigo).toBe(2);
    expect(crearEjecutor).not.toHaveBeenCalled();
    expect(r.lineas.join('\n')).toMatch(/0017/);
  });

  it('sin la 0017 tampoco consulta tablas inexistentes, ni en simulación, y mide la ocupación', async () => {
    const leerFilas = vi.fn(async () => ({ filas: [], truncado: false }));
    const leerAgregada = vi.fn(async () => []);
    const { base } = deps({ esquema: async () => ({ identidad: false }), leerFilas, leerAgregada });
    const r = await ejecutarBackfillCli(base, opciones());
    expect(r.codigo).toBe(2);
    expect(leerFilas).not.toHaveBeenCalled();
    expect(leerAgregada).not.toHaveBeenCalled();
    expect(r.lineas.join('\n')).toMatch(/Ocupación lógica actual: 30\.00 MiB/);
  });

  it('para por capacidad antes de ejecutar cuando la base ya roza el umbral y conserva lo pendiente', async () => {
    const { base, ejecutor } = deps({ medir: async () => ocupacion(410) });
    const r = await ejecutarBackfillCli(base, opciones(['--aplicar']));
    expect(r.codigo).toBe(3);
    expect(ejecutor).not.toHaveBeenCalled();
    expect(r.informe?.parada).toBe('capacidad');
    expect(r.informe?.pendientes).toHaveLength(1);
    expect(r.lineas.join('\n')).toMatch(/decisión del propietario/);
  });

  it('un listado de cobertura truncado se avisa y las unidades agotadas no se reintentan', async () => {
    const { base } = deps({
      leerFilas: async () => ({ filas: [fila({ attempts: 9 })], truncado: true }),
    });
    const r = await ejecutarBackfillCli(base, opciones());
    expect(r.plan?.tareas).toEqual([]);
    expect(r.plan?.omitidas.agotadas).toEqual(['fie|2027|99']);
    expect(r.lineas.join('\n')).toMatch(/AVISO: el listado de cobertura se cortó/);
  });

  it('sin la migración 0018 lo dice en vez de contar cero', async () => {
    const { base } = deps({
      leerReferencias: async () => ({
        tablaDisponible: false,
        inscripcionesFie: 0,
        inscripcionesFieHistoricas: 0,
        conReferencia: null,
        historicasSinReferencia: null,
      }),
    });
    const r = await ejecutarBackfillCli(base, opciones());
    expect(r.lineas.join('\n')).toMatch(/0018 no está aplicada/);
  });
});
