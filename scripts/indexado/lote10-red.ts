/**
 * Red y rutas del lote 10 (más datos de la RFEE y rankings nacionales): caché en
 * `calendario-trabajo/cache-lote10-rfee` (techo de 1 GB que aplica `Red`), User-Agent de
 * `INGEST_USER_AGENT`, como mucho 2 peticiones en vuelo por anfitrión y ≥600 ms entre dos al
 * mismo anfitrión (1,5 s en archive.org).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote10-red.ts [--sub sondas] <url>...   (sonda: estado, tamaño y texto)
 */
import 'dotenv/config';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractText, getDocumentProxy } from 'unpdf';
import { argumento, CARPETA_TRABAJO } from './comun';
import { Red } from './lote7-faltan-red';

export const CACHE_LOTE10 = process.env.CACHE_LOTE10 ?? join(CARPETA_TRABAJO, 'cache-lote10-rfee');
export const HECHOS_LOTE10 = (fuente: string) => join(CARPETA_TRABAJO, 'hechos', `lote10-rfee-${fuente}`);
export const NUEVO9 = join(CARPETA_TRABAJO, 'nuevo9.sqlite');

/** Una `Red` por familia de anfitriones, cada una con su subcarpeta de caché. */
export function redLote10(sub: string, pausaMs = 600): Red {
  return new Red(join(CACHE_LOTE10, sub), sub === 'wayback' ? Math.max(pausaMs, 1500) : pausaMs, 2);
}

export async function textoPdf(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return Array.isArray(text) ? text : [text];
}

async function main(): Promise<void> {
  const sub = argumento('sub', 'sondas');
  const largo = Number(argumento('largo', '600'));
  const urls = process.argv.slice(2).filter((a, i, xs) => !a.startsWith('--') && xs[i - 1] !== '--sub' && xs[i - 1] !== '--largo');
  const red = redLote10(sub);
  for (const url of urls) {
    try {
      const r = await red.get(url, { reintentos: 2 });
      if (r.status === 200 && r.body.subarray(0, 4).toString('latin1') === '%PDF') {
        const paginas = await textoPdf(r.body);
        console.log(JSON.stringify({ url, status: r.status, bytes: r.body.length, paginas: paginas.length, ruta: r.ruta }));
        console.log(paginas.join('\n---\n').slice(0, largo));
        continue;
      }
      const texto = r.body.toString('utf8');
      console.log(JSON.stringify({
        url, status: r.status, bytes: r.body.length, cache: r.desdeCache, ruta: r.ruta,
        inicio: texto.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, largo),
      }));
    } catch (e) {
      console.log(JSON.stringify({ url, error: String(e) }));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
