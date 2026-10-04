import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { extraerPaginas } from '../sources/rfee-pdf/lectura';
import { hash, readBounded, serialize, jobDirectory } from './files';
import { loadCampaign, validateJob } from './prepare';
import { assertHookEvidence } from './runner';
import { LIMITS, parseCandidate, parseEnvelope, receiptSchema, type Candidate, type Plan } from './schemas';

export type EvidenceInput =
  | { kind: 'json'; value: unknown }
  | { kind: 'pdf'; pages: ReadonlyMap<number, string> };

type Issue = {
  code: 'missing_source' | 'missing_location' | 'excerpt_mismatch' | 'review_limit';
  sourceSha256: string;
  page: number | null;
  jsonPointer: string | null;
  factIndex: number | null;
};
export type EvidenceReview = {
  version: 1;
  jobId: string;
  sourceSha256: string;
  scope: 'quoted_evidence_only';
  status: 'matched' | 'requires_review';
  checked: number;
  matched: number;
  mismatched: number;
  unresolvable: number;
  issues: Issue[];
  acceptance: 'requires_source_reconciliation';
};

function resolvePointer(root: unknown, pointer: string): { found: boolean; value: unknown } {
  if (pointer === '') return { found: true, value: root };
  if (!pointer.startsWith('/')) return { found: false, value: undefined };
  let value = root;
  for (const encoded of pointer.slice(1).split('/')) {
    const key = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) {
      return { found: false, value: undefined };
    }
    value = (value as Record<string, unknown>)[key];
  }
  return { found: true, value };
}
const compactWhitespace = (value: string) => value.replace(/\s+/gu, ' ').trim();
const MAX_EVIDENCE = 50_000;
function containsQuotation(page: string, excerpt: string): boolean {
  const quote = compactWhitespace(excerpt);
  if (!quote) return false;
  let offset = 0;
  for (;;) {
    const index = page.indexOf(quote, offset);
    if (index === -1) return false;
    const end = index + quote.length;
    const word = (character: string) => /[\p{L}\p{N}_]/u.test(character);
    if (!(index > 0 && word(page[index - 1]) && word(quote[0])) &&
      !(end < page.length && word(quote.at(-1)!) && word(page[end]))) return true;
    offset = index + 1;
  }
}

/**
 * Checks quotations, not sporting interpretations, identity, or completeness.
 * A model's added JSON field is a mismatch even when the schema is valid.
 */
export function checkQuotedEvidence(candidate: Candidate, inputs: ReadonlyMap<string, EvidenceInput>): EvidenceReview {
  const result: EvidenceReview = {
    version: 1, jobId: candidate.jobId, sourceSha256: candidate.sourceSha256,
    scope: 'quoted_evidence_only', status: 'matched',
    checked: 0, matched: 0, mismatched: 0, unresolvable: 0, issues: [],
    acceptance: 'requires_source_reconciliation',
  };
  const pages = new Map<string, ReadonlyMap<number, string>>();
  for (const [source, input] of inputs) {
    if (input.kind === 'pdf') pages.set(source, new Map([...input.pages]
      .map(([number, text]) => [number, compactWhitespace(text)])));
  }
  const check = (e: Candidate['metadata']['evidence'][number], factIndex: number | null) => {
    const issue = (code: Issue['code']) => {
      result.status = 'requires_review';
      result.issues.push({ code, sourceSha256: e.sourceSha256, page: e.page, jsonPointer: e.jsonPointer, factIndex });
    };
    result.checked++;
    const input = inputs.get(e.sourceSha256);
    if (!input) { result.unresolvable++; issue('missing_source'); return; }
    let matches = false;
    if (input.kind === 'pdf') {
      const page = e.page === null ? undefined : pages.get(e.sourceSha256)?.get(e.page);
      if (page === undefined) { result.unresolvable++; issue('missing_location'); return; }
      matches = containsQuotation(page, e.rawExcerpt);
    } else {
      const location = e.jsonPointer === null ? { found: false, value: undefined } : resolvePointer(input.value, e.jsonPointer);
      if (!location.found) { result.unresolvable++; issue('missing_location'); return; }
      try { matches = isDeepStrictEqual(location.value, JSON.parse(e.rawExcerpt)); }
      catch { matches = false; }
    }
    if (matches) result.matched++;
    else { result.mismatched++; issue('excerpt_mismatch'); }
  };
  const boundedCheck = (e: Candidate['metadata']['evidence'][number], factIndex: number | null) => {
    if (result.checked < MAX_EVIDENCE) { check(e, factIndex); return true; }
    result.status = 'requires_review';
    result.issues.push({ code: 'review_limit', sourceSha256: e.sourceSha256,
      page: e.page, jsonPointer: e.jsonPointer, factIndex });
    return false;
  };
  for (const e of candidate.metadata.evidence) {
    if (!boundedCheck(e, null)) return result;
  }
  for (let index = 0; index < candidate.facts.length; index++) {
    for (const e of candidate.facts[index].evidence) {
      if (!boundedCheck(e, index)) return result;
    }
  }
  return result;
}

