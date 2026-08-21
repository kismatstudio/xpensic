// Crypto subsystem storage. The server is a dumb relay for E2EE
// ciphertext — it never sees master keys, recovery phrases, or
// plaintext vault data. All we do here is CRUD against two CSV
// tables: crypto_wraps (per-user list of wrap envelopes) and
// vault_blobs (per-user encrypted vault blob).
//
// Wire format: each wrap row carries the wrapType ("password" |
// "device" | "phrase") and the envelope itself (an opaque JSON
// object the client uses to wrap/unwrap the master key with that
// factor). The server treats the envelope as an unparseable blob.

import { markDirty, getCache, initDb } from "./db.js";

export function initCryptoDb() {
  // The tables are provisioned by the migration in db.js. This hook
  // exists so server.js can call it at boot in the right order.
  initDb();
  const c = getCache();
  if (!Array.isArray(c.crypto_wraps)) c.crypto_wraps = [];
  if (!c.vault_blobs || typeof c.vault_blobs !== "object") c.vault_blobs = {};
}

export function listWraps(userId) {
  const c = getCache();
  return (c.crypto_wraps || [])
    .filter((w) => w.userId === userId)
    .map((w) => ({ ...w, envelope: safeParse(w.envelope) }));
}

export function replaceAllWraps(userId, wraps) {
  const c = getCache();
  c.crypto_wraps = (c.crypto_wraps || []).filter((w) => w.userId !== userId);
  for (const w of wraps) {
    // The envelope object is itself the full wrap payload
    // (wrapType + alg + kdf + salt + nonce + ct + params + createdAt).
    // We persist it as a JSON string and add a row id + userId.
    const envelope = (w && w.envelope && typeof w.envelope === "object") ? w.envelope : w;
    c.crypto_wraps.push({
      wrapId: `wrap_${Math.random().toString(36).slice(2, 10)}`,
      userId,
      wrapType: envelope.wrapType,
      envelope: JSON.stringify(envelope),
      createdAt: envelope.createdAt || new Date().toISOString(),
    });
  }
  markDirty("crypto_wraps");
}

export function getVault(userId) {
  const c = getCache();
  const raw = c.vault_blobs?.[userId];
  if (!raw) return null;
  return safeParse(raw);
}

export function setVault(userId, envelope) {
  const c = getCache();
  if (!c.vault_blobs || typeof c.vault_blobs !== "object") c.vault_blobs = {};
  c.vault_blobs[userId] = JSON.stringify(envelope);
  markDirty("vault_blobs");
  return { userId, envelope, updatedAt: new Date().toISOString() };
}

function safeParse(s) {
  if (!s) return null;
  if (typeof s === "object") return s; // already parsed (in-memory)
  try { return JSON.parse(s); } catch { return null; }
}