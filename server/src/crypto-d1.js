// Crypto subsystem storage for Cloudflare Workers (D1). The server is a
// dumb relay for E2EE ciphertext — it never sees master keys, recovery
// phrases, or plaintext vault data. All we do here is CRUD against two
// D1 tables: crypto_wraps and vault_blobs.

let db = null;

export function initCryptoDb(binding) {
  db = binding;
  return db;
}

function requireDb() {
  if (!db) throw new Error("D1 not initialised — call initCryptoDb(env.DB) first.");
  return db;
}

function safeParse(s) {
  if (!s) return null;
  if (typeof s === "object") return s;
  try { return JSON.parse(s); } catch { return null; }
}

export async function listWraps(userId) {
  const { results } = await requireDb()
    .prepare("SELECT * FROM crypto_wraps WHERE userId = ?")
    .bind(userId)
    .all();
  return results.map((w) => ({
    wrapId: w.wrapId,
    userId: w.userId,
    wrapType: w.wrapType,
    envelope: safeParse(w.envelope),
    createdAt: w.createdAt || "",
  }));
}

export async function replaceAllWraps(userId, wraps) {
  const d = requireDb();
  const rows = wraps.map((w) => {
    const envelope = (w && w.envelope && typeof w.envelope === "object") ? w.envelope : w;
    return {
      wrapId: `wrap_${Math.random().toString(36).slice(2, 10)}`,
      userId,
      wrapType: envelope.wrapType,
      envelope: JSON.stringify(envelope),
      createdAt: envelope.createdAt || new Date().toISOString(),
    };
  });
  await d.batch([
    d.prepare("DELETE FROM crypto_wraps WHERE userId = ?").bind(userId),
    ...rows.map((r) =>
      d.prepare("INSERT INTO crypto_wraps (wrapId, userId, wrapType, envelope, createdAt) VALUES (?, ?, ?, ?, ?)")
        .bind(r.wrapId, r.userId, r.wrapType, r.envelope, r.createdAt)
    ),
  ]);
}

export async function getVault(userId) {
  const { results } = await requireDb()
    .prepare("SELECT envelope FROM vault_blobs WHERE userId = ? LIMIT 1")
    .bind(userId)
    .all();
  if (!results[0]) return null;
  return safeParse(results[0].envelope);
}

export async function setVault(userId, envelope) {
  await requireDb()
    .prepare(
      `INSERT INTO vault_blobs (userId, envelope, updatedAt) VALUES (?, ?, ?)
       ON CONFLICT(userId) DO UPDATE SET envelope = excluded.envelope, updatedAt = excluded.updatedAt`
    )
    .bind(userId, JSON.stringify(envelope), new Date().toISOString())
    .run();
  return { userId, envelope, updatedAt: new Date().toISOString() };
}