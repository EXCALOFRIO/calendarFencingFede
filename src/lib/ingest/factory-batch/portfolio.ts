import { z } from 'zod';
import { appendFile, lstat, readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPrivateExportDirectory, assertCapacity } from '../../migracion-cloudflare/files';
import { prepareCampaign, loadCampaign, validateJob } from './prepare';
import { runCampaign, validateReceipt, verifyCapability, readAudit } from './runner';
import { spawnTransport, type Transport } from './transport';
import { isOrdinarySourceFailure } from './failure-policy';
import { readBounded, writeNew, exists, hash, serialize, jobDirectory, noLinks } from './files';
import { LIMITS, MODEL, PROMPT_VERSION, CLI_VERSION, digestSchema, parseEnvelope, parseCandidate,
  envelopeSchema, type Job, type Plan } from './schemas';
import { PORTFOLIO_LIMITS as PL, inventoryEntrySchema, selectionSchema, assessInventory,
  readInventory, inventoryBatches, verifyInventoryInputs, jobMatchesEntry, snapshotPath,
  selectionKey, type InventoryEntry } from './portfolio-inventory';

const sourceSchema = z.object({ source: z.enum(['rfee', 'fie']), cacheRoot: z.string(),
  manifestSha256: digestSchema }).strict();
const assignmentSchema = z.object({ inventoryKey: z.string(), jobId: digestSchema }).strict();
const campaignSchema = z.object({
  directory: z.string(), planSha256: digestSchema, source: z.enum(['rfee', 'fie']),
  seed: z.boolean(), assignments: z.array(assignmentSchema).min(1).max(LIMITS.jobs),
}).strict();
export const portfolioSchema = z.object({
  version: z.literal(1), model: z.literal(MODEL), promptVersion: z.literal(PROMPT_VERSION),
  cliVersion: z.literal(CLI_VERSION), inventorySha256: digestSchema,
  sources: z.array(sourceSchema).min(1).max(2), campaigns: z.array(campaignSchema).max(PL.plans),
}).strict();
export type Portfolio = z.infer<typeof portfolioSchema>;
type Campaign = z.infer<typeof campaignSchema>;
export type Seed = { directory: string; planSha256: string };
const failureFiles = ['started.json', 'audit.jsonl', 'stdout.json', 'stderr.txt', 'candidate.json'] as const;
const artifactSchema = z.object({ file: z.enum(failureFiles), sha256: digestSchema, bytes: z.number().int().nonnegative() }).strict();
const failureSchema = z.object({
  version: z.literal(1), jobId: digestSchema, planSha256: digestSchema, sourceSha256: digestSchema,
  model: z.literal(MODEL), promptVersion: z.literal(PROMPT_VERSION),
  acceptance: z.literal('requires_reconciliation'), reason: z.string().regex(/^factory_[a-z0-9_]+$/),
  sessionId: z.string().uuid().nullable(), artifacts: z.array(artifactSchema).max(failureFiles.length),
}).strict();
export type UnitState = {
  inventoryKey: string; jobId: string; sourceSha256: string; planSha256: string;
  status: 'successful' | 'partial' | 'unreadable' | 'failed' | 'not_started';
  candidateStatus: string | null; rowfacts: number; sessionId: string | null;
  usage: ReturnType<typeof parseEnvelope>['usage'] | null;
};
export type Aggregate = { successful: number; partial: number; unreadable: number; failed: number;
  not_started: number; candidates: number; rowfacts: number; sourceGaps: number; excluded: number };
