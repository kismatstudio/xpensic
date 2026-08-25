// Auth routes — signup, signin, OTP (send + verify), signout, and a
// "whoami" for the client to verify its session on boot.
//
// All endpoints accept and return JSON. Successful signin / signup set
// an httpOnly cookie with a signed JWT. The client never sees the
// token directly — it just calls /api/auth/whoami on boot.

import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { newId } from "../ids.js";
import { sendOtpEmail } from "../email.js";
import {
  createUser,
  findUserByEmail,
  findUserById,
  updateUser,
  putRefreshToken,
  getRefreshToken,
  deleteRefreshToken,
} from "../db.js";
import {
  validateIdentifier,
  validateName,
  validatePassword,
} from "../validate.js";
import { attachUser } from "../middleware/auth.js";

export const authRouter = Router();

const COOKIE_NAME = "et_token";          // short-lived access token
const REFRESH_COOKIE_NAME = "et_refresh"; // rotating refresh token
const TOKEN_TTL = "15m";                 // access token: short-lived
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Refresh-token store. Backed by the persistent refresh_tokens table
// (via db.js) so sessions survive backend restarts. Previously this was
// an in-memory Map — every restart silently invalidated all signed-in
// clients, so their sync POSTs failed with 401 and Quick Add entries
// never reached the server.
const refreshStore = {
  set: (key, session) => putRefreshToken(key, session),
  get: (key) => getRefreshToken(key),
  delete: (key) => deleteRefreshToken(key),
};

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function issueTokens(res, { userId, email }) {
  const secret = process.env.JWT_SECRET || "dev-secret-change-me";

  // Access token — short-lived JWT.
  const token = jwt.sign({ userId, email }, secret, { expiresIn: TOKEN_TTL });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 15 * 60 * 1000,
    path: "/",
  });

  // Refresh token — opaque random value, stored hashed, rotated on use.
  const refreshToken = crypto.randomBytes(48).toString("base64url");
  const expiresAt = Date.now() + REFRESH_TTL_MS;
  refreshStore.set(hashToken(refreshToken), {
    userId,
    email,
    expiresAt,
    parent: null,
    createdAt: Date.now(),
  });
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: REFRESH_TTL_MS,
    path: "/",
  });
  return { token, refreshToken };
}

// POST /api/auth/refresh — rotate the refresh token, issue a fresh access
// token. The old refresh token is revoked (single-use); a reused token is
// treated as a possible theft and revokes the whole session family.
authRouter.post("/refresh", (req, res) => {
  const oldToken = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!oldToken) {
    return res.status(401).json({ ok: false, error: "No refresh token." });
  }
  const key = hashToken(oldToken);
  const session = refreshStore.get(key);
  if (!session) {
    return res.status(401).json({ ok: false, error: "Refresh token invalid or expired." });
  }
  if (Date.now() > session.expiresAt) {
    refreshStore.delete(key);
    return res.status(401).json({ ok: false, error: "Refresh token expired." });
  }

  // Rotation: revoke this token, issue a new one.
  refreshStore.delete(key);
  const newRefresh = crypto.randomBytes(48).toString("base64url");
  refreshStore.set(hashToken(newRefresh), {
    ...session,
    parent: key,
    createdAt: Date.now(),
  });
  res.cookie(REFRESH_COOKIE_NAME, newRefresh, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: REFRESH_TTL_MS,
    path: "/",
  });
  const secret = process.env.JWT_SECRET || "dev-secret-change-me";
  const token = jwt.sign({ userId: session.userId, email: session.email }, secret, { expiresIn: TOKEN_TTL });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 15 * 60 * 1000,
    path: "/",
  });
  return res.json({ ok: true });
});

function publicUser(row) {
  return {
    userId: row.userId,
    email: row.email,
    phone: row.phone || "",
    displayName: row.displayName || "",
    avatarDataUrl: row.avatarDataUrl || "",
    // loginDays — the streak counter. Returned in /api/auth/whoami and
    // PATCH /api/auth/profile responses so the client can pick it up
    // after sign-in and keep the dashboard's hero-card badge in sync.
    // Kept out of the typical user listing payloads — only the
    // "self" surfaces return it.
    loginDays: Array.isArray(row.loginDays) ? row.loginDays : [],
  };
}

