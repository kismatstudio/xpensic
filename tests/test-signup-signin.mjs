// Tests for the Sign-in / Sign-up tabbed auth gate + the multi-profile
// registry that backs it. Covers:
//   • Schema migration to v3 (profile gains userId + profiles registry)
//   • Store.findProfileByPhone / Store.registerProfile
//   • login.js: tab DOM structure, role=tablist, arrow-key nav
//   • login.js: submit-time branching (sign-in looks up; sign-up creates)
//   • main.js: signOut + bootLoginGate use userId + phone

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

const login = read("js/views/login.js");
const profile = read("js/views/profile.js");
const main = read("js/main.js");
const storeSrc = read("js/store.js");

// ---- Section 1: store.js — schema + migration --------------------------

console.log("\n[1] store.js: schema version and migration");
check("SCHEMA_VERSION is 3", /SCHEMA_VERSION\s*=\s*3\b/.test(storeSrc));
check("freshState adds userId to profile",
  /userId:\s*"",\s*name:\s*"",\s*phone:/.test(storeSrc));
check("freshState adds profiles registry", /profiles:\s*\{\s*\}/.test(storeSrc));
check("migrate walks v1 then v2",
  /state\.version\s*===\s*1/.test(storeSrc) && /state\.version\s*===\s*2/.test(storeSrc));
check("load backfills userId for old profiles",
  /typeof parsed\.profile\.userId\s*!==\s*"string"/.test(storeSrc));
check("load backfills profiles registry",
  /!isPlainObject\(parsed\.profiles\)/.test(storeSrc));

// ---- Section 2: Store migration via the public API ---------------------

console.log("\n[2] Store.migrate: live migration v1 → v2 → v3");
const { Store, migrate } = await import("../js/store.js");

const v1 = { version: 1, settings: { currency: "INR" }, categories: [], budgets: { monthly: {} }, expenses: [] };
migrate(v1);
check("v1 → version is now 3", v1.version === 3);
check("v1 → profile.userId is ''", v1.profile?.userId === "");
check("v1 → profiles is an object", typeof v1.profiles === "object");

const v2 = {
  version: 2, settings: { currency: "INR" },
  profile: { name: "Zee", phone: "9876543210", avatarDataUrl: "" },
  categories: [], budgets: { monthly: {} }, expenses: [],
};
migrate(v2);
check("v2 → version is now 3", v2.version === 3);
check("v2 → preserves existing phone", v2.profile.phone === "9876543210");
check("v2 → adds userId field", typeof v2.profile.userId === "string");

// ---- Section 3: Store.findProfileByPhone / registerProfile ------------

console.log("\n[3] Store: profile registry — find & register");
const state = {
  version: 3,
  settings: { currency: "INR" },
  profile: { userId: "", name: "", phone: "", avatarDataUrl: "" },
  profiles: {},
  categories: [],
  budgets: { monthly: {} },
  expenses: [],
};

const r1 = Store.registerProfile(state, {
  userId: "user_aaa", name: "Alice", phone: "9876543210", avatarDataUrl: "av1",
});
check("registerProfile returns the entry", r1 && r1.userId === "user_aaa");
check("registerProfile normalizes phone (10 digits)", r1.phone === "9876543210");
check("registry allows multiple accounts on the same device",
  Store.registerProfile(state, { userId: "user_bbb", name: "Bob", phone: "9123456789" })
  && Object.keys(state.profiles).length === 2);

check("findProfileByPhone matches exact 10 digits",
  Store.findProfileByPhone(state, "9876543210")?.userId === "user_aaa");
check("findProfileByPhone strips +91 prefix",
  Store.findProfileByPhone(state, "+91 98765 43210")?.userId === "user_aaa");
check("findProfileByPhone strips leading 0",
  Store.findProfileByPhone(state, "09876543210")?.userId === "user_aaa");
check("findProfileByPhone returns null for unknown",
  Store.findProfileByPhone(state, "9999999999") === null);
check("findProfileByPhone returns null for invalid",
  Store.findProfileByPhone(state, "12") === null);

// ---- Section 4: login.js — tabs DOM structure -------------------------

