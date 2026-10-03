/** Herramienta local únicamente. No se importa en el Worker. */
import { readFile, readdir, lstat, realpath, open } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import {
  hashArchivo, claveBlobArchivo, claveManifiestoArchivo,
  MAX_BLOB_ARCHIVO, MAX_MANIFIESTO_ARCHIVO, type ReferenciaArchivada,
} from './archivo-r2';

export type BlobLocalArchivado = { hash: string; bytes: number; path: string; clave: string };
export type PlanArchivo = {
  fuente: 'fie' | 'rfee'; manifest: Uint8Array; hash: string; clave: string;
  blobs: BlobLocalArchivado[]; referencias: ReferenciaArchivada[]; bytes: number;
};
const HASH = /^[a-f0-9]{64}$/;

export const LIMITES_SELECCION_ARCHIVO = {
  unidades: 250, manifiestoOrigen: 16 * 1024 * 1024,
  blobs: 3_500, bytes: 512 * 1024 * 1024,
} as const;
export type SeleccionArchivoLocal =
  | { tipo: 'fie'; season: number; competitionId: number }
  | { tipo: 'html' | 'pdf'; id: string };

/** Read at most the advertised size plus one byte, including after a file race. */
async function leerAcotado(file: string, limit: number, limitCode: string): Promise<Uint8Array> {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('archive_blob_path_invalid');
  if (before.size > limit) throw new Error(limitCode);
  const handle = await open(file, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== before.size ||
      opened.ino !== before.ino || opened.dev !== before.dev) throw new Error('archive_blob_path_invalid');
    const buffer = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size !== before.size || (await handle.stat()).size !== before.size) throw new Error(limitCode);
    return new Uint8Array(buffer.buffer, buffer.byteOffset, size);
  } finally { await handle.close(); }
}

function referencia(ref: Record<string, unknown>): ReferenciaArchivada | null {
  const hash = ref.blobSha256 ?? ref.sha256;
  if (hash === null || hash === undefined) return null;
  if (typeof hash !== 'string' || !HASH.test(hash) || typeof ref.url !== 'string' ||
    !Number.isSafeInteger(ref.bytes) || Number(ref.bytes) < 0 || Number(ref.bytes) > MAX_BLOB_ARCHIVO ||
    (ref.contentType !== null && ref.contentType !== undefined && typeof ref.contentType !== 'string')) {
    throw new Error('archive_reference_invalid');
  }
  const status = ref.status ?? ref.httpStatus, contentType = String(ref.contentType ?? 'application/octet-stream');
  const url = new URL(ref.url);
  if (url.protocol !== 'https:' || !['fie.org', 'app.skermo.org'].includes(url.host) ||
    url.username || url.password || url.hash || !Number.isInteger(status) ||
    Number(status) < 100 || Number(status) > 599 || /[\r\n]/.test(contentType)) {
    throw new Error('archive_reference_invalid');
  }
  return { url: ref.url, sha256: hash, bytes: Number(ref.bytes), status: Number(status), contentType };
}

/** A second bounded read closes the preflight/write gap without retaining a corpus in memory. */
export async function leerBlobArchivadoLocal(blob: BlobLocalArchivado): Promise<Uint8Array> {
  if (!HASH.test(blob.hash) || !Number.isSafeInteger(blob.bytes) ||
    blob.bytes < 0 || blob.bytes > MAX_BLOB_ARCHIVO || !isAbsolute(blob.path)) {
    throw new Error('archive_reference_invalid');
  }
  const bytes = await leerAcotado(blob.path, MAX_BLOB_ARCHIVO, 'archive_campaign_limit');
  if (bytes.byteLength !== blob.bytes || hashArchivo(bytes) !== blob.hash) throw new Error('archive_local_integrity_failure');
  return bytes;
}

export async function leerManifiestoArchivoLocal(root: string): Promise<Uint8Array> {
  if (!isAbsolute(root)) throw new Error('archive_absolute_root_required');
  return leerAcotado(join(await realpath(root), 'manifest.json'),
    LIMITES_SELECCION_ARCHIVO.manifiestoOrigen, 'archive_source_manifest_limit');
}

