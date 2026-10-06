/**
 * Enumera en la Wayback Machine los PDF que esgrima.es publicó bajo `/pdfs/` y descarga
 * (con caché en `cache-lote7-pdf/wayback`) los que se piden por patrón.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-pdf-wayback.ts --cdx [--desde 2017 --hasta 2019]
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-pdf-wayback.ts --bajar "<regex sobre la URL original>"
 *
 * Una petición cada vez, ≥1 s entre peticiones, User-Agent `INGEST_USER_AGENT`. Cada captura se
 * pide con `id_` (el fichero original). El índice queda en `wayback/cdx-pdfs.json` y cada PDF en
 * `wayback/<sha256>.pdf` con su registro en `wayback/_registro.json`.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { argumento, bandera } from './comun';
import { CACHE_LOTE7_PDF, ClienteEducado } from './lote7-pdf-comun';

export const CARPETA_WAYBACK = join(CACHE_LOTE7_PDF, 'wayback');

export type CapturaPdf = { timestamp: string; original: string; length: number; digest: string };
export type RegistroPdf = { original: string; timestamp: string; url: string; status: number; sha256: string | null; bytes: number };

/** Filas CDX (`output=json`, primera fila cabecera) → una captura 200 por URL original (la última). */
export function capturasPdf(filas: string[][]): CapturaPdf[] {
  const [cab, ...resto] = filas;
  if (!cab) return [];
  const i = (k: string) => cab.indexOf(k);
  const porUrl = new Map<string, CapturaPdf>();
  for (const f of resto) {
    if (f[i('statuscode')] !== '200') continue;
    const original = f[i('original')].replace(/:80(?=\/)/, '');
    if (!/\.pdf$/i.test(original.split('?')[0])) continue;
    const clave = decodificar(original.replace(/^https?:\/\/(www\.)?/i, '')).toLowerCase();
    const c = { timestamp: f[i('timestamp')], original, length: Number(f[i('length')] ?? 0), digest: f[i('digest')] };
    const previa = porUrl.get(clave);
    if (!previa || previa.timestamp < c.timestamp) porUrl.set(clave, c);
  }
  return [...porUrl.values()].sort((a, b) => (a.original < b.original ? -1 : 1));
}

export function decodificar(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export const urlCaptura = (c: Pick<CapturaPdf, 'timestamp' | 'original'>) => `https://web.archive.org/web/${c.timestamp}id_/${c.original}`;

async function main(): Promise<void> {
  mkdirSync(CARPETA_WAYBACK, { recursive: true });
  const red = new ClienteEducado(Math.max(1000, Number(argumento('pausa-ms', '1200'))), Number(argumento('max', '400')));
  const rutaCdx = join(CARPETA_WAYBACK, 'cdx-pdfs.json');
  if (bandera('cdx') || !existsSync(rutaCdx)) {
    const desde = argumento('desde', '2016');
    const hasta = argumento('hasta', '2020');
    const url = `https://web.archive.org/cdx/search/cdx?url=esgrima.es/pdfs/&matchType=prefix&output=json&from=${desde}&to=${hasta}&filter=statuscode:200&fl=urlkey,timestamp,original,mimetype,statuscode,digest,length&limit=50000`;
    const r = await red.pedir(url);
    if (r.status !== 200) throw new Error(`CDX ${r.status}`);
    writeFileSync(join(CARPETA_WAYBACK, 'cdx-crudo.json'), r.bytes);
    const filas = JSON.parse(new TextDecoder().decode(r.bytes)) as string[][];
    const capturas = capturasPdf(filas);
    writeFileSync(rutaCdx, JSON.stringify(capturas, null, 1));
    console.log(`capturas PDF: ${capturas.length}`);
  }
  const patron = argumento('bajar', '');
  if (!patron) return;
  const re = new RegExp(patron, 'i');
  const capturas = JSON.parse(readFileSync(rutaCdx, 'utf8')) as CapturaPdf[];
  const rutaRegistro = join(CARPETA_WAYBACK, '_registro.json');
  const registro: Record<string, RegistroPdf> = existsSync(rutaRegistro) ? JSON.parse(readFileSync(rutaRegistro, 'utf8')) : {};
  for (const c of capturas.filter((x) => re.test(decodificar(x.original)))) {
    if (registro[c.original]?.status === 200) continue;
    const url = urlCaptura(c);
    const r = await red.pedir(url);
    let sha: string | null = null;
    if (r.status === 200 && r.bytes.length > 0) {
      sha = createHash('sha256').update(r.bytes).digest('hex');
      writeFileSync(join(CARPETA_WAYBACK, `${sha}.pdf`), r.bytes);
    }
    registro[c.original] = { original: c.original, timestamp: c.timestamp, url, status: r.status, sha256: sha, bytes: r.bytes.length };
    writeFileSync(rutaRegistro, JSON.stringify(registro, null, 1));
    console.log(`${r.status} ${r.bytes.length} ${decodificar(c.original)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
