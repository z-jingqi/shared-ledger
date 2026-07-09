ALTER TABLE import_jobs ADD COLUMN file_hash TEXT;
ALTER TABLE import_jobs ADD COLUMN ocr_text_hash TEXT;
ALTER TABLE import_jobs ADD COLUMN duplicate_of_import_job_id TEXT;

CREATE INDEX IF NOT EXISTS import_jobs_file_hash ON import_jobs(book_id, user_id, file_hash);
CREATE INDEX IF NOT EXISTS import_jobs_ocr_text_hash ON import_jobs(book_id, user_id, ocr_text_hash);
