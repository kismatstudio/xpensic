-- XPENSIC D1 schema for a new database.
-- Existing databases must use the numbered migrations in this directory.

CREATE TABLE IF NOT EXISTS users (
  userId        TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  phone         TEXT DEFAULT '',
  passwordHash  TEXT NOT NULL,
  createdAt     TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS crypto_wraps (
  wrapId    TEXT PRIMARY KEY,
  userId    TEXT NOT NULL,
  wrapType  TEXT DEFAULT '',
  envelope  TEXT DEFAULT '',
  createdAt TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_wraps_user ON crypto_wraps(userId);

CREATE TABLE IF NOT EXISTS vault_blobs (
  userId    TEXT PRIMARY KEY,
  envelope  TEXT DEFAULT '',
  revision  INTEGER NOT NULL DEFAULT 0,
  updatedAt TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  tokenHash TEXT PRIMARY KEY,
  userId    TEXT NOT NULL,
  email     TEXT DEFAULT '',
  expiresAt TEXT DEFAULT '',
  parent    TEXT DEFAULT '',
  createdAt TEXT DEFAULT ''
);