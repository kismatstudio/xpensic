// Smoke test for the server-backed auth wiring.
//
// The old test verified Store.findProfileByPhone / registerProfile /
// initPerUserData — all of which have moved to the server (see
// server/src/routes/auth.js + server/src/db.js). Server behaviour is
// covered by server/tests/smoke.mjs.
//
// Here we verify the client-side wiring:
//   • store.js still has the v5 schema and migration chain (kept
//     so users with old localStorage backups don't crash).
//   • js/api.js exposes the right surface and credentials:include.
//   • login.js uses the api.js Auth client instead of the local store.
//   • main.js boots via whoami and falls back to the gate on miss.

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
const main = read("js/main.js");
const storeSrc = read("js/store.js");
const apiSrc = read("js/api.js");

// ---- Section 1: store.js — schema + migration still walks v1→v6 ----------

console.log("\n[1] store.js: schema version and migration");
check("SCHEMA_VERSION is 6", /SCHEMA_VERSION\s*=\s*6\b/.test(storeSrc));
check("freshState adds userId to profile",
  /userId:\s*"",\s*name:\s*"",\s*phone:/.test(storeSrc));
check("freshState adds profiles registry", /profiles:\s*\{\s*\}/.test(storeSrc));
check("migrate walks v1 then v2",
  /state\.version\s*===\s*1/.test(storeSrc) && /state\.version\s*===\s*2/.test(storeSrc));
check("load backfills userId for old profiles",
  /typeof parsed\.profile\.userId\s*!==\s*"string"/.test(storeSrc));
check("load backfills profiles registry",
  /!isPlainObject\(parsed\.profiles\)/.test(storeSrc));

console.log("\n[2] Store.migrate: live migration v1 → v2 → v3 → v4 → v5 → v6");
const { Store, migrate } = await import("../js/store.js");

const v1 = { version: 1, settings: { currency: "INR" }, categories: [{ id: "cat_food", name: "Food", color: "#ef4444", isDefault: true }], budgets: { monthly: {} }, expenses: [] };
migrate(v1);
check("v1 → version is now 6", v1.version === 6);
check("v1 → profile.userId is ''", v1.profile?.userId === "");
check("v1 → profiles is an object", typeof v1.profiles === "object");
check("v1 → default categories get icon", (v1.categories || []).some((c) => c.icon && c.icon.length > 0));

const v2 = {
  version: 2, settings: { currency: "INR" },
  profile: { name: "Zee", phone: "9876543210", avatarDataUrl: "" },
  categories: [], budgets: { monthly: {} }, expenses: [],
};
migrate(v2);
check("v2 → version is now 6", v2.version === 6);
check("v2 → preserves existing phone", v2.profile.phone === "9876543210");
check("v2 → adds userId field", typeof v2.profile.userId === "string");

const v3 = {
  version: 3,
  settings: { currency: "INR" },
  profile: { userId: "user_first", name: "First", phone: "9876543210", avatarDataUrl: "" },
  profiles: { user_first: { userId: "user_first", name: "First", phone: "9876543210", avatarDataUrl: "" } },
  categories: [{ id: "cat_food", name: "Food", color: "#ef4444", isDefault: true }],
  budgets: { monthly: { "2026-07": { cat_food: 500 } } },
  expenses: [{ id: "exp_1", amount: 100, date: "2026-07-10", categoryId: "cat_food", note: "Lunch" }],
};
migrate(v3);
check("v3 → version is now 6", v3.version === 6);
check("v3 → owner registry entry absorbed top-level expenses",
  Array.isArray(v3.profiles.user_first.expenses) && v3.profiles.user_first.expenses.length === 1);
check("v3 → owner registry entry absorbed top-level budgets",
  v3.profiles.user_first.budgets?.monthly?.["2026-07"]?.cat_food === 500);
check("v3 → owner registry entry absorbed top-level categories",
  // After v3→v4→v5→v6 migration the registry's categories are merged
  // with the expanded default list, so cat_food is preserved AND new
  // defaults (Groceries, Internet & Mobile, etc.) are added.
  v3.profiles.user_first.categories?.length >= 1 &&
  v3.profiles.user_first.categories?.some((c) => c.id === "cat_food"));
check("v3 → default categories picked up an emoji icon after v4→v5 migration",
  v3.profiles.user_first.categories?.[0]?.icon?.length > 0);

// ---- Section 3: api.js surface ------------------------------------------

