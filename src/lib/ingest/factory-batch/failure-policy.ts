const ordinaryErrors = new Set([
  'factory_candidate_invalid', 'factory_candidate_identity_mismatch', 'factory_metadata_evidence_missing',
  'factory_evidence_source_invalid', 'factory_reviewed_source_invalid', 'factory_reviewed_source_missing',
  'factory_evidence_page_not_reviewed', 'factory_evidence_pointer_not_reviewed', 'factory_gap_source_invalid',
  'factory_missing_endpoint_not_partial', 'factory_missing_endpoint_gap_required', 'factory_partial_gaps_required',
  'factory_candidate_review_incomplete', 'factory_status_facts_conflict',
  'factory_job_timeout', 'factory_output_limit', 'factory_campaign_stopped',
  'factory_started_job_requires_reconciliation',
]);

/** Advancing still requires the portfolio's independent positive audit checks. */
export function isOrdinarySourceFailure(code: string): boolean {
  return ordinaryErrors.has(code);
}

function priority(error: unknown): number {
  const code = error instanceof Error ? error.message : '';
  if (code === 'factory_tree_stop_failed' || code === 'factory_tree_drain_failed') return 3;
  if (code === 'factory_campaign_stopped') return 0;
  return isOrdinarySourceFailure(code) ? 1 : 2;
}

/** A sibling cancellation or quality failure must never hide a safety failure. */
export function preferCampaignFailure(previous: unknown, next: unknown): unknown {
  return previous === undefined || priority(next) > priority(previous) ? next : previous;
}
