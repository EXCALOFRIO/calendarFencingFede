import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assessInventory, inventoryBatches } from '../src/lib/ingest/factory-batch/portfolio-inventory';
import { preparePortfolio, loadPortfolio, runPortfolio, type PortfolioRunOptions } from '../src/lib/ingest/factory-batch/portfolio';
import { prepareCampaign, loadCampaign } from '../src/lib/ingest/factory-batch/prepare';
import { runCampaign, selectedSourceJobs } from '../src/lib/ingest/factory-batch/runner';
import { hash, serialize, jobDirectory } from '../src/lib/ingest/factory-batch/files';
import { MODEL, PROMPT_VERSION, type Job } from '../src/lib/ingest/factory-batch/schemas';
import type { Invocation, Transport, TransportResult } from '../src/lib/ingest/factory-batch/transport';

// No native CLI/model/API calls: every child transport here is fake.
// ACL setup and flushed 4-MiB artifacts can exceed Vitest's 5s default while
// the unrelated importer is active. Model/session runtime bounds stay tested.
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
const directories = new Set<string>();
afterEach(async () => {
  for (const dir of directories) await rm(dir, { recursive: true, force: true });
  directories.clear();
});
async function fixture(count = 3, prepare = true) {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'factory-portfolio-test-')));
  directories.add(workspace);
  const cacheRoot = join(workspace, 'cache');
  await mkdir(join(cacheRoot, 'blobs'), { recursive: true });
  const units = [];
  for (let i = 0; i < count; i++) {
    const data = Buffer.from(`%PDF-1.4\nPUBLIC_${i}\n`), sha256 = hash(data);
    await writeFile(join(cacheRoot, 'blobs', `${sha256}.bin`), data);
    units.push({ id: `pdf-${sha256}`, tipo: 'pdf', estado: 'cached', url: `https://app.skermo.org/pdf-${i}`,
      sha256, bytes: data.length, httpStatus: 200, contentType: 'application/pdf' });
  }
  const manifest = serialize({ version: 1, unidades: [...units,
    { id: `pdf-${'f'.repeat(64)}`, tipo: 'pdf', estado: 'invalid_payload', url: 'https://app.skermo.org/invalid',
      sha256: null, bytes: null },
    { id: `html-${'e'.repeat(64)}`, tipo: 'html' }] });
  await writeFile(join(cacheRoot, 'manifest.json'), manifest);
  const executable = join(workspace, 'fake-droid.exe');
  await writeFile(executable, 'NEVER EXECUTED');
  const sources = [{ source: 'rfee' as const, cacheRoot, manifestSha256: hash(manifest) }];
  const base = { workspace, cacheRoot, executable, sources, units, manifestSha256: hash(manifest) };
  if (!prepare) return { ...base, prepared: null };
  const prepared = await preparePortfolio({ workspace, sources });
  directories.add(prepared.directory);
  const loaded = await loadPortfolio(prepared.directory, prepared.portfolioSha256);
  for (const c of loaded.portfolio.campaigns) directories.add(c.directory);
  return { ...base, prepared };
}
function candidate(job: Job, status = 'empty') {
  return { schemaVersion: 1, jobId: job.id, sourceSha256: job.sourceSha256,
    acceptance: 'requires_source_reconciliation', status,
    metadata: { title: null, dateRaw: null, seasonRaw: null, weaponRaw: null, genderRaw: null,
      categoryRaw: null, formatRaw: null, locationRaw: null, evidence: [] },
    reviewed: job.inputs.map(p => ({ sourceSha256: p.sha256, pages: status === 'unreadable' ? [] : [1],
      jsonPointers: [], status: status === 'unreadable' ? 'unreadable' : 'empty' })),
    facts: [], gaps: [{ code: status === 'partial' ? 'missing_pages' : status === 'unreadable' ? 'unreadable' : 'empty',
      detail: 'PUBLIC SOURCE GAP', sourceSha256: job.inputs[0].sha256 }] };
}
function envelope(result: unknown, sessionId: string) {
  return JSON.stringify({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1, num_turns: 1,
    result: JSON.stringify(result), session_id: sessionId, usage: { input_tokens: 5, output_tokens: 3, factory_credits: 0.01 } });
}
async function audit(job: Job, call: Invocation, sessionId: string, sentinel: boolean) {
  const records: unknown[] = job.inputs.map(pin => ({
    version: 1, sessionId, tool: 'Read', decision: 'observed',
    requestedPathSha256: hash(join(call.cwd, pin.file)), inputSha256: pin.sha256,
  }));
  if (sentinel) records.unshift({ version: 1, sessionId, tool: 'Read', decision: 'denied',
    requestedPathSha256: hash(join(call.cwd, '..', '..', 'sentinel.txt')), inputSha256: null });
  await writeFile(join(call.cwd, 'audit.jsonl'), records.map(r => JSON.stringify(r) + '\n').join(''));
}
type FakeContext = { call: Invocation; job: Job; sessionId: string; defaultOutput: TransportResult };
async function fakeFor(prepared: { directory: string; portfolioSha256: string },
  change?: (context: FakeContext) => Promise<TransportResult | void>) {
  const loaded = await loadPortfolio(prepared.directory, prepared.portfolioSha256);
  const jobs = new Map<string, Job>();
  for (const c of loaded.portfolio.campaigns) {
    const plan = loaded.plans.get(c.directory)!;
    for (const job of [...plan.jobs, plan.capability]) jobs.set(jobDirectory(c.directory, job.id), job);
  }
  const calls: Job[] = [], invocations: Invocation[] = [];
  const transport: Transport = async call => {
    invocations.push(call);
    if (call.signal.aborted) throw new Error('factory_campaign_stopped');
    if (call.args[0] === '--version') return { stdout: '0.230.0\n', stderr: '', exitCode: 0 };
    const job = jobs.get(call.cwd)!;
    expect(job).toBeDefined(); calls.push(job);
    const sessionId = randomUUID();
    await audit(job, call, sessionId, job.kind === 'capability');
    if (call.signal.aborted) throw new Error('factory_campaign_stopped');
    const defaultOutput = { stdout: envelope(job.kind === 'capability'
      ? { capability: 'factory-read-v1', allowedObserved: true, deniedObserved: true } : candidate(job), sessionId),
    stderr: '', exitCode: 0 };
    return (await change?.({ call, job, sessionId, defaultOutput })) ?? defaultOutput;
  };
  return { ...loaded, transport, calls, invocations };
}
function options(f: Awaited<ReturnType<typeof fixture>>, more: Partial<PortfolioRunOptions> = {}): PortfolioRunOptions {
  return { directory: f.prepared!.directory, portfolioSha256: f.prepared!.portfolioSha256,
    executable: f.executable, execute: true, maxSessionsTotal: f.units.length, ...more };
}
async function preserveSeeds(workspace: string, root: string) {
  directories.add(root);
  const entries = await readdir(root);
  expect(entries).toContain('plan.json');
  return workspace;
}

