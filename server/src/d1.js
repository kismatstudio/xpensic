// D1-backed storage for XPENSIC. Replaces the CSV file layer (db.js)
// when running on Cloudflare Workers. Every function is async and uses
// the D1 binding passed in via `initDb(env.DB)`.
//
// The public function names mirror the old db.js API so the route
// modules only need to `await` the calls — no other changes to their
// logic. Row <-> object adapters are shared with the CSV layer where
// possible.

import { parseCsv, writeCsv } from "./csv.js";

let db = null;

/** Bind the D1 database. Call once at boot with `env.DB`. */
export function initDb(binding) {
  db = binding;
  return db;
}

function requireDb() {
  if (!db) throw new Error("D1 not initialised — call initDb(env.DB) first.");
  return db;
}

// --- Row <-> object adapters (same shapes as the CSV layer) --------------

function rowToUser(r) {
  return {
    userId:       r.userId,
    email:        r.email || "",
    phone:        r.phone || "",
    passwordHash: r.passwordHash || "",
    displayName:  r.displayName || "",
    avatarDataUrl: r.avatarDataUrl || "",
    loginDays:    safeJsonArray(r.loginDays),
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
    loginDays:     JSON.stringify(u.loginDays || []),
    createdAt:     u.createdAt || "",
  };
}

