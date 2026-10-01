import { describe, expect, it } from 'vitest';
import type { DepsEvidencia } from '@/lib/entries/evidencia';
import type { ExternalIdRow } from '@/lib/identity/resolver';
import { decodificarCursorFie } from '@/lib/ingest/backfill/cursor-fie';
import {
  persistirLecturaFie,
  type DepsPersistenciaFie,
  type FilaCobertura,
  type FilaResultado,
} from '@/lib/ingest/fie-resultados-persist';
import {
  leerPruebaFie,
  TAMANO_PAGINA_RANKING,
  type DepsLecturaFie,
} from '@/lib/ingest/sources/fie-resultados';
import { conflictosDeConfirmacion, type DepsGuardConfirmacion } from '@/lib/sport/id-guard';

/**
 * SIMULACIÓN: fuente FIE sintética de 2.600 participantes y almacén en
 * memoria que imita el contrato de `fie-resultados-db.ts` (clave natural,
 * revisión sólo si cambia el hash, cuenta de puestos distintos). No es SQL
 * contra Neon: comprueba cómo se encadenan lectura, checkpoint y totales.
 */
const TOTAL = 2600;

function fuente(opciones: { posiciones?: (i: number) => number; fallo?: number } = {}): DepsLecturaFie {
  const posicion = opciones.posiciones ?? ((i) => i + 1);
  return {
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
      if (opciones.fallo === pagina) throw new Error(`HTTP 503 al pedir la página ${pagina}`);
      const desde = (pagina - 1) * TAMANO_PAGINA_RANKING;
      return {
        totalFound: TOTAL,
        page: pagina,
        pageSize: TAMANO_PAGINA_RANKING,
        items: Array.from({ length: Math.max(0, Math.min(TAMANO_PAGINA_RANKING, TOTAL - desde)) }, (_, i) => ({
          rank: posicion(desde + i),
          points: null,
          fencer: { id: 10_000 + desde + i, name: `SIMULADO ${desde + i}`, countryCode: 'ESP', gender: 'F' },
        })),
      };
    },
  };
}