export function aggregate(states: readonly UnitState[], entries: readonly InventoryEntry[]): Aggregate {
  const result: Aggregate = { successful: 0, partial: 0, unreadable: 0, failed: 0, not_started: 0,
    candidates: 0, rowfacts: 0, sourceGaps: entries.filter(e => e.disposition === 'gap').length,
    excluded: entries.filter(e => e.disposition === 'excluded').length };
  for (const state of states) {
    result[state.status]++;
    if (state.candidateStatus !== null) { result.candidates++; result.rowfacts += state.rowfacts; }
  }
  return result;
}
export async function preparePortfolio(options: {
  workspace: string; sources: { source: 'rfee' | 'fie'; cacheRoot: string; manifestSha256?: string }[];
  seeds?: Seed[];
}): Promise<{ directory: string; portfolioSha256: string; summary: Aggregate; eligible: number; plans: number }> {
  if (!options.sources.length || options.sources.length > 2 ||
    new Set(options.sources.map(s => s.source)).size !== options.sources.length ||
    options.sources.some(s => !isAbsolute(s.cacheRoot))) throw new Error('factory_portfolio_sources_invalid');
  const collected = await Promise.all(options.sources.map(async s => {
    const inventory = await readInventory(s.source, s.cacheRoot);
    if (s.manifestSha256 !== undefined && s.manifestSha256 !== inventory.sha256) {
      throw new Error('factory_portfolio_manifest_changed');
    }
    await verifyInventoryInputs(s.cacheRoot, s.source, inventory.sha256, inventory.entries);
    return { ...s, ...inventory };
  }));
  const entries = collected.flatMap(s => s.entries);
  if (entries.length > PL.units) throw new Error('factory_portfolio_inventory_limit');
  const eligible = new Map(entries.filter(e => e.disposition === 'eligible').map(e => [e.key, e]));
  const assigned = new Set<string>(), campaigns: Campaign[] = [], seededStates: UnitState[] = [];
  for (const seed of options.seeds ?? []) {
    const plan = await loadCampaign(seed.directory, seed.planSha256);
    const subset = JSON.parse((await readBounded(join(seed.directory, 'source-selection.json'), PL.metadataBytes)).toString('utf8'));
    const selections = z.array(selectionSchema).parse(subset.seleccion?.unidades);
    if (selections.length !== plan.jobs.length) throw new Error('factory_portfolio_seed_inventory_invalid');
    const source = plan.jobs[0].kind;
    if (source === 'capability' || plan.jobs.some(j => j.kind !== source) ||
      collected.find(s => s.source === source)?.sha256 !== plan.sourceManifestSha256) {
      throw new Error('factory_portfolio_seed_manifest_mismatch');
    }
    const assignments = [];
    for (const selection of selections) {
      const key = selectionKey(source, selection), entry = eligible.get(key);
      if (!entry || assigned.has(key)) throw new Error('factory_portfolio_seed_selection_invalid');
      const matches = plan.jobs.filter(j => jobMatchesEntry(j, entry));
      if (matches.length !== 1) throw new Error('factory_portfolio_seed_source_mismatch');
      await validateReceipt(seed.directory, seed.planSha256, matches[0]);
      // Capability receipt validates normal historical model/tool controls; no executable/model call.
      const capability = JSON.parse((await readBounded(join(seed.directory, 'capability-receipt.json'), 16384)).toString('utf8'));
      await verifyCapability(seed.directory, seed.planSha256, plan, digestSchema.parse(capability.droidExecutableSha256));
      assigned.add(key); assignments.push({ inventoryKey: key, jobId: matches[0].id });
    }
    const campaign = { ...seed, source, seed: true, assignments };
    campaigns.push(campaign);
    for (const assignment of assignments) seededStates.push(await inspectPortfolioUnit(campaign, plan, assignment));
  }
  const directory = await createPrivateExportDirectory(options.workspace);
  await assertCapacity(directory, entries.reduce((n, e) => n + e.refs.reduce((a, r) => a + (r.bytes ?? 0), 0), 0) +
    eligible.size * 128 * 1024);
  for (const s of collected) await writeNew(snapshotPath(directory, s.source), s.bytes);
  await writeNew(join(directory, 'inventory.json'), serialize(entries));
  for (const s of collected) {
    const unassigned = s.entries.filter(e => e.disposition === 'eligible' && !assigned.has(e.key));
    for (const batch of inventoryBatches(unassigned)) {
      const prepared = await prepareCampaign({ workspace: options.workspace, cacheRoot: s.cacheRoot,
        source: s.source, selections: batch.map(e => e.selection!), sourceManifestSha256: s.sha256 });
      const plan = await loadCampaign(prepared.directory, prepared.planSha256), assignments = [];
      for (const entry of batch) {
        const matches = plan.jobs.filter(j => jobMatchesEntry(j, entry));
        if (matches.length !== 1) throw new Error('factory_portfolio_assignment_invalid');
        assignments.push({ inventoryKey: entry.key, jobId: matches[0].id }); assigned.add(entry.key);
      }
      campaigns.push({ directory: prepared.directory, planSha256: prepared.planSha256,
        source: s.source, seed: false, assignments });
    }
  }
  const portfolio = portfolioSchema.parse({ version: 1, model: MODEL, promptVersion: PROMPT_VERSION,
    cliVersion: CLI_VERSION, inventorySha256: hash(serialize(entries)),
    sources: collected.map(s => ({ source: s.source, cacheRoot: s.cacheRoot, manifestSha256: s.sha256 })), campaigns });
  const bytes = serialize(portfolio);
  await writeNew(join(directory, 'portfolio.json'), bytes);
  await writeNew(join(directory, 'progress.jsonl'), '');
  const summary = aggregate(seededStates, entries);
  summary.not_started = eligible.size - assignedSeedCount(campaigns);
  return { directory, portfolioSha256: hash(bytes), summary, eligible: eligible.size, plans: campaigns.length };
}
function assignedSeedCount(campaigns: Campaign[]) {
  return campaigns.filter(c => c.seed).reduce((n, c) => n + c.assignments.length, 0);
}
export async function loadPortfolio(directory: string, expectedHash: string) {
  if (!isAbsolute(directory) || !digestSchema.safeParse(expectedHash).success) throw new Error('factory_portfolio_pin_required');
  const bytes = await readBounded(join(directory, 'portfolio.json'), PL.metadataBytes);
  if (hash(bytes) !== expectedHash) throw new Error('factory_portfolio_hash_mismatch');
  const portfolio = portfolioSchema.parse(JSON.parse(bytes.toString('utf8')));
  const inventoryBytes = await readBounded(join(directory, 'inventory.json'), PL.metadataBytes);
  if (hash(inventoryBytes) !== portfolio.inventorySha256) throw new Error('factory_portfolio_inventory_changed');
  const entries = z.array(inventoryEntrySchema).max(PL.units).parse(JSON.parse(inventoryBytes.toString('utf8')));
  const byKey = new Map(entries.map(e => [e.key, e]));
  if (byKey.size !== entries.length || new Set(portfolio.sources.map(s => s.source)).size !== portfolio.sources.length) {
    throw new Error('factory_portfolio_inventory_invalid');
  }
  for (const s of portfolio.sources) {
    const snapshot = await readBounded(snapshotPath(directory, s.source), 16 * 1024 * 1024);
    const current = await readInventory(s.source, s.cacheRoot);
    if (hash(snapshot) !== s.manifestSha256 || current.sha256 !== s.manifestSha256) {
      throw new Error('factory_portfolio_manifest_changed');
    }
    const assessed = assessInventory(s.source, JSON.parse(snapshot.toString('utf8')));
    if (assessed.length !== entries.filter(e => e.source === s.source).length ||
      assessed.some(e => byKey.get(e.key)?.unitSha256 !== e.unitSha256)) {
      throw new Error('factory_portfolio_inventory_invalid');
    }
  }
  const plans = new Map<string, Plan>(), assigned = new Set<string>(), dirs = new Set<string>();
  for (const campaign of portfolio.campaigns) {
    if (!isAbsolute(campaign.directory) || dirs.has(campaign.directory)) throw new Error('factory_portfolio_assignment_invalid');
    dirs.add(campaign.directory);
    const plan = await loadCampaign(campaign.directory, campaign.planSha256);
    if (portfolio.sources.find(s => s.source === campaign.source)?.manifestSha256 !== plan.sourceManifestSha256 ||
      plan.jobs.length !== campaign.assignments.length) throw new Error('factory_portfolio_assignment_invalid');
    const usedJobs = new Set<string>();
    for (const a of campaign.assignments) {
      const entry = byKey.get(a.inventoryKey), job = plan.jobs.find(j => j.id === a.jobId);
      if (!entry || entry.disposition !== 'eligible' || assigned.has(a.inventoryKey) || usedJobs.has(a.jobId) ||
        !job || !jobMatchesEntry(job, entry)) throw new Error('factory_portfolio_assignment_invalid');
      assigned.add(a.inventoryKey); usedJobs.add(a.jobId);
    }
    plans.set(campaign.directory, plan);
  }
  if (assigned.size !== entries.filter(e => e.disposition === 'eligible').length) {
    throw new Error('factory_portfolio_assignment_missing');
  }
  return { portfolio, entries, plans };
}
function sanitized(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return /^factory_[a-z0-9_]{1,100}$/.test(code) ? code : 'factory_portfolio_unknown_safety_error';
}
async function assertManifestPins(portfolio: Portfolio) {
  for (const source of portfolio.sources) {
    if ((await readInventory(source.source, source.cacheRoot)).sha256 !== source.manifestSha256) {
      throw new Error('factory_portfolio_manifest_changed');
    }
  }
}
async function artifacts(directory: string) {
  const results: z.infer<typeof artifactSchema>[] = [];
  for (const file of failureFiles) if (await exists(join(directory, file))) {
    const bytes = await readBounded(join(directory, file), file === 'audit.jsonl' ? LIMITS.auditBytes : LIMITS.outputBytes);
    results.push({ file, sha256: hash(bytes), bytes: bytes.length });
  }
  return results;
}
/** A failed attempt needs real positive hook evidence; no audit means a global safety stop. */
async function validateFailedAudit(root: string, job: Job): Promise<string> {
  const { records } = await readAudit(jobDirectory(root, job.id));
  if (!records.length) throw new Error('factory_hook_evidence_missing');
  const sessions = new Set(records.map(r => r.sessionId));
  if (sessions.size !== 1 || records[0].sessionId === null) throw new Error('factory_hook_session_mismatch');
  const paths = new Map(job.inputs.map(p => [hash(join(jobDirectory(root, job.id), p.file)), p.sha256]));
  for (const record of records) {
    if (record.decision !== 'observed' || record.tool !== 'Read' ||
      record.inputSha256 === null || paths.get(record.requestedPathSha256) !== record.inputSha256) {
      throw new Error('factory_hook_unexpected_denial');
    }
  }
  return records[0].sessionId!;
}
export async function inspectPortfolioUnit(campaign: Campaign, plan: Plan, assignment: Campaign['assignments'][number],
  recordFailure = false, reason = 'factory_started_job_requires_reconciliation'): Promise<UnitState> {
  const job = plan.jobs.find(j => j.id === assignment.jobId)!;
  await validateJob(campaign.directory, plan, job);
  const directory = jobDirectory(campaign.directory, job.id);
  const state: UnitState = { inventoryKey: assignment.inventoryKey, jobId: job.id,
    sourceSha256: job.sourceSha256, planSha256: campaign.planSha256, status: 'not_started',
    candidateStatus: null, rowfacts: 0, sessionId: null, usage: null };
  if (await exists(join(directory, 'receipt.json'))) {
    if (await exists(join(directory, 'portfolio-failure.json'))) throw new Error('factory_portfolio_conflicting_evidence');
    await validateReceipt(campaign.directory, campaign.planSha256, job);
    const envelope = parseEnvelope((await readBounded(join(directory, 'stdout.json'), LIMITS.outputBytes)).toString('utf8'));
    const candidate = parseCandidate(envelope.result, job);
    return { ...state, status: candidate.status === 'partial' ? 'partial' :
      candidate.status === 'unreadable' ? 'unreadable' : 'successful',
    candidateStatus: candidate.status, rowfacts: candidate.facts.length, sessionId: envelope.session_id, usage: envelope.usage ?? null };
  }
  const evidence = await artifacts(directory);
  if (!evidence.length) {
    if (await exists(join(directory, 'portfolio-failure.json'))) throw new Error('factory_portfolio_failure_evidence_changed');
    if (campaign.seed) throw new Error('factory_portfolio_seed_receipt_missing');
    return state;
  }
  if (!evidence.some(a => a.file === 'started.json')) throw new Error('factory_portfolio_orphan_artifact');
  const start = z.object({
    version: z.literal(1), jobId: digestSchema, planSha256: digestSchema, sourceSha256: digestSchema,
    model: z.literal(MODEL), promptVersion: z.literal(PROMPT_VERSION), startedAt: z.string().datetime(),
  }).strict().parse(JSON.parse((await readBounded(join(directory, 'started.json'), 16384)).toString('utf8')));
  if (start.jobId !== job.id || start.planSha256 !== campaign.planSha256 || start.sourceSha256 !== job.sourceSha256 ||
    start.model !== MODEL || start.promptVersion !== PROMPT_VERSION) throw new Error('factory_portfolio_start_identity_mismatch');
  const sessionId = await validateFailedAudit(campaign.directory, job);
  if (evidence.some(a => a.file === 'stdout.json')) {
    try {
      const value = JSON.parse((await readBounded(join(directory, 'stdout.json'), LIMITS.outputBytes)).toString('utf8'));
      if (value && typeof value === 'object' && 'session_id' in value && value.session_id !== sessionId) {
        throw new Error('factory_hook_session_mismatch');
      }
      const usage = envelopeSchema.shape.usage.safeParse(value?.usage);
      if (usage.success) state.usage = usage.data ?? null;
    } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
  }
  const file = join(directory, 'portfolio-failure.json');
  if (await exists(file)) {
    const receipt = failureSchema.parse(JSON.parse((await readBounded(file, 16384)).toString('utf8')));
    if (receipt.jobId !== job.id || receipt.planSha256 !== campaign.planSha256 ||
      receipt.sourceSha256 !== job.sourceSha256 || receipt.sessionId !== sessionId ||
      serialize(receipt.artifacts) !== serialize(evidence) || !isOrdinarySourceFailure(receipt.reason)) {
      throw new Error('factory_portfolio_failure_evidence_changed');
    }
  } else if (recordFailure) {
    if (!isOrdinarySourceFailure(reason)) throw new Error('factory_portfolio_unknown_safety_error');
    await writeNew(file, serialize(failureSchema.parse({ version: 1, jobId: job.id, planSha256: campaign.planSha256,
      sourceSha256: job.sourceSha256, model: MODEL, promptVersion: PROMPT_VERSION,
      acceptance: 'requires_reconciliation', reason, sessionId, artifacts: evidence })));
  }
  return { ...state, status: 'failed', sessionId };
}
async function artifactBudget(roots: string[]) {
  let bytes = 0, files = 0;
  async function visit(root: string) {
    await noLinks(root);
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (++files > 1000000 || entry.isSymbolicLink()) throw new Error('factory_portfolio_artifact_limit');
      const path = join(root, entry.name), info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error('factory_path_invalid');
      if (info.isDirectory()) await visit(path);
      else if (info.isFile()) { bytes += info.size; if (bytes > PL.artifactBytes) throw new Error('factory_portfolio_artifact_limit'); }
      else throw new Error('factory_path_invalid');
    }
  }
  for (const root of roots) await visit(root);
  return bytes;
}
const progressSchema = z.object({
  version: z.literal(1), invocationId: z.string().uuid(), sequence: z.number().int().nonnegative(),
  event: z.enum(['start', 'step', 'finish', 'abort']), code: z.string().regex(/^[a-z][a-z0-9_]{1,100}$/),
  sourceAttempts: z.number().int().nonnegative(), capabilityAttempts: z.number().int().nonnegative(),
}).strict();
async function progress(root: string, record: z.infer<typeof progressSchema>) {
  const file = join(root, 'progress.jsonl'), bytes = await readBounded(file, PL.progressBytes);
  for (const line of bytes.toString('utf8').trim().split('\n').filter(Boolean)) progressSchema.parse(JSON.parse(line));
  const line = JSON.stringify(progressSchema.parse(record)) + '\n';
  if (bytes.length + Buffer.byteLength(line) > PL.progressBytes) throw new Error('factory_portfolio_progress_limit');
  await appendFile(file, line, { mode: 0o600 });
}
/** Permanent exclusive lock ledger. Only a matching final invocation receipt
 * closes a slot. Never unlink/rewrite a lock, and never reclaim an orphan. */