/** Read-only local verification. Never edits candidates or accepts/imports facts. */
export async function reviewStoredCandidate(
  root: string, planSha256: string, jobId: string,
): Promise<EvidenceReview & { candidateSha256: string; sessionId: string }> {
  let plan: Plan;
  try { plan = await loadCampaign(root, planSha256, [jobId]); }
  catch (error) {
    if (error instanceof Error && error.message === 'factory_job_subset_invalid') {
      throw new Error('factory_evidence_job_unknown');
    }
    throw error;
  }
  const job = plan.jobs.find((j) => j.id === jobId);
  if (!job) throw new Error('factory_evidence_job_unknown');
  const directory = jobDirectory(root, job.id);
  const bytes = await readBounded(join(directory, 'candidate.json'), LIMITS.outputBytes);
  const candidate = parseCandidate(bytes.toString('utf8'), job);
  const receipt = receiptSchema.parse(JSON.parse((await readBounded(join(directory, 'receipt.json'), 16384)).toString('utf8')));
  if (receipt.model !== plan.model || receipt.jobId !== job.id || receipt.planSha256 !== planSha256 || receipt.sourceSha256 !== job.sourceSha256 ||
    receipt.resultSha256 !== hash(bytes)) throw new Error('factory_evidence_receipt_mismatch');
  const envelope = parseEnvelope((await readBounded(join(directory, 'stdout.json'), LIMITS.outputBytes)).toString('utf8'));
  if (receipt.sessionId !== envelope.session_id ||
    serialize(parseCandidate(envelope.result, job)) !== bytes.toString('utf8') ||
    receipt.auditSha256 !== await assertHookEvidence(root, job, receipt.sessionId)) {
    throw new Error('factory_evidence_session_mismatch');
  }
  const inputs = new Map<string, EvidenceInput>();
  for (const pin of job.inputs) {
    const source = await readBounded(join(directory, pin.file), LIMITS.inputBytes);
    if (source.length !== pin.bytes || hash(source) !== pin.sha256) throw new Error('factory_input_changed');
    if (pin.kind === 'json') {
      inputs.set(pin.sha256, { kind: 'json', value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source)) });
    } else if (pin.kind === 'pdf') {
      const deadline = Date.now() + 60_000;
      const { paginas } = await extraerPaginas(new Uint8Array(source), {
        maxBytes: LIMITS.inputBytes,
        comprobar: () => { if (Date.now() > deadline) throw new Error('factory_evidence_pdf_timeout'); },
      });
      inputs.set(pin.sha256, { kind: 'pdf', pages: new Map(paginas.map((p) =>
        [p.numero, p.items.map((item) => item.s).join(' ')])) });
    } else throw new Error('factory_evidence_input_invalid');
  }
  const review = checkQuotedEvidence(candidate, inputs);
  await validateJob(root, plan, job);
  if (hash(await readBounded(join(directory, 'candidate.json'), LIMITS.outputBytes)) !== hash(bytes)) {
    throw new Error('factory_evidence_candidate_changed');
  }
  return { ...review, candidateSha256: hash(bytes), sessionId: receipt.sessionId };
}
