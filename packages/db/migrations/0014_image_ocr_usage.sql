CREATE TABLE IF NOT EXISTS image_ocr_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  import_job_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  counted_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  created_by_user_id TEXT NOT NULL,
  updated_by_user_id TEXT NOT NULL,
  deleted_by_user_id TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS image_ocr_usage_import_job ON image_ocr_usage(import_job_id);
CREATE INDEX IF NOT EXISTS image_ocr_usage_user_date ON image_ocr_usage(user_id, usage_date);