console.log("\n[3] js/api.js exports the Auth + Data clients");
check("api.js exports Auth.signup",  /signup:\s*\(body\)/.test(apiSrc));
check("api.js exports Auth.signin",  /signin:\s*\(body\)/.test(apiSrc));
check("api.js exports Auth.signout", /signout:\s*\(/.test(apiSrc));
check("api.js exports Auth.whoami",  /whoami:\s*\(/.test(apiSrc));
check("api.js exports Auth.sendOtp", /sendOtp:\s*\(/.test(apiSrc));
check("api.js exports Auth.verifyOtp", /verifyOtp:\s*\(/.test(apiSrc));
check("api.js sends credentials: include", /credentials:\s*"include"/.test(apiSrc));
check("api.js throws ApiError on failure", /class ApiError/.test(apiSrc));
check("api.js exports Data.get",  /get:\s*\(\)/.test(apiSrc));
check("api.js exports Expenses CRUD", /Expenses\s*=/.test(apiSrc) && /create:\s*\(expense\)/.test(apiSrc));
check("api.js exports Categories CRUD", /Categories\s*=/.test(apiSrc) && /create:\s*\(category\)/.test(apiSrc));
check("api.js exports Budgets get+put", /Budgets\s*=/.test(apiSrc) && /put:\s*\(budgets\)/.test(apiSrc));
check("api.js exports Settings get+put", /Settings\s*=/.test(apiSrc) && /put:\s*\(patch\)/.test(apiSrc));

// ---- Section 4: login.js uses the Auth client ----------------------------

console.log("\n[4] login.js uses the server-backed Auth client");
check("login.js imports from ../api.js",
  /from\s+"\.\.\/api\.js"/.test(login));
check("login.js imports Auth (not the local Store helpers)",
  /import\s*\{[^}]*\bAuth\b[^}]*\}\s*from\s+"\.\.\/api\.js"/.test(login));
check("login.js does NOT call Store.findProfileByPhone",
  !/Store\.findProfileByPhone/.test(login));
check("login.js does NOT call Store.registerProfile",
  !/Store\.registerProfile/.test(login));
check("login.js does NOT call Store.initPerUserData",
  !/Store\.initPerUserData/.test(login));
check("login.js does NOT call Store.restorePerUserData",
  !/Store\.restorePerUserData/.test(login));
check("login.js does NOT import newId (server mints the userId now)",
  !/from\s+"\.\.\/ids\.js"/.test(login));

// ---- Section 5: login.js — tabs DOM structure ----------------------------

console.log("\n[5] login.js: tabs DOM structure");
check("login uses role=tablist",        /role="tablist"/.test(login));
check("login uses role=tab",            /role="tab"/.test(login));
check("login uses role=tabpanel",       /role="tabpanel"/.test(login));
check("login has Sign in tab button",   /id="tab-signin"/.test(login));
check("login has Sign up tab button",   /id="tab-signup"/.test(login));
check("Sign in is initially active",
  /id="tab-signin"[\s\S]{0,200}aria-selected="true"/.test(login));
check("Sign up is initially inactive",
  /id="tab-signup"[\s\S]{0,200}aria-selected="false"/.test(login));
check("login has arrow-key nav handler",
  /ArrowLeft[\s\S]{0,40}ArrowRight/s.test(login));

// ---- Section 6: login.js — signup wiring ---------------------------------

console.log("\n[6] login.js: signup wiring");
check("login calls Auth.signup on submit",
  /Auth\.signup\(/.test(login));
check("login surfaces signup errors on the identifier field",
  /fields\.signupIdErr/.test(login));
check("login requires password length ≥ 8",
  /length\s*<\s*8/.test(login) || /minlength="8"/.test(login));
check("login rejects password / confirm mismatch",
  /pw\s*!==\s*pw2/.test(login));
// New behavior: signup does NOT collect a name (the user adds it later
// in Profile). This is intentional — collecting a name on signup was
// unnecessary friction for the most common path (mobile-first users
// who just want to track an expense).
check("login does NOT collect a name on signup",
  !/id="auth-name"/.test(login));
check("login signup sends ONLY identifier + passwords (no displayName)",
  /Auth\.signup\(\s*\{[\s\S]*?identifier:[\s\S]*?password:[\s\S]*?confirmPassword:[\s\S]*?\}\s*\)/.test(login) &&
  !/displayName:/.test(login));

// ---- Section 7: login.js — signin wiring ---------------------------------

console.log("\n[7] login.js: signin wiring");
check("login calls Auth.signin on submit",
  /Auth\.signin\(/.test(login));
check("login supports OTP-based signin",
  /Auth\.verifyOtp\(/.test(login) && /Auth\.signin\(/.test(login) &&
  /identifier:\s*id\.value/.test(login) && /\botp\b/.test(login));
check("login surfaces signin errors",
  /fields\.signinPwErr|fields\.signinOtpErr/.test(login));

// ---- Section 8: main.js — boot + signOut ---------------------------------

console.log("\n[8] main.js: boot + signOut");
check("main.js imports Auth + Data from api.js",
  /from\s+"\.\/api\.js"/.test(main));
check("main.js calls Auth.whoami on boot",
  /Auth\.whoami\(\)/.test(main));
check("main.js calls Crypto.getVault to hydrate after unlock",
  /Crypto\.getVault|loadVault/.test(main));
check("main.js has a syncToServer helper",
  /function\s+syncToServer|const\s+syncToServer/.test(main));
check("main.js calls syncToServer after mutations",
  /syncToServer\(\)/.test(main));
check("signOut calls Auth.signout",
  /Auth\.signout\(/.test(main));
check("signOut uses replaceState (no render flash)",
  /history\.replaceState/.test(main));
check("signOut clears profile + top-level data",
  /Store\.updateProfile\(session\.state,\s*\{\s*userId:\s*"",\s*name:\s*"",\s*phone:\s*"",\s*avatarDataUrl:\s*""\s*\}\)/.test(main) ||
  /userId:\s*"",\s*name:\s*"",\s*phone:\s*"",\s*avatarDataUrl:\s*""/.test(main));

// ---- Section 9: renderNavProfile + drawer chip --------------------------

console.log("\n[9] main.js: renderNavProfile uses stored avatar");
check("renderNavProfile prefers stored avatarDataUrl",
  /p\.avatarDataUrl\s*\|\|\s*generateAvatarDataUrl\(p\)/.test(main));
check("render() calls renderNavProfile()",
  /renderNavProfile\(\)/.test(main));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
