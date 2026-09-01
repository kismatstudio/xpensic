const DB_NAME = "xpensic_vault_cache";
const DB_VERSION = 1;
const STORE = "vaults";
const LOCAL_PREFIX = "xpensic:encrypted-vault:";

let dbPromise = null;

function openDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      try {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: "userId" });
        }
      } catch {
        resolve(null);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

async function withStore(mode, operation) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    let transaction;
    try {
      transaction = db.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      let result = null;
      request.onsuccess = () => { result = request.result ?? null; };
      request.onerror = () => { result = null; };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => resolve(result);
      transaction.onabort = () => resolve(result);
    } catch {
      resolve(null);
    }
  });
}

function localKey(userId) {
  return LOCAL_PREFIX + encodeURIComponent(String(userId));
}

function readLocal(userId) {
  try {
    const raw = localStorage.getItem(localKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocal(userId, record) {
  try {
    localStorage.setItem(localKey(userId), JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export async function getEncryptedVault(userId) {
  if (!userId) return null;
  const row = await withStore("readonly", (store) => store.get(String(userId)));
  if (row?.envelope) return { ...row.envelope, revision: Number(row.revision) || 0 };
  const local = readLocal(userId);
  if (local?.envelope) return { ...local.envelope, revision: Number(local.revision) || 0 };
  return local;
}

export async function saveEncryptedVault(userId, envelope, revision = 0) {
  if (!userId || !envelope?.nonce || !envelope?.ct) return false;
  const row = { userId: String(userId), envelope, revision: Number(revision) || 0 };
  const stored = await withStore("readwrite", (store) => store.put(row));
  if (stored !== null) return true;
  return writeLocal(userId, { envelope, revision: row.revision });
}

export async function clearEncryptedVault(userId) {
  if (!userId) return false;
  const result = await withStore("readwrite", (store) => store.delete(String(userId)));
  let localCleared = true;
  try {
    localStorage.removeItem(localKey(userId));
  } catch {
    localCleared = false;
  }
  return result !== null || localCleared;
}