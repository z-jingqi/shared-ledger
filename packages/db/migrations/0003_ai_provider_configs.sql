CREATE TABLE ai_provider_configs (
  user_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('workers-ai','openai','anthropic','openrouter')),
  model TEXT NOT NULL,
  api_key_ref TEXT,
  base_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
