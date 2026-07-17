// Smoke test for the version-mismatch fix in backup.js.
// Run with:  node tests/test-backup-version.mjs

import { exportFullState, parseFullState } from "../js/backup.js";
import { Store, migrate, validate, normalizeExpense } from "../js/store.js";

let pass = 0;
let fail = 0;

function check(name, cond, extra) {
  if (cond) {
    console.log(`  PASS  ${name}`);
    pass++;
  } else {
    console.log(`  FAIL  ${name}` + (extra ? `  (${extra})` : ""));
    fail++;
  }
}

console.log("\n[1] Round-trip: v2 export → current schema import (v2 backups are migrated forward)");
{
  const sample = {
    version: 2,
    settings: { currency: "INR", currencySymbol: "₹", currencyPosition: "before", dateFormat: "YYYY-MM-DD", theme: "system" },
    profile: { name: "Test", phone: "9876543210", avatarDataUrl: "" },
    categories: [{ id: "cat_food", name: "Food", color: "#ef4444", isDefault: true }],
    budgets: { monthly: { "2026-07": { cat_food: 500 } } },
    expenses: [{
      id: "exp_1", amount: 100, date: "2026-07-10", categoryId: "cat_food",
      note: "Lunch", time: "12:30", paymentMethod: "upi", upiApp: "phonepe",
      createdAt: "2026-07-10T07:00:00.000Z", updatedAt: "2026-07-10T07:00:00.000Z",
    }],
  };
  // exportFullState just stringifies the input — it preserves whatever
  // version the caller has. The migration is what normalizes old versions
  // to the current schema.
  const json = exportFullState(sample);
  check("export preserves the input version (v2)", JSON.parse(json).version === 2);

  const result = parseFullState(json);
  check("import ok=true", result.ok === true, result.error);
  if (result.ok) {
    check("v2 import is migrated forward to the current schema (v4)",
      result.state.version === 4);
    check("expense[0] preserves paymentMethod", result.state.expenses[0].paymentMethod === "upi");
    check("expense[0] preserves upiApp", result.state.expenses[0].upiApp === "phonepe");
    check("profile preserved", result.state.profile.name === "Test");
  }
}

console.log("\n[2] v1 backup is migrated forward to current schema");
{
  const v1 = {
    version: 1,
    settings: { currency: "USD", currencySymbol: "$", currencyPosition: "before", dateFormat: "MM/DD/YYYY", theme: "light" },
    // No `profile` — added when migrating to v2.
    categories: [{ id: "cat_food", name: "Food", color: "#ef4444" }],
    budgets: { monthly: {} },
    expenses: [{
      id: "exp_old", amount: 50, date: "2026-06-01", categoryId: "cat_food",
      note: "old", createdAt: "2026-06-01T00:00:00.000Z",
      // No paymentMethod/upiApp/time — these are v2 fields.
    }],
  };
  const result = parseFullState(JSON.stringify(v1));
  check("v1 import ok=true (after migration)", result.ok === true, result.error);
  if (result.ok) {
    check("v1 migrated to the current schema (v4)", result.state.version === 4);
    check("v1 has empty profile after migration", result.state.profile && result.state.profile.name === "");
    check("v1 has empty userId after migration",  result.state.profile && result.state.profile.userId === "");
    check("v1 expense paymentMethod backfilled to 'cash'", result.state.expenses[0].paymentMethod === "cash");
    check("v1 expense upiApp backfilled to ''", result.state.expenses[0].upiApp === "");
    check("v1 expense time backfilled to ''", result.state.expenses[0].time === "");
  }
}

console.log("\n[3] Bad data is still rejected");
{
  const result = parseFullState("not json");
  check("invalid JSON rejected", result.ok === false);
}
{
  const result = parseFullState(JSON.stringify({ version: 99, settings: {}, categories: [], expenses: [], budgets: { monthly: {} } }));
  check("future version rejected with clear error", result.ok === false && /Unsupported/.test(result.error || ""), result.error);
}
{
  const result = parseFullState(JSON.stringify({ version: 2, settings: "not an object", categories: [], expenses: [], budgets: { monthly: {} } }));
  check("missing/wrong settings rejected", result.ok === false && /settings/i.test(result.error || ""), result.error);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
