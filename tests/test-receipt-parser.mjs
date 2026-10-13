// Receipt parser: realistic OCR text → total, category, date, merchant, items.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { parseReceipt, findTotal, moneyTokens } from "../js/receipt.js";

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}` + (extra ? `  (${extra})` : "")); fail++; }
}
const NOW = new Date(2025, 9, 20);

const RESTAURANT = `HOTEL SARAVANA BHAVAN
12, MG Road, Bengaluru
GSTIN 29ABCDE1234F1Z5
Bill No: 4521   Date: 12/03/2025 08:45 PM
Table 7   Waiter: Raju
Masala Dosa     2   160.00
Filter Coffee   2    80.00
Paneer Butter Masala 1 220.00
Butter Naan     3   120.00
Sub Total               580.00
CGST 2.5%               14.50
SGST 2.5%               14.50
Round off               0.00
Grand Total             609.00
Thank you Visit Again`;
{
  const r = parseReceipt(RESTAURANT, NOW);
  console.log("\n[1] Restaurant bill");
  check("grand total picked (not subtotal)", r.total === 609, `got ${r.total}`);
  check("confidence high", r.totalConfidence === "high");
  check("category = Food & Dining", r.categoryId === "cat_food", r.categoryId);
  check("date 2025-03-12", r.date === "2025-03-12", r.date);
  check("time 20:45", r.time === "20:45", r.time);
  check("merchant", /SARAVANA BHAVAN/.test(r.merchant), r.merchant);
  check("4 items found, taxes excluded", r.items.length === 4, JSON.stringify(r.items));
  check("item name cleaned", r.items[0]?.name === "Masala Dosa", r.items[0]?.name);
}

const GROCERY = `D MART
AVENUE SUPERMARTS LTD
Tax Invoice
Date 05-10-2025 18:22
Aashirvaad Atta 5kg 1 255.00
Amul Milk 1L 2 132.00
Tomato 1kg 40.00
Onion 2kg 64.00
Surf Excel Detergent 1 210.00
Total Items: 6
Total Qty: 7
Total Savings 36.00
Total 701.00`;
{
  const r = parseReceipt(GROCERY, NOW);
  console.log("\n[2] Grocery bill");
  check("total 701 (not savings / qty)", r.total === 701, `got ${r.total}`);
  check("category = Groceries", r.categoryId === "cat_groceries", r.categoryId);
  check("date 2025-10-05", r.date === "2025-10-05", r.date);
}

const FUEL = `INDIAN OIL
SRI LAKSHMI FUEL STATION
Date: 18/10/2025  Time: 07:12
Product: PETROL
Rate/Ltr: 104.50
Volume(Ltr): 5.20
Amount: 543.40
TOTAL Rs. 543.40
Thank You`;
{
  const r = parseReceipt(FUEL, NOW);
  console.log("\n[3] Fuel bill");
  check("total 543.40", r.total === 543.4, `got ${r.total}`);
  check("category = Fuel & Transportation", r.categoryId === "cat_transport", r.categoryId);
}

const PHARMACY = `APOLLO PHARMACY
Cash Memo
Dolo 650 Tab 10s   30.00
Cetirizine Strip   25.50
Crocin Syrup       78.00
MRP Total          133.50
Discount           13.35
Net Amount Payable 120.15
Paid by CASH`;
{
  const r = parseReceipt(PHARMACY, NOW);
  console.log("\n[4] Pharmacy bill");
  check("net payable 120.15", r.total === 120.15, `got ${r.total}`);
  check("category = Healthcare", r.categoryId === "cat_health", r.categoryId);
  check("payment hint cash", r.payment.paymentMethod === "cash");
}

console.log("\n[5] Amount handling");
check("OCR slip 1,2S0.00 → 1250", findTotal(["Grand Total 1,2S0.00"]).total === 1250);
check("Indian grouping 1,23,456.00", findTotal(["TOTAL 1,23,456.00"]).total === 123456);
check("Total pre-tax then Grand Total: grand wins",
  findTotal(["Total 450.00", "GST 22.50", "Grand Total 472.50"]).total === 472.5);
check("Sub total ignored when Total present",
  findTotal(["Sub Total 1000.00", "Discount 100.00", "Total 900.00"]).total === 900);
check("European 1.250,00", moneyTokens("Total 1.250,00")[0].value === 1250);
check("no keyword → largest decimal, low confidence", (() => {
  const r = findTotal(["Tea 20.00", "Samosa 35.50", "Water 10.00"]);
  return r.total === 35.5 && r.confidence === "low";
})());
check("phone/GSTIN lines are not amounts", findTotal(["Phone 9876543210", "GSTIN 29ABCDE1234F1Z5", "Total 99.00"]).total === 99);
check("alternatives are offered", findTotal(["Total 450.00", "Grand Total 472.50"]).candidates.includes(450));
check("empty text → null", parseReceipt("", NOW).total === null);

const CINEMA = `PVR CINEMAS
Movie: Jawan  Ticket x2   700.00
Popcorn Combo   350.00
Total 1050.00`;
{
  const r = parseReceipt(CINEMA, NOW);
  console.log("\n[6] Cinema bill");
  check("category = Entertainment", r.categoryId === "cat_entertainment", r.categoryId);
  check("total 1050", r.total === 1050, `got ${r.total}`);
}

{
  const r = parseReceipt("Some Shop\nXYZ 123.00\nTotal 123.00", NOW);
  console.log("\n[7] Unknown merchant");
  check("falls back to Other with low confidence", r.categoryId === "cat_other" && r.categoryConfidence === "low", r.categoryId);
}

console.log("\n[8] Alternatives & item rows");
{
  const r = parseReceipt(RESTAURANT, NOW);
  check("item prices are not offered as alternative totals", !r.otherAmounts.includes(160) && !r.otherAmounts.includes(220), JSON.stringify(r.otherAmounts));
  const g = parseReceipt(GROCERY + "\nCASH 701.00", NOW);
  check("payment rows are not items", !g.items.some((i) => /cash/i.test(i.name)), JSON.stringify(g.items.map((i) => i.name)));
}

console.log("\n[9] Wiring");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const main = readFileSync(join(root, "js/main.js"), "utf8");
check("Scan Receipt opens the scanner (no more Coming Soon)", /openScanReceipt\(\{/.test(main) && !/Coming Soon/.test(main));
const ui = readFileSync(join(root, "js/views/scan-receipt.js"), "utf8");
check("camera + gallery inputs", /capture="environment"/.test(ui) && /id="scan-input-gallery"/.test(ui));
const engine = readFileSync(join(root, "js/receipt-scan.js"), "utf8");
check("note is left blank for the user", /note: "",/.test(engine) && /note: ""/.test(engine.slice(engine.indexOf("export function scanToExpense"))));
const form = readFileSync(join(root, "js/views/expense-form.js"), "utf8");
check("Add Expense's Receipt field scans the image and fills the form",
  /readReceiptFile\(file/.test(form) && /function applyScan/.test(form) &&
  /receiptField\.querySelector\("#exp-receipt"\)\.addEventListener\("change"/.test(form));
check("scan never writes the Note field",
  !/noteGroup\.input\.value\s*=/.test(form.slice(form.indexOf("function applyScan"), form.indexOf("async function scanReceipt"))));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
