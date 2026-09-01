// D1-backed storage for XPENSIC. Replaces the CSV file layer (db.js)
// when running on Cloudflare Workers. Every function is async and uses
// the D1 binding passed in via `initDb(env.DB)`.
//
// The public function names mirror the old db.js API so the route
// modules only need to `await` the calls — no other changes to their
// logic. Row <-> object adapters are shared with the CSV layer where
// possible.

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
    createdAt:    r.createdAt || "",
  };
}

function userToRow(u) {
  return {
    userId:        u.userId || "",
    email:         u.email || "",
    phone:         u.phone || "",
    passwordHash:  u.passwordHash || "",
    createdAt:     u.createdAt || "",
  };
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
      `INSERT INTO users (userId, email, phone, passwordHash, createdAt)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(row.userId, row.email, row.phone, row.passwordHash, row.createdAt)
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
      `UPDATE users SET email=?, phone=?, passwordHash=?, createdAt=?
       WHERE userId=?`
    )
    .bind(row.email, row.phone, row.passwordHash, row.createdAt, userId)
    .run();
  return merged;
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
