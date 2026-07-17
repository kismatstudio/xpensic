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
} from "../validators.js";
import {
  todayISO,
  currentTimeHHMM,
  escapeHtml,
  PAYMENT_METHODS,
  UPI_APPS,
  suggestCategory,
} from "../util.js";

/**
 * @param {object} ctx
 * @param {Array}  ctx.categories  — all categories from the store
 * @param {object} [ctx.expense]   — when provided, the form starts in edit mode
 * @returns {HTMLFormElement}
 */
export function buildExpenseForm({ categories, expense }) {
  const isEdit = Boolean(expense);

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

  // --- Date ---------------------------------------------------------------
  // Auto-fill with today for new expenses. <input type="date"> expects
  // the ISO YYYY-MM-DD format directly, which `todayISO()` already returns.
  const dateGroup = fieldGroup("Date", "date", "date", {
    required: true,
    value: expense?.date || todayISO(),
  });
  form.appendChild(dateGroup.root);

  // --- Time (auto-filled from system clock) -------------------------------
  // Captured automatically when adding a new expense. Stored as HH:MM in 24h
  // format; left blank for legacy records that don't have it.
  const timeGroup = fieldGroup("Time", "time", "time", {
    value: expense?.time || currentTimeHHMM(),
    placeholder: "HH:MM",
  });
  form.appendChild(timeGroup.root);

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
      opt.textContent = c.name;
      if (expense && expense.categoryId === c.id) opt.selected = true;
      catSelect.appendChild(opt);
    });
  }
  const catErr = makeErrorEl("categoryId");
  catField.append(catSelect, catErr);
  form.appendChild(catField);

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
   * Re-evaluate the suggestion. Called on every input event in the note
   * field. Resolves a category id (if any), updates the pill text, and
   * shows/hides the pill. Does NOT auto-apply the category — the user
   * must click "Use" to keep the choice transparent and reversible.
   */
  function updateSuggestion() {
    const text = noteGroup.input.value;
    // Don't suggest if the user already picked a category.
    if (catSelect.value) {
      suggestPill.style.display = "none";
      return;
    }
    const match = suggestCategory(text);
    if (!match) {
      suggestPill.style.display = "none";
      return;
    }
    const cat = categories.find((c) => c.id === match.id);
    if (!cat) {
      suggestPill.style.display = "none";
      return;
    }
    suggestPill.querySelector("[data-suggest-label]").textContent = cat.name;
    suggestPill.style.display = "";
  }
  // Wire the suggest button. We capture `match` lazily in the handler so
  // the click always reflects the latest keyword hit.
  suggestPill.querySelector(".suggest-pill__btn").addEventListener("click", () => {
    const match = suggestCategory(noteGroup.input.value);
    if (match) catSelect.value = match.id;
    suggestPill.style.display = "none";
  });
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
    if (!amt.ok) { errors.amount = amt.error; amountGroup.showError(amt.error); }
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
    return {
      ok: true,
      value: {
        amount: amt.value,
        date: dat.value,
        time: tim.value,
        categoryId: cat.value,
        paymentMethod: pay.value,
        // Only persist upiApp when the method is UPI.
        upiApp: pay.value === "upi" ? upi.value : "",
        note: note.value,
      },
    };
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
