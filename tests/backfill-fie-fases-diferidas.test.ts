import { describe, expect, it } from 'vitest';
import type { DepsEvidencia } from '@/lib/entries/evidencia';
import { crearEjecutor } from '@/lib/ingest/backfill/ejecutores';
import type { Tarea } from '@/lib/ingest/backfill/orquestador';
import { planificarDesdeCobertura, type FilaPlan } from '@/lib/ingest/backfill/plan';
import { PresupuestoHttp, conPresupuesto } from '@/lib/ingest/backfill/presupuesto-http';
import type { DepsPersistenciaFie } from '@/lib/ingest/fie-resultados-persist';
import type { DepsLecturaFie } from '@/lib/ingest/sources/fie-resultados';
import { conflictosDeConfirmacion, type DepsGuardConfirmacion } from '@/lib/sport/id-guard';
import type { ExternalIdRow } from '@/lib/identity/resolver';
import { AlmacenCobertura } from './helpers/almacen-cobertura';

const META = {
  competitionId: 99,
  season: 2027,
  name: 'Prueba',
  type: 'I',
  category: 'S',
  location: 'X',
  federation: 'COL',
  startDate: '2026-09-25',
  endDate: '2026-09-25',
  weapon: 'S',
  gender: 'F',
  tournamentId: 5,
};

function fuente(peticiones: string[], opciones: { pools?: () => unknown } = {}): DepsLecturaFie {
  return {
    async fetchJson(url) {
      peticiones.push(url.replace(/^.*competition\/2027\/99/, '') || 'metadata');
      if (url.endsWith('/competition/2027/99')) return META;
      if (url.endsWith('/results/pools')) return opciones.pools ? opciones.pools() : { pools: [] };
      if (url.endsWith('/results/tableau')) return { tableau: [] };
      return {
        totalFound: 3,
        page: 1,
        pageSize: 24,
        items: [1, 2, 3].map((n) => ({ rank: n, points: null, fencer: { id: 500 + n, name: `SIM ${n}`, countryCode: 'ESP', gender: 'F' } })),
      };
    },
  };
}

function persistencia(almacen: AlmacenCobertura): DepsPersistenciaFie {
  const externos: ExternalIdRow[] = [];
  const evidencia: DepsEvidencia = {
    esquema: async () => ({ identidad: true, referencias: true }),
    atletasPorLicencia: async () => [],
    fichasFie: async () => [],
    externos: async (valores) => externos.filter((e) => valores.includes(e.value)),
    personas: async (ids) => new Map(ids.map((id) => [id, { athleteId: null, mergedIntoPersonId: null }])),
  };
  const guard: DepsGuardConfirmacion = {
    confirmar: async (c) => {
      if (conflictosDeConfirmacion(externos, c).length > 0) return false;
      externos.push({ ...c, linkStatus: 'CONFIRMADO' });
      return true;
    },
    conflictos: async (c) => conflictosDeConfirmacion(externos, c),
  };
  let n = 0;
  const resultados = new Set<string>();
  return {
    esquema: async () => ({ identidad: true, referencias: true }),
    evidencia,
    guard,
    nuevoId: () => `persona-${(n += 1)}`,
    upsertPrueba: async () => 'comp-1',
    upsertResultados: async (_c, filas) => {
      for (const f of filas) resultados.add(f.sourceFactKey);
      return { nuevos: filas.length, revisados: 0, sinCambios: 0 };
    },
    upsertAsaltos: async () => ({ nuevos: 0, revisados: 0, sinCambios: 0 }),
    upsertCobertura: async (f) => almacen.escribir('fie', f),
    contarResultados: async () => ({ total: resultados.size, sinPersona: 0 }),
  };
}

const tarea = (extra: Partial<Tarea> = {}): Tarea => ({
  clave: 'fie|2027|99',
  tipo: 'fie_prueba',
  fuente: 'fie',
  season: '2027',
  competitionKey: '99',
  motivo: 'nunca_leido',
  releer: false,
  estimacion: { puestos: 150, asaltos: 250, documentos: 0, unidades: 3 },
  ...extra,
});

function ejecutorCon(almacen: AlmacenCobertura, peticiones: string[], maxPeticiones: number, pools?: () => unknown) {
  const presupuesto = new PresupuestoHttp({ maxPeticiones, maxMs: 60_000, ahora: () => 0 });
  const base = fuente(peticiones, { pools });
  const ejecutar = crearEjecutor({
    fie: {
      lectura: { fetchJson: conPresupuesto(presupuesto, base.fetchJson) },
      persistencia: persistencia(almacen),
      cursorActual: async (season, id) => almacen.obtener('fie', 'ranking', String(id), String(season))?.cursor ?? null,
      fasesActuales: async (season, id) => {
        const estado = (factKind: string) => {
          const f = almacen.obtener('fie', factKind, String(id), String(season));
          return f ? { status: f.status, cursor: f.cursor } : null;
        };
        return { ranking: estado('ranking'), pools: estado('pools'), tableau: estado('tableau') };
      },
    },
  });
  return { ejecutar, presupuesto };
}

