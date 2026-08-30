-- XPENSIC D1 schema
-- Mirrors the CSV tables from the previous file-backed storage. Each
-- table stores the same columns; the server code adapts rows to/from
-- the same object shapes the routes already use.

DROP TABLE IF EXISTS users;
CREATE TABLE IF NOT EXISTS users (
  userId        TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  phone         TEXT DEFAULT '',
  passwordHash  TEXT NOT NULL,
  displayName   TEXT DEFAULT '',
  avatarDataUrl TEXT DEFAULT '',
  loginDays     TEXT DEFAULT '[]',
  createdAt     TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

DROP TABLE IF EXISTS expenses;
CREATE TABLE IF NOT EXISTS expenses (
  id            TEXT PRIMARY KEY,
  userId        TEXT NOT NULL,
  amount        REAL DEFAULT 0,
  date          TEXT DEFAULT '',
  categoryId    TEXT DEFAULT '',
  note          TEXT DEFAULT '',
  time          TEXT DEFAULT '',
  paymentMethod TEXT DEFAULT '',
  upiApp        TEXT DEFAULT '',
  createdAt     TEXT DEFAULT '',
  updatedAt     TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_expenses_user ON expenses(userId);

DROP TABLE IF EXISTS categories;
CREATE TABLE IF NOT EXISTS categories (
  id        TEXT PRIMARY KEY,
  userId    TEXT NOT NULL,
  name      TEXT DEFAULT '',
  color     TEXT DEFAULT '',
  icon      TEXT DEFAULT '',
  isDefault INTEGER DEFAULT 0,
  sortOrder REAL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(userId);

DROP TABLE IF EXISTS budgets;
CREATE TABLE IF NOT EXISTS budgets (
  userId     TEXT NOT NULL,
  monthKey   TEXT NOT NULL,
  categoryId TEXT NOT NULL,
  amount     REAL DEFAULT 0,
  PRIMARY KEY (userId, monthKey, categoryId)
);

DROP TABLE IF EXISTS splits;
CREATE TABLE IF NOT EXISTS splits (
  userId    TEXT NOT NULL,
  id        TEXT NOT NULL,
  splitJson TEXT DEFAULT '{}',
  createdAt TEXT DEFAULT '',
  PRIMARY KEY (userId, id)
);

DROP TABLE IF EXISTS blobs;
CREATE TABLE IF NOT EXISTS blobs (
  userId   TEXT PRIMARY KEY,
  blobJson TEXT DEFAULT 'null'
);

DROP TABLE IF EXISTS crypto_wraps;
CREATE TABLE IF NOT EXISTS crypto_wraps (
  wrapId    TEXT PRIMARY KEY,
  userId    TEXT NOT NULL,
  wrapType  TEXT DEFAULT '',
  envelope  TEXT DEFAULT '',
  createdAt TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_wraps_user ON crypto_wraps(userId);

DROP TABLE IF EXISTS vault_blobs;
CREATE TABLE IF NOT EXISTS vault_blobs (
  userId    TEXT PRIMARY KEY,
  envelope  TEXT DEFAULT '',
  updatedAt TEXT DEFAULT ''
);

DROP TABLE IF EXISTS refresh_tokens;
CREATE TABLE IF NOT EXISTS refresh_tokens (
  tokenHash TEXT PRIMARY KEY,
  userId    TEXT NOT NULL,
  email     TEXT DEFAULT '',
  expiresAt TEXT DEFAULT '',
  parent    TEXT DEFAULT '',
  createdAt TEXT DEFAULT ''
);