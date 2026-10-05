/**
 * Descarga de la Wayback Machine los ficheros de la web antigua de la RFEE
 * (www.esgrima.es, 2008-2014): los archivos Engarde `calendario/<id>.zip|.rar`
 * y las fichas `ampliar_calendario.asp?idc=..&id=..` que los enlazan (título,
 * fechas, sede). Una petición cada ≥1,5 s, caché reanudable en disco.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/rfee-wayback-descargar.ts \
 *     [--salida <calendario-trabajo/rfee-wayback>] [--solo archivos|fichas] [--limite N]
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { argumento, CARPETA_TRABAJO } from './comun';

export const CARPETA_RFEE_WAYBACK = join(CARPETA_TRABAJO, 'rfee-wayback');

const CDX = 'https://web.archive.org/cdx/search/cdx';
const PAUSA_MS = 1600;

/** Fila de la CDX: [urlkey, timestamp, original, mimetype, statuscode, digest, length]. */
export type FilaCdx = [string, string, string, string, string, string, string];

export type Captura = { clave: string; timestamp: string; original: string; fichero: string };

/** Fichero local de una captura: `calendario/655.zip` → `655.zip`; ficha `idc=1&id=147` → `ficha-1-147.html`. */
export function ficheroDeCaptura(original: string): string | null {
  const a = original.match(/\/calendario\/(\d+)\.(zip|rar)$/i);
  if (a) return `${a[1]}.${a[2].toLowerCase()}`;
  const u = original.replace(/^https?:\/\/[^/]+/i, '');
  if (!/^\/ampliar_calendario\.asp\?/i.test(u)) return null;
  const idc = u.match(/[?&]idc=(\d+)/i)?.[1];
  const id = u.match(/[?&]id=(\d+)/i)?.[1];
  return idc && id ? `ficha-${idc}-${id}.html` : null;
}

export function capturasDeCdx(filas: readonly FilaCdx[]): Captura[] {
  const porFichero = new Map<string, Captura>();
  for (const f of filas) {
    if (f[4] !== '200') continue;
    const fichero = ficheroDeCaptura(f[2]);
    if (!fichero) continue;
    // Varias capturas de la misma ficha: la más reciente trae más enlaces (resultados subidos después).
    const previa = porFichero.get(fichero);
    if (!previa || previa.timestamp < f[1]) porFichero.set(fichero, { clave: f[0], timestamp: f[1], original: f[2], fichero });
  }
  return [...porFichero.values()].sort((a, b) => (a.fichero < b.fichero ? -1 : 1));
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
let ultima = 0;

async function pedir(url: string, intentos = 5): Promise<Buffer> {
  let error: unknown = null;
  for (let i = 0; i < intentos; i += 1) {
    const espera = ultima + PAUSA_MS * (i === 0 ? 1 : 2 ** i) - Date.now();
    if (espera > 0) await dormir(espera);
    ultima = Date.now();
    try {
      const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000), headers: { 'user-agent': 'calendario-esgrima-indexado/1.0 (archivo historico)' } });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      error = new Error(`HTTP ${r.status}`);
      if (r.status === 404 || r.status === 403) break;
    } catch (e) {
      error = e;
    }
  }
  throw error instanceof Error ? error : new Error(String(error));
}

async function listar(destino: string, url: string): Promise<FilaCdx[]> {
  if (!existsSync(destino)) {
    const q = `${CDX}?url=${encodeURIComponent(url)}&matchType=prefix&collapse=urlkey&filter=statuscode:200&output=json`;
    writeFileSync(destino, await pedir(q));
  }
  return (JSON.parse(readFileSync(destino, 'utf8')) as FilaCdx[]).slice(1);
}

export type Manifiesto = Record<string, { original: string; timestamp: string; bytes: number | null; error: string | null }>;

async function main(): Promise<void> {
  const salida = argumento('salida', CARPETA_RFEE_WAYBACK);
  const solo = argumento('solo', '');
  const limite = Number(argumento('limite', '0')) || Infinity;
  const raw = join(salida, 'raw');
  mkdirSync(raw, { recursive: true });
  const filas = [
    ...(solo === 'fichas' ? [] : await listar(join(salida, 'cdx-calendario.json'), 'www.esgrima.es/calendario/')),
    ...(solo === 'archivos' ? [] : await listar(join(salida, 'cdx-ampliar.json'), 'www.esgrima.es/ampliar_calendario.asp')),
  ];
  const capturas = capturasDeCdx(filas);
  const rutaManifiesto = join(salida, 'manifiesto.json');
  const manifiesto: Manifiesto = existsSync(rutaManifiesto) ? JSON.parse(readFileSync(rutaManifiesto, 'utf8')) : {};
  let hechas = 0;
  for (const c of capturas) {
    const destino = join(raw, c.fichero);
    if (existsSync(destino)) {
      manifiesto[c.fichero] ??= { original: c.original, timestamp: c.timestamp, bytes: readFileSync(destino).length, error: null };
      continue;
    }
    if (manifiesto[c.fichero]?.error?.startsWith('HTTP 404')) continue;
    if (hechas >= limite) break;
    hechas += 1;
    try {
      const datos = await pedir(`https://web.archive.org/web/${c.timestamp}id_/${c.original}`);
      writeFileSync(`${destino}.part`, datos);
      renameSync(`${destino}.part`, destino);
      manifiesto[c.fichero] = { original: c.original, timestamp: c.timestamp, bytes: datos.length, error: null };
      console.log(`${c.fichero} ${datos.length}`);
    } catch (e) {
      manifiesto[c.fichero] = { original: c.original, timestamp: c.timestamp, bytes: null, error: (e as Error).message };
      console.log(`${c.fichero} ERROR ${(e as Error).message}`);
    }
    if (hechas % 10 === 0) writeFileSync(rutaManifiesto, JSON.stringify(manifiesto, null, 2));
  }
  writeFileSync(rutaManifiesto, JSON.stringify(manifiesto, null, 2));
  const errores = Object.values(manifiesto).filter((m) => m.error).length;
  console.log(`capturas ${capturas.length}, en manifiesto ${Object.keys(manifiesto).length}, errores ${errores}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