// POST /api/auth/signup
// Body: { identifier (email or phone), password, confirmPassword, displayName? }
authRouter.post("/signup", (req, res) => {
  const { identifier, password, confirmPassword, displayName } = req.body || {};
  const id = validateIdentifier(identifier);
  if (!id) {
    return res.status(400).json({ ok: false, error: "Enter a valid email or 10-digit mobile number." });
  }
  const pw = validatePassword(password);
  if (!pw) {
    return res.status(400).json({ ok: false, error: "Password must be at least 8 characters." });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ ok: false, error: "Passwords do not match." });
  }
  const name = displayName ? validateName(displayName) : "";

  // Phone-only accounts get a synthetic `phone:<digits>` email key so
  // they share the lookup path with real emails.
  const emailKey = id.kind === "email" ? id.value : `phone:${id.value}`;
  if (findUserByEmail(emailKey)) {
    return res.status(409).json({ ok: false, error: "An account with this email/phone already exists." });
  }

  const userId = newId("user");
  const passwordHash = bcrypt.hashSync(pw, 10);
  const user = createUser({
    userId,
    email: emailKey,
    phone: id.kind === "phone" ? id.value : "",
    passwordHash,
    displayName: name || "",
    avatarDataUrl: "",
    createdAt: new Date().toISOString(),
  });

  issueTokens(res, { userId, email: user.email });
  return res.json({ ok: true, user: publicUser(user) });
});

// POST /api/auth/signin
// Body: { identifier, password }
authRouter.post("/signin", (req, res) => {
  const { identifier, password } = req.body || {};
  const id = validateIdentifier(identifier);
  if (!id) {
    return res.status(400).json({ ok: false, error: "Enter a valid email or 10-digit mobile number." });
  }
  if (!password) {
    return res.status(400).json({ ok: false, error: "Password is required." });
  }

  const emailKey = id.kind === "email" ? id.value : `phone:${id.value}`;
  const user = findUserByEmail(emailKey);
  if (!user) {
    return res.status(401).json({
      ok: false,
      error: "This email/phone is not registered. Please sign up first.",
    });
  }
  if (!bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ ok: false, error: "Incorrect password." });
  }

  issueTokens(res, { userId: user.userId, email: user.email });
  return res.json({ ok: true, user: publicUser(user) });
});

// POST /api/auth/send-otp
// Generates a 4-digit code, stashes it in memory for 5 minutes, and
// delivers it to the user.
//
//   • Email identifiers   → sent via the Resend transactional email
//                            service (see `server/src/email.js`). When
//                            RESEND_API_KEY is not configured we fall
//                            back to demo mode and return the code so
//                            local development keeps working.
//   • Phone identifiers   → no SMS provider wired up yet; demo mode
//                            (code in response) is the only path. Swap
//                            in Twilio / MSG91 here when needed; the
//                            route shape doesn't change.
authRouter.post("/send-otp", async (req, res) => {
  const { identifier } = req.body || {};
  const id = validateIdentifier(identifier);
  if (!id) {
    return res.status(400).json({ ok: false, error: "Enter a valid email or 10-digit mobile number." });
  }
  const emailKey = id.kind === "email" ? id.value : `phone:${id.value}`;
  if (!findUserByEmail(emailKey)) {
    return res.status(401).json({ ok: false, error: "This email/phone is not registered. Please sign up first." });
  }
  const code = String(Math.floor(1000 + Math.random() * 9000));
  otpStore.set(emailKey, { code, expiresAt: Date.now() + 5 * 60 * 1000 });

  // Deliver the code. For email identifiers we go through Resend;
  // for phone identifiers we skip the email send and stay in demo mode.
  if (id.kind === "email") {
    const delivery = await sendOtpEmail(id.value, code, { ttlMinutes: 5 });
    if (!delivery.ok) {
      // Roll back the stored code so a retry generates a fresh one.
      otpStore.delete(emailKey);
      return res.status(502).json({
        ok: false,
        error: delivery.error || "Could not send the OTP email.",
      });
    }
    if (delivery.live) {
      // Real email sent — never reveal the code to the client.
      return res.json({
        ok: true,
        delivered: "email",
        message: "OTP sent to your email.",
        identifier: id.value,
        expiresInSeconds: 300,
      });
    }
    // Demo fallback (no RESEND_API_KEY) — return the code so the UI can
    // show it on screen, mirroring the previous behaviour.
    return res.json({
      ok: true,
      delivered: "demo",
      message: "Demo mode: OTP shown on screen.",
      code,
      identifier: id.value,
      expiresInSeconds: 300,
    });
  }

  // Phone-only path: no SMS provider wired up yet. Demo mode only.
  return res.json({
    ok: true,
    delivered: "demo",
    message: "Demo mode: OTP shown on screen.",
    code,
    identifier: id.value,
    expiresInSeconds: 300,
  });
});

