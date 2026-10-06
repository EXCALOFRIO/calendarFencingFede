/**
 * Red y caché de `lote7-clubes-*`: páginas públicas de clubes y federaciones territoriales.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-clubes-red.ts <url> [--texto] [--refrescar]
 *
 * Una cola por host (pausa >= 800 ms, una petición cada vez), User-Agent = INGEST_USER_AGENT.
 * Todo lo descargado queda en `cache-lote7-clubes/<sha256(url)>.bin` con su `.json` de metadatos.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CARPETA_TRABAJO } from './comun';
import { ClienteEducado } from './lote7-pdf-comun';

export const CACHE_CLUBES = join(CARPETA_TRABAJO, 'cache-lote7-clubes');
export const HECHOS_CLUBES = join(CARPETA_TRABAJO, 'hechos', 'lote7-clubes');
export const HECHOS_CLUBES_EQUIPOS = join(CARPETA_TRABAJO, 'hechos', 'lote7-clubes-equipos');

export type Respuesta = { url: string; status: number; tipo: string | null; bytes: Uint8Array; sha256: string; deCache: boolean };

const clientes = new Map<string, ClienteEducado>();
const cliente = (url: string) => {
  const host = new URL(url).host;
  if (!clientes.has(host)) clientes.set(host, new ClienteEducado(host.endsWith('archive.org') ? 1500 : 800));
  return clientes.get(host)!;
};

export const hashUrl = (url: string) => createHash('sha256').update(url).digest('hex');
export const sha256Bytes = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export async function obtener(url: string, opciones: { refrescar?: boolean; soloCache?: boolean } = {}): Promise<Respuesta> {
  mkdirSync(CACHE_CLUBES, { recursive: true });
  const h = hashUrl(url);
  const bin = join(CACHE_CLUBES, `${h}.bin`);
  const meta = join(CACHE_CLUBES, `${h}.json`);
  if (!opciones.refrescar && existsSync(bin) && existsSync(meta)) {
    const m = JSON.parse(readFileSync(meta, 'utf8')) as { status: number; tipo: string | null };
    const bytes = new Uint8Array(readFileSync(bin));
    return { url, status: m.status, tipo: m.tipo, bytes, sha256: sha256Bytes(bytes), deCache: true };
  }
  if (opciones.soloCache) throw new Error(`sin_cache:${url}`);
  const r = await cliente(url).pedir(url);
  writeFileSync(bin, r.bytes);
  writeFileSync(meta, JSON.stringify({ url, status: r.status, tipo: r.tipo, fecha: new Date().toISOString() }));
  return { url, status: r.status, tipo: r.tipo, bytes: r.bytes, sha256: sha256Bytes(r.bytes), deCache: false };
}

export const comoTexto = (r: Respuesta) => new TextDecoder('utf-8').decode(r.bytes);

/** Enlaces absolutos de una página HTML (sin anclas), con su texto. */
export function enlaces(html: string, base: string): { url: string; texto: string }[] {
  const out: { url: string; texto: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?href=["']([^"'#]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      out.push({ url: new URL(m[1].replace(/&amp;/g, '&'), base).href, texto: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() });
    } catch {
      // href no válido
    }
  }
  return out;
}

/** Texto visible aproximado (sin scripts ni estilos). */
export const textoVisible = (html: string) =>
  html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const url = process.argv[2];
  const r = await obtener(url, { refrescar: process.argv.includes('--refrescar') });
  console.log(`${r.status} ${r.tipo} ${r.bytes.length} bytes ${r.deCache ? '(cache)' : ''} ${join(CACHE_CLUBES, `${hashUrl(url)}.bin`)}`);
  if (process.argv.includes('--texto')) console.log(comoTexto(r));
  const filtro = process.argv.includes('--enlaces') ? new RegExp(process.argv[process.argv.indexOf('--enlaces') + 1] ?? '.', 'i') : null;
  if (filtro) for (const e of enlaces(comoTexto(r), url)) if (filtro.test(e.url) || filtro.test(e.texto)) console.log(`${e.url}  «${e.texto.slice(0, 80)}»`);
  if (process.argv.includes('--buscar')) {
    const t = textoVisible(comoTexto(r));
    const re = new RegExp(process.argv[process.argv.indexOf('--buscar') + 1], 'gi');
    for (const m of t.matchAll(re)) console.log(`… ${t.slice(Math.max(0, m.index - 200), m.index + 300)} …`);
  }
}
