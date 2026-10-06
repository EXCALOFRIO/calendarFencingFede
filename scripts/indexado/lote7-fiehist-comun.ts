import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CARPETA_TRABAJO } from './comun';

/**
 * Caché y red de los productores `lote7-fiehist-*` (pruebas FIE individuales
 * anteriores a la temporada 2017). Cada respuesta 200 se guarda tal cual bajo
 * `cache-lote7-fiehist/raw/` con su registro en `_registro.jsonl`; el paso a
 * hechos trabaja sólo con la caché y el SHA-256 de `sourceSha256` es el del
 * contenido leído.
 */

export const CACHE_LOTE7 = join(CARPETA_TRABAJO, 'cache-lote7-fiehist');
const RAW = join(CACHE_LOTE7, 'raw');
const REGISTRO = join(RAW, '_registro.jsonl');
export const SALIDA_LOTE7 = join(CARPETA_TRABAJO, 'hechos', 'lote7-fie-historico');
export const USER_AGENT = process.env.INGEST_USER_AGENT ||
  'CalendarioEsgrima/1.0 (+https://calendario-fie-fede.excalofrio.workers.dev)';
const LIMITE_BYTES = 1.5 * 1024 ** 3;

export const sha256 = (datos: Uint8Array | string): string => createHash('sha256').update(datos).digest('hex');

type Registro = { url: string; status: number; fichero: string | null; sha256: string | null; bytes: number; ts: string };

let registro: Map<string, Registro> | null = null;
let bytesCache = 0;
function cargarRegistro(): Map<string, Registro> {
  if (registro) return registro;
  registro = new Map();
  if (existsSync(REGISTRO)) {
    for (const l of readFileSync(REGISTRO, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try {
        const r = JSON.parse(l) as Registro;
        registro.set(r.url, r);
      } catch {
        /* línea truncada por una parada brusca */
      }
    }
  }
  for (const r of registro.values()) if (r.fichero) bytesCache += r.bytes;
  return registro;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ultimoPorHost = new Map<string, number>();
const intervalo = (host: string) => (host.endsWith('archive.org') ? 1500 : 600);

export type Documento = { url: string; status: number; bytes: Uint8Array | null; sha256: string | null };

function ficheroDe(url: string): string {
  const u = new URL(url);
  const h = sha256(url).slice(0, 24);
  return join(u.hostname.replace(/[^a-z0-9.-]+/gi, '_'), h.slice(0, 2), `${h}.bin`);
}

/**
 * Documento de la caché o de la red. 404/410 se registran y no se vuelven a pedir;
 * 429/5xx y fallos de red se reintentan con espera creciente. Las peticiones a un
 * mismo host van en serie con una pausa mínima.
 */
export async function obtener(url: string, opciones: { intentos?: number } = {}): Promise<Documento> {
  const reg = cargarRegistro();
  const previo = reg.get(url);
  if (previo && (previo.status === 200 || previo.status === 404 || previo.status === 410 || previo.status === 403)) {
    if (previo.fichero === null) return { url, status: previo.status, bytes: null, sha256: null };
    const bytes = new Uint8Array(readFileSync(join(RAW, previo.fichero)));
    return { url, status: previo.status, bytes, sha256: sha256(bytes) };
  }
  if (bytesCache > LIMITE_BYTES) throw new Error(`caché llena (${(bytesCache / 1024 ** 3).toFixed(2)} GB)`);
  const host = new URL(url).hostname;
  let espera = 5_000;
  const max = opciones.intentos ?? 5;
  for (let intento = 1; ; intento += 1) {
    for (;;) {
      const hueco = (ultimoPorHost.get(host) ?? 0) + intervalo(host) - Date.now();
      if (hueco <= 0) break;
      await dormir(hueco);
    }
    ultimoPorHost.set(host, Date.now());
    let res: Response;
    try {
      res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(90_000) });
    } catch (e) {
      if (intento >= max) return { url, status: -1, bytes: null, sha256: null };
      console.log(`  red fallida ${url} (${(e as Error).message}); espera ${espera / 1000}s`);
      await dormir(espera);
      espera = Math.min(espera * 2, 120_000);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      await res.body?.cancel();
      if (intento >= max) return { url, status: res.status, bytes: null, sha256: null };
      console.log(`  HTTP ${res.status} ${url}; espera ${espera / 1000}s`);
      await dormir(espera);
      espera = Math.min(espera * 2, 120_000);
      continue;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const guardar = res.status === 200;
    const fichero = guardar ? ficheroDe(url) : null;
    if (fichero) {
      const ruta = join(RAW, fichero);
      mkdirSync(dirname(ruta), { recursive: true });
      writeFileSync(`${ruta}.tmp`, bytes);
      renameSync(`${ruta}.tmp`, ruta);
      bytesCache += bytes.length;
    }
    const r: Registro = {
      url, status: res.status, fichero, sha256: guardar ? sha256(bytes) : null, bytes: bytes.length, ts: new Date().toISOString(),
    };
    mkdirSync(RAW, { recursive: true });
    appendFileSync(REGISTRO, `${JSON.stringify(r)}\n`);
    reg.set(url, r);
    return { url, status: res.status, bytes: guardar ? bytes : null, sha256: r.sha256 };
  }
}

/** Sólo la caché: el paso a hechos no hace peticiones. */
export function enCache(url: string): Documento | null {
  const r = cargarRegistro().get(url);
  if (!r || r.status !== 200 || !r.fichero) return null;
  const bytes = new Uint8Array(readFileSync(join(RAW, r.fichero)));
  return { url, status: 200, bytes, sha256: sha256(bytes) };
}

export function textoDe(d: Documento | null, codificacion = 'utf-8'): string | null {
  return d?.bytes ? new TextDecoder(codificacion).decode(d.bytes) : null;
}

/** Ejecuta `tarea` sobre los elementos con `n` en vuelo como máximo. */
export async function enParalelo<T>(elementos: readonly T[], n: number, tarea: (x: T, i: number) => Promise<void>): Promise<void> {
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < elementos.length) {
      const i = siguiente;
      siguiente += 1;
      await tarea(elementos[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, elementos.length) }, trabajador));
}

// ---------------------------------------------------------------------------
// Wayback Machine
// ---------------------------------------------------------------------------

/** Captura original sin la barra de Wayback (`id_`). */
export const urlWayback = (timestamp: string, original: string): string =>
  `https://web.archive.org/web/${timestamp}id_/${original}`;

export type Captura = { timestamp: string; original: string; status: string; length: number; mime: string };

export async function cdx(url: string, params: Record<string, string> = {}): Promise<Captura[]> {
  const q = new URLSearchParams({ url, fl: 'timestamp,original,statuscode,length,mimetype', ...params });
  const d = await obtener(`https://web.archive.org/cdx/search/cdx?${q.toString()}`);
  const t = textoDe(d);
  if (d.status !== 200 || t === null) throw new Error(`cdx HTTP ${d.status} ${url}`);
  return t.split('\n').filter(Boolean).map((l) => {
    const [timestamp, original, status, length, mime] = l.split(' ');
    return { timestamp, original, status, length: Number(length), mime };
  });
}
