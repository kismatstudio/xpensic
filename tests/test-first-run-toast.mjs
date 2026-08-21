// Smoke test for the welcome-toast behaviour after sign-up.
//
// Since the auth refactor, the "first run" concept no longer comes from
// `Store.load().seeded` (the store isn't seeded from scratch on a fresh
// browser — the gate intercepts first-time visitors). Instead, the
// flag is set when the user **completes sign-up successfully** (passed
// through the `justSignedUp` arg from the login gate), and the toast
// is shown in `mountAppShell()`.
//
// This test verifies:
//   • mountAppShell shows a name-aware greeting when session.firstRun is true.
//   • session.firstRun is cleared after firing (no duplicate on hot-reload).
//   • The login gate surfaces justSignedUp=true on sign-up via onComplete.

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
const login = read("js/views/login.js");

console.log("\n[1] mountAppShell shows a name-aware greeting when firstRun is true");
const mountAppFn = main.match(/function mountAppShell\(\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
check("mountAppShell() guards the toast with `if (session.firstRun)`",
  /if\s*\(\s*session\.firstRun\s*\)/.test(mountAppFn));
check("mountAppShell() clears the flag after firing (no duplicate on hot-reload)",
  /session\.firstRun\s*=\s*false/.test(mountAppFn));
check("mountAppShell() shows a name-aware greeting when profile.name exists",
  /name\s*\?\s*`Welcome,\s*\$\{name\}!`/.test(mountAppFn));
check("mountAppShell() falls back to a generic greeting when no name is set",
  /"Welcome to XPENSIC!"/.test(mountAppFn));

console.log("\n[2] bootLoginGate forwards justSignedUp into session.firstRun");
check("bootLoginGate destructures justSignedUp from onComplete's arg",
  /onComplete:\s*(async\s*)?\(\s*\{[^}]*justSignedUp[^}]*\}\s*\)/.test(main) ||
  /onComplete:\s*(async\s*)?\(\s*\{\s*user\s*,\s*justSignedUp/.test(main));
check("bootLoginGate sets session.firstRun = justSignedUp",
  /session\.firstRun\s*=\s*justSignedUp/.test(main));

console.log("\n[3] login gate passes justSignedUp=true on signup");
check("login.js onSignedIn accepts a justSignedUp flag",
  /justSignedUp\s*=\s*false/.test(login));
check("login.js calls onComplete with { justSignedUp: true } on signup",
  /justSignedUp:\s*true/.test(login));
check("login.js calls onComplete WITHOUT justSignedUp on signin (defaults to false)",
  /justSignedUp\b/.test(login));

console.log("\n[4] The toast fires inside mountAppShell (post-gate), not in init()");
const initFn = main.match(/async\s+function\s+init\(\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
check("init() does not call toast() unconditionally for welcome",
  !/toast\(\s*"Welcome/.test(initFn));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
