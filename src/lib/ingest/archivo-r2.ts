import { createHash } from 'node:crypto';
import type { CuboR2 } from '@/lib/storage';

export const PREFIJO_ARCHIVO = 'historico-interno/v1';
export const MAX_BLOB_ARCHIVO = 32 * 1024 * 1024;
export const MAX_MANIFIESTO_ARCHIVO = 4 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;

export function hashArchivo(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
export function claveBlobArchivo(hash: string): string {
  if (!HASH.test(hash)) throw new Error('archive_hash_invalid');
  return `${PREFIJO_ARCHIVO}/blobs/${hash.slice(0, 2)}/${hash}`;
}
export function claveManifiestoArchivo(fuente: 'fie' | 'rfee', hash: string): string {
  if (!['fie', 'rfee'].includes(fuente) || !HASH.test(hash)) throw new Error('archive_manifest_invalid');
  return `${PREFIJO_ARCHIVO}/manifiestos/${fuente}/${hash}.json`;
}

/** Nunca devuelve bytes incompletos o ilimitados, ni hace fallback de red. */
export async function leerArchivoR2(cubo: CuboR2, clave: string, limite: number): Promise<Uint8Array | null> {
  if (!clave.startsWith(`${PREFIJO_ARCHIVO}/`) || clave.includes('..') ||
    !Number.isSafeInteger(limite) || limite < 1 || limite > MAX_BLOB_ARCHIVO) {
    throw new Error('archive_read_invalid');
  }
  const objeto = await cubo.get(clave);
  if (!objeto) return null;
  if (!objeto.body || !Number.isSafeInteger(objeto.size) || objeto.size < 0 || objeto.size > limite) {
    await objeto.body?.cancel();
    throw new Error('archive_object_size_invalid');
  }
  const reader = objeto.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > objeto.size || size > limite) throw new Error('archive_stream_limit');
      chunks.push(value);
    }
    if (size !== objeto.size) throw new Error('archive_stream_partial');
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Existente distinto se rechaza; nunca se repara sobrescribiendo sin permiso. */
export async function guardarArchivoVerificado(
  cubo: CuboR2, clave: string, bytes: Uint8Array, hash: string, contentType: string,
): Promise<'guardado' | 'reutilizado'> {
  if (!HASH.test(hash) || hashArchivo(bytes) !== hash ||
    bytes.byteLength > MAX_BLOB_ARCHIVO ||
    !(clave === claveBlobArchivo(hash) ||
      clave === claveManifiestoArchivo('fie', hash) || clave === claveManifiestoArchivo('rfee', hash))) {
    throw new Error('archive_upload_invalid');
  }
  const previous = await leerArchivoR2(cubo, clave, MAX_BLOB_ARCHIVO);
  if (previous) {
    if (hashArchivo(previous) !== hash || previous.byteLength !== bytes.byteLength) throw new Error('archive_existing_corrupt');
    return 'reutilizado';
  }
  await cubo.put(clave, bytes.slice().buffer, { httpMetadata: { contentType } });
  const stored = await leerArchivoR2(cubo, clave, MAX_BLOB_ARCHIVO);
  if (!stored || stored.byteLength !== bytes.byteLength || hashArchivo(stored) !== hash) {
    throw new Error('archive_remote_verification_failed');
  }
  return 'guardado';
}

export type ReferenciaArchivada = {
  url: string;
  sha256: string;
  bytes: number;
  status: number;
  contentType: string;
};

/** Adaptador del servidor: URL exacta, hash y tamaño, sin red como respaldo. */
export function crearFetchArchivoR2(cubo: CuboR2, referencias: readonly ReferenciaArchivada[]): typeof fetch {
  const porUrl = new Map<string, ReferenciaArchivada>();
  for (const ref of referencias) {
    const url = new URL(ref.url);
    if (url.protocol !== 'https:' || !['fie.org', 'app.skermo.org'].includes(url.hostname) ||
      url.username || url.password || !HASH.test(ref.sha256) ||
      !Number.isSafeInteger(ref.bytes) || ref.bytes < 0 || ref.bytes > MAX_BLOB_ARCHIVO ||
      !Number.isInteger(ref.status) || ref.status < 100 || ref.status > 599 ||
      /[\r\n]/.test(ref.contentType)) {
      throw new Error('archive_reference_invalid');
    }
    const existing = porUrl.get(ref.url);
    if (existing && (existing.sha256 !== ref.sha256 || existing.status !== ref.status || existing.bytes !== ref.bytes)) {
      throw new Error('archive_reference_conflict');
    }
    porUrl.set(ref.url, ref);
  }
  return (async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const ref = porUrl.get(url);
    if (!ref || !['GET', 'HEAD'].includes(method)) throw new Error('archive_cache_miss');
    if (ref.status !== 200) throw new Error('archive_source_not_success');
    const bytes = await leerArchivoR2(cubo, claveBlobArchivo(ref.sha256), MAX_BLOB_ARCHIVO);
    if (!bytes || bytes.byteLength !== ref.bytes || hashArchivo(bytes) !== ref.sha256) {
      throw new Error('archive_integrity_failure');
    }
    return new Response(method === 'HEAD' ? null : bytes.slice().buffer, {
      status: 200,
      headers: { 'Content-Type': ref.contentType, 'Content-Length': String(ref.bytes), 'Cache-Control': 'private, no-store' },
    });
  }) as typeof fetch;
}
