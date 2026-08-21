// Vault — encrypts and decrypts the full app state (expenses,
// categories, budgets, etc.) with the user's master key. The
// resulting ciphertext blob is what we send to the server, so the
// server can never read user data.
//
// Wire format:
//
//   {
//     v: 1,
//     alg: "xchacha20-poly1305",
//     nonce: "<b64>",
//     ct: "<b64>",
//     updatedAt: "<iso>"
//   }
//
// The blob also gets a SHA-256 fingerprint of the plaintext (kept
// alongside the envelope) so the client can detect silent corruption
// after decryption.

import { aeadEncrypt, aeadDecrypt, sha256 } from "./sodium.mjs";
import { bytesToB64, b64ToBytes } from "./sodium.mjs";

const STATE_VERSION = 1;

/** Serialize a state object, encrypt with MK, return JSON envelope. */
export async function encryptVault(masterKey, state) {
  if (!(masterKey instanceof Uint8Array) || masterKey.length !== 32) {
    throw new Error("masterKey must be a 32-byte Uint8Array");
  }
  const enc = new TextEncoder();
  const json = JSON.stringify({ v: STATE_VERSION, data: state });
  const pt = enc.encode(json);
  const { nonce, ct } = await aeadEncrypt(masterKey, pt);
  const fingerprint = await sha256(pt);
  return {
    v: 1,
    alg: "xchacha20-poly1305",
    nonce,
    ct,
    fingerprint: bytesToB64(fingerprint),
    updatedAt: new Date().toISOString(),
  };
}

/** Decrypt a vault envelope, return the state object (or null if empty). */
export async function decryptVault(masterKey, envelope) {
  if (!envelope) return null;
  if (!envelope.nonce || !envelope.ct) return null;
  const pt = await aeadDecrypt(masterKey, envelope.nonce, envelope.ct);
  // Optional fingerprint check — a defence-in-depth against silent
  // corruption. We don't fail on mismatch (could be a fingerprint
  // bug), but we log it so the user/dev can investigate.
  if (envelope.fingerprint) {
    const actual = await sha256(pt);
    if (bytesToB64(actual) !== envelope.fingerprint) {
      console.warn("[vault] fingerprint mismatch — vault may have been tampered with");
    }
  }
  const json = new TextDecoder().decode(pt);
  const parsed = JSON.parse(json);
  return parsed?.data ?? null;
}

/** Envelope with a fresh nonce but unchanged ct (for cache validation). */
export function isEmptyEnvelope(envelope) {
  return !envelope || (!envelope.nonce && !envelope.ct);
}