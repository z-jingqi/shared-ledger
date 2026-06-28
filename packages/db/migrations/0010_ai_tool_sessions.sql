DROP TABLE IF EXISTS ai_action_audit_logs;
DROP TABLE IF EXISTS ai_tasks;
DROP TABLE IF EXISTS ai_messages;
DROP TABLE IF EXISTS ai_conversations;
DROP TABLE IF EXISTS ai_confirmations;

CREATE TABLE ai_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  book_id TEXT,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX ai_sessions_user_updated ON ai_sessions(user_id, updated_at);

CREATE TABLE ai_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
  content TEXT NOT NULL,
  parts TEXT,
  attachments TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX ai_messages_session_created ON ai_messages(session_id, created_at);

CREATE TABLE ai_tool_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  book_id TEXT,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('planned','running','pending_confirmation','completed','failed','cancelled')),
  args TEXT NOT NULL,
  result TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX ai_tool_calls_session_created ON ai_tool_calls(session_id, created_at);
CREATE INDEX ai_tool_calls_user_status ON ai_tool_calls(user_id, status);

CREATE TABLE ai_confirmations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  book_id TEXT,
  tool_call_id TEXT,
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

CREATE INDEX ai_confirmations_user_status ON ai_confirmations(user_id, status);
CREATE INDEX ai_confirmations_tool_call ON ai_confirmations(tool_call_id);
