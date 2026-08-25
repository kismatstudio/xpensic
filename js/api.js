// Tiny REST client for the expense-tracker backend.
//
// The API is served from the SAME ORIGIN as the client (the dev
// server proxies /api/* to the backend on port 8787). This avoids
// all cross-origin cookie issues — incognito mode, strict SameSite,
// and different-port localhost all work seamlessly.
//
// All methods throw on network errors and non-2xx responses, returning
// the parsed JSON body. The login view catches the throws and surfaces
// the `.error` field as a toast / inline message.

const BASE = (typeof window !== "undefined" && window.ET_API_BASE) || "";

async function request(path, { method = "GET", body, timeoutMs = 8000, _retried = false } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: "include",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(t);
    const msg =
      err?.name === "AbortError"
        ? "Server did not respond. Is the API running on " + BASE + "?"
        : "Can't reach the server. Is it running on " + BASE + "?";
    throw new ApiError(msg, 0, { code: "network" });
  }
  clearTimeout(t);

  // Access token expired → try to rotate the refresh token once, then retry.
  // We never auto-refresh the refresh endpoint itself (would loop) or the
  // signin/signup paths (they set fresh cookies). whoami IS included so a
  // page reload after the 15-min access token expires can still recover
  // via the 30-day refresh token — otherwise the user is bounced to the
  // login gate on every reload after 15 minutes, which is terrible UX.
  if (
    res.status === 401 &&
    !_retried &&
    !path.includes("/refresh") &&
    !path.includes("/auth/signin") &&
    !path.includes("/auth/signup")
  ) {
    try {
      const refreshRes = await fetch(BASE + "/api/auth/refresh", {
        method: "POST",
        credentials: "include",
      });
      if (refreshRes.ok) {
        // Got a fresh access token — retry the original request.
        return request(path, { method, body, timeoutMs, _retried: true });
      }
      // Refresh itself failed (401/403/etc) — the session family is dead.
      // Dispatch an event so the app can boot the user back to the
      // login gate with a friendly toast, instead of leaving them
      // stranded on the dashboard with a 401 storm in the console.
      //
      // Only fire the event if we're sure we were in an authenticated
      // session. On a fresh boot the in-memory refresh store may be
      // cold (server was restarted) and we don't want to nuke the
      // user before the unlock flow has had a chance to recover.
      // The simplest signal: there's a non-empty userId in our
      // in-memory profile, OR the request was clearly an
      // authenticated one (anything other than /api/auth/whoami
      // when the gate is up).
      const hadSession =
        typeof window !== "undefined" &&
        !!(window.__xpensicCurrentUserId || "");
      if (hadSession && !window.__xpensicSessionExpiredNotified) {
        window.__xpensicSessionExpiredNotified = true;
        window.dispatchEvent(new CustomEvent("xpensic:session-expired"));
        // Allow another notification after the next sign-in.
        setTimeout(() => { window.__xpensicSessionExpiredNotified = false; }, 1000);
      }
    } catch {
      // Network error during refresh — fall through to surface the
      // original 401 (the offline toast will explain the rest).
    }
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok || (payload && payload.ok === false)) {
    throw new ApiError(
      (payload && payload.error) || `Request failed (${res.status}).`,
      res.status,
      payload
    );
  }
  return payload || {};
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

// --- Auth -----------------------------------------------------------------

export const Auth = {
  signup: (body) => request("/api/auth/signup", { method: "POST", body }),
  signin: (body) => request("/api/auth/signin", { method: "POST", body }),
  signout: () => request("/api/auth/signout", { method: "POST" }),
  whoami: () => request("/api/auth/whoami"),
  refresh: () => request("/api/auth/refresh", { method: "POST" }),
  sendOtp: (identifier) =>
    request("/api/auth/send-otp", { method: "POST", body: { identifier } }),
  verifyOtp: (identifier, code) =>
    request("/api/auth/verify-otp", {
      method: "POST",
      body: { identifier, code },
    }),
  updateProfile: (patch) =>
    request("/api/auth/profile", { method: "PATCH", body: patch }),
  // Forgot password — three-step flow.
  forgotSendOtp: (identifier) =>
    request("/api/auth/forgot/send-otp", {
      method: "POST",
      body: { identifier },
    }),
  forgotVerify: (identifier, code) =>
    request("/api/auth/forgot/verify", {
      method: "POST",
      body: { identifier, code },
    }),
  forgotReset: (identifier, code, resetToken, newPassword) =>
    request("/api/auth/forgot/reset", {
      method: "POST",
      body: { identifier, code, resetToken, newPassword },
    }),
};

// --- Data (GET only — hydrate on boot) ------------------------------------

export const Data = {
  get: () => request("/api/data"),
};

// --- Crypto (E2EE vault + master-key wraps) -------------------------------
//
// These endpoints carry ONLY ciphertext. The server is a dumb relay.
// See docs/ARCHITECTURE.md §13 for the full API surface.

