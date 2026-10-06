/**
 * Índice de resultados de Skermo (RFEE) por temporada, con los documentos y
 * directos que publica cada fila. Deja `indice.json` en la caché del lote 7.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-skermo-indice.ts [--sin-red]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseSkermoResultsIndex, parseSkermoSeasons, skermoResultsUrl, type SkermoResultsIndexRow } from '../../src/lib/ingest/sources/skermo-results';
import { bandera } from './comun';
import { CACHE_LOTE7_SKERMO, obtener, textoDe } from './lote7-skermo-comun';

export type FilaIndice = SkermoResultsIndexRow & { seasonValue: string; seasonLabel: string };

export async function leerIndiceSkermo(opciones: { sinRed?: boolean; desde?: number } = {}): Promise<FilaIndice[]> {
  const portada = await obtener(skermoResultsUrl('RFEE'), { sub: 'indice', sinRed: opciones.sinRed });
  if (!portada.bytes) throw new Error(`Índice de Skermo no disponible (${portada.status})`);
  const temporadas = parseSkermoSeasons(textoDe(portada.bytes)).filter((t) => {
    const anio = Number(t.label.slice(0, 4));
    return Number.isFinite(anio) && anio >= (opciones.desde ?? 2021);
  });
  const filas: FilaIndice[] = [];
  for (const t of temporadas) {
    const d = await obtener(skermoResultsUrl('RFEE', { season: t.value }), { sub: 'indice', sinRed: opciones.sinRed });
    if (!d.bytes) {
      console.log(`temporada ${t.label}: HTTP ${d.status}`);
      continue;
    }
    const { rows, mismatches } = parseSkermoResultsIndex(textoDe(d.bytes), { federationCode: 'RFEE' });
    if (mismatches > 0) console.log(`temporada ${t.label}: ${mismatches} filas con columnas descuadradas`);
    for (const r of rows) filas.push({ ...r, seasonValue: t.value, seasonLabel: t.label });
  }
  return filas;
}

async function main() {
  const filas = await leerIndiceSkermo({ sinRed: bandera('sin-red') });
  mkdirSync(CACHE_LOTE7_SKERMO, { recursive: true });
  writeFileSync(join(CACHE_LOTE7_SKERMO, 'indice.json'), JSON.stringify(filas, null, 1));
  const porTemp = new Map<string, { filas: number; docs: number; directos: number; externos: number }>();
  for (const f of filas) {
    const t = porTemp.get(f.seasonLabel) ?? { filas: 0, docs: 0, directos: 0, externos: 0 };
    t.filas += 1;
    if (f.documents.length) t.docs += 1;
    if (f.liveLinks.length) t.directos += 1;
    if (f.externalUrls.length) t.externos += 1;
    porTemp.set(f.seasonLabel, t);
  }
  console.table(Object.fromEntries(porTemp));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
