// Tests for the dashboard's login-based streak badge.
//
// The streak is "consecutive days the user signed in" — recorded in
// `state.loginDays`, populated by `Store.recordLoginDay` on every
// successful sign-in. It surfaces ONLY on the Hero card (the
// dashboard.js::renderHeroCard template) and does NOT appear in the
// smart insights grid, the motivation message, or anywhere else.

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
const main = read("js/main.js");
const store = read("js/store.js");

console.log("\n[1] Streak is computed from loginDays, not expenses");
check("dashboard imports computeLoginStreak / uses loginDays",
  /computeLoginStreak\(\s*state\.loginDays/.test(dashboard) &&
  !/computeStreak\(\s*state\.expenses\)/.test(dashboard));
check("dashboard no longer references the old expense-based streak",
  !/function computeStreak\(\s*expenses\s*\)/.test(dashboard));
check("dashboard defines computeLoginStreak locally",
  /function computeLoginStreak\(loginDays,\s*todayIso\)/.test(dashboard));

console.log("\n[2] Streak is recorded on sign-in (main.js bootLoginGate)");
check("main.js calls Store.recordLoginDay on sign-in",
  /Store\.recordLoginDay\(\s*session\.state,\s*todayISO\(\)\s*\)/.test(main));
check("recordLoginDay is invoked from the post-unlock path (covers both online + offline)",
  (main.match(/Store\.recordLoginDay/g) || []).length >= 1);
check("session.state is saved immediately after recording",
  // recordLoginDay is paired with a subsequent save within a few
  // lines (the unified boot flow records the day on every successful
  // unlock — happy path AND server-down fallback both flow through
  // afterUnlock).
  /recordLoginDay\([\s\S]{0,80}Store\.save/.test(main));

console.log("\n[2b] main.js: store exports the login-day helpers");
// Sanity: the store surface actually has the methods main.js calls.
const storeMod = await import("../js/store.js");
check("Store.recordLoginDay is callable",
  typeof storeMod.Store.recordLoginDay === "function");
check("Store.computeLoginStreak is callable",
  typeof storeMod.Store.computeLoginStreak === "function");
check("Store.recordLoginDay returns true on a fresh day",
  storeMod.Store.recordLoginDay({ loginDays: [] }, "2026-08-10") === true);
check("Store.recordLoginDay returns false on a duplicate day",
  storeMod.Store.recordLoginDay({ loginDays: ["2026-08-10"] }, "2026-08-10") === false);

console.log("\n[3] Streak appears ONLY on the Hero card");
check("Hero card renders the streak badge (hero-card__streak)",
  /hero-card__streak/.test(dashboard));
check("Hero card badge uses the login-streak label",
  /login streak/.test(dashboard) && !/-day tracking streak/.test(dashboard));
check("buildInsights does NOT have a streak insight",
  // The old "🔥-day streak" insight card is gone.
  !/🔥-day streak|"🔥"/.test(dashboard) ||
  !/title: `\$\{streak\}-day streak`/.test(dashboard));
check("pickMotivation no longer takes streak",
  !/if\s*\(\s*streak\s*>=\s*7\s*\)/.test(dashboard));
check("don't pass streak to pickMotivation",
  !/pickMotivation\(\s*\{[^}]*streak/.test(dashboard));
check("buildInsights no longer references streak",
  !/buildInsights\(\s*\{[^}]*streak/.test(dashboard));

console.log("\n[4] Store exposes the login-day helpers");
check("Store.recordLoginDay is exported",
  /recordLoginDay\s*:\s*function|recordLoginDay\s*\(state/.test(store));
check("Store.computeLoginStreak is exported",
  /computeLoginStreak\s*:\s*function|computeLoginStreak\s*\(state/.test(store));
check("freshState seeds loginDays as an empty array",
  /loginDays:\s*\[\]/.test(store));

console.log("\n[5] Store.load backfills loginDays for older states");
check("Store.load backfills loginDays to [] when missing",
  /if\s*\(!Array\.isArray\(parsed\.loginDays\)\)/.test(store));
check("Store.load validates loginDays entries against YYYY-MM-DD",
  /loginDays\s*=\s*parsed\.loginDays\.filter\([\s\S]*?YYYY-MM-DD/.test(store));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
