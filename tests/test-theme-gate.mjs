// Theme on the login gate vs. signed-in accounts:
//   • Login / sign-up / unlock gates are always the System theme.
//   • After sign-in the account's own choice applies (System if none).
//   • Logging out returns to System; the choice is restored on next login.

import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}` + (extra ? `  (${extra})` : "")); fail++; }
}

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};
let osDark = false;
globalThis.window = { matchMedia: () => ({ matches: osDark, addEventListener() {} }) };
const root = { dataset: {}, style: {} };
globalThis.document = { documentElement: root, getElementById: () => null };

const here = dirname(fileURLToPath(import.meta.url));
const t = await import(pathToFileURL(join(here, "..", "js", "theme.js")).href);

t.enterGateTheme();
check("gate starts on System", root.dataset.themePref === "system");

t.enterUserTheme("userA");
check("new account with no choice is System", root.dataset.themePref === "system");

t.setTheme("light");
check("user picks Light", root.dataset.theme === "light" && root.dataset.themePref === "light");

t.enterGateTheme();
check("login gate after logout is System, not Light", root.dataset.themePref === "system");

t.enterUserTheme("userA");
check("Light restored after sign-in", root.dataset.theme === "light" && root.dataset.themePref === "light");

t.setTheme("dark");
t.enterGateTheme();
osDark = false;
t.enterGateTheme();
check("gate follows the OS, not the last user's Dark", root.dataset.theme === "light" && root.dataset.themePref === "system");
t.enterUserTheme("userA");
check("Dark restored after sign-in", root.dataset.theme === "dark" && root.dataset.themePref === "dark");

t.enterGateTheme();
t.enterUserTheme("userB");
check("another account is unaffected by userA's choice", root.dataset.themePref === "system");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
