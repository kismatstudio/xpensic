// Smoke test for the smart-search parser in util.js. The parser understands
// amount comparisons, time tokens, category names, and free-text matching.
// The Expenses view uses it for every search query, so regressions here
// directly affect the user's ability to find transactions.

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}` + (extra ? `  (${extra})` : "")); fail++; }
}

const { parseSearchQuery } = await import("../js/util.js");

const sampleCategories = [
  { id: "cat_food", name: "Food" },
  { id: "cat_transport", name: "Transport" },
  { id: "cat_housing", name: "Housing" },
];

// Build a sample set of expenses whose dates are *relative to today* so the
// "this month" / "this week" / "today" / "yesterday" / "last month" assertions
// stay correct regardless of when the test runs. The shape (one expense per
// day for 14 days, plus a couple outside the trailing 30 days) is what
// matters — not the specific dates.
const today = new Date();
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const day = (offset) => { const d = new Date(today); d.setDate(today.getDate() + offset); return d; };

// Per-day expenses covering the last 14 days. We assign category + amount
// deterministically so the test assertions are stable.
const perDay = (offset, cat, amt, note) => ({
  id: `e${offset >= 0 ? "p" : "m"}${Math.abs(offset)}`,  // e.g. ep0 (today), em1 (yesterday)
  amount: amt,
  date: isoOf(day(offset)),
  time: "12:00",
  categoryId: cat,
  note,
});
const expenses = [
  perDay(-13, "cat_food",    50,   "Old breakfast"),
  perDay(-7,  "cat_food",    200,  "Last-week food"),
  perDay(-3,  "cat_food",    250,  "Few-days-ago food"),
  perDay(-1,  "cat_transport", 100, "Yesterday's cab"),
  perDay(0,   "cat_food",    300,  "Today's coffee"),
  perDay(0,   "cat_housing", 1500, "Today's rent"),
  perDay(0,   "cat_food",    100,  "Today's snack"),
];
// "This month" includes both the current calendar month and last month
// when the test runs in early August. To make the assertion deterministic
// regardless of the run date, we also add an expense that's clearly inside
// last month and clearly outside this month (35 days ago).
expenses.push({
  id: "far_past",
  amount: 80,
  date: isoOf(day(-35)),
  time: "11:00",
  categoryId: "cat_food",
  note: "Old brunch",
});

const todayIds = expenses.filter((e) => e.date === isoOf(today)).map((e) => e.id).sort().join(",");
const yesterdayIds = expenses.filter((e) => e.date === isoOf(day(-1))).map((e) => e.id).sort().join(",");

const matches = (query) => {
  const q = parseSearchQuery(query, sampleCategories);
  return expenses.filter(q.match).map((e) => e.id).sort().join(",");
};

const describeOf = (query) => parseSearchQuery(query, sampleCategories).describe();

// Compute expected id sets for the relative-time tokens. We can't hard-code
// ids because the test runs against the *current* date.
const monthName = today.toLocaleString("en-US", { month: "long" });
const yearMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
const lastYearMonth = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}`;
const lastMonthName = lastMonth.toLocaleString("en-US", { month: "long" });
const lastMonthShort = lastMonthName.slice(0, 3);
const thisMonthName = monthName;
const thisMonthShort = monthName.slice(0, 3);

const idsThisMonth = (ym) => expenses.filter((e) => e.date.startsWith(ym)).map((e) => e.id).sort().join(",");
const idsThisYear = (y) => expenses.filter((e) => e.date.startsWith(String(y))).map((e) => e.id).sort().join(",");
const idsTrailingDays = (n) => {
  // Window: [today - (n-1), today] inclusive.
  const from = day(-(n - 1));
  return expenses.filter((e) => e.date >= isoOf(from) && e.date <= isoOf(today))
                 .map((e) => e.id).sort().join(",");
};
const allIds = expenses.map((e) => e.id).sort().join(",");
const foodIds = expenses.filter((e) => e.categoryId === "cat_food").map((e) => e.id).sort().join(",");
const housingIds = expenses.filter((e) => e.categoryId === "cat_housing").map((e) => e.id).sort().join(",");
const foodGt100 = expenses.filter((e) => e.categoryId === "cat_food" && e.amount > 100).map((e) => e.id).sort().join(",");
const foodLt100 = expenses.filter((e) => e.categoryId === "cat_food" && e.amount < 100).map((e) => e.id).sort().join(",");

