const APPLICATION_STATUS = Object.freeze({
  DISCOVERED: 'discovered',
  RANKED: 'ranked',
  DRAFT_READY: 'draft_ready',
  PENDING_APPROVAL: 'pending_approval',
  NEEDS_HUMAN_INPUT: 'needs_human_input',
  APPROVED: 'approved',
  SUBMITTING: 'submitting',
  SUBMITTED: 'submitted',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  DUPLICATE: 'duplicate',
});

const APPROVAL_STATE = Object.freeze({
  NONE: 'none',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

const WORKER_RUN_STATUS = Object.freeze({
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

const FLOW_TYPE = Object.freeze({
  EASY_APPLY_NATIVE: 'easy_apply_native',
  EXTERNAL_ATS_GREENHOUSE: 'external_ats_greenhouse',
  EXTERNAL_ATS_LEVER: 'external_ats_lever',
  EXTERNAL_CUSTOM: 'external_custom',
  NO_APPLY_PATH: 'no_apply_path',
  UNKNOWN: 'unknown',
});

const STEP_NAME = Object.freeze({
  SEARCH: 'search',
  INGEST: 'ingest',
  DISCOVERY: 'discovery',
  CV_VARIANT: 'cv_variant',
  APPROVAL: 'approval',
  SUBMIT: 'submit',
  SUMMARY: 'summary',
  WATCHDOG: 'watchdog',
});

module.exports = {
  APPLICATION_STATUS,
  APPROVAL_STATE,
  WORKER_RUN_STATUS,
  FLOW_TYPE,
  STEP_NAME,
};
