ALTER TABLE import_jobs ADD COLUMN ocr_job_id TEXT;
ALTER TABLE import_jobs ADD COLUMN ocr_submitted_at TEXT;
ALTER TABLE import_jobs ADD COLUMN ocr_poll_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS import_jobs_ocr_job ON import_jobs(ocr_job_id);
