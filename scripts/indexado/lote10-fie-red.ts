import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statfsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CARPETA_TRABAJO } from './comun';

/**
 * Caché y red del lote 10 FIE. Cada respuesta 200 se guarda tal cual en
 * `cache-lote10-fie/raw/` con su registro en `_registro.jsonl`; los pasos a
 * hechos trabajan sólo con la caché y el SHA-256 de `sourceSha256` es el del
 * contenido leído.
 *
 * Reglas: robots.txt de cada anfitrión (grupo del agente o, si no, `*`, con su
 * Crawl-delay), dos peticiones a la vez por anfitrión como mucho, ≥500 ms entre
 * inicios (1,5 s en archive.org), caché ≤3 GB y nunca menos de 5 GB libres.
 */

export const CACHE_LOTE10_FIE = join(CARPETA_TRABAJO, 'cache-lote10-fie');
const RAW = join(CACHE_LOTE10_FIE, 'raw');
const REGISTRO = join(RAW, '_registro.jsonl');
export const NUEVO9 = join(CARPETA_TRABAJO, 'nuevo9.sqlite');
export const salidaLote10Fie = (fuente: string) => join(CARPETA_TRABAJO, 'hechos', `lote10-fie-${fuente}`);
const LIMITE_CACHE = 3 * 1024 ** 3;
const LIBRE_MINIMO = 5 * 1024 ** 3;

let agente: string | null = null;
export function userAgent(): string {
  if (agente) return agente;
  if (!process.env.INGEST_USER_AGENT && existsSync('.env')) process.loadEnvFile('.env');
  agente = process.env.INGEST_USER_AGENT || 'CalendarioEsgrima/1.0 (+contacto)';
  return agente;
}

export const sha256 = (datos: Uint8Array | string): string => createHash('sha256').update(datos).digest('hex');

type Registro = { url: string; status: number; fichero: string | null; sha256: string | null; bytes: number; ts: string; final?: string };

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
const crawlDelay = new Map<string, number>();
export const intervaloHost = (host: string) =>
  Math.max(crawlDelay.get(host) ?? 0, host === 'archive.org' || host.endsWith('.archive.org') ? 1500 : 500);
const MAX_POR_HOST = 2;

type EstadoHost = { ultimo: number; activos: number; cola: (() => void)[] };
const hosts = new Map<string, EstadoHost>();

async function turno(host: string): Promise<() => void> {
  let e = hosts.get(host);
  if (!e) hosts.set(host, (e = { ultimo: 0, activos: 0, cola: [] }));
  const estado = e;
  if (estado.activos >= MAX_POR_HOST) await new Promise<void>((r) => estado.cola.push(r));
  estado.activos += 1;
  for (;;) {
    const hueco = estado.ultimo + intervaloHost(host) - Date.now();
    if (hueco <= 0) break;
    await dormir(hueco);
  }
  estado.ultimo = Date.now();
  return () => {
    estado.activos -= 1;
    estado.cola.shift()?.();
  };
}

function comprobarDisco(): void {
  if (bytesCache > LIMITE_CACHE) throw new Error(`caché lote10-fie por encima de 3 GB (${bytesCache} bytes)`);
  const s = statfsSync(CARPETA_TRABAJO);
  const libre = Number(s.bavail) * Number(s.bsize);
  if (libre < LIBRE_MINIMO) throw new Error(`menos de 5 GB libres en disco (${(libre / 1024 ** 3).toFixed(2)} GB)`);
}

// --- robots.txt -------------------------------------------------------------

export type Regla = { allow: boolean; ruta: string };
const robots = new Map<string, Regla[] | 'todo' | Promise<Regla[] | 'todo'>>();

