import { z } from 'zod';
import { join } from 'node:path';
import { leerManifiestoArchivoLocal, prepararSeleccionArchivoLocal, leerBlobArchivadoLocal,
  type SeleccionArchivoLocal } from '../archivo-local';
import { LIMITS, digestSchema, type Job } from './schemas';
import { publicSourceUrl } from './prepare';
import { hash, serialize } from './files';

export const PORTFOLIO_LIMITS = {
  units: 20000, metadataBytes: 32 * 1024 * 1024, progressBytes: 32 * 1024 * 1024,
  plans: 500, planInputBytes: 256 * 1024 * 1024, wallSeconds: 48 * 3600,
  steps: 20000, artifactBytes: 64 * 1024 * 1024 * 1024,
} as const;
export const selectionSchema = z.union([
  z.object({ tipo: z.literal('pdf'), id: z.string().regex(/^pdf-[a-f0-9]{64}$/) }).strict(),
  z.object({ tipo: z.literal('fie'), season: z.number().int().min(2000).max(2100),
    competitionId: z.number().int().positive() }).strict(),
]);
export const refSchema = z.object({
  url: z.string().url(), sha256: digestSchema.nullable(),
  bytes: z.number().int().nonnegative().nullable(), usable: z.boolean(),
}).strict();
export const inventoryEntrySchema = z.object({
  key: z.string().min(1).max(200), source: z.enum(['rfee', 'fie']),
  selection: selectionSchema.nullable(), unitSha256: digestSchema,
  disposition: z.enum(['eligible', 'gap', 'excluded']),
  reason: z.enum(['eligible', 'html', 'auxiliary', 'invalid_pdf', 'not_cached',
    'no_usable_input', 'invalid_json', 'input_limit', 'endpoint_inventory']),
  refs: z.array(refSchema).max(100),
}).strict();
export type InventoryEntry = z.infer<typeof inventoryEntrySchema>;
type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('factory_inventory_invalid');
  return value as RecordValue;
}
export function selectionKey(source: 'rfee' | 'fie', selection: SeleccionArchivoLocal): string {
  return selection.tipo === 'fie' ? `fie:${selection.season}:${selection.competitionId}` : `${source}:${selection.id}`;
}
function reference(value: RecordValue, source: 'rfee' | 'fie'): z.infer<typeof refSchema> {
  const sha256 = value.blobSha256 ?? value.sha256 ?? null, bytes = value.bytes ?? null;
  if (sha256 !== null && !digestSchema.safeParse(sha256).success ||
    bytes !== null && (!Number.isSafeInteger(bytes) || Number(bytes) < 0)) throw new Error('factory_inventory_reference_invalid');
  return { url: publicSourceUrl(value.url), sha256: sha256 as string | null, bytes: bytes as number | null,
    usable: source === 'rfee' ? value.estado === 'cached' : value.completeness === 'complete' };
}
/** Pure deterministic assessment; no network and no guesses for missing inputs. */
export function assessInventory(source: 'rfee' | 'fie', value: unknown): InventoryEntry[] {
  const manifest = object(value);
  if (manifest.version !== 1) throw new Error('factory_inventory_version_invalid');
  const entries: InventoryEntry[] = [];
  if (source === 'rfee') {
    if (!Array.isArray(manifest.unidades) || manifest.unidades.length > PORTFOLIO_LIMITS.units) {
      throw new Error('factory_inventory_limit');
    }
    for (const raw of manifest.unidades) {
      const unit = object(raw);
      if (unit.tipo === 'html') {
        entries.push({ key: `rfee:${String(unit.id)}`, source, selection: null, unitSha256: hash(serialize(unit)),
          disposition: 'excluded', reason: 'html', refs: [] }); continue;
      }
      const selection = selectionSchema.parse({ tipo: unit.tipo, id: unit.id });
      if (selection.tipo !== 'pdf') throw new Error('factory_inventory_invalid');
      const ref = reference(unit, source);
      const valid = ref.usable && ref.sha256 !== null && ref.bytes !== null && ref.bytes > 0 && ref.bytes <= LIMITS.inputBytes;
      entries.push({ key: selectionKey(source, selection), source, selection, unitSha256: hash(serialize(unit)),
        disposition: valid ? 'eligible' : 'gap',
        reason: valid ? 'eligible' : unit.estado === 'invalid_payload' ? 'invalid_pdf' :
          ref.usable ? 'input_limit' : 'not_cached', refs: [ref] });
    }
  } else {
    const units = object(manifest.units), endpoints = object(manifest.endpoints);
    if (Object.keys(units).length > PORTFOLIO_LIMITS.units || Object.keys(endpoints).length > 100000) {
      throw new Error('factory_inventory_limit');
    }
    const grouped = new Map<string, RecordValue[]>();
    for (const raw of Object.values(endpoints)) {
      const endpoint = object(raw);
      if (typeof endpoint.unitKey !== 'string') throw new Error('factory_inventory_invalid');
      const group = grouped.get(endpoint.unitKey) ?? [];
      group.push(endpoint); grouped.set(endpoint.unitKey, group);
    }
    for (const [key, raw] of Object.entries(units)) {
      const unit = object(raw);
      if (unit.competitionId === null) {
        entries.push({ key: `fie:aux:${key}`, source, selection: null, unitSha256: hash(serialize(unit)),
          disposition: 'excluded', reason: 'auxiliary', refs: [] }); continue;
      }
      const selection = selectionSchema.parse({ tipo: 'fie', season: unit.season, competitionId: unit.competitionId });
      const records = (grouped.get(key) ?? []).sort((a, b) => String(a.url).localeCompare(String(b.url), 'en'));
      const inventoryMatches = unit.key === key && Array.isArray(unit.endpoints) && unit.endpoints.length <= 100 &&
        records.length <= 100 && unit.endpoints.every(e => records.some(r => r.endpoint === e)) &&
        records.every(r => (unit.endpoints as unknown[]).includes(r.endpoint));
      const refs = records.slice(0, 100).map(r => reference(r, source));
      const usable = refs.filter(r => r.usable), hashes = new Map(usable.map(r => [r.sha256, r.bytes]));
      const sizeValid = usable.every(r => r.sha256 && r.bytes !== null && r.bytes > 0 && r.bytes <= LIMITS.inputBytes) &&
        [...hashes.values()].reduce<number>((n, bytes) => n + (bytes ?? 0), 0) <= LIMITS.jobBytes;
      const valid = inventoryMatches && usable.length > 0 && sizeValid;
      entries.push({ key: selectionKey(source, selection), source, selection,
        unitSha256: hash(serialize({ unit, endpoints: records })), disposition: valid ? 'eligible' : 'gap',
        reason: !inventoryMatches ? 'endpoint_inventory' : !usable.length ? 'no_usable_input' :
          !sizeValid ? 'input_limit' : 'eligible', refs });
    }
  }
  entries.sort((a, b) => a.key.localeCompare(b.key, 'en'));
  if (new Set(entries.map(e => e.key)).size !== entries.length) throw new Error('factory_inventory_duplicate');
  return entries.map(e => inventoryEntrySchema.parse(e));
}
/** Count AND byte/ref caps, preserving each competition as an indivisible unit. */
export function inventoryBatches(entries: readonly InventoryEntry[]): InventoryEntry[][] {
  const batches: InventoryEntry[][] = [];
  let batch: InventoryEntry[] = [], bytes = 0, refs = 0;
  for (const entry of entries.filter(e => e.disposition === 'eligible')) {
    const size = entry.refs.reduce((n, r) => n + (r.bytes ?? 0), 0);
    if (size > PORTFOLIO_LIMITS.planInputBytes || entry.refs.length > 3000) throw new Error('factory_inventory_limit');
    if (batch.length && (batch.length >= LIMITS.jobs || bytes + size > PORTFOLIO_LIMITS.planInputBytes ||
      refs + entry.refs.length > 3000)) {
      batches.push(batch); batch = []; bytes = 0; refs = 0;
    }
    batch.push(entry); bytes += size; refs += entry.refs.length;
  }
  if (batch.length) batches.push(batch);
  if (batches.length > PORTFOLIO_LIMITS.plans) throw new Error('factory_inventory_limit');
  return batches;
}
export async function readInventory(source: 'rfee' | 'fie', root: string) {
  const bytes = Buffer.from(await leerManifiestoArchivoLocal(root));
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('factory_inventory_json_invalid'); }
  return { bytes, sha256: hash(bytes), entries: assessInventory(source, value) };
}
/** Cached payload invalidity is a gap; a hash/path/cache mutation is a hard stop. */
export async function verifyInventoryInputs(root: string, source: 'fie' | 'rfee', manifestHash: string,
  entries: InventoryEntry[]): Promise<void> {
  for (const batch of inventoryBatches(entries)) {
    const archive = await prepararSeleccionArchivoLocal(root, source, batch.map(e => e.selection!),
      { manifiestoOrigenSha256: manifestHash });
    const invalid = new Map<string, InventoryEntry['reason']>();
    for (const blob of archive.blobs) {
      const data = await leerBlobArchivadoLocal(blob);
      if (source === 'rfee') {
        if (Buffer.from(data.subarray(0, 5)).toString('ascii') !== '%PDF-') invalid.set(blob.hash, 'invalid_pdf');
      } else {
        try { JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); }
        catch { invalid.set(blob.hash, 'invalid_json'); }
      }
    }
    for (const entry of batch) {
      const reason = entry.refs.filter(r => r.usable).map(r => r.sha256 && invalid.get(r.sha256)).find(Boolean);
      if (reason) { entry.disposition = 'gap'; entry.reason = reason as InventoryEntry['reason']; }
    }
  }
}
export function jobMatchesEntry(job: Job, entry: InventoryEntry): boolean {
  if (job.kind !== entry.source) return false;
  const expected = new Map<string, { bytes: number; urls: Set<string> }>();
  for (const ref of entry.refs.filter(r => r.usable)) {
    if (!ref.sha256 || ref.bytes === null) return false;
    const item = expected.get(ref.sha256) ?? { bytes: ref.bytes, urls: new Set<string>() };
    if (item.bytes !== ref.bytes) return false;
    item.urls.add(ref.url); expected.set(ref.sha256, item);
  }
  if (expected.size !== job.inputs.length) return false;
  return job.inputs.every(p => {
    const item = expected.get(p.sha256);
    return item && item.bytes === p.bytes && item.urls.size === p.sourceUrls.length &&
      p.sourceUrls.every(url => item.urls.has(url));
  }) && job.unavailable.length === entry.refs.filter(r => !r.usable).length &&
    job.unavailable.every(u => entry.refs.some(r => !r.usable && r.url === u.sourceUrl));
}
export const snapshotPath = (root: string, source: 'rfee' | 'fie') => join(root, `manifest-${source}.json`);
