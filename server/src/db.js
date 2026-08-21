// CSV-backed storage. Replaces the old single-JSON-file design with one
// CSV per table inside a directory. The on-disk shape is:
//   <DB_DIR>/
//     users.csv       one row per account
//     expenses.csv    one row per expense (userId denormalised)
//     categories.csv  one row per category
//     budgets.csv     one row per (userId, monthKey, categoryId)
//     blobs.csv       one row per user — the full v5 client blob
//
// Reads are cached in memory after the first load (the dataset is
// tiny). Writes go through a debounced flush that writes to a .tmp
// sibling and renames over the target file — atomic on every
// filesystem, so a crash mid-write can never corrupt a CSV.
//
// Public API matches the previous JSON implementation exactly:
//   initDb(), flush(), findUserByEmail(), findUserById(),
//   createUser(), updateUser(), getUserData(), setUserData(),
//   deleteUserData()
//
// The first time this runs against an existing expense-tracker.db.json
// file, initDb() performs a one-shot JSON→CSV migration and renames the
// JSON to .migrated so it never runs again.

import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  rmSync,
} from "node:fs";
import { dirname, resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv, writeCsv } from "./csv.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// DB_DIR defaults to <server>/data. Can be overridden with DB_DIR or
// DB_PATH; DB_PATH keeps the previous env var name working for callers
// that point at a directory.
const DB_DIR = (() => {
  const env = process.env.DB_DIR || process.env.DB_PATH;
  if (env) {
    // If env points at an existing file (the legacy db.json location)
    // we still honour it but switch to its parent directory.
    try {
      if (existsSync(env) && statSync(env).isFile()) {
        return dirname(env);
      }
    } catch { /* ignore */ }
    return env;
  }
  return resolve(__dirname, "..", "data");
})();

// Legacy JSON file location — used for one-shot migration only.
const LEGACY_JSON = resolve(__dirname, "..", "expense-tracker.db.json");
const MIGRATED_SUFFIX = ".migrated";

// --- Table definitions -----------------------------------------------------
// Headers are the source of truth for column order. Each row is an
// object keyed by header. Values are coerced to strings on write.

const TABLES = {
  users: {
    file: "users.csv",
    header: [
      "userId", "email", "phone", "passwordHash",
      "displayName", "avatarDataUrl", "createdAt",
    ],
  },
  expenses: {
    file: "expenses.csv",
    header: [
      "id", "userId", "amount", "date", "categoryId", "note",
      "time", "paymentMethod", "upiApp",
      "createdAt", "updatedAt",
    ],
  },
  categories: {
    file: "categories.csv",
    header: [
      "id", "userId", "name", "color", "icon", "isDefault", "sortOrder",
    ],
  },
  budgets: {
    file: "budgets.csv",
    header: ["userId", "monthKey", "categoryId", "amount"],
  },
  splits: {
    // Per-user split-bill records. Each row is a self-contained JSON
    // blob so we don't have to flatten the participants array into
    // separate columns. The client treats splits as their own log
    // alongside regular expenses.
    file: "splits.csv",
    header: ["userId", "id", "splitJson", "createdAt"],
  },
  blobs: {
    // The full v5 client blob (categories + budgets + expenses +
    // settings + profile) — keeps the existing "one row per user"
    // round-trip semantics the client already uses via /api/data.
    file: "blobs.csv",
    header: ["userId", "blobJson"],
  },
  crypto_wraps: {
    // E2EE: per-user list of master-key wraps. The envelope column
    // holds the opaque JSON envelope produced by the client (Argon2id
    // salt + AEAD nonce + ciphertext, etc). The server never sees
    // the master key, password, or recovery phrase.
    file: "crypto_wraps.csv",
    header: ["wrapId", "userId", "wrapType", "envelope", "createdAt"],
  },
  vault_blobs: {
    // E2EE: per-user encrypted vault blob. Holds the full app state
    // (expenses, categories, budgets, etc.) encrypted with the
    // user's master key. Server sees only ciphertext + metadata.
    file: "vault_blobs.csv",
    header: ["userId", "envelope", "updatedAt"],
  },
};

