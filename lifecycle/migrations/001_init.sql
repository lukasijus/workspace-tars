CREATE TABLE IF NOT EXISTS worker_runs (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  timeout_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_class TEXT,
  error_message TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS jobs (
  id BIGSERIAL PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'linkedin',
  source_job_id TEXT,
  source_url TEXT,
  company TEXT,
  title TEXT,
  location TEXT,
  posted_time TEXT,
  latest_fit_score INTEGER NOT NULL DEFAULT 0,
  matched_strong JSONB NOT NULL DEFAULT '[]'::jsonb,
  matched_bonus JSONB NOT NULL DEFAULT '[]'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  latest_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_search_name TEXT,
  last_run_id BIGINT REFERENCES worker_runs(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS jobs_latest_seen_idx ON jobs (latest_seen_at DESC);
CREATE INDEX IF NOT EXISTS jobs_fit_idx ON jobs (latest_fit_score DESC, latest_seen_at DESC);

CREATE TABLE IF NOT EXISTS job_runs (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  worker_run_id BIGINT REFERENCES worker_runs(id) ON DELETE SET NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  search_name TEXT,
  fit_score INTEGER NOT NULL DEFAULT 0,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS job_runs_job_idx ON job_runs (job_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS applications (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  flow_type TEXT NOT NULL DEFAULT 'unknown',
  approval_state TEXT NOT NULL DEFAULT 'none',
  cv_variant_path TEXT,
  cv_variant_file_name TEXT,
  external_apply_url TEXT,
  draft_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  discovered_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_worker_run_id BIGINT REFERENCES worker_runs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  submission_attempted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS applications_status_idx ON applications (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS applications_approval_idx ON applications (approval_state, updated_at DESC);

CREATE TABLE IF NOT EXISTS application_steps (
  id BIGSERIAL PRIMARY KEY,
  application_id BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  worker_run_id BIGINT REFERENCES worker_runs(id) ON DELETE SET NULL,
  step TEXT NOT NULL,
  status TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS application_steps_app_idx ON application_steps (application_id, created_at DESC);

CREATE TABLE IF NOT EXISTS approvals (
  application_id BIGINT PRIMARY KEY REFERENCES applications(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  actor TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS artifacts (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id BIGINT NOT NULL,
  kind TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS artifacts_entity_idx ON artifacts (entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS daily_summaries (
  id BIGSERIAL PRIMARY KEY,
  summary_date DATE NOT NULL UNIQUE,
  status TEXT NOT NULL,
  subject TEXT NOT NULL,
  text_body TEXT NOT NULL,
  html_body TEXT NOT NULL,
  sent_at TIMESTAMPTZ,
  delivery_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
