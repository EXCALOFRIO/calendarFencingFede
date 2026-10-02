import { describe, expect, it } from 'vitest';
import { descubrirCatalogo, type DepsDescubrimiento } from '@/lib/ingest/backfill/descubrimiento';
import type { DepsPersistenciaDescubrimiento } from '@/lib/ingest/backfill/descubrimiento-persist';
import { ErrorHttp } from '@/lib/ingest/http-retry';
import { planificarDesdeCobertura, type FilaPlan } from '@/lib/ingest/backfill/plan';
import { AlmacenCobertura } from './helpers/almacen-cobertura';

/**
 * El descubrimiento guarda su progreso antes de avanzar: pruebas descubiertas de cada temporada
 * y checkpoint del índice. Todo con un almacén de cobertura en memoria que replica el upsert real
 * (simulación controlada, no SQL).
 */

const URL_TEMPORADAS = 'https://fie.org/api/fie/competitions/seasons';

function persistenciaDe(almacen: AlmacenCobertura): DepsPersistenciaDescubrimiento {
  return {
    escribirCobertura: async (source, f) => almacen.escribir(source, f),
    sembrar: async (filas) => {
      for (const { source, fila } of filas) almacen.insertarSiNoExiste(source, { ...fila, status: 'pendiente' });
    },
    leerIndices: async () =>
      [...almacen.filas.values()]
        .filter((f) => f.factKind === 'index')
        .map((f) => ({
          source: f.source,
          season: f.season,
          competitionKey: f.competitionKey,
          status: f.status,
          publishedTotal: f.publishedTotal,
          importedTotal: f.importedTotal,
          cursor: f.cursor,
          sourceUrl: f.sourceUrl,
          lastError: f.lastError,
        })),
  };
}

const item = (season: number, id: number) => ({
  competitionId: id,
  season,
  name: `Prueba ${id}`,
  type: 'I',
  category: 'S',
  federation: 'FIE',
  startDate: '2026-12-01',
  weapon: 'F',
  gender: 'M',
});

type Fallo = { season: number; pagina: number; error: Error };

function fieDe(temporadas: Record<number, number>, fallos: Fallo[] = []) {
  const peticiones: string[] = [];
  const json = async (url: string): Promise<unknown> => {
    peticiones.push(url);
    if (url === URL_TEMPORADAS) {
      const items = Object.keys(temporadas).map((t) => ({ label: Number(t) }));
      return { totalFound: items.length, items };
    }
    const m = url.match(/season=(\d+)&page=(\d+)/);
    if (!m) throw new Error(`URL inesperada ${url}`);
    const season = Number(m[1]);
    const pagina = Number(m[2]);
    const fallo = fallos.find((f) => f.season === season && f.pagina === pagina);
    if (fallo) throw fallo.error;
    const total = temporadas[season];
    const desde = (pagina - 1) * 100;
    const items = Array.from({ length: Math.max(0, Math.min(100, total - desde)) }, (_, i) => item(season, season * 1000 + desde + i));
    return { totalFound: total, items };
  };
  return { json, peticiones };
}

function montar(temporadas: Record<number, number>, fallos: Fallo[] = []) {
  const almacen = new AlmacenCobertura();
  const fie = fieDe(temporadas, fallos);
  const skermoPeticiones: string[] = [];
  const deps = (fallosActuales: Fallo[] = fallos): DepsDescubrimiento => {
    const f = fieDe(temporadas, fallosActuales);
    fie.peticiones.length = 0;
    fie.json = f.json;
    fie.peticiones = f.peticiones;
    return {
      fie: { json: (u) => fie.json(u) },
      skermo: {
        indice: async (fed, t) => {
          skermoPeticiones.push(`${fed}:${t ?? ''}`);
          return `<html data-id="${t ?? 'base'}"/>`;
        },
        temporadas: () => [{ value: '1', label: '2024-2025', selected: true }],
        parsear: () => ({
          rows: [
            {
              competitionId: '77',
              resultsUrl: 'https://rfes.example/resultados/77',
              date: '2025-01-10',
              name: 'Copa Uno',
              weapon: 'FLORETE',
              gender: 'M',
              category: 'SENIOR',
              categoryRaw: 'Senior',
              format: 'INDIVIDUAL',
              city: null,
              country: null,
              documents: [{ title: 'Clasificación', url: 'https://rfes.example/docs/abc.pdf' }],
              liveLinks: [],
              externalUrls: [],
            },
          ],
          rowsSeen: 1,
          mismatches: 0,
        }),
      },
      federaciones: () => [{ codigo: 'RFEE', verificada: true }],
      persistencia: persistenciaDe(almacen),
    };
  };
  return { almacen, fie, skermoPeticiones, deps };
}

