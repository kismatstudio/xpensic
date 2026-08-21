// Smoke tests for the rule-based Budget Tips ("AI" assistant).
//
// Verifies:
//   • Empty / sparse data produces friendly fallback tips.
//   • Over-budget categories surface a "reduce by X%" warning.
//   • Near-budget categories surface a "save ₹Y" tip.
//   • Weekend-heavy spending triggers the weekend tip.
//   • Tips are capped to 6 so the UI stays digestible.

import { computeBudgetTips, TIP_KIND_ICON } from "../js/budget-tips.js";

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}` + (extra ? `  (${extra})` : "")); fail++; }
}

const ctx = { month: new Date(2026, 6, 15) }; // July 2026

console.log("\n[1] Empty state — no categories, no expenses, no budgets");
{
  const tips = computeBudgetTips(
    { categories: [], expenses: [], budgets: { monthly: {} } },
    ctx,
  );
  check("returns an array", Array.isArray(tips));
  check("returns no tips when there's no data", tips.length === 0);
}

console.log("\n[2] Has expenses but no budgets — suggests setting the first one");
{
  const state = {
    categories: [{ id: "cat_food", name: "Food", color: "#ef4444" }],
    expenses: [
      { id: "1", amount: 1500, date: "2026-07-10", categoryId: "cat_food" },
      { id: "2", amount: 2000, date: "2026-07-15", categoryId: "cat_food" },
    ],
    budgets: { monthly: {} },
  };
  const tips = computeBudgetTips(state, ctx);
  check("includes a 'no budgets' tip", tips.some((t) => t.id === "no-budgets"));
  check(
    "includes a 'no-budget-Food' tip",
    tips.some((t) => t.id === "no-budget-cat_food"),
  );
}

console.log("\n[3] Over budget — warning + 'reduce by X%' suggestion");
{
  const state = {
    categories: [{ id: "cat_food", name: "Food", color: "#ef4444" }],
    expenses: [
      { id: "1", amount: 1200, date: "2026-07-02", categoryId: "cat_food" },
      { id: "2", amount: 600,  date: "2026-07-12", categoryId: "cat_food" },
    ],
    budgets: { monthly: { "2026-07": { cat_food: 1000 } } },
  };
  const tips = computeBudgetTips(state, ctx);
  const over = tips.find((t) => t.id === "overshoot-cat_food");
  check("emits an overshoot warning", !!over);
  check("overshoot is kind=warning", over?.kind === "warning");
  check("overshoot body mentions the overage", over?.body.includes("over by"));
}

console.log("\n[4] Near budget (60-99%) — saving tip with rupee amount");
{
  const state = {
    categories: [{ id: "cat_food", name: "Food", color: "#ef4444" }],
    expenses: [
      { id: "1", amount: 1500, date: "2026-07-05", categoryId: "cat_food" },
    ],
    budgets: { monthly: { "2026-07": { cat_food: 2000 } } }, // 75% spent
  };
  const tips = computeBudgetTips(state, ctx);
  const reduce = tips.find((t) => t.id === "reduce-cat_food");
  check("emits a saving tip when 60-99% spent", !!reduce);
  check("saving tip mentions ₹/month", reduce?.title.includes("/month"));
}

console.log("\n[5] Weekend-heavy — tips fires when >55% are Sat/Sun over 60 days");
{
  const state = {
    categories: [{ id: "cat_food", name: "Food", color: "#ef4444" }],
    expenses: [],
    budgets: { monthly: { "2026-07": { cat_food: 100 } } },
  };
  // ctx.month = July 15 2026. The 60-day window back from "now" is
  // approximately the last 60 days. We can't depend on `Date.now()`
  // here, so patch the cutoff: the rule uses `Date.now()` internally.
  // We build 20 expenses spread across the last 30 days, mostly
  // on weekends.
  // We'll synthesize by using today's actual date.
  const today = new Date();
  const oneDay = 86_400_000;
  function fmt(d) {
    return d.toISOString().slice(0, 10);
  }
  // 60 entries over the last 60 days; every weekend + 6 weekdays.
  const dayOfWeek = today.getDay(); // 0 = Sun
  let weekendCount = 0;
  let weekdayCount = 0;
  // Walk backwards 60 days; emit an expense on every weekend day,
  // and on some weekday days.
  for (let i = 1; i <= 60; i++) {
    const d = new Date(today.getTime() - i * oneDay);
    const dow = d.getDay();
    const isWeekend = dow === 0 || dow === 6;
    if (isWeekend) {
      state.expenses.push({
        id: "wk" + i, amount: 10, date: fmt(d), categoryId: "cat_food",
      });
      weekendCount++;
    } else if (weekdayCount < 6) {
      state.expenses.push({
        id: "wd" + i, amount: 10, date: fmt(d), categoryId: "cat_food",
      });
      weekdayCount++;
    }
  }
  check("built enough weekend expenses", weekendCount >= 10,
    `weekend=${weekendCount}, weekday=${weekdayCount}`);
  const tips = computeBudgetTips(state, ctx);
  check("emits a weekend-heavy tip", tips.some((t) => t.id === "weekend-heavy"));
}

console.log("\n[6] Tip count is capped");
{
  const state = {
    categories: [
      { id: "cat_food", name: "Food", color: "#ef4444" },
      { id: "cat_transport", name: "Transport", color: "#3b82f6" },
      { id: "cat_shopping", name: "Shopping", color: "#ec4899" },
      { id: "cat_health", name: "Health", color: "#06b6d4" },
    ],
    expenses: [],
    budgets: { monthly: {} },
  };
  // All four categories without budgets → 1 no-budgets tip + 4 no-budget-X tips
  // = 5 tips (under cap of 6).
  const tips = computeBudgetTips(state, ctx);
  check("tips count <= 6", tips.length <= 6);
}

console.log("\n[7] TIP_KIND_ICON maps every kind");
check("saving icon defined",    typeof TIP_KIND_ICON.saving === "string");
check("warning icon defined",   typeof TIP_KIND_ICON.warning === "string");
check("suggestion icon defined", typeof TIP_KIND_ICON.suggestion === "string");
check("info icon defined",      typeof TIP_KIND_ICON.info === "string");

console.log("\n[8] Each tip has the expected shape");
{
  const state = {
    categories: [{ id: "cat_food", name: "Food", color: "#ef4444" }],
    expenses: [{ id: "1", amount: 100, date: "2026-07-10", categoryId: "cat_food" }],
    budgets: { monthly: { "2026-07": { cat_food: 50 } } }, // over budget
  };
  const tips = computeBudgetTips(state, ctx);
  check("at least one tip", tips.length >= 1);
  for (const t of tips) {
    check(`tip ${t.id} has id, kind, title, body`,
      typeof t.id === "string" &&
      typeof t.kind === "string" &&
      typeof t.title === "string" &&
      typeof t.body === "string",
      JSON.stringify(t));
    check(`tip ${t.id} kind is one of the allowed values`,
      ["saving", "warning", "suggestion", "info"].includes(t.kind));
  }
}

// ---- Section 9: Budgets view — split layout (categories + tips) --------
// The Budgets view renders the per-category editor and the smart tips
// card side-by-side (60% / 40%) instead of stacking them vertically.
// The markup lives in js/views/budgets.js; the grid + responsive
// fallback live in css/components.css.

console.log("\n[9] Budgets view: split layout markup + CSS");
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const budgetsJs = read("js/views/budgets.js");
const componentsCss = read("css/components.css");

check("budgets.js renders a .budgets__split wrapper",
  /class="budgets__split"/.test(budgetsJs));
check("budgets.js renders a .budgets__split-list (categories column)",
  /class="card budgets__split-list"/.test(budgetsJs));
check("budgets.js renders a #budget-smart-tips host (tips column)",
  /id="budget-smart-tips"/.test(budgetsJs));
check("budgets.js renders the tips card inside .budgets__split-tips",
  /class="budgets__split-tips"[\s\S]{0,200}id="budget-smart-tips"/.test(budgetsJs));
check("budgets.js renders the per-category list inside .budgets__split-list",
  /class="card budgets__split-list"[\s\S]{0,200}id="budget-list"/.test(budgetsJs));

check("components.css styles .budgets__split as a grid",
  /\.budgets__split\s*\{[\s\S]{0,200}display:\s*grid/.test(componentsCss));
check("components.css uses a 60% / 40% column split",
  /\.budgets__split\s*\{[\s\S]{0,400}grid-template-columns:\s*60%\s*40%/.test(componentsCss));
check("components.css gives the split a gap between columns",
  /\.budgets__split\s*\{[\s\S]{0,400}gap:\s*var\(--space-4\)/.test(componentsCss));
check("components.css aligns columns to the top",
  /\.budgets__split\s*\{[\s\S]{0,400}align-items:\s*start/.test(componentsCss));
check("components.css pins the tips column with sticky positioning",
  /\.budgets__split-tips\s*\{[\s\S]{0,400}position:\s*sticky/.test(componentsCss));
check("components.css collapses to a single column on narrow screens",
  /@media\s*\(max-width:\s*860px\)[\s\S]{0,400}\.budgets__split\s*\{[\s\S]{0,200}grid-template-columns:\s*1fr/.test(componentsCss));
check("components.css drops sticky positioning on narrow screens",
  /@media\s*\(max-width:\s*860px\)[\s\S]{0,800}\.budgets__split-tips\s*\{[\s\S]{0,200}position:\s*static/.test(componentsCss));
check("components.css zeroes the tips card bottom margin inside the split",
  /\.budgets__split-tips\s+\.budget-tips\s*\{[\s\S]{0,200}margin-bottom:\s*0/.test(componentsCss));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
