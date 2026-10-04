import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCampaign, materializeJob } from '../src/lib/ingest/factory-batch/prepare';
import { hash, serialize, readBounded, jobDirectory } from '../src/lib/ingest/factory-batch/files';
import { CLI_VERSION, MODEL, PROMPT_VERSION, type Plan } from '../src/lib/ingest/factory-batch/schemas';
import { HOOK_SOURCE, SETTINGS } from '../src/lib/ingest/factory-batch/hook';
import { reviewStoredCandidate } from '../src/lib/ingest/factory-batch/evidence';
import { spawnTransport } from '../src/lib/ingest/factory-batch/transport';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'factory-scope-test-')));
  roots.push(root);
  await mkdir(join(root, 'jobs'));
  const nodeExecutable = await realpath(process.execPath);
  const sourceManifestSha256 = hash('public-manifest');
  const source = serialize({ seleccion: { manifiestoOrigenSha256: sourceManifestSha256 } });
  await writeFile(join(root, 'source-selection.json'), source);
  const data = Buffer.from('{"rank":1}'), sha256 = hash(data);
  const input = { pin: { file: `inputs/${sha256}.json`, sha256, bytes: data.length,
    kind: 'json' as const, sourceUrl: 'https://fie.org/public.json', sourceUrls: ['https://fie.org/public.json'] }, data };
  const jobs = [];
  for (const id of [1, 2]) jobs.push(await materializeJob(root, id, 'fie', hash(source), [input], [], nodeExecutable));
  const text = Buffer.from('FACTORY_PUBLIC_CAPABILITY_V1\n'), textHash = hash(text);
  const capability = await materializeJob(root, 'capability', 'capability', hash(source), [{
    pin: { file: `inputs/${textHash}.txt`, sha256: textHash, bytes: text.length, kind: 'txt', sourceUrl: null, sourceUrls: [] }, data: text,
  }], [], nodeExecutable, join(root, 'sentinel.txt'));
  const plan: Plan = { version: 1, model: MODEL, cliVersion: CLI_VERSION, promptVersion: PROMPT_VERSION,
    sourceManifestSha256, hookSha256: hash(HOOK_SOURCE), settingsSha256: hash(serialize(SETTINGS)),
    nodeExecutable, nodeExecutableSha256: hash(await readBounded(nodeExecutable, 256 * 1024 * 1024)), jobs, capability };
  const bytes = serialize(plan), pin = hash(bytes);
  await writeFile(join(root, 'plan.json'), bytes);
  return { root, plan, pin };
}
describe('Factory explicit selected-input preflight', () => {
  it('keeps full preflight as default while a selected operation ignores only unrelated inputs', async () => {
    const f = await fixture();
    await writeFile(join(jobDirectory(f.root, f.plan.jobs[1].id), f.plan.jobs[1].inputs[0].file), 'changed');
    await expect(loadCampaign(f.root, f.pin)).rejects.toThrow('factory_input_changed');
    await expect(loadCampaign(f.root, f.pin, [f.plan.jobs[0].id])).resolves.toMatchObject({ jobs: f.plan.jobs });
    await expect(loadCampaign(f.root, f.pin, [f.plan.jobs[1].id])).rejects.toThrow('factory_input_changed');
  }, 30000);
  it('still rejects selected control changes, even after a prior successful scoped load', async () => {
    const f = await fixture(), id = f.plan.jobs[0].id;
    await loadCampaign(f.root, f.pin, [id]);
    await writeFile(join(jobDirectory(f.root, id), 'AGENTS.md'), 'changed');
    await expect(loadCampaign(f.root, f.pin, [id])).rejects.toThrow('factory_job_controls_changed');
  }, 30000);
  it('rejects empty, repeated and unknown selections; preserves unknown evidence-job error', async () => {
    const f = await fixture(), id = f.plan.jobs[0].id;
    for (const ids of [[], [id, id], ['f'.repeat(64)]]) {
      await expect(loadCampaign(f.root, f.pin, ids)).rejects.toThrow('factory_job_subset_invalid');
    }
    await expect(reviewStoredCandidate(f.root, f.pin, 'f'.repeat(64))).rejects.toThrow('factory_evidence_job_unknown');
  }, 30000);
  it('never skips plan or manifest pins for scoped operations', async () => {
    const f = await fixture(), ids = [f.plan.jobs[0].id];
    await expect(loadCampaign(f.root, 'f'.repeat(64), ids)).rejects.toThrow('factory_plan_hash_mismatch');
    await writeFile(join(f.root, 'source-selection.json'), serialize({ seleccion: { manifiestoOrigenSha256: hash('changed') } }));
    await expect(loadCampaign(f.root, f.pin, ids)).rejects.toThrow('factory_source_manifest_mismatch');
  }, 30000);
  it('always validates capability controls even for a different selected source', async () => {
    const f = await fixture();
    await writeFile(join(jobDirectory(f.root, f.plan.capability.id), 'AGENTS.md'), 'changed');
    await expect(loadCampaign(f.root, f.pin, [f.plan.jobs[0].id])).rejects.toThrow('factory_job_controls_changed');
  }, 30000);
  it('classifies an already-cancelled production transport without starting any child', async () => {
    const abort = new AbortController(); abort.abort();
    await expect(spawnTransport({ executable: process.execPath, args: ['--version'], cwd: tmpdir(),
      env: { NODE_ENV: 'production' }, timeoutMs: 1000, maxBytes: 65536, signal: abort.signal }))
      .rejects.toThrow('factory_campaign_stopped');
  });
});
