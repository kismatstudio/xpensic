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
import { listWraps, replaceAllWraps, getVault, setVault } from "../crypto-db.js";

export const cryptoRouter = Router();

// --- Master key wraps ------------------------------------------------------

// GET /api/crypto/master-key — list wraps for the signed-in user.
cryptoRouter.get("/master-key", (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, error: "Not authenticated." });
  const wraps = listWraps(req.user.userId);
  return res.json({ ok: true, wraps });
});

// PUT /api/crypto/master-key — replace all wraps atomically.
// Body: { wraps: [envelope, ...] } where each envelope is the opaque
// wrap envelope produced by the client (it includes its own
// wrapType, alg, kdf, salt, nonce, ct, params, createdAt fields).
cryptoRouter.put("/master-key", (req, res) => {
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
    if (typeof w.wrapType !== "string" || !VALID.has(w.wrapType)) {
      return res.status(400).json({ ok: false, error: "Invalid wrapType; expected password|device|phrase." });
    }
    if (!w.ct || !w.nonce || !w.salt) {
      return res.status(400).json({ ok: false, error: "Envelope must include ct, nonce, and salt." });
    }
  }
  replaceAllWraps(req.user.userId, wraps);
  return res.json({ ok: true, wraps: listWraps(req.user.userId) });
});

// --- Vault blob ------------------------------------------------------------

// GET /api/crypto/vault — fetch the encrypted vault blob.
cryptoRouter.get("/vault", (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, error: "Not authenticated." });
  const vault = getVault(req.user.userId);
  // Always return a vault field (null when empty) so the client can
  // distinguish "no vault yet" from "fetch failed".
  return res.json({ ok: true, vault: vault || null });
});

// PUT /api/crypto/vault — upload a new encrypted vault blob.
cryptoRouter.put("/vault", (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, error: "Not authenticated." });
  const envelope = req.body;
  if (!envelope || typeof envelope !== "object" || !envelope.ct || !envelope.nonce) {
    return res.status(400).json({ ok: false, error: "vault envelope must include ct + nonce." });
  }
  setVault(req.user.userId, envelope);
  return res.json({ ok: true });
});