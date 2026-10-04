import { describe, expect, it } from 'vitest';
import { checkQuotedEvidence, type EvidenceInput } from '@/lib/ingest/factory-batch/evidence';
import type { Candidate } from '@/lib/ingest/factory-batch/schemas';

const digest = 'a'.repeat(64);
const quote = (pointer: string | null, rawExcerpt: string, page: number | null = null) => ({
  sourceSha256: digest, page, region: null, jsonPointer: pointer, rawExcerpt,
});
function candidate(evidence: Candidate['metadata']['evidence']): Candidate {
  return {
    schemaVersion: 1, jobId: 'b'.repeat(64), sourceSha256: 'c'.repeat(64),
    acceptance: 'requires_source_reconciliation', status: 'candidate',
    metadata: { title: null, dateRaw: null, seasonRaw: null, weaponRaw: null, genderRaw: null,
      categoryRaw: null, formatRaw: null, locationRaw: null, evidence },
    reviewed: [], facts: [], gaps: [],
  };
}
const json = (value: unknown): ReadonlyMap<string, EvidenceInput> => new Map([[digest, { kind: 'json', value }]]);

describe('Factory candidate quotation reconciliation', () => {
  it('resolves exact JSON pointers, escaped keys and root without relying on object key order', () => {
    const c = candidate([quote('/a~1b/~0key/0', '{"b":2,"a":1}'), quote('', '{"a/b":{"~key":[{"a":1,"b":2}]}}')]);
    expect(checkQuotedEvidence(c, json({ 'a/b': { '~key': [{ a: 1, b: 2 }] } }))).toMatchObject({
      status: 'matched', checked: 2, matched: 2, mismatched: 0, unresolvable: 0,
      acceptance: 'requires_source_reconciliation', scope: 'quoted_evidence_only',
    });
  });

  it('quarantines added isBye fields, changed values, type changes and invalid JSON excerpts', () => {
    const c = candidate([quote('/round', '{"score":45,"isBye":true}'),
      quote('/round/score', '44'), quote('/round/score', '"45"'), quote('/round/score', 'not-json')]);
    const result = checkQuotedEvidence(c, json({ round: { score: 45 } }));
    expect(result).toMatchObject({ status: 'requires_review', matched: 0, mismatched: 4, unresolvable: 0 });
    expect(result.issues.every((i) => i.code === 'excerpt_mismatch')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('isBye');
    expect(result.acceptance).toBe('requires_source_reconciliation');
  });

  it('does not resolve inherited properties or missing paths', () => {
    const c = candidate([quote('/toString', '{}'), quote('/missing', '1')]);
    expect(checkQuotedEvidence(c, json({}))).toMatchObject({ status: 'requires_review', unresolvable: 2, mismatched: 0 });
    expect(checkQuotedEvidence(c, new Map())).toMatchObject({ status: 'requires_review', unresolvable: 2 });
  });

  it('grounds PDF excerpts in their page while preserving printed typos', () => {
    const c = candidate([quote(null, '1   CLUB-A 45\nCLUB-A\n2 CLUB-B 443', 1)]);
    const inputs: ReadonlyMap<string, EvidenceInput> = new Map([[digest, {
      kind: 'pdf', pages: new Map([[1, 'Liga\n1 CLUB-A 45\nCLUB-A\n2 CLUB-B 443']]),
    }]]);
    expect(checkQuotedEvidence(c, inputs)).toMatchObject({ status: 'matched', matched: 1 });
    expect(checkQuotedEvidence(candidate([quote(null, '2 CLUB-B 43', 1)]), inputs))
      .toMatchObject({ status: 'requires_review', mismatched: 1 });
    expect(checkQuotedEvidence(candidate([quote(null, '2 CLUB-B 44', 1)]), inputs))
      .toMatchObject({ status: 'requires_review', mismatched: 1 });
    expect(checkQuotedEvidence(candidate([quote(null, '2 CLUB-B 443', 2)]), inputs))
      .toMatchObject({ status: 'requires_review', unresolvable: 1 });
  });

  it('reports only bounded location/hash/index metadata, never raw sporting names or excerpts', () => {
    const c = candidate([]);
    c.facts = [{
      kind: 'classification', stageRaw: null, groupRaw: null, positionRaw: '1',
      participantRaw: 'SYNTHETIC PRIVATE NAME', opponentRaw: null, clubRaw: null, countryRaw: null,
      scoreRaw: null, outcomeRaw: null, evidence: [quote('/rows/0', '"SYNTHETIC PRIVATE NAME"')],
    }];
    const result = checkQuotedEvidence(c, json({ rows: ['OTHER SYNTHETIC NAME'] }));
    expect(result.issues[0]).toMatchObject({ code: 'excerpt_mismatch', factIndex: 0 });
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC');
  });
});
