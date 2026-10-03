/**
 * Explicit, finite authorization for additional download-only windows.
 * --source fie --root <existing root> --approval <UUIDv4> --minutes 180 --apply
 * --source rfee --root <existing root> --inventory <JSON> --approval <UUIDv4> --minutes 60 --apply
 * Without --apply: aggregate inspection only, no writes and no network.
 * Reusing an approval resumes its ORIGINAL deadline and immutable windows.
 * No imports of dotenv, application databases, R2, auth or cloud clients.
 */
import { spawn } from 'node:child_process';
import { readFile, statfs } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acquireContinuationLock, approveDownload, assertWindowBudget, closeDownloadWindow,
  createDownloadWindow, downloadDiskBytes, downloadRecordExists, finishDownloadApproval,
  readDownloadWindow, validateDownloadRoot, validateWindowId, windowId, WINDOW_LIMITS,
  type DownloadSource, type DownloadTotals, type DownloadWindow,
} from '../src/lib/ingest/backfill/download-window';
import { prepararUnidadesNacionales, type InventarioCacheNacional } from '../src/lib/ingest/backfill/cache-nacional';

export function parseContinuationArguments(args: string[]) {
  const values = new Map<string, string>();
  let apply = false;
  const allowed = new Set(['--source', '--root', '--inventory', '--approval', '--minutes']);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply' && !apply) { apply = true; continue; }
    if (!allowed.has(args[i]) || values.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error('invalid_runner_argument');
    }
    values.set(args[i], args[++i]);
  }
  const source = values.get('--source') as DownloadSource;
  if (source !== 'fie' && source !== 'rfee') throw new Error('invalid_source');
  const root = values.get('--root') ?? '';
  const approval = validateWindowId(values.get('--approval') ?? '');
  const minutes = Number(values.get('--minutes'));
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > (source === 'fie' ? 180 : 60)) {
    throw new Error('invalid_approval_duration');
  }
  const inventory = values.get('--inventory');
  if (!path.isAbsolute(root) || (source === 'rfee' && (!inventory || !path.isAbsolute(inventory)))) {
    throw new Error('absolute_path_required');
  }
  return { source, root, approval, minutes, inventory, apply };
}
export async function readSourceTotals(root: string, source: DownloadSource): Promise<DownloadTotals> {
  const diskBytes = await downloadDiskBytes(root);
  if (source === 'fie') {
    const m = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    if (m.version !== 1 || !m.cooldownUntil) throw new Error('invalid_source_checkpoint');
    return { requests: m.requestCount, payloadBytes: m.bytesStored, diskBytes, cooldown: m.cooldownUntil };
  }
  const m = JSON.parse(await readFile(path.join(root, 'state.json'), 'utf8'));
  if (m.version !== 1) throw new Error('invalid_source_checkpoint');
  return { requests: m.peticionesIniciadas, payloadBytes: m.bytesPayloadActuales, diskBytes,
    cooldown: m.cooldownHasta, legacyStarted: m.campanaInicio,
    legacyDiskStart: m.bytesDiscoInicio, lastStart: m.ultimoInicioPeticion };
}
function cooldownActive(t: DownloadTotals) {
  if (typeof t.cooldown === 'number') return t.cooldown > Date.now();
  if (t.cooldown && typeof t.cooldown === 'object') {
    return Object.values(t.cooldown).some((v) => typeof v === 'string' && Date.parse(v) > Date.now());
  }
  return false;
}
export function shouldContinueBatch(source: DownloadSource, reason: string, advanced: boolean) {
  return advanced && reason === (source === 'fie' ? 'unit_checkpoint' : 'lote_completado');
}
export function renewableWindowStop(source: DownloadSource, reason: string) {
  return (source === 'fie'
    ? ['time_limit', 'window_time_limit', 'request_limit', 'window_request_limit', 'cache_limit', 'window_byte_limit']
    : ['presupuesto_peticiones', 'presupuesto_tiempo', 'presupuesto_bytes', 'tiempo_o_senal']).includes(reason);
}
type BatchResult = { reason: string; completed: number; pid: number; exitCode: number | null };
async function runBatch(
  source: DownloadSource, root: string, w: DownloadWindow, inventory?: string,
): Promise<BatchResult> {
  const scripts = path.dirname(fileURLToPath(import.meta.url));
  const script = path.join(scripts, source === 'fie' ? 'descargar-historico-local.ts' : 'descargar-historico-nacional.ts');
  const args = source === 'fie'
    ? ['--root', root, '--units', '200', '--window', w.id]
    : ['--inventario', inventory!, '--cache', root, '--aplicar', '--max-unidades', '200', '--window', w.id];
  const remaining = w.deadline - Date.now();
  if (remaining <= 0) return { reason: 'window_time_limit', completed: 0, pid: 0, exitCode: 0 };
  const child = spawn(process.execPath, ['--import', 'tsx', script, ...args], {
    cwd: path.dirname(scripts), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    // Environment is inherited, not read, printed or loaded from .env.
  });
  console.log(JSON.stringify({ event: 'batch_started', source, runnerPid: process.pid,
    downloaderPid: child.pid, windowId: w.id, approvalId: w.approvalId, deadline: w.deadline }));
  let output = '';
  let failed = false;
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
    if (output.length > 128 * 1024) { failed = true; child.kill(); }
  });
  child.stderr.on('data', () => { /* Never forward unknown exception data. */ });
  const timer = setTimeout(() => { failed = true; child.kill(); }, remaining + 1000);
  let signalStop = false;
  const stop = () => { signalStop = true; child.kill(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject); child.once('close', resolve);
    });
    if (signalStop || failed) return { reason: signalStop ? 'signal_stop' : 'child_deadline_or_output_limit',
      completed: 0, pid: child.pid ?? 0, exitCode: code };
    let report: Record<string, unknown> | undefined;
    if (source === 'rfee') {
      try { report = JSON.parse(output); } catch { /* Fail closed. */ }
    } else {
      for (const line of output.trim().split(/\r?\n/)) {
        try {
          const candidate = JSON.parse(line);
          if (candidate.mode === 'download_only' && typeof candidate.stopReason === 'string') report = candidate;
        } catch { /* No logging or trusting malformed output. */ }
      }
    }
    const reason = report?.[source === 'fie' ? 'stopReason' : 'motivoParada'];
    if (!report || typeof reason !== 'string' || !/^[a-z_0-9]{1,80}$/.test(reason) ||
        (code !== 0 && !(source === 'rfee' && code === 4))) {
      return { reason: 'child_failed', completed: 0, pid: child.pid ?? 0, exitCode: code };
    }
    return { reason, completed: Number(report[source === 'fie' ? 'processed' : 'completadas']) || 0,
      pid: child.pid ?? 0, exitCode: code };
  } finally {
    clearTimeout(timer); process.off('SIGINT', stop); process.off('SIGTERM', stop);
  }
}
async function main() {
  const options = parseContinuationArguments(process.argv.slice(2));
  const root = await validateDownloadRoot(options.root);
  if (options.source === 'rfee') {
    // Validate exact existing official inventory offline before approval or network.
    const inventory = JSON.parse(await readFile(options.inventory!, 'utf8')) as InventarioCacheNacional;
    const units = prepararUnidadesNacionales(inventory);
    if (!units.length) throw new Error('empty_official_inventory');
  }
  const initial = await readSourceTotals(root, options.source);
  if (!options.apply) {
    console.log(JSON.stringify({ event: 'dry_run', source: options.source, requests: initial.requests,
      payloadBytes: initial.payloadBytes, minutes: options.minutes, networkRequests: 0, writes: 0 }));
    return;
  }
  const release = await acquireContinuationLock(root, options.approval);
  try {
    const approval = await approveDownload(root, options.source, options.approval, options.minutes,
      await readSourceTotals(root, options.source));
    if (await downloadRecordExists(root, 'finished', approval.id)) throw new Error('approval_already_finished');
    let reason = 'approval_exhausted';
    console.log(JSON.stringify({ event: 'approved_continuation', source: options.source,
      approvalId: approval.id, runnerPid: process.pid, deadline: approval.deadline,
      maxWindows: approval.maxWindows, initialRequests: initial.requests, initialPayloadBytes: initial.payloadBytes,
      maxRequestsPerWindow: WINDOW_LIMITS.requests, maxGrowthPerWindow: WINDOW_LIMITS.growth,
      maxMinutesPerWindow: 30, minStartIntervalMs: 350, maxInFlight: 1 }));
    for (let ordinal = 1; ordinal <= approval.maxWindows && Date.now() < approval.deadline; ordinal++) {
      const id = windowId(approval.id, ordinal);
      if (await downloadRecordExists(root, 'closed', id)) {
        const receipt = JSON.parse(await readFile(path.join(root, 'download-windows', `closed-${id}.json`), 'utf8'));
        if (receipt.renewable !== true) { reason = 'prior_window_not_renewable'; break; }
        continue;
      }
      let totals = await readSourceTotals(root, options.source);
      if (cooldownActive(totals)) { reason = 'cooldown_active'; break; }
      const w = await downloadRecordExists(root, 'window', id)
        ? await readDownloadWindow(root, id, options.source)
        : await createDownloadWindow(approval, ordinal, totals);
      let renewable = false;
      // At most 200 batches in a window, even if malformed units make no GETs.
      for (let batch = 0; batch < 200; batch++) {
        totals = await readSourceTotals(root, options.source);
        try { assertWindowBudget(w, totals); }
        catch (error) {
          reason = error instanceof Error ? error.message : 'window_invalid';
          renewable = ['window_time_limit', 'window_request_limit', 'window_byte_limit'].includes(reason);
          break;
        }
        if (cooldownActive(totals)) { reason = 'cooldown_active'; break; }
        const disk = await statfs(root, { bigint: true });
        if (Number(disk.bavail * disk.bsize) < WINDOW_LIMITS.reserve + WINDOW_LIMITS.growth) {
          reason = 'disk_reserve'; break;
        }
        const before = totals;
        const result = await runBatch(options.source, root, w, options.inventory);
        totals = await readSourceTotals(root, options.source);
        reason = result.reason;
        console.log(JSON.stringify({ event: 'batch_checkpoint', source: options.source, approvalId: approval.id,
          windowId: w.id, runnerPid: process.pid, downloaderPid: result.pid,
          requests: totals.requests, payloadBytes: totals.payloadBytes,
          requestsThisBatch: totals.requests - before.requests, completed: result.completed, reason,
          databaseWrites: 0, uploads: 0 }));
        if (shouldContinueBatch(options.source, reason, totals.requests > before.requests)) continue;
        renewable = renewableWindowStop(options.source, reason) && Date.now() < approval.deadline;
        break;
      }
      await closeDownloadWindow(w, reason, totals, renewable);
      if (!renewable) break;
    }
    const totals = await readSourceTotals(root, options.source);
    await finishDownloadApproval(approval, reason, totals);
    console.log(JSON.stringify({ event: 'continuation_finished', source: options.source, reason,
      approvalId: approval.id, requests: totals.requests, payloadBytes: totals.payloadBytes,
      requestsThisApproval: totals.requests - approval.initial.requests, databaseWrites: 0, uploads: 0 }));
  } finally { await release(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : '';
    console.error(JSON.stringify({ event: 'continuation_stopped',
      reason: /^[a-z_]{1,80}$/.test(message) ? message : 'local_checkpoint_error' }));
    process.exitCode = 1;
  });
}
