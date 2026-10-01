import { describe, expect, it } from 'vitest';
import {
  leerPruebaFie,
  leerRanking,
  MAX_PAGINAS,
  TAMANO_PAGINA_RANKING,
  urlRanking,
  type DepsLecturaFie,
} from '@/lib/ingest/sources/fie-resultados';
import {
  codificarCursorFie,
  decodificarCursorFie,
  desdeCursorFie,
} from '@/lib/ingest/backfill/cursor-fie';

/**
 * SIMULACIÓN: una fuente FIE sintética con 2.600 participantes (109 páginas de
 * 24) servida por dependencias controladas. No es una lectura de la FIE: sirve
 * para ejercitar el tope por lectura y la continuación, que ninguna prueba real
 * alcanza.
 */
const TOTAL = 2600;
const paginasTotales = Math.ceil(TOTAL / TAMANO_PAGINA_RANKING);

function fuenteSintetica(
  opciones: { fallos?: Record<number, string>; total?: number } = {},
): DepsLecturaFie & { pedidas: number[] } {
  const total = opciones.total ?? TOTAL;
  const pedidas: number[] = [];
  return {
    pedidas,
    async fetchJson(url) {
      const pagina = Number(new URL(url).searchParams.get('page'));
      pedidas.push(pagina);
      const fallo = opciones.fallos?.[pagina];
      if (fallo) throw new Error(fallo);
      const desde = (pagina - 1) * TAMANO_PAGINA_RANKING;
      const items = Array.from(
        { length: Math.max(0, Math.min(TAMANO_PAGINA_RANKING, total - desde)) },
        (_, i) => ({
          rank: desde + i + 1,
          points: null,
          fencer: { id: 10_000 + desde + i, name: `PRUEBA ${desde + i}`, countryCode: 'ESP', gender: 'F' },
        }),
      );
      return { totalFound: total, page: pagina, pageSize: TAMANO_PAGINA_RANKING, items };
    },
  };
}

