/**
 * Inventario nacional RFEE (Skermo) para la caché de PDF/HTML y las descargas Engarde.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/inventario-nacional.ts \
 *     [--salida <qa-prod-calendario/history-national/national-inventory.json>] [--desde 2018-2019] [--pausa-ms 2500]
 *
 * Sólo GET públicos del índice de resultados, uno cada vez y con pausa. Escribe:
 *  - `ownRfeeCatalog`: índice propio de la RFEE (sin `owa=1`), que alimenta la caché nacional;
 *  - `catalog`: el mismo índice con `owa=1` (incluye pruebas de otras webs);
 *  - `readingUnits` / `ownRfeeReadingUnits`: unidades de lectura derivadas de cada catálogo;
 *  - `publishedSeasons`: el selector de temporadas publicado.
 */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fetchText } from '../../src/lib/ingest/fetcher';
import { unidadesDesdeCatalogo } from '../../src/lib/ingest/backfill/inventario-unidades';
import { inventariarSkermo, type ResultadoInventario } from '../../src/lib/ingest/sources/historico-indice';
import { parseSkermoResultsIndex, parseSkermoSeasons, skermoResultsUrl, type SkermoSeasonOption } from '../../src/lib/ingest/sources/skermo-results';
import { argumento, CARPETA_CACHES } from './comun';

async function leer(includePrevious: boolean, desde: string, pausaMs: number, temporadas: SkermoSeasonOption[]) {
  const r: ResultadoInventario = await inventariarSkermo(
    {
      indice: async (federacion, temporadaId) =>
        (await fetchText(skermoResultsUrl(federacion, { includePrevious, ...(temporadaId ? { season: temporadaId } : {}) }), {
          timeoutMs: 120_000,
          retries: 0,
        })).body,
      temporadas: (html) => {
        const t = parseSkermoSeasons(html);
        if (!temporadas.length) temporadas.push(...t);
        return t;
      },
      parsear: (html, federacion) => parseSkermoResultsIndex(html, { federationCode: federacion }),
    },
    [{ codigo: 'RFEE', verificada: true }],
    { delayMs: pausaMs, desde },
  );
  const fallidas = r.unidades.filter((u) => u.estado !== 'leido' && u.estado !== 'sin_filas');
  if (r.tecnico || fallidas.length) {
    throw new Error(`Índice incompleto (owa=${includePrevious ? 1 : 0}): ${fallidas.map((u) => `${u.temporada || '*'}:${u.estado}:${u.error ?? ''}`).join(', ')}`);
  }
  return r;
}

async function main() {
  const salida = resolve(argumento('salida', join(CARPETA_CACHES, 'history-national', 'national-inventory.json')));
  const desde = argumento('desde', '2018-2019');
  const pausaMs = Number(argumento('pausa-ms', '2500'));
  const temporadas: SkermoSeasonOption[] = [];
  const propio = await leer(false, desde, pausaMs, temporadas);
  await new Promise((r) => setTimeout(r, pausaMs));
  const completo = await leer(true, desde, pausaMs, []);
  const inventario = {
    generadoEn: new Date().toISOString(),
    desde,
    publishedSeasons: temporadas.map((t) => ({ label: t.label, value: t.value })),
    seasonUnits: propio.unidades,
    ownRfeeCatalog: propio.catalogo,
    catalog: completo.catalogo,
    readingUnits: unidadesDesdeCatalogo(completo.catalogo),
    ownRfeeReadingUnits: unidadesDesdeCatalogo(propio.catalogo),
  };
  mkdirSync(dirname(salida), { recursive: true });
  const tmp = `${salida}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(inventario, null, 1), 'utf8');
  renameSync(tmp, salida);
  const enlaces = (c: typeof propio.catalogo, tipo: string) => new Set(c.flatMap((f) => f.enlaces.filter((e) => e.tipo === tipo).map((e) => e.url))).size;
  console.log(JSON.stringify({
    salida,
    peticiones: propio.peticiones + completo.peticiones,
    temporadas: propio.unidades.map((u) => `${u.temporada}:${u.filas}`),
    ownRfeeCatalog: propio.catalogo.length,
    catalog: completo.catalogo.length,
    ownPdf: enlaces(propio.catalogo, 'pdf'),
    ownHtml: enlaces(propio.catalogo, 'html'),
    ownExterno: enlaces(propio.catalogo, 'externo'),
  }, null, 1));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
