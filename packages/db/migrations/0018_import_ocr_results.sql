CREATE TABLE IF NOT EXISTS import_ocr_results (
  id TEXT PRIMARY KEY,
  import_job_id TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  engine_version TEXT,
  raw_text TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  converted INTEGER NOT NULL DEFAULT 0,
  source_mime_type TEXT,
  processed_mime_type TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  created_by_user_id TEXT,
  updated_by_user_id TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS import_ocr_results_job ON import_ocr_results(import_job_id);
