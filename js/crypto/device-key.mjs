// Per-device key store backed by IndexedDB.
//
// Every time the user successfully unlocks the vault (or sets up a
// brand-new vault) we generate a random 32-byte device key, store it
// in IndexedDB on this browser, and use it to wrap the master key.
// The wrap is uploaded to the server as a "device"-type wrap.
//
// On the next page reload, the boot flow asks the server for any
// device wraps. If one exists for the current device, we read the
// matching key from IndexedDB, unwrap the MK, and skip the unlock
// screen entirely — the user's session continues seamlessly.
//
// Notes
// -----
// • The device key is bound to this browser profile (IndexedDB is
//   per-origin, per-user-agent). A different browser / private
//   window won't see it, so the user has to unlock with the
//   password or recovery phrase there. That's the whole point:
//   device-wrap is purely a UX shortcut, not a security boundary.
// • Signing out wipes the device key. The wrap stays on the server
//   but becomes unreadable, so the next reload re-prompts for
//   the password. Users can also revoke a device from the Profile
//   view (forces that device to re-authenticate).
// • If IndexedDB is unavailable (rare — disabled / private mode in
//   some browsers), the helpers degrade silently. The user will
//   then see the unlock screen on every reload, but everything
//   else continues to work.

// Bumped from 1 → 2 to fix a bug where the DB was created at v1
// without the device_keys store (older code version). Incrementing
// the version forces onupgradeneeded to fire on next open, which
// creates the missing store. Future schema changes should bump
// this again.
const DB_NAME = "xpensic";
const DB_VERSION = 2;
const STORE = "device_keys";

// Periodic re-authentication interval. After a successful password
// unlock, the device can auto-unlock silently for this long. Once it
// elapses, the boot flow re-prompts for the vault password to verify
// the user is still the legitimate account holder (defends against a
// long-lived stolen device). 7 days balances UX and security.
export const REAUTH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Returns true if the periodic re-auth window has expired for this
 * user on this device — i.e. the boot flow should NOT auto-unlock
 * and should instead re-prompt for the vault password.
 *
 * Returns false (re-auth NOT needed) when:
 *   • no device key exists yet (first-time setup path handles it)
 *   • lastUnlockAt is within REAUTH_INTERVAL_MS
 *
 * Returns true (re-auth needed) when:
 *   • lastUnlockAt is 0 / missing (pre-feature rows, or never set)
 *   • more than REAUTH_INTERVAL_MS has elapsed since lastUnlockAt
 */
export async function needsReauth(userId) {
  if (!userId) return true;
  const last = await getLastUnlockAt(userId);
  if (!last) return true;
  return (Date.now() - last) > REAUTH_INTERVAL_MS;
}

let dbPromise = null;

function openDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      try {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: "userId" });
        }
      } catch { /* ignore */ }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

async function withStore(mode, fn) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    let tx;
    try { tx = db.transaction(STORE, mode); }
    catch { resolve(null); return; }
    let store;
    try { store = tx.objectStore(STORE); }
    catch { resolve(null); return; }
    let result = null;
    try {
      const r = fn(store);
      r.onsuccess = () => { result = r.result; };
      r.onerror = () => { result = null; };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => resolve(result);
      tx.onerror = () => resolve(result);
    } catch {
      resolve(null);
    }
  });
}

/** Read the device key for a given userId (or null if not stored). */
export async function getDeviceKey(userId) {
  if (!userId) return null;
  const row = await withStore("readonly", (store) => store.get(userId));
  if (!row || !row.deviceKey) return null;
  try {
    // Stored as a plain ArrayBuffer; reconstruct the Uint8Array.
    return new Uint8Array(row.deviceKey);
  } catch { return null; }
}

/**
 * Read the timestamp (ms since epoch) of the last successful
 * password-based unlock for this user on this device. Used by the
 * periodic re-auth check: if more than REAUTH_INTERVAL_MS has
 * elapsed, the boot flow skips auto-unlock and re-prompts for the
 * password. Returns 0 if never set (treated as "re-auth needed").
 */
export async function getLastUnlockAt(userId) {
  if (!userId) return 0;
  const row = await withStore("readonly", (store) => store.get(userId));
  if (!row) return 0;
  return typeof row.lastUnlockAt === "number" ? row.lastUnlockAt : 0;
}

/**
 * Persist a device key for the given userId. The key is stored as
 * a raw 32-byte buffer (not base64) for compactness. Also stamps
 * `lastUnlockAt` to now so the periodic re-auth timer starts
 * counting from this unlock.
 */
export async function setDeviceKey(userId, key) {
  if (!userId) return false;
  if (!(key instanceof Uint8Array) || key.length !== 32) return false;
  const now = Date.now();
  return withStore("readwrite", (store) =>
    store.put({
      userId,
      deviceKey: key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength),
      lastUnlockAt: now,
    }),
  ).then((res) => res !== null);
}

/**
 * Update only the `lastUnlockAt` timestamp for an existing device
 * key row, without touching the key itself. Called after every
 * successful password-based unlock so the 7-day re-auth window
 * resets. If no row exists yet (device key not set up), this is
 * a no-op — setDeviceKey will stamp it when the key is created.
 */
export async function touchLastUnlockAt(userId) {
  if (!userId) return false;
  const row = await withStore("readonly", (store) => store.get(userId));
  if (!row || !row.deviceKey) return false;
  return withStore("readwrite", (store) =>
    store.put({ ...row, lastUnlockAt: Date.now() }),
  ).then((res) => res !== null);
}

/** Forget the device key for a userId (e.g. on sign-out). */
export async function clearDeviceKey(userId) {
  if (!userId) return false;
  return withStore("readwrite", (store) => store.delete(userId))
    .then((res) => res !== null || true);
}

/** Generate a fresh 32-byte device key. */
export function newDeviceKey() {
  const c = globalThis.crypto;
  const out = new Uint8Array(32);
  c.getRandomValues(out);
  return out;
}

/** True when IndexedDB-backed persistence is usable. */
export async function isAvailable() {
  const db = await openDb();
  return !!db;
}
