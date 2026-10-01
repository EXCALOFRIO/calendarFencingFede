import { describe, expect, it } from 'vitest';
import type { DepsEvidencia } from '@/lib/entries/evidencia';
import type { ExternalIdRow } from '@/lib/identity/resolver';
import { decodificarCursorFie } from '@/lib/ingest/backfill/cursor-fie';
import { crearEjecutor } from '@/lib/ingest/backfill/ejecutores';
import { ejecutarLote, ErrorTecnico, type EntradaLote, type Tarea } from '@/lib/ingest/backfill/orquestador';
import { planificarDesdeCobertura, type FilaPlan } from '@/lib/ingest/backfill/plan';
import type { DepsPersistenciaFie, FilaCobertura, FilaResultado } from '@/lib/ingest/fie-resultados-persist';
import { TAMANO_PAGINA_RANKING, type DepsLecturaFie } from '@/lib/ingest/sources/fie-resultados';
import { conflictosDeConfirmacion, type DepsGuardConfirmacion } from '@/lib/sport/id-guard';

/**
 * SIMULACIÓN: fuente FIE sintética de 2.600 participantes y almacén en memoria
 * con el contrato de `fie-resultados-db.ts` (clave natural, revisión sólo si
 * cambia el hash, cursor que persiste el progreso). No es SQL contra Neon:
 * comprueba cómo el orquestador encadena planificación, lectura, escritura y
 * checkpoint, y cómo reanuda tras un fallo.
 */
const TOTAL = 2600;

type Fallos = { pagina: number; veces: number; status: number }[];

function fuente(fallos: Fallos = []) {
  const peticiones: number[] = [];
  const restantes = fallos.map((f) => ({ ...f }));
  const deps: DepsLecturaFie = {
    async fetchJson(url) {
      if (url.endsWith('/competition/2027/99')) {
        return {
          competitionId: 99,
          season: 2027,
          name: 'Prueba sintética',
          type: 'I',
          category: 'C',
          location: 'Sintetica',
          federation: 'COL',
          startDate: '2026-09-25',
          endDate: '2026-09-25',
          weapon: 'S',
          gender: 'F',
          tournamentId: 5,
        };
      }
      if (/results\/(pools|tableau)/.test(url)) return { pools: [], tableau: [] };
      const pagina = Number(new URL(url).searchParams.get('page'));
      peticiones.push(pagina);
      const fallo = restantes.find((f) => f.pagina === pagina && f.veces > 0);
      if (fallo) {
        fallo.veces -= 1;
        throw new Error(`HTTP ${fallo.status} al pedir la página ${pagina}`);
      }
      const desde = (pagina - 1) * TAMANO_PAGINA_RANKING;
      return {
        totalFound: TOTAL,
        page: pagina,
        pageSize: TAMANO_PAGINA_RANKING,
        items: Array.from({ length: Math.max(0, Math.min(TAMANO_PAGINA_RANKING, TOTAL - desde)) }, (_, i) => ({
          rank: desde + i + 1,
          points: null,
          fencer: { id: 10_000 + desde + i, name: `SIMULADO ${desde + i}`, countryCode: 'ESP', gender: 'F' },
        })),
      };
    },
  };
  return { deps, peticiones };
}

