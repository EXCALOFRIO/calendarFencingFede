import { unlink } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { assertCapacity } from '../../migracion-cloudflare/files';
import { readBounded, writeNew, exists, hash, serialize, jobDirectory } from './files';
import { loadCampaign, validateJob } from './prepare';
import { childEnvironment, spawnTransport, type Transport } from './transport';
import { auditSchema, capabilitySchema, CLI_VERSION, LIMITS, MODEL, PROMPT_VERSION,
  parseEnvelope, parseCandidate, receiptSchema, type Job, type Plan } from './schemas';

export type RunOptions = {
  directory: string; planSha256: string; executable: string;
  execute: boolean; maxSessions: number; concurrency?: number;
  timeoutSeconds?: number; wallSeconds?: number; capabilityPilot?: boolean;
  jobIds?: readonly string[]; signal?: AbortSignal;
};
export type RunSummary = { launched: number; resumed: number; candidates: number; capability: boolean };
export function invocationArguments(directory: string): string[] {
  return ['exec', '--model', MODEL, '--only-tools', 'Read', '--disable-builtin-skills',
    '--cwd', directory, '--settings', join(directory, '.factory', 'settings.json'),
    '--file', join(directory, 'prompt.txt'), '--output-format', 'json'];
}
export async function readAudit(directory: string) {
  const bytes = await readBounded(join(directory, 'audit.jsonl'), LIMITS.auditBytes);
  try {
    const text = bytes.toString('utf8');
    if (!text || !text.endsWith('\n')) throw new Error();
    return { bytes, records: text.slice(0, -1).split('\n').map(line => auditSchema.parse(JSON.parse(line))) };
  } catch { throw new Error('factory_hook_evidence_invalid'); }
}
export async function assertHookEvidence(root: string, job: Job, sessionId: string, pilot = false): Promise<string> {
  const { records, bytes } = await readAudit(jobDirectory(root, job.id));
  if (!records.length || records.some(r => r.sessionId !== sessionId)) throw new Error('factory_hook_session_mismatch');
  const approved = new Set<string>();
  const paths = new Map(job.inputs.map(p => [hash(join(jobDirectory(root, job.id), p.file)), p.sha256]));
  let sentinelDenied = false;
  for (const r of records) {
    if (r.decision === 'observed') {
      if (r.tool !== 'Read' || r.inputSha256 === null || paths.get(r.requestedPathSha256) !== r.inputSha256) {
        throw new Error('factory_hook_observation_invalid');
      }
      approved.add(r.inputSha256);
    } else if (pilot && r.tool === 'Read' && r.inputSha256 === null &&
      r.requestedPathSha256 === hash(join(root, 'sentinel.txt'))) {
      sentinelDenied = true;
    } else throw new Error('factory_hook_unexpected_denial');
  }
  if (approved.size !== new Set(job.inputs.map(p => p.sha256)).size ||
    (pilot && !sentinelDenied)) throw new Error('factory_hook_evidence_missing');
  return hash(bytes);
}
export async function verifyCapability(root: string, planHash: string, plan: Plan, binaryHash: string): Promise<void> {
  let receipt: z.infer<typeof capabilitySchema>;
  try {
    receipt = capabilitySchema.parse(JSON.parse((await readBounded(join(root, 'capability-receipt.json'),
      16384)).toString('utf8')));
  } catch { throw new Error('factory_capability_receipt_required'); }
  if (receipt.planSha256 !== planHash || receipt.droidExecutableSha256 !== binaryHash ||
    receipt.nodeExecutableSha256 !== plan.nodeExecutableSha256 || receipt.hookSha256 !== plan.hookSha256 ||
    receipt.settingsSha256 !== plan.settingsSha256) throw new Error('factory_capability_receipt_mismatch');
  const envelopeBytes = await readBounded(join(jobDirectory(root, plan.capability.id), 'stdout.json'), LIMITS.outputBytes);
  const envelope = parseEnvelope(envelopeBytes.toString('utf8'));
  if (envelope.session_id !== receipt.sessionId || hash(envelopeBytes) !== receipt.envelopeSha256) {
    throw new Error('factory_capability_envelope_mismatch');
  }
  parseCapabilityResult(envelope.result);
  if (await assertHookEvidence(root, plan.capability, receipt.sessionId, true) !== receipt.auditSha256) {
    throw new Error('factory_capability_audit_changed');
  }
}
function parseCapabilityResult(result: string) {
  try {
    z.object({ capability: z.literal('factory-read-v1'), allowedObserved: z.literal(true),
      deniedObserved: z.literal(true) }).strict().parse(JSON.parse(result));
  } catch { throw new Error('factory_capability_result_invalid'); }
}
export async function validateReceipt(root: string, planHash: string, job: Job): Promise<void> {
  const directory = jobDirectory(root, job.id);
  let receipt: z.infer<typeof receiptSchema>;
  try {
    receipt = receiptSchema.parse(JSON.parse((await readBounded(join(directory, 'receipt.json'), 16384)).toString('utf8')));
  } catch { throw new Error('factory_resume_receipt_invalid'); }
  if (receipt.planSha256 !== planHash || receipt.jobId !== job.id || receipt.sourceSha256 !== job.sourceSha256) {
    throw new Error('factory_resume_identity_mismatch');
  }
  const result = await readBounded(join(directory, 'candidate.json'), LIMITS.outputBytes);
  if (hash(result) !== receipt.resultSha256) throw new Error('factory_resume_result_changed');
  parseCandidate(result.toString('utf8'), job);
  const envelope = parseEnvelope((await readBounded(join(directory, 'stdout.json'), LIMITS.outputBytes)).toString('utf8'));
  if (envelope.session_id !== receipt.sessionId ||
    serialize(parseCandidate(envelope.result, job)) !== result.toString('utf8')) {
    throw new Error('factory_resume_envelope_mismatch');
  }
  if (await assertHookEvidence(root, job, receipt.sessionId) !== receipt.auditSha256) {
    throw new Error('factory_resume_audit_changed');
  }
}
/** Explicit subsets cannot include capability, unknown IDs, duplicates or excess jobs. */
export function selectedSourceJobs(plan: Plan, options: Pick<RunOptions, 'jobIds' | 'maxSessions' | 'capabilityPilot'>): Job[] {
  if (options.jobIds === undefined) return options.capabilityPilot ? [plan.capability] : plan.jobs;
  if (options.capabilityPilot || !Array.isArray(options.jobIds) || !options.jobIds.length ||
    options.jobIds.length > options.maxSessions || new Set(options.jobIds).size !== options.jobIds.length) {
    throw new Error('factory_job_subset_invalid');
  }
  const jobs = new Map(plan.jobs.map(job => [job.id, job]));
  return options.jobIds.map(id => {
    const job = jobs.get(id);
    if (!job) throw new Error('factory_job_subset_invalid');
    return job;
  });
}
function validateOptions(o: RunOptions) {
  if (!o.execute) throw new Error('factory_explicit_execution_required');
  if (!isAbsolute(o.directory) || !isAbsolute(o.executable) ||
    (process.platform === 'win32' && !o.executable.toLowerCase().endsWith('.exe')) ||
    !Number.isSafeInteger(o.maxSessions) || o.maxSessions < 1 || o.maxSessions > LIMITS.jobs ||
    !Number.isSafeInteger(o.concurrency ?? 1) || (o.concurrency ?? 1) < 1 || (o.concurrency ?? 1) > 2 ||
    !Number.isSafeInteger(o.timeoutSeconds ?? 300) || (o.timeoutSeconds ?? 300) < 1 ||
    (o.timeoutSeconds ?? 300) > LIMITS.timeoutSeconds ||
    !Number.isSafeInteger(o.wallSeconds ?? 900) || (o.wallSeconds ?? 900) < 1 ||
    (o.wallSeconds ?? 900) > LIMITS.wallSeconds ||
    (o.capabilityPilot && (o.maxSessions !== 1 || (o.concurrency ?? 1) !== 1))) {
    throw new Error('factory_execution_bounds_invalid');
  }
}