/** Reglas aplicables del robots.txt: el grupo del agente si lo hay; si no, el de `*`. */
export function reglasRobots(txt: string, agenteToken: string): Regla[] {
  const grupos: { agentes: string[]; reglas: Regla[] }[] = [];
  let actual: { agentes: string[]; reglas: Regla[] } | null = null;
  let enAgentes = false;
  for (const bruta of txt.split(/\r?\n/)) {
    const l = bruta.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(l);
    if (!m) continue;
    const campo = m[1].toLowerCase();
    const valor = m[2].trim();
    if (campo === 'user-agent') {
      if (!actual || !enAgentes) grupos.push((actual = { agentes: [], reglas: [] }));
      actual.agentes.push(valor.toLowerCase());
      enAgentes = true;
    } else if (campo === 'allow' || campo === 'disallow') {
      enAgentes = false;
      if (!actual) continue;
      if (campo === 'disallow' && valor === '') continue;
      actual.reglas.push({ allow: campo === 'allow', ruta: valor });
    } else {
      enAgentes = false;
    }
  }
  const token = agenteToken.toLowerCase();
  const propio = grupos.filter((g) => g.agentes.some((a) => a !== '*' && token.includes(a)));
  const elegidos = propio.length ? propio : grupos.filter((g) => g.agentes.includes('*'));
  return elegidos.flatMap((g) => g.reglas);
}