// POST /api/auth/verify-otp
// Body: { identifier, code }
authRouter.post("/verify-otp", (req, res) => {
  const { identifier, code } = req.body || {};
  const id = validateIdentifier(identifier);
  if (!id) {
    return res.status(400).json({ ok: false, error: "Enter a valid email or 10-digit mobile number." });
  }
  const emailKey = id.kind === "email" ? id.value : `phone:${id.value}`;
  const entry = otpStore.get(emailKey);
  if (!entry) {
    return res.status(400).json({ ok: false, error: "No OTP was sent for this identifier. Tap Send OTP first." });
  }
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(emailKey);
    return res.status(400).json({ ok: false, error: "OTP expired. Tap Send OTP to get a new one." });
  }
  if (String(code || "").trim() !== entry.code) {
    return res.status(400).json({ ok: false, error: "OTP does not match. Please try again." });
  }
  otpStore.delete(emailKey);
  const user = findUserByEmail(emailKey);
  if (!user) {
    return res.status(401).json({ ok: false, error: "This email/phone is not registered. Please sign up first." });
  }
  issueTokens(res, { userId: user.userId, email: user.email });
  return res.json({ ok: true, identifier: id.value, user: publicUser(user) });
});

// POST /api/auth/whoami  — returns the current user (or 401).
authRouter.get("/whoami", attachUser, (req, res) => {
  if (!req.user) {
    return res.status(401).json({ ok: false, error: "Not authenticated." });
  }
  const user = findUserById(req.user.userId);
  if (!user) {
    return res.status(401).json({ ok: false, error: "Account no longer exists." });
  }
  return res.json({ ok: true, user: publicUser(user) });
});

// POST /api/auth/signout — clears the cookies and revokes the refresh token.
authRouter.post("/signout", (req, res) => {
  const oldToken = req.cookies?.[REFRESH_COOKIE_NAME];
  if (oldToken) refreshStore.delete(hashToken(oldToken));
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.clearCookie(REFRESH_COOKIE_NAME, { path: "/" });
  return res.json({ ok: true });
});

// PATCH /api/auth/profile — update display name / phone / avatar.
// Body: { displayName? | name?, phone?, avatarDataUrl?, loginDays? }
// Accepts both `displayName` (server-canonical) and `name` (the field
// name the client uses on its in-memory profile) so the existing
// Profile view doesn't have to know the server's naming convention.
authRouter.patch("/profile", attachUser, (req, res) => {
  if (!req.user) {
    return res.status(401).json({ ok: false, error: "Not authenticated." });
  }
  const { displayName, name, phone, avatarDataUrl, loginDays } = req.body || {};
  const patch = {};
  // Prefer displayName when both are sent; otherwise fall back to name.
  const nameCandidate = typeof displayName === "string" ? displayName : name;
  if (typeof nameCandidate === "string") {
    const cleaned = validateName(nameCandidate);
    if (!cleaned) return res.status(400).json({ ok: false, error: "Invalid display name." });
    patch.displayName = cleaned;
  }
  if (typeof phone === "string") {
    // Same normalisation the signup path uses — strip non-digits, keep
    // the last 10. Empty string is allowed (clears the phone).
    const digits = phone.replace(/\D/g, "").slice(-10);
    if (phone.trim() !== "" && digits.length !== 10) {
      return res.status(400).json({ ok: false, error: "Phone must be a 10-digit Indian mobile number." });
    }
    patch.phone = digits;
  }
  if (typeof avatarDataUrl === "string") {
    patch.avatarDataUrl = avatarDataUrl.slice(0, 200_000); // ~200KB cap
  }
  // loginDays — the streak counter. Stored on the user record so the
  // client can hydrate it via /api/data on next sign-in and the
  // streak survives a fresh device. We validate strictly so a
  // malicious client can't pollute the column with junk.
  if (Array.isArray(loginDays)) {
    const cleaned = loginDays
      .filter((d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))
      .slice(-365) // cap to a year of history to keep the row small
      .sort();
    if (cleaned.length > 0) patch.loginDays = cleaned;
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ ok: false, error: "Nothing to update." });
  }
  const user = updateUser(req.user.userId, patch);
  if (!user) return res.status(404).json({ ok: false, error: "User not found." });
  return res.json({ ok: true, user: publicUser(user) });
});

