ALTER TABLE import_jobs ADD COLUMN ocr_progress INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_jobs ADD COLUMN ocr_stage TEXT;
ALTER TABLE import_jobs ADD COLUMN ocr_current_page INTEGER;
ALTER TABLE import_jobs ADD COLUMN ocr_total_pages INTEGER;
ALTER TABLE import_jobs ADD COLUMN ocr_completed_at TEXT;
ALTER TABLE import_jobs ADD COLUMN ocr_event_sequence INTEGER NOT NULL DEFAULT 0;
