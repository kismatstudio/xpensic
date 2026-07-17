// Auth gate — full-screen welcome that blocks the rest of the app until the
// user has a profile. Supports two flows:
//   1. **Sign in**   — look up an existing profile by phone (no password, no
//                       verification — this is a single-device local app, so
//                       "knowing the 10-digit number" is the credential).
//   2. **Sign up**   — create a brand-new profile with a generated `userId`,
//                       register it in the device-local profile registry, and
//                       activate it.
//
// We render directly into the document body (not into #view) so the user
// can't see the app shell behind it. A modal-style backdrop is enough.

import {
  validateIndianPhone,
  formatIndianPhone,
  generateAvatarDataUrl,
  escapeHtml,
} from "../util.js";
import { Store } from "../store.js";
import { newId } from "../ids.js";
import { toast } from "../components/toast.js";

/**
 * Mounts the auth screen.
 * @param {{ state: any, onComplete: () => void }} ctx
 */
export function mountLogin({ state, onComplete }) {
  // Bail out if a profile already exists (e.g. user navigated via DevTools).
  if (state.profile && state.profile.userId && state.profile.phone) {
    onComplete();
    return;
  }

  // Build the full-screen container.
  const root = document.createElement("div");
  root.className = "login-gate";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "login-gate-title");
  root.innerHTML = `
    <div class="login-gate__card">
      <div class="login-gate__brand" aria-hidden="true">₹</div>
      <h1 class="login-gate__title" id="login-gate-title">Welcome to Expense Tracker</h1>
      <p class="login-gate__subtitle" id="login-gate-subtitle">
        Sign in with your name and 10-digit mobile number to continue.
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
        <div class="field" id="auth-panel-signin" role="tabpanel" aria-labelledby="tab-signin">
          <div class="field">
            <label class="field__label" for="auth-name">Your name</label>
            <input
              class="field__input"
              type="text"
              id="auth-name"
              name="name"
              autocomplete="name"
              placeholder="Your name"
              maxlength="60"
              required
            />
            <div class="field__error" id="auth-name-error" hidden></div>
          </div>

          <div class="field">
            <label class="field__label" for="auth-phone">Mobile number</label>
            <div class="login-gate__phone-wrap">
              <span class="login-gate__phone-prefix" aria-hidden="true">+91</span>
              <input
                class="field__input login-gate__phone-input"
                type="tel"
                id="auth-phone"
                name="phone"
                inputmode="numeric"
                autocomplete="tel-national"
                pattern="[0-9]*"
                placeholder="98XXX XXXXX"
                maxlength="14"
                required
              />
            </div>
            <div class="field__hint muted" id="auth-phone-hint">
              Always 10 digits. We'll use this to identify you on this device.
            </div>
            <div class="field__error" id="auth-phone-error" hidden></div>
          </div>
        </div>

        <button class="btn btn--primary btn--block" type="submit" id="auth-submit">
          Sign in
        </button>
      </form>

      <p class="login-gate__legal muted">
        Stored only in this browser. No SMS, no account, no tracking.
      </p>
    </div>
  `;
  document.body.appendChild(root);

  // --- Helpers ------------------------------------------------------------
  const $form = root.querySelector("#auth-form");
  const $name = root.querySelector("#auth-name");
  const $phone = root.querySelector("#auth-phone");
  const $nameErr = root.querySelector("#auth-name-error");
  const $phoneErr = root.querySelector("#auth-phone-error");
  const $phoneHint = root.querySelector("#auth-phone-hint");
  const $submit = root.querySelector("#auth-submit");
  const $subtitle = root.querySelector("#login-gate-subtitle");
  const $tabSignin = root.querySelector("#tab-signin");
  const $tabSignup = root.querySelector("#tab-signup");

  // Track the active tab in a small variable so submit/UI can branch on it.
  // "signin" — look up an existing profile by phone.
  // "signup" — create a new profile and register it.
  let activeTab = "signin";

  function setNameError(msg) {
    if (msg) {
      $nameErr.textContent = msg;
      $nameErr.hidden = false;
      $name.setAttribute("aria-invalid", "true");
    } else {
      $nameErr.textContent = "";
      $nameErr.hidden = true;
      $name.removeAttribute("aria-invalid");
    }
  }
  function setPhoneError(msg) {
    if (msg) {
      $phoneErr.textContent = msg;
      $phoneErr.hidden = false;
      $phone.setAttribute("aria-invalid", "true");
    } else {
      $phoneErr.textContent = "";
      $phoneErr.hidden = true;
      $phone.removeAttribute("aria-invalid");
    }
  }

  // Clear an error as soon as the user starts editing the field.
  $name.addEventListener("input", () => setNameError(""));
  $phone.addEventListener("input", () => {
    setPhoneError("");
    // Keep only digits in the input; lets the user type freely but strips
    // the country code / dashes so the visual is clean.
    const digits = $phone.value.replace(/\D/g, "").slice(-10);
    $phone.value = digits;
  });

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

    $submit.textContent = isSignin ? "Sign in" : "Create account";
    $subtitle.textContent = isSignin
      ? "Sign in with your name and 10-digit mobile number to continue."
      : "Create a profile — no email, no password, no verification.";

    if (isSignin) {
      $phoneHint.textContent = "Always 10 digits. We'll use this to identify you on this device.";
    } else {
      $phoneHint.textContent = "Pick a 10-digit Indian mobile number. This stays on this device only.";
    }
    setNameError("");
    setPhoneError("");
  }

  $tabSignin.addEventListener("click", () => activateTab("signin"));
  $tabSignup.addEventListener("click", () => activateTab("signup"));

  // Arrow-key navigation between tabs (standard tablist pattern).
  root.querySelector(".login-gate__tabs").addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    ev.preventDefault();
    activateTab(activeTab === "signin" ? "signup" : "signin");
    if (activeTab === "signin") $tabSignin.focus();
    else $tabSignup.focus();
  });

  // Focus the name field on mount (a small detail, but the difference
  // between "feels broken" and "feels alive").
  queueMicrotask(() => $name.focus());

  // Escape blurs the focused field (since the gate has nothing to dismiss
  // to, we don't close it on Escape — but we do let users quickly exit
  // a field if they hit Escape while typing). This is the standard
  // a11y behavior for modal dialogs that have no other close affordance.
  root.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    const active = document.activeElement;
    if (active && typeof active.blur === "function" && active !== document.body) {
      active.blur();
      ev.preventDefault();
    }
  });

  // --- Submit -------------------------------------------------------------
  $form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const name = $name.value.trim();
    const phoneResult = validateIndianPhone($phone.value);

    let hasError = false;
    if (!name) { setNameError("Please enter your name."); hasError = true; }
    if (!phoneResult.ok) { setPhoneError(phoneResult.error); hasError = true; }
    if (hasError) return;

    const phone = phoneResult.value;

    if (activeTab === "signin") {
      // Sign in: look up the phone in the registry. If we have a match,
      // adopt that profile (preserve its userId/avatar) and restore the
      // profile's per-user data (expenses, budgets, custom categories) so
      // the user sees only their own data.
      const existing = Store.findProfileByPhone(state, phone);
      if (!existing) {
        setPhoneError("No account found for this number. Try Sign up to create one.");
        return;
      }
      Store.updateProfile(state, {
        userId: existing.userId,
        name: existing.name || name,
        phone: existing.phone,
        avatarDataUrl: existing.avatarDataUrl,
      });
      Store.restorePerUserData(state, existing.userId);
      const saved = Store.save(state);
      if (!saved.ok) {
        toast("Could not save: " + (saved.error || "unknown error"), "error");
        return;
      }
      toast(`Welcome back, ${existing.name || name}!`, "success");
      root.remove();
      onComplete();
      return;
    }

    // Sign up: create a fresh userId, register the profile, initialize
    // its per-user data (empty by default — except for the very first
    // sign-up on a previously-unauthed device, where we adopt whatever
    // was in the top-level slots so the user's history isn't lost), and
    // activate the profile.
    const userId = newId("user");
    const avatarDataUrl = generateAvatarDataUrl({ name, phone });
    Store.updateProfile(state, { userId, name, phone, avatarDataUrl });
    Store.registerProfile(state, { userId, name, phone, avatarDataUrl });
    // adoptFrom: true on the first sign-up after a device migration
    // (i.e. when the top-level slots actually have data we want to
    // keep); false on every subsequent sign-up so a brand-new account
    // starts empty.
    const hasTopLevelData =
      (state.expenses && state.expenses.length > 0) ||
      (state.budgets && state.budgets.monthly && Object.keys(state.budgets.monthly).length > 0);
    Store.initPerUserData(state, userId, { adoptFrom: hasTopLevelData });
    Store.restorePerUserData(state, userId);
    const saved = Store.save(state);
    if (!saved.ok) {
      toast("Could not save: " + (saved.error || "unknown error"), "error");
      return;
    }
    toast(`Welcome, ${name}!`, "success");
    root.remove();
    onComplete();
  });
}
