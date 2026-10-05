/**
 * Descarga de la Wayback Machine las exportaciones HTML de Engarde que
 * publicaron esgrimacyl.es (`/resultados/`, 2013-2018) y fecv.es
 * (`/esgrima/resultado/`, 2009-2011).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/wayback-engarde-descargar.ts \
 *     [--salida <calendario-trabajo/engarde-historico/wayback>] [--pausa-ms 1200]
 *
 * Se enumera con la API CDX (sólo capturas 200, una por URL) y se pide cada
 * captura con `id_` (el fichero original, sin la barra de la Wayback). Una
 * petición cada vez, ≥1 s entre peticiones, reintentos espaciados ante 5xx.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { argumento } from './comun';
import { CacheEngarde } from './engarde-descargar';
import { CARPETA_ENGARDE_HISTORICO, ClienteBytes } from './engarde-historico-descargar';

export const PREFIJOS_WAYBACK = [
  { sitio: 'esgrimacyl', prefijo: 'esgrimacyl.es/resultados/' },
  { sitio: 'fecv', prefijo: 'fecv.es/esgrima/resultado/' },
] as const;

export type Captura = { sitio: string; timestamp: string; original: string; ruta: string };

/** Ruta relativa al prefijo (sin host ni puerto), o `null` si la URL no cuelga de él. */
export function rutaBajoPrefijo(original: string, prefijo: string): string | null {
  const sinEsquema = original.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/:80(?=\/)/, '');
  if (!sinEsquema.toLowerCase().startsWith(prefijo.toLowerCase())) return null;
  return sinEsquema.slice(prefijo.length);
}

const NO_DOCUMENTO = /^(index|indice|header|cible|menu|competiciones\d*|resultados)\.html?$/i;

/** Capturas de documentos HTML de una prueba (descarta portadas, marcos, CSS, PDF y comprimidos). */
export function capturasDeDocumentos(sitio: string, prefijo: string, filas: string[][]): Captura[] {
  const out: Captura[] = [];
  for (const f of filas) {
    const [, timestamp, original] = f;
    const ruta = rutaBajoPrefijo(original, prefijo);
    if (!ruta || !ruta.includes('/')) continue;
    const fichero = decodeURIComponent(ruta.split('/').pop() ?? '');
    if (!/\.html?$/i.test(fichero) || NO_DOCUMENTO.test(fichero)) continue;
    if (/^(tireurs?|formule)\.htm/i.test(fichero)) continue;
    out.push({ sitio, timestamp, original, ruta });
  }
  return out;
}

export function claveWayback(sitio: string, ruta: string): string {
  return ['_wayback', sitio, ...decodeURIComponent(ruta).split('/').map((s) => s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 100))].join('/');
}

async function main(): Promise<void> {
  const salida = argumento('salida', join(CARPETA_ENGARDE_HISTORICO, 'wayback'));
  const cache = new CacheEngarde(salida);
  const cliente = new ClienteBytes(Math.max(1000, Number(argumento('pausa-ms', '1200'))), 100_000, 4);
  const informe: Record<string, { capturas: number; documentos: number; descargados: number; fallos: number }> = {};
  for (const { sitio, prefijo } of PREFIJOS_WAYBACK) {
    const claveCdx = `_wayback/${sitio}/_cdx.json`;
    let cdx = cache.leer(claveCdx);
    if (cdx === null) {
      const url = `https://web.archive.org/cdx/search/cdx?url=${prefijo}&matchType=prefix&collapse=urlkey&filter=statuscode:200&output=json`;
      const r = await cliente.pedir(url);
      cache.guardar(claveCdx, url, r.status, r.body);
      cdx = r.status === 200 ? r.body : null;
    }
    const filas = cdx ? (JSON.parse(cdx) as string[][]).slice(1) : [];
    const docs = capturasDeDocumentos(sitio, prefijo, filas);
    const inf = (informe[sitio] = { capturas: filas.length, documentos: docs.length, descargados: 0, fallos: 0 });
    for (const d of docs) {
      const clave = claveWayback(sitio, d.ruta);
      const previo = cache.obtener(clave);
      if (previo && (previo.status === 200 || previo.status === 404)) {
        inf.descargados += 1;
        continue;
      }
      const url = `https://web.archive.org/web/${d.timestamp}id_/${d.original}`;
      try {
        const r = await cliente.pedir(url);
        cache.guardar(clave, url, r.status, r.body);
        if (r.status === 200) inf.descargados += 1;
        else inf.fallos += 1;
      } catch {
        inf.fallos += 1;
      }
    }
    console.log(sitio, JSON.stringify(inf));
  }
  writeFileSync(join(salida, '_descarga-informe.json'), JSON.stringify({ generado: new Date().toISOString(), informe, peticiones: cliente.peticiones }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
