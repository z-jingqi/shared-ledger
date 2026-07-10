DROP INDEX IF EXISTS import_jobs_active_file_hash;
DROP INDEX IF EXISTS import_jobs_ocr_text_hash;

CREATE INDEX IF NOT EXISTS import_jobs_file_hash
ON import_jobs(book_id, file_hash);

CREATE INDEX IF NOT EXISTS import_jobs_ocr_text_hash
ON import_jobs(book_id, ocr_text_hash);
