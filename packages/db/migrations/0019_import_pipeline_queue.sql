ALTER TABLE import_jobs ADD COLUMN ocr_provider TEXT;
ALTER TABLE import_jobs ADD COLUMN ocr_input_r2_key TEXT;
ALTER TABLE import_jobs ADD COLUMN ocr_input_file_type TEXT;

UPDATE import_jobs SET ocr_provider = aleph_tool WHERE aleph_tool IS NOT NULL;
