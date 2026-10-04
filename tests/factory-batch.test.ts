import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { prepareCampaign, loadCampaign } from '../src/lib/ingest/factory-batch/prepare';
import { hash, serialize, jobDirectory } from '../src/lib/ingest/factory-batch/files';
import { LIMITS, parseCandidate, parseEnvelope, type Job, type Plan } from '../src/lib/ingest/factory-batch/schemas';
import { childEnvironment, type Transport, type Invocation } from '../src/lib/ingest/factory-batch/transport';
import { runCampaign, invocationArguments } from '../src/lib/ingest/factory-batch/runner';
import { quoteHookPath } from '../src/lib/ingest/factory-batch/hook';

// All transport model calls are fake. Only the trusted local hook is executed.
const created: string[] = [];
afterEach(async () => {
  for (const directory of created.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function fixture(count = 1) {
  const workspace = await mkdtemp(join(tmpdir(), 'factory-batch-test-'));
  created.push(workspace);
  const cacheRoot = join(workspace, 'cache');
  await mkdir(join(cacheRoot, 'blobs'), { recursive: true });
  const unidades = [];
  for (let i = 0; i < count; i++) {
    const data = Buffer.from(`%PDF-1.4\nPUBLIC_FAKE_${i}\n`), sha256 = hash(data);
    await writeFile(join(cacheRoot, 'blobs', `${sha256}.bin`), data);
    unidades.push({ id: `pdf-${sha256}`, tipo: 'pdf', estado: 'cached', url: `https://app.skermo.org/public-${i}.pdf`,
      sha256, bytes: data.length, httpStatus: 200, contentType: 'application/pdf', asociaciones: [] });
  }
  const manifest = serialize({ version: 1, tipo: 'evidencia-publica-rfee', unidades });
  await writeFile(join(cacheRoot, 'manifest.json'), manifest);
  const prepared = await prepareCampaign({ workspace, cacheRoot, source: 'rfee',
    selections: unidades.map(u => ({ tipo: 'pdf', id: u.id })), sourceManifestSha256: hash(manifest) });
  created.push(prepared.directory);
  const executable = join(workspace, 'fake-droid.exe');
  await writeFile(executable, 'fake executable; never executed');
  const plan = await loadCampaign(prepared.directory, prepared.planSha256);
  return { ...prepared, executable: await realpath(executable), plan, workspace };
}
function candidate(job: Job) {
  return {
    schemaVersion: 1, jobId: job.id, sourceSha256: job.sourceSha256,
    acceptance: 'requires_source_reconciliation', status: 'empty',
    metadata: { title: null, dateRaw: null, seasonRaw: null, weaponRaw: null, genderRaw: null,
      categoryRaw: null, formatRaw: null, locationRaw: null, evidence: [] },
    reviewed: job.inputs.map(p => ({ sourceSha256: p.sha256,
      pages: p.kind === 'pdf' ? [1] : [], jsonPointers: p.kind === 'json' ? [''] : [], status: 'empty' })),
    facts: [], gaps: [{ code: 'empty', detail: 'No sporting facts in test fixture', sourceSha256: job.inputs[0].sha256 }],
  };
}
function envelope(result: unknown, sessionId: string) {
  return JSON.stringify({ type: 'result', subtype: 'success', is_error: false,
    duration_ms: 1, num_turns: 1, result: JSON.stringify(result), session_id: sessionId });
}
async function audit(root: string, job: Job, sessionId: string, pilot: boolean) {
  const records = job.inputs.map(p => ({ version: 1, sessionId, tool: 'Read', decision: 'observed',
    requestedPathSha256: hash(join(jobDirectory(root, job.id), p.file)), inputSha256: p.sha256 }));
  if (pilot) records.unshift({ version: 1, sessionId, tool: 'Read', decision: 'denied',
    requestedPathSha256: hash(join(root, 'sentinel.txt')), inputSha256: null as unknown as string });
  await writeFile(join(jobDirectory(root, job.id), 'audit.jsonl'), records.map(r => JSON.stringify(r) + '\n').join(''));
}
function fakeTransport(root: string, plan: Plan, mutate?: (job: Job, call: Invocation) => Promise<void>): Transport {
  return async call => {
    if (call.args[0] === '--version') return { stdout: '0.230.0\n', stderr: '', exitCode: 0 };
    const job = [...plan.jobs, plan.capability].find(j => jobDirectory(root, j.id) === call.cwd)!;
    expect(job).toBeDefined();
    await mutate?.(job, call);
    const sessionId = randomUUID();
    await audit(root, job, sessionId, job.kind === 'capability');
    return { stdout: envelope(job.kind === 'capability'
      ? { capability: 'factory-read-v1', allowedObserved: true, deniedObserved: true } : candidate(job), sessionId),
    stderr: '', exitCode: 0 };
  };
}
async function pilot(f: Awaited<ReturnType<typeof fixture>>) {
  return runCampaign({ ...f, execute: true, maxSessions: 1, capabilityPilot: true },
    fakeTransport(f.directory, f.plan));
}
function hook(jobDir: string, input: unknown): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(jobDir, 'read-hook.mjs')], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', c => { stdout += c; }); child.stderr.on('data', c => { stderr += c; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
    child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  });
}

