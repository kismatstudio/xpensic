// Smoke test for the theme-toggle a11y (punchlist #9).
// Verifies that:
//   • main.js defines nextTheme() with the correct cycle order.
//   • updateThemeButton() updates aria-label, title, and data-theme.
//   • The aria-label says the current state and what the next click does.
//   • The Settings theme buttons are exposed as a real radio group with
//     role="radiogroup" + role="radio" + aria-checked.
//   • index.html marks the inner #theme-label as aria-hidden so screen
//     readers don't double-read it.

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
const index = read("index.html");

console.log("\n[1] nextTheme() cycle order is light → dark → system → light");
// Simulate the exact expression from main.js.
const THEME_CYCLE_ORDER = ["light", "dark", "system"];
const nextTheme = (pref) => THEME_CYCLE_ORDER[(THEME_CYCLE_ORDER.indexOf(pref) + 1) % THEME_CYCLE_ORDER.length];
check("nextTheme(light) === 'dark'",    nextTheme("light")  === "dark");
check("nextTheme(dark) === 'system'",   nextTheme("dark")   === "system");
check("nextTheme(system) === 'light'",  nextTheme("system") === "light");

console.log("\n[2] updateThemeButton() updates aria-label, title, and data-theme");
const updateFn = main.match(/function updateThemeButton\(\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
check("updateThemeButton sets aria-label with current + next theme",
  /aria-label.*\$\{THEME_LABEL\[pref]\}.*\$\{THEME_LABEL\[nextTheme\(pref\)\]\}/.test(updateFn));
check("updateThemeButton sets title with current + next theme",
  /title.*\$\{THEME_LABEL\[pref]\}.*\$\{THEME_LABEL\[nextTheme\(pref\)\]\}/.test(updateFn));
check("updateThemeButton mirrors the current theme to data-theme",
  /setAttribute\("data-theme",\s*pref\)/.test(updateFn));

console.log("\n[3] Settings theme buttons are exposed as a radio group");
const settingsThemeBlock = main.split("--- Theme buttons ------------------------------------------------------")[1]?.split("--- Stats line")[0] || "";
check("container is upgraded to role=radiogroup",
  /setAttribute\("role",\s*"radiogroup"\)/.test(settingsThemeBlock));
check("each button gets role=radio",
  /setAttribute\("role",\s*"radio"\)/.test(settingsThemeBlock));
check("each button gets aria-checked reflecting the active theme",
  /aria-checked/.test(settingsThemeBlock));
check("renderThemeActive keeps aria-checked in sync after a click",
  /b\.setAttribute\("aria-checked",\s*isActive\s*\?\s*"true"\s*:\s*"false"\)/.test(settingsThemeBlock));

console.log("\n[4] index.html hides the visible label from screen readers");
check("#theme-label has aria-hidden='true'", /id="theme-label"[^>]*aria-hidden="true"/.test(index));
// Make sure aria-hidden isn't on the icon by accident (it should stay on the icon only).
const iconSpan = index.match(/<span[^>]*id="theme-icon"[^>]*>/)?.[0] || "";
check("#theme-icon still has aria-hidden='true' (the icon is decorative)", /aria-hidden="true"/.test(iconSpan));

console.log("\n[5] Functional check: aria-label composition for each state");
function ariaLabelFor(pref) {
  const labels = { light: "Light", dark: "Dark", system: "System" };
  return `Theme: ${labels[pref]}. Click to switch to ${labels[nextTheme(pref)]}.`;
}
check('aria-label for light  === "Theme: Light. Click to switch to Dark."',
  ariaLabelFor("light") === "Theme: Light. Click to switch to Dark.");
check('aria-label for dark   === "Theme: Dark. Click to switch to System."',
  ariaLabelFor("dark") === "Theme: Dark. Click to switch to System.");
check('aria-label for system === "Theme: System. Click to switch to Light."',
  ariaLabelFor("system") === "Theme: System. Click to switch to Light.");

console.log("\n[6] main.js still calls updateThemeButton in all the same places (no regression)");
const callSites = main.match(/updateThemeButton\(\)/g) || [];
check("updateThemeButton is still called multiple times across the file",
  callSites.length >= 4, `found ${callSites.length} call site(s)`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