/** Inject transport in tests. Production always uses argument-vector spawn, never HTTP/OCR. */
export async function runCampaign(options: RunOptions, transport: Transport = spawnTransport): Promise<RunSummary> {
  validateOptions(options);
  if (options.signal?.aborted) throw new Error('factory_campaign_stopped');
  const root = options.directory, plan = await loadCampaign(root, options.planSha256);
  const sourceJobs = selectedSourceJobs(plan, options);
  const binaryHash = hash(await readBounded(options.executable, LIMITS.executableBytes));
  await assertCapacity(root, options.maxSessions * (2 * LIMITS.outputBytes + LIMITS.auditBytes));
  const lock = join(root, 'campaign.lock');
  await writeNew(lock, serialize({ version: 1, pid: process.pid, planSha256: options.planSha256 }));
  const abort = new AbortController(), env = childEnvironment();
  const timeoutMs = (options.timeoutSeconds ?? 300) * 1000;
  const wall = setTimeout(() => abort.abort(), (options.wallSeconds ?? 900) * 1000);
  const signal = () => abort.abort();
  options.signal?.addEventListener('abort', signal, { once: true });
  if (options.signal?.aborted) abort.abort();
  process.on('SIGINT', signal); process.on('SIGTERM', signal);
  let failure: unknown;
  const summary: RunSummary = { launched: 0, resumed: 0, candidates: 0, capability: false };
  try {
    const version = await transport({ executable: options.executable, args: ['--version'], cwd: root, env,
      timeoutMs: Math.min(timeoutMs, 15000), maxBytes: 65536, signal: abort.signal });
    if (version.exitCode !== 0 || version.stdout.trim() !== CLI_VERSION ||
      Buffer.byteLength(version.stdout) + Buffer.byteLength(version.stderr) > 65536) {
      throw new Error('factory_cli_version_mismatch');
    }
    if (!options.capabilityPilot) await verifyCapability(root, options.planSha256, plan, binaryHash);
    const pending: Job[] = [];
    for (const job of sourceJobs) {
      const directory = jobDirectory(root, job.id);
      if (await exists(join(directory, 'receipt.json')) && !options.capabilityPilot) {
        await validateReceipt(root, options.planSha256, job); summary.resumed++; continue;
      }
      if (await exists(join(directory, 'started.json')) || await exists(join(directory, 'audit.jsonl')) ||
        await exists(join(directory, 'stdout.json')) || await exists(join(directory, 'stderr.txt')) ||
        await exists(join(directory, 'candidate.json'))) {
        throw new Error('factory_started_job_requires_reconciliation');
      }
      pending.push(job);
    }
    const selected = pending.slice(0, options.maxSessions);
    let cursor = 0;
    const worker = async () => {
      try {
        for (;;) {
          if (abort.signal.aborted) throw new Error('factory_campaign_stopped');
          const job = selected[cursor++];
          if (!job) return;
          await validateJob(root, plan, job);
          if (abort.signal.aborted) throw new Error('factory_campaign_stopped');
          const directory = jobDirectory(root, job.id);
          await writeNew(join(directory, 'started.json'), serialize({
            version: 1, jobId: job.id, planSha256: options.planSha256, sourceSha256: job.sourceSha256,
            model: MODEL, promptVersion: PROMPT_VERSION, startedAt: new Date().toISOString(),
          }));
          summary.launched++;
          let output: Awaited<ReturnType<Transport>>;
          try {
            output = await transport({ executable: options.executable, args: invocationArguments(directory),
              cwd: directory, env, timeoutMs, maxBytes: LIMITS.outputBytes, signal: abort.signal });
          } catch (error) {
            const partial = error && typeof error === 'object' && 'partialOutput' in error
              ? error.partialOutput as { stdout?: unknown; stderr?: unknown } : null;
            if (partial) {
              if (!Buffer.isBuffer(partial.stdout) || !Buffer.isBuffer(partial.stderr)) throw new Error('factory_output_limit');
              // Worker ambient types do not expose Buffer.isBuffer as a type
              // guard in the full project. Both values were checked at runtime.
              const stdout = partial.stdout as Uint8Array, stderr = partial.stderr as Uint8Array;
              if (stdout.byteLength + stderr.byteLength > LIMITS.outputBytes) throw new Error('factory_output_limit');
              await writeNew(join(directory, 'stdout.json'), stdout);
              await writeNew(join(directory, 'stderr.txt'), stderr);
            }
            throw error;
          }
          if (Buffer.byteLength(output.stdout) + Buffer.byteLength(output.stderr) > LIMITS.outputBytes) {
            const stdout = Buffer.from(output.stdout).subarray(0, LIMITS.outputBytes);
            await writeNew(join(directory, 'stdout.json'), stdout);
            await writeNew(join(directory, 'stderr.txt'), Buffer.from(output.stderr).subarray(0, LIMITS.outputBytes - stdout.length));
            throw new Error('factory_output_limit');
          }
          await writeNew(join(directory, 'stdout.json'), output.stdout);
          await writeNew(join(directory, 'stderr.txt'), output.stderr);
          if (abort.signal.aborted) throw new Error('factory_campaign_stopped');
          if (output.exitCode !== 0) throw new Error('factory_child_nonzero');
          const envelope = parseEnvelope(output.stdout);
          const auditSha256 = await assertHookEvidence(root, job, envelope.session_id, !!options.capabilityPilot);
          await validateJob(root, plan, job);
          if (options.capabilityPilot) {
            parseCapabilityResult(envelope.result);
            await writeNew(join(root, 'capability-receipt.json'), serialize(capabilitySchema.parse({
              version: 1, planSha256: options.planSha256, model: MODEL, cliVersion: CLI_VERSION,
              droidExecutableSha256: binaryHash, nodeExecutableSha256: plan.nodeExecutableSha256,
              hookSha256: plan.hookSha256, settingsSha256: plan.settingsSha256,
              sessionId: envelope.session_id, auditSha256, envelopeSha256: hash(output.stdout),
            })));
            summary.capability = true;
          } else {
            const candidate = serialize(parseCandidate(envelope.result, job));
            await writeNew(join(directory, 'candidate.json'), candidate);
            await writeNew(join(directory, 'receipt.json'), serialize(receiptSchema.parse({
              version: 1, jobId: job.id, planSha256: options.planSha256, sourceSha256: job.sourceSha256,
              model: MODEL, promptVersion: PROMPT_VERSION, sessionId: envelope.session_id,
              resultSha256: hash(candidate), auditSha256, acceptance: 'requires_source_reconciliation',
            })));
            summary.candidates++;
          }
        }
      } catch (error) { failure ??= error; abort.abort(); }
    };
    await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 1, selected.length) }, worker));
    if (failure) throw failure;
    if (abort.signal.aborted) throw new Error('factory_campaign_stopped');
    return summary;
  } finally {
    abort.abort(); clearTimeout(wall);
    process.off('SIGINT', signal); process.off('SIGTERM', signal);
    options.signal?.removeEventListener('abort', signal);
    // Only the lock created by this invocation is removed. Started records remain.
    await unlink(lock);
  }
}