function patron(ruta: string): RegExp {
  const fin = ruta.endsWith('$');
  const cuerpo = (fin ? ruta.slice(0, -1) : ruta).split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${cuerpo}${fin ? '$' : ''}`);
}

/** ¿Permiten las reglas la ruta (con query)? Gana la regla más larga; a igualdad, Allow. */
export function permitido(reglas: Regla[], rutaConQuery: string): boolean {
  let mejor: Regla | null = null;
  for (const r of reglas) {
    if (!patron(r.ruta).test(rutaConQuery)) continue;
    if (!mejor || r.ruta.length > mejor.ruta.length || (r.ruta.length === mejor.ruta.length && r.allow)) mejor = r;
  }
  return mejor ? mejor.allow : true;
}

async function reglasDe(origen: string): Promise<Regla[] | 'todo'> {
  const previo = robots.get(origen);
  if (previo) return previo;
  const p = (async () => {
    const d = await obtenerSinRobots(`${origen}/robots.txt`);
    const txt = d.status === 200 && d.bytes ? new TextDecoder().decode(d.bytes) : null;
    // Algunos anfitriones contestan 200 con su página de inicio: eso no es un robots.txt.
    if (txt !== null && !/^\s*</.test(txt)) {
      const espera = /^\s*crawl-delay\s*:\s*(\d+(?:\.\d+)?)/im.exec(txt);
      if (espera) crawlDelay.set(new URL(origen).hostname, Number(espera[1]) * 1000);
      return reglasRobots(txt, 'CalendarioEsgrima');
    }
    if (d.status === 401 || d.status === 403) return [{ allow: false, ruta: '/' }];
    return 'todo' as const;
  })();
  robots.set(origen, p);
  const r = await p;
  robots.set(origen, r);
  return r;
}

export class Prohibido extends Error {}

// --- descarga ---------------------------------------------------------------

export type Documento = { url: string; status: number; bytes: Uint8Array | null; sha256: string | null; final?: string };

function ficheroDe(url: string): string {
  const u = new URL(url);
  const h = sha256(url).slice(0, 24);
  return join(u.hostname.replace(/[^a-z0-9.-]+/gi, '_'), h.slice(0, 2), `${h}.bin`);
}

function desdeRegistro(r: Registro): Documento {
  if (r.fichero === null) return { url: r.url, status: r.status, bytes: null, sha256: null, final: r.final };
  const bytes = new Uint8Array(readFileSync(join(RAW, r.fichero)));
  return { url: r.url, status: r.status, bytes, sha256: sha256(bytes), final: r.final };
}

const DEFINITIVOS = new Set([200, 404, 410]);

async function obtenerSinRobots(url: string, intentos = 4): Promise<Documento> {
  const reg = cargarRegistro();
  const previo = reg.get(url);
  if (previo && DEFINITIVOS.has(previo.status)) return desdeRegistro(previo);
  const host = new URL(url).hostname;
  let espera = 5_000;
  for (let intento = 1; ; intento += 1) {
    comprobarDisco();
    const soltar = await turno(host);
    let res: Response;
    let bytes: Uint8Array;
    try {
      res = await fetch(url, { headers: { 'User-Agent': userAgent() }, redirect: 'follow', signal: AbortSignal.timeout(120_000) });
      if (res.status === 429 || res.status >= 500) {
        await res.body?.cancel();
        bytes = new Uint8Array();
      } else {
        bytes = new Uint8Array(await res.arrayBuffer());
      }
    } catch (e) {
      soltar();
      if (intento >= intentos) return { url, status: -1, bytes: null, sha256: null };
      console.log(`  red fallida ${url} (${(e as Error).message}); espera ${espera / 1000}s`);
      await dormir(espera);
      espera = Math.min(espera * 2, 120_000);
      continue;
    }
    soltar();
    if (res.status === 429 || res.status >= 500) {
      if (intento >= intentos) return { url, status: res.status, bytes: null, sha256: null };
      const ra = Number(res.headers.get('retry-after'));
      const pausa = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 300_000) : espera;
      console.log(`  HTTP ${res.status} ${url}; espera ${pausa / 1000}s`);
      await dormir(pausa);
      espera = Math.min(espera * 2, 120_000);
      continue;
    }
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
      url, status: res.status, fichero, sha256: guardar ? sha256(bytes) : null, bytes: bytes.length,
      ts: new Date().toISOString(), ...(res.url && res.url !== url ? { final: res.url } : {}),
    };
    mkdirSync(RAW, { recursive: true });
    appendFileSync(REGISTRO, `${JSON.stringify(r)}\n`);
    reg.set(url, r);
    return { url, status: r.status, bytes: guardar ? bytes : null, sha256: r.sha256, final: r.final };
  }
}

/** Documento de la caché o de la red, tras comprobar robots.txt del anfitrión. */
export async function obtener(url: string, opciones: { intentos?: number } = {}): Promise<Documento> {
  const previo = cargarRegistro().get(url);
  if (previo && DEFINITIVOS.has(previo.status)) return desdeRegistro(previo);
  const u = new URL(url);
  const reglas = await reglasDe(u.origin);
  if (reglas !== 'todo' && !permitido(reglas, u.pathname + u.search)) throw new Prohibido(`robots.txt prohíbe ${url}`);
  return obtenerSinRobots(url, opciones.intentos);
}

/** Sólo la caché. */
export function enCache(url: string): Documento | null {
  const r = cargarRegistro().get(url);
  if (!r || r.status !== 200 || !r.fichero) return null;
  return desdeRegistro(r);
}

export const texto = (d: Documento | null, codificacion = 'utf-8'): string | null =>
  d?.bytes ? new TextDecoder(codificacion).decode(d.bytes) : null;

/** Captura original sin la barra de Wayback (`id_`). */
export function urlWayback(timestamp: string, original: string): string {
  return `https://web.archive.org/web/${timestamp}id_/${original}`;
}

export type Captura = { timestamp: string; original: string; status: string; mime: string; length: number };

export async function cdx(url: string, params: Record<string, string> = {}): Promise<Captura[]> {
  const q = new URLSearchParams({ url, fl: 'timestamp,original,statuscode,mimetype,length', ...params });
  const d = await obtener(`https://web.archive.org/cdx/search/cdx?${q.toString()}`);
  const t = texto(d);
  if (d.status !== 200 || t === null) throw new Error(`cdx HTTP ${d.status} ${url}`);
  return t.split('\n').filter(Boolean).map((l) => {
    const [timestamp, original, status, mime, length] = l.split(' ');
    return { timestamp, original, status, mime, length: Number(length) };
  });
}

/** Bytes guardados en la caché del lote. */
export function bytesEnCache(): number {
  cargarRegistro();
  return bytesCache;
}
