// Small, defensive IndexedDB wrapper shared by the device-key store and the
// encrypted-vault cache.
//
// Why it exists: the raw `indexedDB.open()` / transaction callbacks can
//   • never fire (browser under storage pressure, a stuck upgrade, a tab
//     frozen in the background) — awaiting them froze the whole app on boot
//     or left the sync queue "in flight" forever;
//   • report "blocked" transiently while another tab still holds an old
//     connection — treating that as "no IndexedDB" made the boot flow think
//     the device key was gone and drop the user onto "Unlock your vault";
//   • lose their connection later (`versionchange`, browser closing the DB),
//     after which every call failed until a full reload.
//
// So: every open and every transaction is bounded by a timeout, a failed or
// timed-out open is NEVER cached (the next call tries again), "blocked" just
// keeps waiting, and a connection that closes under us is reopened once.
// Callers keep the same contract as before: a result, or `null` on failure.

const DEFAULT_TIMEOUT_MS = 4000;

/**
 * @param {object} cfg
 * @param {string} cfg.name           database name
 * @param {number} cfg.version        database version
 * @param {string} cfg.store          object store used by this wrapper
 * @param {(db: IDBDatabase) => void} cfg.upgrade  create stores / indexes
 * @param {number} [cfg.timeoutMs]
 */
export function createIdb({ name, version, store, upgrade, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  let dbPromise = null;

  function open() {
    if (typeof indexedDB === "undefined") return Promise.resolve(null);
    if (dbPromise) return dbPromise;

    const attempt = new Promise((resolve) => {
      let settled = false;
      const finish = (db) => {
        if (settled) {
          // Opened after we gave up — don't leak the connection.
          if (db) { try { db.close(); } catch { /* ignore */ } }
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(db);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);

      let req;
      try {
        req = indexedDB.open(name, version);
      } catch {
        finish(null);
        return;
      }
      req.onupgradeneeded = () => {
        try { upgrade(req.result); } catch { /* surfaced as a failed open below */ }
      };
      req.onsuccess = () => {
        const db = req.result;
        // Let other tabs upgrade the DB, and notice if the browser closes it.
        db.onversionchange = () => { try { db.close(); } catch { /* ignore */ } dbPromise = null; };
        db.onclose = () => { dbPromise = null; };
        finish(db);
      };
      req.onerror = () => finish(null);
      // `blocked` is transient (another tab still has an older connection
      // open). Keep waiting — the timeout bounds it.
      req.onblocked = () => {};
    });

    dbPromise = attempt;
    // A failed / timed-out open must not poison later calls.
    attempt.then((db) => { if (!db && dbPromise === attempt) dbPromise = null; });
    return attempt;
  }

  /**
   * Run one request inside a transaction.
   * @param {"readonly"|"readwrite"} mode
   * @param {(store: IDBObjectStore) => IDBRequest} operation
   * @returns {Promise<any|null>} the request result, or null on any failure
   */
  async function withStore(mode, operation, retried = false) {
    const db = await open();
    if (!db) return null;

    return new Promise((resolve) => {
      let settled = false;
      let result = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);

      let tx;
      try {
        tx = db.transaction(store, mode);
      } catch {
        // The connection was closed under us — reopen once.
        dbPromise = null;
        clearTimeout(timer);
        settled = true;
        if (retried) resolve(null);
        else resolve(withStore(mode, operation, true));
        return;
      }
      try {
        const request = operation(tx.objectStore(store));
        request.onsuccess = () => { result = request.result ?? null; };
        request.onerror = () => { result = null; };
        tx.oncomplete = () => finish(result);
        tx.onabort = () => finish(null);
        tx.onerror = () => finish(null);
      } catch {
        finish(null);
      }
    });
  }

  /** True when the database can be opened right now. */
  async function isOpenable() {
    return !!(await open());
  }

  return { open, withStore, isOpenable };
}

/** Rejects/resolves-to-fallback if `promise` doesn't settle in `ms`. */
export function withTimeout(promise, ms, label = "operation") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
