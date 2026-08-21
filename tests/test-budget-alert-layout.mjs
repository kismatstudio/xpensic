// Tests for the dashboard Budget alerts card layout.
//
// The "N over budget · N on track" summary used to render on its own
// line below the "Budget alerts" label, which wasted vertical space
// that could be used by the scrollable list of categories. The latest
// layout moves the summary into the label row inline (to the right of
// "Budget alerts" and before "Manage →"), so the list gets more room.

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

const dashboard = read("js/views/dashboard.js");
const componentsCss = read("css/components.css");

console.log("\n[1] Summary renderBudgetAlertKpi — chip moved into the label row");
check("renderBudgetAlertKpi renders a .budget-alert-kpi__title span",
  /class="budget-alert-kpi__title">\s*Budget alerts/.test(dashboard));
check("title span sits inside the .kpi__label row",
  /class="kpi__label"[\s\S]{0,200}class="budget-alert-kpi__title">\s*Budget alerts/.test(dashboard));
check("the 'N over budget' summary is rendered as a chip",
  /class="budget-alert-kpi__chip[\s\S]{0,200}budget-alert-kpi__chip--over/.test(dashboard));
check("over-budget chip carries the danger colour class",
  /budget-alert-kpi__chip--over/.test(dashboard));
check("on-track chip carries the muted colour class",
  /budget-alert-kpi__chip--ok/.test(dashboard));
check("Manage link still lives in the label row",
  /class="budget-alert-kpi__label-right"[\s\S]{0,400}class="budget-alert-kpi__link"/.test(dashboard));
check("label-right wraps both the chip and the Manage link",
  /class="budget-alert-kpi__label-right"[\s\S]{0,400}budget-alert-kpi__link/.test(dashboard) &&
  /budget-alert-kpi__chip[\s\S]{0,400}budget-alert-kpi__link[\s\S]{0,200}<\/span>\s*<\/div>/.test(dashboard));
check("standalone sub line is gone (no longer rendered outside the label)",
  // The old summary used `__sub-over` / `__sub-ok` classes. The chip
  // pattern uses `__chip` + `__chip--over` / `__chip--ok` instead.
  // The `sub` variable still mentions the old strings as text content
  // (e.g. aria-label), but it must NOT be emitted as a CSS class on a
  // rendered element. Confirm no rendered class uses either name.
  !/class="budget-alert-kpi__sub-over"/.test(dashboard) &&
  !/class="budget-alert-kpi__sub-ok"/.test(dashboard) &&
  !/\.budget-alert-kpi__sub-over/.test(componentsCss) &&
  !/\.budget-alert-kpi__sub-ok/.test(componentsCss));
check("the sub variable is still computed (callers still get the text)",
  // The internal `subText` variable is built and used as the chip's
  // text content. Its presence keeps the test honest — if the build
  // path is removed entirely the test would fail and remind us to
  // clean up the unused helper.
  /const subText = hasBudgets/.test(dashboard));
check("summary chip is hidden when there are no budgets",
  // The ternary should produce an empty string when !hasBudgets so the
  // chip doesn't render in the empty state.
  /summaryChip\s*=\s*hasBudgets/.test(dashboard));

console.log("\n[2] CSS — inline chip styles");
check("layout.css styles .budget-alert-kpi__title as a plain span",
  /\.budget-alert-kpi__title\s*\{/.test(componentsCss));
check("layout.css styles .budget-alert-kpi__label-right as a flex row",
  /\.budget-alert-kpi__label-right\s*\{[\s\S]{0,200}display:\s*flex/.test(componentsCss));
check("layout.css styles .budget-alert-kpi__chip as a pill",
  /\.budget-alert-kpi__chip\s*\{[\s\S]{0,400}border-radius:\s*var\(--radius-pill\)/.test(componentsCss));
check("over-budget chip uses the danger colour",
  /\.budget-alert-kpi__chip--over\s*\{[\s\S]{0,200}color:\s*var\(--color-danger\)/.test(componentsCss));
check("on-track chip uses the muted text colour",
  /\.budget-alert-kpi__chip--ok\s*\{[\s\S]{0,200}color:\s*var\(--color-text-muted\)/.test(componentsCss));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