function almacen() {
  const externos: ExternalIdRow[] = [];
  const resultados = new Map<string, FilaResultado & { revision: number }>();
  const cobertura = new Map<string, FilaCobertura>();
  let n = 0;
  const evidencia: DepsEvidencia = {
    esquema: async () => ({ identidad: true, referencias: true }),
    atletasPorLicencia: async () => [],
    fichasFie: async () => [],
    externos: async (valores) => externos.filter((e) => valores.includes(e.value)),
    personas: async (ids) => new Map(ids.map((id) => [id, { athleteId: null, mergedIntoPersonId: null }])),
  };
  const guard: DepsGuardConfirmacion = {
    async confirmar(c) {
      if (conflictosDeConfirmacion(externos, c).length > 0) return false;
      externos.push({ ...c, linkStatus: 'CONFIRMADO' });
      return true;
    },
    async conflictos(c) {
      return conflictosDeConfirmacion(externos, c);
    },
  };
  const deps: DepsPersistenciaFie = {
    esquema: async () => ({ identidad: true, referencias: true }),
    evidencia,
    guard,
    nuevoId: () => `persona-${(n += 1)}`,
    upsertPrueba: async () => 'comp-1',
    async upsertResultados(_c, filas) {
      const res = { nuevos: 0, revisados: 0, sinCambios: 0 };
      for (const f of filas) {
        const previa = resultados.get(f.sourceFactKey);
        if (!previa) {
          resultados.set(f.sourceFactKey, { ...f, revision: 1 });
          res.nuevos += 1;
        } else if (previa.contentHash !== f.contentHash) {
          resultados.set(f.sourceFactKey, { ...f, revision: previa.revision + 1 });
          res.revisados += 1;
        } else res.sinCambios += 1;
      }
      return res;
    },
    upsertAsaltos: async () => ({ nuevos: 0, revisados: 0, sinCambios: 0 }),
    async upsertCobertura(f) {
      const clave = `${f.factKind}|${f.competitionKey}`;
      const previa = cobertura.get(clave);
      cobertura.set(clave, {
        ...f,
        publishedTotal: f.publishedTotal === undefined ? previa?.publishedTotal : f.publishedTotal,
        importedTotal: f.importedTotal === undefined ? previa?.importedTotal : f.importedTotal,
        cursor: f.cursor === undefined ? previa?.cursor : f.cursor,
      });
    },
    async contarResultados() {
      const filas = [...resultados.values()];
      return { total: filas.length, sinPersona: filas.filter((r) => r.personId === null).length };
    },
  };
  return { deps, resultados, cobertura };
}

const tarea = (extra: Partial<Tarea> = {}): Tarea => ({
  clave: 'fie|2027|99',
  tipo: 'fie_prueba',
  fuente: 'fie',
  season: '2027',
  competitionKey: '99',
  motivo: 'nunca_leido',
  releer: false,
  estimacion: { puestos: TOTAL, asaltos: 0, documentos: 0, unidades: 3 },
  ...extra,
});

function lote(a: ReturnType<typeof almacen>, f: ReturnType<typeof fuente>, tareas: Tarea[], extra: Partial<EntradaLote> = {}) {
  const dormidas: number[] = [];
  const ejecutar = crearEjecutor({
    fie: {
      lectura: f.deps,
      persistencia: a.deps,
      cursorActual: async () => a.cobertura.get('ranking|99')?.cursor ?? null,
    },
  });
  const entrada: EntradaLote = {
    tareas,
    ejecutar,
    limites: { maxTareas: 10, maxPeticiones: 5000, maxMs: 60_000, maxReintentos: 2, esperaBaseMs: 10, esperaMaxMs: 100 },
    aplicar: true,
    ahora: () => 0,
    dormir: async (ms) => {
      dormidas.push(ms);
    },
    ...extra,
  };
  return { correr: () => ejecutarLote(entrada), dormidas };
}

function filasPlan(a: ReturnType<typeof almacen>): FilaPlan[] {
  return [...a.cobertura.values()]
    .filter((c) => c.factKind === 'ranking')
    .map((c) => ({
      source: 'fie',
      season: '2027',
      factKind: c.factKind,
      competitionKey: c.competitionKey,
      status: c.status,
      publishedTotal: c.publishedTotal ?? null,
      importedTotal: c.importedTotal ?? 0,
      attempts: 1,
      cursor: c.cursor ?? null,
      lastCheckedAt: new Date('2026-10-01T00:00:00Z'),
      lastError: c.lastError,
      sourceUrl: null,
      competitionDate: '2026-09-25',
    }));
}

const opcionesPlan = {
  ahora: new Date('2026-12-01T00:00:00Z'),
  categoriasAmpliadas: true,
  maxReleer: 5,
  maxIntentos: 5,
  horasEntreRelecturas: 12,
};