const filasPlan = (almacen: AlmacenCobertura): FilaPlan[] =>
  [...almacen.filas.values()].map((f) => ({
    source: f.source,
    season: f.season,
    factKind: f.factKind,
    competitionKey: f.competitionKey,
    status: f.status as FilaPlan['status'],
    publishedTotal: f.publishedTotal,
    importedTotal: f.importedTotal,
    attempts: f.attempts,
    cursor: f.cursor,
    lastCheckedAt: f.lastCheckedAt,
    lastError: f.lastError,
    sourceUrl: f.sourceUrl,
    competitionDate: '2026-09-25',
  }));

const OPCIONES_PLAN = { ahora: new Date('2027-06-01T00:00:00Z'), categoriasAmpliadas: false, maxReleer: 5, maxIntentos: 5, horasEntreRelecturas: 12 };

describe('FIE: fases diferidas por presupuesto', () => {
  it('con presupuesto 2 el ranking se lee una vez y poules/cuadro avanzan en las ejecuciones siguientes sin gastar intentos', async () => {
    const almacen = new AlmacenCobertura();
    const peticiones: string[] = [];

    const r1 = await ejecutorCon(almacen, peticiones, 2).ejecutar(tarea());
    expect(peticiones).toHaveLength(2);
    expect(r1.estado).toBe('pendiente');
    expect(almacen.obtener('fie', 'ranking', '99')?.status).toBe('completo');
    for (const fase of ['pools', 'tableau']) {
      const fila = almacen.obtener('fie', fase, '99');
      expect(fila, fase).toMatchObject({ status: 'pendiente', attempts: 0, lastCheckedAt: null });
      expect(fila?.lastError).toMatch(/Presupuesto del lote agotado/);
    }

    // La fase aplazada es trabajo pendiente del plan, no una tarea desaparecida ni un error agotado.
    const plan = planificarDesdeCobertura(filasPlan(almacen), [], OPCIONES_PLAN);
    expect(plan.tareas.map((t) => [t.clave, t.motivo])).toEqual([['fie|2027|99', 'nunca_leido']]);
    expect(plan.omitidas.agotadas).toEqual([]);

    const r2 = await ejecutorCon(almacen, peticiones, 2).ejecutar(plan.tareas[0]);
    const segunda = peticiones.slice(2);
    expect(segunda.some((p) => p.includes('/results/ranking'))).toBe(false);
    expect(segunda).toEqual(['metadata', '/results/pools']);
    expect(r2.estado).toBe('pendiente');
    expect(almacen.obtener('fie', 'pools', '99')?.status).not.toBe('pendiente');
    expect(almacen.obtener('fie', 'tableau', '99')).toMatchObject({ status: 'pendiente', attempts: 0 });

    const plan2 = planificarDesdeCobertura(filasPlan(almacen), [], OPCIONES_PLAN);
    const r3 = await ejecutorCon(almacen, peticiones, 2).ejecutar(plan2.tareas[0]);
    expect(peticiones.slice(4)).toEqual(['metadata', '/results/tableau']);
    expect(r3.estado).not.toBe('pendiente');
    expect(almacen.obtener('fie', 'tableau', '99')?.status).not.toBe('pendiente');
    expect(peticiones.filter((p) => p.includes('/results/ranking'))).toHaveLength(1);
    expect(planificarDesdeCobertura(filasPlan(almacen), [], OPCIONES_PLAN).tareas).toEqual([]);
  });

  it('una relectura explícita vuelve a leer todas las fases aunque el ranking esté completo', async () => {
    const almacen = new AlmacenCobertura();
    const peticiones: string[] = [];
    await ejecutorCon(almacen, peticiones, 10).ejecutar(tarea());
    const antes = peticiones.length;
    await ejecutorCon(almacen, peticiones, 10).ejecutar(tarea({ motivo: 'releer', releer: true }));
    const relectura = peticiones.slice(antes);
    expect(relectura.some((p) => p.includes('/results/ranking'))).toBe(true);
    expect(relectura).toContain('/results/pools');
    expect(relectura).toContain('/results/tableau');
  });

  it('un fallo real de la fase (no de presupuesto) sigue siendo un error con intento', async () => {
    const almacen = new AlmacenCobertura();
    const peticiones: string[] = [];
    const r = await ejecutorCon(almacen, peticiones, 10, () => ({ forma: 'inesperada' })).ejecutar(tarea());
    expect(almacen.obtener('fie', 'pools', '99')).toMatchObject({ status: 'error', attempts: 1 });
    expect(r.estado).toBe('error');
  });

  it('un ranking continuado con poules aplazadas sigue leyendo esas poules además de sus páginas', async () => {
    const almacen = new AlmacenCobertura();
    const peticiones: string[] = [];
    // Presupuesto 3: metadata + ranking + poules; el cuadro queda aplazado.
    await ejecutorCon(almacen, peticiones, 3).ejecutar(tarea());
    expect(almacen.obtener('fie', 'tableau', '99')).toMatchObject({ status: 'pendiente', attempts: 0 });
    expect(almacen.obtener('fie', 'pools', '99')?.status).not.toBe('pendiente');
  });
});