// ---- Empty / free-text -----------------------------------------------------

console.log("\n[1] Empty query matches everything");
check("empty string",                matches("")    === allIds);
check("whitespace only",             matches("   ") === allIds);
check("empty query has empty description", describeOf("") === "");

// ---- Category names -------------------------------------------------------

console.log("\n[2] Category name matches the category's expenses");
check("'Food' matches all food expenses",      matches("Food")   === foodIds);
check("'Housing' matches all housing expenses", matches("Housing") === housingIds);
check("'food' (lowercase) also works",          matches("food")   === foodIds);
check("category description says 'category: Food'", describeOf("Food") === "category: Food");
check("'Old breakfast' (note text) matches the day-13 expense",
  matches("Old breakfast") === "em13");
check("'snack' (note text) matches today's snack", matches("snack") === "ep0");

// ---- Amount comparisons ---------------------------------------------------

console.log("\n[3] Amount comparisons");
const gt1000 = expenses.filter((e) => e.amount > 1000).map((e) => e.id).sort().join(",");
const ge1000 = expenses.filter((e) => e.amount >= 1000).map((e) => e.id).sort().join(",");
const lt200  = expenses.filter((e) => e.amount < 200).map((e) => e.id).sort().join(",");
const le100  = expenses.filter((e) => e.amount <= 100).map((e) => e.id).sort().join(",");
const eq250  = expenses.filter((e) => e.amount === 250).map((e) => e.id).sort().join(",");
const eq100  = expenses.filter((e) => e.amount === 100).map((e) => e.id).sort().join(",");
const rent   = expenses.filter((e) => e.amount === 1500).map((e) => e.id).sort().join(",");
const gt200  = expenses.filter((e) => e.amount > 200).map((e) => e.id).sort().join(",");
const ge1000n= expenses.filter((e) => e.amount >= 1000).map((e) => e.id).sort().join(",");
check("'>1000' matches amounts > 1000",  matches(">1000")  === gt1000);
check("'>=1000' includes exactly 1000",  matches(">=1000") === ge1000);
check("'<200' matches amounts < 200",     matches("<200")   === lt200);
check("'<=100' matches amounts <= 100",  matches("<=100")  === le100);
check("'=250' matches exactly 250",      matches("=250")   === eq250);
check("'100' (bare number) means '=100'", matches("100")   === eq100);
check("'₹1500' (currency prefix) works", matches("₹1500") === rent);
check("'Rs1500' (Rs prefix) works",      matches("Rs1500") === rent);
check("'>1000' description says '>1000'", describeOf(">1000")  === ">1000");
check("'>=1000' description says '≥1000'", describeOf(">=1000") === "≥1000");
check("'<200' description says '<200'",   describeOf("<200")   === "<200");

// ---- Time tokens ----------------------------------------------------------

console.log("\n[4] Time tokens (anchored to today)");
check("'today' matches today's expense(s)",   matches("today")     === todayIds);
check("'yesterday' matches yesterday's expense(s)", matches("yesterday") === yesterdayIds);

// 'this month' / 'last month' — anchored to the current date.
check(`'this month' matches all ${monthName} expenses`,  matches("this month") === idsThisMonth(yearMonth));
check(`'last month' matches all ${lastMonthName} expenses`, matches("last month") === idsThisMonth(lastYearMonth));
check("'this week' is the trailing 7 days",   matches("this week")  === idsTrailingDays(7));

// ---- Year / year-month tokens ---------------------------------------------

console.log("\n[5] Year and year-month tokens");
check(`'${today.getFullYear()}' matches all ${today.getFullYear()} expenses`,
  matches(String(today.getFullYear())) === idsThisYear(today.getFullYear()));
check(`'${yearMonth}' matches ${thisMonthName} ${today.getFullYear()} expenses`,
  matches(yearMonth) === idsThisMonth(yearMonth));
