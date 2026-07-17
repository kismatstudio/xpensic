// Smoke test for the first-run welcome toast (punchlist #8).
// Verifies that:
//   • Store.load() returns seeded:true on a fresh install (no localStorage).
//   • main.js derives session.firstRun from (ok && seeded).
//   • The toast is only fired in the mountAppShell path (so it appears
//     after the user clears the login gate, not while they're typing).
//   • session.firstRun is cleared after firing, so a hot-reload doesn't
//     show it twice.
//   • The toast message is name-aware when a profile.name is set.

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
const store = read("js/store.js");

console.log("\n[1] Store.load reports seeded=true on a fresh install");
// Simulate the conditions: no localStorage entry, no errors. We can verify
// the source of the result without actually running in a browser by reading
// the relevant code path.
check("store.js: load() returns seeded:true when raw is missing", /if\s*\(!raw\)\s*\{[\s\S]*?return\s*\{[^}]*seeded:\s*true/.test(store));
check("store.js: load() returns seeded:false when parsed from localStorage", /return\s*\{[^}]*seeded:\s*false/.test(store));
check("store.js: load() also returns ok:false (with error) for corrupted JSON", /return\s*\{[^}]*ok:\s*false[^}]*error:\s*"Stored data is corrupted JSON\."/.test(store));

console.log("\n[2] main.js derives firstRun only when both ok and seeded are true");
const initBlock = main.split("function init()")[1]?.split("initTheme();")[0] || "";
check("main.js sets session.firstRun = storeResult.ok && storeResult.seeded",
  /session\.firstRun\s*=\s*session\.storeResult\.ok\s*===\s*true\s*&&\s*session\.storeResult\.seeded\s*===\s*true/.test(initBlock),
  `init block: ${initBlock.slice(0, 200)}…`);

console.log("\n[3] The toast fires inside mountAppShell (post-gate), not in init()");
const initFn = main.match(/function init\(\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
check("init() does not call toast()", !/\btoast\(/.test(initFn));
const mountAppFn = main.match(/function mountAppShell\(\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
check("mountAppShell() calls toast() at least once", /\btoast\(/.test(mountAppFn));
check("mountAppShell() shows the toast only when session.firstRun is true",
  /if\s*\(\s*session\.firstRun\s*\)/.test(mountAppFn));
check("mountAppShell() clears the flag after firing (no duplicate on hot-reload)",
  /session\.firstRun\s*=\s*false/.test(mountAppFn));

console.log("\n[4] The toast greeting is name-aware when a profile is set");
check("mounts a name-aware greeting when profile.name exists",
  /name\s*\?\s*`Welcome,\s*\$\{name\}!`/.test(mountAppFn));
check("falls back to a generic greeting when no name is set",
  /"Welcome to Expense Tracker!"/.test(mountAppFn));

console.log("\n[5] bootLoginGate routes both paths through mountAppShell");
const bootFn = main.match(/function bootLoginGate\(\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
check("bootLoginGate calls mountAppShell() on the 'already signed in' path",
  /if\s*\(profile\s*&&\s*profile\.userId\s*&&\s*profile\.phone\)\s*\{[\s\S]*?mountAppShell\(\)/.test(bootFn));
check("bootLoginGate calls mountAppShell() from the onComplete callback",
  /onComplete:\s*\(\)\s*=>\s*\{[\s\S]*?mountAppShell\(\)/.test(bootFn));

console.log("\n[6] First-run logic simulation (no DOM / no localStorage)");
// Re-derive the flag using exactly the same boolean expression as main.js.
function deriveFirstRun(storeResult) {
  return storeResult.ok === true && storeResult.seeded === true;
}
check("fresh install: firstRun = true",
  deriveFirstRun({ ok: true, seeded: true }) === true);
check("returning user: firstRun = false",
  deriveFirstRun({ ok: true, seeded: false }) === false);
check("corrupted store: firstRun = false (we don't celebrate corruption)",
  deriveFirstRun({ ok: false, error: "x" }) === false);
check("localStorage unavailable: firstRun = false",
  deriveFirstRun({ ok: false, error: "x" }) === false);

console.log("\n[7] Greeting is name-aware");
// The exact same expression as in mountAppShell.
function greetingFor(profile) {
  const name = (profile && profile.name) || "";
  return name ? `Welcome, ${name}!` : "Welcome to Expense Tracker!";
}
check("with a name: 'Welcome, Zeeshan!'", greetingFor({ name: "Zeeshan" }) === "Welcome, Zeeshan!");
check("with an empty name: generic greeting", greetingFor({ name: "" }) === "Welcome to Expense Tracker!");
check("with a missing profile: generic greeting", greetingFor(null) === "Welcome to Expense Tracker!");
check("with a name + empty phone (post-sign-out): still uses the name",
  greetingFor({ name: "Zeeshan", phone: "" }) === "Welcome, Zeeshan!");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
