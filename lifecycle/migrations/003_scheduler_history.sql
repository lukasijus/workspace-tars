CREATE TABLE IF NOT EXISTS scheduler_runs (
  id BIGSERIAL PRIMARY KEY,
  status TEXT NOT NULL,
  total_runs INTEGER NOT NULL,
  completed_runs INTEGER NOT NULL DEFAULT 0,
  items_per_run INTEGER NOT NULL,
  gap_minutes INTEGER NOT NULL DEFAULT 0,
  current_run INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active_run_started_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  last_error TEXT,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scheduler_runs_status_idx
ON scheduler_runs (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS scheduler_runs_started_idx
ON scheduler_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS scheduler_run_items (
  id BIGSERIAL PRIMARY KEY,
  scheduler_run_id BIGINT NOT NULL REFERENCES scheduler_runs(id) ON DELETE CASCADE,
  worker_run_id BIGINT REFERENCES worker_runs(id) ON DELETE SET NULL,
  run_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  duration_ms BIGINT,
  exit_code INTEGER,
  signal TEXT,
  error TEXT,
  stderr_tail TEXT,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scheduler_run_id, run_number)
);

CREATE INDEX IF NOT EXISTS scheduler_run_items_scheduler_idx
ON scheduler_run_items (scheduler_run_id, run_number ASC);

CREATE INDEX IF NOT EXISTS scheduler_run_items_worker_idx
ON scheduler_run_items (worker_run_id);
