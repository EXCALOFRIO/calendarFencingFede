import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export const WINDOW_LIMITS = {
  requests: 2000, milliseconds: 30 * 60_000, growth: 512 * 1024 ** 2,
  reserve: 5 * 1024 ** 3, metadata: 16 * 1024 ** 2,
} as const;
export type DownloadSource = 'fie' | 'rfee';
export type DownloadTotals = {
  requests: number; payloadBytes: number; diskBytes: number;
  cooldown: unknown; legacyStarted?: number; legacyDiskStart?: number; lastStart?: number | null;
};
export type DownloadApproval = {
  version: 1; id: string; source: DownloadSource; root: string;
  approvedAt: number; deadline: number; maxWindows: number; initial: DownloadTotals;
};
export type DownloadWindow = {
  version: 1; id: string; approvalId: string; source: DownloadSource; root: string;
  ordinal: number; startedAt: number; deadline: number; initial: DownloadTotals;
  requestCeiling: number; growthCeiling: number;
};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function validateWindowId(id: string): string {
  if (!UUID.test(id)) throw new Error('invalid_window_id');
  return id;
}
export async function validateDownloadRoot(root: string): Promise<string> {
  if (!path.isAbsolute(root) || root.includes('\0') || root.split(/[\\/]/).includes('..') ||
      path.parse(root).root === path.resolve(root)) throw new Error('unsafe_cache_root');
  const resolved = path.resolve(root);
  // Reject symlink/junction components before touching any lock or sidecar.
  let part = path.parse(resolved).root;
  for (const component of resolved.slice(part.length).split(path.sep).filter(Boolean)) {
    part = path.join(part, component);
    if ((await lstat(part)).isSymbolicLink()) throw new Error('unsafe_cache_root');
  }
  const canonical = await realpath(resolved);
  // realpath also expands safe Windows 8.3 aliases (e.g. the OS temp path).
  return canonical;
}
export async function downloadDiskBytes(root: string): Promise<number> {
  let bytes = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('unsafe_cache_root');
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) bytes += await downloadDiskBytes(child);
    else if (entry.isFile()) bytes += (await stat(child)).size;
  }
  return bytes;
}
async function immutableJson(file: string, value: unknown): Promise<void> {
  // Exclusive creation: existing approvals, boundaries and receipts never change.
  if ((await lstat(path.dirname(file))).isSymbolicLink()) throw new Error('unsafe_cache_root');
  const handle = await open(file, 'wx');
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); }
  finally { await handle.close(); }
}
function directory(root: string) { return path.join(root, 'download-windows'); }
function approvalPath(root: string, id: string) {
  return path.join(directory(root), `approval-${validateWindowId(id)}.json`);
}
function windowPath(root: string, id: string) {
  return path.join(directory(root), `window-${validateWindowId(id)}.json`);
}
function validateTotals(t: DownloadTotals) {
  if (!t || [t.requests, t.payloadBytes, t.diskBytes].some((n) => !Number.isSafeInteger(n) || n < 0)) {
    throw new Error('invalid_window_totals');
  }
}
export async function acquireContinuationLock(root: string, id: string) {
  validateWindowId(id);
  const canonical = await validateDownloadRoot(root);
  // A batch already in progress is not stopped, stolen or reset.
  for (const name of ['run.lock', '.download.lock']) {
    try { await lstat(path.join(canonical, name)); throw new Error('competing_root_lock'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  const file = path.join(canonical, '.continuation.lock');
  const lock = await open(file, 'wx');
  try { await lock.writeFile(JSON.stringify({ pid: process.pid, approvalId: id })); await lock.sync(); }
  catch (error) { await lock.close(); await rm(file, { force: true }); throw error; }
  try {
    for (const name of ['run.lock', '.download.lock']) {
      try { await lstat(path.join(canonical, name)); throw new Error('competing_root_lock'); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    }
  } catch (error) { await lock.close(); await rm(file, { force: true }); throw error; }
  return async () => { await lock.close(); await rm(file, { force: true }); };
}
export async function assertContinuationOwner(root: string, approvalId?: string) {
  try {
    const lock = JSON.parse(await readFile(path.join(root, '.continuation.lock'), 'utf8'));
    if (!approvalId || lock.approvalId !== validateWindowId(approvalId) || lock.pid !== process.ppid) {
      throw new Error('competing_root_lock');
    }
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
}
export async function approveDownload(
  root: string, source: DownloadSource, id: string, minutes: number, initial: DownloadTotals, now = Date.now(),
): Promise<DownloadApproval> {
  root = await validateDownloadRoot(root);
  validateWindowId(id); validateTotals(initial);
  const max = source === 'fie' ? 180 : source === 'rfee' ? 60 : 0;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > max) throw new Error('invalid_approval_duration');
  await mkdir(directory(root), { recursive: true });
  try {
    const existing = await readDownloadApproval(root, id);
    if (existing.source !== source || existing.deadline - existing.approvedAt !== minutes * 60_000) {
      throw new Error('approval_mismatch');
    }
    return existing;
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  // One immutable historical boundary, independent of later approvals.
  try { await immutableJson(path.join(directory(root), 'legacy.json'), { version: 1, source, root, ...initial }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  const approval: DownloadApproval = {
    version: 1, id, source, root, approvedAt: now, deadline: now + minutes * 60_000,
    maxWindows: Math.ceil(minutes / 30), initial: structuredClone(initial),
  };
  await immutableJson(approvalPath(root, id), approval);
  return approval;
}
export async function readDownloadApproval(root: string, id: string): Promise<DownloadApproval> {
  root = await validateDownloadRoot(root);
  if ((await lstat(directory(root))).isSymbolicLink()) throw new Error('unsafe_cache_root');
  const a = JSON.parse(await readFile(approvalPath(root, id), 'utf8')) as DownloadApproval;
  const cap = a.source === 'fie' ? 180 : a.source === 'rfee' ? 60 : 0;
  if (a.version !== 1 || a.id !== id || a.root !== root || !Number.isSafeInteger(a.approvedAt) ||
      !Number.isSafeInteger(a.deadline) || a.deadline <= a.approvedAt ||
      a.deadline - a.approvedAt > cap * 60_000 || !Number.isInteger(a.maxWindows) ||
      a.maxWindows !== Math.ceil((a.deadline - a.approvedAt) / WINDOW_LIMITS.milliseconds)) {
    throw new Error('invalid_approval_record');
  }
  validateTotals(a.initial);
  return a;
}
export function windowId(approvalId: string, ordinal: number): string {
  validateWindowId(approvalId);
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 6) throw new Error('invalid_window_ordinal');
  const hash = createHash('sha256').update(`${approvalId}|${ordinal}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export async function createDownloadWindow(
  approval: DownloadApproval, ordinal: number, initial: DownloadTotals, now = Date.now(),
): Promise<DownloadWindow> {
  validateTotals(initial);
  if (now >= approval.deadline || ordinal < 1 || ordinal > approval.maxWindows) throw new Error('approval_exhausted');
  if (initial.requests < approval.initial.requests || initial.payloadBytes < approval.initial.payloadBytes) {
    throw new Error('cumulative_totals_decreased');
  }
  if (ordinal > 1) {
    const prior = await readDownloadWindow(approval.root, windowId(approval.id, ordinal - 1), approval.source);
    const receipt = JSON.parse(await readFile(path.join(directory(approval.root), `closed-${prior.id}.json`), 'utf8'));
    if (receipt.renewable !== true) throw new Error('prior_window_not_renewable');
  }
  const id = windowId(approval.id, ordinal);
  const w: DownloadWindow = {
    version: 1, id, approvalId: approval.id, source: approval.source, root: approval.root,
    ordinal, startedAt: now, deadline: Math.min(now + WINDOW_LIMITS.milliseconds, approval.deadline),
    initial: structuredClone(initial), requestCeiling: initial.requests + WINDOW_LIMITS.requests,
    growthCeiling: initial.diskBytes + WINDOW_LIMITS.growth,
  };
  await immutableJson(windowPath(approval.root, id), w);
  return w;
}
export async function readDownloadWindow(root: string, id: string, source: DownloadSource): Promise<DownloadWindow> {
  root = await validateDownloadRoot(root);
  const w = JSON.parse(await readFile(windowPath(root, id), 'utf8')) as DownloadWindow;
  const a = await readDownloadApproval(root, w.approvalId);
  if (w.version !== 1 || w.id !== id || w.source !== source || a.source !== source ||
      w.root !== root || w.ordinal < 1 || w.ordinal > a.maxWindows || id !== windowId(a.id, w.ordinal) ||
      !Number.isSafeInteger(w.startedAt) || w.startedAt < a.approvedAt ||
      w.deadline !== Math.min(w.startedAt + WINDOW_LIMITS.milliseconds, a.deadline) ||
      w.requestCeiling !== w.initial.requests + WINDOW_LIMITS.requests ||
      w.growthCeiling !== w.initial.diskBytes + WINDOW_LIMITS.growth) throw new Error('invalid_window_record');
  validateTotals(w.initial);
  return w;
}
export async function readOpenDownloadWindow(root: string, id: string, source: DownloadSource): Promise<DownloadWindow> {
  const w = await readDownloadWindow(root, id, source);
  if (await downloadRecordExists(root, 'closed', w.id) ||
      await downloadRecordExists(root, 'finished', w.approvalId)) throw new Error('window_closed');
  return w;
}
export function assertWindowBudget(w: DownloadWindow, totals: DownloadTotals, now = Date.now()) {
  validateTotals(totals);
  if (totals.requests < w.initial.requests || totals.payloadBytes < w.initial.payloadBytes) {
    throw new Error('cumulative_totals_decreased');
  }
  if (now >= w.deadline) throw new Error('window_time_limit');
  if (totals.requests >= w.requestCeiling) throw new Error('window_request_limit');
  if (totals.diskBytes + WINDOW_LIMITS.metadata >= w.growthCeiling) throw new Error('window_byte_limit');
}
export async function closeDownloadWindow(w: DownloadWindow, reason: string, totals: DownloadTotals, renewable: boolean) {
  validateTotals(totals);
  await immutableJson(path.join(directory(w.root), `closed-${w.id}.json`),
    { version: 1, id: w.id, reason, totals, renewable, finishedAt: Date.now() });
}
export async function finishDownloadApproval(a: DownloadApproval, reason: string, totals: DownloadTotals) {
  await immutableJson(path.join(directory(a.root), `finished-${a.id}.json`),
    { version: 1, id: a.id, reason, totals, finishedAt: Date.now(), databaseWrites: 0, uploads: 0 });
}
export async function downloadRecordExists(root: string, name: 'window' | 'closed' | 'finished', id: string) {
  validateWindowId(id);
  try { await lstat(path.join(directory(root), `${name}-${id}.json`)); return true; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; }
}
