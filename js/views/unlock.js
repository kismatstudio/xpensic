// Unlock screen — shown after sign-in when the vault is still locked.
// The user has a few ways to unlock:
//
//   1. Password — unwrap a "password"-type wrap on the master key.
//   2. Recovery phrase — unwrap a "phrase"-type wrap. Used when the
//      user has forgotten their password AND has no other devices.
//   3. Pair a new device — shown after a successful QR pairing flow.
//
// The view itself is a simple form; the heavy lifting lives in the
// keystore + unlock-gate modules.

import { Crypto } from "../api.js";
import { unwrapWithPassword, unwrapWithPhrase } from "../crypto/keystore.mjs";
import { stringToPhrase } from "../crypto/recovery.mjs";
import { setMasterKey } from "../crypto/unlock-gate.mjs";
import { loadVault } from "../crypto/vault-sync.mjs";
import { escapeHtml } from "../util.js";
import { toast } from "../components/toast.js";
import { enhancePasswordInputs } from "../components/pw-toggle.js";
import { Store } from "../store.js";

export async function mountUnlock({ onUnlocked, profile }) {
  // Build the unlock card. The user enters their password (or
  // toggles to the recovery-phrase flow) and we attempt to unwrap
  // a master key from one of their server-stored wraps.
  const root = document.createElement("div");
  root.className = "login-gate";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "unlock-title");

  // Pull the current wraps so we know which wrapTypes to offer.
  // We render the password prompt by default; the phrase prompt is
  // a secondary tab for users who can't remember their password.
  let wraps = [];
  try {
    // Crypto.getMasterKey normalises the server response into an
    // array of { wrapType, envelope, createdAt } objects. We treat
    // the return value directly as the array of wraps.
    const res = await Crypto.getMasterKey();
    wraps = Array.isArray(res) ? res : [];
  } catch { /* server may not yet ship the endpoint — fall through */ }

  const hasPasswordWrap = wraps.some((w) => w.wrapType === "password");
  const hasPhraseWrap   = wraps.some((w) => w.wrapType === "phrase");

  root.innerHTML = `
    <style>
      .unlock-card{background:#f4f6fb;border-radius:24px;padding:32px 28px;max-width:420px;margin:auto;box-shadow:0 10px 40px rgba(0,0,0,.08);font-family:system-ui,sans-serif;color:#1a2332;}
      .unlock-card h1{font-size:1.7rem;font-weight:800;margin:0 0 6px;letter-spacing:-.02em;}
      .unlock-card .sub{color:#6b7280;margin:0 0 22px;font-size:.95rem;line-height:1.35;}
      .pill-tabs{display:flex;gap:8px;background:#e8ecf1;padding:4px;border-radius:999px;margin-bottom:22px;}
      .pill-tab{flex:1;border:none;background:transparent;padding:10px 0;border-radius:999px;font-weight:600;color:#6b7280;cursor:pointer;font-size:.95rem;transition:.2s;}
      .pill-tab.is-active{background:#7c6cf5;color:#fff;box-shadow:0 2px 8px rgba(124,108,245,.35);}
      .field__label{font-weight:600;font-size:.85rem;color:#374151;margin-bottom:6px;display:block;}
      .field__input{width:100%;padding:14px 16px;border:1.5px solid #dde2e8;border-radius:14px;font-size:1rem;background:#fff;color:#111;outline:none;box-sizing:border-box;}
      .field__hint{font-size:.82rem;color:#6b7280;margin-top:6px;}
      .btn--primary{width:100%;padding:14px;border:none;border-radius:14px;background:#7c6cf5;color:#fff;font-weight:700;font-size:1.05rem;cursor:pointer;margin-top:14px;box-shadow:0 4px 14px rgba(124,108,245,.3);}
      .legal{font-size:.82rem;color:#6b7280;margin-top:18px;line-height:1.35;text-align:center;}
    </style>
    <div class="unlock-card">
      <h1 id="unlock-title"><span style="font-size:40px;vertical-align:middle;margin-right:2px;margin-left:20px;">🛡️</span>Unlock your VAULT</h1>
      <p class="sub">Welcome back${profile?.name ? `, ${escapeHtml(profile.name)}` : ""}. Enter your password to decrypt your data.</p>
      <div class="pill-tabs" role="tablist" aria-label="Unlock method">
        <button class="pill-tab is-active" type="button" role="tab" id="unlock-tab-pw" aria-selected="true" aria-controls="unlock-panel-pw">Password</button>
        <button class="pill-tab" type="button" role="tab" id="unlock-tab-phrase" aria-selected="false" aria-controls="unlock-panel-phrase" tabindex="-1">Recovery phrase</button>
      </div>

      <form class="login-gate__form" id="unlock-form" novalidate>
        <div role="tabpanel" id="unlock-panel-pw" aria-labelledby="unlock-tab-pw">
          <div class="field">
            <label class="field__label" for="unlock-pw">Master password</label>
            <input class="field__input" type="password" id="unlock-pw" name="password"
                   autocomplete="current-password" placeholder="Your master password" minlength="8" required />
            <div class="field__hint muted">
              The same password you used when you first created your vault.
            </div>
            <div class="field__error" id="unlock-pw-err" hidden></div>
          </div>
          <button class="btn btn--primary btn--block" type="submit" id="unlock-pw-submit">
            <span class="login-gate__btn-label">Unlock vault</span>
          </button>
        </div>

        <div role="tabpanel" id="unlock-panel-phrase" aria-labelledby="unlock-tab-phrase" hidden>
          <div class="field">
            <label class="field__label" for="unlock-phrase">Recovery phrase</label>
            <textarea class="field__input" id="unlock-phrase" name="phrase" rows="3"
                      placeholder="word1 word2 word3 …" autocomplete="off"></textarea>
            <div class="field__hint muted">
              27 words from the recovery phrase you wrote down at signup.
            </div>
            <div class="field__error" id="unlock-phrase-err" hidden></div>
          </div>
          <button class="btn btn--primary btn--block" type="submit" id="unlock-phrase-submit">
            <span class="login-gate__btn-label">Unlock with phrase</span>
          </button>
        </div>
      </form>

      <div class="login-gate__legal">
        Forgot your password AND lost your recovery phrase? Sign out and re-create the account —
        previous data is unrecoverable without one of these two factors.
      </div>
    </div>
  `;

  // Wire tabs.
  const tabPw = root.querySelector("#unlock-tab-pw");
  const tabPhrase = root.querySelector("#unlock-tab-phrase");
  const panelPw = root.querySelector("#unlock-panel-pw");
  const panelPhrase = root.querySelector("#unlock-panel-phrase");
  function showPw() {
    tabPw.classList.add("is-active"); tabPw.setAttribute("aria-selected", "true"); tabPw.tabIndex = 0;
    tabPhrase.classList.remove("is-active"); tabPhrase.setAttribute("aria-selected", "false"); tabPhrase.tabIndex = -1;
    panelPw.hidden = false; panelPhrase.hidden = true;
  }
  function showPhrase() {
    tabPhrase.classList.add("is-active"); tabPhrase.setAttribute("aria-selected", "true"); tabPhrase.tabIndex = 0;
    tabPw.classList.remove("is-active"); tabPw.setAttribute("aria-selected", "false"); tabPw.tabIndex = -1;
    panelPhrase.hidden = false; panelPw.hidden = true;
  }
  tabPw.addEventListener("click", showPw);
  tabPhrase.addEventListener("click", showPhrase);

  // Mount into the page. We append the dialog to the body so it
  // floats above the app shell. We do NOT wipe <main> — the shell
  // underneath stays mounted so that once we successfully unwrap
  // the MK we can hand off to mountAppShell() without re-creating
  // the banner, sidebar, and view container.
  document.body.classList.add("app-locked");
  document.body.appendChild(root);

  // Eye toggle for the master-password field.
  enhancePasswordInputs(root);

  // Submit handlers. The "active" panel decides which unwrap path runs.
  const $pwErr = root.querySelector("#unlock-pw-err");
  const $phraseErr = root.querySelector("#unlock-phrase-err");
  function setError($el, msg) {
    if (!$el) return;
    $el.textContent = msg;
    $el.hidden = !msg;
  }
  async function doPasswordUnlock(pw) {
    const wrap = wraps.find((w) => w.wrapType === "password");
    if (!wrap || !wrap.envelope) {
      setError($pwErr, "No password wrap on this account. Use the recovery phrase or sign out to recreate the vault.");
      return;
    }
    let mk;
    try { mk = await unwrapWithPassword(wrap.envelope, pw); }
    catch { setError($pwErr, "Wrong password — or the vault has been re-keyed. Try again, or use the recovery phrase."); return; }
    setMasterKey(mk);
    await finishUnlock();
  }
  async function doPhraseUnlock(phrase) {
    const wrap = wraps.find((w) => w.wrapType === "phrase");
    if (!wrap || !wrap.envelope) {
      setError($phraseErr, "No recovery phrase wrap on this account. Use the password tab.");
      return;
    }
    let mk;
    try { mk = await unwrapWithPhrase(wrap.envelope, stringToPhrase(phrase)); }
    catch (e) { setError($phraseErr, e.message || "Invalid phrase."); return; }
    setMasterKey(mk);
    await finishUnlock();
  }
  async function finishUnlock() {
    let state = null;
    try { state = await loadVault({ userId: profile?.userId || "" }); }
    catch (e) { console.warn("[unlock] vault load failed", e); }
    if (!state) {
      // Fresh account — seed an empty v6 state.
      state = { ...Store.reset() };
    }
    // Hand control back to main.js with the decrypted state.
    root.remove();
    onUnlocked && onUnlocked(state);
  }

  root.querySelector("#unlock-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (panelPw.hidden) {
      await doPhraseUnlock(root.querySelector("#unlock-phrase").value);
    } else {
      await doPasswordUnlock(root.querySelector("#unlock-pw").value);
    }
  });
}