describe('backfill FIE por lotes reanudables (VAL-BACKFILL-002)', () => {
  it('lote 1 cierra en la página 100 sin marcar completo; el plan siguiente continúa en la 101 y termina sin duplicar', async () => {
    const a = almacen();
    const f = fuente();
    const uno = await lote(a, f, [tarea()]).correr();
    expect(uno.ejecutadas[0].resultado.estado).toBe('parcial');
    expect(a.cobertura.get('ranking|99')).toMatchObject({ status: 'parcial', importedTotal: 100 * TAMANO_PAGINA_RANKING });
    expect(decodificarCursorFie(a.cobertura.get('ranking|99')?.cursor)?.siguientePagina).toBe(101);

    const plan = planificarDesdeCobertura(filasPlan(a), [], opcionesPlan);
    expect(plan.tareas.map((t) => [t.clave, t.motivo])).toEqual([['fie|2027|99', 'continuar']]);

    const dos = await lote(a, f, plan.tareas).correr();
    expect(dos.ejecutadas[0].resultado.estado).toBe('completo');
    expect(a.resultados.size).toBe(TOTAL);
    expect(a.cobertura.get('ranking|99')).toMatchObject({ status: 'completo', importedTotal: TOTAL, cursor: null });
    // La primera página de la continuación es la 101: no se vuelve a la 1.
    expect(f.peticiones.filter((p) => p === 101)).toHaveLength(1);
    expect(f.peticiones.filter((p) => p === 1)).toHaveLength(1);

    expect(planificarDesdeCobertura(filasPlan(a), [], opcionesPlan).tareas).toEqual([]);
  });

  it('un 503 en la página 7 se reintenta en esa página (no vuelve a la 1) y el lote no pierde progreso', async () => {
    const a = almacen();
    const f = fuente([{ pagina: 7, veces: 1, status: 503 }]);
    const l = lote(a, f, [tarea()]);
    const r = await l.correr();
    expect(r.ejecutadas[0].reintentos).toBe(1);
    expect(l.dormidas).toEqual([10]);
    expect(f.peticiones.filter((p) => p === 7)).toHaveLength(2);
    for (let p = 1; p <= 6; p += 1) expect(f.peticiones.filter((x) => x === p)).toHaveLength(1);
    // El tope de 100 páginas es por lectura: tras reintentar desde la 7 se leen otras 100 (6 + 100).
    expect(a.cobertura.get('ranking|99')?.importedTotal).toBe(106 * TAMANO_PAGINA_RANKING);
    expect(decodificarCursorFie(a.cobertura.get('ranking|99')?.cursor)?.siguientePagina).toBe(107);
  });

  it('429 persistente: el progreso queda en el cursor, el estado es parcial con error (no vacío) y el lote para', async () => {
    const a = almacen();
    const f = fuente([{ pagina: 7, veces: 99, status: 429 }]);
    const r = await lote(a, f, [tarea(), tarea({ clave: 'fie|2027|100', competitionKey: '100' })]).correr();
    expect(r.ejecutadas).toHaveLength(1);
    expect(r.ejecutadas[0].resultado.estado).toBe('error');
    expect(r.ejecutadas[0].resultado.tecnico?.status).toBe(429);
    expect(r.parada).toBe('limite_remoto');
    expect(r.pendientes.map((t) => t.clave)).toEqual(['fie|2027|100']);
    const fila = a.cobertura.get('ranking|99');
    expect(fila?.status).toBe('error');
    expect(fila?.lastError).toMatch(/429/);
    expect(fila?.publishedTotal).toBe(TOTAL);
    expect(decodificarCursorFie(fila?.cursor)?.siguientePagina).toBe(7);
    expect(a.resultados.size).toBe(6 * TAMANO_PAGINA_RANKING);

    // Tras el límite, otra ejecución retoma en la 7 y no duplica lo ya guardado.
    const f2 = fuente();
    const plan = planificarDesdeCobertura(filasPlan(a), [], opcionesPlan);
    expect(plan.tareas[0].motivo).toBe('continuar');
    await lote(a, f2, plan.tareas).correr();
    expect(f2.peticiones[0]).toBe(7);
    expect(a.resultados.size).toBeGreaterThan(6 * TAMANO_PAGINA_RANKING);
  });

  it('una excepción técnica del ejecutor se trata igual que un fallo devuelto', async () => {
    let n = 0;
    const r = await ejecutarLote({
      tareas: [tarea()],
      ejecutar: async () => {
        n += 1;
        if (n === 1) throw new ErrorTecnico('límite', 429, 50);
        return { estado: 'completo', peticiones: 1 };
      },
      limites: { maxTareas: 1, maxPeticiones: 10, maxMs: 1000, maxReintentos: 1, esperaBaseMs: 1, esperaMaxMs: 100 },
      aplicar: true,
      ahora: () => 0,
      dormir: async () => {},
    });
    expect(r.ejecutadas[0].resultado.estado).toBe('completo');
  });
});
