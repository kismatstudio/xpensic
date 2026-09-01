// Smoke test for the form validators (validators.js). These are the
// foundation of every form — add/edit expense, category add, etc.
// A bug here propagates everywhere, so this layer is worth a tight net.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}` + (extra ? `  (${extra})` : "")); fail++; }
}

const {
  validateAmount,
  validateDate,
  validateTime,
  validateCategoryId,
  validatePaymentMethod,
  validateUpiApp,
  validateNote,
} = await import("../js/validators.js");

const sampleCategories = [
  { id: "cat_food", name: "Food" },
  { id: "cat_transport", name: "Transport" },
];

// ---- validateAmount --------------------------------------------------------

console.log("\n[1] validateAmount — accepts positive numbers, rejects the rest");
check("integer 100",               validateAmount(100).value === 100);
check("decimal 12.5",              validateAmount(12.5).value === 12.5);
check("string '250'",              validateAmount("250").value === 250);
check("string '12.50'",            validateAmount("12.50").value === 12.5);
check("comma-decimal '12,50'",     validateAmount("12,50").value === 12.5);
check("rounds to 2 decimals",      validateAmount(1.005).value === 1.01 || validateAmount(1.005).value === 1);
check("empty string rejected",     validateAmount("").ok === false);
check("null rejected",             validateAmount(null).ok === false);
check("undefined rejected",        validateAmount(undefined).ok === false);
check("negative rejected",         validateAmount(-50).ok === false);
check("zero rejected",             validateAmount(0).ok === false);
check("alpha rejected",            validateAmount("abc").ok === false);
check("empty error mentions 'required'", /required/i.test(validateAmount("").error || ""));
check("negative error mentions 'greater'", /greater/i.test(validateAmount(-1).error || ""));
check("non-number error mentions 'number'", /number/i.test(validateAmount("abc").error || ""));

// ---- validateDate ----------------------------------------------------------

console.log("\n[2] validateDate — accepts YYYY-MM-DD, rejects the rest");
check("'2026-07-10'",              validateDate("2026-07-10").value === "2026-07-10");
check("'2026-01-01'",              validateDate("2026-01-01").value === "2026-01-01");
check("'2026-12-31'",              validateDate("2026-12-31").value === "2026-12-31");
check("empty rejected",            validateDate("").ok === false);
check("'2026-7-1' rejected",       validateDate("2026-7-1").ok === false);
check("'07/10/2026' rejected",     validateDate("07/10/2026").ok === false);
check("'2026-02-31' is silently rolled to Mar 3 by the JS Date constructor (a known limitation)",
  // This documents the current behavior, not a desired one. The
  // <input type="date"> picker the form uses prevents users from picking
  // Feb 31 in practice; the validator only catches truly unparseable
  // strings. See the comment in validateDate() in validators.js.
  validateDate("2026-02-31").ok === true);
check("'not a date' rejected",     validateDate("not a date").ok === false);
check("empty error mentions 'required'", /required/i.test(validateDate("").error || ""));
check("format error mentions 'YYYY-MM-DD'", /YYYY-MM-DD/.test(validateDate("2026-7-1").error || ""));

// ---- validateTime ----------------------------------------------------------

console.log("\n[3] validateTime — HH:MM 24h, optional");
check("'12:30'",                   validateTime("12:30").value === "12:30");
check("'00:00'",                   validateTime("00:00").value === "00:00");
check("'23:59'",                   validateTime("23:59").value === "23:59");
check("'9:00' rejected",           validateTime("9:00").ok === false);
check("'24:00' rejected",          validateTime("24:00").ok === false);
check("'12:60' rejected",          validateTime("12:60").ok === false);
check("'12-30' rejected",          validateTime("12-30").ok === false);
check("'abc' rejected",            validateTime("abc").ok === false);
check("empty is OK (optional)",    validateTime("").ok === true && validateTime("").value === "");
check("empty value is empty string", validateTime("").value === "");

// ---- validateCategoryId ----------------------------------------------------

console.log("\n[4] validateCategoryId — must be in the categories list");
check("'cat_food' valid",          validateCategoryId("cat_food", sampleCategories).ok === true);
check("'cat_transport' valid",     validateCategoryId("cat_transport", sampleCategories).ok === true);
check("empty rejected",            validateCategoryId("", sampleCategories).ok === false);
check("unknown id rejected",       validateCategoryId("cat_does_not_exist", sampleCategories).ok === false);
check("empty error mentions 'required'", /required/i.test(validateCategoryId("", sampleCategories).error || ""));
check("unknown error mentions 'exist'", /exist/i.test(validateCategoryId("x", sampleCategories).error || ""));
check("empty categories list",     validateCategoryId("cat_food", []).ok === false);

