// Auth gate — full-screen welcome that blocks the rest of the app until
// the user has a profile. Two tabs:
//
//   1. **Sign in**   — identifier (email OR mobile) + password + a
//                       [Login] button. A second [Login with OTP]
//                       button expands an OTP row inline (send →
//                       verify). A "Forgot password?" link opens a
//                       three-step modal (identifier → OTP → new
//                       password).
//   2. **Sign up**   — identifier + password + confirm-password. The
//                       account lives on the server, so signing in on
//                       any other device sees the same data.
//
// We render directly into the document body (not into #view) so the
// user can't see the app shell behind it. A modal-style backdrop is
// enough.

import { generateAvatarDataUrl, escapeHtml } from "../util.js";
import { Auth, apiBase } from "../api.js";
import { toast } from "../components/toast.js";
import { openModal } from "../components/modal.js";
import { enhancePasswordInputs } from "../components/pw-toggle.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9]{10}$/;

function normalizeIdentifier(raw) {
  const v = String(raw || "").trim();
  if (!v) return null;
  if (EMAIL_RE.test(v)) return { kind: "email", value: v.toLowerCase() };
  const digits = v.replace(/\D/g, "").slice(-10);
  if (PHONE_RE.test(digits)) return { kind: "phone", value: digits };
  return null;
}

/**
 * Mounts the auth screen.
 * @param {{ onComplete: () => void }} ctx
 */