describe('Factory bounded public extraction', () => {
  it('prepares deterministic pinned public inputs and preflights without transport', async () => {
    const f = await fixture(2);
    expect(f.plan.jobs).toHaveLength(2);
    expect(f.plan.model).toBe('gpt-6-sol');
    expect(f.plan.jobs.every(j => j.inputs.length === 1 && j.kind === 'rfee')).toBe(true);
    const settings = JSON.parse(await readFile(join(jobDirectory(f.directory, f.plan.jobs[0].id), '.factory/settings.json'), 'utf8'));
    expect(settings.cloudSessionSync).toBe(false);
    expect(settings.hooksDisabled).toBe(false);
    expect(settings.sessionDefaultSettings.autonomyLevel).toBe('off');
    expect(invocationArguments('private-job')).not.toContain('-p');
    expect(invocationArguments('private-job')).toContain('--only-tools');
    expect(invocationArguments('private-job')).not.toContain('--auto');
    const capabilityAgents = await readFile(join(jobDirectory(f.directory, f.plan.capability.id), 'AGENTS.md'), 'utf8');
    const sourceAgents = await readFile(join(jobDirectory(f.directory, f.plan.jobs[0].id), 'AGENTS.md'), 'utf8');
    expect(capabilityAgents).toContain('Intentionally attempt Read');
    expect(sourceAgents).not.toContain('sentinel');
    expect(sourceAgents).toContain('Only Read of the exact pinned public input files');
  });
  it('rejects wrong plan/source pins and mutated controls/inputs', async () => {
    const f = await fixture();
    await expect(loadCampaign(f.directory, '0'.repeat(64))).rejects.toThrow('factory_plan_hash_mismatch');
    const input = join(jobDirectory(f.directory, f.plan.jobs[0].id), f.plan.jobs[0].inputs[0].file);
    await writeFile(input, 'modified');
    await expect(loadCampaign(f.directory, f.planSha256)).rejects.toThrow('factory_input_changed');
  });
  it('strips app/cloud/browser credentials and unsafe Node injection but preserves normal Factory login', () => {
    const env = childEnvironment({ PATH: 'system-path', USERPROFILE: 'home', FACTORY_API_KEY: 'test-auth',
      DATABASE_URL: 'db', CLOUDFLARE_API_TOKEN: 'cloud', VERCEL_TOKEN: 'deploy',
      AWS_SECRET_ACCESS_KEY: 'cloud', AGENT_BROWSER_CDP: 'browser', NODE_OPTIONS: '--require evil',
      FACTORY_DROID_AUTO_UPDATE_ENABLED: 'true', UNKNOWN_TOKEN: 'unknown' });
    expect(Object.keys(env).sort()).toEqual([
      'FACTORY_API_KEY', 'FACTORY_DROID_AUTO_UPDATE_ENABLED', 'NODE_ENV', 'PATH', 'USERPROFILE',
    ]);
    expect(env.FACTORY_DROID_AUTO_UPDATE_ENABLED).toBe('false');
    expect(env.NODE_ENV).toBe('production');
  });
  it('hook permits only exact unchanged Read input with no permission override', async () => {
    const f = await fixture(), job = f.plan.jobs[0], directory = jobDirectory(f.directory, job.id);
    const output = await hook(directory, { hook_event_name: 'PreToolUse', session_id: randomUUID(),
      tool_name: 'Read', tool_input: { file_path: join(directory, job.inputs[0].file) } });
    expect(output).toEqual({ code: 0, stdout: '', stderr: '' });
    const log = await readFile(join(directory, 'audit.jsonl'), 'utf8');
    expect(log).not.toContain(directory);
    expect(log).not.toContain('PUBLIC_FAKE');
    expect(JSON.parse(log).decision).toBe('observed');
  });
  it('hook denies malformed input, other tools, traversal, sentinel, extra arguments and mutations with exit 2', async () => {
    const f = await fixture(), job = f.plan.jobs[0], directory = jobDirectory(f.directory, job.id);
    const base = { hook_event_name: 'PreToolUse', session_id: randomUUID(),
      tool_name: 'Read', tool_input: { file_path: join(directory, job.inputs[0].file) } };
    const cases = ['invalid JSON', {}, { ...base, tool_name: 'Execute' },
      { ...base, tool_input: { file_path: join(f.directory, 'sentinel.txt') } },
      { ...base, tool_input: { file_path: `${directory}/inputs/../${job.inputs[0].file}` } },
      { ...base, tool_input: { ...base.tool_input, extra: true } }];
    for (const input of cases) {
      const output = await hook(directory, input);
      expect(output.code).toBe(2);
      expect(JSON.parse(output.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
      expect(output.stderr).toBe('factory_read_denied\n');
    }
    await writeFile(base.tool_input.file_path, 'changed');
    expect((await hook(directory, base)).code).toBe(2);
  });
  it('hook denies linked inputs even when content hashes match', async () => {
    const f = await fixture(), job = f.plan.jobs[0], directory = jobDirectory(f.directory, job.id);
    const input = join(directory, job.inputs[0].file), target = join(f.workspace, 'public-target.pdf');
    await writeFile(target, await readFile(input)); await rm(input);
    try { await symlink(target, input, 'file'); }
    catch (error) {
      // Windows without symlink privilege: exercise an NTFS directory junction instead.
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
      await rm(join(directory, 'inputs'), { recursive: true });
      const linked = join(f.workspace, 'linked-inputs'); await mkdir(linked);
      await writeFile(join(linked, job.inputs[0].file.split('/')[1]), await readFile(target));
      await symlink(linked, join(directory, 'inputs'), 'junction');
    }
    expect((await hook(directory, { hook_event_name: 'PreToolUse', session_id: randomUUID(),
      tool_name: 'Read', tool_input: { file_path: input } })).code).toBe(2);
  });
  it('requires explicit execution, finite bounds, and capability receipt before source jobs', async () => {
    const f = await fixture(), transport = fakeTransport(f.directory, f.plan);
    await expect(runCampaign({ ...f, execute: false, maxSessions: 1 }, transport)).rejects.toThrow('factory_explicit_execution_required');
    await expect(runCampaign({ ...f, execute: true, maxSessions: 1, concurrency: 3 }, transport)).rejects.toThrow('factory_execution_bounds_invalid');
    await expect(runCampaign({ ...f, execute: true, maxSessions: 1, timeoutSeconds: 601 }, transport)).rejects.toThrow('factory_execution_bounds_invalid');
    await expect(runCampaign({ ...f, execute: true, maxSessions: 1 }, transport)).rejects.toThrow('factory_capability_receipt_required');
  });
  it('runs a bounded fake pilot/campaign then resumes matching receipts without launching source sessions', async () => {
    const f = await fixture(2);
    expect((await pilot(f)).capability).toBe(true);
    const transport = fakeTransport(f.directory, f.plan);
    const result = await runCampaign({ ...f, execute: true, maxSessions: 1, concurrency: 2 }, transport);
    expect(result).toEqual({ launched: 1, resumed: 0, candidates: 1, capability: false });
    const next = await runCampaign({ ...f, execute: true, maxSessions: 1 }, transport);
    expect(next).toEqual({ launched: 1, resumed: 1, candidates: 1, capability: false });
    const final = await runCampaign({ ...f, execute: true, maxSessions: 2 }, transport);
    expect(final).toEqual({ launched: 0, resumed: 2, candidates: 0, capability: false });
    const stored = JSON.parse(await readFile(join(jobDirectory(f.directory, f.plan.jobs[0].id), 'candidate.json'), 'utf8'));
    expect(stored.acceptance).toBe('requires_source_reconciliation');
  });
  it('rejects missing actual hook audit even if pilot output claims success', async () => {
    const f = await fixture();
    const transport: Transport = async call => ({ stdout: call.args[0] === '--version' ? '0.230.0' :
      envelope({ capability: 'factory-read-v1', allowedObserved: true, deniedObserved: true }, randomUUID()),
    stderr: '', exitCode: 0 });
    await expect(runCampaign({ ...f, execute: true, maxSessions: 1, capabilityPilot: true }, transport)).rejects.toThrow();
    await expect(runCampaign({ ...f, execute: true, maxSessions: 1, capabilityPilot: true }, transport))
      .rejects.toThrow('factory_started_job_requires_reconciliation');
  });
  it('refuses ambiguous started jobs rather than duplicate model work', async () => {
    const f = await fixture(); await pilot(f);
    await writeFile(join(jobDirectory(f.directory, f.plan.jobs[0].id), 'started.json'), '{}');
    let launches = 0;
    const transport = fakeTransport(f.directory, f.plan, async () => { launches++; });
    await expect(runCampaign({ ...f, execute: true, maxSessions: 1 }, transport))
      .rejects.toThrow('factory_started_job_requires_reconciliation');
    expect(launches).toBe(0);
  });
  it('gates audits by actual session, input hash and sentinel denial', async () => {
    const f = await fixture();
    const good = fakeTransport(f.directory, f.plan);
    const transport: Transport = async call => {
      const output = await good(call);
      if (call.args[0] !== '--version') {
        const file = join(jobDirectory(f.directory, f.plan.capability.id), 'audit.jsonl');
        const rows = (await readFile(file, 'utf8')).trim().split('\n').map(r => JSON.parse(r));
        await writeFile(file, rows.filter(r => r.decision === 'observed').map(r => JSON.stringify(r) + '\n').join(''));
      }
      return output;
    };
    await expect(runCampaign({ ...f, execute: true, maxSessions: 1, capabilityPilot: true }, transport))
      .rejects.toThrow('factory_hook_evidence_missing');
  });
  it('rejects receipts after candidate mutation', async () => {
    const f = await fixture(); await pilot(f);
    const transport = fakeTransport(f.directory, f.plan);
    await runCampaign({ ...f, execute: true, maxSessions: 1 }, transport);
    await writeFile(join(jobDirectory(f.directory, f.plan.jobs[0].id), 'candidate.json'), '{}');
    await expect(runCampaign({ ...f, execute: true, maxSessions: 1 }, transport)).rejects.toThrow('factory_resume_result_changed');
  });
  it('drains fake own work on sibling failure, caps concurrency and stops launching', async () => {
    const f = await fixture(3); await pilot(f);
    let active = 0, peak = 0, launched = 0, drained = false;
    const transport: Transport = async call => {
      if (call.args[0] === '--version') return { stdout: '0.230.0', stderr: '', exitCode: 0 };
      launched++; active++; peak = Math.max(peak, active);
      if (launched === 1) {
        await new Promise(resolve => setTimeout(resolve, 25)); active--;
        throw new Error('factory_test_child_failed');
      }
      return new Promise((_, reject) => {
        call.signal.addEventListener('abort', () => { drained = true; active--; reject(new Error('factory_campaign_stopped')); }, { once: true });
      });
    };
    await expect(runCampaign({ ...f, execute: true, maxSessions: 3, concurrency: 2 }, transport)).rejects.toThrow('factory_test_child_failed');
    expect(peak).toBe(2); expect(launched).toBe(2); expect(drained).toBe(true); expect(active).toBe(0);
  });
  it('rejects oversized combined output from a fake child', async () => {
    const f = await fixture(); await pilot(f);
    const transport: Transport = async call => call.args[0] === '--version'
      ? { stdout: '0.230.0', stderr: '', exitCode: 0 }
      : { stdout: 'x'.repeat(4 * 1024 * 1024), stderr: 'overflow', exitCode: 0 };
    await expect(runCampaign({ ...f, execute: true, maxSessions: 1 }, transport)).rejects.toThrow('factory_output_limit');
  });
  it('groups FIE JSON endpoints in one competition job and preserves unavailable endpoints and hash aliases', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'factory-batch-fie-test-'));
    created.push(workspace);
    const data = Buffer.from('{"rows":[{"name":"PUBLIC TEST","position":"=1","score":"15-14"}]}'), sha256 = hash(data);
    await mkdir(join(workspace, 'blobs', sha256.slice(0, 2)), { recursive: true });
    await writeFile(join(workspace, 'blobs', sha256.slice(0, 2), `${sha256}.blob`), data);
    const unitKey = '2025:123';
    const endpoint = (key: string, completeness: string, blob: string | null, status = 200) => ({
      key, unitKey, endpoint: `/${key}`, url: `https://fie.org/${key}`, completeness,
      blobSha256: blob, bytes: blob ? data.length : 0, status, contentType: 'application/json',
    });
    const manifest = serialize({ version: 1, units: {
      [unitKey]: { key: unitKey, season: 2025, competitionId: 123, endpoints: ['/results', '/alias', '/unpublished'] },
    }, endpoints: { results: endpoint('results', 'complete', sha256),
      alias: endpoint('alias', 'complete', sha256), unpublished: endpoint('unpublished', 'http_error', null, 404) } });
    await writeFile(join(workspace, 'manifest.json'), manifest);
    const prepared = await prepareCampaign({ workspace, cacheRoot: workspace, source: 'fie',
      selections: [{ tipo: 'fie', season: 2025, competitionId: 123 }], sourceManifestSha256: hash(manifest) });
    created.push(prepared.directory);
    const plan = await loadCampaign(prepared.directory, prepared.planSha256);
    expect(plan.jobs).toHaveLength(1);
    const job = plan.jobs[0];
    expect(job.inputs).toHaveLength(1); expect(job.inputs[0].sourceUrls).toHaveLength(2);
    expect(job.unavailable).toEqual([{ sourceUrl: 'https://fie.org/unpublished', status: 'not_published' }]);
    const value = { ...candidate(job), status: 'partial' };
    expect(() => parseCandidate(JSON.stringify(value), job)).toThrow('factory_missing_endpoint_gap_required');
    const valid = { ...value, gaps: [{ code: 'missing_endpoint', detail: 'not published', sourceSha256: null }] };
    expect(parseCandidate(JSON.stringify(valid), job).status).toBe('partial');
  });
  it('enforces finite campaign wall time and drains the fake active session', async () => {
    const f = await fixture(); await pilot(f);
    let drained = false;
    const transport: Transport = async call => {
      if (call.args[0] === '--version') return { stdout: '0.230.0', stderr: '', exitCode: 0 };
      expect(call.timeoutMs).toBe(2000);
      return new Promise((_, reject) => {
        call.signal.addEventListener('abort', () => { drained = true; reject(new Error('factory_campaign_stopped')); }, { once: true });
      });
    };
    await expect(runCampaign({ ...f, execute: true, maxSessions: 1, timeoutSeconds: 2, wallSeconds: 1 }, transport))
      .rejects.toThrow('factory_campaign_stopped');
    expect(drained).toBe(true);
  });
  it('enforces strict envelopes and evidence identities instead of complete/IDs/markdown', async () => {
    const f = await fixture(), job = f.plan.jobs[0], value = candidate(job);
    expect(() => parseEnvelope('```json\n{}\n```')).toThrow('factory_envelope_invalid');
    expect(() => parseCandidate(JSON.stringify({ ...value, status: 'complete' }), job)).toThrow('factory_candidate_invalid');
    expect(() => parseCandidate(JSON.stringify({ ...value, personId: 1 }), job)).toThrow('factory_candidate_invalid');
    expect(() => parseCandidate(JSON.stringify({ ...value, reviewed: [] }), job)).toThrow('factory_reviewed_source_missing');
    expect(() => parseCandidate(JSON.stringify({ ...value, sourceSha256: '0'.repeat(64) }), job)).toThrow('factory_candidate_identity_mismatch');
  });
  it('accepts observed CLI usage metadata without loosening result or envelope checks', () => {
    const value = JSON.parse(envelope({ capability: 'factory-read-v1' }, randomUUID()));
    const usage = { input_tokens: 1975, output_tokens: 155, cache_read_input_tokens: 3632,
      cache_creation_input_tokens: 0, factory_credits: 2492, thinking_tokens: 25, ttft_ms: 1262.67 };
    expect(parseEnvelope(JSON.stringify({ ...value, usage })).usage).toEqual(usage);
    expect(() => parseEnvelope(JSON.stringify({ ...value, usage: { factory_credits: -1 } })))
      .toThrow('factory_envelope_invalid');
    expect(() => parseEnvelope(JSON.stringify({ ...value, usage: { unknown: true } })))
      .toThrow('factory_envelope_invalid');
    expect(() => parseEnvelope(JSON.stringify({ ...value, extra: true })))
      .toThrow('factory_envelope_invalid');
    // Installed Windows CLI 0.230.0 is 273,028,608 bytes, above 256 MiB.
    expect(LIMITS.executableBytes).toBeGreaterThanOrEqual(273_028_608);
    expect(LIMITS.executableBytes).toBeLessThanOrEqual(512 * 1024 * 1024);
  });
  it('uses safe absolute hook quoting and rejects Windows shell expansion', () => {
    expect(quoteHookPath('C:\\Program Files\\node.exe', 'win32')).toBe('"C:\\Program Files\\node.exe"');
    expect(() => quoteHookPath('C:\\bad%PATH%\\node.exe', 'win32')).toThrow('factory_hook_command_path_invalid');
    expect(quoteHookPath("/tmp/it's node", 'linux')).toBe("'/tmp/it'\\''s node'");
    expect(resolve('C:\\')).toBeTruthy();
  });
});
