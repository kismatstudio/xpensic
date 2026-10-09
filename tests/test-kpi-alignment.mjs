// Tests for KPI card alignment in the dashboard grid.
//
// The KPI grid lays out four cards side by side. Each card is a label,
// a value, and a delta line. Labels wrap at different widths ("October
// 2026 total" wraps to two lines while "Daily average" stays on one),
// which used to push the wrapped card's value down and leave the three
// values on different baselines.
//
// The fix reserves two lines of label height so every value starts at
// the same y regardless of how many lines its label occupies.

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

const componentsCss = read("css/components.css");
const dashboard = read("js/views/dashboard.js");

console.log("\n[1] .kpi__label reserves a fixed two-line height");
check(".kpi__label declares min-height",
  /\.kpi__label\s*\{[\s\S]*?min-height:\s*2lh/.test(componentsCss));
check("min-height uses the lh unit (tracks the computed line-height)",
  /\.kpi__label\s*\{[\s\S]*?min-height:\s*2lh/.test(componentsCss));
check("the reserved height is inside the .kpi__label rule, not a sibling",
  (() => {
    const m = componentsCss.match(/\.kpi__label\s*\{([\s\S]*?)\}/);
    return !!m && /min-height:\s*2lh/.test(m[1]);
  })());

console.log("\n[2] KPI values share one size (no per-card font override)");
check("the 'vs. last month' value has no inline font-size override",
  !/kpi__value"\s+style="font-size:\s*var\(--text-md\)"[^>]*>\$\{formatCurrency\(lastTotal/.test(dashboard));
check("the 'vs. last month' value uses the plain .kpi__value class",
  /<div class="kpi__value">\$\{formatCurrency\(lastTotal, settings\)\}<\/div>/.test(dashboard));
check("all three dashboard KPI values use the plain .kpi__value class",
  (dashboard.match(/<div class="kpi__value">\$\{formatCurrency\(/g) || []).length >= 3);

console.log("\n[3] The three tiles still render in one grid");
check("the KPI grid container is present",
  /<div class="kpi-grid" id="kpi-grid"><\/div>/.test(dashboard));
check("renderKpiGrid emits the this-month / last-month / daily cards",
  /kpi__label">\$\{escapeHtml\(formatMonth\(session\.currentMonth\)\)\} total/.test(dashboard) &&
  /kpi__label">vs\. last month/.test(dashboard) &&
  /kpi__label">Daily average/.test(dashboard));

console.log("\n[4] KPI values scale down so 8-figure amounts fit");
check(".kpi is a container query host",
  /\.kpi\s*\{[\s\S]*?container-type:\s*inline-size/.test(componentsCss));
check(".kpi__value font scales with the card width (cqw)",
  /\.kpi__value\s*\{[\s\S]*?font-size:\s*clamp\(18px,\s*12cqw,\s*34px\)/.test(componentsCss));
check("the clamp keeps the 34px size on wide cards",
  /clamp\(18px,\s*12cqw,\s*34px\)/.test(componentsCss));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