/**
 * A subset is NOT certification of the rest of a cache. It retains the source
 * manifest digest, exact selected records and independently verified blobs.
 * Unselected files are never enumerated, trusted, uploaded or read.
 */
export async function prepararSeleccionArchivoLocal(
  root: string, fuente: 'fie' | 'rfee', selections: readonly SeleccionArchivoLocal[],
  options: { maxBytes?: number; comprobar?: () => void; manifiestoOrigenSha256?: string } = {},
): Promise<PlanArchivo> {
  const check = options.comprobar ?? (() => {});
  const maxBytes = options.maxBytes ?? LIMITES_SELECCION_ARCHIVO.bytes;
  if (!isAbsolute(root)) throw new Error('archive_absolute_root_required');
  if (!['fie', 'rfee'].includes(fuente) || !Array.isArray(selections) || !selections.length ||
    selections.length > LIMITES_SELECCION_ARCHIVO.unidades ||
    !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > LIMITES_SELECCION_ARCHIVO.bytes ||
    (options.manifiestoOrigenSha256 !== undefined && !HASH.test(options.manifiestoOrigenSha256))) {
    throw new Error('archive_selection_invalid');
  }
  const keys = new Set<string>();
  for (const s of selections) {
    if (!s || (fuente === 'fie' ? s.tipo !== 'fie' : !['html', 'pdf'].includes(s.tipo))) {
      throw new Error('archive_selection_invalid');
    }
    const key = s.tipo === 'fie' ? `${s.season}:${s.competitionId}` : s.id;
    if (s.tipo === 'fie' ? !Number.isSafeInteger(s.season) || s.season < 2000 || s.season > 2100 ||
      !Number.isSafeInteger(s.competitionId) || s.competitionId < 1 :
      !new RegExp(`^${s.tipo}-[a-f0-9]{64}$`).test(s.id)) throw new Error('archive_selection_invalid');
    if (keys.has(key)) throw new Error('archive_selection_invalid');
    keys.add(key);
  }
  check();
  root = await realpath(root);
  const original = await leerManifiestoArchivoLocal(root);
  check();
  const sourceHash = hashArchivo(original);
  if (options.manifiestoOrigenSha256 && sourceHash !== options.manifiestoOrigenSha256) {
    throw new Error('archive_source_manifest_changed');
  }
  const source = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(original));
  if (!source || source.version !== 1) throw new Error('archive_manifest_invalid');
  const selection = { version: 1, manifiestoOrigenSha256: sourceHash, unidades: selections };
  let subset: Record<string, unknown>, refs: Record<string, unknown>[];
  if (fuente === 'fie') {
    if (!source.units || typeof source.units !== 'object' || Array.isArray(source.units) ||
      !source.endpoints || typeof source.endpoints !== 'object' || Array.isArray(source.endpoints)) {
      throw new Error('archive_manifest_invalid');
    }
    const units = Object.fromEntries(Object.entries(source.units).filter(([, value]) => {
      const u = value as Record<string, unknown> | null;
      return u && keys.has(`${u.season}:${u.competitionId}`);
    }));
    for (const [key, value] of Object.entries(units)) {
      const u = value as Record<string, unknown>;
      if (key !== u.key || !Array.isArray(u.endpoints)) throw new Error('archive_manifest_invalid');
    }
    const endpoints = Object.fromEntries(Object.entries(source.endpoints).filter(([, value]) => {
      const r = value as Record<string, unknown> | null;
      return r && typeof r.unitKey === 'string' && Object.hasOwn(units, r.unitKey);
    }));
    refs = Object.values(endpoints) as Record<string, unknown>[];
    subset = {
      version: 1, createdAt: source.createdAt, updatedAt: source.updatedAt,
      requestCount: source.requestCount, bytesStored: source.bytesStored,
      cooldownUntil: source.cooldownUntil, units, endpoints, seleccion: selection,
    };
  } else {
    if (!Array.isArray(source.unidades)) throw new Error('archive_manifest_invalid');
    refs = source.unidades.filter((u: Record<string, unknown> | null) => u && keys.has(String(u.id)));
    subset = {
      version: 1, tipo: source.tipo, generadoEn: source.generadoEn, soloDescarga: source.soloDescarga,
      aviso: source.aviso, peticionesIniciadas: source.peticionesIniciadas,
      bytesPayload: source.bytesPayload, unidades: refs, seleccion: selection,
    };
  }
  if (refs.length > LIMITES_SELECCION_ARCHIVO.blobs) throw new Error('archive_campaign_limit');
  const manifest = new TextEncoder().encode(JSON.stringify(subset));
  if (manifest.byteLength > MAX_MANIFIESTO_ARCHIVO) throw new Error('archive_manifest_limit');
  const referencias = refs.flatMap((r) => {
    const ref = referencia(r);
    return ref ? [ref] : [];
  });
  const sizes = new Map<string, number>(), urls = new Map<string, ReferenciaArchivada>();
  for (const ref of referencias) {
    const previous = urls.get(ref.url);
    if ((sizes.has(ref.sha256) && sizes.get(ref.sha256) !== ref.bytes) ||
      (previous && (previous.sha256 !== ref.sha256 || previous.bytes !== ref.bytes ||
        previous.status !== ref.status || previous.contentType !== ref.contentType))) {
      throw new Error('archive_reference_conflict');
    }
    sizes.set(ref.sha256, ref.bytes); urls.set(ref.url, ref);
  }
  const bytes = manifest.byteLength + [...sizes.values()].reduce((sum, n) => sum + n, 0);
  if (bytes > maxBytes || sizes.size > LIMITES_SELECCION_ARCHIVO.blobs) throw new Error('archive_campaign_limit');
  const blobs: BlobLocalArchivado[] = [];
  const directories = new Set<string>();
  for (const [hash, size] of sizes) {
    check();
    const directory = fuente === 'fie' ? join(root, 'blobs', hash.slice(0, 2)) : join(root, 'blobs');
    if (!directories.has(directory)) {
      for (const dir of [join(root, 'blobs'), directory]) {
        const stat = await lstat(dir);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('archive_blob_path_invalid');
      }
      directories.add(directory);
    }
    const path = join(directory, `${hash}.${fuente === 'fie' ? 'blob' : 'bin'}`);
    let payload: Uint8Array;
    try {
      if (relative(root, await realpath(path)).startsWith('..')) throw new Error('archive_blob_path_invalid');
      payload = await leerAcotado(path, MAX_BLOB_ARCHIVO, 'archive_campaign_limit');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('archive_local_reference_missing');
      throw error;
    }
    if (payload.byteLength !== size || hashArchivo(payload) !== hash) throw new Error('archive_local_integrity_failure');
    blobs.push({ hash, bytes: size, path, clave: claveBlobArchivo(hash) });
    check();
  }
  const hash = hashArchivo(manifest);
  return { fuente, manifest, hash, clave: claveManifiestoArchivo(fuente, hash), blobs, referencias, bytes };
}

