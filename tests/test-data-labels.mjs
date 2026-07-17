// Smoke test for the data-label attribute on Expenses table <td>s.
// Verifies the rendered HTML for the Expenses view contains data-label
// on every cell, in the right order, matching the table headers.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const expensesSrc = readFileSync(join(__dirname, "..", "js", "views", "expenses.js"), "utf8");
const cssSrc = readFileSync(join(__dirname, "..", "css", "components.css"), "utf8");

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}` + (extra ? `  (${extra})` : "")); fail++; }
}

console.log("\n[1] Each <td> in the row template has a data-label");
const expectedLabels = ["Date", "Category", "Note", "Payment", "Amount", "Actions"];
for (const label of expectedLabels) {
  const re = new RegExp(`<td[^>]*data-label="${label}"`);
  check(`<td> for "${label}"`, re.test(expensesSrc), `pattern: ${re}`);
}

console.log("\n[2] data-label order matches the table header order");
// Pull the column headers in order from the template.
const headerOrder = [...expensesSrc.matchAll(/<th(?:\s+class="[^"]*")?>([^<]+)<\/th>/g)].map(m => m[1].trim());
check("found 6 headers", headerOrder.length === 6, `got ${headerOrder.length}`);
const cellOrder = [...expensesSrc.matchAll(/<td[^>]*data-label="([^"]+)"/g)].map(m => m[1]);
const orderMatches = JSON.stringify(headerOrder) === JSON.stringify(cellOrder);
check("cell order matches header order", orderMatches, `headers=${JSON.stringify(headerOrder)} cells=${JSON.stringify(cellOrder)}`);

console.log("\n[3] CSS has the data-label pseudo-element rule");
// Count .data-table tbody td::before blocks inside any @media (max-width: 720px).
const dataLabelRules = (cssSrc.match(/\.data-table\s+tbody\s+td::before\s*{[^}]*attr\(data-label\)/g) || []).length;
check("exactly one ::before rule using attr(data-label)", dataLabelRules === 1, `found ${dataLabelRules}`);

// Also ensure the file doesn't have a duplicate of the full mobile data-table block.
const dataTableMobileBlocks = (cssSrc.match(/@media\s*\(max-width:\s*720px\)\s*{[^}]*\.data-table\s+thead\s*{\s*display:\s*none/g) || []).length;
check("exactly one @media block hides the data-table thead", dataTableMobileBlocks === 1, `found ${dataTableMobileBlocks}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