console.log("\n[4] login.js: tabs DOM structure");
check("login uses role=tablist",        /role="tablist"/.test(login));
check("login uses role=tab",            /role="tab"/.test(login));
check("login uses role=tabpanel",       /role="tabpanel"/.test(login));
check("login has Sign in tab button",   /<button[^>]*id="tab-signin"[\s\S]{0,400}Sign in[\s\S]{0,400}<\/button>/.test(login));
check("login has Sign up tab button",   /<button[^>]*id="tab-signup"[\s\S]{0,400}Sign up[\s\S]{0,400}<\/button>/.test(login));
check("Sign in is initially active",
  /id="tab-signin"[\s\S]{0,200}aria-selected="true"/.test(login));
check("Sign up is initially inactive",
  /id="tab-signup"[\s\S]{0,200}aria-selected="false"/.test(login));
check("login has arrow-key nav handler",
  /ArrowLeft[\s\S]{0,40}ArrowRight/s.test(login));
check("login switches submit label between modes",
  /Sign in[\s\S]{0,40}Create account/s.test(login));
check("login imports newId for sign-up",
  /from\s+"\.\.\/ids\.js"/.test(login));

// ---- Section 5: login.js — submit-time branching ----------------------

console.log("\n[5] login.js: submit-time branching");
check("login calls Store.findProfileByPhone on sign-in",
  /Store\.findProfileByPhone\(state,\s*phone\)/.test(login));
check("login shows 'No account found' on sign-in miss",
  /No account found for this number/.test(login));
check("login suggests Sign up after a miss",
  /Try Sign up to create one/.test(login));
check("login calls Store.registerProfile on sign-up",
  /Store\.registerProfile\(state/.test(login));
check("login generates userId on sign-up",
  /newId\("user"\)/.test(login));
check("login shows Welcome back toast on sign-in",
  /Welcome back,\s*\$\{existing\.name \|\| name\}!/.test(login));
check("login shows Welcome toast on sign-up",
  /toast\(`Welcome,\s*\$\{name\}!`/.test(login));

// ---- Section 6: login.js — placeholder is no longer a sample name ----

console.log("\n[6] login.js: empty placeholder + required field");
check("login.js has no 'e.g. Zeeshan Khan' sample",
  !/e\.g\.\s*Zeeshan Khan/i.test(login));
check("name input is still required",
  /id="auth-name"[\s\S]{0,200}\brequired\b/.test(login));
const nameInputMatch = login.match(/<input[\s\S]*?id="auth-name"[\s\S]*?\/?>/);
const placeholderMatch = nameInputMatch?.[0].match(/placeholder="([^"]*)"/);
check("name input has a neutral placeholder",
  placeholderMatch && !/^e\.g\./i.test(placeholderMatch[1] || ""),
  `placeholder="${placeholderMatch?.[1] ?? "(none)"}"`);

// ---- Section 7: login.js — gate bail-out -------------------------------

console.log("\n[7] login.js: gate bail-out");
check("bail-out checks userId + phone",
  /state\.profile\s*&&\s*state\.profile\.userId\s*&&\s*state\.profile\.phone/.test(login));

// ---- Section 8: main.js — signOut clears userId + bootLoginGate ------

console.log("\n[8] main.js: signOut + bootLoginGate");
const signOutFn = main.match(/function signOut\(\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
check("signOut clears userId",
  /Store\.updateProfile\(session\.state,\s*\{\s*userId:\s*"",\s*name:\s*"",\s*phone:\s*"",\s*avatarDataUrl:\s*""\s*\}\)/.test(signOutFn));

const bootFn = main.match(/function bootLoginGate\(\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
check("bootLoginGate checks userId && phone",
  /profile\s*&&\s*profile\.userId\s*&&\s*profile\.phone/.test(bootFn));

// ---- Section 9: main.js — drawer chip picks the new photo -------------

console.log("\n[9] main.js: renderNavProfile uses stored avatar");
check("renderNavProfile prefers stored avatarDataUrl",
  /p\.avatarDataUrl\s*\|\|\s*generateAvatarDataUrl\(p\)/.test(main));
check("render() calls renderNavProfile()",
  /renderNavProfile\(\)/.test(main));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