export function mountLogin({ onComplete }) {
  // Build the full-screen container.
  const root = document.createElement("div");
  root.className = "login-gate";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "login-gate-title");
  root.innerHTML = `
    <div class="login-gate__card">
      <!-- Login-gate brand: the full SVG lockup (wordmark included) with
           a light/dark swap via [data-theme]. The tagline is rendered as
           live HTML so it stays editable. -->
      <img
        class="login-gate__mark login-gate__mark--light"
        src="assets/brand/xpensic-light.png"
        alt="Xpensic"
        width="80"
        height="250"
      />
      <img
        class="login-gate__mark login-gate__mark--dark"
        src="assets/brand/xpensic-dark.png"
        alt="Xpensic"
        width="80"
        height="250"
      />
      <div class="login-gate__type"></div>
      <h1 class="login-gate__title" id="login-gate-title">Welcome to XPENSIC</h1>
      <p class="login-gate__subtitle" id="login-gate-subtitle">
        Sign in to continue tracking your expenses across devices.
      </p>

      <div class="login-gate__tabs" role="tablist" aria-label="Authentication">
        <button class="login-gate__tab is-active" type="button" role="tab"
                id="tab-signin" aria-selected="true" aria-controls="auth-panel-signin">
          Sign in
        </button>
        <button class="login-gate__tab" type="button" role="tab"
                id="tab-signup" aria-selected="false" aria-controls="auth-panel-signup"
                tabindex="-1">
          Sign up
        </button>
      </div>

      <form class="login-gate__form" id="auth-form" novalidate>
        <!-- ============ SIGN IN PANEL ============ -->
        <div class="field" id="auth-panel-signin" role="tabpanel" aria-labelledby="tab-signin">
          <div class="field">
            <label class="field__label" for="auth-id-signin">Email or mobile number</label>
            <input
              class="field__input"
              type="text"
              id="auth-id-signin"
              name="identifier"
              autocomplete="username"
              placeholder="you@example.com or 98XXXXXXXX"
              maxlength="80"
              required
            />
            <div class="field__error" id="auth-id-signin-error" hidden></div>
          </div>

          <!-- Password (default) -->
          <div class="field" id="auth-pw-row">
            <label class="field__label" for="auth-pw-signin">Password</label>
            <input
              class="field__input"
              type="password"
              id="auth-pw-signin"
              name="password"
              autocomplete="current-password"
              placeholder="Your password"
              minlength="8"
              required
            />
            <div class="field__error" id="auth-pw-signin-error" hidden></div>
          </div>

          <!-- OTP row (revealed when [Login with OTP] is clicked) -->
          <div class="field" id="auth-otp-row" hidden>
            <label class="field__label" for="auth-otp-signin">4-digit OTP</label>
            <div class="login-gate__otp-row">
              <input
                class="field__input login-gate__otp-input"
                type="text"
                id="auth-otp-signin"
                name="otp"
                inputmode="numeric"
                pattern="[0-9]*"
                autocomplete="one-time-code"
                placeholder="••••"
                maxlength="4"
              />
              <button class="btn btn--sm" type="button" id="auth-otp-send">Send OTP</button>
            </div>
            <div class="field__hint muted" id="auth-otp-hint">
              We'll email a one-time code. It expires in 5 minutes.
            </div>
            <div class="field__error" id="auth-otp-signin-error" hidden></div>
          </div>

          <div class="login-gate__actions">
            <button class="btn btn--primary btn--block" type="button" id="auth-submit-signin">
              <span class="login-gate__btn-label">Login</span>
            </button>
            <button class="btn btn--block" type="button" id="auth-submit-otp" hidden>
              <span class="login-gate__btn-label">Login with OTP</span>
            </button>
          </div>

          <div class="login-gate__aux">
            <button class="btn btn--link" type="button" id="auth-toggle-otp">
              Login with OTP instead
            </button>
            <button class="btn btn--link" type="button" id="auth-forgot-link">
              Forgot password?
            </button>
          </div>
        </div>

        <!-- ============ SIGN UP PANEL ============ -->
        <div class="field" id="auth-panel-signup" role="tabpanel" aria-labelledby="tab-signup" hidden>
          <div class="field">
            <label class="field__label" for="auth-id-signup">Email or mobile number</label>
            <input
              class="field__input"
              type="text"
              id="auth-id-signup"
              name="identifier"
              autocomplete="username"
              placeholder="you@example.com or 98XXXXXXXX"
              maxlength="80"
              required
            />
            <div class="field__hint muted" id="auth-id-signup-hint">
              Used to sign in. Email or 10-digit mobile number. You can add your
              name in Profile after signing up.
            </div>
            <div class="field__error" id="auth-id-signup-error" hidden></div>
          </div>
          <div class="field">
            <label class="field__label" for="auth-pw-signup">Create password</label>
            <input
              class="field__input"
              type="password"
              id="auth-pw-signup"
              name="password"
              autocomplete="new-password"
              placeholder="At least 8 characters"
              minlength="8"
              required
            />
            <div class="field__error" id="auth-pw-signup-error" hidden></div>
          </div>
          <div class="field">
            <label class="field__label" for="auth-pw-signup-2">Confirm password</label>
            <input
              class="field__input"
              type="password"
              id="auth-pw-signup-2"
              name="confirmPassword"
              autocomplete="new-password"
              placeholder="Type the password again"
              minlength="8"
              required
            />
            <div class="field__error" id="auth-pw-signup-2-error" hidden></div>
          </div>
          <button class="btn btn--primary btn--block" type="submit" id="auth-submit-signup">
            Create account
          </button>
        </div>
  `;
  document.body.appendChild(root);

  // Add eye buttons to every password field (sign-in, sign-up, and
  // the forgot-password modal created later all pick this up).
  enhancePasswordInputs(root);

  // --- Helpers -----------------------------------------------------------
  const $form = root.querySelector("#auth-form");
  const $tabSignin = root.querySelector("#tab-signin");
  const $tabSignup = root.querySelector("#tab-signup");
  const $panelSignin = root.querySelector("#auth-panel-signin");
  const $panelSignup = root.querySelector("#auth-panel-signup");
  const $subtitle = root.querySelector("#login-gate-subtitle");

  const fields = {
    signinId: root.querySelector("#auth-id-signin"),
    signinPw: root.querySelector("#auth-pw-signin"),
    signinPwRow: root.querySelector("#auth-pw-row"),
    signinOtp: root.querySelector("#auth-otp-signin"),
    signinOtpRow: root.querySelector("#auth-otp-row"),
    signinIdErr: root.querySelector("#auth-id-signin-error"),
    signinPwErr: root.querySelector("#auth-pw-signin-error"),
    signinOtpErr: root.querySelector("#auth-otp-signin-error"),
    signupId: root.querySelector("#auth-id-signup"),
    signupPw: root.querySelector("#auth-pw-signup"),
    signupPw2: root.querySelector("#auth-pw-signup-2"),
    signupIdErr: root.querySelector("#auth-id-signup-error"),
    signupPwErr: root.querySelector("#auth-pw-signup-error"),
    signupPw2Err: root.querySelector("#auth-pw-signup-2-error"),
    toggleOtp: root.querySelector("#auth-toggle-otp"),
    forgotLink: root.querySelector("#auth-forgot-link"),
    submitSignin: root.querySelector("#auth-submit-signin"),
    submitOtp: root.querySelector("#auth-submit-otp"),
    sendOtpBtn: root.querySelector("#auth-otp-send"),
    otpHint: root.querySelector("#auth-otp-hint"),
  };

  let activeTab = "signin";   // "signin" | "signup"
  let signinMode = "password"; // "password" | "otp"

  function setError(el, msg) {
    if (msg) {
      el.textContent = msg;
      el.hidden = false;
    } else {
      el.textContent = "";
      el.hidden = true;
    }
  }

  // Clear errors as the user edits.
  for (const [key, el] of Object.entries(fields)) {
    if (!(el instanceof HTMLInputElement)) continue;
    el.addEventListener("input", () => {
      const errEl =
        key === "signinId" ? fields.signinIdErr :
        key === "signinPw" ? fields.signinPwErr :
        key === "signinOtp" ? fields.signinOtpErr :
        key === "signupId" ? fields.signupIdErr :
        key === "signupPw" ? fields.signupPwErr :
        key === "signupPw2" ? fields.signupPw2Err : null;
      if (errEl) setError(errEl, "");
    });
  }

  // --- Tab switching -----------------------------------------------------
  function activateTab(tab) {
    activeTab = tab === "signup" ? "signup" : "signin";
    const isSignin = activeTab === "signin";

    $tabSignin.classList.toggle("is-active", isSignin);
    $tabSignin.setAttribute("aria-selected", isSignin ? "true" : "false");
    $tabSignin.tabIndex = isSignin ? 0 : -1;

    $tabSignup.classList.toggle("is-active", !isSignin);
    $tabSignup.setAttribute("aria-selected", !isSignin ? "true" : "false");
    $tabSignup.tabIndex = !isSignin ? 0 : -1;

    $panelSignin.hidden = !isSignin;
    $panelSignup.hidden = isSignin;

    $subtitle.textContent = isSignin
      ? "Sign in to continue tracking your expenses across devices."
      : "Create an account. Your data syncs across devices once you sign in.";

    // Move focus to the first empty field on the active panel.
    queueMicrotask(() => {
      const target = isSignin ? fields.signinId : fields.signupId;
      if (target) target.focus();
    });
  }

  $tabSignin.addEventListener("click", () => activateTab("signin"));
  $tabSignup.addEventListener("click", () => activateTab("signup"));

  root.querySelector(".login-gate__tabs").addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    ev.preventDefault();
    activateTab(activeTab === "signin" ? "signup" : "signin");
    (activeTab === "signin" ? $tabSignin : $tabSignup).focus();
  });

  // --- OTP toggle (sign-in only) ----------------------------------------
  // Swaps between [Login] and [Login with OTP]. The password row hides
  // when OTP is active; the OTP row reveals itself.
  function applySigninMode(mode) {
    signinMode = mode === "otp" ? "otp" : "password";
    const isOtp = signinMode === "otp";
    fields.signinPwRow.hidden = isOtp;
    fields.signinOtpRow.hidden = !isOtp;
    fields.submitSignin.hidden = isOtp;
    fields.submitOtp.hidden = !isOtp;
    fields.toggleOtp.textContent = isOtp ? "Login with password instead" : "Login with OTP instead";
    fields.signinPw.required = !isOtp;
    fields.signinOtp.required = isOtp;
    if (isOtp) queueMicrotask(() => fields.signinOtp.focus());
    else queueMicrotask(() => fields.signinPw.focus());
  }
  fields.toggleOtp.addEventListener("click", () => {
    applySigninMode(signinMode === "otp" ? "password" : "otp");
  });

  // --- Send OTP ----------------------------------------------------------
  // The server response shape differs by `delivered`:
  //   • "email"   → real Resend email; we just say "check your inbox"
  //   • "demo"    → no RESEND_API_KEY configured; we surface the code
  //                 inline so the developer can still test locally
  //   • "unsupported" → phone-only without SMS; not currently used on
  //                      this sign-in path but the server returns it
  //                      for forgot-password phone-only identifiers
  //
  // The 5-minute countdown also acts as a rate-limit so the user
  // can't hammer the resend button (which would let an attacker
  // enumerate the OTP space).
  let otpExpiryTimer = null;
  fields.sendOtpBtn.addEventListener("click", async () => {
    const id = normalizeIdentifier(fields.signinId.value);
    setError(fields.signinIdErr, "");
    if (!id) {
      setError(fields.signinIdErr, "Enter a valid email or 10-digit mobile number first.");
      return;
    }
    fields.sendOtpBtn.disabled = true;
    const originalLabel = fields.sendOtpBtn.textContent;
    fields.sendOtpBtn.textContent = "Sending…";
    try {
      const res = await Auth.sendOtp(id.value);
      if (res.delivered === "demo" && res.code) {
        // DEMO MODE — server has no RESEND_API_KEY. Show the code
        // inline with a copy button + a clear "demo mode" pill so the
        // developer (or anyone testing) knows this isn't a real email.
        fields.otpHint.innerHTML =
          `<div class="login-gate__otp-banner">` +
            `<span class="login-gate__otp-pill" aria-label="Demo mode">` +
              `<span aria-hidden="true">⚙</span> DEMO` +
            `</span>` +
            `<span class="login-gate__otp-text">No <code>RESEND_API_KEY</code> — showing code on screen.</span>` +
          `</div>` +
          `<div class="login-gate__otp-code-row">` +
            `<span>Your code:</span>` +
            `<strong id="otp-display">${escapeHtml(res.code)}</strong>` +
            `<button type="button" class="btn btn--link btn--inline" id="otp-copy">Copy</button>` +
          `</div>` +
          `<div class="muted login-gate__otp-meta">Expires in 5 minutes.</div>`;
        fields.otpHint.querySelector("#otp-copy")?.addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(res.code); toast("Code copied", "success"); }
          catch { toast("Copy failed — please select and copy manually", "info"); }
        });
      } else {
        // LIVE MODE — real Resend email sent. Hide the input-row
        // copy UI and just show a confirmation + a tip about the
        // spam folder. If the server told us the "From" address, show
        // it so the user knows exactly who the email came from (helps
        // spot it in the inbox, especially with the Resend sandbox).
        const from = res.from ? ` from <strong>${escapeHtml(res.from)}</strong>` : "";
        fields.otpHint.innerHTML =
          `<div class="login-gate__otp-banner login-gate__otp-banner--live">` +
            `<span class="login-gate__otp-pill login-gate__otp-pill--live" aria-label="Sent via email">` +
              `<span aria-hidden="true">✉</span> SENT` +
            `</span>` +
            `<span class="login-gate__otp-text">${escapeHtml(res.message || "OTP sent to your email.")}${from}</span>` +
          `</div>` +
          `<div class="muted login-gate__otp-meta">` +
            `Expires in 5 minutes. Tip: if you don't see it, check your spam folder.` +
          `</div>`;
      }
      // Countdown so the user knows when to re-send. The button stays
      // disabled during the cooldown so the rate-limit is enforced on
      // the client side as well — the server has its own check too.
      let seconds = 300;
      const updateCountdown = () => {
        if (seconds <= 0) {
          fields.sendOtpBtn.disabled = false;
          fields.sendOtpBtn.textContent = "Resend OTP";
          return;
        }
        fields.sendOtpBtn.disabled = true;
        fields.sendOtpBtn.textContent = `Resend in ${seconds--}s`;
      };
      updateCountdown();
      if (otpExpiryTimer) clearInterval(otpExpiryTimer);
      otpExpiryTimer = setInterval(updateCountdown, 1000);
      fields.signinOtp.focus();
    } catch (err) {
      setError(fields.signinIdErr, err.message || "Could not send OTP.");
      fields.sendOtpBtn.disabled = false;
      fields.sendOtpBtn.textContent = originalLabel;
    }
  });

  // --- Submit (the two sign-in buttons live outside the form, so we
  // bind them directly) -----------------------------------------------------
  fields.submitSignin.addEventListener("click", () => submitSignin());
  fields.submitOtp.addEventListener("click", () => submitSignin());
  $form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (activeTab === "signin") return submitSignin();
    return submitSignup();
  });

  // --- Forgot password ----------------------------------------------------
  // Opens the multi-step modal. Resolves with a success message when
  // the user completes the reset; rejects with Error("cancel") when
  // they dismiss it.
  fields.forgotLink.addEventListener("click", async () => {
    try {
      await mountForgotPassword(fields.signinId.value);
    } catch (err) {
      if (err?.message !== "cancel") toast(err.message || "Could not reset password.", "error");
    }
  });

  async function submitSignin() {
    const id = normalizeIdentifier(fields.signinId.value);
    setError(fields.signinIdErr, "");
    setError(fields.signinPwErr, "");
    setError(fields.signinOtpErr, "");

    if (!id) {
      setError(fields.signinIdErr, "Enter a valid email or 10-digit mobile number.");
      return;
    }

    const submitBtn = signinMode === "otp" ? fields.submitOtp : fields.submitSignin;
    const labelEl = submitBtn.querySelector(".login-gate__btn-label");
    const originalLabel = labelEl ? labelEl.textContent : submitBtn.textContent;
    submitBtn.disabled = true;
    if (labelEl) labelEl.textContent = "Signing in…";
    else submitBtn.textContent = "Signing in…";

    try {
      let res;
      if (signinMode === "otp") {
        const otp = (fields.signinOtp.value || "").trim();
        if (!/^[0-9]{4}$/.test(otp)) {
          setError(fields.signinOtpErr, "Enter the 4-digit code we sent.");
          return;
        }
        res = await Auth.verifyOtp(id.value, otp);
      } else {
        const password = fields.signinPw.value;
        if (!password || password.length < 8) {
          setError(fields.signinPwErr, "Enter your password.");
          return;
        }
        res = await Auth.signin({ identifier: id.value, password });
        onSignedIn(res.user, { vaultPassword: password });
        return;
      }
      // OTP sign-in: no password known, so the vault prompt (or recovery
      // phrase) will handle unlock after login.
      onSignedIn(res.user);
    } catch (err) {
      // Show the server's error message — it already distinguishes
      // "not registered" from "wrong password".
      const where =
        signinMode === "otp" ? fields.signinOtpErr : fields.signinPwErr;
      setError(where, err.message || "Sign in failed.");
    } finally {
      submitBtn.disabled = false;
      if (labelEl) labelEl.textContent = originalLabel;
      else submitBtn.textContent = originalLabel;
    }
  }

  async function submitSignup() {
    const id = normalizeIdentifier(fields.signupId.value);
    const pw = fields.signupPw.value;
    const pw2 = fields.signupPw2.value;

    setError(fields.signupIdErr, "");
    setError(fields.signupPwErr, "");
    setError(fields.signupPw2Err, "");

    let bad = false;
    if (!id) { setError(fields.signupIdErr, "Enter a valid email or 10-digit mobile number."); bad = true; }
    if (!pw || pw.length < 8) { setError(fields.signupPwErr, "Password must be at least 8 characters."); bad = true; }
    if (pw !== pw2) { setError(fields.signupPw2Err, "Passwords do not match."); bad = true; }
    if (bad) return;

    const submitBtn = root.querySelector("#auth-submit-signup");
    submitBtn.disabled = true;
    submitBtn.textContent = "Creating account…";
    try {
      const res = await Auth.signup({
        identifier: id.value,
        password: pw,
        confirmPassword: pw2,
      });
      onSignedIn(res.user, { justSignedUp: true, vaultPassword: pw });
    } catch (err) {
      setError(fields.signupIdErr, err.message || "Could not create account.");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Create account";
    }
  }

  function onSignedIn(user, { justSignedUp = false, vaultPassword = "" } = {}) {
    // Build a stable avatar data URL for the local cache so the
    // profile screen has something to show before /api/data loads.
    // Fresh sign-ups have no display name yet (the user can set one
    // later in Profile); fall back to the first letter of the email
    // (or the first digit of the phone) so the initials avatar still
    // shows something sensible.
    const fallbackName = user.displayName || user.email || user.phone || "U";
    const avatarDataUrl = generateAvatarDataUrl({
      name: fallbackName,
      phone: user.phone || user.email || "",
    });
    // Hand the user off to main.js — it owns the session state.
    root.remove();
    onComplete({
      user: {
        userId: user.userId,
        // If the user hasn't set a displayName yet, leave it empty
        // so the Profile view prompts them to add one.
        name: user.displayName || "",
        email: user.email,
        phone: user.phone || "",
        avatarDataUrl,
      },
      justSignedUp,
      vaultPassword,
    });
  }

  // Focus the first input on mount.
  queueMicrotask(() => fields.signinId.focus());

  // Escape blurs the focused field — same a11y pattern as before.
  root.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    const active = document.activeElement;
    if (active && typeof active.blur === "function" && active !== document.body) {
      active.blur();
      ev.preventDefault();
    }
  });
}

