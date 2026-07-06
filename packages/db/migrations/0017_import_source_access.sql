ALTER TABLE import_jobs ADD COLUMN source_access_token_hash TEXT;
ALTER TABLE import_jobs ADD COLUMN source_access_token_expires_at TEXT;
ALTER TABLE import_jobs ADD COLUMN source_access_token_revoked_at TEXT;
