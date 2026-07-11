ALTER TABLE book_members ADD COLUMN allow_admin_edit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invitations ADD COLUMN allow_admin_edit INTEGER;

CREATE TABLE invitation_hidden_by (
  id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  updated_by_user_id TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by_user_id TEXT
);

CREATE UNIQUE INDEX invitation_hidden_by_user_active
ON invitation_hidden_by(invitation_id,user_id)
WHERE deleted_at IS NULL;

CREATE INDEX invitation_hidden_by_user ON invitation_hidden_by(user_id);
