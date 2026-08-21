// Keystore — wraps the user's master key (MK) with a password so it
// can be stored on the server. Each user account has zero or more
// wraps; the password is the most common wrap type, but a device
// (via key exchange) or a recovery phrase can also wrap the MK.
//
// Wire format (per wrap):
//
//   {
//     v: 1,                       // envelope version
//     wrapType: "password",       // "password" | "device" | "phrase"
//     alg: "aes-gcm-256",         // AEAD algorithm
//     kdf: "pbkdf2-sha256",       // KDF used to derive the wrap key
//     salt: "<b64>",              // KDF salt
//     nonce: "<b64>",             // AEAD nonce
//     ct: "<b64>",                // ciphertext (MK is the plaintext)
//     params: { iters },          // KDF tuning
//     createdAt: "<iso>"          // when the wrap was created
//   }
//
// The server stores these envelopes in the `crypto_wraps` table
// (one row per envelope) and never sees the MK or the wrap key.

import {
  aeadEncrypt,
  aeadDecrypt,
  deriveKeyFromPassword,
  newSalt,
  authTag,
} from "./sodium.mjs";

const PHRASE_KDF = { name: "pbkdf2-sha256", iters: 200_000 };

/**
 * Wrap a 32-byte master key with a user-supplied password.
 * Returns a JSON envelope safe to send to the server.
 */
export async function wrapWithPassword(masterKey, password) {
  if (!(masterKey instanceof Uint8Array) || masterKey.length !== 32) {
    throw new Error("masterKey must be a 32-byte Uint8Array");
  }
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  const salt = await newSalt();
  const wrapKey = await deriveKeyFromPassword(password, salt);
  const { nonce, ct } = await aeadEncrypt(wrapKey, masterKey);
  wrapKey.fill(0);
  return {
    v: 1,
    wrapType: "password",
    alg: "aes-gcm-256",
    kdf: "pbkdf2-sha256",
    salt: b64(salt),
    nonce,
    ct,
    params: { iters: 600_000 },
    createdAt: new Date().toISOString(),
  };
}

/**
 * Unwrap a master key using the user's password. Throws if the
 * password is wrong (AEAD authentication fails). Returns the raw
 * 32-byte MK.
 */
export async function unwrapWithPassword(envelope, password) {
  if (!envelope || envelope.wrapType !== "password") {
    throw new Error("Not a password wrap");
  }
  const salt = unb64(envelope.salt);
  const wrapKey = await deriveKeyFromPassword(password, salt);
  try {
    return await aeadDecrypt(wrapKey, envelope.nonce, envelope.ct);
  } finally {
    wrapKey.fill(0);
  }
}

/**
 * Wrap a master key with a recovery phrase. The phrase is normalised
 * to a 32-byte seed via HMAC-SHA256 (deterministic from phrase text),
 * then PBKDF2 stretches that seed to a wrap key.
 */
export async function wrapWithPhrase(masterKey, phraseWords) {
  if (!(masterKey instanceof Uint8Array) || masterKey.length !== 32) {
    throw new Error("masterKey must be a 32-byte Uint8Array");
  }
  const phrase = Array.isArray(phraseWords) ? phraseWords.join(" ") : String(phraseWords);
  const salt = await newSalt();
  const wrapKey = await deriveKeyFromPhrase(phrase, salt, PHRASE_KDF.iters);
  const { nonce, ct } = await aeadEncrypt(wrapKey, masterKey);
  wrapKey.fill(0);
  return {
    v: 1,
    wrapType: "phrase",
    alg: "aes-gcm-256",
    kdf: "pbkdf2-sha256",
    salt: b64(salt),
    nonce,
    ct,
    params: { iters: PHRASE_KDF.iters },
    createdAt: new Date().toISOString(),
  };
}

export async function unwrapWithPhrase(envelope, phraseWords) {
  if (!envelope || envelope.wrapType !== "phrase") {
    throw new Error("Not a phrase wrap");
  }
  const phrase = Array.isArray(phraseWords) ? phraseWords.join(" ") : String(phraseWords);
  const salt = unb64(envelope.salt);
  const wrapKey = await deriveKeyFromPhrase(phrase, salt, envelope.params?.iters || PHRASE_KDF.iters);
  try {
    return await aeadDecrypt(wrapKey, envelope.nonce, envelope.ct);
  } finally {
    wrapKey.fill(0);
  }
}

// ---- internals ----------------------------------------------------------

async function deriveKeyFromPhrase(phrase, salt, iters) {
  const enc = new TextEncoder();
  // Deterministic seed from the phrase text. HMAC a fixed domain
  // tag with the phrase as the message — the tag prefix prevents
  // cross-protocol key reuse if we ever add another HMAC-based KDF.
  const seed = await authTag(
    enc.encode("xpensic:phrase:v1"),
    enc.encode(phrase.normalize("NFKD"))
  );
  return pbkdf2HmacSha256(seed, salt, iters, 32);
}

async function pbkdf2HmacSha256(password, salt, iters, dkLen) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto API not available; PBKDF2 cannot run.");
  const key = await subtle.importKey(
    "raw",
    password,
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: iters },
    key,
    dkLen * 8
  );
  return new Uint8Array(bits);
}

function b64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const std = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}