// In-memory cache. `users`, `blobs`, `vault_blobs`, and `crypto_wraps`
// are maps or arrays keyed by userId; the other tables are arrays. We
// rebuild from disk on first access after a flush.
const cache = {
  users: {},            // { userId: user }
  blobs: {},            // { userId: <v5 blob> }
  crypto_wraps: [],     // [{ wrapId, userId, wrapType, envelope, createdAt }]
  vault_blobs: {},      // { userId: <envelope> }
  expenses: [],         // [{ id, userId, ... }]
  categories: [],       // [{ id, userId, ... }]
  budgets: [],          // [{ userId, monthKey, categoryId, amount }]
  splits: [],           // [{ userId, id, ...split fields, createdAt }]
  loaded: false,
};

/**
 * Expose the in-memory cache so other modules (e.g. crypto-db.js)
 * can read/write their own tables without going through a getter
 * dance. Callers MUST go through `markDirty(table)` after mutating
 * so the change is persisted.
 */
export function getCache() {
  return cache;
}

let writeTimer = null;
const dirty = new Set();   // tables with pending writes

// --- Filesystem primitives -------------------------------------------------

function ensureDir() {
  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }
}

function tablePath(name) {
  return join(DB_DIR, TABLES[name].file);
}

/**
 * Atomic write: write to <file>.tmp then rename over the target. Works
 * on every supported filesystem (NTFS, ext4, APFS). If the process
 * crashes mid-write the .tmp file is left behind; we clean those up
 * on boot.
 */
function atomicWrite(filePath, contents) {
  ensureDir();
  const tmp = filePath + ".tmp";
  writeFileSync(tmp, contents, "utf8");
  renameSync(tmp, filePath);
}

function readTable(name) {
  const file = tablePath(name);
  if (!existsSync(file)) return [];
  try {
    const text = readFileSync(file, "utf8");
    if (!text.trim()) return [];
    return parseCsv(text);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[db] could not read ${file} (${err?.message}); treating as empty`);
    return [];
  }
}

function writeTable(name, rows) {
  const def = TABLES[name];
  const text = writeCsv(def.header, rows);
  atomicWrite(tablePath(name), text);
}

function cleanupStaleTmps() {
  try {
    if (!existsSync(DB_DIR)) return;
    for (const entry of readdirSync(DB_DIR)) {
      if (entry.endsWith(".tmp")) {
        try { rmSync(join(DB_DIR, entry), { force: true }); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

// --- Cache management ------------------------------------------------------

export function load() {
  if (cache.loaded) return;
  cleanupStaleTmps();

  // Users
  for (const r of readTable("users")) {
    if (r.userId) cache.users[r.userId] = rowToUser(r);
  }

  // Blobs (per-user v5 client data)
  for (const r of readTable("blobs")) {
    if (!r.userId) continue;
    try {
      cache.blobs[r.userId] = JSON.parse(r.blobJson || "null");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[db] blobs.csv: bad JSON for user ${r.userId} (${err?.message})`);
    }
  }

  // Line items
  cache.expenses   = readTable("expenses").map(rowToExpense).filter(Boolean);
  cache.categories = readTable("categories").map(rowToCategory).filter(Boolean);
  cache.budgets    = readTable("budgets").map(rowToBudget).filter(Boolean);
  cache.splits     = readTable("splits").map(rowToSplit).filter(Boolean);

  // E2EE tables. We keep the envelopes as strings on disk (they're
  // already JSON-encoded by the client) and parse them on read so
  // helpers like `getVault` can hand back a real object.
  cache.crypto_wraps = readTable("crypto_wraps").map((r) => ({
    wrapId: r.wrapId,
    userId: r.userId,
    wrapType: r.wrapType,
    envelope: r.envelope || "",
    createdAt: r.createdAt || "",
  })).filter((r) => r.userId);

  for (const r of readTable("vault_blobs")) {
    if (!r.userId) continue;
    cache.vault_blobs[r.userId] = r.envelope || "";
  }

  cache.loaded = true;
}