// ---------------------------------------------------------------------------
// Forgot password modal.
//
// Three steps rendered into a single modal body, swapped in place:
//   1. Identifier (email or phone) + [Send OTP]
//   2. 4-digit OTP + [Verify]
//   3. New password + [Reset password]
//
// The reset is gated by both the OTP and a server-issued resetToken
// (short-lived JWT) — see server/src/routes/auth.js for details.
//
// Resolves with a success message when the user successfully resets
// their password. Rejects with Error("cancel") when the user dismisses
// the modal (clicking the backdrop or hitting Escape).
//
// @param {string} [prefillIdentifier]
// @returns {Promise<string>}
async function mountForgotPassword(prefillIdentifier = "") {
  let currentStep = 1;
  let identifier = "";
  let resetToken = "";
  // Remembered across steps so the reset step can pass the same OTP
  // back to the server for the second verification.
  let verifiedCode = "";
  let otpExpiryTimer = null;

  function close(result) {
    if (otpExpiryTimer) clearInterval(otpExpiryTimer);
    if (result?.ok) {
      overlay.remove();
      resolve(result.message);
    } else {
      overlay.remove();
      reject(new Error("cancel"));
    }
  }

  let resolve, reject;
  const done = new Promise((res, rej) => { resolve = res; reject = rej; });

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal forgot-modal" role="dialog" aria-modal="true"
         aria-labelledby="forgot-title" tabindex="-1">
      <div class="modal__header">
        <h2 class="modal__title" id="forgot-title">Reset your password</h2>
        <button class="icon-btn" type="button" aria-label="Close" data-forgot-close>×</button>
      </div>
      <div class="modal__body" id="forgot-body"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector(".modal").focus();
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) close();
  });
  overlay.querySelector("[data-forgot-close]").addEventListener("click", () => close());
  document.addEventListener("keydown", function escListener(ev) {
    if (ev.key !== "Escape") return;
    document.removeEventListener("keydown", escListener);
    close();
  });

  function setError(id, msg) {
    const el = overlay.querySelector("#" + id);
    if (!el) return;
    if (msg) { el.textContent = msg; el.hidden = false; }
    else { el.textContent = ""; el.hidden = true; }
  }

  function renderStep1() {
    currentStep = 1;
    overlay.querySelector("#forgot-body").innerHTML = `
      <p class="muted" style="margin-top:0">
        Enter the email or mobile number on your account. We'll send a
        one-time code to verify it's really you.
      </p>
      <div class="field">
        <label class="field__label" for="forgot-id">Email or mobile number</label>
        <input class="field__input" type="text" id="forgot-id"
               value="${escapeHtml(prefillIdentifier)}"
               autocomplete="username"
               placeholder="you@example.com or 98XXXXXXXX"
               maxlength="80" />
        <div class="field__error" id="forgot-id-err" hidden></div>
      </div>
      <div class="modal__footer" style="padding:0;border:0;margin-top:var(--space-3)">
        <button class="btn" type="button" data-forgot-cancel>Cancel</button>
        <button class="btn btn--primary" type="button" id="forgot-send">Send OTP</button>
      </div>
    `;
    overlay.querySelector("[data-forgot-cancel]").addEventListener("click", () => close());
    overlay.querySelector("#forgot-send").addEventListener("click", onSend);
    overlay.querySelector("#forgot-id").focus();
  }

  async function onSend() {
    setError("forgot-id-err", "");
    const raw = overlay.querySelector("#forgot-id").value;
    const id = normalizeIdentifier(raw);
    if (!id) {
      setError("forgot-id-err", "Enter a valid email or 10-digit mobile number.");
      return;
    }
    const btn = overlay.querySelector("#forgot-send");
    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
      const res = await Auth.forgotSendOtp(id.value);
      identifier = id.value;
      if (res.delivered === "unsupported") {
        setError("forgot-id-err", res.message || "SMS reset isn't available yet.");
        return;
      }
      if (res.delivered === "demo" && res.code) {
        // Dev-mode fallback — remember the code for the next step's hint.
        renderStep2(res.code);
      } else {
        renderStep2(null, res.message);
      }
    } catch (err) {
      setError("forgot-id-err", err.message || "Could not send OTP.");
    } finally {
      btn.disabled = false;
      btn.textContent = "Send OTP";
    }
  }

  function renderStep2(devCode, message) {
    currentStep = 2;
    const hintHtml = devCode
      ? `Dev mode — your code is <strong id="forgot-otp-display">${escapeHtml(devCode)}</strong>
         <button type="button" class="btn btn--link btn--inline" id="forgot-otp-copy">Copy</button>
         <div class="muted" style="margin-top:4px">Expires in 5 minutes.</div>`
      : `<div>${escapeHtml(message || "OTP sent. Check your inbox.")}</div>
         <div class="muted" style="margin-top:4px">Expires in 5 minutes.</div>`;

    overlay.querySelector("#forgot-body").innerHTML = `
      <p class="muted" style="margin-top:0">
        Enter the 4-digit code we sent to <strong>${escapeHtml(identifier)}</strong>.
      </p>
      <div class="field">
        <label class="field__label" for="forgot-otp">4-digit OTP</label>
        <div class="login-gate__otp-row">
          <input class="field__input login-gate__otp-input" type="text"
                 id="forgot-otp" inputmode="numeric" pattern="[0-9]*"
                 autocomplete="one-time-code" placeholder="••••" maxlength="4" />
          <button class="btn btn--sm" type="button" id="forgot-resend">Resend OTP</button>
        </div>
        <div class="field__hint muted" id="forgot-otp-hint">${hintHtml}</div>
        <div class="field__error" id="forgot-otp-err" hidden></div>
      </div>
      <div class="modal__footer" style="padding:0;border:0;margin-top:var(--space-3)">
        <button class="btn" type="button" data-forgot-back>Back</button>
        <button class="btn btn--primary" type="button" id="forgot-verify">Verify</button>
      </div>
    `;
    if (devCode) {
      overlay.querySelector("#forgot-otp-copy")?.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(devCode); toast("Code copied", "success"); }
        catch { toast("Copy failed — please select and copy manually", "info"); }
      });
    }
    overlay.querySelector("[data-forgot-back]").addEventListener("click", renderStep1);
    overlay.querySelector("#forgot-verify").addEventListener("click", onVerify);
    overlay.querySelector("#forgot-resend").addEventListener("click", async () => {
      try { await Auth.forgotSendOtp(identifier); toast("OTP re-sent.", "info"); }
      catch (err) { toast(err.message || "Could not resend.", "error"); }
    });
    overlay.querySelector("#forgot-otp").focus();
  }

  async function onVerify() {
    setError("forgot-otp-err", "");
    const code = (overlay.querySelector("#forgot-otp").value || "").trim();
    if (!/^[0-9]{4}$/.test(code)) {
      setError("forgot-otp-err", "Enter the 4-digit code we sent.");
      return;
    }
    const btn = overlay.querySelector("#forgot-verify");
    btn.disabled = true;
    btn.textContent = "Verifying…";
    try {
      const res = await Auth.forgotVerify(identifier, code);
      resetToken = res.resetToken;
      verifiedCode = code;
      renderStep3();
    } catch (err) {
      setError("forgot-otp-err", err.message || "OTP verification failed.");
    } finally {
      btn.disabled = false;
      btn.textContent = "Verify";
    }
  }

  function renderStep3() {
    currentStep = 3;
    overlay.querySelector("#forgot-body").innerHTML = `
      <p class="muted" style="margin-top:0">
        Code verified. Pick a new password for your account.
      </p>
      <div class="field">
        <label class="field__label" for="forgot-pw">New password</label>
        <input class="field__input" type="password" id="forgot-pw"
               autocomplete="new-password"
               placeholder="At least 8 characters" minlength="8" />
        <div class="field__error" id="forgot-pw-err" hidden></div>
      </div>
      <div class="field">
        <label class="field__label" for="forgot-pw-2">Confirm new password</label>
        <input class="field__input" type="password" id="forgot-pw-2"
               autocomplete="new-password"
               placeholder="Type the password again" minlength="8" />
        <div class="field__error" id="forgot-pw-2-err" hidden></div>
      </div>
      <div class="modal__footer" style="padding:0;border:0;margin-top:var(--space-3)">
        <button class="btn" type="button" data-forgot-back>Back</button>
        <button class="btn btn--primary" type="button" id="forgot-reset">Reset password</button>
      </div>
    `;
    overlay.querySelector("[data-forgot-back]").addEventListener("click", renderStep2);
    overlay.querySelector("#forgot-reset").addEventListener("click", onReset);
    enhancePasswordInputs(overlay);
    overlay.querySelector("#forgot-pw").focus();
  }

  async function onReset() {
    setError("forgot-pw-err", "");
    setError("forgot-pw-2-err", "");
    const pw = overlay.querySelector("#forgot-pw").value;
    const pw2 = overlay.querySelector("#forgot-pw-2").value;
    let bad = false;
    if (!pw || pw.length < 8) { setError("forgot-pw-err", "Password must be at least 8 characters."); bad = true; }
    if (pw !== pw2)            { setError("forgot-pw-2-err", "Passwords do not match."); bad = true; }
    if (bad) return;

    if (!verifiedCode) {
      setError("forgot-pw-err", "Session expired. Please start the reset again.");
      return;
    }

    const btn = overlay.querySelector("#forgot-reset");
    btn.disabled = true;
    btn.textContent = "Resetting…";
    try {
      const res = await Auth.forgotReset(identifier, verifiedCode, resetToken, pw);
      toast(res.message || "Password updated.", "success");
      close({ ok: true, message: res.message || "Password updated. You can sign in now." });
    } catch (err) {
      setError("forgot-pw-err", err.message || "Could not reset password.");
    } finally {
      btn.disabled = false;
      btn.textContent = "Reset password";
    }
  }

  renderStep1();
  return done;
}