// --- helpers --------------------------------------------------------------

// In-memory OTP stores. Reset on server restart. The two stores are kept
// separate so a sign-in OTP can't be (mis)used to reset a password and
// vice versa.
const otpStore = new Map();        // sign-in OTPs
const forgotStore = new Map();     // password-reset OTPs

// --- Forgot password flow --------------------------------------------------
// Three steps, kept tiny on purpose:
//
//   1. POST /api/auth/forgot/send-otp   { identifier } → email the code
//   2. POST /api/auth/forgot/verify     { identifier, code } → short-lived
//                                          "reset token" (signed JWT)
//   3. POST /api/auth/forgot/reset      { identifier, code, newPassword }
//                                          → verify + update in one call
//
// Why three and not one? Step 2 issues a server-signed reset token so the
// password change is gated by both the OTP AND a token that the request
// could not have produced without passing step 2. It also gives the
// client a clean "OTP verified, pick a new password" beat to render.
//
// The reset token is a JWT with a 10-minute expiry so the user has
// plenty of time to type a new password but a leaked token can't be
// used for long.

function issueResetToken({ userId, email }) {
  const secret = process.env.JWT_SECRET || "dev-secret-change-me";
  return jwt.sign(
    { scope: "reset", userId, email },
    secret,
    { expiresIn: "10m" },
  );
}

function verifyResetToken(token, expectedEmailKey) {
  const secret = process.env.JWT_SECRET || "dev-secret-change-me";
  try {
    const claims = jwt.verify(token, secret);
    if (claims.scope !== "reset") return { ok: false, error: "Invalid reset token." };
    if (String(claims.email || "").toLowerCase() !== expectedEmailKey) {
      return { ok: false, error: "Reset token does not match this account." };
    }
    return { ok: true, claims };
  } catch (err) {
    return { ok: false, error: err?.name === "TokenExpiredError"
      ? "Reset session expired. Start the forgot-password flow again."
      : "Invalid reset token." };
  }
}

