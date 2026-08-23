// Tests for the IndexedDB-bound device key + device wrap that lets the
// boot flow silently auto-unlock the vault on a page refresh.
//
// Background: without a device wrap, every reload re-prompts the user
// for the master password even though the auth cookie is still valid.
// To fix that we generate a per-browser device key, persist it in
// IndexedDB, and upload a "device"-type wrap of the master key to the
// server. On reload, the boot flow:
//   1. fetches wraps,
//   2. finds the matching device wrap for this browser's deviceId,
//   3. reads the device key from IndexedDB,
//   4. unwraps the MK without any user input.
//
// The tests here verify the JS-side primitives that make this work:
// the keystore helpers wrap/unwrap with a device key, the device-key
// module is importable + IndexedDB-backed, and main.js wires the
// silent-unlock path into the boot flow.

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
const keystore = read("js/crypto/keystore.mjs");
const deviceKey = read("js/crypto/device-key.mjs");

// ---- Section 1: keystore exposes device-wrap helpers ----------

console.log("\n[1] keystore exposes device-wrap helpers");
check("keystore exports wrapWithDeviceKey",
  /export\s+(?:async\s+)?function\s+wrapWithDeviceKey/.test(keystore));
check("keystore exports unwrapWithDeviceKey",
  /export\s+(?:async\s+)?function\s+unwrapWithDeviceKey/.test(keystore));
check("keystore exports newDeviceKey",
  /export\s+function\s+newDeviceKey/.test(keystore));
check("keystore exports getDeviceId",
  /export\s+function\s+getDeviceId/.test(keystore));
