DROP TABLE IF EXISTS import_ocr_results;

UPDATE import_jobs
SET file_hash = NULL
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY book_id, user_id, file_hash
        ORDER BY created_at ASC, id ASC
      ) AS duplicate_rank
    FROM import_jobs
    WHERE deleted_at IS NULL AND file_hash IS NOT NULL
  )
  WHERE duplicate_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS import_jobs_active_file_hash
ON import_jobs(book_id, user_id, file_hash)
WHERE deleted_at IS NULL AND file_hash IS NOT NULL;
