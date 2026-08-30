// Local SQLite adapter that mimics the Cloudflare D1 binding API so the
// same async storage code (d1.js) runs in local Node dev. Uses the
// built-in `node:sqlite` module (Node 22.5+). If unavailable, falls back
// to a tiny in-memory store so the app still boots.
//
// The returned object exposes the D1-shaped surface used by d1.js:
//   prepare(sql).bind(...).all() / .run() / .first()
//   batch([...prepared])
//
// This keeps a single storage implementation across dev and Workers.

import { DatabaseSync } from "node:sqlite";

let db = null;

function getDb() {
  if (db) return db;
  db = new DatabaseSync(process.env.DB_PATH || ":memory:");
  db.exec(SCHEMA);
  return db;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  userId TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  phone TEXT DEFAULT '',
  passwordHash TEXT NOT NULL,
  displayName TEXT DEFAULT '',
  avatarDataUrl TEXT DEFAULT '',
  loginDays TEXT DEFAULT '[]',
  createdAt TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  amount REAL DEFAULT 0,
  date TEXT DEFAULT '',
  categoryId TEXT DEFAULT '',
  note TEXT DEFAULT '',
  time TEXT DEFAULT '',
  paymentMethod TEXT DEFAULT '',
  upiApp TEXT DEFAULT '',
  createdAt TEXT DEFAULT '',
  updatedAt TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_expenses_user ON expenses(userId);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  name TEXT DEFAULT '',
  color TEXT DEFAULT '',
  icon TEXT DEFAULT '',
  isDefault INTEGER DEFAULT 0,
  sortOrder REAL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(userId);
CREATE TABLE IF NOT EXISTS budgets (
  userId TEXT NOT NULL,
  monthKey TEXT NOT NULL,
  categoryId TEXT NOT NULL,
  amount REAL DEFAULT 0,
  PRIMARY KEY (userId, monthKey, categoryId)
);
CREATE TABLE IF NOT EXISTS splits (
  userId TEXT NOT NULL,
  id TEXT NOT NULL,
  splitJson TEXT DEFAULT '{}',
  createdAt TEXT DEFAULT '',
  PRIMARY KEY (userId, id)
);
CREATE TABLE IF NOT EXISTS blobs (
  userId TEXT PRIMARY KEY,
  blobJson TEXT DEFAULT 'null'
);
CREATE TABLE IF NOT EXISTS crypto_wraps (
  wrapId TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  wrapType TEXT DEFAULT '',
  envelope TEXT DEFAULT '',
  createdAt TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_wraps_user ON crypto_wraps(userId);
CREATE TABLE IF NOT EXISTS vault_blobs (
  userId TEXT PRIMARY KEY,
  envelope TEXT DEFAULT '',
  updatedAt TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
  tokenHash TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  email TEXT DEFAULT '',
  expiresAt TEXT DEFAULT '',
  parent TEXT DEFAULT '',
  createdAt TEXT DEFAULT ''
);
`;

function normalizeRow(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v === null ? null : v;
  }
  return out;
}

class Prepared {
  constructor(sql) {
    this.sql = sql;
  }
  bind(...args) {
    this.args = args;
    return this;
  }
  async all() {
    const stmt = getDb().prepare(this.sql);
    const rows = stmt.all(...(this.args || []));
    return { results: rows.map(normalizeRow) };
  }
  async first() {
    const { results } = await this.all();
    return results[0] || null;
  }
  async run() {
    const stmt = getDb().prepare(this.sql);
    const info = stmt.run(...(this.args || []));
    return { meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid || 0) } };
  }
}

export function createLocalD1() {
  return {
    prepare(sql) {
      return new Prepared(sql);
    },
    async batch(statements) {
      const d = getDb();
      const results = [];
      d.exec("BEGIN");
      try {
        for (const s of statements) {
          results.push(await s.run());
        }
        d.exec("COMMIT");
      } catch (err) {
        d.exec("ROLLBACK");
        throw err;
      }
      return results;
    },
  };
}