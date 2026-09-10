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

-- User feedback — bug reports, feature requests, and general feedback.
-- Status lifecycle: new → under_review → planned | completed | rejected.
CREATE TABLE IF NOT EXISTS feedback (
  id          TEXT PRIMARY KEY,
  userId      TEXT NOT NULL,
  userEmail   TEXT DEFAULT '',
  type        TEXT NOT NULL,          -- bug | feature | feedback
  subject     TEXT NOT NULL,
  description TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'new',
  currentPage TEXT DEFAULT '',
  browser     TEXT DEFAULT '',
  deviceType  TEXT DEFAULT '',
  appVersion  TEXT DEFAULT '',
  submittedAt TEXT DEFAULT '',
  createdAt   TEXT DEFAULT '',
  updatedAt   TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(userId);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);