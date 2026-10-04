import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { createPrivateExportDirectory, assertCapacity } from '../../migracion-cloudflare/files';
import { prepararSeleccionArchivoLocal, leerBlobArchivadoLocal, type SeleccionArchivoLocal } from '../archivo-local';
import { AGENTS, CAPABILITY_AGENTS, buildPrompt } from './prompt';
import { HOOK_SOURCE, SETTINGS, hooksConfig } from './hook';
import { hash, serialize, newDirectory, writeNew, readBounded, jobDirectory } from './files';
import { CLI_VERSION, MODEL, PROMPT_VERSION, LIMITS, digestSchema, planSchema,
  modelSchema, type Model, type Pin, type Job, type Plan } from './schemas';

export const settingsForModel = (model: Model) => model === MODEL ? SETTINGS : { ...SETTINGS, model };

export function publicSourceUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('factory_public_source_invalid');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('factory_public_source_invalid'); }
  if (url.protocol !== 'https:' || !['fie.org', 'app.skermo.org'].includes(url.host) ||
    url.username || url.password || url.hash || /[\r\n]/.test(value)) {
    throw new Error('factory_public_source_invalid');
  }
  return value;
}
export async function materializeJob(
  root: string, identity: unknown, kind: Job['kind'], manifestHash: string,
  inputs: { pin: Pin; data: Uint8Array }[], unavailable: Job['unavailable'],
  nodeExecutable: string, sentinel?: string, model: Model = MODEL,
): Promise<Job> {
  if (!inputs.length || inputs.length > 100 ||
    inputs.reduce((n, i) => n + i.data.byteLength, 0) > LIMITS.jobBytes) {
    throw new Error('factory_job_input_limit');
  }
  const sourceSha256 = hash(serialize({ identity, inputs: inputs.map(i => i.pin), unavailable }));
  modelSchema.parse(model);
  const id = hash(serialize({ kind, manifestHash, sourceSha256, model, promptVersion: PROMPT_VERSION }));
  const directory = await newDirectory(join(root, 'jobs'), id);
  await newDirectory(directory, 'inputs');
  await newDirectory(directory, '.factory');
  for (const { pin, data } of inputs) {
    if (pin.bytes !== data.byteLength || pin.sha256 !== hash(data)) throw new Error('factory_input_changed');
    await writeNew(join(directory, pin.file), data);
  }
  const base = { id, kind, sourceManifestSha256: manifestHash, sourceSha256,
    inputs: inputs.map(i => i.pin), unavailable };
  const controls = {
    hook: HOOK_SOURCE,
    policy: serialize({ version: 1, inputs: inputs.map(i => ({ ...i.pin, path: join(directory, i.pin.file) })) }),
    hooks: serialize(hooksConfig(nodeExecutable, join(directory, 'read-hook.mjs'))),
    settings: serialize(settingsForModel(model)),
    prompt: buildPrompt(base, directory, sentinel, model),
    agents: kind === 'capability' ? CAPABILITY_AGENTS : AGENTS,
  };
  const files = { hook: 'read-hook.mjs', policy: 'policy.json', hooks: '.factory/hooks.json',
    settings: '.factory/settings.json', prompt: 'prompt.txt', agents: 'AGENTS.md' };
  for (const key of Object.keys(files) as (keyof typeof files)[]) {
    await writeNew(join(directory, files[key]), controls[key]);
  }
  return { ...base, controls: Object.fromEntries(Object.entries(controls).map(([k, v]) =>
    [k, hash(v)])) as Job['controls'] };
}
export async function prepareCampaign(options: {
  workspace: string; cacheRoot: string; source: 'fie' | 'rfee';
  selections: SeleccionArchivoLocal[]; sourceManifestSha256: string;
  model?: Model;
}): Promise<{ directory: string; planSha256: string; jobs: number }> {
  const model = modelSchema.parse(options.model ?? MODEL);
  digestSchema.parse(options.sourceManifestSha256);
  if (!Array.isArray(options.selections)) throw new Error('factory_selection_invalid');
  if (options.selections.some(s => s.tipo === 'html')) throw new Error('factory_html_not_supported');
  const archive = await prepararSeleccionArchivoLocal(options.cacheRoot, options.source, options.selections,
    { manifiestoOrigenSha256: options.sourceManifestSha256 });
  const selected = JSON.parse(Buffer.from(archive.manifest).toString('utf8'));
  const nodeExecutable = await realpath(process.execPath);
  const nodeExecutableSha256 = hash(await readBounded(nodeExecutable, 256 * 1024 * 1024));
  const directory = await createPrivateExportDirectory(options.workspace);
  await assertCapacity(directory, archive.bytes + options.selections.length * 128 * 1024);
  await newDirectory(directory, 'jobs');
  await writeNew(join(directory, 'source-selection.json'), archive.manifest);
  await writeNew(join(directory, 'sentinel.txt'), 'BENIGN_DENIED_SENTINEL_NO_PRIVATE_DATA\n');
  const jobs: Job[] = [];
  for (const selection of options.selections) {
    let refs: Record<string, unknown>[];
    if (selection.tipo === 'fie') {
      const units = Object.values(selected.units) as Record<string, unknown>[];
      const unit = units.find(u => u.season === selection.season && u.competitionId === selection.competitionId);
      if (!unit) throw new Error('factory_selected_unit_missing');
      refs = (Object.values(selected.endpoints) as Record<string, unknown>[]).filter(e => e.unitKey === unit.key);
      if (!Array.isArray(unit.endpoints) || unit.endpoints.length > 100 ||
        unit.endpoints.some(endpoint => !refs.some(ref => ref.endpoint === endpoint)) ||
        refs.some(ref => !(unit.endpoints as unknown[]).includes(ref.endpoint))) {
        throw new Error('factory_endpoint_inventory_mismatch');
      }
    } else {
      const unit = (selected.unidades as Record<string, unknown>[]).find(u => u.id === selection.id);
      if (!unit || unit.tipo !== 'pdf' || unit.estado !== 'cached') throw new Error('factory_pdf_not_cached');
      refs = [unit];
    }
    if (!refs.length || refs.length > 100) throw new Error('factory_endpoint_limit');
    const unavailable: Job['unavailable'] = [];
    const inputs: { pin: Pin; data: Uint8Array }[] = [];
    const seen = new Set<string>();
    for (const ref of [...refs].sort((a, b) => String(a.url).localeCompare(String(b.url), 'en'))) {
      const sourceUrl = publicSourceUrl(ref.url), kind = selection.tipo === 'fie' ? 'json' : 'pdf';
      if (kind === 'json' && ref.completeness !== 'complete') {
        unavailable.push({ sourceUrl, status: ref.completeness === 'empty' ? 'empty' :
          ref.completeness === 'partial' ? 'partial' :
          ref.status === 404 ? 'not_published' : 'unreadable' });
        continue;
      }
      const sha256 = ref.blobSha256 ?? ref.sha256;
      if (typeof sha256 !== 'string' || !digestSchema.safeParse(sha256).success) {
        throw new Error('factory_source_hash_missing');
      }
      if (seen.has(sha256)) {
        // Identical endpoint payloads need only one read, but every public URL
        // remains attached to the pinned content and prompt for reconciliation.
        inputs.find(input => input.pin.sha256 === sha256)!.pin.sourceUrls.push(sourceUrl);
        continue;
      }
      seen.add(sha256);
      const blob = archive.blobs.find(b => b.hash === sha256);
      if (!blob || blob.bytes < 1 || blob.bytes > LIMITS.inputBytes) throw new Error('factory_source_size_invalid');
      const data = await leerBlobArchivadoLocal(blob);
      if (kind === 'pdf' && Buffer.from(data.subarray(0, 5)).toString('ascii') !== '%PDF-') {
        throw new Error('factory_pdf_invalid');
      }
      if (kind === 'json') {
        try { JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); }
        catch { throw new Error('factory_json_invalid'); }
      }
      inputs.push({ pin: { file: `inputs/${sha256}.${kind}`, sha256, bytes: data.byteLength, kind,
        sourceUrl, sourceUrls: [sourceUrl] }, data });
    }
    jobs.push(await materializeJob(directory, selection, options.source, archive.hash, inputs, unavailable, nodeExecutable, undefined, model));
  }
  const data = Buffer.from('FACTORY_PUBLIC_CAPABILITY_V1\n'), sha256 = hash(data);
  const capability = await materializeJob(directory, 'factory-read-v1', 'capability', archive.hash,
    [{ pin: { file: `inputs/${sha256}.txt`, sha256, bytes: data.length, kind: 'txt',
      sourceUrl: null, sourceUrls: [] }, data }],
    [], nodeExecutable, join(directory, 'sentinel.txt'), model);
  const plan: Plan = planSchema.parse({
    version: 1, model, cliVersion: CLI_VERSION, promptVersion: PROMPT_VERSION,
    sourceManifestSha256: options.sourceManifestSha256,
    hookSha256: hash(HOOK_SOURCE), settingsSha256: hash(serialize(settingsForModel(model))),
    nodeExecutable, nodeExecutableSha256, jobs, capability,
  });
  const contents = serialize(plan);
  await writeNew(join(directory, 'plan.json'), contents);
  return { directory, planSha256: hash(contents), jobs: jobs.length };
}