const filasPlan = (almacen: AlmacenCobertura): FilaPlan[] =>
  [...almacen.filas.values()]
    .filter((f) => f.factKind !== 'index')
    .map((f) => ({
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
      competitionDate: null,
    }));

const soloFie = { fuentes: ['fie'] };
const OPCIONES_PLAN = {
  ahora: new Date('2026-12-02T00:00:00Z'),
  categoriasAmpliadas: false,
  maxReleer: 10,
  maxIntentos: 3,
  horasEntreRelecturas: 24,
};

describe('descubrimiento con progreso durable entre lotes pequeños', () => {
  it('cada lote continúa en la página siguiente de la temporada y no relee el prefijo ya guardado', async () => {
    const { almacen, fie, deps } = montar({ 2027: 150, 2026: 30 });

    // Lote 1: lista de temporadas + página 1 de 2027.
    const l1 = await descubrirCatalogo(deps(), soloFie, 2);
    expect(l1.peticiones).toBe(2);
    const indice1 = almacen.obtener('fie', 'index', 'index:FIE', '2027');
    expect(indice1?.status).toBe('parcial');
    expect(JSON.parse(indice1?.cursor ?? '{}')).toMatchObject({ semillas: true, siguientePagina: 2 });
    expect([...almacen.filas.values()].filter((f) => f.factKind === 'ranking')).toHaveLength(100);

    // Lote 2: sigue en la página 2, sin volver a pedir la 1.
    const l2 = await descubrirCatalogo(deps(), soloFie, 2);
    expect(fie.peticiones.filter((u) => /season=2027&page=1\b/.test(u))).toHaveLength(0);
    expect(fie.peticiones.some((u) => /season=2027&page=2\b/.test(u))).toBe(true);
    expect(almacen.obtener('fie', 'index', 'index:FIE', '2027')?.status).toBe('completo');
    expect(l2.pendientes).toBeGreaterThanOrEqual(0);

    // Lote 3: 2027 ya está leída y se pasa a 2026.
    await descubrirCatalogo(deps(), soloFie, 2);
    expect(fie.peticiones.some((u) => /season=2027/.test(u))).toBe(false);
    expect(fie.peticiones.some((u) => /season=2026&page=1\b/.test(u))).toBe(true);
    expect(almacen.obtener('fie', 'index', 'index:FIE', '2026')?.status).toBe('completo');

    // Lo descubierto sigue siendo trabajo pendiente aunque ningún lote lo ejecutó.
    expect([...almacen.filas.values()].filter((f) => f.factKind === 'ranking')).toHaveLength(180);
    const plan = planificarDesdeCobertura(filasPlan(almacen), [], OPCIONES_PLAN);
    expect(plan.tareas).toHaveLength(180);
    expect(new Set(plan.tareas.map((t) => t.motivo))).toEqual(new Set(['nunca_leido']));
  });

  it('un 429 con Retry-After corta la enumeración posterior y deja el checkpoint para retomar', async () => {
    const error = new ErrorHttp('HTTP 429 al pedir la página (Retry-After 30 s)', 429, 30_000);
    const { almacen, fie, skermoPeticiones, deps } = montar({ 2027: 250, 2026: 30 }, [{ season: 2027, pagina: 2, error }]);

    const r = await descubrirCatalogo(deps(), { fuentes: ['fie', 'skermo_rfee'] }, 40);

    expect(r.tecnico).toEqual({ status: 429, retryAfterMs: 30_000 });
    // Ni la temporada siguiente ni Skermo se tocan tras el límite.
    expect(fie.peticiones.some((u) => /season=2026/.test(u))).toBe(false);
    expect(skermoPeticiones).toEqual([]);
    const indice = almacen.obtener('fie', 'index', 'index:FIE', '2027');
    expect(indice).toMatchObject({ status: 'error', importedTotal: 100 });
    expect(JSON.parse(indice?.cursor ?? '{}')).toMatchObject({ siguientePagina: 2 });
    expect([...almacen.filas.values()].filter((f) => f.factKind === 'ranking')).toHaveLength(100);

    // Pasada la espera retoma en la página 2 (no repite la 1) y termina la temporada.
    const siguiente = await descubrirCatalogo(deps([]), soloFie, 40);
    expect(siguiente.tecnico).toBeUndefined();
    expect(fie.peticiones.filter((u) => /season=2027&page=1\b/.test(u))).toHaveLength(0);
    expect(almacen.obtener('fie', 'index', 'index:FIE', '2027')?.status).toBe('completo');
    expect([...almacen.filas.values()].filter((f) => f.factKind === 'ranking' && f.season === '2027')).toHaveLength(250);
  });

  it('un 5xx en la lista de temporadas también detiene la enumeración y se informa', async () => {
    const { skermoPeticiones, deps } = montar({ 2027: 10 });
    const d = deps();
    const r = await descubrirCatalogo(
      {
        ...d,
        fie: {
          json: async () => {
            throw new ErrorHttp('HTTP 503 al pedir las temporadas', 503, null);
          },
        },
      },
      { fuentes: ['fie', 'skermo_rfee'] },
      40,
    );
    expect(r.tecnico).toEqual({ status: 503, retryAfterMs: null });
    expect(skermoPeticiones).toEqual([]);
  });

  it('un índice guardado sin sus pruebas sembradas no cuenta como leído', async () => {
    const { almacen, fie, deps } = montar({ 2027: 20 });
    almacen.escribir('fie', {
      season: '2027',
      factKind: 'index',
      competitionKey: 'index:FIE',
      status: 'completo',
      publishedTotal: 20,
      importedTotal: 20,
    });
    await descubrirCatalogo(deps(), soloFie, 40);
    expect(fie.peticiones.some((u) => /season=2027&page=1\b/.test(u))).toBe(true);
    expect([...almacen.filas.values()].filter((f) => f.factKind === 'ranking')).toHaveLength(20);
  });

  it('Skermo siembra la prueba y el PDF con su origen, y no vuelve a leer una temporada guardada', async () => {
    const { almacen, skermoPeticiones, deps } = montar({});
    await descubrirCatalogo(deps(), { fuentes: ['skermo_rfee', 'rfee_pdf'] }, 10);

    expect(almacen.obtener('skermo_rfee', 'results', 'RFEE:77', '2024-2025')).toMatchObject({ status: 'pendiente', attempts: 0 });
    const pdf = almacen.obtener('rfee_pdf', 'pdf', 'doc:abc', '2024-2025');
    expect(pdf).toMatchObject({ status: 'pendiente', attempts: 0 });
    expect(JSON.parse(pdf?.cursor ?? '{}')).toMatchObject({
      sha256: null,
      semilla: true,
      origen: { indice: 1, refOriginal: 'skermo_rfee|2024-2025|RFEE:77', titulo: 'Copa Uno' },
    });
    expect(almacen.obtener('skermo_rfee', 'index', 'index:RFEE', '2024-2025')?.status).toBe('completo');

    skermoPeticiones.length = 0;
    await descubrirCatalogo(deps(), { fuentes: ['skermo_rfee', 'rfee_pdf'] }, 10);
    // Sólo la página base de la federación (necesaria para listar temporadas): ninguna temporada se vuelve a pedir.
    expect(skermoPeticiones).toEqual(['RFEE:']);
  });

  it('el descubrimiento no pisa una lectura ya hecha de una prueba redescubierta', async () => {
    const { almacen, deps } = montar({ 2027: 5 });
    almacen.escribir('fie', {
      season: '2027',
      factKind: 'ranking',
      competitionKey: '2027000',
      status: 'completo',
      publishedTotal: 5,
      importedTotal: 5,
    });
    await descubrirCatalogo(deps(), soloFie, 40);
    expect(almacen.obtener('fie', 'ranking', '2027000', '2027')).toMatchObject({ status: 'completo', attempts: 1 });
  });
});