check("device-wrap envelope includes wrapType === \"device\"",
  /wrapType:\s*["']device["']/.test(keystore));
check("device-wrap envelope includes deviceId",
  /deviceId:\s*id/.test(keystore) || /deviceId/.test(keystore));

// ---- Section 2: device-key module is IndexedDB-backed ----------

console.log("\n[2] device-key module persists per-user key in IndexedDB");
check("device-key module declares DB_NAME + STORE",
  /DB_NAME\s*=\s*["']xpensic["']/.test(deviceKey) && /STORE\s*=\s*["']device_keys["']/.test(deviceKey));
check("device-key module uses indexedDB",
  /indexedDB\.open/.test(deviceKey));
check("device-key module exports getDeviceKey / setDeviceKey / clearDeviceKey / newDeviceKey",
  /export\s+(?:async\s+)?function\s+getDeviceKey/.test(deviceKey) &&
  /export\s+(?:async\s+)?function\s+setDeviceKey/.test(deviceKey) &&
  /export\s+(?:async\s+)?function\s+clearDeviceKey/.test(deviceKey) &&
  /export\s+function\s+newDeviceKey/.test(deviceKey));
check("device-key module degrades gracefully when IndexedDB is unavailable",
  /indexedDB\s*===\s*["']undefined["']/.test(deviceKey) || /typeof\s+indexedDB\s*===\s*["']undefined["']/.test(deviceKey) ||
  /typeof\s+indexedDB/.test(deviceKey));

// ---- Section 3: main.js wires the silent auto-unlock path ----

console.log("\n[3] main.js wires the silent auto-unlock path");
check("main.js imports the device-key helpers",
  /from\s+["']\.\/crypto\/device-key\.mjs["']/.test(main));
check("main.js imports the device-wrap helpers from keystore",
  /from\s+["']\.\/crypto\/keystore\.mjs["']/.test(main));
check("main.js defines tryDeviceAutoUnlock",
  /async\s+function\s+tryDeviceAutoUnlock/.test(main));
check("main.js calls tryDeviceAutoUnlock before mountUnlock",
  /tryDeviceAutoUnlock[\s\S]{0,400}mountUnlock/.test(main));
check("main.js tries a device wrap with the matching deviceId",
  /w\.envelope[\s\S]{0,200}deviceId[\s\S]{0,200}===[\s\S]{0,200}deviceId/.test(main) ||
  /envelope\.deviceId[\s\S]{0,200}===[\s\S]{0,200}deviceId/.test(main));
check("main.js calls loadEncryptedVault after unwrap to hydrate the state",
  /unwrapWithDeviceKey[\s\S]{0,400}loadEncryptedVault/.test(main) ||
  /setMasterKey[\s\S]{0,400}loadEncryptedVault/.test(main));

// ---- Section 4: main.js promotes unlocked sessions into a device wrap ---

console.log("\n[4] main.js persists a device wrap after every unlock");
check("main.js defines ensureDeviceWrap",
  /async\s+function\s+ensureDeviceWrap/.test(main));
check("ensureDeviceWrap pulls existing wraps so it can merge",
  /existingWraps/.test(main) && /Crypto\.getMasterKey/.test(main));
check("ensureDeviceWrap uploads via Crypto.putMasterKey",
  /Crypto\.putMasterKey/.test(main) && /ensureDeviceWrap/.test(main));
check("afterUnlock triggers ensureDeviceWrap",
  /afterUnlock[\s\S]{0,1200}ensureDeviceWrap/.test(main));

// ---- Section 5: signOut wipes the local device key ----------

console.log("\n[5] signOut wipes the local device key from IndexedDB");
check("signOut calls clearLocalDeviceKey",
  /async\s+function\s+signOut[\s\S]{0,600}clearLocalDeviceKey/.test(main));
check("signOut still calls Auth.signout",
  /Auth\.signout\(/.test(main));

// ---- Section 5b: periodic re-auth (7-day) --------------------

console.log("\n[5b] periodic re-auth prevents indefinite auto-unlock");
check("device-key module exports needsReauth",
  /export\s+(?:async\s+)?function\s+needsReauth/.test(deviceKey));
check("device-key module exports touchLastUnlockAt",
  /export\s+(?:async\s+)?function\s+touchLastUnlockAt/.test(deviceKey));
check("device-key module exports getLastUnlockAt",
  /export\s+(?:async\s+)?function\s+getLastUnlockAt/.test(deviceKey));
check("device-key module defines REAUTH_INTERVAL_MS as 7 days",
  /REAUTH_INTERVAL_MS\s*=\s*7\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(deviceKey));
check("DB_VERSION bumped to 2 (fixes missing object store)",
  /DB_VERSION\s*=\s*2/.test(deviceKey));
check("tryDeviceAutoUnlock checks needsReauth before unwrapping",
  /needsReauth[\s\S]{0,300}unwrapWithDeviceKey/.test(main));
check("main.js imports needsReauth + touchLastUnlockAt",
  /needsReauth/.test(main) && /touchLastUnlockAt/.test(main));
check("afterUnlock stamps lastUnlockAt on password unlock",
  /passwordUnlock[\s\S]{0,400}touchLastUnlockAt/.test(main));
check("manual unlock path passes passwordUnlock: true",
  /mountUnlock[\s\S]{0,300}passwordUnlock:\s*true/.test(main));
check("auto-unlock path does NOT pass passwordUnlock: true",
  // Extract the tryDeviceAutoUnlock function body and check the
  // afterUnlock call inside it lacks passwordUnlock: true. The
  // mountUnlock call that follows DOES have it, so we can't just
  // grep the whole file — we scope to the function body.
  (function () {
    const fn = main.match(/async\s+function\s+tryDeviceAutoUnlock[\s\S]*?\n\}/)?.[0] || "";
    const afterCall = fn.match(/afterUnlock\([^)]*\)/)?.[0] || "";
    return !/passwordUnlock:\s*true/.test(afterCall);
  })());

// ---- Section 6: live crypto round-trip ----------------------------

console.log("\n[6] device-key wrap round-trips correctly");
const { wrapWithDeviceKey, unwrapWithDeviceKey, newDeviceKey } = await import("../js/crypto/keystore.mjs");
const k1 = newDeviceKey();
const mk = new Uint8Array(32); crypto.getRandomValues(mk);
const wrap = await wrapWithDeviceKey(mk, k1, "test-device-id-1234");
check("envelope.wrapType is \"device\"", wrap.wrapType === "device");
check("envelope.deviceId round-trips", wrap.deviceId === "test-device-id-1234");
check("envelope carries AEAD fields", typeof wrap.nonce === "string" && typeof wrap.ct === "string");
const restored = await unwrapWithDeviceKey(wrap, k1);
check("unwrapped MK matches original",
  Array.from(restored).every((b, i) => b === mk[i]));
try {
  await unwrapWithDeviceKey(wrap, newDeviceKey());
  check("wrong key throws", false, "expected throw");
} catch {
  check("wrong key throws", true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
