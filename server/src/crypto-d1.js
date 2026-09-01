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
    .prepare("SELECT envelope, revision FROM vault_blobs WHERE userId = ? LIMIT 1")
    .bind(userId)
    .all();
  if (!results[0]) return null;
  return {
    envelope: safeParse(results[0].envelope),
    revision: Number(results[0].revision) || 0,
  };
}

export async function setVault(userId, envelope, expectedRevision = 0) {
  const d = requireDb();
  const expected = Number.isInteger(expectedRevision) && expectedRevision >= 0
    ? expectedRevision
    : 0;
  const current = await d
    .prepare("SELECT revision FROM vault_blobs WHERE userId = ? LIMIT 1")
    .bind(userId)
    .all();
  const row = current.results[0];
  const now = new Date().toISOString();

  if (!row) {
    if (expected !== 0) return { ok: false, conflict: true, revision: 0 };
    await d
      .prepare("INSERT INTO vault_blobs (userId, envelope, revision, updatedAt) VALUES (?, ?, ?, ?)")
      .bind(userId, JSON.stringify(envelope), 1, now)
      .run();
    return { ok: true, revision: 1 };
  }

  const currentRevision = Number(row.revision) || 0;
  if (expected !== currentRevision) {
    return { ok: false, conflict: true, revision: currentRevision };
  }
  const updated = await d
    .prepare(
      "UPDATE vault_blobs SET envelope = ?, revision = revision + 1, updatedAt = ? WHERE userId = ? AND revision = ?"
    )
    .bind(JSON.stringify(envelope), now, userId, currentRevision)
    .run();
  if ((updated.meta && updated.meta.changes) !== 1) {
    return { ok: false, conflict: true, revision: currentRevision };
  }
  return { ok: true, revision: currentRevision + 1 };
}

export async function deleteVault(userId) {
  await requireDb()
    .prepare("DELETE FROM vault_blobs WHERE userId = ?")
    .bind(userId)
    .run();
}