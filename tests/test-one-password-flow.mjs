// Smoke test for the E2EE unlock flow: every fresh sign-in routes
// through either (a) the unlock screen if the user has existing
// wraps, or (b) the vault-setup wizard if they're brand-new. The
// master password NEVER leaves the client unwrapped, and is NEVER
// cached in sessionStorage/localStorage (that would defeat the
// whole point of E2EE).

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
const unlock = read("js/views/unlock.js");
const setup = read("js/views/vault-setup.js");
const vault = read("js/crypto/vault.mjs");
const keystore = read("js/crypto/keystore.mjs");
const recovery = read("js/crypto/recovery.mjs");

// ---- Section 1: master-key wraps are the source of truth --------

console.log("\n[1] crypto primitives are correctly wired");
check("vault uses AES-GCM-256 AEAD",
  /aes-gcm-256/.test(vault) && /aeadEncrypt/.test(vault));
check("keystore uses PBKDF2-HMAC-SHA256 for password wraps",
  /pbkdf2/i.test(keystore) && /wrapWithPassword/.test(keystore));
check("keystore supports phrase wraps",
  /wrapWithPhrase/.test(keystore) && /unwrapWithPhrase/.test(keystore));
check("recovery module uses a 256-word dictionary",
  /WORDS = \(/.test(recovery) && /length !== 256/.test(recovery));

// ---- Section 2: unlock flow never caches the plaintext password --

console.log("\n[2] unlock screen never stores the password client-side");
check("unlock.js does NOT cache the password in sessionStorage",
  !/sessionStorage\.setItem\(\s*["']xpensic:account-pw/.test(unlock));
check("unlock.js does NOT cache the password in localStorage",
  !/localStorage\.setItem\(\s*["']xpensic:account-pw/.test(unlock));
check("unlock.js mounts a password input that the user types each session",
  /type="password"/.test(unlock) && /unlock-pw/.test(unlock));
check("unlock.js offers a recovery-phrase fallback",
  /Recovery phrase/i.test(unlock) && /unwrapWithPhrase/.test(unlock));

// ---- Section 3: vault setup wizard for brand-new accounts ---------

console.log("\n[3] vault setup wizard for brand-new accounts");
check("setup asks for a master password (≥8 chars)",
  /setup-pw1/.test(setup) && /minlength="8"/.test(setup));
check("setup requires a confirmation password",
  /setup-pw2/.test(setup));
check("setup generates a recovery phrase on opt-in",
  /generatePhrase/.test(setup) && /setup-phrase-check/.test(setup));
check("setup writes both wraps to the server via Crypto.putMasterKey",
  /Crypto\.putMasterKey/.test(setup));

// ---- Section 4: main.js routes sign-in → unlock OR setup ----------

console.log("\n[4] main.js boot flow routes through unlock or setup");
check("main.js calls Crypto.getMasterKey to decide the flow",
  /Crypto\.getMasterKey\(\)/.test(main));
check("main.js calls mountUnlock when wraps exist (after device auto-unlock attempt)",
  /tryDeviceAutoUnlock/.test(main) && /mountUnlock/.test(main));
check("main.js calls mountVaultSetup when no wraps exist",
  /wraps\.length === 0/.test(main) && /mountVaultSetup/.test(main));
check("main.js records the login day AFTER unlock (post-hydrate)",
  /afterUnlock[\s\S]{0,1000}recordLoginDay/.test(main));
check("main.js promotes an unlocked session into a persistent device wrap",
  /ensureDeviceWrap/.test(main) && /wrapWithDeviceKey/.test(main));
check("main.js attempts device-wrap auto-unlock before the unlock screen",
  /tryDeviceAutoUnlock[\s\S]{0,300}mountUnlock/.test(main));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);