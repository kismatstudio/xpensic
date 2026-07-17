// Smoke test for the login gate and profile view, plus the sign-out
// flow in main.js. Verifies that the validation, store integration, and
// DOM-construction logic in login.js / profile.js is wired correctly,
// and that signOut() in main.js uses replaceState (not hash=) to
// prevent the post-sign-out render flash.

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
const utilSrc = read("js/util.js");
const storeSrc = read("js/store.js");

// ---- Section 1: validateIndianPhone / formatIndianPhone --------------------

console.log("\n[1] Phone validation — accepts the common input variants");
const { validateIndianPhone, formatIndianPhone, generateAvatarDataUrl } = await import("../js/util.js");
check("10 raw digits",          validateIndianPhone("9876543210").value === "9876543210");
check("spaces",                 validateIndianPhone("98765 43210").value === "9876543210");
check("91 prefix",              validateIndianPhone("919876543210").value === "9876543210");
check("+91 prefix",             validateIndianPhone("+91 98765 43210").value === "9876543210");
check("0 prefix",               validateIndianPhone("09876543210").value === "9876543210");
check("dashes",                 validateIndianPhone("98765-43210").value === "9876543210");
check("rejects 9 digits",       validateIndianPhone("987654321").ok === false);
check("rejects 11 digits",      validateIndianPhone("98765432101").ok === false);
check("rejects alpha",          validateIndianPhone("abcdefghij").ok === false);
check("rejects empty",          validateIndianPhone("").ok === false);
check("error has helpful text", /10-digit/.test(validateIndianPhone("123").error || ""));

console.log("\n[2] formatIndianPhone — display format");
check("formats 10 digits",   formatIndianPhone("9876543210") === "+91 98765 43210");
check("formats 12 digits",   formatIndianPhone("919876543210") === "+91 98765 43210");
check("strips 91 prefix",    formatIndianPhone("919876543210") === "+91 98765 43210");
check("returns '' for empty",formatIndianPhone("") === "");
check("returns '' for short",formatIndianPhone("123") === "");

// ---- Section 3: generateAvatarDataUrl -------------------------------------

console.log("\n[3] Avatar generation — stable, deterministic, no network");
const avA = generateAvatarDataUrl({ name: "Zeeshan", phone: "9876543210" });
const avB = generateAvatarDataUrl({ name: "Zeeshan", phone: "9876543210" });
// Use a name with different initials so the avatar is guaranteed to differ.
const avOther = generateAvatarDataUrl({ name: "Aarav", phone: "9876543210" });
check("avatar is a data: URL",       avA.startsWith("data:image/svg+xml"));
check("avatar is stable per input",  avA === avB);
check("avatar differs for a different name", avA !== avOther);
check("avatar includes initials",    avA.includes("Z"));

// ---- Section 4: login.js DOM structure ------------------------------------

