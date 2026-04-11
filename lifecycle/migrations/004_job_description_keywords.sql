ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS description_text TEXT;

ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS description_html TEXT;

ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS description_fetched_at TIMESTAMPTZ;

ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS description_source_url TEXT;

ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS keyword_extraction_status TEXT NOT NULL DEFAULT 'not_started';

ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS keyword_extracted_at TIMESTAMPTZ;

ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS keyword_extraction JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS jobs_keyword_extraction_status_idx
ON jobs (keyword_extraction_status, keyword_extracted_at DESC);

CREATE INDEX IF NOT EXISTS jobs_keyword_extraction_gin_idx
ON jobs USING GIN (keyword_extraction);
