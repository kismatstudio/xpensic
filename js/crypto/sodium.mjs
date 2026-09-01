// High-level crypto wrapper. Centralizes all the crypto primitives the
// rest of the app needs so the rest of the code never has to touch
// the underlying API directly.
//
// We use the browser's built-in Web Crypto API (`globalThis.crypto.subtle`)
// rather than libsodium-wrappers. Web Crypto is:
//   • always available in browsers and Node 18+ (test runner)
//   • audited, fast, and FIPS-compliant
//   • built into the platform — no import-map, no node_modules
//     dance, no WASM init
//
// Algorithm choices:
//   • AES-GCM-256 for symmetric authenticated encryption
//   • PBKDF2-HMAC-SHA256 for password-based key derivation
//   • P-256 ECDSA/ECDH when a key exchange is needed
//
// AES-GCM is available through the browser's native implementation. PBKDF2
// uses a high iteration count because Web Crypto does not provide a memory-
// hard password KDF.
//
// Every binary value that crosses a JSON boundary uses base64url
// (no padding) — stable across runtimes, matches the encoding used
// by most web auth schemes.

// --- Base64url (no padding) --------------------------------------------------

export function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64ToBytes(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const std = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64Std(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function b64StdToBytes(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// --- Random ----------------------------------------------------------------

function getCrypto() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error("Web Crypto API not available");
  return c;
}

/** Cryptographically secure random bytes (CSPRNG). */
export function randomBytes(n) {
  const c = getCrypto();
  const out = new Uint8Array(n);
  c.getRandomValues(out);
  return out;
}

/** A fresh 256-bit master key. */
export function newMasterKey() {
  return randomBytes(32);
}

// --- AEAD (AES-GCM-256) ------------------------------------------------------
// AES-GCM uses a 12-byte (96-bit) IV per the NIST recommendation. We
// store it base64url-encoded alongside the ciphertext in every
// envelope. The 32-byte key never crosses any boundary; it's only
// held in the in-memory unlock gate.

const subtle = () => getCrypto().subtle;

async function importAesKey(keyBytes, usages) {
  return subtle().importKey("raw", keyBytes, { name: "AES-GCM" }, false, usages);
}

export async function aeadEncrypt(key, plaintext) {
  if (!(key instanceof Uint8Array) || key.length !== 32) {
    throw new Error("AEAD key must be a 32-byte Uint8Array");
  }
  const nonce = randomBytes(12);
  const aesKey = await importAesKey(key, ["encrypt"]);
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv: nonce },
    aesKey,
    plaintext
  );
  return { nonce: bytesToB64(nonce), ct: bytesToB64(new Uint8Array(ct)) };
}

export async function aeadDecrypt(key, nonceB64, ctB64) {
  const nonce = b64ToBytes(nonceB64);
  const ct = b64ToBytes(ctB64);
  const aesKey = await importAesKey(key, ["decrypt"]);
  const pt = await subtle().decrypt(
    { name: "AES-GCM", iv: nonce },
    aesKey,
    ct
  );
  return new Uint8Array(pt);
}

// --- PBKDF2-HMAC-SHA256 (password → 32-byte key) ---------------------------
// 600,000 iterations matches the OWASP 2023 baseline for SHA-256
// PBKDF2. Higher = slower unlock, but more resistance to offline
// brute force on a stolen password-wraps table.

const PBKDF2_ITERS = 600_000;

export async function deriveKeyFromPassword(password, salt) {
  const enc = new TextEncoder();
  const baseKey = await subtle().importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await subtle().deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERS },
    baseKey,
    32 * 8
  );
  return new Uint8Array(bits);
}

export function newSalt() {
  return randomBytes(16);
}

// --- ECDSA P-256 (signing) --------------------------------------------------
// Used for device attestation. The private key never leaves the
// device; the public key is registered with the server on first
// unlock.

export async function generateSigningKeypair() {
  const kp = await subtle().generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const publicKey = new Uint8Array(await subtle().exportKey("raw", kp.publicKey));
  const privateKey = new Uint8Array(await subtle().exportKey("pkcs8", kp.privateKey));
  return { publicKey, privateKey };
}

export async function importSigningKeypair(publicKey, privateKey) {
  const pub = await subtle().importKey(
    "raw", publicKey, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]
  );
  const priv = await subtle().importKey(
    "pkcs8", privateKey, { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]
  );
  return { publicKey, privateKey, _pub: pub, _priv: priv };
}

export async function signMessage(privateKey, message) {
  // privateKey here is the raw pkcs8 bytes (from generateSigningKeypair).
  const priv = await subtle().importKey(
    "pkcs8", privateKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]
  );
  const sig = await subtle().sign({ name: "ECDSA", hash: "SHA-256" }, priv, message);
  return new Uint8Array(sig);
}

export async function verifySignature(publicKey, message, signature) {
  const pub = await subtle().importKey(
    "raw", publicKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]
  );
  return subtle().verify({ name: "ECDSA", hash: "SHA-256" }, pub, signature, message);
}

// --- ECDH P-256 (key exchange) ----------------------------------------------
// Used during device pairing to wrap the master key for the new device
// without the trusted device ever sending the plaintext MK over the
// wire.

export async function generateKxKeypair() {
  const kp = await subtle().generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const publicKey = new Uint8Array(await subtle().exportKey("raw", kp.publicKey));
  const privateKey = new Uint8Array(await subtle().exportKey("pkcs8", kp.privateKey));
  return { publicKey, privateKey };
}

export async function kxDeriveBits(privateKey, peerPublicKey, lengthBits = 256) {
  const priv = await subtle().importKey(
    "pkcs8", privateKey, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]
  );
  const pub = await subtle().importKey(
    "raw", peerPublicKey, { name: "ECDH", namedCurve: "P-256" }, false, []
  );
  const bits = await subtle().deriveBits({ name: "ECDH", public: pub }, priv, lengthBits);
  return new Uint8Array(bits);
}

// --- SHA-256 ----------------------------------------------------------------
// Stable, fixed-length fingerprints for envelopes and tokens.

export async function sha256(bytes) {
  const h = await subtle().digest("SHA-256", bytes);
  return new Uint8Array(h);
}

/**
 * HMAC-SHA256 — used both as a MAC for token storage and as the
 * building block of the recovery-phrase KDF (PBKDF2-HMAC-SHA256).
 */
export async function authTag(key, message) {
  const k = await subtle().importKey(
    "raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await subtle().sign("HMAC", k, message);
  return new Uint8Array(sig);
}

export async function verifyAuth(key, message, tag) {
  const k = await subtle().importKey(
    "raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
  );
  return subtle().verify("HMAC", k, tag, message);
}

// Shim kept for the API surface — older callers expect a getSodium()
// helper. We don't use libsodium here, so this returns a marker
// object that callers can ignore.
export async function getSodium() {
  return { ready: Promise.resolve(), _impl: "webcrypto" };
}