// Regression test for currency-symbol handling in Settings.
//
// Bug: changing the currency *code* left the previously stored symbol in
// place, so picking USD still rendered "₹" everywhere. The symbol is now
// derived from the code, so the two can never drift apart.
//
// Verifies:
//   • currencySymbolFor maps every code offered in Settings.
//   • symbolForSettings prefers the code over a stale stored symbol.
//   • formatCurrency renders the code's symbol even when the stored
//     symbol is stale, and still honours the before/after position.
//   • Budget tip text follows the selected currency.
//   • No view hard-codes "₹" in rendered output any more.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}` + (extra ? `  (${extra})` : "")); fail++; }
}

const {
  formatCurrency, currencySymbolFor, symbolForSettings, DEFAULT_CURRENCY_SYMBOL,
} = await import("../js/format.js");
const { computeBudgetTips } = await import("../js/budget-tips.js");

// ---- [1] code → symbol -----------------------------------------------------

console.log("\n[1] currencySymbolFor maps the codes offered in Settings");
const EXPECTED = { INR: "₹", USD: "$", EUR: "€", GBP: "£", JPY: "¥" };
for (const [code, symbol] of Object.entries(EXPECTED)) {
  check(`${code} → ${symbol}`, currencySymbolFor(code) === symbol);
}
check("case-insensitive",   currencySymbolFor("usd") === "$");
check("trims whitespace",   currencySymbolFor("  usd  ") === "$");
check("unknown code → \"\"", currencySymbolFor("XYZ") === "");
check("empty code → \"\"",   currencySymbolFor("") === "");
check("non-string → \"\"",   currencySymbolFor(null) === "" && currencySymbolFor(7) === "");

// ---- [2] settings → symbol -------------------------------------------------

console.log("\n[2] symbolForSettings resolves the symbol to display");
check("code wins over a stale stored symbol",
  symbolForSettings({ currency: "USD", currencySymbol: "₹" }) === "$");
check("code wins even when position is 'after'",
  symbolForSettings({ currency: "GBP", currencySymbol: "₹", currencyPosition: "after" }) === "£");
check("unknown code falls back to the stored symbol",
  symbolForSettings({ currency: "XYZ", currencySymbol: "৳" }) === "৳");
check("no code, no symbol → default",
  symbolForSettings({}) === DEFAULT_CURRENCY_SYMBOL);
check("undefined settings → default",
  symbolForSettings(undefined) === DEFAULT_CURRENCY_SYMBOL);

// ---- [3] formatting --------------------------------------------------------

console.log("\n[3] formatCurrency uses the code's symbol");
check("INR renders ₹", formatCurrency(1234.5, { currency: "INR" }).startsWith("₹"));
check("USD renders $ (stale ₹ ignored)",
  formatCurrency(1234.5, { currency: "USD", currencySymbol: "₹" }) === "$1,234.5");
check("EUR renders € (stale ₹ ignored)",
  formatCurrency(10, { currency: "EUR", currencySymbol: "₹" }).startsWith("€"));
check("position=after puts the symbol last",
  formatCurrency(100, { currency: "USD", currencyPosition: "after" }) === "100 $");
check("position=before is the default",
  formatCurrency(100, { currency: "USD", currencySymbol: "₹" }) === "$100");

// ---- [4] budget tips follow the currency -----------------------------------

console.log("\n[4] Budget tips render in the selected currency");
const monthCtx = { month: new Date(2026, 6, 15) }; // July 2026
function tipsFor(settings) {
  return computeBudgetTips(
    {
      settings,
      categories: [{ id: "cat_food", name: "Food" }],
      expenses: [{ id: "1", amount: 1300, date: "2026-07-10", categoryId: "cat_food" }],
      budgets: { monthly: { "2026-07": { cat_food: 1000 } } },
    },
    monthCtx,
  );
}
const usdTips = tipsFor({ currency: "USD", currencySymbol: "$" });
const usdText = usdTips.map((t) => `${t.title} ${t.body}`).join(" ");
check("emits the overshoot tip", usdTips.some((t) => t.id === "overshoot-cat_food"));
check("USD tip text uses $",     usdText.includes("$1,300"));
check("USD tip text has no ₹",   !usdText.includes("₹"));

const gbpTips = tipsFor({ currency: "GBP", currencySymbol: "GBP", currencyPosition: "after" });
const gbpText = gbpTips.map((t) => `${t.title} ${t.body}`).join(" ");
check("position=after respected in tips", gbpText.includes("1,300 £"));
check("position=after has no ₹",          !gbpText.includes("₹"));

// ---- [5] no hard-coded rupee in rendered output ----------------------------

console.log("\n[5] Views derive the symbol instead of hard-coding ₹");
const RENDER_SITES = {
  "js/views/budgets.js":      /escapeHtml\(symbolForSettings\(settings\)\)/,
  "js/views/dashboard.js":    /valuePrefix:\s*symbolForSettings\(settings\)/,
  "js/views/expenses.js":     /placeholder=.*\$\{symbolForSettings\(settings\)\}/,
  "js/views/expense-form.js": /\$\{symbolForSettings\(settings\)\}\$\{r\.amount\}/,
};
for (const [file, pattern] of Object.entries(RENDER_SITES)) {
  const src = read(file);
  check(`${file} resolves the symbol from settings`, pattern.test(src));
  // Interpolated template output is the thing that used to be hard-coded.
  check(`${file} has no \`₹\${...}\` interpolation`,
    !/`₹\$\{/.test(src) && !/₹\$\{r\.amount\}/.test(src));
}
check("main.js derives the Settings symbol field from the code",
  /symbolForSettings\(\{\s*\n?\s*currency: \$currency\.value/.test(read("js/main.js")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
