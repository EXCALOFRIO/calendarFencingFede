/**
 * Descargas con caché para los productores `lote7-skermo-*`: una petición cada
 * vez por host con pausa, User-Agent de `INGEST_USER_AGENT` y todo lo bajado en
 * `cache-lote7-skermo/` (comprimido) para no repetir peticiones.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { CARPETA_TRABAJO } from './comun';

const ENV = resolve(fileURLToPath(new URL('../../.env', import.meta.url)));
if (!process.env.INGEST_USER_AGENT && existsSync(ENV)) {
  try {
    process.loadEnvFile(ENV);
  } catch {
    /* sin .env legible: se usa el User-Agent por defecto */
  }
}

export const USER_AGENT_LOTE7 =
  process.env.INGEST_USER_AGENT || 'CalendarioEsgrima/1.0 (+https://calendario-fie-fede.excalofrio.workers.dev)';
export const CACHE_LOTE7_SKERMO = join(CARPETA_TRABAJO, 'cache-lote7-skermo');
export const SALIDA_LOTE7_SKERMO = join(CARPETA_TRABAJO, 'hechos', 'lote7-skermo');

export const sha256Hex = (d: Uint8Array | string) => createHash('sha256').update(d).digest('hex');
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Nombre de fichero de caché estable para una URL. */
export function claveUrl(url: string): string {
  const u = new URL(url);
  const legible = `${u.hostname}${u.pathname}${u.search}`.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);
  return `${legible}__${sha256Hex(url).slice(0, 12)}.gz`;
}

export type Descarga = { url: string; status: number; bytes: Uint8Array | null; deCache: boolean };

const ultimoPorHost = new Map<string, number>();
const colaPorHost = new Map<string, Promise<unknown>>();

/**
 * GET con caché. Las peticiones al mismo host se encadenan (una a la vez) con
 * al menos `pausaMs` entre ellas. Un 404 se cachea como fichero vacío para no
 * volver a pedirlo.
 */
export async function obtener(
  url: string,
  opciones: { sub: string; pausaMs?: number; sinRed?: boolean; refrescar?: boolean; formulario?: Record<string, string> } = { sub: 'otros' },
): Promise<Descarga> {
  const cuerpo = opciones.formulario ? new URLSearchParams(opciones.formulario).toString() : null;
  const ruta = join(CACHE_LOTE7_SKERMO, opciones.sub, claveUrl(cuerpo ? `${url}#POST:${cuerpo}` : url));
  const ruta404 = `${ruta}.404`;
  if (!opciones.refrescar) {
    if (existsSync(ruta)) return { url, status: 200, bytes: new Uint8Array(gunzipSync(readFileSync(ruta))), deCache: true };
    if (existsSync(ruta404)) return { url, status: 404, bytes: null, deCache: true };
  }
  if (opciones.sinRed) return { url, status: -1, bytes: null, deCache: true };
  const host = new URL(url).hostname;
  const anterior = colaPorHost.get(host) ?? Promise.resolve();
  const tarea = anterior.then(async () => {
    const pausa = opciones.pausaMs ?? 700;
    const desde = Date.now() - (ultimoPorHost.get(host) ?? 0);
    if (desde < pausa) await esperar(pausa - desde);
    let ultimoError: unknown = null;
    for (let intento = 1; intento <= 3; intento += 1) {
      try {
        const res = await fetch(url, {
          method: cuerpo ? 'POST' : 'GET',
          body: cuerpo ?? undefined,
          headers: {
            'User-Agent': USER_AGENT_LOTE7,
            ...(cuerpo ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(90_000),
        });
        ultimoPorHost.set(host, Date.now());
        if (res.status === 404 || res.status === 410) {
          mkdirSync(dirname(ruta404), { recursive: true });
          writeFileSync(ruta404, '');
          return { url, status: res.status, bytes: null, deCache: false } satisfies Descarga;
        }
        if (res.status === 429 || res.status >= 500) {
          await esperar(5_000 * intento);
          continue;
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (res.status === 200) {
          mkdirSync(dirname(ruta), { recursive: true });
          writeFileSync(ruta, gzipSync(bytes));
        }
        return { url, status: res.status, bytes: res.status === 200 ? bytes : null, deCache: false } satisfies Descarga;
      } catch (e) {
        ultimoPorHost.set(host, Date.now());
        ultimoError = e;
        await esperar(3_000 * intento);
      }
    }
    console.log(`  red fallida ${url}: ${(ultimoError as Error | null)?.message ?? 'reintentos agotados'}`);
    return { url, status: -1, bytes: null, deCache: false } satisfies Descarga;
  });
  colaPorHost.set(host, tarea.catch(() => undefined));
  return tarea;
}

export const textoDe = (bytes: Uint8Array) => new TextDecoder('utf-8').decode(bytes);
