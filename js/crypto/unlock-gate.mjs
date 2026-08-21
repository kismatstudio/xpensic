// Unlock gate — the in-memory master key store + lock/unlock helpers.
//
// The MK never lives in localStorage (it would be readable by any
// script that gets injected). It also never crosses the network
// after unwrap. We hold it in a module-scoped variable that's only
// exposed to the rest of the app via narrow getter/setter functions.
//
// When the user signs out, switches accounts, or closes the tab,
// the MK is zeroed out and the gate goes back to "locked" — the next
// boot needs the password (or recovery phrase) to unwrap again.

let mk = null;            // Uint8Array(32) | null
let unlockedAt = 0;       // ms timestamp
let autoLockMs = 0;       // 0 = never auto-lock

export function getState() {
  return {
    isUnlocked: mk !== null,
    unlockedAt,
    autoLockMs,
  };
}

export function getMasterKey() {
  if (!mk) throw new Error("Vault is locked — call unlock() first");
  return mk;
}

export function setMasterKey(newKey) {
  if (newKey && (!(newKey instanceof Uint8Array) || newKey.length !== 32)) {
    throw new Error("setMasterKey requires a 32-byte Uint8Array");
  }
  // Zero out the old key before swapping, so a held reference can't
  // be revived by the GC.
  if (mk) mk.fill(0);
  mk = newKey || null;
  unlockedAt = newKey ? Date.now() : 0;
}

/** Wipe the MK from memory and mark the gate locked. */
export function lock() {
  setMasterKey(null);
}

/** Configure an inactivity-based auto-lock. Pass 0 to disable. */
export function configureAutoLock(ms) {
  autoLockMs = ms;
  if (mk && autoLockMs > 0) {
    // If a lock is already pending (e.g. settings change), cancel
    // it and reschedule.
    clearTimeout(autoLockTimer);
    autoLockTimer = setTimeout(lockIfStale, autoLockMs);
  }
}

let autoLockTimer = null;
function lockIfStale() {
  if (!mk) return;
  if (autoLockMs > 0 && Date.now() - unlockedAt > autoLockMs) {
    lock();
  }
}

/** Replace the MK in place. Used during master-key rotation. */
export function replaceMasterKey(newKey) {
  setMasterKey(newKey);
  if (autoLockTimer) clearTimeout(autoLockTimer);
  if (mk && autoLockMs > 0) autoLockTimer = setTimeout(lockIfStale, autoLockMs);
}