CREATE TABLE user_invite_blocks (
  id TEXT PRIMARY KEY,
  blocker_user_id TEXT NOT NULL,
  blocked_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL DEFAULT '0',
  updated_by_user_id TEXT NOT NULL DEFAULT '0',
  deleted_at TEXT,
  deleted_by_user_id TEXT
);

CREATE UNIQUE INDEX user_invite_blocks_pair_active
  ON user_invite_blocks(blocker_user_id, blocked_user_id)
  WHERE deleted_at IS NULL;

CREATE INDEX user_invite_blocks_blocked ON user_invite_blocks(blocked_user_id);
