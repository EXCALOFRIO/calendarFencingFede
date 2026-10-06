import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CARPETA_TRABAJO } from './comun';

/**
 * Caché y red del lote 7 FIE (asaltos que faltan en pruebas individuales FIE
 * desde 2017). Cada respuesta se guarda tal cual en `cache-lote7-fie/raw/` con
 * su registro en `_registro.jsonl`; el paso a hechos trabaja sin red y el
 * SHA-256 de `sourceSha256` es el del contenido leído.
 */

export const CARPETA_LOTE7 = join(CARPETA_TRABAJO, 'cache-lote7-fie');
const CARPETA_RAW = join(CARPETA_LOTE7, 'raw');
export const SALIDA_LOTE7 = join(CARPETA_TRABAJO, 'hechos', 'lote7-fie');
const REGISTRO = join(CARPETA_RAW, '_registro.jsonl');
let agente: string | null = null;
export function userAgent(): string {
  if (agente) return agente;
  // Sólo al pedir a la red: importar el módulo (tests, paso a hechos) no carga el .env.
  if (!process.env.INGEST_USER_AGENT && existsSync('.env')) process.loadEnvFile('.env');
  agente = process.env.INGEST_USER_AGENT || 'CalendarioEsgrima/1.0 (+https://calendario-fie-fede.excalofrio.workers.dev)';
  return agente;
}

export const sha256 = (datos: Uint8Array | string): string => createHash('sha256').update(datos).digest('hex');

type Registro = { url: string; status: number; fichero: string | null; sha256: string | null; bytes: number; ts: string };

let registro: Map<string, Registro> | null = null;
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
  return registro;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ultimoPorHost = new Map<string, number>();
const intervalo = (host: string) => (host.endsWith('archive.org') ? 1500 : 700);

export type Documento = { url: string; status: number; bytes: Uint8Array | null; sha256: string | null };

function ficheroDe(url: string): string {
  const u = new URL(url);
  const h = sha256(url).slice(0, 24);
  return join(u.hostname.replace(/[^a-z0-9.-]+/gi, '_'), h.slice(0, 2), `${h}.bin`);
}

/** Documento de la caché o de la red; 404/410 se registran y no se repiten, 429/5xx se reintentan. */
export async function obtener(url: string, opciones: { intentos?: number } = {}): Promise<Documento> {
  const reg = cargarRegistro();
  const previo = reg.get(url);
  if (previo && (previo.status === 200 || previo.status === 404 || previo.status === 410)) {
    if (previo.fichero === null) return { url, status: previo.status, bytes: null, sha256: null };
    const bytes = new Uint8Array(readFileSync(join(CARPETA_RAW, previo.fichero)));
    return { url, status: previo.status, bytes, sha256: sha256(bytes) };
  }
  const host = new URL(url).hostname;
  let espera = 5_000;
  const max = opciones.intentos ?? 5;
  for (let intento = 1; ; intento += 1) {
    const hueco = (ultimoPorHost.get(host) ?? 0) + intervalo(host) - Date.now();
    if (hueco > 0) await dormir(hueco);
    ultimoPorHost.set(host, Date.now());
    let res: Response;
    try {
      res = await fetch(url, { headers: { 'User-Agent': userAgent() }, redirect: 'follow', signal: AbortSignal.timeout(90_000) });
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
    // Una página de login tras redirección no es el contenido pedido.
    const login = /\/account\/login/i.test(res.url);
    const guardar = res.status === 200 && !login;
    const status = login ? 403 : res.status;
    const fichero = guardar ? ficheroDe(url) : null;
    if (fichero) {
      const ruta = join(CARPETA_RAW, fichero);
      mkdirSync(dirname(ruta), { recursive: true });
      writeFileSync(`${ruta}.tmp`, bytes);
      renameSync(`${ruta}.tmp`, ruta);
    }
    const r: Registro = { url, status, fichero, sha256: guardar ? sha256(bytes) : null, bytes: bytes.length, ts: new Date().toISOString() };
    mkdirSync(CARPETA_RAW, { recursive: true });
    appendFileSync(REGISTRO, `${JSON.stringify(r)}\n`);
    reg.set(url, r);
    return { url, status, bytes: guardar ? bytes : null, sha256: r.sha256 };
  }
}

/** Sólo la caché. */
export function enCache(url: string): Documento | null {
  const r = cargarRegistro().get(url);
  if (!r || r.status !== 200 || !r.fichero) return null;
  const bytes = new Uint8Array(readFileSync(join(CARPETA_RAW, r.fichero)));
  return { url, status: 200, bytes, sha256: sha256(bytes) };
}

export const texto = (d: Documento | null): string | null =>
  d?.bytes ? new TextDecoder('utf-8').decode(d.bytes) : null;

/** Captura original sin la barra de Wayback (`id_`). */
export function urlWayback(timestamp: string, original: string): string {
  return `https://web.archive.org/web/${timestamp}id_/${original}`;
}

export type Captura = { timestamp: string; original: string; status: string; length: number };

export async function cdx(url: string, params: Record<string, string> = {}): Promise<Captura[]> {
  const q = new URLSearchParams({ url, fl: 'timestamp,original,statuscode,length', ...params });
  const d = await obtener(`https://web.archive.org/cdx/search/cdx?${q.toString()}`);
  const t = texto(d);
  if (d.status !== 200 || t === null) throw new Error(`cdx HTTP ${d.status} ${url}`);
  return t.split('\n').filter(Boolean).map((l) => {
    const [timestamp, original, status, length] = l.split(' ');
    return { timestamp, original, status, length: Number(length) };
  });
}
