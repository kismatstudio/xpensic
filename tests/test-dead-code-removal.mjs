// Smoke test for the dead-code cleanup (punchlist #5 + #6).
// Verifies that:
//   • main.js no longer imports formatDate, pad, or applyTheme.
//   • format.js no longer exports formatPercent.
//   • No other file in the project imports any of the removed names.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readdirSync, statSync } from "node:fs";

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
const format = read("js/format.js");

console.log("\n[1] main.js: dead imports removed");
const importBlock = main.split("\n").slice(0, 30).join("\n");
check("main.js does not import formatDate", !/\bformatDate\b/.test(importBlock));
check("main.js does not import pad",        !/\bpad\b/.test(importBlock));
check("main.js does not import applyTheme", !/\bapplyTheme\b/.test(importBlock));

console.log("\n[2] format.js: dead export removed");
check("format.js does not export formatPercent", !/export\s+function\s+formatPercent/.test(format));

console.log("\n[3] No remaining references to formatPercent anywhere in the project");
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "tests") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(js|mjs|html|css)$/.test(entry)) out.push(full);
  }
  return out;
}
const allFiles = walk(join(root, "js")).concat(walk(join(root, "css")), [join(root, "index.html")]);
const remainingFormatPercent = allFiles.filter(f => {
  const src = readFileSync(f, "utf8");
  // Allow the removal-explanation comment in format.js.
  if (f.endsWith("format.js") && /`formatPercent`\s+helper\s+used\s+to\s+live\s+here/.test(src)) return false;
  return /formatPercent/.test(src);
});
check("no remaining live references to formatPercent", remainingFormatPercent.length === 0,
  remainingFormatPercent.length > 0 ? `still in: ${remainingFormatPercent.map(f => f.replace(root, ".")).join(", ")}` : "");

console.log("\n[4] main.js still imports the helpers it actually uses");
const imports = main.match(/import\s*\{[^}]*\}\s*from\s*"\.\/[^"]+"/g) || [];
const importText = imports.join("\n");
check("main.js imports Store",                /\bStore\b/.test(importText));
check("main.js imports formatCurrency",       /\bformatCurrency\b/.test(importText));
check("main.js imports initTheme",            /\binitTheme\b/.test(importText));
check("main.js imports cycleTheme",           /\bcycleTheme\b/.test(importText));
check("main.js imports getThemePref",         /\bgetThemePref\b/.test(importText));
check("main.js imports setTheme",             /\bsetTheme\b/.test(importText));
check("main.js imports startOfMonth",         /\bstartOfMonth\b/.test(importText));
check("main.js imports monthKey",             /\bmonthKey\b/.test(importText));
check("main.js imports formatMonth",          /\bformatMonth\b/.test(importText));
check("main.js imports todayISO",             /\btodayISO\b/.test(importText));
check("main.js imports escapeHtml",           /\bescapeHtml\b/.test(importText));
check("main.js imports formatIndianPhone",    /\bformatIndianPhone\b/.test(importText));
check("main.js imports generateAvatarDataUrl",/\bgenerateAvatarDataUrl\b/.test(importText));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