check(`'${lastYearMonth}' matches ${lastMonthName} ${lastMonth.getFullYear()} expenses`,
  matches(lastYearMonth) === idsThisMonth(lastYearMonth));

// ---- Month names ----------------------------------------------------------

console.log("\n[6] Month names (most recent occurrence)");
check(`'${thisMonthName}' matches ${thisMonthName} ${today.getFullYear()}`,
  matches(thisMonthName) === idsThisMonth(yearMonth));
check(`'${thisMonthShort}' (3-letter) matches ${thisMonthName}`,
  matches(thisMonthShort) === idsThisMonth(yearMonth));
check(`'${lastMonthName.toLowerCase()}' (lowercase) matches ${lastMonthName}`,
  matches(lastMonthName.toLowerCase()) === idsThisMonth(lastYearMonth));
check(`'${lastMonthShort.toLowerCase()}' (lowercase 3-letter) matches ${lastMonthName}`,
  matches(lastMonthShort.toLowerCase()) === idsThisMonth(lastYearMonth));

// ---- Combined: AND of multiple tokens -------------------------------------

console.log("\n[7] Multiple tokens are AND'd together");
const foodThisMonth = expenses.filter((e) => e.categoryId === "cat_food" && e.date.startsWith(yearMonth))
                              .map((e) => e.id).sort().join(",");
const foodGt100ThisMonth = expenses.filter((e) => e.categoryId === "cat_food" && e.amount > 100 && e.date.startsWith(yearMonth))
                                   .map((e) => e.id).sort().join(",");
const foodLt100ThisMonth = expenses.filter((e) => e.categoryId === "cat_food" && e.amount < 100 && e.date.startsWith(yearMonth))
                                   .map((e) => e.id).sort().join(",");
check(`'Food >100' matches food > 100`,                matches("Food >100") === foodGt100);
check(`'Food <100' matches food < 100`,                matches("Food <100") === foodLt100);
check(`'Food ${yearMonth}' matches this-month food`,   matches(`Food ${yearMonth}`) === foodThisMonth);
check(`'Food >100 ${yearMonth}' matches this-month food > 100`, matches(`Food >100 ${yearMonth}`) === foodGt100ThisMonth);
check(`'Food <100 ${yearMonth}' matches this-month food < 100`, matches(`Food <100 ${yearMonth}`) === foodLt100ThisMonth);
check("description shows multiple filters joined by ' · '",
  describeOf(`Food >100 ${yearMonth}`) === `category: Food · >100 · ${thisMonthName} ${today.getFullYear()}`);

// ---- Free-text matching ---------------------------------------------------

console.log("\n[8] Free-text matches against note + amount string");
const noteTextIds = (s) => expenses.filter((e) => (e.note || "").toLowerCase().includes(s.toLowerCase()))
                                  .map((e) => e.id).sort().join(",");
check("'coffee' matches today's coffee expense",  matches("coffee")     === noteTextIds("coffee"));
check("'cab' matches yesterday's cab expense",    matches("cab")        === noteTextIds("cab"));
check("'rent' matches today's rent expense",      matches("rent")       === noteTextIds("rent"));
check("'Old breakfast' matches the day-13 entry", matches("Old breakfast") === noteTextIds("Old breakfast"));

// ---- Whitespace + operator separation -------------------------------------

console.log("\n[9] Operator spacing is flexible");
check("'> 200' (space after >) works", matches("> 200")  === gt200);
check("'>= 1000' works",               matches(">= 1000") === ge1000n);
check("'< 200' (space after <) works", matches("< 200")   === lt200);

// ---- Edge cases -----------------------------------------------------------

console.log("\n[10] Edge cases");
check("query that matches nothing returns empty", matches("ZZZNothing") === "");
check("amount '0' as a bare token means '=0', matches nothing", matches("0") === "");
check("query that uses both time token and category ANDs them",
  matches("Food this month") === foodThisMonth);
check("time-token 'this year' matches everything in the current year",
  matches("this year") === idsThisYear(today.getFullYear()));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