function rowToExpense(r) {
  if (!r.id || !r.userId) return null;
  return {
    id:            r.id,
    userId:        r.userId,
    amount:        r.amount === null || r.amount === "" ? 0 : Number(r.amount),
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

function rowToCategory(r) {
  if (!r.id || !r.userId) return null;
  return {
    id:        r.id,
    userId:    r.userId,
    name:      r.name || "",
    color:     r.color || "",
    icon:      r.icon || "",
    isDefault: r.isDefault === 1 || r.isDefault === true || r.isDefault === "1" || r.isDefault === "true",
    sortOrder: r.sortOrder === null || r.sortOrder === "" ? 0 : Number(r.sortOrder),
  };
}

function rowToBudget(r) {
  if (!r.userId || !r.monthKey || !r.categoryId) return null;
  return {
    userId:     r.userId,
    monthKey:   r.monthKey,
    categoryId: r.categoryId,
    amount:     r.amount === null || r.amount === "" ? 0 : Number(r.amount),
  };
}

function rowToSplit(r) {
  if (!r.userId || !r.id) return null;
  let parsed;
  try {
    parsed = JSON.parse(r.splitJson || "{}");
  } catch {
    return null;
  }
  return {
    ...parsed,
    userId:    r.userId,
    id:        r.id,
    createdAt: r.createdAt || parsed.createdAt || "",
  };
}

function safeJsonArray(s) {
  if (Array.isArray(s)) return s;
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// --- Users ----------------------------------------------------------------

export async function findUserByEmail(email) {
  const key = String(email || "").toLowerCase();
  const { results } = await requireDb()
    .prepare("SELECT * FROM users WHERE lower(email) = ? LIMIT 1")
    .bind(key)
    .all();
  return results[0] ? rowToUser(results[0]) : null;
}

export async function findUserById(userId) {
  const { results } = await requireDb()
    .prepare("SELECT * FROM users WHERE userId = ? LIMIT 1")
    .bind(userId)
    .all();
  return results[0] ? rowToUser(results[0]) : null;
}

export async function createUser(user) {
  const row = userToRow(user);
  await requireDb()
    .prepare(
      `INSERT INTO users (userId, email, phone, passwordHash, displayName, avatarDataUrl, loginDays, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(row.userId, row.email, row.phone, row.passwordHash, row.displayName, row.avatarDataUrl, row.loginDays, row.createdAt)
    .run();
  return user;
}

export async function updateUser(userId, patch) {
  const cur = await findUserById(userId);
  if (!cur) return null;
  const merged = { ...cur, ...patch };
  const row = userToRow(merged);
  await requireDb()
    .prepare(
      `UPDATE users SET email=?, phone=?, passwordHash=?, displayName=?, avatarDataUrl=?, loginDays=?, createdAt=?
       WHERE userId=?`
    )
    .bind(row.email, row.phone, row.passwordHash, row.displayName, row.avatarDataUrl, row.loginDays, row.createdAt, userId)
    .run();
  return merged;
}

// --- Per-user data (blobs) -------------------------------------------------

export async function getUserData(userId) {
  const { results } = await requireDb()
    .prepare("SELECT blobJson FROM blobs WHERE userId = ? LIMIT 1")
    .bind(userId)
    .all();
  if (!results[0]) return null;
  try { return JSON.parse(results[0].blobJson || "null"); } catch { return null; }
}

export async function setUserData(userId, blob) {
  await requireDb()
    .prepare(
      `INSERT INTO blobs (userId, blobJson) VALUES (?, ?)
       ON CONFLICT(userId) DO UPDATE SET blobJson = excluded.blobJson`
    )
    .bind(userId, JSON.stringify(blob ?? null))
    .run();
}

export async function deleteUserData(userId) {
  await requireDb().prepare("DELETE FROM blobs WHERE userId = ?").bind(userId).run();
}

// --- Expenses --------------------------------------------------------------

export async function listExpenses(userId) {
  const { results } = await requireDb()
    .prepare("SELECT * FROM expenses WHERE userId = ?")
    .bind(userId)
    .all();
  return results.map(rowToExpense).filter(Boolean);
}

export async function addExpense(userId, expense) {
  const row = { ...expense, userId };
  await requireDb()
    .prepare(
      `INSERT INTO expenses (id, userId, amount, date, categoryId, note, time, paymentMethod, upiApp, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(row.id, row.userId, row.amount, row.date, row.categoryId, row.note, row.time, row.paymentMethod, row.upiApp, row.createdAt, row.updatedAt)
    .run();
  return row;
}

export async function updateExpense(userId, id, patch) {
  const { results } = await requireDb()
    .prepare("SELECT * FROM expenses WHERE userId = ? AND id = ? LIMIT 1")
    .bind(userId, id)
    .all();
  if (!results[0]) return null;
  const cur = rowToExpense(results[0]);
  const merged = { ...cur, ...patch, userId, id, updatedAt: new Date().toISOString() };
  await requireDb()
    .prepare(
      `UPDATE expenses SET amount=?, date=?, categoryId=?, note=?, time=?, paymentMethod=?, upiApp=?, createdAt=?, updatedAt=?
       WHERE userId=? AND id=?`
    )
    .bind(merged.amount, merged.date, merged.categoryId, merged.note, merged.time, merged.paymentMethod, merged.upiApp, merged.createdAt, merged.updatedAt, userId, id)
    .run();
  return { ...merged };
}

export async function deleteExpense(userId, id) {
  const res = await requireDb()
    .prepare("DELETE FROM expenses WHERE userId = ? AND id = ?")
    .bind(userId, id)
    .run();
  return (res.meta && res.meta.changes) > 0;
}

// --- Categories ------------------------------------------------------------

export async function listCategories(userId) {
  const { results } = await requireDb()
    .prepare("SELECT * FROM categories WHERE userId = ?")
    .bind(userId)
    .all();
  return results.map(rowToCategory).filter(Boolean);
}

export async function addCategory(userId, category) {
  const row = { ...category, userId };
  await requireDb()
    .prepare(
      `INSERT INTO categories (id, userId, name, color, icon, isDefault, sortOrder)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(row.id, row.userId, row.name, row.color, row.icon, row.isDefault ? 1 : 0, row.sortOrder)
    .run();
  return row;
}

export async function updateCategory(userId, id, patch) {
  const { results } = await requireDb()
    .prepare("SELECT * FROM categories WHERE userId = ? AND id = ? LIMIT 1")
    .bind(userId, id)
    .all();
  if (!results[0]) return null;
  const cur = rowToCategory(results[0]);
  const merged = { ...cur, ...patch, userId, id };
  await requireDb()
    .prepare(
      `UPDATE categories SET name=?, color=?, icon=?, isDefault=?, sortOrder=? WHERE userId=? AND id=?`
    )
    .bind(merged.name, merged.color, merged.icon, merged.isDefault ? 1 : 0, merged.sortOrder, userId, id)
    .run();
  return { ...merged };
}

export async function deleteCategory(userId, id) {
  const res = await requireDb()
    .prepare("DELETE FROM categories WHERE userId = ? AND id = ?")
    .bind(userId, id)
    .run();
  return (res.meta && res.meta.changes) > 0;
}

// --- Budgets ---------------------------------------------------------------

export async function getBudgets(userId) {
  const { results } = await requireDb()
    .prepare("SELECT * FROM budgets WHERE userId = ?")
    .bind(userId)
    .all();
  const monthly = {};
  for (const b of results) {
    if (!monthly[b.monthKey]) monthly[b.monthKey] = {};
    monthly[b.monthKey][b.categoryId] = b.amount === null ? 0 : Number(b.amount);
  }
  return { monthly };
}

export async function setBudgets(userId, monthlyBlob) {
  const d = requireDb();
  const monthly = (monthlyBlob && monthlyBlob.monthly) || {};
  const rows = [];
  for (const [monthKey, perCat] of Object.entries(monthly)) {
    if (!perCat || typeof perCat !== "object") continue;
    for (const [categoryId, amount] of Object.entries(perCat)) {
      rows.push([userId, monthKey, categoryId, Number(amount) || 0]);
    }
  }
  // Replace all of this user's rows in a transaction.
  await d.batch([
    d.prepare("DELETE FROM budgets WHERE userId = ?").bind(userId),
    ...rows.map((r) =>
      d.prepare("INSERT INTO budgets (userId, monthKey, categoryId, amount) VALUES (?, ?, ?, ?)").bind(...r)
    ),
  ]);
}

// --- Splits ----------------------------------------------------------------

export async function listSplits(userId) {
  const { results } = await requireDb()
    .prepare("SELECT * FROM splits WHERE userId = ?")
    .bind(userId)
    .all();
  return results.map(rowToSplit).filter(Boolean);
}

export async function addSplit(userId, split) {
  const { userId: _u, id, createdAt, ...rest } = split;
  const row = { userId, id, splitJson: JSON.stringify(rest || {}), createdAt: createdAt || "" };
  await requireDb()
    .prepare("INSERT INTO splits (userId, id, splitJson, createdAt) VALUES (?, ?, ?, ?)")
    .bind(row.userId, row.id, row.splitJson, row.createdAt)
    .run();
  return { ...split, userId, id, createdAt: row.createdAt };
}

export async function updateSplit(userId, id, patch) {
  const { results } = await requireDb()
    .prepare("SELECT * FROM splits WHERE userId = ? AND id = ? LIMIT 1")
    .bind(userId, id)
    .all();
  if (!results[0]) return null;
  const cur = rowToSplit(results[0]);
  const merged = { ...cur, ...patch, userId, id };
  const { userId: _u, id: _id, createdAt, ...rest } = merged;
  await requireDb()
    .prepare("UPDATE splits SET splitJson=?, createdAt=? WHERE userId=? AND id=?")
    .bind(JSON.stringify(rest || {}), createdAt || "", userId, id)
    .run();
  return { ...merged };
}

export async function deleteSplit(userId, id) {
  const res = await requireDb()
    .prepare("DELETE FROM splits WHERE userId = ? AND id = ?")
    .bind(userId, id)
    .run();
  return (res.meta && res.meta.changes) > 0;
}

// --- Settings (stored in blobs) --------------------------------------------

export async function getSettings(userId) {
  const blob = await getUserData(userId);
  if (!blob || !blob.settings) return null;
  return { ...blob.settings };
}

export async function setSettings(userId, patch) {
  let blob = await getUserData(userId);
  if (!blob) blob = { version: 5, settings: {}, categories: [], budgets: { monthly: {} }, expenses: [] };
  blob.settings = { ...(blob.settings || {}), ...patch };
  await setUserData(userId, blob);
  return { ...blob.settings };
}

// --- Assembled blob (GET /api/data) ----------------------------------------

export async function getAssembledBlob(userId) {
  const user = await findUserById(userId);
  const blob = (await getUserData(userId)) || { version: 5, settings: {}, categories: [], budgets: { monthly: {} }, expenses: [] };
  const [categories, budgets, expenses, splits] = await Promise.all([
    listCategories(userId),
    getBudgets(userId),
    listExpenses(userId),
    listSplits(userId),
  ]);
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
    categories,
    budgets,
    expenses,
    splits,
  };
}

// --- Refresh-token sessions -------------------------------------------------

export async function putRefreshToken(tokenHash, session) {
  await requireDb()
    .prepare(
      `INSERT INTO refresh_tokens (tokenHash, userId, email, expiresAt, parent, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(tokenHash, session.userId || "", session.email || "", String(session.expiresAt ?? ""), session.parent || "", String(session.createdAt ?? ""))
    .run();
}

export async function getRefreshToken(tokenHash) {
  const { results } = await requireDb()
    .prepare("SELECT * FROM refresh_tokens WHERE tokenHash = ? LIMIT 1")
    .bind(tokenHash)
    .all();
  if (!results[0]) return null;
  const s = {
    userId: results[0].userId,
    email: results[0].email || "",
    expiresAt: Number(results[0].expiresAt),
    parent: results[0].parent || null,
    createdAt: Number(results[0].createdAt),
  };
  if (Date.now() > s.expiresAt) {
    await deleteRefreshToken(tokenHash);
    return null;
  }
  return { ...s };
}

export async function deleteRefreshToken(tokenHash) {
  await requireDb().prepare("DELETE FROM refresh_tokens WHERE tokenHash = ?").bind(tokenHash).run();
}

// --- CSV helpers kept for parity (unused on Workers) -----------------------

export { parseCsv, writeCsv };