describe('whole-inventory Factory portfolio, fake transport only', () => {
  it('assesses all PDFs/FIE competitions, explicitly excludes HTML/auxiliary and records source gaps', () => {
    const national = assessInventory('rfee', { version: 1, unidades: [
      { tipo: 'pdf', id: `pdf-${'a'.repeat(64)}`, estado: 'cached', url: 'https://app.skermo.org/a',
        sha256: 'a'.repeat(64), bytes: 100 },
      { tipo: 'pdf', id: `pdf-${'b'.repeat(64)}`, estado: 'invalid_payload', url: 'https://app.skermo.org/b',
        sha256: null, bytes: null },
      { tipo: 'html', id: `html-${'c'.repeat(64)}` },
    ] });
    expect(national.map(e => e.reason).sort()).toEqual(['eligible', 'html', 'invalid_pdf']);
    const unit = (id: number | null, endpoints: string[]) => ({ key: id === null ? 'athlete' : `2025:${id}`,
      season: 2025, competitionId: id, endpoints });
    const fie = assessInventory('fie', { version: 1, units: { athlete: unit(null, []),
      '2025:1': unit(1, ['/result']), '2025:2': unit(2, ['/result']) },
    endpoints: { a: { unitKey: '2025:1', endpoint: '/result', url: 'https://fie.org/1', completeness: 'complete',
      blobSha256: 'a'.repeat(64), bytes: 200 },
    b: { unitKey: '2025:2', endpoint: '/result', url: 'https://fie.org/2', completeness: 'empty',
      blobSha256: null, bytes: 0 } } });
    expect(fie.map(e => e.reason).sort()).toEqual(['auxiliary', 'eligible', 'no_usable_input']);
  });
  it('splits per-source plans at 250 and byte caps, never splits a competition', () => {
    const entries = assessInventory('rfee', { version: 1, unidades: Array.from({ length: 501 }, (_, i) => ({
      tipo: 'pdf', id: `pdf-${hash(String(i))}`, estado: 'cached', url: `https://app.skermo.org/${i}`,
      sha256: hash(String(i)), bytes: 1 })) });
    expect(inventoryBatches(entries).map(b => b.length)).toEqual([250, 250, 1]);
    for (const e of entries) e.refs[0].bytes = 3 * 1024 * 1024;
    expect(inventoryBatches(entries).every(b => b.length <= 85)).toBe(true);
  });
  it('prepares private complete immutable inventory offline, pins both snapshots, and rejects drift', async () => {
    const f = await fixture(2), prepared = f.prepared!;
    expect(prepared.eligible).toBe(2); expect(prepared.summary.sourceGaps).toBe(1); expect(prepared.summary.excluded).toBe(1);
    expect(prepared.plans).toBe(1);
    const inventory = await readFile(join(prepared.directory, 'inventory.json'), 'utf8');
    expect(JSON.parse(inventory)).toHaveLength(4);
    await writeFile(join(f.cacheRoot, 'manifest.json'), '{}');
    await expect(loadPortfolio(prepared.directory, prepared.portfolioSha256)).rejects.toThrow('factory_inventory_version_invalid');
  });
  it('validates explicit source subsets before any transport call and excludes ambiguous unrelated jobs', async () => {
    const f = await fixture(2), fake = await fakeFor(f.prepared!), campaign = fake.portfolio.campaigns[0],
      plan = fake.plans.get(campaign.directory)!;
    for (const jobIds of [[plan.capability.id], ['0'.repeat(64)], [plan.jobs[0].id, plan.jobs[0].id]]) {
      expect(() => selectedSourceJobs(plan, { jobIds, maxSessions: 2 })).toThrow('factory_job_subset_invalid');
    }
    expect(() => selectedSourceJobs(plan, { jobIds: plan.jobs.map(j => j.id), maxSessions: 1 })).toThrow('factory_job_subset_invalid');
    await runCampaign({ directory: campaign.directory, planSha256: campaign.planSha256, executable: f.executable,
      execute: true, maxSessions: 1, capabilityPilot: true }, fake.transport);
    await writeFile(join(jobDirectory(campaign.directory, plan.jobs[0].id), 'started.json'), '{}');
    const result = await runCampaign({ directory: campaign.directory, planSha256: campaign.planSha256, executable: f.executable,
      execute: true, maxSessions: 1, jobIds: [plan.jobs[1].id] }, fake.transport);
    expect(result.candidates).toBe(1);
    expect(fake.calls.filter(j => j.id === plan.jobs[0].id)).toHaveLength(0);
  });
  it('validates and omits completed explicit seeds, never blindly skips by hash', async () => {
    const f = await fixture(2, false);
    const seed = await prepareCampaign({ workspace: f.workspace, cacheRoot: f.cacheRoot, source: 'rfee',
      selections: [{ tipo: 'pdf', id: f.units[0].id }], sourceManifestSha256: f.manifestSha256 });
    await preserveSeeds(f.workspace, seed.directory);
    const plan = await loadCampaign(seed.directory, seed.planSha256), calls: string[] = [];
    const transport: Transport = async call => {
      if (call.args[0] === '--version') return { stdout: '0.230.0', stderr: '', exitCode: 0 };
      const job = [...plan.jobs, plan.capability].find(j => jobDirectory(seed.directory, j.id) === call.cwd)!;
      calls.push(job.id);
      const sessionId = randomUUID(); await audit(job, call, sessionId, job.kind === 'capability');
      return { stdout: envelope(job.kind === 'capability'
        ? { capability: 'factory-read-v1', allowedObserved: true, deniedObserved: true } : candidate(job, 'partial'), sessionId),
      stderr: '', exitCode: 0 };
    };
    const run = { directory: seed.directory, planSha256: seed.planSha256, executable: f.executable, execute: true, maxSessions: 1 };
    await runCampaign({ ...run, capabilityPilot: true }, transport); await runCampaign(run, transport);
    const prepared = await preparePortfolio({ workspace: f.workspace, sources: f.sources,
      seeds: [{ directory: seed.directory, planSha256: seed.planSha256 }] });
    directories.add(prepared.directory);
    const fake = await fakeFor(prepared);
    for (const c of fake.portfolio.campaigns) if (!c.seed) directories.add(c.directory);
    expect(fake.portfolio.campaigns.filter(c => c.seed)).toHaveLength(1);
    expect(fake.portfolio.campaigns.filter(c => !c.seed)[0].assignments).toHaveLength(1);
    expect(prepared.summary.partial).toBe(1);
    const result = await runPortfolio({ ...options({ ...f, prepared }), maxSessionsTotal: 2 }, fake.transport);
    expect(result.sourceAttempts).toBe(1); expect(result.summary.partial).toBe(1);
    expect(fake.calls.some(j => j.id === plan.jobs[0].id)).toBe(false);
    expect(calls).toHaveLength(2);
  });
  it('executes finite new subsets, resumes one capability per plan and never duplicates accepted sessions', async () => {
    const f = await fixture(3), fake = await fakeFor(f.prepared!);
    const first = await runPortfolio(options(f, { maxSessionsTotal: 1, stepJobs: 1 }), fake.transport);
    expect(first.sourceAttempts).toBe(1); expect(first.capabilityAttempts).toBe(1);
    const second = await runPortfolio(options(f, { maxSessionsTotal: 3, stepJobs: 1 }), fake.transport);
    expect(second.sourceAttempts).toBe(2); expect(second.capabilityAttempts).toBe(0);
    const third = await runPortfolio(options(f), fake.transport);
    expect(third.sourceAttempts).toBe(0); expect(third.summary.successful).toBe(3);
    const sourceCalls = fake.calls.filter(j => j.kind !== 'capability');
    expect(sourceCalls).toHaveLength(3); expect(new Set(sourceCalls.map(j => j.id)).size).toBe(3);
  });
  it('continues untouched units after an ordinary schema failure, preserving immutable failed evidence on resume', async () => {
    const f = await fixture(3);
    let sourceCount = 0;
    const fake = await fakeFor(f.prepared!, async context => {
      if (context.job.kind === 'capability') return;
      if (++sourceCount === 1) return { stdout: envelope({ schemaVersion: 999 }, context.sessionId), stderr: '', exitCode: 0 };
    });
    const result = await runPortfolio(options(f, { stepJobs: 3, concurrency: 1 }), fake.transport);
    expect(result.sourceAttempts).toBe(3);
    expect(result.summary.failed).toBe(1); expect(result.summary.successful).toBe(2);
    const final = JSON.parse(await readFile(join(f.prepared!.directory, `invocation-${result.invocationId}.json`), 'utf8'));
    expect(final.units.find((u: { status: string }) => u.status === 'failed').usage.factory_credits).toBe(0.01);
    const failedJob = fake.calls.find(j => j.kind !== 'capability')!,
      campaign = fake.portfolio.campaigns[0], file = join(jobDirectory(campaign.directory, failedJob.id), 'portfolio-failure.json');
    const before = await readFile(file);
    const next = await runPortfolio(options(f), fake.transport);
    expect(next.sourceAttempts).toBe(0); expect(next.summary.failed).toBe(1);
    expect(await readFile(file)).toEqual(before);
    expect(fake.calls.filter(j => j.id === failedJob.id)).toHaveLength(1);
    await writeFile(join(jobDirectory(campaign.directory, failedJob.id), 'stdout.json'), 'changed');
    await expect(runPortfolio(options(f), fake.transport)).rejects.toThrow('factory_portfolio_failure_evidence_changed');
  });
  it('preserves bounded partial stdout/stderr on timeout and advances other untouched units', async () => {
    const f = await fixture(2);
    let first = true;
    const fake = await fakeFor(f.prepared!, async context => {
      if (context.job.kind === 'capability' || !first) return;
      first = false;
      throw Object.assign(new Error('factory_job_timeout'), {
        partialOutput: { stdout: Buffer.from('{"partial":'), stderr: Buffer.from('PRIVATE PUBLIC OUTPUT') },
      });
    });
    const result = await runPortfolio(options(f, { concurrency: 1 }), fake.transport);
    expect(result.summary.failed).toBe(1); expect(result.summary.successful).toBe(1);
    const job = fake.calls.find(j => j.kind !== 'capability')!;
    const directory = jobDirectory(fake.portfolio.campaigns[0].directory, job.id);
    expect(await readFile(join(directory, 'stdout.json'), 'utf8')).toBe('{"partial":');
    expect(await readFile(join(directory, 'stderr.txt'), 'utf8')).toBe('PRIVATE PUBLIC OUTPUT');
  });
  it('globally aborts unauthorized hook evidence and never launches subsequent units', async () => {
    const f = await fixture(3);
    const fake = await fakeFor(f.prepared!, async context => {
      if (context.job.kind === 'capability') return;
      await writeFile(join(context.call.cwd, 'audit.jsonl'), JSON.stringify({ version: 1, sessionId: context.sessionId,
        tool: 'Read', decision: 'denied', requestedPathSha256: '0'.repeat(64), inputSha256: null }) + '\n');
    });
    await expect(runPortfolio(options(f, { concurrency: 1 }), fake.transport)).rejects.toThrow('factory_hook_unexpected_denial');
    expect(fake.calls.filter(j => j.kind !== 'capability')).toHaveLength(1);
    const final = (await readdir(f.prepared!.directory)).find(n => n.startsWith('invocation-'))!;
    expect(JSON.parse(await readFile(join(f.prepared!.directory, final), 'utf8')).terminal).toBe('aborted');
  });
  it('continues after output-cap failure while preserving only the bounded captured prefix', async () => {
    const f = await fixture(2);
    let first = true;
    const fake = await fakeFor(f.prepared!, async context => {
      if (context.job.kind === 'capability' || !first) return;
      first = false;
      return { stdout: 'x'.repeat(4 * 1024 * 1024), stderr: 'OVERFLOW', exitCode: 0 };
    });
    const result = await runPortfolio(options(f, { concurrency: 1 }), fake.transport);
    expect(result.summary.failed).toBe(1); expect(result.summary.successful).toBe(1);
    const job = fake.calls.find(j => j.kind !== 'capability')!, directory = jobDirectory(fake.portfolio.campaigns[0].directory, job.id);
    expect((await readFile(join(directory, 'stdout.json'))).length).toBe(4 * 1024 * 1024);
    expect((await readFile(join(directory, 'stderr.txt'))).length).toBe(0);
  });
  it('step wall expiry cancels the current source and advances untouched sources within the global bound', async () => {
    const f = await fixture(2);
    let first = true;
    const fake = await fakeFor(f.prepared!, async context => {
      if (context.job.kind === 'capability' || !first) return;
      first = false;
      return new Promise((_, reject) => {
        context.call.signal.addEventListener('abort', () => reject(new Error('factory_campaign_stopped')), { once: true });
      });
    });
    const result = await runPortfolio(options(f, { concurrency: 1, stepWallSeconds: 1, wallSecondsTotal: 10 }), fake.transport);
    expect(result.terminal).toBe('finished'); expect(result.summary.failed).toBe(1);
    expect(result.summary.successful).toBe(1); expect(result.sourceAttempts).toBe(2);
  });
  it('globally aborts missing audit, integrity drift, unknown errors and failed own-tree teardown', async () => {
    for (const failure of ['missing', 'drift', 'unknown', 'teardown']) {
      const f = await fixture(2);
      const fake = await fakeFor(f.prepared!, async context => {
        if (context.job.kind === 'capability') return;
        if (failure === 'missing') await rm(join(context.call.cwd, 'audit.jsonl'));
        if (failure === 'drift') await writeFile(join(context.call.cwd, context.job.inputs[0].file), 'DRIFT');
        if (failure === 'unknown') throw new Error('SECRET RAW NAME / PRIVATE PATH');
        if (failure === 'teardown') throw new Error('factory_tree_stop_failed');
      });
      await expect(runPortfolio(options(f, { concurrency: 1 }), fake.transport)).rejects.toThrow();
      expect(fake.calls.filter(j => j.kind !== 'capability')).toHaveLength(1);
    }
  }, 30000);
  it('validates finite execution bounds before any transport or model call', async () => {
    const f = await fixture(1), fake = await fakeFor(f.prepared!);
    await expect(runPortfolio(options(f, { execute: false }), fake.transport)).rejects.toThrow('factory_explicit_execution_required');
    for (const extra of [{ maxSessionsTotal: 0 }, { concurrency: 3 }, { timeoutSeconds: 601 },
      { stepWallSeconds: 3601 }, { wallSecondsTotal: 48 * 3600 + 1 }, { stepJobs: 251 }, { maxSessionsTotal: 2 }]) {
      await expect(runPortfolio(options(f, extra), fake.transport)).rejects.toThrow('factory_portfolio_execution_bounds_invalid');
    }
    expect(fake.invocations).toHaveLength(0);
  });
  it.each([
    'factory_child_nonzero', 'factory_envelope_invalid', 'factory_child_start_failed',
    'factory_child_exit_invalid', 'factory_output_encoding_invalid',
  ])('globally aborts %s even with valid source Read audit', async (failure) => {
    const f = await fixture(2);
    const fake = await fakeFor(f.prepared!, async context => {
      if (context.job.kind === 'capability') return;
      if (failure === 'factory_child_nonzero') return { ...context.defaultOutput, exitCode: 1 };
      if (failure === 'factory_envelope_invalid') return { ...context.defaultOutput, stdout: '{}' };
      throw new Error(failure);
    });
    await expect(runPortfolio(options(f, { concurrency: 1 }), fake.transport)).rejects.toThrow(failure);
    expect(fake.calls.filter(j => j.kind !== 'capability')).toHaveLength(1);
  });
  it('bounds concurrency at two, drains cancelled siblings and never retries started siblings', async () => {
    const f = await fixture(3);
    let active = 0, peak = 0, source = 0, drained = false;
    const fake = await fakeFor(f.prepared!, async context => {
      if (context.job.kind === 'capability') return;
      active++; peak = Math.max(peak, active);
      const number = ++source;
      if (number === 1) {
        await new Promise(resolve => setTimeout(resolve, 25)); active--;
        return { stdout: envelope({}, context.sessionId), stderr: '', exitCode: 0 };
      }
      if (number === 2) return new Promise((_, reject) => {
        context.call.signal.addEventListener('abort', () => { drained = true; active--; reject(new Error('factory_campaign_stopped')); }, { once: true });
      });
      active--;
    });
    const result = await runPortfolio(options(f, { concurrency: 2 }), fake.transport);
    expect(peak).toBe(2); expect(drained).toBe(true); expect(active).toBe(0);
    expect(result.summary.failed).toBe(2); expect(result.summary.successful).toBe(1);
    expect(fake.calls.filter(j => j.kind !== 'capability')).toHaveLength(3);
  });
  it('enforces global finite wall time, preserves stopped attempts and no unbounded watcher', async () => {
    const f = await fixture(2);
    const fake = await fakeFor(f.prepared!, async context => {
      if (context.job.kind === 'capability') return;
      return new Promise((_, reject) => {
        context.call.signal.addEventListener('abort', () => reject(new Error('factory_campaign_stopped')), { once: true });
      });
    });
    const result = await runPortfolio(options(f, { concurrency: 1, wallSecondsTotal: 3 }), fake.transport);
    // Integer-second step caps can expire before the global deadline, allowing
    // another untouched unit in the remaining fraction. Neither may be retried.
    expect(result.terminal).toBe('stopped');
    const started = fake.calls.filter(j => j.kind !== 'capability');
    expect(started.length).toBeGreaterThanOrEqual(1); expect(started.length).toBeLessThanOrEqual(2);
    expect(result.sourceAttempts).toBe(started.length); expect(result.summary.failed).toBe(started.length);
    const next = await fakeFor(f.prepared!);
    const resumed = await runPortfolio(options(f), next.transport);
    expect(resumed.sourceAttempts).toBe(2 - started.length); expect(resumed.summary.failed).toBe(started.length);
    expect(new Set([...started, ...next.calls.filter(j => j.kind !== 'capability')].map(j => j.id)).size).toBe(2);
  });
  it.each([
    'factory_tree_stop_failed', 'factory_tree_drain_failed', 'factory_child_nonzero',
    'factory_envelope_invalid', 'factory_hook_evidence_invalid',
  ])('does not mask a fatal sibling %s behind an ordinary candidate failure', async (failure) => {
    const f = await fixture(3);
    let sources = 0;
    let bothStarted!: () => void;
    const ready = new Promise<void>(resolve => { bothStarted = resolve; });
    const fake = await fakeFor(f.prepared!, async context => {
      if (context.job.kind === 'capability') return;
      if (++sources === 1) {
        await ready;
        return { stdout: envelope({}, context.sessionId), stderr: '', exitCode: 0 };
      }
      bothStarted();
      return new Promise((resolve, reject) => {
        context.call.signal.addEventListener('abort', () => {
          if (failure === 'factory_child_nonzero') resolve({ ...context.defaultOutput, exitCode: 1 });
          else if (failure === 'factory_envelope_invalid') resolve({ ...context.defaultOutput, stdout: '{}' });
          else reject(new Error(failure));
        }, { once: true });
      });
    });
    await expect(runPortfolio(options(f, { concurrency: 2 }), fake.transport)).rejects.toThrow(failure);
    expect(fake.calls.filter(j => j.kind !== 'capability')).toHaveLength(2);
  });
  it('resume classifies ambiguous safe-audited starts without relaunch and aborts unaudited starts', async () => {
    const f = await fixture(2), fake = await fakeFor(f.prepared!), campaign = fake.portfolio.campaigns[0],
      plan = fake.plans.get(campaign.directory)!;
    await runCampaign({ directory: campaign.directory, planSha256: campaign.planSha256, executable: f.executable,
      execute: true, maxSessions: 1, capabilityPilot: true }, fake.transport);
    const job = plan.jobs[0], directory = jobDirectory(campaign.directory, job.id);
    await writeFile(join(directory, 'started.json'), serialize({ version: 1, jobId: job.id,
      planSha256: campaign.planSha256, sourceSha256: job.sourceSha256, model: MODEL,
      promptVersion: PROMPT_VERSION, startedAt: new Date().toISOString() }));
    await audit(job, { cwd: directory } as Invocation, randomUUID(), false);
    const result = await runPortfolio(options(f), fake.transport);
    expect(result.summary.failed).toBe(1); expect(result.sourceAttempts).toBe(1);
    expect(fake.calls.some(j => j.id === job.id)).toBe(false);
    await rm(join(directory, 'audit.jsonl'));
    await expect(runPortfolio(options(f), fake.transport)).rejects.toThrow();
  });
  it('progress/console summaries contain only codes/counts and private receipts retain sessions/consumption', async () => {
    const f = await fixture(1), fake = await fakeFor(f.prepared!);
    const result = await runPortfolio(options(f), fake.transport);
    const progress = await readFile(join(f.prepared!.directory, 'progress.jsonl'), 'utf8');
    expect(progress).not.toContain('PUBLIC'); expect(progress).not.toContain(f.workspace);
    expect(progress).not.toContain('https:'); expect(progress).not.toContain('participant');
    const receipt = JSON.parse(await readFile(join(f.prepared!.directory, `invocation-${result.invocationId}.json`), 'utf8'));
    expect(receipt.units[0].sessionId).toMatch(/^[a-f0-9-]{36}$/);
    expect(receipt.units[0].usage.factory_credits).toBe(0.01);
    expect(receipt.units[0].sourceSha256).toHaveLength(64);
    expect(receipt.sources[0].manifestSha256).toBe(f.manifestSha256);
  });
  it('keeps exclusive portfolio lock ledger immutable and refuses orphan locks without polling or killing', async () => {
    const f = await fixture(1), fake = await fakeFor(f.prepared!);
    await runPortfolio(options(f), fake.transport);
    const lock = join(f.prepared!.directory, 'portfolio.lock'), before = await readFile(lock);
    await runPortfolio(options(f), fake.transport);
    expect(await readFile(lock)).toEqual(before);
    const orphan = join(f.prepared!.directory, 'portfolio-00002.lock');
    await writeFile(orphan, serialize({ version: 1, pid: 12345, invocationId: randomUUID(),
      portfolioSha256: f.prepared!.portfolioSha256 }));
    const calls = fake.calls.length;
    await expect(runPortfolio(options(f), fake.transport)).rejects.toThrow('factory_portfolio_lock_requires_reconciliation');
    expect(fake.calls).toHaveLength(calls);
    expect(JSON.parse(await readFile(orphan, 'utf8')).pid).toBe(12345);
  });
});
