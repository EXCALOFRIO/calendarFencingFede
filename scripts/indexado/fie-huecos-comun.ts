import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CARPETA_TRABAJO } from './comun';

/**
 * Caché y red compartidas por los productores `fie-huecos-*`: cada respuesta se
 * guarda tal cual bajo `fie-huecos/raw/` con su registro en `_registro.jsonl`,
 * de modo que el paso a hechos trabaja sin red y el SHA-256 de `sourceSha256`
 * es el del contenido leído.
 */

export const CARPETA_HUECOS = join(CARPETA_TRABAJO, 'fie-huecos');
export const CARPETA_RAW = join(CARPETA_HUECOS, 'raw');
export const SALIDA_HECHOS = join(CARPETA_TRABAJO, 'hechos', 'fie-huecos');
const REGISTRO = join(CARPETA_RAW, '_registro.jsonl');
export const USER_AGENT = process.env.INGEST_USER_AGENT ||
  'CalendarioEsgrima/1.0 (+https://calendario-fie-fede.excalofrio.workers.dev)';

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

/** Wayback tolera poco ritmo: una petición por segundo y media; el resto, dos por segundo. */
function intervalo(host: string): number {
  return host.endsWith('archive.org') ? 1500 : 500;
}

export type Documento = { url: string; status: number; bytes: Uint8Array | null; sha256: string | null; deRed: boolean };

function ficheroDe(url: string): string {
  const u = new URL(url);
  const h = sha256(url).slice(0, 24);
  return join(u.hostname.replace(/[^a-z0-9.-]+/gi, '_'), h.slice(0, 2), `${h}.bin`);
}

/**
 * Documento de la caché o de la red. 404/410 se registran y no se vuelven a pedir;
 * 429/5xx y fallos de red se reintentan con espera creciente.
 */
export async function obtener(url: string, opciones: { refrescar?: boolean; intentos?: number } = {}): Promise<Documento> {
  const reg = cargarRegistro();
  const previo = reg.get(url);
  if (previo && !opciones.refrescar && (previo.status === 200 || previo.status === 404 || previo.status === 410)) {
    if (previo.fichero === null) return { url, status: previo.status, bytes: null, sha256: null, deRed: false };
    const bytes = new Uint8Array(readFileSync(join(CARPETA_RAW, previo.fichero)));
    return { url, status: previo.status, bytes, sha256: sha256(bytes), deRed: false };
  }
  const host = new URL(url).hostname;
  let espera = 5_000;
  const max = opciones.intentos ?? 6;
  for (let intento = 1; ; intento += 1) {
    const hueco = (ultimoPorHost.get(host) ?? 0) + intervalo(host) - Date.now();
    if (hueco > 0) await dormir(hueco);
    ultimoPorHost.set(host, Date.now());
    let res: Response;
    try {
      res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(90_000) });
    } catch (e) {
      if (intento >= max) return { url, status: -1, bytes: null, sha256: null, deRed: true };
      console.log(`  red fallida ${url} (${(e as Error).message}); espera ${espera / 1000}s`);
      await dormir(espera);
      espera = Math.min(espera * 2, 120_000);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      await res.body?.cancel();
      if (intento >= max) return { url, status: res.status, bytes: null, sha256: null, deRed: true };
      console.log(`  HTTP ${res.status} ${url}; espera ${espera / 1000}s`);
      await dormir(espera);
      espera = Math.min(espera * 2, 120_000);
      continue;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const guardar = res.status === 200;
    const fichero = guardar ? ficheroDe(url) : null;
    if (fichero) {
      const ruta = join(CARPETA_RAW, fichero);
      mkdirSync(dirname(ruta), { recursive: true });
      writeFileSync(`${ruta}.tmp`, bytes);
      renameSync(`${ruta}.tmp`, ruta);
    }
    const r: Registro = {
      url, status: res.status, fichero, sha256: guardar ? sha256(bytes) : null, bytes: bytes.length, ts: new Date().toISOString(),
    };
    mkdirSync(CARPETA_RAW, { recursive: true });
    appendFileSync(REGISTRO, `${JSON.stringify(r)}\n`);
    reg.set(url, r);
    return { url, status: res.status, bytes: guardar ? bytes : null, sha256: r.sha256, deRed: true };
  }
}

/** Sólo la caché: el paso a hechos no hace peticiones. */
export function enCache(url: string): Documento | null {
  const r = cargarRegistro().get(url);
  if (!r || r.status !== 200 || !r.fichero) return null;
  const bytes = new Uint8Array(readFileSync(join(CARPETA_RAW, r.fichero)));
  return { url, status: 200, bytes, sha256: sha256(bytes), deRed: false };
}

export const texto = (d: Documento | null): string | null =>
  d?.bytes ? new TextDecoder('utf-8').decode(d.bytes) : null;

// ---------------------------------------------------------------------------
// Wayback Machine
// ---------------------------------------------------------------------------

/** Captura original sin la barra de Wayback (`id_`). */
export function urlWayback(timestamp: string, original: string): string {
  return `https://web.archive.org/web/${timestamp}id_/${original}`;
}

export type Captura = { timestamp: string; original: string; status: string; length: number };

export async function cdx(
  url: string,
  params: Record<string, string> = {},
): Promise<Captura[]> {
  const q = new URLSearchParams({ url, fl: 'timestamp,original,statuscode,length', ...params });
  const d = await obtener(`https://web.archive.org/cdx/search/cdx?${q.toString()}`);
  const t = texto(d);
  if (d.status !== 200 || t === null) throw new Error(`cdx HTTP ${d.status} ${url}`);
  return t.split('\n').filter(Boolean).map((l) => {
    const [timestamp, original, status, length] = l.split(' ');
    return { timestamp, original, status, length: Number(length) };
  });
}

/** Última captura 200 de cada URL (la más completa de una página de resultados en vivo). */
export function ultimasCapturas(capturas: Captura[], clave: (c: Captura) => string): Map<string, Captura> {
  const m = new Map<string, Captura>();
  for (const c of capturas) {
    if (c.status !== '200') continue;
    const k = clave(c);
    const p = m.get(k);
    if (!p || c.timestamp > p.timestamp) m.set(k, c);
  }
  return m;
}

// ---------------------------------------------------------------------------
// HTML mínimo
// ---------------------------------------------------------------------------

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function desentidad(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTIDADES[e.toLowerCase()] ?? m;
  });
}

export const limpiar = (html: string): string =>
  desentidad(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
