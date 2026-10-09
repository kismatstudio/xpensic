// Regression test: the categories Edit → Save flow must actually call
// Store.updateCategory. Previously the call was merged onto a `//` comment
// line, so it was silently commented out — the toast showed "Category updated"
// but the name/color never changed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "..", "js", "views", "categories.js"), "utf8");

let pass = 0;
let fail = 0;
const check = (label, ok) => {
  if (ok) pass++;
  else {
    fail++;
    console.error("  FAIL:", label);
  }
};

console.log("[categories.js] Edit → Save must call Store.updateCategory");

// 1. The updateCategory call must exist on its own line (not commented out).
const callLine = src.split("\n").find((l) => l.includes("Store.updateCategory"));
check("Store.updateCategory call present", !!callLine);
check("call is not commented out", !!callLine && !callLine.trim().startsWith("//"));

// 2. The save handler must call updateCategory BEFORE save, and re-render
//    the list after saving (so the new name shows). Scope to the block that
//    contains the updateCategory call.
const updateIdx = src.indexOf("Store.updateCategory");
const block = src.slice(updateIdx, updateIdx + 400);
const saveIdx = block.indexOf("Store.save(state)");
check("updateCategory appears before save in handler", saveIdx !== -1);
check("renderList called after save", block.indexOf("renderList()") > saveIdx);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);