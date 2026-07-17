// Smoke test for the date-helper dedupe (punchlist #4).
// Verifies that:
//   • The local function definitions are gone from main.js, dashboard.js,
//     and budgets.js.
//   • Each file imports the helpers it uses from util.js.
//   • util.js exports the helpers and they produce correct values.

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

const main = read("js/main.js");
const dashboard = read("js/views/dashboard.js");
const budgets = read("js/views/budgets.js");
const util = read("js/util.js");

console.log("\n[1] util.js exports the date helpers");
check("util.js exports startOfMonth", /^export\s+function\s+startOfMonth/m.test(util));
check("util.js exports monthKey",      /^export\s+function\s+monthKey/m.test(util));
check("util.js exports formatMonth",   /^export\s+function\s+formatMonth/m.test(util));
check("util.js exports todayISO",      /^export\s+function\s+todayISO/m.test(util));
check("util.js exports currentTimeHHMM", /^export\s+function\s+currentTimeHHMM/m.test(util));

console.log("\n[2] main.js: no local date-helper definitions, helpers imported");
check("main.js has no local startOfMonth definition", !/^function\s+startOfMonth/m.test(main));
check("main.js has no local monthKey definition",     !/^function\s+monthKey/m.test(main));
check("main.js has no local formatMonth definition",  !/^function\s+formatMonth/m.test(main));
check("main.js has no local MONTH_NAMES constant",    !/^const\s+MONTH_NAMES\s*=/m.test(main));
check("main.js imports startOfMonth",   /from\s+"\.\/util\.js"/.test(main) && /\bstartOfMonth\b/.test(main.split("\n").slice(0, 30).join("\n")));
check("main.js imports monthKey",       /from\s+"\.\/util\.js"/.test(main) && /\bmonthKey\b/.test(main.split("\n").slice(0, 30).join("\n")));
check("main.js imports formatMonth",    /from\s+"\.\/util\.js"/.test(main) && /\bformatMonth\b/.test(main.split("\n").slice(0, 30).join("\n")));

console.log("\n[3] dashboard.js: no local date-helper definitions, helpers imported");
check("dashboard.js has no local monthKey definition",     !/^function\s+monthKey/m.test(dashboard));
check("dashboard.js has no local formatMonth definition",  !/^function\s+formatMonth/m.test(dashboard));
check("dashboard.js has no local todayISO definition",     !/^function\s+todayISO/m.test(dashboard));
check("dashboard.js has no local currentTimeHHMM defn",    !/^function\s+currentTimeHHMM/m.test(dashboard));
check("dashboard.js has no shadowing const monthKey",      !/const\s+monthKey\s*=/.test(dashboard));
check("dashboard.js imports todayISO",        /\btodayISO\b/.test(dashboard.split("\n").slice(0, 35).join("\n")));
check("dashboard.js imports currentTimeHHMM", /\bcurrentTimeHHMM\b/.test(dashboard.split("\n").slice(0, 35).join("\n")));
check("dashboard.js imports monthKey",        /\bmonthKey\b/.test(dashboard.split("\n").slice(0, 35).join("\n")));
check("dashboard.js imports formatMonth",     /\bformatMonth\b/.test(dashboard.split("\n").slice(0, 35).join("\n")));

console.log("\n[4] budgets.js: no local date-helper definitions, helpers imported");
check("budgets.js has no local startOfMonth definition", !/^function\s+startOfMonth/m.test(budgets));
check("budgets.js has no local monthKey definition",     !/^function\s+monthKey/m.test(budgets));
check("budgets.js has no local formatMonth definition",  !/^function\s+formatMonth/m.test(budgets));
check("budgets.js imports startOfMonth", /from\s+"\.\.\/util\.js"/.test(budgets) && /\bstartOfMonth\b/.test(budgets.split("\n").slice(0, 30).join("\n")));
check("budgets.js imports monthKey",     /from\s+"\.\.\/util\.js"/.test(budgets) && /\bmonthKey\b/.test(budgets.split("\n").slice(0, 30).join("\n")));
check("budgets.js imports formatMonth",  /from\s+"\.\.\/util\.js"/.test(budgets) && /\bformatMonth\b/.test(budgets.split("\n").slice(0, 30).join("\n")));

console.log("\n[5] Functional check: imports behave correctly");
const { startOfMonth, monthKey, formatMonth, todayISO, currentTimeHHMM } = await import("../js/util.js");
const d = new Date(2026, 6, 10, 14, 30); // July 10, 2026, 14:30 local
check("startOfMonth returns July 1, 2026", startOfMonth(d).getDate() === 1 && startOfMonth(d).getMonth() === 6 && startOfMonth(d).getFullYear() === 2026);
check('monthKey("2026-07-10") === "2026-07"', monthKey(d) === "2026-07");
check('formatMonth(d) === "July 2026"', formatMonth(d) === "July 2026");
check("todayISO returns YYYY-MM-DD with 10 chars", /^\d{4}-\d{2}-\d{2}$/.test(todayISO()));
check("currentTimeHHMM returns HH:MM with 5 chars", /^\d{2}:\d{2}$/.test(currentTimeHHMM()));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