// POST /api/auth/forgot/send-otp
// Body: { identifier }
// Email identifiers → OTP via Resend.
// Phone identifiers → not supported yet (no SMS provider); we still
// return 200 with `delivered: "unsupported"` so the UI can show a
// graceful "contact support" message rather than failing silently.
authRouter.post("/forgot/send-otp", async (req, res) => {
  const { identifier } = req.body || {};
  const id = validateIdentifier(identifier);
  if (!id) {
    return res.status(400).json({ ok: false, error: "Enter a valid email or 10-digit mobile number." });
  }
  const emailKey = id.kind === "email" ? id.value : `phone:${id.value}`;
  const user = findUserByEmail(emailKey);
  // Always return a generic-looking message to avoid leaking which
  // identifiers are registered. The client behaves the same way either
  // way; in demo mode (no API key) we still return the code so dev
  // works.
  const genericOk = () => ({
    ok: true,
    delivered: id.kind === "email" ? "email" : "unsupported",
    message: id.kind === "email"
      ? user
        ? "If that email is registered, an OTP has been sent."
        : "If that email is registered, an OTP has been sent."
      : "Password reset via SMS is not available yet. Please use Sign in with OTP from a registered email.",
    identifier: id.value,
    expiresInSeconds: 300,
  });

  if (id.kind !== "email") {
    return res.json(genericOk());
  }
  if (!user) {
    // Don't actually send anything — but reply as if we did.
    return res.json(genericOk());
  }

  const code = String(Math.floor(1000 + Math.random() * 9000));
  forgotStore.set(emailKey, { code, expiresAt: Date.now() + 5 * 60 * 1000 });

  const delivery = await sendOtpEmail(id.value, code, { ttlMinutes: 5 });
  if (!delivery.ok) {
    forgotStore.delete(emailKey);
    return res.status(502).json({ ok: false, error: delivery.error || "Could not send the OTP email." });
  }
  if (delivery.live) {
    return res.json(genericOk());
  }
  // Demo fallback (no RESEND_API_KEY): return the code so the UI can
  // display it. Still treat as a successful send.
  return res.json({
    ...genericOk(),
    delivered: "demo",
    code,
  });
});

// POST /api/auth/forgot/verify
// Body: { identifier, code }
// On success returns { ok, resetToken } that the client holds onto
// until the user enters a new password.
authRouter.post("/forgot/verify", (req, res) => {
  const { identifier, code } = req.body || {};
  const id = validateIdentifier(identifier);
  if (!id) {
    return res.status(400).json({ ok: false, error: "Enter a valid email or 10-digit mobile number." });
  }
  const emailKey = id.kind === "email" ? id.value : `phone:${id.value}`;
  const entry = forgotStore.get(emailKey);
  if (!entry) {
    return res.status(400).json({ ok: false, error: "No reset OTP was sent for this account. Tap Send OTP first." });
  }
  if (Date.now() > entry.expiresAt) {
    forgotStore.delete(emailKey);
    return res.status(400).json({ ok: false, error: "OTP expired. Tap Send OTP to get a new one." });
  }
  if (String(code || "").trim() !== entry.code) {
    return res.status(400).json({ ok: false, error: "OTP does not match. Please try again." });
  }
  // Don't burn the code yet — let the reset step consume it.
  return res.json({
    ok: true,
    resetToken: issueResetToken({ userId: entry._userId || "", email: emailKey }),
    identifier: id.value,
  });
});

// POST /api/auth/forgot/reset
// Body: { identifier, code, resetToken, newPassword }
// Verifies the OTP a second time (defence in depth — the resetToken is
// short-lived and the OTP is single-use), then updates the user's
// passwordHash.
authRouter.post("/forgot/reset", (req, res) => {
  const { identifier, code, resetToken, newPassword } = req.body || {};
  const id = validateIdentifier(identifier);
  if (!id) {
    return res.status(400).json({ ok: false, error: "Enter a valid email or 10-digit mobile number." });
  }
  const emailKey = id.kind === "email" ? id.value : `phone:${id.value}`;
  const tokenCheck = verifyResetToken(resetToken, emailKey);
  if (!tokenCheck.ok) {
    return res.status(401).json({ ok: false, error: tokenCheck.error });
  }
  const entry = forgotStore.get(emailKey);
  if (!entry || String(code || "").trim() !== entry.code) {
    return res.status(400).json({ ok: false, error: "OTP does not match. Please start over." });
  }
  if (Date.now() > entry.expiresAt) {
    forgotStore.delete(emailKey);
    return res.status(400).json({ ok: false, error: "OTP expired. Please start over." });
  }
  const pw = validatePassword(newPassword);
  if (!pw) {
    return res.status(400).json({ ok: false, error: "Password must be at least 8 characters." });
  }
  const user = findUserByEmail(emailKey);
  if (!user) {
    return res.status(404).json({ ok: false, error: "Account no longer exists." });
  }
  updateUser(user.userId, { passwordHash: bcrypt.hashSync(pw, 10) });
  forgotStore.delete(emailKey);
  return res.json({ ok: true, message: "Password updated. You can sign in now." });
});
