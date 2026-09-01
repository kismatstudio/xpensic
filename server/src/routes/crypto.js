// E2EE crypto routes — wrap/unwrap master key + vault storage.
// The server treats every value as opaque ciphertext. It never
// sees the master key, the password, the recovery phrase, or the
// decrypted vault data.
//
// Endpoints:
//
//   GET  /api/crypto/master-key   → list of wrap envelopes for the user
//   PUT  /api/crypto/master-key   → replace all wraps atomically
//   GET  /api/crypto/vault        → fetch the encrypted vault blob
//   PUT  /api/crypto/vault        → upload a new encrypted vault blob

import { Router } from "express";
import { listWraps, replaceAllWraps, getVault, setVault, deleteVault } from "../crypto-d1.js";

export const cryptoRouter = Router();

const VAULT_VERSION = 1;
const VAULT_ALGORITHM = "aes-gcm-256";
const MAX_WRAP_BYTES = 32 * 1024;
const MAX_VAULT_BYTES = 16 * 1024 * 1024;

function isBoundedString(value, maxBytes) {
  return typeof value === "string" && value.length > 0 && new TextEncoder().encode(value).byteLength <= maxBytes;
}

function validateEnvelope(envelope, { wrapType = "", maxBytes }) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return "Envelope must be an object.";
  }
  if (envelope.v !== VAULT_VERSION) return "Unsupported envelope version.";
  if (envelope.alg !== VAULT_ALGORITHM) return "Unsupported envelope algorithm.";
  if (!isBoundedString(envelope.nonce, 256) || !isBoundedString(envelope.ct, maxBytes)) {
    return "Envelope must include bounded nonce and ciphertext strings.";
  }
  if (wrapType && envelope.wrapType !== wrapType) {
    return "Envelope wrapType does not match the row.";
  }
  return null;
}

// --- Master key wraps ------------------------------------------------------

// GET /api/crypto/master-key — list wraps for the signed-in user.
cryptoRouter.get("/master-key", async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, error: "Not authenticated." });
  const wraps = await listWraps(req.user.userId);
  return res.json({ ok: true, wraps });
});

// PUT /api/crypto/master-key — replace all wraps atomically.
// Body: { wraps: [envelope, ...] } where each envelope is the opaque
// wrap envelope produced by the client (it includes its own
// wrapType, alg, kdf, salt, nonce, ct, params, createdAt fields).
cryptoRouter.put("/master-key", async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, error: "Not authenticated." });
  const wraps = Array.isArray(req.body?.wraps) ? req.body.wraps : null;
  if (!wraps) return res.status(400).json({ ok: false, error: "wraps array is required." });
  // Sanity-check each wrap. We don't validate the envelope contents
  // (they're opaque to us) but we do check the wrapType against a
  // known set so a malicious client can't pollute the row with
  // arbitrary keys.
  const VALID = new Set(["password", "device", "phrase"]);
  for (const w of wraps) {
    if (!w || typeof w !== "object") {
      return res.status(400).json({ ok: false, error: "Each wrap must be an envelope object." });
    }
    const envelope = (w.envelope && typeof w.envelope === "object") ? w.envelope : w;
    if (typeof w.wrapType !== "string" || !VALID.has(w.wrapType)) {
      return res.status(400).json({ ok: false, error: "Invalid wrapType; expected password|device|phrase." });
    }
    const envelopeError = validateEnvelope(envelope, { wrapType: w.wrapType, maxBytes: MAX_WRAP_BYTES });
    if (envelopeError) return res.status(400).json({ ok: false, error: envelopeError });
    // Salt is required for password/phrase wraps (KDF derives the key
    // from it), but device wraps use a raw key with kdf: "none" and
    // legitimately have an empty salt. Don't reject them for that.
    if (!envelope.salt && w.wrapType !== "device") {
      return res.status(400).json({ ok: false, error: "Envelope must include a salt." });
    }
  }
  await replaceAllWraps(req.user.userId, wraps);
  return res.json({ ok: true, wraps: await listWraps(req.user.userId) });
});

// --- Vault blob ------------------------------------------------------------

// GET /api/crypto/vault — fetch the encrypted vault blob.
cryptoRouter.get("/vault", async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, error: "Not authenticated." });
  const record = await getVault(req.user.userId);
  // Always return a vault field (null when empty) so the client can
  // distinguish "no vault yet" from "fetch failed".
  return res.json({
    ok: true,
    vault: record?.envelope || null,
    revision: record?.revision || 0,
  });
});

// PUT /api/crypto/vault — upload a new encrypted vault blob.
cryptoRouter.put("/vault", async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, error: "Not authenticated." });
  const body = req.body || {};
  const legacyRawBody = !body.envelope;
  const envelope = legacyRawBody ? body : body.envelope;
  let expectedRevision = body.revision;
  if (legacyRawBody) {
    const current = await getVault(req.user.userId);
    expectedRevision = current?.revision || 0;
  }
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    return res.status(400).json({ ok: false, error: "revision must be a non-negative integer." });
  }
  const envelopeError = validateEnvelope(envelope, { maxBytes: MAX_VAULT_BYTES });
  if (envelopeError) return res.status(400).json({ ok: false, error: envelopeError });
  const result = await setVault(req.user.userId, envelope, expectedRevision);
  if (result.conflict) {
    return res.status(409).json({
      ok: false,
      error: "Vault changed on another device. Reload before saving again.",
      revision: result.revision,
    });
  }
  return res.json({ ok: true, revision: result.revision });
});

// DELETE /api/crypto/vault — erase the encrypted vault for the user.
cryptoRouter.delete("/vault", async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, error: "Not authenticated." });
  await deleteVault(req.user.userId);
  return res.json({ ok: true });
});