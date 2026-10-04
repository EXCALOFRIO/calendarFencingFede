import { describe, expect, it } from 'vitest';
import { isOrdinarySourceFailure, preferCampaignFailure } from '../src/lib/ingest/factory-batch/failure-policy';

describe('Factory sibling failure priority', () => {
  it.each([
    ['factory_candidate_invalid', 'factory_tree_stop_failed', 'factory_tree_stop_failed'],
    ['factory_tree_drain_failed', 'factory_candidate_invalid', 'factory_tree_drain_failed'],
    ['factory_campaign_stopped', 'factory_candidate_invalid', 'factory_candidate_invalid'],
    ['factory_child_nonzero', 'factory_campaign_stopped', 'factory_child_nonzero'],
    ['factory_candidate_invalid', 'factory_envelope_invalid', 'factory_envelope_invalid'],
  ])('preserves the stronger failure between %s and %s', (first, second, expected) => {
    expect((preferCampaignFailure(new Error(first), new Error(second)) as Error).message).toBe(expected);
  });
  it('fails closed for unknown errors and never treats transport/protocol failures as quality', () => {
    const unknown = new Error('unknown');
    expect(preferCampaignFailure(unknown, new Error('factory_job_timeout'))).toBe(unknown);
    for (const code of ['factory_child_nonzero', 'factory_envelope_invalid', 'factory_tree_stop_failed', 'unknown']) {
      expect(isOrdinarySourceFailure(code)).toBe(false);
    }
    expect(isOrdinarySourceFailure('factory_candidate_invalid')).toBe(true);
    expect(preferCampaignFailure(undefined, unknown)).toBe(unknown);
  });
});