// ---- validatePaymentMethod -------------------------------------------------

console.log("\n[5] validatePaymentMethod — must be one of the known methods");
check("'cash' valid",              validatePaymentMethod("cash").value === "cash");
check("'upi' valid",               validatePaymentMethod("upi").value === "upi");
check("'debit_card' valid",        validatePaymentMethod("debit_card").value === "debit_card");
check("'credit_card' valid",       validatePaymentMethod("credit_card").value === "credit_card");
check("'bank_transfer' valid",     validatePaymentMethod("bank_transfer").value === "bank_transfer");
check("empty rejected",            validatePaymentMethod("").ok === false);
check("unknown rejected",          validatePaymentMethod("bitcoin").ok === false);
check("error mentions 'required'", /required/i.test(validatePaymentMethod("").error || ""));
check("unknown error mentions 'Unknown'", /Unknown/i.test(validatePaymentMethod("x").error || ""));

// ---- validateUpiApp --------------------------------------------------------

console.log("\n[6] validateUpiApp — required only when paymentMethod is 'upi'");
check("non-upi returns ok with ''", validateUpiApp("", "cash").ok === true && validateUpiApp("", "cash").value === "");
check("non-upi ignores value",      validateUpiApp("phonepe", "cash").value === "");
check("upi + 'phonepe'",            validateUpiApp("phonepe", "upi").value === "phonepe");
check("upi + 'googlepay'",          validateUpiApp("googlepay", "upi").value === "googlepay");
check("upi + 'paytm'",              validateUpiApp("paytm", "upi").value === "paytm");
check("upi + 'supermoney'",         validateUpiApp("supermoney", "upi").value === "supermoney");
check("upi + 'bhim'",               validateUpiApp("bhim", "upi").value === "bhim");
check("upi + 'cred'",               validateUpiApp("cred", "upi").value === "cred");
check("upi + empty rejected",       validateUpiApp("", "upi").ok === false);
check("upi + unknown rejected",     validateUpiApp("venmo", "upi").ok === false);
check("upi + empty error mentions 'choose'", /choose/i.test(validateUpiApp("", "upi").error || ""));
check("upi + unknown error mentions 'Unknown'", /Unknown/i.test(validateUpiApp("venmo", "upi").error || ""));

// ---- validateNote ----------------------------------------------------------

console.log("\n[7] validateNote — optional, ≤200 chars after trim");
check("'Lunch'",                   validateNote("Lunch").value === "Lunch");
check("trims whitespace",          validateNote("  Lunch  ").value === "Lunch");
check("empty is OK",               validateNote("").ok === true && validateNote("").value === "");
check("whitespace-only is empty",  validateNote("   ").value === "");
check("200 chars is OK",           validateNote("a".repeat(200)).ok === true);
check("201 chars rejected",        validateNote("a".repeat(201)).ok === false);
check("long error mentions '200'", /200/.test(validateNote("a".repeat(201)).error || ""));

// ---- Cross-cutting: integration with form shape ----------------------------

console.log("\n[8] Integration: a full expense form payload validates cleanly");
// This mirrors what buildExpenseForm produces after a valid submit.
const validExpense = {
  amount: validateAmount(250).value,
  date: validateDate("2026-07-10").value,
  time: validateTime("12:30").value,
  categoryId: validateCategoryId("cat_food", sampleCategories).value,
  paymentMethod: validatePaymentMethod("upi").value,
  upiApp: validateUpiApp("phonepe", "upi").value,
  note: validateNote("Lunch with team").value,
};
check("amount is 250",             validExpense.amount === 250);
check("date is YYYY-MM-DD",        validExpense.date === "2026-07-10");
check("time is HH:MM",             validExpense.time === "12:30");
check("categoryId is cat_food",    validExpense.categoryId === "cat_food");
check("paymentMethod is upi",      validExpense.paymentMethod === "upi");
check("upiApp is phonepe",         validExpense.upiApp === "phonepe");
check("note is trimmed",           validExpense.note === "Lunch with team");

// A 0-amount expense is invalid.
const invalidAmount = validateAmount(0);
check("0-amount rejected",         invalidAmount.ok === false);

// A future-dated expense is allowed (people sometimes log in advance).
check("future date is allowed",    validateDate("2099-01-01").ok === true);

// A non-upi expense must have an empty upiApp.
const nonUpiExpense = {
  ...validExpense,
  paymentMethod: "cash",
  upiApp: validateUpiApp("phonepe", "cash").value,  // wipes the value
};
check("non-upi expense has empty upiApp", nonUpiExpense.upiApp === "");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