export type ParticionesArchivoLocal = {
  fuente: 'fie' | 'rfee'; original: Uint8Array; originalSha256: string;
  blobs: BlobLocalArchivado[]; particiones: PlanArchivo[]; bytes: number;
};
/**
 * Full integrity preflight split into individually bounded archive manifests.
 * The exact larger source manifest is an original content-addressed blob, NOT
 * a relaxation of the 4 MiB R2 manifest limit. Every original, including index
 * and orphan blobs, must pass verification before any upload can start.
 */
export async function prepararParticionesArchivoLocal(
  root: string, fuente: 'fie' | 'rfee',
  options: { maxBlobsPorLote?: number; comprobar?: () => void } = {},
): Promise<ParticionesArchivoLocal> {
  const batch = options.maxBlobsPorLote ?? LIMITES_SELECCION_ARCHIVO.blobs;
  if (!['fie', 'rfee'].includes(fuente) || !Number.isInteger(batch) ||
    batch < 1 || batch > LIMITES_SELECCION_ARCHIVO.blobs) throw new Error('archive_partition_invalid');
  const check = options.comprobar ?? (() => {});
  check();
  const original = await leerManifiestoArchivoLocal(root);
  root = await realpath(root);
  const source = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(original));
  if (!source || source.version !== 1 || (fuente === 'fie' ?
    !source.endpoints || typeof source.endpoints !== 'object' || Array.isArray(source.endpoints) :
    !Array.isArray(source.unidades))) throw new Error('archive_manifest_invalid');
  const refs = (fuente === 'fie' ? Object.values(source.endpoints) : source.unidades) as Record<string, unknown>[];
  const referencias = refs.flatMap((r) => { const ref = referencia(r); return ref ? [ref] : []; });
  const byUrl = new Map<string, ReferenciaArchivada>();
  for (const ref of referencias) {
    const old = byUrl.get(ref.url);
    if (old && (old.sha256 !== ref.sha256 || old.bytes !== ref.bytes || old.status !== ref.status ||
      old.contentType !== ref.contentType)) throw new Error('archive_reference_conflict');
    byUrl.set(ref.url, ref);
  }
  const blobRoot = join(root, 'blobs'), rootStat = await lstat(blobRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('archive_blob_path_invalid');
  const dirs = fuente === 'fie' ? (await readdir(blobRoot)).map((prefix) => {
    if (!/^[a-f0-9]{2}$/.test(prefix)) throw new Error('archive_blob_path_invalid');
    return join(blobRoot, prefix);
  }) : [blobRoot];
  const blobs: BlobLocalArchivado[] = [];
  let bytes = original.byteLength;
  for (const dir of dirs) {
    const info = await lstat(dir);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('archive_blob_path_invalid');
    for (const name of await readdir(dir)) {
      check();
      const match = name.match(fuente === 'fie' ? /^([a-f0-9]{64})\.blob$/ : /^([a-f0-9]{64})\.bin$/);
      if (!match || (fuente === 'fie' && !match[1].startsWith(dir.slice(-2)))) throw new Error('archive_blob_path_invalid');
      if (blobs.length >= 10_000) throw new Error('archive_partition_campaign_limit');
      const path = join(dir, name);
      if (relative(root, await realpath(path)).startsWith('..')) throw new Error('archive_blob_path_invalid');
      const payload = await leerAcotado(path, MAX_BLOB_ARCHIVO, 'archive_campaign_limit');
      if (hashArchivo(payload) !== match[1]) throw new Error('archive_local_integrity_failure');
      bytes += payload.byteLength;
      if (bytes > LIMITES_SELECCION_ARCHIVO.bytes) throw new Error('archive_campaign_limit');
      blobs.push({ hash: match[1], bytes: payload.byteLength, path, clave: claveBlobArchivo(match[1]) });
    }
  }
  const sizes = new Map(blobs.map((b) => [b.hash, b.bytes]));
  if (sizes.size !== blobs.length) throw new Error('archive_blob_path_invalid');
  if (referencias.some((r) => sizes.get(r.sha256) !== r.bytes)) throw new Error('archive_local_reference_missing');
  blobs.sort((a, b) => a.hash.localeCompare(b.hash));
  const originalSha256 = hashArchivo(original), particiones: PlanArchivo[] = [];
  for (let i = 0; i < blobs.length; i += batch) {
    const group = blobs.slice(i, i + batch), hashes = new Set(group.map((b) => b.hash));
    const selectedRefs = referencias.filter((r) => hashes.has(r.sha256));
    const manifest = new TextEncoder().encode(JSON.stringify({
      format: 'calendario-archivo-particion', version: 1, fuente, manifiestoOrigenSha256: originalSha256,
      parte: particiones.length, blobs: group.map((b) => ({ sha256: b.hash, bytes: b.bytes })),
      referencias: selectedRefs,
    }));
    if (manifest.byteLength > MAX_MANIFIESTO_ARCHIVO) throw new Error('archive_manifest_limit');
    const hash = hashArchivo(manifest), partBytes = manifest.byteLength + group.reduce((n, b) => n + b.bytes, 0);
    if (partBytes > LIMITES_SELECCION_ARCHIVO.bytes) throw new Error('archive_campaign_limit');
    bytes += manifest.byteLength;
    particiones.push({ fuente, manifest, hash, clave: claveManifiestoArchivo(fuente, hash),
      blobs: group, referencias: selectedRefs, bytes: partBytes });
  }
  if (bytes > LIMITES_SELECCION_ARCHIVO.bytes) throw new Error('archive_campaign_limit');
  check();
  return { fuente, original, originalSha256, blobs, particiones, bytes };
}