function almacen() {
  const externos: ExternalIdRow[] = [];
  const personas = new Set<string>();
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
    async confirmar(c, persona) {
      if (conflictosDeConfirmacion(externos, c).length > 0) return false;
      if (persona) personas.add(persona.id);
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
  return { deps, resultados, cobertura, personas, ranking: () => cobertura.get('ranking|99')! };
}

describe('continuación persistida del ranking FIE (VAL-BACKFILL-002)', () => {
  it('cerrar un lote de 100 páginas deja parcial con cursor a la 101, no corpus completo', async () => {
    const a = almacen();
    const lectura = await leerPruebaFie(2027, 99, fuente());
    const r = await persistirLecturaFie(a.deps, lectura);
    expect(r.cobertura.ranking).toBe('parcial');
    expect(a.ranking()).toMatchObject({ status: 'parcial', publishedTotal: TOTAL, importedTotal: 100 * TAMANO_PAGINA_RANKING });
    expect(decodificarCursorFie(a.ranking().cursor)).toMatchObject({
      fuente: 'fie',
      season: 2027,
      competitionId: 99,
      pageSize: TAMANO_PAGINA_RANKING,
      siguientePagina: 101,
      total: TOTAL,
    });
  });

  it('la continuación acumula totales deduplicados, cierra como completo y limpia el cursor', async () => {
    const a = almacen();
    await persistirLecturaFie(a.deps, await leerPruebaFie(2027, 99, fuente()));
    const siguiente = decodificarCursorFie(a.ranking().cursor)!.siguientePagina;
    const lectura = await leerPruebaFie(2027, 99, fuente(), { desdePagina: siguiente, omitirAsaltos: true });
    const r = await persistirLecturaFie(a.deps, lectura);
    expect(r.cobertura.ranking).toBe('completo');
    expect(a.ranking()).toMatchObject({ status: 'completo', publishedTotal: TOTAL, importedTotal: TOTAL, cursor: null });
    expect(a.resultados.size).toBe(TOTAL);
  });

  it('un fallo a mitad conserva progreso y cursor en esa página; reintentar no duplica filas', async () => {
    const a = almacen();
    const parcial = await leerPruebaFie(2027, 99, fuente({ fallo: 7 }));
    await persistirLecturaFie(a.deps, parcial);
    expect(a.ranking()).toMatchObject({ status: 'parcial', importedTotal: 6 * TAMANO_PAGINA_RANKING });
    expect(decodificarCursorFie(a.ranking().cursor)?.siguientePagina).toBe(7);
    expect(a.ranking().lastError).toMatch(/503/);

    const reintento = await leerPruebaFie(2027, 99, fuente(), { desdePagina: 7, omitirAsaltos: true });
    await persistirLecturaFie(a.deps, reintento);
    // Páginas 1-6 de la primera lectura + 7-106 de la reintentada: sin solapes ni huecos.
    expect(a.resultados.size).toBe(106 * TAMANO_PAGINA_RANKING);
    expect(decodificarCursorFie(a.ranking().cursor)?.siguientePagina).toBe(107);
  });

  it('un 429 en la primera página de la continuación no pisa cifras ni cursor', async () => {
    const a = almacen();
    await persistirLecturaFie(a.deps, await leerPruebaFie(2027, 99, fuente()));
    const antes = { ...a.ranking() };
    const fallida = await leerPruebaFie(
      2027,
      99,
      {
        fetchJson: async (url) => {
          if (/page=101/.test(url)) throw new Error('HTTP 429 al pedir la página 101');
          return fuente().fetchJson(url);
        },
      },
      { desdePagina: 101, omitirAsaltos: true },
    );
    await persistirLecturaFie(a.deps, fallida);
    expect(a.ranking()).toMatchObject({
      status: 'error',
      importedTotal: antes.importedTotal,
      publishedTotal: antes.publishedTotal,
      cursor: antes.cursor,
    });
    expect(a.ranking().lastError).toMatch(/429/);
  });
});

describe('correcciones y empates (VAL-RESULT-009)', () => {
  it('releer sin cambios no duplica ni revisa; una corrección de puesto revisa la misma fila', async () => {
    const a = almacen();
    const deps = fuente({ posiciones: (i) => (i < 4 ? 1 : i + 1) });
    const primera = await persistirLecturaFie(a.deps, await leerPruebaFie(2027, 99, deps, { maxPaginas: 1 }));
    expect(primera.puestos.nuevos).toBe(TAMANO_PAGINA_RANKING);
    const idem = await persistirLecturaFie(a.deps, await leerPruebaFie(2027, 99, deps, { maxPaginas: 1 }));
    expect(idem.puestos).toEqual({ nuevos: 0, revisados: 0, sinCambios: TAMANO_PAGINA_RANKING });
    expect(a.resultados.size).toBe(TAMANO_PAGINA_RANKING);

    const corregida = fuente({ posiciones: (i) => (i < 4 ? 1 : i === 10 ? 3 : i + 1) });
    const r = await persistirLecturaFie(a.deps, await leerPruebaFie(2027, 99, corregida, { maxPaginas: 1 }));
    expect(r.puestos).toEqual({ nuevos: 0, revisados: 1, sinCambios: TAMANO_PAGINA_RANKING - 1 });
    expect(a.resultados.size).toBe(TAMANO_PAGINA_RANKING);
    expect([...a.resultados.values()].filter((f) => f.revision === 2)).toHaveLength(1);
  });

  it('cuatro tiradores empatados en el puesto 1 siguen siendo cuatro personas distintas', async () => {
    const a = almacen();
    await persistirLecturaFie(
      a.deps,
      await leerPruebaFie(2027, 99, fuente({ posiciones: (i) => (i < 4 ? 1 : i + 1) }), { maxPaginas: 1 }),
    );
    const empatados = [...a.resultados.values()].filter((f) => f.position === 1);
    expect(empatados).toHaveLength(4);
    expect(new Set(empatados.map((f) => f.personId)).size).toBe(4);
    expect(a.personas.size).toBe(TAMANO_PAGINA_RANKING);
  });
});
