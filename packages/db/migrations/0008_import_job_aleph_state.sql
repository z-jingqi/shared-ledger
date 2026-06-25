ALTER TABLE import_jobs ADD COLUMN convert_job_id TEXT;
ALTER TABLE import_jobs ADD COLUMN convert_event_sequence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_jobs ADD COLUMN converted_r2_key TEXT;
ALTER TABLE import_jobs ADD COLUMN converted_file_type TEXT;
ALTER TABLE import_jobs ADD COLUMN error_code TEXT;
ALTER TABLE import_jobs ADD COLUMN error_stage TEXT;
ALTER TABLE import_jobs ADD COLUMN error_request_id TEXT;
ALTER TABLE import_jobs ADD COLUMN error_retryable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_jobs ADD COLUMN error_terminal INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_jobs ADD COLUMN failed_external_job_id TEXT;
ALTER TABLE import_jobs ADD COLUMN cancelable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_jobs ADD COLUMN retryable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_jobs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS import_jobs_convert_job ON import_jobs(convert_job_id);
