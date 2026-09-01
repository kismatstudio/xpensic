-- Reviewed cleanup for databases that still contain the retired plaintext
-- financial tables. Run only after exporting any legacy data the owner is
-- authorized to retain; this permanently deletes those tables' contents.
DROP TABLE IF EXISTS expenses;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS budgets;
DROP TABLE IF EXISTS splits;
DROP TABLE IF EXISTS blobs;

-- Rebuild users without the retired plaintext profile columns while keeping
-- account identifiers, phone identifiers, password hashes, and timestamps.
CREATE TABLE IF NOT EXISTS users_e2ee (
  userId TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  phone TEXT DEFAULT '',
  passwordHash TEXT NOT NULL,
  createdAt TEXT DEFAULT ''
);
INSERT INTO users_e2ee (userId, email, phone, passwordHash, createdAt)
  SELECT userId, email, phone, passwordHash, createdAt FROM users;
DROP TABLE users;
ALTER TABLE users_e2ee RENAME TO users;
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);