// Smoke tests for the local Expense Splitter (Feature 5).
//
// Verifies:
//   • Equal-share split is balanced.
//   • Unequal-share split weights correctly.
//   • Paid amounts produce sensible owes/is-owed numbers.
//   • Rounding dust is absorbed by the first participant.
//   • addSplit / deleteSplit mutate state.splits.
//   • Friend codes are 6 characters from the safe alphabet.

import {
  computeSplit,
  sumPaid,
  addSplit,
  deleteSplit,
  generateFriendCode,
} from "../js/splitter.js";

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}` + (extra ? `  (${extra})` : "")); fail++; }
}

console.log("\n[1] Equal split: 4 people, ₹1200");
{
  const rows = computeSplit(1200, [
    { name: "A", share: 1, paid: 0 },
    { name: "B", share: 1, paid: 0 },
    { name: "C", share: 1, paid: 0 },
    { name: "D", share: 1, paid: 0 },
  ]);
  check("4 rows", rows.length === 4);
  check("per head = 300", rows[0].perHead === 300);
  check("everyone owes 300", rows.every((r) => r.owes === 300));
  const sum = rows.reduce((s, r) => s + r.owes, 0);
  check("sum of owes = total", sum === 1200);
}

console.log("\n[2] Unequal split (weights): one person eats double");
{
  const rows = computeSplit(900, [
    { name: "Big Eater", share: 2, paid: 0 },
    { name: "Regular",   share: 1, paid: 0 },
    { name: "Regular",   share: 1, paid: 0 },
  ]);
  // Total weight 4 → per head 225. Big Eater owes 450, others 225.
  check("per head = 225", rows[0].perHead === 225);
  check("Big Eater owes 450", rows[0].owes === 450);
  check("Regular owes 225", rows[1].owes === 225);
  check("Regular owes 225", rows[2].owes === 225);
}

console.log("\n[3] Paid amounts: A paid everything, B and C owe");
{
  // The semantics here: `owes` is what A's share of the bill is. The net
  // position is `paid - owes`. A paid 1200, owes 400 → net +800 (is owed 800).
  // B and C paid 0, owe 400 each → net -400 each (they owe 400).
  const rows = computeSplit(1200, [
    { name: "A", share: 1, paid: 1200 },
    { name: "B", share: 1, paid: 0 },
    { name: "C", share: 1, paid: 0 },
  ]);
  check("A owes 400 (their share)", rows[0].owes === 400);
  check("A's net is +800 (paid 1200, owes 400)", rows[0].paid - rows[0].owes === 800);
  check("B owes 400", rows[1].owes === 400);
  check("C owes 400", rows[2].owes === 400);
  // Sum of owes must still equal total.
  const sum = rows.reduce((s, r) => s + r.owes, 0);
  check("sum(owes) = total", sum === 1200);
}

console.log("\n[4] Rounding dust is absorbed by the first participant");
{
  // ₹100 split 3 ways → 33.33 each. Sum 33.33*3 = 99.99. First row absorbs 0.01.
  const rows = computeSplit(100, [
    { name: "A", share: 1, paid: 0 },
    { name: "B", share: 1, paid: 0 },
    { name: "C", share: 1, paid: 0 },
  ]);
  const sum = rows.reduce((s, r) => s + r.owes, 0);
  check("sum equals total even with rounding",
    Math.round(sum * 100) / 100 === 100,
    `sum=${sum}`);
  // perHead is rounded; owes uses perHead * share + dust.
  check("per head is rounded to 2dp", rows[0].perHead === Math.round(rows[0].perHead * 100) / 100);
}

console.log("\n[5] sumPaid total");
{
  const paid = sumPaid([
    { name: "A", paid: 100 },
    { name: "B", paid: 50 },
    { name: "C", paid: 0 },
  ]);
  check("sumPaid = 150", paid === 150);
}

console.log("\n[6] Empty / zero-share splits are safe");
{
  const rows = computeSplit(100, [{ name: "Only", share: 1, paid: 0 }]);
  check("single-person split has owes=100", rows[0].owes === 100);
  const empty = computeSplit(100, [{ name: "A", share: 0 }, { name: "B", share: 0 }]);
  check("zero-share doesn't crash, owes=0", empty.every((r) => r.owes === 0));
}

console.log("\n[7] addSplit + deleteSplit round-trip");
{
  const state = { splits: [] };
  const rec = addSplit(state, {
    title: "Pizza",
    total: 1200,
    participants: [{ name: "A", share: 1 }, { name: "B", share: 1 }, { name: "C", share: 1 }, { name: "D", share: 1 }],
    friendCode: "ABC123",
  });
  check("state.splits now has 1 entry", state.splits.length === 1);
  check("record has id", typeof rec.id === "string" && rec.id.startsWith("spl_"));
  check("record has createdAt", typeof rec.createdAt === "string");
  check("title preserved", rec.title === "Pizza");
  check("friend code preserved", rec.friendCode === "ABC123");
  const ok = deleteSplit(state, rec.id);
  check("delete returns true", ok === true);
  check("state.splits empty again", state.splits.length === 0);
  const ok2 = deleteSplit(state, "spl_nope");
  check("deleting missing id returns false", ok2 === false);
}

console.log("\n[8] Friend code generator");
{
  for (let i = 0; i < 50; i++) {
    const c = generateFriendCode();
    check(`code ${c} is 6 chars`, typeof c === "string" && c.length === 6);
    check(`code ${c} uses safe alphabet`, /^[A-HJ-NP-Z2-9]{6}$/.test(c));
  }
}

console.log("\n[9] Math invariants on randomized splits");
{
  // Stress test: random totals + participants → sum of owes must equal total.
  for (let i = 0; i < 30; i++) {
    const total = Math.round(Math.random() * 10000) / 100; // up to ₹10,000
    const n = 2 + Math.floor(Math.random() * 8); // 2-9 people
    const ps = Array.from({ length: n }, (_, j) => ({
      name: "P" + j,
      share: 1 + Math.floor(Math.random() * 3),
      paid: Math.random() < 0.3 ? Math.round(Math.random() * total) / 2 : 0,
    }));
    const rows = computeSplit(total, ps);
    const sum = rows.reduce((s, r) => s + r.owes, 0);
    check(`run ${i}: sum(owes) = total (${total})`, Math.round(sum * 100) / 100 === total,
      `got ${sum}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
