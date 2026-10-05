/**
 * Descarga de la Wayback Machine las clasificaciones PDF de la temporada
 * 2017-18 que la web antigua de la RFEE (www.esgrima.es, antes de la migración
 * a WordPress de 2018-19) enlazaba desde `resultados.html` como
 * `./pdfs/calendario/<fichero>.pdf`. Skermo no publica esa temporada (su
 * índice de resultados de 2017-18 está vacío), así que es la única copia
 * oficial de las pruebas que no llegaron por Engarde.
 *
 * Sólo se descargan capturas con estado 200: tras la migración la ruta
 * responde 301/404 y la mayoría de PDFs nunca se archivaron.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/rfee-huecos-descargar.ts \
 *     [--salida <calendario-trabajo/rfee-huecos>] [--captura 20180915095710] [--limite N]
 *
 * Escribe `<salida>/raw/` (página, CDX y PDFs) y `<salida>/manifiesto.json`.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { argumento, CARPETA_TRABAJO } from './comun';

export const CARPETA_RFEE_HUECOS = join(CARPETA_TRABAJO, 'rfee-huecos');

const CDX = 'https://web.archive.org/cdx/search/cdx';
/** Última captura de `resultados.html` con la temporada 17/18 completa (la web se migró en otoño de 2018). */
const CAPTURA_RESULTADOS = '20180915095710';
const PAUSA_MS = 1600;
const AGENTE = 'calendario-esgrima-indexado/1.0 (archivo historico)';

export type FilaResultados = {
  nombre: string;
  sede: string;
  inicio: string;
  fin: string;
  arma: string;
  categoria: string;
  sexo: string;
  modalidad: string;
  tipo: string;
  enlace: string;
};

/** Temporada RFEE (1 sep - 31 ago) de una fecha ISO. */
export function temporadaDe(fecha: string): string {
  const anio = Number(fecha.slice(0, 4));
  const mes = Number(fecha.slice(5, 7));
  const inicio = mes >= 9 ? anio : anio - 1;
  return `${inicio}-${inicio + 1}`;
}

const textoCelda = (html: string): string =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

