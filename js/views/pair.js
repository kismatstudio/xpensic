// Pairing view — WhatsApp-style QR device linking.
//
// Two roles:
//   • TRUSTED DEVICE (TD): already unlocked. Renders a QR the user scans
//     with a new device. Polls the server for the new device's public key,
//     computes ECDH, wraps the MK for the new device, and completes the
//     pairing.
//   • NEW DEVICE (ND): scans the QR, generates its own X25519 keypair,
//     publishes its public key to the pairing row, polls for the wrapped
//     MK, unwraps it, and is then fully linked (future unlocks use the
//     device wrap).
//
// The server never sees either private key — it only relays public keys
// and the wrapped MK envelope. See docs/ARCHITECTURE.md §10.
//
// QR rendering uses `qrcode-generator` (MIT), loaded via CDN exactly like
// libsodium in sodium.mjs. It is NOT a crypto primitive — it only renders
// the invite string to a scannable image.

import { Auth, Crypto, Devices, Pair } from "../api.js";
import { toast } from "../components/toast.js";
import {
  createPairingInvite, encodePairingInvite, decodePairingInvite,
  completePairingAsTrustedDevice, completePairingAsNewDevice,
} from "../crypto/pairing.mjs";
import { loadOrCreateDeviceKeys } from "../crypto/devices.mjs";
import { wrapWithDeviceSecret, envelopeToJson } from "../crypto/keystore.mjs";
import { unlockWithDevice } from "../crypto/unlock-gate.mjs";
import { bytesToBase64, base64ToBytes, x25519Ecdh, SIZE } from "../crypto/sodium.mjs";

const PAIRING_POLL_MS = 2500;
const PAIRING_MAX_WAIT_MS = 5 * 60 * 1000;

// Lazily load qrcode-generator (browser global `qrcode`).
let qrLibPromise = null;
function loadQrLib() {
  if (typeof window === "undefined") return Promise.reject(new Error("QR lib requires a browser."));
  if (window.qrcode) return Promise.resolve(window.qrcode);
  if (!qrLibPromise) {
    qrLibPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js";
      s.crossOrigin = "anonymous";
      s.onload = () => resolve(window.qrcode);
      s.onerror = (e) => reject(new Error("Failed to load QR library: " + e));
      document.head.appendChild(s);
    });
  }
  return qrLibPromise;
}

/** Render `text` as a QR onto the given canvas. */
async function renderQr(canvas, text, cellPx = 5, quiet = 4) {
  const qrcode = await loadQrLib();
  const qr = qrcode(0, "M"); // type 0 = auto, ECC M
  qr.addData(text, "Byte");
  qr.make();
  const size = qr.getModuleCount();
  const px = cellPx * (size + quiet * 2);
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = "#111";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect((c + quiet) * cellPx, (r + quiet) * cellPx, cellPx, cellPx);
      }
    }
  }
  return size;
}

// ---------------------------------------------------------------------------
// TRUSTED DEVICE side
// ---------------------------------------------------------------------------

/**
 * Mount the "link a new device" flow on the trusted (unlocked) device.
 * Renders the QR invite, polls for the new device, completes the pairing.
 *
 * @param {object} args
 * @param {HTMLElement} args.container
 * @param {Uint8Array}  args.mk        — the in-memory master key
 * @param {object}      args.deviceKeys — this device's keypair (from loadOrCreateDeviceKeys)
 * @param {string}      args.userId
 */
export async function mountTrustedPairing({ container, mk, deviceKeys, userId }) {
  const root = document.createElement("div");
  root.className = "pair-flow";
  root.innerHTML = `
    <div class="pair-flow__card">
      <h2 class="pair-flow__title">Link a new device</h2>
      <p class="pair-flow__subtitle muted">
        Scan this QR code with the new device. It expires in 5 minutes and
        grants access to your encrypted vault.
      </p>
      <div class="pair-flow__qr">
        <canvas class="pair-flow__canvas" aria-label="Pairing QR code"></canvas>
      </div>
      <p class="pair-flow__status" aria-live="polite" role="status">Waiting for the new device…</p>
      <button class="btn pair-flow__cancel" type="button">Cancel</button>
    </div>
  `;
  container.appendChild(root);

  const canvas = root.querySelector(".pair-flow__canvas");
  const statusEl = root.querySelector(".pair-flow__status");

  let cancelled = false;
  const cleanup = () => {
    cancelled = true;
    root.remove();
  };
  root.querySelector(".pair-flow__cancel").addEventListener("click", cleanup);

  try {
    // Create + sign the invite, render QR.
    const serverUrl = (typeof window !== "undefined" && window.ET_API_BASE) || "http://127.0.0.1:8787";
    const invite = await createPairingInvite({
      serverUrl,
      accountId: userId || "",
      tdSignPub: deviceKeys.ed25519.publicKey,
      tdSignPriv: deviceKeys.ed25519.privateKey,
    });
    await renderQr(canvas, encodePairingInvite(invite));

    // Register the pairing on the server.
    await Pair.start(bytesToBase64(invite.ephemeralPubKey));

    // Poll for the new device's public key.
    const deadline = Date.now() + PAIRING_MAX_WAIT_MS;
    let ndPubB64 = null;
    while (!cancelled && Date.now() < deadline) {
      const res = await Pair.pending(invite.pairingId);
      if (res.status === "completed" || res.newDevicePubKey) {
        ndPubB64 = res.newDevicePubKey;
        break;
      }
      await new Promise((r) => setTimeout(r, PAIRING_POLL_MS));
    }
    if (cancelled) return;
    if (!ndPubB64) {
      statusEl.textContent = "Timed out waiting for the new device. Try again.";
      statusEl.classList.add("pair-flow__status--error");
      return;
    }

    statusEl.textContent = "New device found — sharing your encryption key…";
    // Wrap the MK for the new device.
    const envelope = await completePairingAsTrustedDevice({
      ephemeralPrivKey: invite.ephemeralPrivKey,
      ndPublicKey: base64ToBytes(ndPubB64),
      mk,
    });
    await Pair.complete(invite.pairingId, ndPubB64, "New device", JSON.stringify(envelope));

    statusEl.textContent = "✓ Device linked";
    statusEl.classList.add("pair-flow__status--ok");
    toast("New device linked", "success");
  } catch (err) {
    statusEl.textContent = "Pairing failed: " + (err?.message || err);
    statusEl.classList.add("pair-flow__status--error");
    // eslint-disable-next-line no-console
    console.error("pairing failed:", err);
  }
}

