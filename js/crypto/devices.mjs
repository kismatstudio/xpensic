// Device identity — each browser install gets a long-lived
// X25519+Ed25519 keypair generated on first unlock. The private
// half is stored in localStorage (this is fine because it's bound
// to a specific browser profile; the threat model assumes a
// physical attacker with localStorage access has already won).
//
// The public halves are registered with the server via
// `Devices.register(label, pubKeyX25519, pubKeyEd25519)`. The server
// stores them in the `devices` table. When the user pairs a new
// device, the trusted device uses its X25519 private key to derive
// a shared secret and wraps the MK for the new device.

import {
  generateKxKeypair,
  generateSigningKeypair,
  bytesToB64,
  b64ToBytes,
  randomBytes,
} from "./sodium.mjs";

const DEVICE_KEY_X = "xpensic:device-key-x25519";
const DEVICE_KEY_E = "xpensic:device-key-ed25519";
const DEVICE_ID    = "xpensic:device-id";

/** Load (or create) this device's long-lived keypair + id. */
export async function loadOrCreateDeviceKeys() {
  let pubX = localStorage.getItem(DEVICE_KEY_X);
  let secX = localStorage.getItem(DEVICE_KEY_E + ":priv");
  let pubE = localStorage.getItem(DEVICE_KEY_E);
  let secE = localStorage.getItem(DEVICE_KEY_E + ":priv");
  let id   = localStorage.getItem(DEVICE_ID);

  if (pubX && secX && pubE && secE && id) {
    return {
      deviceId: id,
      x25519: { publicKey: b64ToBytes(pubX), privateKey: b64ToBytes(secX) },
      ed25519: { publicKey: b64ToBytes(pubE), privateKey: b64ToBytes(secE) },
    };
  }

  // First time: generate fresh keys. The KX keypair is for wrapping
  // the MK to a new device; the signing keypair is for attesting
  // that an action came from this device (audit trail).
  const x = await generateKxKeypair();
  const e = await generateSigningKeypair();
  id = `dev_${bytesToB64(await randomBytes(8))}`;
  localStorage.setItem(DEVICE_KEY_X, bytesToB64(x.publicKey));
  localStorage.setItem(DEVICE_KEY_X + ":priv", bytesToB64(x.privateKey));
  localStorage.setItem(DEVICE_KEY_E, bytesToB64(e.publicKey));
  localStorage.setItem(DEVICE_KEY_E + ":priv", bytesToB64(e.privateKey));
  localStorage.setItem(DEVICE_ID, id);
  return { deviceId: id, x25519: x, ed25519: e };
}

/** Get just the device id (cheap; doesn't load the keys). */
export function getDeviceId() {
  return localStorage.getItem(DEVICE_ID) || "";
}

/** Forget this device's keys. Next unlock will mint a fresh identity. */
export function forgetDeviceKeys() {
  for (const k of [DEVICE_KEY_X, DEVICE_KEY_X + ":priv", DEVICE_KEY_E, DEVICE_KEY_E + ":priv", DEVICE_ID]) {
    localStorage.removeItem(k);
  }
}