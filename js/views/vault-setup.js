// First-time vault setup — shown right after signup so the new user
// can choose a master password and (optionally) generate a recovery
// phrase. The flow creates the master key, wraps it with the
// password (and phrase if the user opts in), uploads the wraps to
// the server, then proceeds to the unlock screen for first decrypt.
//
// Without this step the user would sign up, see an empty vault, and
// have no way to recover their data if they ever need to sign in
// from a new device.

import { Crypto, Data } from "../api.js";
import { newMasterKey } from "../crypto/sodium.mjs";
import { wrapWithPassword, wrapWithPhrase } from "../crypto/keystore.mjs";
import { generatePhrase } from "../crypto/recovery.mjs";
import { setMasterKey } from "../crypto/unlock-gate.mjs";
import { encryptVault } from "../crypto/vault.mjs";
import { Store, migrate as migrateState } from "../store.js";
import { escapeHtml } from "../util.js";
import { toast } from "../components/toast.js";
import { enhancePasswordInputs } from "../components/pw-toggle.js";

export async function mountVaultSetup({ onComplete, profile }) {
  const root = document.createElement("div");
  root.className = "login-gate";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "setup-title");

  root.innerHTML = `
    <div class="login-gate__card">
      <h1 class="login-gate__title" id="setup-title">Set up your vault</h1>
      <p class="login-gate__subtitle">
        Your data is end-to-end encrypted. Pick a master password — you'll need it
        to unlock on any new device.
      </p>

      <form class="login-gate__form" id="setup-form" novalidate>
        <div class="field">
          <label class="field__label" for="setup-pw1">Master password</label>
          <input class="field__input" type="password" id="setup-pw1" name="pw1"
                 autocomplete="new-password" minlength="8" required
                 placeholder="At least 8 characters" />
          <div class="field__hint muted">
            This password is never sent to the server. We use it to wrap a master
            key that encrypts every byte of your data.
          </div>
          <div class="field__error" id="setup-pw1-err" hidden></div>
        </div>

        <div class="field">
          <label class="field__label" for="setup-pw2">Confirm password</label>
          <input class="field__input" type="password" id="setup-pw2" name="pw2"
                 autocomplete="new-password" minlength="8" required
                 placeholder="Type the password again" />
          <div class="field__error" id="setup-pw2-err" hidden></div>
        </div>

        <div class="field">
          <label class="field__label" style="display:flex;gap:8px;align-items:center;">
            <input type="checkbox" id="setup-phrase-check" />
            <span>Generate a recovery phrase (recommended)</span>
          </label>
          <div class="field__hint muted">
            27 words (24 payload + 3 checksum) that can unlock your vault if you forget the password.
            Write them down — anyone with the phrase can read your data.
          </div>
        </div>

        <div id="setup-phrase-display" hidden>
          <div class="field">
            <label class="field__label">Your recovery phrase</label>
            <div class="recovery-phrase" id="setup-phrase-words"></div>
            <div class="recovery-phrase__actions">
              <button class="btn btn--sm" type="button" id="setup-phrase-copy" aria-label="Copy recovery phrase to clipboard">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                <span>Copy</span>
              </button>
              <button class="btn btn--sm" type="button" id="setup-phrase-download" aria-label="Download recovery phrase as text file">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                <span>Download</span>
              </button>
            </div>
            <div class="field__hint muted" style="display:flex;gap:8px;align-items:center;margin-top:8px;">
              <label style="display:flex;gap:6px;align-items:center;font-size:13px;">
                <input type="checkbox" id="setup-phrase-confirm" />
                <span>I have written these words down somewhere safe.</span>
              </label>
            </div>
          </div>
        </div>

        <button class="btn btn--primary btn--block" type="submit" id="setup-submit">
          <span class="login-gate__btn-label">Create encrypted vault</span>
        </button>
      </form>

      <div class="login-gate__legal">
        By continuing you understand that losing both your password and your recovery
        phrase means your data cannot be recovered — not even by XPENSIC staff.
      </div>
    </div>
  `;

  // Mount into the page. We append the dialog to the body so it
  // floats above the app shell (which lives in <main>). We do NOT
  // wipe <main> — the shell underneath stays mounted so that once
  // the vault is set up we don't have to re-create the banner,
  // sidebar, and view container.
  document.body.classList.add("app-locked");
  document.body.appendChild(root);

  // Eye toggles for the master-password + confirm fields.
  enhancePasswordInputs(root);

  // State for the generated phrase. We hold it in a closure so it's
  // never written to the DOM until the user reveals it, and so we
  // can re-render the same phrase if the user toggles the checkbox.
  let phraseWords = null;
  const $phraseCheck = root.querySelector("#setup-phrase-check");
  const $phraseDisplay = root.querySelector("#setup-phrase-display");
  const $phraseWords = root.querySelector("#setup-phrase-words");
  const $phraseConfirm = root.querySelector("#setup-phrase-confirm");
  const $phraseCopy = root.querySelector("#setup-phrase-copy");
  const $phraseDownload = root.querySelector("#setup-phrase-download");
  $phraseCheck.addEventListener("change", async () => {
    if ($phraseCheck.checked) {
      if (!phraseWords) phraseWords = await generatePhrase();
      $phraseWords.innerHTML = phraseWords.map((w, i) =>
        `<span class="recovery-phrase__word"><span class="recovery-phrase__idx">${i + 1}</span>${escapeHtml(w)}</span>`
      ).join("");
      $phraseDisplay.hidden = false;
    } else {
      $phraseDisplay.hidden = true;
      $phraseConfirm.checked = false;
    }
  });

  // Copy the recovery phrase to the clipboard. We rebuild the
  // space-separated string from the closure (not the DOM) so the
  // copy is always the canonical phrase, even if the user has
  // selected a different locale or the DOM was tampered with.
  $phraseCopy.addEventListener("click", async () => {
    if (!phraseWords) return;
    const text = phraseWords.join(" ");
    try {
      await navigator.clipboard.writeText(text);
      toast("Recovery phrase copied to clipboard", "success");
    } catch {
      // Fallback for browsers that block the async clipboard API
      // (e.g. insecure contexts). Use a hidden textarea + execCommand.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        toast("Recovery phrase copied to clipboard", "success");
      } catch {
        toast("Copy failed — please select the words and copy manually", "info");
      } finally {
        ta.remove();
      }
    }
  });

  // Download the recovery phrase as a plain-text file. The file
  // includes a header with the date and a warning so anyone who
  // finds it later understands what it is and how sensitive it is.
  $phraseDownload.addEventListener("click", () => {
    if (!phraseWords) return;
    const text = [
      "XPENSIC — Recovery Phrase",
      `Generated: ${new Date().toISOString()}`,
      "",
      "Anyone with these 27 words can read your encrypted data.",
      "Store this file somewhere only you can access.",
      "",
      phraseWords.join(" "),
      "",
    ].join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `xpensic-recovery-phrase-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke the object URL on the next tick so the browser has
    // time to start the download before we free the blob.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    toast("Recovery phrase downloaded", "success");
  });

  function setError($el, msg) {
    if (!$el) return;
    $el.textContent = msg;
    $el.hidden = !msg;
  }

  root.querySelector("#setup-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const pw1 = root.querySelector("#setup-pw1").value;
    const pw2 = root.querySelector("#setup-pw2").value;
    setError(root.querySelector("#setup-pw1-err"), "");
    setError(root.querySelector("#setup-pw2-err"), "");
    if (pw1.length < 8) { setError(root.querySelector("#setup-pw1-err"), "Password must be at least 8 characters."); return; }
    if (pw1 !== pw2) { setError(root.querySelector("#setup-pw2-err"), "Passwords do not match."); return; }
    if ($phraseCheck.checked && !$phraseConfirm.checked) {
      toast("Please confirm you've saved the recovery phrase before continuing.", "error");
      return;
    }
    // 1. Generate the master key.
    const mk = await newMasterKey();
    // 2. Build the wraps (password, optionally phrase).
    const wraps = [];
    try { wraps.push(await wrapWithPassword(mk, pw1)); } catch (e) { toast("Could not wrap with password: " + e.message, "error"); return; }
    if ($phraseCheck.checked) {
      try { wraps.push(await wrapWithPhrase(mk, phraseWords)); }
      catch (e) { toast("Could not wrap with phrase: " + e.message, "error"); return; }
    }
    // 3. Push the wraps to the server.
    try { await Crypto.putMasterKey(wraps); }
    catch (e) { toast("Could not save your vault setup: " + e.message, "error"); return; }
    // 4. Set the in-memory MK and write the initial vault so the
    //    server has something to give us on the next boot.
    setMasterKey(mk);
    // Build the seed for the new vault. If the user already has
    // per-table data on the server (this can happen if they signed
    // up before E2EE was rolled out, or if they're re-keying after
    // losing a wrap), pull that data first so the new vault doesn't
    // start out empty. Otherwise fresh-state the seed.
    let seed = null;
    try {
      const res = await Data.get();
      const existing = (res && res.data) || {};
      // Heuristic: if the server returns a blob with at least one
      // expense, category, budget, or split, treat the user as having
      // existing data. The empty default blob (just version + settings)
      // is always safe to overwrite with a fresh seed.
      const hasData =
        (existing.expenses && existing.expenses.length > 0) ||
        (existing.categories && existing.categories.length > 0) ||
        (existing.budgets && existing.budgets.monthly && Object.keys(existing.budgets.monthly).length > 0) ||
        (existing.splits && existing.splits.length > 0);
      if (hasData) {
        // Normalise the server blob to the same shape the client uses,
        // then drop the version field so Store doesn't re-migrate it.
        const normalised = migrateState({ ...existing, version: 6 });
        seed = normalised;
      }
    } catch (e) {
      // Server unreachable, schema change, etc. — fall back to a
      // fresh seed. The per-resource sync after mount will pull
      // data back if the server has it.
      console.warn("[vault-setup] could not fetch existing data:", e?.message || e);
    }
    if (!seed) seed = { ...Store.reset() };
    // Adopt the signed-in user identity.
    if (profile) {
      seed.profile = {
        userId: profile.userId || "",
        name: profile.name || "",
        phone: profile.phone || "",
        avatarDataUrl: profile.avatarDataUrl || "",
      };
    }
    try { await Crypto.putVault(await encryptVault(mk, seed)); }
    catch (e) { toast("Could not encrypt initial vault: " + e.message, "error"); return; }
    // 5. Hand control back. The app will treat the seed as the
    //    initial state and the user is "unlocked" from here on.
    root.remove();
    onComplete && onComplete(seed);
  });
}