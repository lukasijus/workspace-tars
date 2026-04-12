CREATE TABLE IF NOT EXISTS application_answer_decisions (
  id BIGSERIAL PRIMARY KEY,
  application_id BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  worker_run_id BIGINT REFERENCES worker_runs(id) ON DELETE SET NULL,
  question_key TEXT NOT NULL,
  question_text TEXT,
  field_label TEXT,
  field_type TEXT,
  answer TEXT,
  confidence NUMERIC,
  source TEXT,
  source_evidence TEXT,
  reason TEXT,
  risk_level TEXT,
  should_auto_fill BOOLEAN NOT NULL DEFAULT FALSE,
  requires_human_review BOOLEAN NOT NULL DEFAULT FALSE,
  resolver_mode TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS application_answer_decisions_application_idx
ON application_answer_decisions (application_id, created_at DESC);

CREATE INDEX IF NOT EXISTS application_answer_decisions_question_idx
ON application_answer_decisions (question_key, created_at DESC);

CREATE TABLE IF NOT EXISTS application_answer_memory (
  question_key TEXT PRIMARY KEY,
  answer TEXT NOT NULL,
  confidence NUMERIC,
  source TEXT,
  source_evidence TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
