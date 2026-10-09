import { createIdb } from "./idb.mjs?v=31";

const DB_NAME = "xpensic_vault_cache";
const DB_VERSION = 1;
const STORE = "vaults";
const LOCAL_PREFIX = "xpensic:encrypted-vault:";

// Defensive IndexedDB access (timeouts, no cached failures, reopen on close)
// — see idb.mjs for why.
const idb = createIdb({
  name: DB_NAME,
  version: DB_VERSION,
  store: STORE,
  upgrade: (db) => {
    if (!db.objectStoreNames.contains(STORE)) {
      db.createObjectStore(STORE, { keyPath: "userId" });
    }
  },
});
const withStore = idb.withStore;

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