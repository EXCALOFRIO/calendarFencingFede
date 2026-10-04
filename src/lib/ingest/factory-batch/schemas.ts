import { z } from 'zod';

export const MODEL = 'gpt-6-sol' as const;
export const modelSchema = z.enum([MODEL, 'gpt-6-luna', 'gpt-5.6-luna']);
export type Model = z.infer<typeof modelSchema>;
export const CLI_VERSION = '0.230.0' as const;
export const PROMPT_VERSION = 'sport-candidate-v1' as const;
export const LIMITS = {
  concurrency: 8,
  jobs: 250, inputBytes: 3 * 1024 * 1024, jobBytes: 16 * 1024 * 1024,
  planBytes: 2 * 1024 * 1024, outputBytes: 4 * 1024 * 1024,
  auditBytes: 256 * 1024, timeoutSeconds: 600, wallSeconds: 3600,
  executableBytes: 384 * 1024 * 1024,
} as const;
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().max(2000);
const nullableText = text.nullable();
export const pinSchema = z.object({
  file: z.string().regex(/^inputs\/[a-f0-9]{64}\.(pdf|json|txt)$/),
  sha256: digestSchema, bytes: z.number().int().min(1).max(LIMITS.inputBytes),
  kind: z.enum(['pdf', 'json', 'txt']), sourceUrl: z.string().url().nullable(),
  sourceUrls: z.array(z.string().url()).max(100),
}).strict();
export const controlsSchema = z.object({
  hook: digestSchema, policy: digestSchema, hooks: digestSchema,
  settings: digestSchema, prompt: digestSchema, agents: digestSchema,
}).strict();
export const jobSchema = z.object({
  id: digestSchema, kind: z.enum(['rfee', 'fie', 'capability']),
  sourceManifestSha256: digestSchema, sourceSha256: digestSchema,
  inputs: z.array(pinSchema).min(1).max(100),
  unavailable: z.array(z.object({
    sourceUrl: z.string().url(), status: z.enum(['partial', 'empty', 'unreadable', 'not_published']),
  }).strict()).max(100),
  controls: controlsSchema,
}).strict();
export const planSchema = z.object({
  version: z.literal(1), model: modelSchema, cliVersion: z.literal(CLI_VERSION),
  promptVersion: z.literal(PROMPT_VERSION), sourceManifestSha256: digestSchema,
  hookSha256: digestSchema, settingsSha256: digestSchema,
  nodeExecutableSha256: digestSchema, nodeExecutable: z.string().min(1),
  jobs: z.array(jobSchema).min(1).max(LIMITS.jobs),
  capability: jobSchema,
}).strict();
export type Pin = z.infer<typeof pinSchema>;
export type Job = z.infer<typeof jobSchema>;
export type Plan = z.infer<typeof planSchema>;

const evidenceSchema = z.object({
  sourceSha256: digestSchema,
  page: z.number().int().positive().max(10000).nullable(),
  region: nullableText,
  jsonPointer: z.string().max(2000).regex(/^(\/([^~]|~[01])*)*$/).nullable(),
  rawExcerpt: z.string().min(1).max(4000),
}).strict().refine(e => e.page !== null ? e.jsonPointer === null : e.jsonPointer !== null, 'evidence_location_required');
export const candidateSchema = z.object({
  schemaVersion: z.literal(1), jobId: digestSchema,
  sourceSha256: digestSchema, acceptance: z.literal('requires_source_reconciliation'),
  status: z.enum(['candidate', 'partial', 'unreadable', 'empty', 'not_published']),
  metadata: z.object({
    title: nullableText, dateRaw: nullableText, seasonRaw: nullableText,
    weaponRaw: nullableText, genderRaw: nullableText, categoryRaw: nullableText,
    formatRaw: nullableText, locationRaw: nullableText,
    evidence: z.array(evidenceSchema).max(100),
  }).strict(),
  reviewed: z.array(z.object({
    sourceSha256: digestSchema, pages: z.array(z.number().int().positive().max(10000)).max(10000),
    jsonPointers: z.array(z.string().max(2000).regex(/^(\/([^~]|~[01])*)*$/)).max(10000),
    status: z.enum(['reviewed', 'partial', 'unreadable', 'empty', 'not_published']),
  }).strict()).max(100),
  facts: z.array(z.object({
    kind: z.enum(['classification', 'poule', 'tableau']),
    stageRaw: nullableText, groupRaw: nullableText, positionRaw: nullableText,
    participantRaw: text.min(1), opponentRaw: nullableText, clubRaw: nullableText,
    countryRaw: nullableText, scoreRaw: nullableText, outcomeRaw: nullableText,
    evidence: z.array(evidenceSchema).min(1).max(20),
  }).strict()).max(20000),
  gaps: z.array(z.object({
    code: z.enum(['missing_metadata', 'missing_pages', 'missing_endpoint', 'unreadable',
      'truncated', 'ambiguous', 'empty', 'not_published']),
    detail: text, sourceSha256: digestSchema.nullable(),
  }).strict()).max(1000),
}).strict();
export type Candidate = z.infer<typeof candidateSchema>;
const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_read_input_tokens: z.number().int().nonnegative(),
  cache_creation_input_tokens: z.number().int().nonnegative(),
  factory_credits: z.number().finite().nonnegative(),
  thinking_tokens: z.number().int().nonnegative(),
  ttft_ms: z.number().finite().nonnegative(),
}).partial().strict();
export const envelopeSchema = z.object({
  type: z.literal('result'), subtype: z.literal('success'), is_error: z.literal(false),
  duration_ms: z.number().finite().nonnegative(), num_turns: z.number().int().nonnegative(),
  result: z.string().min(1).max(LIMITS.outputBytes), session_id: z.string().uuid(),
  usage: usageSchema.optional(),
}).strict();
export const receiptSchema = z.object({
  version: z.literal(1), jobId: digestSchema, planSha256: digestSchema,
  sourceSha256: digestSchema, model: modelSchema, promptVersion: z.literal(PROMPT_VERSION),
  sessionId: z.string().uuid(), resultSha256: digestSchema, auditSha256: digestSchema,
  acceptance: z.literal('requires_source_reconciliation'),
}).strict();
export const capabilitySchema = z.object({
  version: z.literal(1), planSha256: digestSchema, model: modelSchema,
  cliVersion: z.literal(CLI_VERSION), droidExecutableSha256: digestSchema,
  nodeExecutableSha256: digestSchema, hookSha256: digestSchema, settingsSha256: digestSchema,
  sessionId: z.string().uuid(), auditSha256: digestSchema, envelopeSha256: digestSchema,
}).strict();
export const auditSchema = z.object({
  version: z.literal(1), sessionId: z.string().uuid().nullable(),
  tool: z.enum(['Read', 'other']), decision: z.enum(['observed', 'denied']),
  requestedPathSha256: digestSchema, inputSha256: digestSchema.nullable(),
}).strict();