async function acquirePortfolioLock(root: string, portfolioSha256: string, invocationId: string) {
  for (let slot = 0; slot < 10000; slot++) {
    const file = join(root, slot === 0 ? 'portfolio.lock' : `portfolio-${String(slot).padStart(5, '0')}.lock`);
    if (!await exists(file)) {
      await writeNew(file, serialize({ version: 1, pid: process.pid, invocationId, portfolioSha256 }));
      return;
    }
    const previous = z.object({ version: z.literal(1), pid: z.number().int().positive(),
      invocationId: z.string().uuid(), portfolioSha256: digestSchema }).strict().parse(
      JSON.parse((await readBounded(file, 16384)).toString('utf8')));
    if (previous.portfolioSha256 !== portfolioSha256) throw new Error('factory_portfolio_lock_pin_mismatch');
    const receipt = join(root, `invocation-${previous.invocationId}.json`);
    if (!await exists(receipt)) throw new Error('factory_portfolio_lock_requires_reconciliation');
    const final = z.object({ version: z.literal(1), invocationId: z.string().uuid(),
      portfolioSha256: digestSchema, terminal: z.enum(['finished', 'stopped', 'aborted']) }).passthrough()
      .parse(JSON.parse((await readBounded(receipt, PL.metadataBytes)).toString('utf8')));
    if (final.invocationId !== previous.invocationId || final.portfolioSha256 !== portfolioSha256) {
      throw new Error('factory_portfolio_lock_receipt_mismatch');
    }
  }
  throw new Error('factory_portfolio_invocation_limit');
}
export type PortfolioRunOptions = {
  directory: string; portfolioSha256: string; executable: string; execute: boolean;
  maxSessionsTotal: number; stepJobs?: number; concurrency?: number; timeoutSeconds?: number;
  stepWallSeconds?: number; wallSecondsTotal?: number;
};
export async function runPortfolio(options: PortfolioRunOptions, transport: Transport = spawnTransport) {
  if (!options.execute) throw new Error('factory_explicit_execution_required');
  const stepJobs = options.stepJobs ?? 10, concurrency = options.concurrency ?? 2,
    timeoutSeconds = options.timeoutSeconds ?? 300, stepWallSeconds = options.stepWallSeconds ?? 900,
    wallSecondsTotal = options.wallSecondsTotal ?? 12 * 3600;
  if (!Number.isSafeInteger(options.maxSessionsTotal) || options.maxSessionsTotal < 1 ||
    options.maxSessionsTotal > PL.units || !Number.isSafeInteger(stepJobs) || stepJobs < 1 || stepJobs > 250 ||
    !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 2 ||
    !Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > LIMITS.timeoutSeconds ||
    !Number.isSafeInteger(stepWallSeconds) || stepWallSeconds < 1 || stepWallSeconds > LIMITS.wallSeconds ||
    !Number.isSafeInteger(wallSecondsTotal) || wallSecondsTotal < 1 || wallSecondsTotal > PL.wallSeconds ||
    !isAbsolute(options.executable)) throw new Error('factory_portfolio_execution_bounds_invalid');
  const deadline = Date.now() + wallSecondsTotal * 1000;
  const loaded = await loadPortfolio(options.directory, options.portfolioSha256);
  const eligible = loaded.entries.filter(e => e.disposition === 'eligible').length;
  if (options.maxSessionsTotal > eligible) throw new Error('factory_portfolio_execution_bounds_invalid');
  const root = options.directory, invocationId = randomUUID();
  await acquirePortfolioLock(root, options.portfolioSha256, invocationId);
  const abort = new AbortController();
  if (Date.now() >= deadline) abort.abort();
  const timer = setTimeout(() => abort.abort(), Math.max(1, deadline - Date.now())), signal = () => abort.abort();
  process.on('SIGINT', signal); process.on('SIGTERM', signal);
  let sourceAttempts = 0, capabilityAttempts = 0, steps = 0, sequence = 0, code = 'finished',
    terminal: 'finished' | 'stopped' | 'aborted' = 'finished', failure: unknown;
  let states: UnitState[] = [];
  const attemptedSourceJobs: Campaign['assignments'] = [];
  const note = (event: z.infer<typeof progressSchema>['event'], value: string) => progress(root, {
    version: 1, invocationId, sequence: sequence++, event, code: value, sourceAttempts, capabilityAttempts });
  const remaining = () => Math.max(1, Math.min(stepWallSeconds, Math.floor((deadline - Date.now()) / 1000)));
  try {
    await note('start', 'started');
    const binaryHash = hash(await readBounded(options.executable, LIMITS.executableBytes));
    const budgetByRoot = new Map<string, number>();
    for (const path of [root, ...loaded.portfolio.campaigns.map(c => c.directory)]) {
      budgetByRoot.set(path, await artifactBudget([path]));
    }
    const checkBudget = () => {
      const reserve = Math.max(1, stepJobs) * (2 * LIMITS.outputBytes + LIMITS.auditBytes + 16384) +
        PL.metadataBytes + PL.progressBytes;
      if ([...budgetByRoot.values()].reduce((sum, bytes) => sum + bytes, 0) > PL.artifactBytes - reserve) {
        throw new Error('factory_portfolio_artifact_limit');
      }
    };
    checkBudget();
    await assertCapacity(root, Math.min(stepJobs, options.maxSessionsTotal) * (2 * LIMITS.outputBytes + LIMITS.auditBytes));
    // Validate every completed/failure record before any additional source attempt.
    for (const campaign of loaded.portfolio.campaigns) {
      const plan = loaded.plans.get(campaign.directory)!;
      if (await exists(join(campaign.directory, 'capability-receipt.json'))) {
        await verifyCapability(campaign.directory, campaign.planSha256, plan, binaryHash);
      }
      for (const assignment of campaign.assignments) states.push(await inspectPortfolioUnit(campaign, plan, assignment, true));
      if (states.some(s => campaign.assignments.some(a => a.jobId === s.jobId) && s.status !== 'not_started') &&
        !await exists(join(campaign.directory, 'capability-receipt.json'))) throw new Error('factory_capability_receipt_required');
    }
    for (const campaign of loaded.portfolio.campaigns) {
      if (abort.signal.aborted || sourceAttempts >= options.maxSessionsTotal) break;
      const plan = loaded.plans.get(campaign.directory)!;
      const pending = campaign.assignments.filter(a => states.find(s => s.inventoryKey === a.inventoryKey)?.status === 'not_started');
      if (!pending.length) continue;
      if (await exists(join(campaign.directory, 'capability-receipt.json'))) {
        await verifyCapability(campaign.directory, campaign.planSha256, plan, binaryHash);
      } else {
        if (campaign.seed || await exists(join(jobDirectory(campaign.directory, plan.capability.id), 'started.json'))) {
          throw new Error('factory_capability_receipt_required');
        }
        capabilityAttempts++;
        await runCampaign({ directory: campaign.directory, planSha256: campaign.planSha256, executable: options.executable,
          execute: true, maxSessions: 1, concurrency: 1, timeoutSeconds,
          wallSeconds: remaining(), capabilityPilot: true, signal: abort.signal }, transport);
      }
      while (pending.length && sourceAttempts < options.maxSessionsTotal) {
        if (abort.signal.aborted) break;
        await assertManifestPins(loaded.portfolio);
        if (++steps > PL.steps) throw new Error('factory_portfolio_step_limit');
        const slice = pending.splice(0, Math.min(stepJobs, options.maxSessionsTotal - sourceAttempts));
        await assertCapacity(root, slice.length * (2 * LIMITS.outputBytes + LIMITS.auditBytes));
        let stepError = '';
        try {
          await runCampaign({ directory: campaign.directory, planSha256: campaign.planSha256, executable: options.executable,
            execute: true, maxSessions: slice.length, jobIds: slice.map(a => a.jobId), concurrency,
            timeoutSeconds, wallSeconds: remaining(), signal: abort.signal }, transport);
        } catch (error) {
          stepError = sanitized(error);
        }
        for (const assignment of slice) {
          if (await exists(join(jobDirectory(campaign.directory, assignment.jobId), 'started.json'))) {
            sourceAttempts++; attemptedSourceJobs.push(assignment);
          }
        }
        if (stepError && !isOrdinarySourceFailure(stepError)) throw new Error(stepError);
        await assertManifestPins(loaded.portfolio);
        let attempted = 0;
        for (const assignment of slice) {
          const state = await inspectPortfolioUnit(campaign, plan, assignment, true,
            stepError || 'factory_started_job_requires_reconciliation');
          if (state.status !== 'not_started') attempted++;
          states[states.findIndex(s => s.inventoryKey === assignment.inventoryKey)] = state;
        }
        budgetByRoot.set(root, await artifactBudget([root]));
        budgetByRoot.set(campaign.directory, await artifactBudget([campaign.directory]));
        checkBudget();
        await note('step', stepError || 'candidates_recorded');
        // A sibling failure may have stopped untouched jobs in this slice. They
        // stay eligible, not started: put them back in the same finite queue.
        const untouched = slice.filter(a => states.find(s => s.inventoryKey === a.inventoryKey)?.status === 'not_started');
        if (untouched.length && !abort.signal.aborted) {
          if (!attempted) throw new Error('factory_portfolio_step_no_progress');
          pending.unshift(...untouched);
        }
      }
    }
    await loadPortfolio(root, options.portfolioSha256);
    if (abort.signal.aborted) { terminal = 'stopped'; code = 'factory_campaign_stopped'; }
  } catch (error) {
    failure = error; code = sanitized(error); terminal = abort.signal.aborted && code === 'factory_campaign_stopped' ? 'stopped' : 'aborted';
    abort.abort();
  } finally {
    clearTimeout(timer); process.off('SIGINT', signal); process.off('SIGTERM', signal);
    await note(terminal === 'aborted' ? 'abort' : 'finish', code);
    await writeNew(join(root, `invocation-${invocationId}.json`), serialize({
        version: 1, invocationId, portfolioSha256: options.portfolioSha256, model: MODEL, promptVersion: PROMPT_VERSION,
        acceptance: 'requires_source_reconciliation',
        sources: loaded.portfolio.sources.map(s => ({ source: s.source, manifestSha256: s.manifestSha256 })),
        campaigns: loaded.portfolio.campaigns.map(c => ({ planSha256: c.planSha256, seed: c.seed })),
        terminal, code, sourceAttempts, capabilityAttempts, attemptedSourceJobs, statesAreLastValidated: true,
        summary: aggregate(states, loaded.entries), units: states,
    }));
  }
  if (failure && terminal === 'aborted') throw new Error(code);
  return { invocationId, terminal, code, sourceAttempts, capabilityAttempts, summary: aggregate(states, loaded.entries) };
}
