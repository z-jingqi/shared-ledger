CREATE TABLE ai_confirmations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  book_id TEXT,
  action TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','confirmed','cancelled')),
  payload TEXT NOT NULL,
  result TEXT,
  expires_at TEXT NOT NULL,
  confirmed_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX ai_confirmations_user_status ON ai_confirmations(user_id,status);

CREATE TABLE ai_action_audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  book_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('success','error')),
  payload TEXT NOT NULL,
  result TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX ai_action_audit_book ON ai_action_audit_logs(book_id);

CREATE TABLE ai_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  book_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  source_type TEXT,
  source_id TEXT,
  payload TEXT,
  result TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX ai_tasks_user_status ON ai_tasks(user_id,status);
CREATE INDEX ai_tasks_source ON ai_tasks(source_type,source_id);
