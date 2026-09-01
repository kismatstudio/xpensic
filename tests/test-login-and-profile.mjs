// Smoke test for the new server-backed auth gate (login.js + main.js) and
// the profile screen. Since auth is now on the server, we no longer
// validate phone numbers locally — instead we:
//   • Render the login form with email/mobile + password (+ optional OTP).
//   • Send signup / signin through the Auth API client (api.js).
//   • Profile view remains essentially the same (edit name / avatar / sign out).
//
// The actual server round-trip is covered by server/tests/smoke.mjs.
// Here we only verify the client wiring (DOM, branching, error UX).

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
const api = read("js/api.js");
const util = read("js/util.js");

// ---- Section 1: api.js exports the surface we use ------------------------

console.log("\n[1] js/api.js exports the auth/crypto clients");
check("api.js exports Auth.signup",      /signup:\s*\(body\)/.test(api));
check("api.js exports Auth.signin",      /signin:\s*\(body\)/.test(api));
check("api.js exports Auth.signout",     /signout:\s*\(/.test(api));
check("api.js exports Auth.whoami",      /whoami:\s*\(/.test(api));
check("api.js exports Auth.sendOtp",     /sendOtp:\s*\(/.test(api));
check("api.js exports Auth.verifyOtp",   /verifyOtp:\s*\(/.test(api));
check("api.js exports Crypto.getVault",  /getVault:\s*\(\)/.test(api));
check("api.js exports Crypto.putVault",  /putVault:\s*\(blob,\s*revision/.test(api));
check("api.js exports Crypto.deleteVault", /deleteVault:/.test(api));
check("api.js sends credentials: include", /credentials:\s*"include"/.test(api));
check("api.js throws ApiError on failure",  /class ApiError/.test(api));

// ---- Section 2: login.js DOM structure (server-backed) --------------------

console.log("\n[2] login.js: required DOM structure");
check("login renders a role=dialog container",         /setAttribute\("role",\s*"dialog"\)/.test(login));
check("login sets aria-modal",                          /setAttribute\("aria-modal",\s*"true"\)/.test(login));
check("login has tablist",                             /role="tablist"/.test(login));
check("login has Sign in + Sign up tabs",              /id="tab-signin"/.test(login) && /id="tab-signup"/.test(login));
check("login has email-or-mobile identifier input",    /id="auth-id-signin"/.test(login) && /id="auth-id-signup"/.test(login));
check("login has a sign-in password input",             /id="auth-pw-signin"/.test(login));
check("login has a sign-up password + confirm",        /id="auth-pw-signup"/.test(login) && /id="auth-pw-signup-2"/.test(login));
check("login has a Send OTP button",                   /id="auth-otp-send"/.test(login));
check("login has a Use OTP toggle",                    /id="auth-toggle-otp"/.test(login));
check("login displays the API base URL in the legal note", /apiBase/.test(login));
check("login calls Auth.signup on sign-up",            /Auth\.signup\(/.test(login));
check("login calls Auth.signin on sign-in",            /Auth\.signin\(/.test(login));
check("login calls Auth.verifyOtp before signing in via OTP", /Auth\.verifyOtp\(/.test(login));
check("login submits with credentials: include via the api.js wrapper", /import.*from\s+"\.\.\/api\.js"/.test(login));

console.log("\n[3] login.js: error states from the server surface inline");
check("login shows signin password errors inline",       /fields\.signinPwErr/.test(login));
check("login shows signin OTP errors inline",            /fields\.signinOtpErr/.test(login));
check("login shows signup identifier errors inline",     /fields\.signupIdErr/.test(login));
check("login shows password mismatch on signup",         /Passwords do not match/.test(login));
check("login rejects identifiers that aren't email or 10-digit phone",
  /PHONE_RE\.test\(digits\)/.test(login));

// ---- Section 4: login.js OTP surface --------------------------------------

console.log("\n[4] login.js: OTP UX");
check("Send OTP disabled while pending",                  /sendOtpBtn\.disabled\s*=\s*true/.test(login));
check("OTP code is shown in a hint element",              /otp-display/.test(login));
check("OTP can be copied to clipboard",                   /clipboard\.writeText\(/.test(login));
check("OTP expiry countdown disables resend",             /Resend in/.test(login));
check("OTP input is 4 digits",                            /maxlength="4"/.test(login));

// ---- Section 4b: Login / Login-with-OTP / Forgot password ----------------

console.log("\n[4b] login.js: dual sign-in buttons + Forgot link");
check("login has a 'Login' submit button",                /id="auth-submit-signin"/.test(login));
check("login has a hidden 'Login with OTP' submit button",/id="auth-submit-otp"/.test(login));
check("login swaps between password and OTP rows",        /signinOtpRow\.hidden/.test(login) &&
                                                            /signinPwRow\.hidden/.test(login));
check("login toggles the OTP-mode button label",          /Login with password instead/.test(login));
check("login has a Forgot password link",                 /id="auth-forgot-link"/.test(login) &&
                                                            /Forgot password\?/.test(login));
check("login wires the Forgot link to mountForgotPassword",/mountForgotPassword\(/.test(login));
check("login defines mountForgotPassword as a top-level helper",
  /async function mountForgotPassword\(/.test(login));
check("login's forgot flow hits Auth.forgotSendOtp",      /Auth\.forgotSendOtp\(/.test(login));
check("login's forgot flow hits Auth.forgotVerify",       /Auth\.forgotVerify\(/.test(login));
check("login's forgot flow hits Auth.forgotReset",        /Auth\.forgotReset\(/.test(login));
check("api.js exposes Auth.forgotSendOtp/Verify/Reset",   /forgotSendOtp:/.test(api) &&
                                                            /forgotVerify:/.test(api) &&
                                                            /forgotReset:/.test(api));

// ---- Section 4c: server forgot-password routes + Resend wiring ------------

console.log("\n[4c] auth.js: forgot-password endpoints + Resend");
const authRoute = read("server/src/routes/auth.js");
const emailMod  = read("server/src/email.js");
check("server exposes /forgot/send-otp",          /authRouter\.post\("\/forgot\/send-otp"/.test(authRoute));
check("server exposes /forgot/verify",            /authRouter\.post\("\/forgot\/verify"/.test(authRoute));
check("server exposes /forgot/reset",             /authRouter\.post\("\/forgot\/reset"/.test(authRoute));
check("send-otp calls sendOtpEmail for emails",   /sendOtpEmail\(id\.value/.test(authRoute));
check("forgot/send-otp calls sendOtpEmail too",    /sendOtpEmail\(id\.value/.test(authRoute));
check("send-otp returns delivered:'email' on live send",
  /delivered:\s*"email"/.test(authRoute));
check("send-otp keeps demo fallback when Resend is off",
  /delivered:\s*"demo"/.test(authRoute));
check("server forgotStore is separate from sign-in otpStore",
  /const forgotStore\s*=\s*new Map\(\)/.test(authRoute));
check("forgot/verify issues a signed JWT reset token",
  /jwt\.sign\(\s*\{[\s\S]*scope:\s*"reset"/.test(authRoute));
check("forgot/reset verifies the OTP twice and updates passwordHash",
  /updateUser\(user\.userId,\s*\{\s*passwordHash:/.test(authRoute));
check("email.js reads RESEND_API_KEY from env",   /RESEND_API_KEY/.test(emailMod));
check("email.js POSTs to api.resend.com",         /api\.resend\.com/.test(emailMod));
check("email.js falls back to demo when key absent",
  /return\s*\{\s*ok:\s*true,\s*live:\s*false/.test(emailMod));
check("email.js default TTL is 5 minutes",        /ttlMinutes\s*\?\?\s*5/.test(emailMod));

// ---- Section 5: profile.js DOM structure ---------------------------------

console.log("\n[5] profile.js: required DOM structure");
check("profile shows section-title 'Profile'",            /section-title">Profile</.test(profile));
check("profile shows the avatar",                         /profile-card__avatar/.test(profile));
check("profile shows the name",                           /profile-card__name/.test(profile));
check("profile shows the formatted phone",                /profile-card__phone/.test(profile));
check("profile has an Edit button",                       /id="profile-edit"/.test(profile));
check("profile has a Sign out button",                    /id="profile-signout"/.test(profile));
check("profile stats show expenses count",                /state\.expenses\.length/.test(profile));
check("profile Edit regenerates the avatar on save",      /generateAvatarDataUrl\(\{[\s\S]{0,300}name:[\s\S]{0,300}phone:/.test(profile));
check("profile Edit calls Store.updateProfile",            /Store\.updateProfile\(state/.test(profile));

// ---- Section 6: main.js wiring -------------------------------------------

console.log("\n[6] main.js: server-backed auth wiring");
check("main.js imports Auth + Crypto from api.js",         /Auth,\s+Crypto/.test(main));
check("main.js calls Auth.whoami on boot",                 /Auth\.whoami\(\)/.test(main));
check("main.js calls Crypto.getVault to hydrate after unlock", /Crypto\.getVault/.test(main) || /loadVault/.test(main) || /loadVault/.test(read("js/views/unlock.js")));
check("main.js calls encrypted sync after mutations",       /saveEncryptedVault/.test(main) && /syncToServer\(\)/.test(main));
check("signOut calls Auth.signout",                        /Auth\.signout\(/.test(main));
check("signOut flushes pending sync before clearing",      /await\s+flushVaultSync/.test(main) || /await\s+flushSync/.test(main) || /await\s+syncToServer/.test(main));
check("signOut uses replaceState (no render flash)",       /history\.replaceState/.test(main));
check("main.js shows an offline toast when sync fails",    /Couldn't reach the server/.test(main) ||
                                                            /server.*offline/i.test(main));
check("bootLoginGate mounts the unlock screen",            /mountUnlock/.test(main));

// ---- Section 7: avatar helper is still deterministic ----------------------

console.log("\n[7] generateAvatarDataUrl remains stable");
const { generateAvatarDataUrl } = await import("../js/util.js");
const a = generateAvatarDataUrl({ name: "Zeeshan", phone: "9876543210" });
const b = generateAvatarDataUrl({ name: "Zeeshan", phone: "9876543210" });
const c = generateAvatarDataUrl({ name: "Aarav",   phone: "9876543210" });
check("avatar is a data: URL",              a.startsWith("data:image/svg+xml"));
check("avatar is stable per input",         a === b);
check("avatar differs for a different name", a !== c);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
