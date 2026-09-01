import { Crypto } from "../api.js";
import { encryptVault, decryptVault, isEmptyEnvelope } from "./vault.mjs";
import {
  getMasterKey,
  getState as getUnlockState,
  lock as lockVault,
} from "./unlock-gate.mjs";
import {
  getEncryptedVault,
  saveEncryptedVault,
  clearEncryptedVault,
} from "./vault-cache.mjs";
import { Store } from "../store.js";

let currentRevision = 0;

function userIdFromState(state) {
  return state?.profile?.userId || "";
}

function userIdFromWindow() {
  return typeof window !== "undefined" ? window.__xpensicCurrentUserId || "" : "";
}

async function decryptEnvelope(userId, envelope) {
  if (isEmptyEnvelope(envelope)) return null;
  const state = await decryptVault(getMasterKey(), envelope);
  if (userId) await saveEncryptedVault(userId, envelope, currentRevision);
  Store.clearPlaintextCache();
  return state;
}

function mergeById(localItems, remoteItems) {
  const result = [];
  const seen = new Set();
  for (const item of localItems || []) {
    if (!item?.id || seen.has(item.id)) continue;
    result.push(item);
    seen.add(item.id);
  }
  for (const item of remoteItems || []) {
    if (!item?.id || seen.has(item.id)) continue;
    result.push(item);
    seen.add(item.id);
  }
  return result;
}

function mergeVaultStates(localState, remoteState) {
  const localBudgets = localState?.budgets?.monthly || {};
  const remoteBudgets = remoteState?.budgets?.monthly || {};
  return {
    ...remoteState,
    ...localState,
    expenses: mergeById(localState?.expenses, remoteState?.expenses),
    categories: mergeById(localState?.categories, remoteState?.categories),
    splits: mergeById(localState?.splits, remoteState?.splits),
    budgets: {
      monthly: { ...remoteBudgets, ...localBudgets },
    },
    settings: { ...(remoteState?.settings || {}), ...(localState?.settings || {}) },
    profile: { ...(remoteState?.profile || {}), ...(localState?.profile || {}) },
    loginDays: [...new Set([
      ...(remoteState?.loginDays || []),
      ...(localState?.loginDays || []),
    ])].sort(),
  };
}

async function uploadVault(userId, state, envelope, attempt = 0) {
  await saveEncryptedVault(userId, envelope, currentRevision);
  try {
    const result = await Crypto.putVault(envelope, currentRevision);
    currentRevision = Number.isInteger(result?.revision) && result.revision >= 0
      ? result.revision
      : currentRevision + 1;
    await saveEncryptedVault(userId, envelope, currentRevision);
  } catch (err) {
    if (err?.status !== 409 || attempt > 0) throw err;
    const remote = await Crypto.getVault();
    const remoteEnvelope = remote?.vault || null;
    currentRevision = Number.isInteger(remote?.revision) && remote.revision >= 0
      ? remote.revision
      : 0;
    if (!remoteEnvelope || isEmptyEnvelope(remoteEnvelope)) {
      const retryEnvelope = await encryptVault(getMasterKey(), state);
      return uploadVault(userId, state, retryEnvelope, attempt + 1);
    }
    const remoteState = await decryptVault(getMasterKey(), remoteEnvelope);
    Object.assign(state, mergeVaultStates(state, remoteState));
    const retryEnvelope = await encryptVault(getMasterKey(), state);
    return uploadVault(userId, state, retryEnvelope, attempt + 1);
  }
}

/** Load and decrypt the vault, falling back to the encrypted local cache. */
export async function loadVault({ userId = "" } = {}) {
  if (!getUnlockState().isUnlocked) {
    throw new Error("Vault is locked — call unlock() before loadVault()");
  }
  const id = userId || userIdFromWindow();
  let serverError = null;
  try {
    const res = await Crypto.getVault();
    currentRevision = Number.isInteger(res?.revision) && res.revision >= 0 ? res.revision : 0;
    const envelope = res?.vault || null;
    if (!isEmptyEnvelope(envelope)) return await decryptEnvelope(id, envelope);
  } catch (err) {
    serverError = err;
  }

  const cached = id ? await getEncryptedVault(id) : null;
  if (cached) {
    currentRevision = Number.isInteger(cached.revision) && cached.revision >= 0 ? cached.revision : 0;
    return await decryptEnvelope("", cached);
  }
  if (serverError) throw serverError;
  return null;
}

/** Encrypt the current state, cache it, and upload the envelope. */
export async function saveVault(state, { userId = "" } = {}) {
  if (!getUnlockState().isUnlocked) {
    throw new Error("Vault is locked — call unlock() before saveVault()");
  }
  const blob = await encryptVault(getMasterKey(), state);
  const id = userId || userIdFromState(state) || userIdFromWindow();
  Store.clearPlaintextCache();
  await uploadVault(id, state, blob);
}

/** Force a fresh server load and refresh the encrypted local cache. */
export async function loadVaultFresh({ userId = "" } = {}) {
  if (!getUnlockState().isUnlocked) {
    throw new Error("Vault is locked — call unlock() before loadVaultFresh()");
  }
  const res = await Crypto.getVault();
  currentRevision = Number.isInteger(res?.revision) && res.revision >= 0 ? res.revision : 0;
  const envelope = res?.vault || null;
  if (isEmptyEnvelope(envelope)) return null;
  const state = await decryptVault(getMasterKey(), envelope);
  const id = userId || userIdFromState(state) || userIdFromWindow();
  if (id) await saveEncryptedVault(id, envelope);
  Store.clearPlaintextCache();
  return state;
}

export async function clearVaultCache(userId) {
  return clearEncryptedVault(userId || userIdFromWindow());
}

/** Mark the vault as locked and zero the in-memory master key. */
export function lockAndForget() {
  lockVault();
}