// Expense form — used by both Add and Edit flows.
// Returns a DOM <form> element. The caller mounts it inside a modal and
// listens for the modal's primary action to read the form values.

import {
  validateAmount,
  validateDate,
  validateCategoryId,
  validateNote,
  validateTime,
  validatePaymentMethod,
  validateUpiApp,
} from "../validators.js?v=31";
import {
  todayISO,
  currentTimeHHMM,
  escapeHtml,
  PAYMENT_METHODS,
  UPI_APPS,
} from "../util.js?v=31";
import { classifyText } from "../categorize.js?v=31";
import { isSupported as voiceSupported, startListening } from "../voice.js?v=31";
import { symbolForSettings } from "../format.js?v=31";
import {
  readReceiptFile, isEmptyScan, buildScanSummary, resolveCategoryId,
} from "../receipt-scan.js?v=31";

/**
 * @param {object} ctx
 * @param {Array}  ctx.categories  — all categories from the store
 * @param {object} [ctx.expense]   — when provided, the form starts in edit mode
 * @param {object} [ctx.settings]  — settings, used for currency-aware labels
 * @returns {HTMLFormElement}
 */
export function buildExpenseForm({ categories, expense, settings, expenses }) {
  const isEdit = Boolean(expense);
  // The category follows what the user types / says / scans until they pick
  // one themselves. Editing an existing expense never auto-changes it.
  let categoryTouched = isEdit;

  // Build a <form> imperatively so we can attach clean change/input handlers
  // and clear validation errors as the user types.
  const form = document.createElement("form");
  form.className = "expense-form";
  form.noValidate = true; // we run our own validators on submit
  form.setAttribute("aria-label", isEdit ? "Edit expense" : "Add expense");

  // --- Amount -------------------------------------------------------------
  // Default: empty for new entries, the existing value when editing.
  const amountGroup = fieldGroup("Amount", "amount", "number", {
    min: "0",
    step: "0.01",
    inputmode: "decimal",
    required: true,
    value: expense ? String(expense.amount) : "",
    placeholder: "0.00",
    autocomplete: "off",
  });
  form.appendChild(amountGroup.root);

    // Tracks whether the user typed a non-numeric character into the
      // amount field. <input type="number"> swallows those keystrokes, so
      // the value stays empty — but we still need to tell the user their
      // input was rejected when they hit Add.
      let amountHadInvalidChars = false;

      // Live guard: <input type="number"> silently swallows non-numeric
      // keystrokes, so the user gets no feedback when they type letters.
      // `beforeinput` fires before the edit is applied — if the incoming
      // text contains anything that isn't a digit, decimal point, or minus
      // sign, surface the error immediately instead of letting it vanish.
      amountGroup.input.addEventListener("beforeinput", (e) => {
        const incoming = e.data || "";
        if (!incoming) return; // deletions / formatting edits are fine
        if (/[^0-9.,-]/.test(incoming)) {
          amountHadInvalidChars = true;
          setFieldError("amount", "Characters are not allowed in amount field");
        }
      });

      // Clear the invalid-chars flag as soon as the user types a valid
      // character or clears the field, so a later submit reports the
      // correct error ("required" for empty, not "characters not allowed").
      amountGroup.input.addEventListener("input", () => {
        amountHadInvalidChars = false;
      });

      // The spinner is hidden via CSS, but the mouse wheel would still
      // increment/decrement the value. Block wheel events on the amount
      // field so scrolling over it never changes the number — the user
      // must type the amount by hand.
      amountGroup.input.addEventListener("wheel", (e) => {
        e.preventDefault();
      }, { passive: false });

  // --- Speak Expense (top-right corner) -----------------------------------
  // Rendered as a small floating button in the top-right of the form so it
  // stays visible regardless of the order of fields below. Hidden on
  // browsers without the Web Speech API so it never shows a broken button.
  if (voiceSupported()) {
    const voiceWrap = document.createElement("div");
    voiceWrap.className = "voice-entry voice-entry--top-right";
    voiceWrap.innerHTML = `
      <button type="button" class="btn voice-entry__btn" id="voice-mic"
              aria-label="Voice expense entry">
        <span aria-hidden="true">🎙️</span>
        <span class="voice-entry__label">Speak Expense</span>
      </button>
      <span class="voice-entry__status muted" id="voice-status" aria-live="polite"></span>
    `;
    form.appendChild(voiceWrap);

    const micBtn = voiceWrap.querySelector("#voice-mic");
    const statusEl = voiceWrap.querySelector("#voice-status");
    let active = null;

    function setListening(on) {
      micBtn.classList.toggle("is-listening", on);
      micBtn.setAttribute("aria-pressed", on ? "true" : "false");
      micBtn.querySelector(".voice-entry__label").textContent = on ? "Listening…" : "Speak Expense";
      statusEl.textContent = on ? "Say something like 'Coffee 180'" : "";
    }

    micBtn.addEventListener("click", () => {
      if (active) {
        active.stop();
        active = null;
        setListening(false);
        return;
      }
      setListening(true);
      active = startListening({
        // Pass the category list so parseVoiceCommand can pick the right one.
        categories,
        expenses,
        onInterim: (t) => { statusEl.textContent = `Hearing: "${t}"`; },
        onTick: (remainingMs) => {
          // Update the button label with a countdown so the user knows
          // how much listen time is left.
          const s = Math.ceil(remainingMs / 1000);
          micBtn.querySelector(".voice-entry__label").textContent =
            `Listening… ${s}s`;
        },
        onFinal: (r) => {
          // Apply the parsed result to the form. parseVoiceCommand
          // extracts amount + note + payment method + UPI app + a
          // category hint.
          if (r.amount != null) amountGroup.input.value = String(r.amount);
          if (r.note) noteGroup.input.value = r.note;
          if (r.paymentMethod && paySelect) {
            paySelect.value = r.paymentMethod;
            paySelect.dispatchEvent(new Event("change", { bubbles: true }));
          }
          if (r.upiApp && upiSelect) {
            upiSelect.value = r.upiApp;
          }
          if (r.categoryId && catSelect) {
            catSelect.value = r.categoryId;
          }
          if (r.datetime) {
            // Voice command may include a datetime — push it back into the
            // combined picker so the user can see / edit it.
            const iso = r.datetime.length === 16
              ? r.datetime
              : (r.datetime || "").replace(" ", "T").slice(0, 16);
            dateTimeGroup.input.value = iso;
            dateTimeGroup.input.dispatchEvent(new Event("input", { bubbles: true }));
          }
          // Trigger the category suggestion pill refresh.
          updateSuggestion();
          const parts = [];
          if (r.amount != null) parts.push(`${symbolForSettings(settings)}${r.amount}`);
          if (r.note) parts.push(`"${r.note}"`);
          if (r.paymentMethod && r.paymentMethod !== "cash") parts.push(r.paymentMethod.replace("_", " "));
          if (r.upiApp) parts.push(r.upiApp);
          statusEl.textContent = r.amount != null
            ? `Captured: ${parts.join(" · ")}`
            : `Couldn't detect amount in "${r.transcript}". Try again.`;
          active?.stop();
          active = null;
          setListening(false);
        },
        onError: (err) => {
          statusEl.textContent = err.message;
          active?.stop();
          active = null;
          setListening(false);
        },
        onEnd: () => {
          if (active) {
            active = null;
            setListening(false);
          }
        },
      });
    });
  }

  // --- Category -----------------------------------------------------------
  // Build the <select> from the categories list. If there are zero categories
  // we surface a friendly warning so the user knows to add one first.
  const catField = document.createElement("div");
  catField.className = "field";
  catField.innerHTML = `
    <label class="field__label" for="exp-category">Category</label>
  `;
  const catSelect = document.createElement("select");
  catSelect.className = "field__select";
  catSelect.id = "exp-category";
  catSelect.name = "categoryId";
  catSelect.required = true;
  if (categories.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No categories — add one first";
    opt.disabled = true;
    opt.selected = true;
    catSelect.appendChild(opt);
  } else {
    categories.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      // Prefix the emoji when one is set, so the open dropdown shows it
      // (browsers render emoji inside <option> text content).
      opt.textContent = c.icon ? `${c.icon}  ${c.name}` : c.name;
      if (expense && expense.categoryId === c.id) opt.selected = true;
      catSelect.appendChild(opt);
    });
  }
  const catErr = makeErrorEl("categoryId");
  // Small line under the select explaining an automatic choice.
  const catHint = document.createElement("div");
  catHint.className = "field__hint muted cat-auto-hint";
  catHint.hidden = true;
  catField.append(catSelect, catHint, catErr);
  form.appendChild(catField);
  // A change the USER makes (programmatic assignments don't fire "change")
  // stops the automatic selection.
  catSelect.addEventListener("change", () => {
    categoryTouched = true;
    catHint.hidden = true;
  });

  // --- Payment method -----------------------------------------------------
  // Required. Drives whether the UPI app dropdown below is shown.
  const payField = document.createElement("div");
  payField.className = "field";
  payField.innerHTML = `
    <label class="field__label" for="exp-paymentMethod">Payment method</label>
  `;
  const paySelect = document.createElement("select");
  paySelect.className = "field__select";
  paySelect.id = "exp-paymentMethod";
  paySelect.name = "paymentMethod";
  paySelect.required = true;
  PAYMENT_METHODS.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.value;
    opt.textContent = m.label;
    // Default to "cash" for new entries; honor the existing value when editing.
    if (expense ? expense.paymentMethod === m.value : m.value === "cash") opt.selected = true;
    paySelect.appendChild(opt);
  });
  const payErr = makeErrorEl("paymentMethod");
  payField.append(paySelect, payErr);
  form.appendChild(payField);

  // --- UPI app (conditional) ----------------------------------------------
  // Only visible when the user picks UPI. We wrap the field in a row we can
  // show/hide without losing the underlying <select> element.
  const upiWrap = document.createElement("div");
  upiWrap.className = "field";
  upiWrap.style.display = "none"; // hidden by default
  upiWrap.innerHTML = `
    <label class="field__label" for="exp-upiApp">UPI app</label>
  `;
  const upiSelect = document.createElement("select");
  upiSelect.className = "field__select";
  upiSelect.id = "exp-upiApp";
  upiSelect.name = "upiApp";
  UPI_APPS.forEach((a) => {
    const opt = document.createElement("option");
    opt.value = a.value;
    opt.textContent = a.label;
    if (expense && expense.upiApp === a.value) opt.selected = true;
    upiSelect.appendChild(opt);
  });
  const upiErr = makeErrorEl("upiApp");
  upiWrap.append(upiSelect, upiErr);
  form.appendChild(upiWrap);

  // --- Show/hide the UPI app field whenever the payment method changes ----
  // Re-evaluating on every change keeps the UI honest: the field is hidden
  // (and its value cleared) the instant the user moves away from UPI.
  const syncUpiVisibility = () => {
    const isUpi = paySelect.value === "upi";
    upiWrap.style.display = isUpi ? "" : "none";
    if (!isUpi) {
      // Clear the value so a stale selection from a previous UPI entry
      // doesn't get persisted on a non-UPI expense.
      upiSelect.value = "";
    }
  };
  paySelect.addEventListener("change", () => {
    syncUpiVisibility();
    // Clear any prior error on this field once the user has fixed it.
    if (ERRORS.upiApp) {
      ERRORS.upiApp.textContent = "";
      upiSelect.removeAttribute("aria-invalid");
    }
  });
  syncUpiVisibility();

  // --- Note ---------------------------------------------------------------
  const noteGroup = fieldGroup("Note (optional)", "note", "text", {
    value: expense?.note || "",
    maxlength: "200",
    placeholder: "What was this for?",
  });
  form.appendChild(noteGroup.root);

  // --- Receipt (encrypted attachment) -------------------------------------
  // Attachments will use the same client-side vault encryption boundary.
  // BEFORE it leaves the device; only the ciphertext reaches the server.
  // The blobId is stored on the expense record (metadata only).
  const receiptField = document.createElement("div");
  receiptField.className = "field";
  receiptField.innerHTML = `
    <label class="field__label" for="exp-receipt">Receipt (optional)</label>
    <input class="field__input" id="exp-receipt" type="file"
           accept="image/*,.pdf" />
    <p class="muted receipt-hint" style="font-size:12px;margin:4px 0 0">
      Encrypted on this device before upload. Max 10 MB.
    </p>
  `;
  const receiptFileState = { file: null, existingBlobId: expense?.receiptBlobId || null };
  const receiptHint = receiptField.querySelector(".receipt-hint");
  const HINT_DEFAULT = "Choose a photo of the bill and we'll read it and fill in the amount, category and date for you. Read on this device — nothing is uploaded.";
  receiptHint.textContent = HINT_DEFAULT;
  // Where the scan progress / "what we found" panel appears.
  const scanBox = document.createElement("div");
  scanBox.className = "scan receipt-scan";
  scanBox.hidden = true;
  receiptField.appendChild(scanBox);
  let receiptScanId = 0;

  /** Fills the form from a scan result. The Note is never touched. */
  function applyScan(r) {
    if (r.total != null) {
      amountGroup.input.value = String(r.total);
      amountGroup.input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const catId = resolveCategoryId(r.categoryId, categories);
    if (catId) {
      catSelect.value = catId;
      // The bill's products decided it — keep it even if a Note is typed later.
      categoryTouched = true;
      catHint.hidden = true;
    }
    if (r.payment.paymentMethod) {
      paySelect.value = r.payment.paymentMethod;
      paySelect.dispatchEvent(new Event("change", { bubbles: true }));
      if (r.payment.upiApp) upiSelect.value = r.payment.upiApp;
    }
    if (r.date || r.time) {
      const [curDate, curTime] = (dateTimeGroup.input.value || combineDateTime()).split("T");
      dateTimeGroup.input.value = `${r.date || curDate}T${(r.time || curTime || currentTimeHHMM()).slice(0, 5)}`;
      dateTimeGroup.input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    updateSuggestion();
  }

  async function scanReceipt(file) {
    const myScan = ++receiptScanId;
    const isCancelled = () => myScan !== receiptScanId || !receiptField.isConnected;
    scanBox.hidden = false;
    scanBox.innerHTML = `
      <div class="scan__status" aria-live="polite">Reading the bill…</div>
      <div class="scan__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div>
      <p class="scan__hint">The first scan downloads the reader (about 10 MB) and can take a little longer.</p>`;
    const statusEl = scanBox.querySelector(".scan__status");
    const barEl = scanBox.querySelector(".scan__bar span");
    const barWrap = scanBox.querySelector(".scan__bar");
    const showError = (msg) => {
      scanBox.innerHTML = "";
      const e = document.createElement("div");
      e.className = "scan__error";
      e.setAttribute("role", "alert");
      e.textContent = msg;
      scanBox.appendChild(e);
    };
    let scanned;
    try {
      scanned = await readReceiptFile(file, (p, text) => {
        if (isCancelled()) return;
        const pct = Math.round(Math.max(0, Math.min(1, p)) * 100);
        barEl.style.width = pct + "%";
        barWrap.setAttribute("aria-valuenow", String(pct));
        if (text) statusEl.textContent = text;
      }, isCancelled, { categories, expenses });
    } catch (err) {
      if (!isCancelled()) showError(err.message + " You can still fill the form in by hand.");
      return;
    }
    if (isCancelled() || !scanned) return;
    if (isEmptyScan(scanned.result)) {
      showError("We couldn't read any text on this image. Make sure the bill is flat, well lit and fills the frame — or fill the form in by hand.");
      return;
    }
    applyScan(scanned.result);
    scanBox.innerHTML = "";
    scanBox.append(buildScanSummary({
      result: scanned.result,
      thumb: scanned.thumb,
      settings,
      categories,
      onPickAmount: (amount) => {
        amountGroup.input.value = String(amount);
        amountGroup.input.dispatchEvent(new Event("input", { bubbles: true }));
      },
    }));
    const applied = document.createElement("p");
    applied.className = "scan__hint";
    applied.textContent = "Amount, category and date were filled in from the bill — check them, then add an optional Note.";
    scanBox.appendChild(applied);
  }

  receiptField.querySelector("#exp-receipt").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    receiptFileState.file = f || null;
    if (!f) {
      receiptScanId++;
      scanBox.hidden = true;
      scanBox.innerHTML = "";
      receiptHint.textContent = HINT_DEFAULT;
      return;
    }
    receiptHint.textContent = `Selected: ${f.name} (${(f.size / 1024).toFixed(0)} KB)`;
    scanReceipt(f);
  });
  form.appendChild(receiptField);

  // --- Date & Time (combined field) --------------------------------------
  // Replaces the previous separate Date + Time inputs. We still store the
  // values as discrete `date` (YYYY-MM-DD) and `time` (HH:MM) on the
  // expense record for compatibility with the server schema and the
  // existing tests, but the user now sees and edits a single picker.
  const dateTimeGroup = fieldGroup("Date & time", "datetime", "datetime-local", {
    required: true,
    value: combineDateTime(expense?.date, expense?.time),
  });
  form.appendChild(dateTimeGroup.root);
  // Keep references to the underlying date / time values so the rest of
  // the form (validation + readValues) can still address them by name.
  const dateGroup = {
    input: makeHiddenInput("date", expense?.date || todayISO()),
    showError: (msg) => setFieldError("date", msg),
  };
  const timeGroup = {
    input: makeHiddenInput("time", expense?.time || currentTimeHHMM()),
    showError: (msg) => setFieldError("time", msg),
  };
  // Register the date/time error slots under their original field names
  // so the live-validation handler (clearing errors as the user types)
  // still works.
  ERRORS.date = makeErrorEl("date");
  ERRORS.time = makeErrorEl("time");
  // Split the datetime-local value into date + time parts whenever the
  // user changes it. <input type="datetime-local"> emits strings like
  // "2026-08-13T14:30" which we parse apart for storage.
  dateTimeGroup.input.addEventListener("input", () => {
    const raw = dateTimeGroup.input.value; // "YYYY-MM-DDTHH:MM" or ""
    if (!raw) {
      dateGroup.input.value = "";
      timeGroup.input.value = "";
      return;
    }
    const [d, t] = raw.split("T");
    dateGroup.input.value = d;
    timeGroup.input.value = (t || "").slice(0, 5) || currentTimeHHMM();
  });
  // Pre-fill the hidden fields from the picker on first render so a fresh
  // "Add" expense carries today's date + the current minute, even before
  // the user touches the picker.
  {
    const raw = dateTimeGroup.input.value;
    if (raw) {
      const [d, t] = raw.split("T");
      if (d) dateGroup.input.value = d;
      if (t) timeGroup.input.value = t.slice(0, 5);
    }
  }

  // --- Inline category-suggest pill (Phase 4) ------------------------------
  // As the user types in the Note field, we look up a category via the
  // keyword map and show a "Category: Food [Use]" pill. Clicking "Use"
  // updates the Category <select> without forcing the user to open it.
  const suggestPill = document.createElement("div");
  suggestPill.className = "suggest-pill";
  suggestPill.style.display = "none"; // hidden until there's a match
  suggestPill.innerHTML = `
    <span aria-hidden="true">✨</span>
    <span>Category: <strong data-suggest-label>—</strong></span>
    <button type="button" class="suggest-pill__btn">Use</button>
  `;
  // Place the pill directly under the note input, inside the note's .field.
  noteGroup.root.appendChild(suggestPill);

  /**
   * Picks the category from the Note as the user types (or speaks): the
   * product is analysed by the shared classifier (js/categorize.js) using
   * their past expenses, their own category names and a large product
   * vocabulary. Stops as soon as the user chooses a category themselves.
   */
  function autoSelectCategory() {
    if (categoryTouched) return;
    const text = noteGroup.input.value;
    if (!text.trim()) { catHint.hidden = true; return; }
    const match = classifyText(text, { categories, expenses, fallbackOther: true });
    if (!match) { catHint.hidden = true; return; }
    if (catSelect.value !== match.categoryId) catSelect.value = match.categoryId;
    catHint.textContent = match.source === "fallback"
      ? "✨ We couldn't tell the category from this note — please check it."
      : `✨ Category chosen automatically from "${text.trim().slice(0, 40)}" — change it if it's not right.`;
    catHint.hidden = false;
  }
  // Kept under its old name: voice entry and the initial pass call it.
  const updateSuggestion = autoSelectCategory;
  suggestPill.style.display = "none"; // the old "Use" pill is replaced by auto-selection
  noteGroup.input.addEventListener("input", updateSuggestion);
  // Initial pass so a pre-filled note (in edit mode) shows its suggestion.
  updateSuggestion();

  // --- Live validation: clear an error as soon as the user changes the field ---
  // Friendlier than waiting until the next submit attempt.
  form.addEventListener("input", (e) => {
    const t = e.target;
    if (t && t.name && t.name in ERRORS) {
      ERRORS[t.name].textContent = "";
      t.removeAttribute("aria-invalid");
    }
  });
  // <select> elements fire "change" rather than "input", so handle them too.
  form.addEventListener("change", (e) => {
    const t = e.target;
    if (t && t.name && t.name in ERRORS) {
      ERRORS[t.name].textContent = "";
      t.removeAttribute("aria-invalid");
    }
  });

  // Expose a read() that returns either { ok, value } or { ok:false, errors }.
  // Also exposes the receipt file state so the caller can encrypt + upload it
  // (needs the master key, which the form itself must not touch).
  form.receiptFile = receiptFileState;
  form.readValues = function readValues() {
    const data = {
      amount: amountGroup.input.value,
      date: dateGroup.input.value,
      time: timeGroup.input.value,
      categoryId: catSelect.value,
      paymentMethod: paySelect.value,
      upiApp: upiSelect.value,
      note: noteGroup.input.value,
    };
    const errors = {};
    const amt = validateAmount(data.amount);
        if (!amt.ok) {
          // If the user typed characters that the number input swallowed,
          // surface the specific "characters not allowed" message instead
          // of the generic "required" one.
          if (amountHadInvalidChars) {
            errors.amount = "Characters are not allowed in amount field";
            amountGroup.showError(errors.amount);
          } else {
            errors.amount = amt.error;
            amountGroup.showError(amt.error);
          }
        }
        else setFieldError("amount", "");
    const dat = validateDate(data.date);
    if (!dat.ok) { errors.date = dat.error; dateGroup.showError(dat.error); }
    else setFieldError("date", "");
    const tim = validateTime(data.time);
    if (!tim.ok) { errors.time = tim.error; timeGroup.showError(tim.error); }
    else setFieldError("time", "");
    const cat = validateCategoryId(data.categoryId, categories);
    if (!cat.ok) { errors.categoryId = cat.error; setFieldError("categoryId", cat.error); }
    else setFieldError("categoryId", "");
    const pay = validatePaymentMethod(data.paymentMethod);
    if (!pay.ok) { errors.paymentMethod = pay.error; setFieldError("paymentMethod", pay.error); }
    else setFieldError("paymentMethod", "");
    const upi = validateUpiApp(data.upiApp, data.paymentMethod);
    if (!upi.ok) { errors.upiApp = upi.error; setFieldError("upiApp", upi.error); }
    else setFieldError("upiApp", "");
    const note = validateNote(data.note);
    if (!note.ok) { errors.note = note.error; noteGroup.showError(note.error); }
    else setFieldError("note", "");

    if (Object.keys(errors).length) return { ok: false, errors };
    const value = {
      amount: amt.value,
      date: dat.value,
      time: tim.value,
      categoryId: cat.value,
      paymentMethod: pay.value,
      // Only persist upiApp when the method is UPI.
      upiApp: pay.value === "upi" ? upi.value : "",
      note: note.value,
    };
    // Carry the existing receipt reference through edits (a new file is
    // encrypted + uploaded by the caller; see main.js openExpenseForm).
    if (receiptFileState.existingBlobId) value.receiptBlobId = receiptFileState.existingBlobId;
    return { ok: true, value };
  };

  return form;
}

