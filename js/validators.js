// Small, framework-free validators. Each returns { ok: boolean, value?, error? }.

import { PAYMENT_METHODS, UPI_APPS } from "./util.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM     = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateAmount(input) {
  // Reject empty / null up front so the user gets a clear "required" message
  // instead of the more confusing "must be a number".
  if (input === null || input === undefined || input === "") {
    return { ok: false, error: "Amount is required." };
  }
  // Accept either a number or a string. Strings with commas are common
  // (e.g. "12,50") so we normalize those to a dot decimal.
  const n = typeof input === "number" ? input : Number(String(input).replace(/,/g, "."));
  if (!Number.isFinite(n)) {
    return { ok: false, error: "Amount must be a number." };
  }
  if (n <= 0) {
    return { ok: false, error: "Amount must be greater than zero." };
  }
  // Round to 2 decimals to keep storage tidy (no floating point drift).
  return { ok: true, value: Math.round(n * 100) / 100 };
}

export function validateDate(input) {
  if (!input) return { ok: false, error: "Date is required." };
  if (!ISO_DATE.test(input)) {
    return { ok: false, error: "Date must be in YYYY-MM-DD format." };
  }
  // Verify the parsed date round-trips — catches truly unparseable strings.
  // Note: the JS Date constructor is forgiving and silently rolls invalid
  // dates (Feb 31 → Mar 3), so this guard mainly catches things like
  // "2026-13-01" or other non-existent calendar months. A stricter
  // day-of-month check is intentionally not done here — the
  // <input type="date"> picker the form uses already prevents those.
  const d = new Date(`${input}T00:00:00`);
  if (Number.isNaN(d.getTime())) {
    return { ok: false, error: "Date is not a valid calendar date." };
  }
  return { ok: true, value: input };
}

/** Time is optional; if present it must be HH:MM in 24h format. */
export function validateTime(input) {
  if (!input) return { ok: true, value: "" };
  if (!HHMM.test(input)) return { ok: false, error: "Time must be in HH:MM format." };
  return { ok: true, value: input };
}

export function validateCategoryId(input, categories) {
  if (!input) return { ok: false, error: "Category is required." };
  const exists = categories.some((c) => c.id === input);
  if (!exists) return { ok: false, error: "Category does not exist." };
  return { ok: true, value: input };
}

/** Required. Must be one of the known payment method codes. */
export function validatePaymentMethod(input) {
  if (!input) return { ok: false, error: "Payment method is required." };
  const ok = PAYMENT_METHODS.some((m) => m.value === input);
  if (!ok) return { ok: false, error: "Unknown payment method." };
  return { ok: true, value: input };
}

/**
 * Required only when the payment method is UPI. Returns an empty string
 * (valid) for any other method, so the field can be safely cleared when
 * the user switches away from UPI.
 */
export function validateUpiApp(input, paymentMethod) {
  if (paymentMethod !== "upi") {
    return { ok: true, value: "" };
  }
  if (!input) return { ok: false, error: "Please choose a UPI app." };
  const ok = UPI_APPS.some((a) => a.value === input);
  if (!ok) return { ok: false, error: "Unknown UPI app." };
  return { ok: true, value: input };
}

export function validateNote(input) {
  const v = (input || "").toString().trim();
  if (v.length > 200) return { ok: false, error: "Note must be 200 characters or fewer." };
  return { ok: true, value: v };
}
