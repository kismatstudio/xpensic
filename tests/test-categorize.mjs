// Category auto-detection from product / expense text.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { classifyText } from "../js/categorize.js";
import { parseVoiceCommand } from "../js/voice.js";
import { suggestCategory } from "../js/util.js";

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}` + (extra ? `  (${extra})` : "")); fail++; }
}
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const DEFAULTS = [
  "cat_food", "cat_groceries", "cat_housing", "cat_utilities", "cat_internet", "cat_transport", "cat_health",
  "cat_education", "cat_shopping", "cat_entertainment", "cat_travel", "cat_gifts", "cat_loans", "cat_investments", "cat_other",
].map((id) => ({ id, name: id.replace("cat_", ""), isDefault: true }));

console.log("\n[1] Products and services → category");
const CASES = [
  ["cricket bat", "cat_shopping"],
  ["lunch at dominos", "cat_food"],
  ["masala dosa", "cat_food"],
  ["biriyani", "cat_food"],            // spelling variant
  ["pizzza", "cat_food"],              // typo
  ["swiggy order", "cat_food"],
  ["coffee", "cat_food"],
  ["milk and bread", "cat_groceries"],
  ["vegetables", "cat_groceries"],
  ["bigbasket", "cat_groceries"],
  ["detergent", "cat_groceries"],
  ["petrol", "cat_transport"],
  ["uber to airport", "cat_transport"],
  ["metro card recharge", "cat_transport"],
  ["fastag", "cat_transport"],
  ["house rent", "cat_housing"],
  ["plumber", "cat_housing"],
  ["electricity bill", "cat_utilities"],
  ["gas cylinder", "cat_utilities"],
  ["airtel recharge", "cat_internet"],
  ["wifi bill", "cat_internet"],
  ["medicines", "cat_health"],
  ["doctor consultation", "cat_health"],
  ["gym membership", "cat_health"],
  ["blood test", "cat_health"],
  ["udemy course", "cat_education"],
  ["school fees", "cat_education"],
  ["notebooks", "cat_education"],
  ["iphone", "cat_shopping"],
  ["nike shoes", "cat_shopping"],
  ["amazon", "cat_shopping"],
  ["headphones", "cat_shopping"],
  ["netflix", "cat_entertainment"],
  ["movie tickets", "cat_entertainment"],
  ["spotify subscription", "cat_entertainment"],
  ["flight tickets", "cat_travel"],
  ["goa trip", "cat_travel"],
  ["oyo booking", "cat_travel"],
  ["birthday gift", "cat_gifts"],
  ["donation", "cat_gifts"],
  ["home loan emi", "cat_loans"],
  ["credit card bill", "cat_loans"],
  ["mutual fund sip", "cat_investments"],
  ["zerodha", "cat_investments"],
  ["bus ticket", "cat_transport"],
];
for (const [text, want] of CASES) {
  const r = classifyText(text, { categories: DEFAULTS });
  check(`"${text}" → ${want}`, r && r.categoryId === want, r ? r.categoryId : "no match");
}

console.log("\n[2] Edge handling");
check("empty text → null", classifyText("", { categories: DEFAULTS }) === null);
check("unknown product → null (or Other when asked)",
  classifyText("xyzzy widget", { categories: DEFAULTS }) === null &&
  classifyText("xyzzy widget", { categories: DEFAULTS, fallbackOther: true })?.categoryId === "cat_other");
check("amounts and filler words don't confuse it", classifyText("paid 450 rupees for dinner", { categories: DEFAULTS })?.categoryId === "cat_food");
check("only the user's categories are returned",
  classifyText("pizza", { categories: DEFAULTS.filter((c) => c.id !== "cat_food") })?.categoryId !== "cat_food");

console.log("\n[3] The user's own categories and history");
{
  const cats = [...DEFAULTS, { id: "c_pets", name: "Pets", isDefault: false }];
  check("custom category name matches", classifyText("pets vet visit", { categories: cats })?.categoryId === "c_pets");
  const history = [
    { note: "gym", categoryId: "cat_other" },
    { note: "Raju tiffin", categoryId: "cat_groceries" },
  ];
  const r = classifyText("gym", { categories: DEFAULTS, expenses: history });
  check("an exact note from the user's history wins", r?.categoryId === "cat_other" && r.source === "history");
  const h2 = [
    { note: "ramesh store", categoryId: "cat_groceries" },
    { note: "ramesh store stuff", categoryId: "cat_groceries" },
  ];
  check("a word the user categorised consistently is learned",
    classifyText("ramesh", { categories: DEFAULTS, expenses: h2 })?.categoryId === "cat_groceries");
  check("history for a category they no longer have is ignored",
    classifyText("gym", { categories: DEFAULTS.filter((c) => c.id !== "cat_other"), expenses: history })?.categoryId === "cat_health");
}

console.log("\n[4] Voice and the old API");
check("voice: cricket bat 1200 → Shopping",
  parseVoiceCommand("Cricket bat 1200 rupees", DEFAULTS).categoryId === "cat_shopping");
check("voice: one lakh for house rent → Housing",
  parseVoiceCommand("One Lakh rupees for House rent", DEFAULTS).categoryId === "cat_housing");
check("voice: 450 petrol → Transport", parseVoiceCommand("450 petrol", DEFAULTS).categoryId === "cat_transport");
check("suggestCategory() still returns { id, word }", (() => { const m = suggestCategory("coffee 180"); return m && m.id === "cat_food"; })());

console.log("\n[5] Wiring in every entry path");
const form = read("js/views/expense-form.js");
check("Add Expense auto-selects the category as the note is typed", /classifyText\(/.test(form) && /autoSelectCategory/.test(form));
const dash = read("js/views/dashboard.js");
check("Quick Add auto-selects the category as text is typed", /classifyText\(/.test(dash) && /autoSelectCategory/.test(dash));
check("Quick Add no longer always saves the first category", /categoryTouched/.test(dash));
check("receipt scanning refines with the same classifier", /classifyText\(/.test(read("js/receipt-scan.js")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