// --- Helpers ----------------------------------------------------------------

// A small registry of error elements keyed by field name so `input` listeners
// can clear them without re-querying the DOM.
const ERRORS = {};

/**
 * Build the standard `<div class="field__error">` element for a given field
 * name and register it in the ERRORS map. Returns the element so the caller
 * can append it next to its <select>.
 */
function makeErrorEl(name) {
  const err = document.createElement("div");
  err.className = "field__error";
  err.id = `exp-${name}-err`;
  ERRORS[name] = err;
  return err;
}

/** Show or clear the error for a given field, with proper aria handling. */
function setFieldError(name, message) {
  const el = ERRORS[name];
  const target = document.getElementById(`exp-${name}`);
  if (!el || !target) return;
  el.textContent = message || "";
  if (message) target.setAttribute("aria-invalid", "true");
  else target.removeAttribute("aria-invalid");
}

function fieldGroup(label, name, type, attrs) {
  const root = document.createElement("div");
  root.className = "field";

  const lbl = document.createElement("label");
  lbl.className = "field__label";
  lbl.htmlFor = `exp-${name}`;
  lbl.textContent = label;

  const input = document.createElement("input");
  input.className = "field__input";
  input.id = `exp-${name}`;
  input.name = name;
  input.type = type;
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") input.setAttribute(k, v);
  });

  const err = makeErrorEl(name);
  // aria-describedby on the input points to the error element for screen readers.
  input.setAttribute("aria-describedby", err.id);

  root.append(lbl, input, err);
  function showError(message) {
    setFieldError(name, message);
  }
  return { root, input, showError };
}

/**
 * Combine a `date` (YYYY-MM-DD) and `time` (HH:MM) into the value an
 * `<input type="datetime-local">` expects ("YYYY-MM-DDTHH:MM"). Falls back
 * to "now" rounded to the minute when either part is absent.
 */
function combineDateTime(date, time) {
  const d = date || todayISO();
  const t = (time || currentTimeHHMM()).slice(0, 5);
  return `${d}T${t}`;
}

/**
 * Build a detached <input> that we keep around only so the rest of the
 * form code (validation + readValues) can still reference `.value` under
 * the original "date" / "time" field names. Hidden from layout + a11y
 * tree because the user-facing picker is the datetime-local input above.
 */
function makeHiddenInput(name, value) {
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = name;
  input.value = value;
  return input;
}