// ---------------------------------------------------------------------------
// NEW DEVICE side
// ---------------------------------------------------------------------------

/**
 * Mount the "pair this device" flow. The user pastes the QR text (v1
 * supports paste + manual entry; a camera scanner can be added later).
 *
 * @param {object} args
 * @param {HTMLElement} args.container
 * @param {(mk: Uint8Array, deviceKeys: object) => void} [args.onLinked]
 */
export async function mountNewDevicePairing({ container, onLinked }) {
  const root = document.createElement("div");
  root.className = "pair-flow pair-flow--new";
  root.innerHTML = `
    <div class="pair-flow__card">
      <h2 class="pair-flow__title">Link this device</h2>
      <p class="pair-flow__subtitle muted">
        Sign in on this device first, then paste the QR code text shown on
        your trusted device.
      </p>
      <div class="field">
        <label class="field__label" for="pair-qr-text">QR code text</label>
        <textarea id="pair-qr-text" rows="4" placeholder="xpensic-pair:v1?…" autocomplete="off"></textarea>
      </div>
      <button class="btn btn--primary pair-flow__start" type="button">Link device</button>
      <p class="pair-flow__status" aria-live="polite" role="status"></p>
    </div>
  `;
  container.appendChild(root);

  const textarea = root.querySelector("#pair-qr-text");
  const statusEl = root.querySelector(".pair-flow__status");
  const startBtn = root.querySelector(".pair-flow__start");

  startBtn.addEventListener("click", async () => {
    const qrText = textarea.value.trim();
    if (!qrText) {
      toast("Paste the QR code text first.", "error");
      return;
    }
    startBtn.disabled = true;
    statusEl.textContent = "Verifying pairing code…";

    try {
      // Verify the QR signature against the trusted device's long-term
      // Ed25519 public key, which we fetch from the server.
      const invite = await decodePairingInvite(qrText, async (accountId) => {
        const res = await Pair.trustedKey(accountId);
        if (!res?.pubKeyEd25519) throw new Error("Trusted device key not found.");
        return base64ToBytes(res.pubKeyEd25519);
      });

      // Ensure we have an identity on the server.
      const me = await Auth.whoami();
      if (!me?.user) throw new Error("Sign in first.");

      // Generate (or load) our own device keypair + register it.
      const keys = await loadOrCreateDeviceKeys();
      const deviceLabel = (typeof navigator !== "undefined" && navigator.userAgent)
        ? navigator.userAgent.slice(0, 48)
        : "New device";
      const reg = await Devices.register(
        deviceLabel,
        bytesToBase64(keys.x25519.publicKey),
        bytesToBase64(keys.ed25519.publicKey),
      );

      // Publish our public key to the pairing row.
      await Pair.join(
        invite.pairingId,
        bytesToBase64(keys.x25519.publicKey),
        deviceLabel,
      );

      statusEl.textContent = "Waiting for your trusted device to confirm…";

      // Poll the pairing result until the TD posts the wrapped MK.
      const deadline = Date.now() + PAIRING_MAX_WAIT_MS;
      let wrapped = null;
      while (Date.now() < deadline) {
        const res = await Pair.result(invite.pairingId);
        if (res.status === "completed" && res.wrappedMk) {
          wrapped = res.wrappedMk;
          break;
        }
        await new Promise((r) => setTimeout(r, PAIRING_POLL_MS));
      }
      if (!wrapped) throw new Error("Timed out waiting for the trusted device.");

      // Unwrap the MK with our private key + the TD's ephemeral pub.
      const envelope = JSON.parse(wrapped);
      const mk = await completePairingAsNewDevice({
        ndPrivateKey: keys.x25519.privateKey,
        tdEphemeralPubKey: invite.ephemeralPubKey,
        envelope,
      });

      // Persist a device wrap so future unlocks on this device work
      // without the password / recovery phrase.
      const sharedSecret = x25519Ecdh(keys.x25519.privateKey, invite.ephemeralPubKey);
      const deviceWrap = await wrapWithDeviceSecret(mk, sharedSecret);
      await Crypto.putWrap("device", envelopeToJson(deviceWrap), reg.deviceId || keys.deviceId);

      // Unlock the in-memory gate.
      await unlockWithDevice({
        wraps: [{ wrapType: "device", deviceId: reg.deviceId || keys.deviceId, envelope: envelopeToJson(deviceWrap) }],
        deviceId: reg.deviceId || keys.deviceId,
        sharedSecret,
      });

      statusEl.textContent = "✓ Device linked — unlocking vault…";
      statusEl.classList.add("pair-flow__status--ok");
      toast("Device linked!", "success");
      onLinked?.(mk, keys);
    } catch (err) {
      statusEl.textContent = "Pairing failed: " + (err?.message || err);
      statusEl.classList.add("pair-flow__status--error");
      startBtn.disabled = false;
      // eslint-disable-next-line no-console
      console.error("new device pairing failed:", err);
    }
  });
}