/** Offline integrity preflight. Does not run droid or contact a service. */
export async function loadCampaign(
  directory: string, expectedHash: string, selectedJobIds?: readonly string[],
): Promise<Plan> {
  if (!digestSchema.safeParse(expectedHash).success) throw new Error('factory_plan_pin_required');
  const bytes = await readBounded(join(directory, 'plan.json'), LIMITS.planBytes);
  if (hash(bytes) !== expectedHash) throw new Error('factory_plan_hash_mismatch');
  let plan: Plan;
  try { plan = planSchema.parse(JSON.parse(bytes.toString('utf8'))); }
  catch { throw new Error('factory_plan_invalid'); }
  if (plan.hookSha256 !== hash(HOOK_SOURCE) || plan.settingsSha256 !== hash(serialize(settingsForModel(plan.model))) ||
    plan.nodeExecutable !== await realpath(process.execPath) ||
    plan.nodeExecutableSha256 !== hash(await readBounded(plan.nodeExecutable, 256 * 1024 * 1024))) {
    throw new Error('factory_runtime_changed');
  }
  const source = await readBounded(join(directory, 'source-selection.json'), 16 * 1024 * 1024);
  let sourceManifest: { seleccion?: { manifiestoOrigenSha256?: string } };
  try { sourceManifest = JSON.parse(source.toString('utf8')); } catch { throw new Error('factory_source_selection_invalid'); }
  if (sourceManifest.seleccion?.manifiestoOrigenSha256 !== plan.sourceManifestSha256) {
    throw new Error('factory_source_manifest_mismatch');
  }
  const ids = new Set<string>();
  for (const job of [...plan.jobs, plan.capability]) {
    if (ids.has(job.id) || job.sourceManifestSha256 !== hash(source) ||
      (job === plan.capability ? job.kind !== 'capability' : job.kind === 'capability')) {
      throw new Error('factory_job_identity_invalid');
    }
    ids.add(job.id);
  }
  // Whole-plan preflight remains the default. An explicit bounded operation
  // need not re-read every unrelated input, but always verifies pinned plan,
  // runtime, manifest and all job identities before its selected inputs.
  if (selectedJobIds !== undefined && (!Array.isArray(selectedJobIds) || !selectedJobIds.length ||
    selectedJobIds.length > LIMITS.jobs || new Set(selectedJobIds).size !== selectedJobIds.length ||
    selectedJobIds.some(id => !ids.has(id)))) throw new Error('factory_job_subset_invalid');
  const selected = selectedJobIds === undefined ? ids : new Set(selectedJobIds);
  for (const job of [...plan.jobs, plan.capability]) {
    if (job === plan.capability || selected.has(job.id)) await validateJob(directory, plan, job);
  }
  return plan;
}
export async function validateJob(root: string, plan: Plan, job: Job): Promise<void> {
  const directory = jobDirectory(root, job.id);
  const expected = {
    hook: HOOK_SOURCE,
    policy: serialize({ version: 1, inputs: job.inputs.map(p => ({ ...p, path: join(directory, p.file) })) }),
    hooks: serialize(hooksConfig(plan.nodeExecutable, join(directory, 'read-hook.mjs'))),
    settings: serialize(settingsForModel(plan.model)), agents: job.kind === 'capability' ? CAPABILITY_AGENTS : AGENTS,
    prompt: buildPrompt(job, directory, job.kind === 'capability' ? join(root, 'sentinel.txt') : undefined, plan.model),
  };
  const files = { hook: 'read-hook.mjs', policy: 'policy.json', hooks: '.factory/hooks.json',
    settings: '.factory/settings.json', prompt: 'prompt.txt', agents: 'AGENTS.md' };
  for (const key of Object.keys(files) as (keyof typeof files)[]) {
    const bytes = await readBounded(join(directory, files[key]), LIMITS.planBytes);
    if (hash(bytes) !== job.controls[key] || hash(expected[key]) !== job.controls[key]) {
      throw new Error('factory_job_controls_changed');
    }
  }
  const seen = new Set<string>();
  let total = 0;
  for (const pin of job.inputs) {
    if (seen.has(pin.file) || pin.file !== `inputs/${pin.sha256}.${pin.kind}` ||
      (job.kind === 'rfee' ? pin.kind !== 'pdf' : job.kind === 'fie' ? pin.kind !== 'json' : pin.kind !== 'txt')) {
      throw new Error('factory_input_pin_invalid');
    }
    seen.add(pin.file);
    if (pin.sourceUrl !== null) publicSourceUrl(pin.sourceUrl);
    for (const url of pin.sourceUrls) publicSourceUrl(url);
    if (pin.sourceUrl !== null && (!pin.sourceUrls.length || pin.sourceUrls[0] !== pin.sourceUrl)) {
      throw new Error('factory_source_urls_invalid');
    }
    const bytes = await readBounded(join(directory, pin.file), LIMITS.inputBytes);
    if (bytes.length !== pin.bytes || hash(bytes) !== pin.sha256) throw new Error('factory_input_changed');
    total += bytes.length;
  }
  if (total > LIMITS.jobBytes) throw new Error('factory_job_input_limit');
}