export const Crypto = {
  // Fetch all wrapped master-key envelopes for the current user.
  // The server returns rows of { wrapType, envelope: <json-string>, createdAt }.
  // We normalise so callers always see the envelope as a parsed object
  // (unlock code feeds it straight into the unwrap functions).
  getMasterKey: async () => {
    const r = await request("/api/crypto/master-key");
    const wraps = (r && r.wraps) || [];
    return wraps.map((w) => {
      let envelope = w.envelope;
      if (typeof envelope === "string") {
        try { envelope = JSON.parse(envelope); }
        catch { envelope = null; }
      }
      // Defensive fallback — if the server ever inlines the envelope
      // fields directly on the row, lift them out so callers don't
      // have to care about row vs. envelope shape.
      if (!envelope && w.salt && w.ct && w.nonce) {
        envelope = {
          v: w.v || 1,
          wrapType: w.wrapType,
          alg: w.alg,
          kdf: w.kdf,
          salt: w.salt,
          nonce: w.nonce,
          ct: w.ct,
          params: w.params,
          createdAt: w.createdAt,
        };
      }
      return {
        wrapType: envelope?.wrapType || w.wrapType,
        envelope,
        createdAt: w.createdAt,
      };
    });
  },
  // Replace all wraps atomically. Each entry is a wrap envelope
  // object that already includes its own wrapType field.
  putMasterKey: (wraps) => request("/api/crypto/master-key", { method: "PUT", body: { wraps } }),
  // Fetch the encrypted vault blob.
  getVault: () => request("/api/crypto/vault"),
  // Upload a new encrypted vault blob.
  putVault: (blob) => request("/api/crypto/vault", { method: "PUT", body: blob }),
};

// --- Devices (public keys only) -------------------------------------------

export const Devices = {
  list: () => request("/api/devices"),
  register: (label, pubKeyX25519, pubKeyEd25519) =>
    request("/api/devices", { method: "POST", body: { label, pubKeyX25519, pubKeyEd25519 } }),
  revoke: (deviceId) => request(`/api/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" }),
};

// --- Pairing (QR device linking) ------------------------------------------

export const Pair = {
  start: (ephemeralPubKey) => request("/api/pair/start", { method: "POST", body: { ephemeralPubKey } }),
  join: (pairingId, newDevicePubKey, newDeviceLabel) =>
    request(`/api/pair/join/${encodeURIComponent(pairingId)}`, {
      method: "POST",
      body: { newDevicePubKey, newDeviceLabel },
    }),
  pending: (pairingId) => request(`/api/pair/pending/${encodeURIComponent(pairingId)}`),
  complete: (pairingId, newDevicePubKey, newDeviceLabel, wrappedMk) =>
    request(`/api/pair/complete/${encodeURIComponent(pairingId)}`, {
      method: "POST",
      body: { newDevicePubKey, newDeviceLabel, wrappedMk },
    }),
  result: (pairingId) => request(`/api/pair/result/${encodeURIComponent(pairingId)}`),
  // Fetch the trusted device's public Ed25519 signing key to verify the QR.
  trustedKey: (pairingId) =>
    request(`/api/pair/trusted-key/${encodeURIComponent(pairingId)}`),
};

// --- Encrypted blobs (receipts) -------------------------------------------

export const Blobs = {
  list: () => request("/api/blobs"),
  // envelope = { v, alg, nonce, ct, mimeType, sizeBytes, ... }
  upload: (envelope) => request("/api/blobs", { method: "POST", body: envelope }),
  download: (blobId) => request(`/api/blobs/${encodeURIComponent(blobId)}`),
  remove: (blobId) => request(`/api/blobs/${encodeURIComponent(blobId)}`, { method: "DELETE" }),
};

// --- Expenses (per-resource CRUD) -----------------------------------------

export const Expenses = {
  list:   () => request("/api/expenses"),
  create: (expense) => request("/api/expenses", { method: "POST", body: expense }),
  update: (id, expense) => request(`/api/expenses/${encodeURIComponent(id)}`, { method: "PUT", body: expense }),
  remove: (id) => request(`/api/expenses/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

// --- Categories (per-resource CRUD) ---------------------------------------

export const Categories = {
  list:   () => request("/api/categories"),
  create: (category) => request("/api/categories", { method: "POST", body: category }),
  update: (id, category) => request(`/api/categories/${encodeURIComponent(id)}`, { method: "PUT", body: category }),
  remove: (id) => request(`/api/categories/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

// --- Budgets (whole-blob replace per user) --------------------------------

export const Budgets = {
  get: () => request("/api/budgets"),
  put: (budgets) => request("/api/budgets", { method: "PUT", body: budgets }),
};

// --- Settings (merge patch) -----------------------------------------------

export const Settings = {
  get: () => request("/api/settings"),
  put: (patch) => request("/api/settings", { method: "PUT", body: patch }),
};

// --- Splits (per-resource CRUD) ------------------------------------------

export const Splits = {
  list:   () => request("/api/splits"),
  create: (split) => request("/api/splits", { method: "POST", body: split }),
  update: (id, split) => request(`/api/splits/${encodeURIComponent(id)}`, { method: "PUT", body: split }),
  remove: (id) => request(`/api/splits/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

// --- Health ---------------------------------------------------------------

export const health = () => request("/api/health");

// Surface the configured base for diagnostics (e.g. login screen banner).
export const apiBase = BASE;
