PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS ai_confirmations;
DROP TABLE IF EXISTS ai_tool_calls;
DROP TABLE IF EXISTS ai_messages;
DROP TABLE IF EXISTS ai_sessions;
DROP TABLE IF EXISTS ai_provider_configs;
DROP TABLE IF EXISTS password_reset_tokens;
DROP TABLE IF EXISTS oauth_states;
DROP TABLE IF EXISTS auth_sessions;
DROP TABLE IF EXISTS auth_identities;
DROP TABLE IF EXISTS imported_records;
DROP TABLE IF EXISTS import_jobs;
DROP TABLE IF EXISTS attachments;
DROP TABLE IF EXISTS transaction_tags;
DROP TABLE IF EXISTS transaction_items;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS invitations;
DROP TABLE IF EXISTS book_members;
DROP TABLE IF EXISTS books;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS ai_action_audit_logs;
DROP TABLE IF EXISTS ai_tasks;
DROP TABLE IF EXISTS ai_conversations;

PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  avatar_url TEXT,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT
);

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan TEXT NOT NULL CHECK(plan IN ('free','pro')),
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT
);

CREATE TABLE books (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT
);

CREATE TABLE book_members (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('creator','admin','member')),
  joined_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT
);

CREATE UNIQUE INDEX book_members_book_user_active ON book_members(book_id,user_id) WHERE deleted_at IS NULL;
CREATE INDEX book_members_user ON book_members(user_id);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  inviter_user_id TEXT NOT NULL,
  invitee_email TEXT,
  invitee_phone TEXT,
  invitee_user_id TEXT,
  role TEXT NOT NULL CHECK(role IN ('admin','member')),
  status TEXT NOT NULL CHECK(status IN ('pending','accepted','declined','expired','revoked')),
  expires_at TEXT NOT NULL,
  last_reminded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT
);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
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

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT
);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('income','expense')),
  amount_cents INTEGER NOT NULL,
  category_id TEXT,
  account_id TEXT,
  member_id TEXT,
  note TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT
);

CREATE INDEX transactions_book_date ON transactions(book_id, occurred_at);

CREATE TABLE transaction_items (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  category_id TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT
);

CREATE TABLE transaction_tags (
  transaction_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT
);

CREATE UNIQUE INDEX transaction_tags_unique_active ON transaction_tags(transaction_id,tag_id) WHERE deleted_at IS NULL;

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  transaction_id TEXT,
  import_job_id TEXT,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT
);

CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  status TEXT NOT NULL,
  auto_confirm INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  error_code TEXT,
  error_stage TEXT,
  error_request_id TEXT,
  error_retryable INTEGER NOT NULL DEFAULT 0,
  error_terminal INTEGER NOT NULL DEFAULT 0,
  failed_external_job_id TEXT,
  cancelable INTEGER NOT NULL DEFAULT 0,
  retryable INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  convert_job_id TEXT,
  convert_event_sequence INTEGER NOT NULL DEFAULT 0,
  converted_r2_key TEXT,
  converted_file_type TEXT,
  ocr_job_id TEXT,
  ocr_submitted_at TEXT,
  ocr_progress INTEGER NOT NULL DEFAULT 0,
  ocr_stage TEXT,
  ocr_current_page INTEGER,
  ocr_total_pages INTEGER,
  ocr_completed_at TEXT,
  ocr_event_sequence INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT
);

CREATE INDEX import_jobs_book_created ON import_jobs(book_id, created_at);
CREATE INDEX import_jobs_user_created ON import_jobs(user_id, created_at);

CREATE TABLE imported_records (
  id TEXT PRIMARY KEY,
  import_job_id TEXT NOT NULL,
  raw_data TEXT NOT NULL,
  suggested_transaction TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  warnings TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT
);

CREATE INDEX imported_records_job ON imported_records(import_job_id);

CREATE TABLE auth_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('password','google','wechat')),
  provider_account_id TEXT,
  password_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT,
  UNIQUE(provider, provider_account_id),
  UNIQUE(user_id, provider)
);

CREATE INDEX auth_identities_user ON auth_identities(user_id);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT
);

CREATE INDEX auth_sessions_user ON auth_sessions(user_id);

CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('google','wechat')),
  redirect_to TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT
);

CREATE TABLE password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT
);

CREATE INDEX password_reset_tokens_user ON password_reset_tokens(user_id);

CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT
);

CREATE INDEX refresh_tokens_user ON refresh_tokens(user_id);

CREATE TABLE ai_provider_configs (
  user_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('workers-ai','openai','anthropic','openrouter')),
  model TEXT NOT NULL,
  api_key_ref TEXT,
  base_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT
);

CREATE TABLE ai_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  book_id TEXT,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT
);

CREATE INDEX ai_sessions_user_updated ON ai_sessions(user_id, updated_at);

CREATE TABLE ai_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
  content TEXT NOT NULL,
  parts TEXT,
  attachments TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT
);

CREATE INDEX ai_confirmations_user_status ON ai_confirmations(user_id, status);
CREATE INDEX ai_confirmations_tool_call ON ai_confirmations(tool_call_id);