function fechaIso(texto: string): string | null {
  const m = texto.replace(/\s/g, '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

/**
 * Filas de la tabla de resultados: nombre, sede, inicio, fin, arma, categoría,
 * sexo, modalidad, tipo y enlace. Las filas antiguas (≤ nov. 2017) dejan
 * vacías las columnas de categoría en adelante; el enlace es siempre el último.
 */
export function filasResultados(html: string): FilaResultados[] {
  const filas: FilaResultados[] = [];
  for (const tr of html.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
    const enlaces = [...tr[0].matchAll(/href="([^"]*pdfs\/calendario\/[^"]+)"/gi)].map((m) => m[1]);
    if (enlaces.length === 0) continue;
    const celdas = [...tr[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td\s*>/gi)].map((m) => textoCelda(m[1]));
    const inicio = fechaIso(celdas[2] ?? '');
    if (!inicio) continue;
    for (const enlace of new Set(enlaces)) {
      filas.push({
        nombre: celdas[0] ?? '',
        sede: celdas[1] ?? '',
        inicio,
        fin: fechaIso(celdas[3] ?? '') ?? inicio,
        arma: celdas[4] ?? '',
        categoria: celdas[5] ?? '',
        sexo: celdas[6] ?? '',
        modalidad: celdas[7] ?? '',
        tipo: celdas[8] ?? '',
        enlace,
      });
    }
  }
  // La página repite la tabla (versión de escritorio y versión móvil, ésta sin las columnas de detalle).
  const rellenas = (f: FilaResultados) => Object.values(f).filter((v) => v !== '').length;
  const unicas = new Map<string, FilaResultados>();
  for (const f of filas) {
    const k = [f.inicio, f.nombre, f.sede, f.enlace].join('|');
    const previa = unicas.get(k);
    if (!previa || rellenas(f) > rellenas(previa)) unicas.set(k, f);
  }
  return [...unicas.values()];
}

function decodificar(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    // Algunas capturas codifican la ñ en latin1 (%F1), que decodeURIComponent rechaza.
    return unescape(s);
  }
}

/** Clave de fichero comparable entre el enlace de la página y la URL archivada (mayúsculas y codificación varían). */
export function claveFichero(url: string): string {
  return decodificar(url.replace(/^.*\/pdfs\/calendario\//i, '').replace(/[?#].*$/, ''))
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fila de la CDX: [urlkey, timestamp, original, mimetype, statuscode, digest, length]. */
export type FilaCdx = [string, string, string, string, string, string, string];
export type Captura = { timestamp: string; original: string; mimetype: string };

/** Por clave de fichero, la captura 200 más reciente que sea un PDF. */
export function capturasPdf(filas: readonly FilaCdx[]): Map<string, Captura> {
  const porClave = new Map<string, Captura>();
  for (const f of filas) {
    if (f[4] !== '200' || !/pdf/i.test(f[3])) continue;
    const clave = claveFichero(f[2]);
    const previa = porClave.get(clave);
    if (!previa || previa.timestamp < f[1]) porClave.set(clave, { timestamp: f[1], original: f[2], mimetype: f[3] });
  }
  return porClave;
}

export const urlCaptura = (c: Captura): string => `https://web.archive.org/web/${c.timestamp}id_/${c.original}`;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
let ultima = 0;

async function pedir(url: string, intentos = 5): Promise<Buffer> {
  let error: unknown = null;
  for (let i = 0; i < intentos; i += 1) {
    const espera = ultima + PAUSA_MS * (i === 0 ? 1 : 2 ** i) - Date.now();
    if (espera > 0) await dormir(espera);
    ultima = Date.now();
    try {
      const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000), headers: { 'user-agent': AGENTE } });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      error = new Error(`HTTP ${r.status}`);
      if (r.status === 404 || r.status === 403) break;
    } catch (e) {
      error = e;
    }
  }
  throw error instanceof Error ? error : new Error(String(error));
}

async function enCache(destino: string, url: string): Promise<Buffer> {
  if (!existsSync(destino)) {
    const datos = await pedir(url);
    writeFileSync(`${destino}.part`, datos);
    renameSync(`${destino}.part`, destino);
  }
  return readFileSync(destino);
}

export type EntradaManifiesto = FilaResultados & {
  temporada: string;
  clave: string;
  captura: Captura | null;
  url: string | null;
  fichero: string | null;
  bytes: number | null;
  sha256: string | null;
  error: string | null;
};

export type ManifiestoHuecos = {
  generadoEn: string;
  paginaResultados: string;
  entradas: EntradaManifiesto[];
};

/** Nombre local estable y ASCII: los originales traen espacios, ñ y mayúsculas mezcladas. */
export function ficheroLocal(clave: string): string {
  const base = clave
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.pdf$/i, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return `${base}-${createHash('sha256').update(clave).digest('hex').slice(0, 8)}.pdf`;
}

async function main(): Promise<void> {
  const salida = argumento('salida', CARPETA_RFEE_HUECOS);
  const captura = argumento('captura', CAPTURA_RESULTADOS);
  const limite = Number(argumento('limite', '0')) || Infinity;
  const raw = join(salida, 'raw');
  const dirPdfs = join(raw, 'pdfs');
  mkdirSync(dirPdfs, { recursive: true });

  const paginaUrl = `https://web.archive.org/web/${captura}id_/http://www.esgrima.es/resultados.html`;
  const html = (await enCache(join(raw, `resultados-${captura}.html`), paginaUrl)).toString('latin1');
  const filas = filasResultados(html).filter((f) => temporadaDe(f.inicio) === '2017-2018');

  const cdxUrl = `${CDX}?url=${encodeURIComponent('esgrima.es/pdfs/calendario/')}&matchType=prefix&output=json`;
  const cdx = (JSON.parse((await enCache(join(raw, 'cdx-pdfs-calendario.json'), cdxUrl)).toString('utf8')) as FilaCdx[]).slice(1);
  const capturas = capturasPdf(cdx);

  const rutaManifiesto = join(salida, 'manifiesto.json');
  const previo: ManifiestoHuecos | null = existsSync(rutaManifiesto) ? JSON.parse(readFileSync(rutaManifiesto, 'utf8')) : null;
  const errorPrevio = new Map((previo?.entradas ?? []).filter((e) => e.error).map((e) => [e.clave, e.error]));
  const descargados = new Map<string, { fichero: string; bytes: number; sha256: string } | { error: string }>();
  const entradas: EntradaManifiesto[] = [];
  let hechas = 0;
  for (const f of filas) {
    const clave = claveFichero(f.enlace);
    const c = capturas.get(clave) ?? null;
    const base: EntradaManifiesto = {
      ...f, temporada: temporadaDe(f.inicio), clave, captura: c, url: c ? urlCaptura(c) : null,
      fichero: null, bytes: null, sha256: null, error: c ? null : 'sin_captura_200',
    };
    entradas.push(base);
    if (!c) continue;
    let r = descargados.get(clave);
    if (!r) {
      const fichero = ficheroLocal(clave);
      const destino = join(dirPdfs, fichero);
      if (!existsSync(destino) && errorPrevio.get(clave)?.startsWith('HTTP 404')) r = { error: errorPrevio.get(clave)! };
      else if (!existsSync(destino) && hechas >= limite) r = { error: 'pendiente_limite' };
      else {
        try {
          if (!existsSync(destino)) hechas += 1;
          const datos = await enCache(destino, base.url!);
          if (datos.subarray(0, 5).toString('latin1') !== '%PDF-') r = { error: 'no_es_pdf' };
          else r = { fichero, bytes: datos.length, sha256: createHash('sha256').update(datos).digest('hex') };
        } catch (e) {
          r = { error: (e as Error).message };
        }
      }
      descargados.set(clave, r);
      console.log(`${clave} ${'error' in r ? `ERROR ${r.error}` : r.bytes}`);
    }
    Object.assign(base, 'error' in r ? { error: r.error } : { ...r, error: null });
  }
  const manifiesto: ManifiestoHuecos = { generadoEn: new Date().toISOString(), paginaResultados: paginaUrl, entradas };
  writeFileSync(`${rutaManifiesto}.part`, JSON.stringify(manifiesto, null, 1));
  renameSync(`${rutaManifiesto}.part`, rutaManifiesto);
  const conPdf = new Set(entradas.filter((e) => e.fichero).map((e) => e.clave)).size;
  const unicos = new Set(entradas.map((e) => e.clave)).size;
  console.log(`filas 2017-18 ${entradas.length}, ficheros ${unicos}, con PDF archivado ${conPdf}, sin captura ${unicos - conPdf}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
