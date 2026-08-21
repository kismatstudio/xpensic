// Vault sync — bridges the in-memory master key (from unlock-gate)
// with the encrypted blob on the server. The flow is:
//
//   boot:
//     1. user signs in → we know who they are
//     2. fetch wrapped MK envelopes from server
//     3. prompt for password (or recovery phrase) → unwrap one
//     4. fetch encrypted vault → decrypt with MK → state
//
//   on every state mutation:
//     1. encrypt state with MK
//     2. PUT vault to server (debounced 500ms like the old sync)
//
//   sign out / switch account:
//     1. zero the MK
//     2. delete the cached state from localStorage
//
// The plaintext state is NEVER sent to the server. The MK is NEVER
// sent to the server (only password-wraps and phrase-wraps are).
// The server is a dumb relay.

import { Crypto } from "../api.js";
import { encryptVault, decryptVault, isEmptyEnvelope } from "./vault.mjs";
import {
  getMasterKey,
  getState as getUnlockState,
  lock as lockVault,
} from "./unlock-gate.mjs";
import { Store } from "../store.js";

let lastSyncedFingerprint = null;

/** Load the vault: returns the decrypted state, or null if no vault. */
export async function loadVault() {
  if (!getUnlockState().isUnlocked) {
    throw new Error("Vault is locked — call unlock() before loadVault()");
  }
  const res = await Crypto.getVault();
  const envelope = res?.vault || null;
  if (isEmptyEnvelope(envelope)) return null;
  const state = await decryptVault(getMasterKey(), envelope);
  return state;
}

/** Encrypt + upload the current state to the server. */
export async function saveVault(state) {
  if (!getUnlockState().isUnlocked) {
    // Nothing to do — the data is still in localStorage as a
    // write-through cache.
    return;
  }
  const blob = await encryptVault(getMasterKey(), state);
  await Crypto.putVault(blob);
  lastSyncedFingerprint = JSON.stringify(blob);
}

/** Force a fresh load (skips the localStorage cache). */
export async function loadVaultFresh() {
  if (!getUnlockState().isUnlocked) {
    throw new Error("Vault is locked — call unlock() before loadVaultFresh()");
  }
  const res = await Crypto.getVault();
  const envelope = res?.vault || null;
  if (isEmptyEnvelope(envelope)) return null;
  const state = await decryptVault(getMasterKey(), envelope);
  // Mirror the decrypted state into localStorage so the offline
  // cache matches what the server has.
  try { Store.save(state); } catch { /* ignore quota errors */ }
  return state;
}

/** Mark the vault as locked (zero the MK). Caller is responsible for
 *  showing the unlock UI next. */
export function lockAndForget() {
  lockVault();
  lastSyncedFingerprint = null;
}