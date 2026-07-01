UPDATE transactions SET category_id = NULL;
UPDATE transaction_items SET category_id = NULL;

DROP TABLE IF EXISTS transaction_tags;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS categories;

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('income','expense')),
  icon TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT
);

CREATE UNIQUE INDEX categories_user_type_name_active ON categories(user_id,type,name) WHERE deleted_at IS NULL;

ALTER TABLE import_jobs DROP COLUMN processed_r2_key;
ALTER TABLE import_jobs DROP COLUMN processed_file_type;