console.log("\n[4] login.js: required DOM structure");
check("login renders a role=dialog container",         /setAttribute\("role",\s*"dialog"\)/.test(login));
check("login sets aria-modal",                          /setAttribute\("aria-modal",\s*"true"\)/.test(login));
check("login has a labeled form (login-gate-title)",    /setAttribute\("aria-labelledby",\s*"login-gate-title"\)/.test(login));
check("login has a name input with autocomplete",      /autocomplete="name"/.test(login));
check("login has a phone input with inputmode=numeric",/inputmode="numeric"/.test(login));
check("login has a phone input with tel-national",     /autocomplete="tel-national"/.test(login));
check("login shows a +91 prefix on the phone field",   /login-gate__phone-prefix/.test(login));
check("login has a Continue submit button",            /type="submit"[^>]*id="auth-submit"/.test(login));
check("login focuses the name field on mount",         /queueMicrotask\(\(\)\s*=>\s*\$name\.focus\(\)\)/.test(login));
check("login uses validateIndianPhone",                /validateIndianPhone\(/.test(login));
check("login calls Store.updateProfile",                /Store\.updateProfile\(/.test(login));
check("login calls Store.save",                        /Store\.save\(state\)/.test(login));
check("login shows a Welcome toast on success",        /toast\(`Welcome,\s*\$\{name\}!`/.test(login));
check("login removes itself on success",                /root\.remove\(\)/.test(login));
check("login handles Store.save failure (toast error)", /Could not save/.test(login));
check("login bails out if profile already complete",   /state\.profile\s*&&\s*state\.profile\.userId\s*&&\s*state\.profile\.phone/.test(login));

console.log("\n[5] login.js: validation messages are clear");
check("empty name: 'Please enter your name.'",          /setNameError\("Please enter your name\."\)/.test(login));
check("invalid phone: passes through validator's error", /phoneResult\.error/.test(login));
check("clears name error on input",                     /\$name\.addEventListener\("input",\s*\(\)\s*=>\s*setNameError\(""\)\)/.test(login));
check("clears phone error on input",                    /setPhoneError\(""\)/.test(login));

console.log("\n[6] login.js: Escape-to-blur wiring");
check("Escape key handler is registered on the gate",   /addEventListener\("keydown"/.test(login));
check("Escape blurs the active element",                /\.blur\(\)/.test(login));
check("Escape does not close the gate",                 !/Escape[\s\S]{0,200}\.remove\(\)/.test(login));
check("Escape preventDefault when blurring",            /ev\.preventDefault\(\)/.test(login));

// ---- Section 7: profile.js DOM structure ----------------------------------

console.log("\n[7] profile.js: required DOM structure");
check("profile shows section-title 'Profile'",            /section-title">Profile</.test(profile));
check("profile shows the avatar",                         /profile-card__avatar/.test(profile));
check("profile shows the name",                           /profile-card__name/.test(profile));
check("profile shows the formatted phone",                /profile-card__phone/.test(profile));
check("profile has an Edit button",                       /id="profile-edit"[^>]*>Edit profile</.test(profile));
check("profile has a Sign out button",                    /id="profile-signout"[^>]*>Sign out</.test(profile));
check("profile stats show expenses count",                /state\.expenses\.length/.test(profile));
check("profile stats show categories count",              /state\.categories\.length/.test(profile));
check("profile stats show first-expense date",            /first expense/.test(profile));
check("profile Edit modal reuses the phone-wrap CSS",     /login-gate__phone-wrap/.test(profile));
check("profile Edit validates with validateIndianPhone",  /validateIndianPhone\(/.test(profile));
check("profile Edit regenerates the avatar on save",      /generateAvatarDataUrl\(\{[\s\S]{0,300}name:[\s\S]{0,300}phone:/.test(profile));
check("profile Edit calls Store.updateProfile",            /Store\.updateProfile\(state/.test(profile));
check("profile Edit calls Store.save",                   /Store\.save\(state\)/.test(profile));
check("profile Edit calls refreshNav if available",       /typeof ctx\.refreshNav === "function"/.test(profile));
check("profile Edit invalid input keeps modal open",      /hasError[\s\S]{0,200}return\s+false/.test(profile));
check("profile Edit shows 'Profile updated' toast",       /Profile updated/.test(profile));

// ---- Section 8: main.js signOut wiring ------------------------------------

console.log("\n[8] main.js: signOut uses replaceState (no render flash)");
// Strip comments so a comment that mentions the deprecated pattern doesn't
// trip the negative assertion below.
const signOutFnNoComments = (main.match(/function signOut\(\)\s*\{[\s\S]*?\n\}/)?.[0] || "")
  .replace(/\/\/[^\n]*/g, "");
const signOutFn = main.match(/function signOut\(\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
check("signOut clears the profile via Store.updateProfile", /Store\.updateProfile\(session\.state,\s*\{\s*userId:\s*"",\s*name:\s*"",\s*phone:\s*"",\s*avatarDataUrl:\s*""\s*\}\)/.test(signOutFn));
check("signOut calls Store.save",                          /Store\.save\(session\.state\)/.test(signOutFn));
check("signOut shows a 'Signed out' toast",                /toast\("Signed out"/.test(signOutFn));
check("signOut uses history.replaceState (not hash=)",     /history\.replaceState\(null,\s*""/.test(signOutFn));
check("signOut does NOT assign to window.location.hash (in the code, not comments)",
  !/window\.location\.hash\s*=/.test(signOutFnNoComments));
check("signOut calls bootLoginGate",                       /bootLoginGate\(\)/.test(signOutFn));

// ---- Section 9: main.js bootLoginGate -------------------------------------

console.log("\n[9] main.js: bootLoginGate routes correctly");
const bootFn = main.match(/function bootLoginGate\(\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
check("bootLoginGate checks profile.userId && profile.phone", /profile\s*&&\s*profile\.userId\s*&&\s*profile\.phone/.test(bootFn));
check("bootLoginGate hides the app when no profile", /document\.body\.classList\.add\("app-locked"\)/.test(bootFn));
check("bootLoginGate shows the app when profile complete", /mountAppShell\(\)/.test(bootFn));
check("bootLoginGate calls mountLogin when no profile",  /mountLogin\(/.test(bootFn));

// ---- Section 10: main.js wires refreshNav to profile ---------------------

console.log("\n[10] main.js: profile view gets refreshNav + onSignOut");
const profileWrapper = main.match(/function renderProfile\(container\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
check("profile wrapper passes refreshNav",       /refreshNav:/.test(profileWrapper));
check("profile wrapper passes onSignOut",        /onSignOut:/.test(profileWrapper));
check("refreshNav points to renderNavProfile",   /renderNavProfile/.test(profileWrapper));
check("onSignOut points to signOut",             /signOut\(\)/.test(profileWrapper));

// ---- Section 11: store integration ----------------------------------------

console.log("\n[11] Store.updateProfile + Store.save integration");
const { Store } = await import("../js/store.js");
const state = {
  version: 2,
  settings: { currency: "INR" },
  profile: { name: "", phone: "", avatarDataUrl: "" },
  categories: [],
  budgets: { monthly: {} },
  expenses: [],
};
// Simulate the login flow.
Store.updateProfile(state, { name: "Zeeshan", phone: "9876543210", avatarDataUrl: avA });
check("after update: profile.name is set",  state.profile.name === "Zeeshan");
check("after update: profile.phone is set", state.profile.phone === "9876543210");
check("after update: avatarDataUrl is set",  state.profile.avatarDataUrl === avA);

// Simulate sign-out: clear the profile.
Store.updateProfile(state, { name: "", phone: "", avatarDataUrl: "" });
check("after sign-out: profile.name is empty",  state.profile.name === "");
check("after sign-out: profile.phone is empty", state.profile.phone === "");
check("after sign-out: avatarDataUrl is empty", state.profile.avatarDataUrl === "");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