export function markDirty(table) {
  dirty.add(table);
  scheduleWrite();
}

function scheduleWrite() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    flush();
  }, 250);
}

export function flush() {
  if (dirty.size === 0) return;
  const tables = Array.from(dirty);
  dirty.clear();
  try {
    for (const name of tables) {
      if (name === "users")   writeTable("users",    Object.values(cache.users).map(userToRow));
      else if (name === "blobs") writeTable("blobs", Object.entries(cache.blobs).map(([userId, blob]) => ({
        userId, blobJson: JSON.stringify(blob ?? null),
      })));
      else if (name === "crypto_wraps") writeTable("crypto_wraps", cache.crypto_wraps);
      else if (name === "vault_blobs") writeTable("vault_blobs", Object.entries(cache.vault_blobs).map(([userId, envelope]) => ({
        userId, envelope, updatedAt: new Date().toISOString(),
      })));
      else if (name === "expenses")   writeTable("expenses",   cache.expenses.map(expenseToRow));
      else if (name === "categories") writeTable("categories", cache.categories.map(categoryToRow));
      else if (name === "budgets")    writeTable("budgets",    cache.budgets.map(budgetToRow));
      else if (name === "splits")     writeTable("splits",     cache.splits.map(splitToRow));
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[db] write failed:", err?.message || err);
  }
}

// --- Row <-> object adapters ----------------------------------------------
// String ↔ typed conversion happens here. Unknown columns are dropped
// on read; missing columns become empty strings on write. We tolerate
// legacy rows that don't have every modern column.

function rowToUser(r) {
  return {
    userId:       r.userId,
    email:        r.email || "",
    phone:        r.phone || "",
    passwordHash: r.passwordHash || "",
    displayName:  r.displayName || "",
    avatarDataUrl: r.avatarDataUrl || "",
    createdAt:    r.createdAt || "",
  };
}

function userToRow(u) {
  return {
    userId:        u.userId || "",
    email:         u.email || "",
    phone:         u.phone || "",
    passwordHash:  u.passwordHash || "",
    displayName:   u.displayName || "",
    avatarDataUrl: u.avatarDataUrl || "",
    createdAt:     u.createdAt || "",
  };
}

function rowToExpense(r) {
  if (!r.id || !r.userId) return null;
  return {
    id:            r.id,
    userId:        r.userId,
    amount:        r.amount === "" ? 0 : Number(r.amount),
    date:          r.date || "",
    categoryId:    r.categoryId || "",
    note:          r.note || "",
    time:          r.time || "",
    paymentMethod: r.paymentMethod || "",
    upiApp:        r.upiApp || "",
    createdAt:     r.createdAt || "",
    updatedAt:     r.updatedAt || "",
  };
}

function expenseToRow(e) {
  return {
    id:            e.id || "",
    userId:        e.userId || "",
    amount:        e.amount ?? "",
    date:          e.date || "",
    categoryId:    e.categoryId || "",
    note:          e.note || "",
    time:          e.time || "",
    paymentMethod: e.paymentMethod || "",
    upiApp:        e.upiApp || "",
    createdAt:     e.createdAt || "",
    updatedAt:     e.updatedAt || "",
  };
}

function rowToCategory(r) {
  if (!r.id || !r.userId) return null;
  return {
    id:        r.id,
    userId:    r.userId,
    name:      r.name || "",
    color:     r.color || "",
    icon:      r.icon || "",
    isDefault: r.isDefault === "true" || r.isDefault === "1",
    sortOrder: r.sortOrder === "" ? 0 : Number(r.sortOrder),
  };
}

function categoryToRow(c) {
  return {
    id:        c.id || "",
    userId:    c.userId || "",
    name:      c.name || "",
    color:     c.color || "",
    icon:      c.icon || "",
    isDefault: c.isDefault ? "true" : "false",
    sortOrder: c.sortOrder ?? "",
  };
}

function rowToBudget(r) {
  if (!r.userId || !r.monthKey || !r.categoryId) return null;
  return {
    userId:     r.userId,
    monthKey:   r.monthKey,
    categoryId: r.categoryId,
    amount:     r.amount === "" ? 0 : Number(r.amount),
  };
}

function budgetToRow(b) {
  return {
    userId:     b.userId || "",
    monthKey:   b.monthKey || "",
    categoryId: b.categoryId || "",
    amount:     b.amount ?? "",
  };
}

// --- Splits --------------------------------------------------------------
// Splits are stored as JSON blobs so we don't have to flatten the
// participants array into separate columns. Each row carries the full
// split record (title, total, participants, friend code, etc.) plus
// the userId + id for indexing.

function rowToSplit(r) {
  if (!r.userId || !r.id) return null;
  let parsed;
  try {
    parsed = JSON.parse(r.splitJson || "{}");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[db] splits.csv: bad JSON for ${r.userId}/${r.id} (${err?.message})`);
    return null;
  }
  return {
    ...parsed,
    userId:    r.userId,
    id:        r.id,
    createdAt: r.createdAt || parsed.createdAt || "",
  };
}

function splitToRow(s) {
  // Strip out the userId / id before JSON-encoding — they're already
  // first-class CSV columns.
  const { userId, id, createdAt, ...rest } = s;
  return {
    userId:    userId || "",
    id:        id || "",
    splitJson: JSON.stringify(rest || {}),
    createdAt: createdAt || "",
  };
}

// --- Legacy JSON migration -------------------------------------------------
// Runs exactly once: if DB_DIR is empty but LEGACY_JSON exists, read the
// JSON, fan it out into the four CSVs, then rename the JSON to .migrated.

function migrateFromJson() {
  // Only migrate if the CSV dir has no tables yet.
  const csvs = ["users.csv", "expenses.csv", "categories.csv", "budgets.csv", "blobs.csv"];
  const anyCsv = csvs.some((f) => existsSync(join(DB_DIR, f)));
  if (anyCsv) return false;

  if (!existsSync(LEGACY_JSON)) return false;

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(LEGACY_JSON, "utf8"));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[db] legacy JSON unreadable (${err?.message}); skipping migration`);
    return false;
  }

  const users = parsed.users && typeof parsed.users === "object" ? parsed.users : {};
  const data  = parsed.data  && typeof parsed.data  === "object" ? parsed.data  : {};

  const userRows = [];
  const expenseRows = [];
  const categoryRows = [];
  const budgetRows = [];
  const blobRows = [];

  for (const [userId, u] of Object.entries(users)) {
    userRows.push(userToRow(u));
    const blob = data[userId];
    if (blob) blobRows.push({ userId, blobJson: JSON.stringify(blob) });
    if (!blob) continue;

    for (const e of (blob.expenses   || [])) expenseRows.push(expenseToRow({ ...e, userId }));
    for (const c of (blob.categories || [])) categoryRows.push(categoryToRow({ ...c, userId }));
    const monthly = blob.budgets && blob.budgets.monthly;
    if (monthly && typeof monthly === "object") {
      for (const [monthKey, perCat] of Object.entries(monthly)) {
        if (!perCat || typeof perCat !== "object") continue;
        for (const [categoryId, amount] of Object.entries(perCat)) {
          budgetRows.push({ userId, monthKey, categoryId, amount });
        }
      }
    }
  }

  ensureDir();
  if (userRows.length)    writeTable("users",    userRows);
  if (expenseRows.length) writeTable("expenses", expenseRows);
  if (categoryRows.length) writeTable("categories", categoryRows);
  if (budgetRows.length)  writeTable("budgets",  budgetRows);
  if (blobRows.length)    writeTable("blobs",    blobRows);

  // Rename so we never re-migrate.
  try {
    renameSync(LEGACY_JSON, LEGACY_JSON + MIGRATED_SUFFIX);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[db] could not rename legacy JSON: ${err?.message}`);
  }
  // eslint-disable-next-line no-console
  console.log(`[db] migrated ${userRows.length} users, ${expenseRows.length} expenses, ${categoryRows.length} categories, ${budgetRows.length} budget cells from ${basename(LEGACY_JSON)} → ${DB_DIR}/`);
  return true;
}

// --- Public API ------------------------------------------------------------

export function initDb() {
  ensureDir();
  migrateFromJson();
  load();
  for (const sig of ["exit", "SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      if (writeTimer) {
        clearTimeout(writeTimer);
        writeTimer = null;
      }
      flush();
    });
  }
  return cache;
}

// --- Users ----------------------------------------------------------------

export function findUserByEmail(email) {
  load();
  const key = String(email || "").toLowerCase();
  for (const u of Object.values(cache.users)) {
    if (u.email && u.email.toLowerCase() === key) return u;
  }
  return null;
}

export function findUserById(userId) {
  load();
  return cache.users[userId] || null;
}

export function createUser(user) {
  load();
  cache.users[user.userId] = user;
  markDirty("users");
  return user;
}

export function updateUser(userId, patch) {
  load();
  const cur = cache.users[userId];
  if (!cur) return null;
  Object.assign(cur, patch);
  markDirty("users");
  return cur;
}

// --- Per-user data --------------------------------------------------------

export function getUserData(userId) {
  load();
  return cache.blobs[userId] || null;
}

export function setUserData(userId, blob) {
  load();
  cache.blobs[userId] = blob;
  markDirty("blobs");
}

export function deleteUserData(userId) {
  load();
  if (cache.blobs[userId] !== undefined) {
    delete cache.blobs[userId];
    markDirty("blobs");
  }
}

// --- Expenses (per-user CRUD) ---------------------------------------------

export function listExpenses(userId) {
  load();
  return cache.expenses
    .filter((e) => e.userId === userId)
    .map((e) => ({ ...e }));
}

export function addExpense(userId, expense) {
  load();
  const row = { ...expense, userId };
  cache.expenses.push(row);
  markDirty("expenses");
  return row;
}

export function updateExpense(userId, id, patch) {
  load();
  const idx = cache.expenses.findIndex((e) => e.userId === userId && e.id === id);
  if (idx === -1) return null;
  Object.assign(cache.expenses[idx], patch, { userId, id, updatedAt: new Date().toISOString() });
  markDirty("expenses");
  return { ...cache.expenses[idx] };
}

export function deleteExpense(userId, id) {
  load();
  const before = cache.expenses.length;
  cache.expenses = cache.expenses.filter((e) => !(e.userId === userId && e.id === id));
  if (cache.expenses.length !== before) {
    markDirty("expenses");
    return true;
  }
  return false;
}

// --- Categories (per-user CRUD) -------------------------------------------

export function listCategories(userId) {
  load();
  return cache.categories
    .filter((c) => c.userId === userId)
    .map((c) => ({ ...c }));
}

export function addCategory(userId, category) {
  load();
  const row = { ...category, userId };
  cache.categories.push(row);
  markDirty("categories");
  return row;
}

export function updateCategory(userId, id, patch) {
  load();
  const idx = cache.categories.findIndex((c) => c.userId === userId && c.id === id);
  if (idx === -1) return null;
  Object.assign(cache.categories[idx], patch, { userId, id });
  markDirty("categories");
  return { ...cache.categories[idx] };
}

export function deleteCategory(userId, id) {
  load();
  const before = cache.categories.length;
  cache.categories = cache.categories.filter((c) => !(c.userId === userId && c.id === id));
  if (cache.categories.length !== before) {
    markDirty("categories");
    return true;
  }
  return false;
}

// --- Budgets (per-user, reassembled into the nested client shape) --------

export function getBudgets(userId) {
  load();
  const monthly = {};
  for (const b of cache.budgets) {
    if (b.userId !== userId) continue;
    if (!monthly[b.monthKey]) monthly[b.monthKey] = {};
    monthly[b.monthKey][b.categoryId] = b.amount;
  }
  return { monthly };
}

export function setBudgets(userId, monthlyBlob) {
  load();
  // Replace all of this user's rows. Other users' rows are untouched.
  cache.budgets = cache.budgets.filter((b) => b.userId !== userId);
  const monthly = (monthlyBlob && monthlyBlob.monthly) || {};
  for (const [monthKey, perCat] of Object.entries(monthly)) {
    if (!perCat || typeof perCat !== "object") continue;
    for (const [categoryId, amount] of Object.entries(perCat)) {
      cache.budgets.push({ userId, monthKey, categoryId, amount: Number(amount) || 0 });
    }
  }
  markDirty("budgets");
}

// --- Splits (per-user CRUD) -----------------------------------------------
// Splits are stored as JSON blobs so we don't have to flatten the
// participants array into separate columns. Each row carries the full
// split record (title, total, participants, friend code, etc.) plus
// the userId + id for indexing.

export function listSplits(userId) {
  load();
  return cache.splits
    .filter((s) => s.userId === userId)
    .map((s) => ({ ...s }));
}

export function addSplit(userId, split) {
  load();
  const row = { ...split, userId };
  cache.splits.push(row);
  markDirty("splits");
  return row;
}

export function updateSplit(userId, id, patch) {
  load();
  const idx = cache.splits.findIndex((s) => s.userId === userId && s.id === id);
  if (idx === -1) return null;
  Object.assign(cache.splits[idx], patch, { userId, id });
  markDirty("splits");
  return { ...cache.splits[idx] };
}

export function deleteSplit(userId, id) {
  load();
  const before = cache.splits.length;
  cache.splits = cache.splits.filter((s) => !(s.userId === userId && s.id === id));
  if (cache.splits.length !== before) {
    markDirty("splits");
    return true;
  }
  return false;
}

// --- Settings (stored in blobs.csv alongside the rest of the blob) ------

export function getSettings(userId) {
  load();
  const blob = cache.blobs[userId];
  if (!blob || !blob.settings) return null;
  return { ...blob.settings };
}

export function setSettings(userId, patch) {
  load();
  if (!cache.blobs[userId]) cache.blobs[userId] = { version: 5, settings: {}, categories: [], budgets: { monthly: {} }, expenses: [] };
  cache.blobs[userId].settings = { ...(cache.blobs[userId].settings || {}), ...patch };
  markDirty("blobs");
  return { ...cache.blobs[userId].settings };
}

// --- Assembled blob (for GET /api/data backward compat) ------------------

export function getAssembledBlob(userId) {
  load();
  const user = cache.users[userId];
  const blob = cache.blobs[userId] || { version: 5, settings: {}, categories: [], budgets: { monthly: {} }, expenses: [] };
  // Merge per-table data into the blob so GET /api/data returns the
  // freshest state even if the client never pushed a full blob.
  return {
    ...blob,
    version: 5,
    settings: blob.settings || {},
    profile: user ? {
      userId: user.userId,
      name: user.displayName || "",
      email: user.email || "",
      phone: user.phone || "",
      avatarDataUrl: user.avatarDataUrl || "",
    } : (blob.profile || {}),
    categories: listCategories(userId),
    budgets: getBudgets(userId),
    expenses: listExpenses(userId),
    splits: listSplits(userId),
  };
}

// --- Inspection helpers (used by tests + ops tooling) ---------------------

/** Returns the directory where CSV files are stored. */
export function getDbDir() {
  return DB_DIR;
}

/**
 * Reads every row from a CSV table on disk (bypassing the cache). Used
 * by ops / test scripts that want to inspect the raw file shape.
 *
 * @param {"users"|"expenses"|"categories"|"budgets"|"blobs"} name
 * @returns {Array<Record<string, string>>}
 */
export function readRawTable(name) {
  return readTable(name);
}