CREATE TABLE IF NOT EXISTS ai_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  book_id TEXT,
  status TEXT NOT NULL,
  input TEXT NOT NULL,
  selected_skill TEXT,
  final_message_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT
);

CREATE INDEX IF NOT EXISTS ai_runs_session_created ON ai_runs(session_id, created_at);
CREATE INDEX IF NOT EXISTS ai_runs_user_status ON ai_runs(user_id, status);

CREATE TABLE IF NOT EXISTS ai_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  kind TEXT NOT NULL,
  skill_name TEXT,
  tool_name TEXT,
  status TEXT NOT NULL,
  input TEXT,
  output TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT
);

CREATE INDEX IF NOT EXISTS ai_steps_run_index ON ai_steps(run_id, step_index);

ALTER TABLE ai_tool_calls ADD COLUMN skill_name TEXT NOT NULL DEFAULT 'general.chat';