export function parseEnvelope(stdout: string) {
  try { return envelopeSchema.parse(JSON.parse(stdout)); }
  catch { throw new Error('factory_envelope_invalid'); }
}
export function parseCandidate(result: string, job: Job): Candidate {
  let candidate: Candidate;
  try { candidate = candidateSchema.parse(JSON.parse(result)); }
  catch { throw new Error('factory_candidate_invalid'); }
  if (candidate.jobId !== job.id || candidate.sourceSha256 !== job.sourceSha256) {
    throw new Error('factory_candidate_identity_mismatch');
  }
  const pins = new Map(job.inputs.map(p => [p.sha256, p]));
  if (Object.entries(candidate.metadata).some(([key, value]) => key !== 'evidence' && value !== null) &&
    !candidate.metadata.evidence.length) throw new Error('factory_metadata_evidence_missing');
  const evidence = [...candidate.metadata.evidence, ...candidate.facts.flatMap(f => f.evidence)];
  for (const e of evidence) {
    const pin = pins.get(e.sourceSha256);
    if (!pin || (pin.kind === 'pdf' ? e.page === null : e.jsonPointer === null)) {
      throw new Error('factory_evidence_source_invalid');
    }
  }
  const reviewed = new Set<string>();
  for (const r of candidate.reviewed) {
    const pin = pins.get(r.sourceSha256);
    if (!pin || reviewed.has(r.sourceSha256) ||
      (pin.kind === 'pdf' ? r.jsonPointers.length !== 0 : r.pages.length !== 0) ||
      (r.status === 'reviewed' && (pin.kind === 'pdf' ? !r.pages.length : !r.jsonPointers.length))) {
      throw new Error('factory_reviewed_source_invalid');
    }
    reviewed.add(r.sourceSha256);
  }
  if (reviewed.size !== pins.size) throw new Error('factory_reviewed_source_missing');
  for (const e of evidence) {
    const r = candidate.reviewed.find(r => r.sourceSha256 === e.sourceSha256)!;
    if (e.page !== null && !r.pages.includes(e.page)) throw new Error('factory_evidence_page_not_reviewed');
    if (e.jsonPointer !== null && !r.jsonPointers.some(pointer =>
      pointer === e.jsonPointer || pointer === '' || e.jsonPointer!.startsWith(`${pointer}/`))) {
      throw new Error('factory_evidence_pointer_not_reviewed');
    }
  }
  if (candidate.gaps.some(g => g.sourceSha256 !== null && !pins.has(g.sourceSha256))) {
    throw new Error('factory_gap_source_invalid');
  }
  if (job.unavailable.length && candidate.status === 'candidate') throw new Error('factory_missing_endpoint_not_partial');
  if (job.unavailable.length && !candidate.gaps.some(g => g.code === 'missing_endpoint')) {
    throw new Error('factory_missing_endpoint_gap_required');
  }
  if (candidate.status === 'partial' && !candidate.gaps.length) throw new Error('factory_partial_gaps_required');
  if (candidate.status === 'candidate' && candidate.reviewed.some(r => r.status !== 'reviewed')) {
    throw new Error('factory_candidate_review_incomplete');
  }
  if (['empty', 'unreadable', 'not_published'].includes(candidate.status) && candidate.facts.length) {
    throw new Error('factory_status_facts_conflict');
  }
  return candidate;
}