describe('continuación del ranking FIE por checkpoint (VAL-BACKFILL-002)', () => {
  it('al agotar el tope de 100 páginas queda parcial y apunta a la 101, no a la 1', async () => {
    const deps = fuenteSintetica();
    const parte = await leerRanking(2027, 99, deps);
    expect(MAX_PAGINAS).toBe(100);
    expect(parte.paginasLeidas).toBe(100);
    expect(parte.paginaDesde).toBe(1);
    expect(parte.siguientePagina).toBe(101);
    expect(parte.puestos).toHaveLength(100 * TAMANO_PAGINA_RANKING);
    expect(parte.cobertura).toMatchObject({ estado: 'parcial', publicado: TOTAL });
    expect(parte.cobertura.error).toMatch(/101/);
  });

  it('la segunda lectura arranca en la 101 y termina sin rehacer las 100 primeras', async () => {
    const primera = await leerRanking(2027, 99, fuenteSintetica());
    const deps = fuenteSintetica();
    const segunda = await leerRanking(2027, 99, deps, { desdePagina: primera.siguientePagina! });
    expect(deps.pedidas[0]).toBe(101);
    expect(deps.pedidas.at(-1)).toBe(paginasTotales);
    expect(segunda.paginaDesde).toBe(101);
    expect(segunda.siguientePagina).toBeNull();
    const ids = new Set([...primera.puestos, ...segunda.puestos].map((p) => p.fieId));
    expect(ids.size).toBe(TOTAL);
  });

  it('un fallo en una página conserva lo leído y el siguiente intento reintenta ESA página', async () => {
    const deps = fuenteSintetica({ fallos: { 7: 'HTTP 503 al pedir la página 7' } });
    const parte = await leerRanking(2027, 99, deps);
    expect(parte.puestos).toHaveLength(6 * TAMANO_PAGINA_RANKING);
    expect(parte.siguientePagina).toBe(7);
    expect(parte.cobertura.estado).toBe('parcial');
    expect(parte.cobertura.error).toMatch(/503/);

    const reintento = fuenteSintetica();
    const siguiente = await leerRanking(2027, 99, reintento, { desdePagina: parte.siguientePagina!, maxPaginas: 3 });
    expect(reintento.pedidas).toEqual([7, 8, 9]);
    expect(siguiente.siguientePagina).toBe(10);
  });

  it('un 429 en la primera página de una continuación es error y mantiene el punto de reanudación', async () => {
    const deps = fuenteSintetica({ fallos: { 101: 'HTTP 429 al pedir la página 101' } });
    const parte = await leerRanking(2027, 99, deps, { desdePagina: 101 });
    expect(parte.puestos).toEqual([]);
    expect(parte.cobertura).toMatchObject({ estado: 'error', publicado: null, importado: 0 });
    expect(parte.siguientePagina).toBe(101);
  });

  it('una prueba que cabe en una lectura termina con siguientePagina nula (no marca más trabajo)', async () => {
    const parte = await leerRanking(2027, 99, fuenteSintetica({ total: 50 }));
    expect(parte.siguientePagina).toBeNull();
    expect(parte.cobertura).toMatchObject({ estado: 'completo', publicado: 50, importado: 50 });
  });

  it('si el total publicado cambia a mitad, no se continúa: hay que releer desde el principio', async () => {
    let n = 0;
    const deps: DepsLecturaFie = {
      async fetchJson(url) {
        const pagina = Number(new URL(url).searchParams.get('page'));
        n += 1;
        return {
          totalFound: n === 1 ? 100 : 120,
          page: pagina,
          pageSize: 24,
          items: Array.from({ length: 24 }, (_, i) => ({
            rank: (pagina - 1) * 24 + i + 1,
            fencer: { id: (pagina - 1) * 24 + i + 1, name: 'X', countryCode: 'ESP', gender: 'F' },
          })),
        };
      },
    };
    const parte = await leerRanking(2027, 99, deps);
    expect(parte.siguientePagina).toBeNull();
    expect(parte.cobertura.estado).toBe('parcial');
    expect(parte.cobertura.error).toMatch(/total publicado cambió/);
  });

  it('la lectura de la prueba pasa la continuación al ranking y puede omitir poules/cuadro ya leídos', async () => {
    const pedidas: string[] = [];
    const deps: DepsLecturaFie = {
      async fetchJson(url) {
        pedidas.push(url);
        if (url.endsWith('/competition/2027/99')) {
          return {
            competitionId: 99,
            season: 2027,
            name: 'Prueba sintética',
            type: 'I',
            category: 'S',
            weapon: 'F',
            gender: 'F',
            startDate: '2026-10-01',
            tournamentId: 5,
          };
        }
        return fuenteSintetica({ total: 60 }).fetchJson(url);
      },
    };
    const l = await leerPruebaFie(2027, 99, deps, { desdePagina: 3, omitirAsaltos: true });
    expect(l.ranking?.paginaDesde).toBe(3);
    expect(pedidas.some((u) => u.includes('page=1&'))).toBe(false);
    expect(pedidas.some((u) => /results\/(pools|tableau)/.test(u))).toBe(false);
    expect(l.poules).toBeNull();
    expect(l.cuadro).toBeNull();
    expect(pedidas).toContain(urlRanking(2027, 99, 3));
  });
});

describe('cursor de continuación FIE', () => {
  const cursor = { fuente: 'fie' as const, season: 2027, competitionId: 99, pageSize: 24, siguientePagina: 101, total: 2600 };

  it('persiste fuente, temporada, competitionId, tamaño de página, siguiente página y total', () => {
    const texto = codificarCursorFie(cursor);
    expect(decodificarCursorFie(texto)).toEqual({ v: 1, ...cursor });
  });

  it('sólo se reanuda con el mismo season/competitionId/pageSize; si no, empieza en la 1', () => {
    const texto = codificarCursorFie(cursor);
    expect(desdeCursorFie(texto, { season: 2027, competitionId: 99, pageSize: 24 })).toBe(101);
    expect(desdeCursorFie(texto, { season: 2026, competitionId: 99, pageSize: 24 })).toBe(1);
    expect(desdeCursorFie(texto, { season: 2027, competitionId: 100, pageSize: 24 })).toBe(1);
    expect(desdeCursorFie(texto, { season: 2027, competitionId: 99, pageSize: 100 })).toBe(1);
  });

  it('un cursor ausente, ajeno o corrupto no rompe: se lee desde la primera página', () => {
    for (const malo of [null, undefined, '', 'no_publicado', '{"v":2}', '{"v":1,"fuente":"fie"}', 'not json']) {
      expect(desdeCursorFie(malo, { season: 2027, competitionId: 99, pageSize: 24 })).toBe(1);
    }
  });
});