export async function prepararArchivoLocal(root: string, fuente: 'fie' | 'rfee'): Promise<PlanArchivo> {
  if (!isAbsolute(root)) throw new Error('archive_absolute_root_required');
  root = await realpath(root);
  const manifest = await leerAcotado(join(root, 'manifest.json'), MAX_MANIFIESTO_ARCHIVO, 'archive_manifest_limit');
  const source = JSON.parse(new TextDecoder().decode(manifest));
  if (source.version !== 1 || (fuente === 'fie' ? !source.endpoints : !Array.isArray(source.unidades))) {
    throw new Error('archive_manifest_invalid');
  }
  const refs = (fuente === 'fie' ? Object.values(source.endpoints) : source.unidades) as Record<string, unknown>[];
  const referencias: ReferenciaArchivada[] = refs.flatMap((ref) => {
    const parsed = referencia(ref);
    return parsed ? [parsed] : [];
  });
  const blobs: BlobLocalArchivado[] = [];
  const directories = fuente === 'fie'
    ? (await readdir(join(root, 'blobs'))).map((prefix) => {
      if (!/^[a-f0-9]{2}$/.test(prefix)) throw new Error('archive_blob_path_invalid');
      return join(root, 'blobs', prefix);
    })
    : [join(root, 'blobs')];
  for (const directory of directories) for (const name of await readdir(directory)) {
    const match = name.match(fuente === 'fie' ? /^([a-f0-9]{64})\.blob$/ : /^([a-f0-9]{64})\.bin$/);
    if (!match) throw new Error('archive_blob_path_invalid');
    const path = join(directory, name);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BLOB_ARCHIVO ||
      relative(root, await realpath(path)).startsWith('..')) throw new Error('archive_blob_path_invalid');
    const bytes = new Uint8Array(await readFile(path));
    if (hashArchivo(bytes) !== match[1]) throw new Error('archive_local_integrity_failure');
    blobs.push({ hash: match[1], bytes: bytes.byteLength, path, clave: claveBlobArchivo(match[1]) });
  }
  const sizes = new Map(blobs.map((blob) => [blob.hash, blob.bytes]));
  if (referencias.some((ref) => sizes.get(ref.sha256) !== ref.bytes)) throw new Error('archive_local_reference_missing');
  for (const ref of referencias) {
    const url = new URL(ref.url);
    if (url.protocol !== 'https:' || !['fie.org', 'app.skermo.org'].includes(url.hostname) ||
      url.username || url.password || !Number.isInteger(ref.status) ||
      ref.status < 100 || ref.status > 599 || /[\r\n]/.test(ref.contentType)) {
      throw new Error('archive_reference_invalid');
    }
  }
  const bytes = manifest.byteLength + blobs.reduce((sum, blob) => sum + blob.bytes, 0);
  if (bytes > 512 * 1024 * 1024 || blobs.length > 3_500) throw new Error('archive_campaign_limit');
  const hash = hashArchivo(manifest);
  return { fuente, manifest, hash, clave: claveManifiestoArchivo(fuente, hash), blobs, referencias, bytes };
}
