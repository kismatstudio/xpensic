// Executable checks for the client/server E2EE boundary.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const read = (relativePath) => readFileSync(join(root, relativePath), "utf8");

let pass = 0;
let fail = 0;
function check(name, condition, extra = "") {
  if (condition) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${extra ? ` (${extra})` : ""}`);
  }
}

const main = read("js/main.js");
const api = read("js/api.js");
const store = read("js/store.js");
const vault = read("js/crypto/vault.mjs");
const schema = read("server/schemas/schema.sql");
const server = read("server/src/server.js");
const index = read("index.html");

console.log("\n[1] application wiring has one encrypted data boundary");
check("main saves through the encrypted vault", /saveEncryptedVault/.test(main));
check("main loads only the encrypted vault", /loadEncryptedVault/.test(main));
check("main registers the encrypted save listener", /Store\.onSave\(\(\) => syncToServer\(\)\)/.test(main));
check("main has no plaintext data hydration", !/Data\.get|hydrateFromServer/.test(main));
check("main has no per-resource sync clients", !/Expenses\.|Categories\.|Budgets\.|Settings\.|Splits\./.test(main));
check("api exposes vault deletion", /deleteVault:/.test(api));
check("api has no plaintext data clients", !/export const (Data|Expenses|Categories|Budgets|Settings|Splits)/.test(api));
check("Store does not read application state from localStorage",
  !/localStorage\.getItem\(STORAGE_KEY\)/.test(store));
check("Store does not write application state to localStorage",
  !/localStorage\.setItem\(STORAGE_KEY/.test(store));
check("server does not mount plaintext data routes",
  !/app\.use\("\/api\/(data|expenses|categories|budgets|settings|splits)"/.test(server));
check("sidebar E2EE label is an accessible button",
  /<button[\s\S]*id="app-nav-encrypted"[\s\S]*aria-label="Learn about end-to-end encryption"/.test(index));
check("sidebar E2EE button opens an in-app modal",
  /app-nav-encrypted[\s\S]*openEncryptionInfoModal/.test(main));
check("encryption modal links to the public repository",
  /https:\/\/github\.com\/kismatstudio\/xpensic/.test(main));
check("schema has no plaintext financial tables",
  !/CREATE TABLE IF NOT EXISTS (expenses|categories|budgets|splits|blobs)/i.test(schema));
check("schema keeps encrypted vault storage", /CREATE TABLE IF NOT EXISTS vault_blobs/.test(schema));
check("vault sync has local conflict retry", /uploadVault[\s\S]*status !== 409/.test(read("js/crypto/vault-sync.mjs")));

console.log("\n[2] vault encryption round-trip and tamper resistance");
const { newMasterKey, b64ToBytes, bytesToB64 } = await import("../js/crypto/sodium.mjs");
const { encryptVault, decryptVault } = await import("../js/crypto/vault.mjs");
const masterKey = newMasterKey();
const state = {
  version: 6,
  profile: { userId: "user_test", name: "Private User" },
  settings: { currency: "INR" },
  categories: [{ id: "cat_food", name: "Food" }],
  budgets: { monthly: {} },
  expenses: [{ id: "exp_test", amount: 9876, note: "PRIVACY_CANARY_123" }],
  splits: [],
  loginDays: [],
};
const envelope = await encryptVault(masterKey, state);
const serializedEnvelope = JSON.stringify(envelope);
check("vault envelope uses the implemented algorithm", envelope.alg === "aes-gcm-256");
check("vault envelope does not contain plaintext canary", !serializedEnvelope.includes("PRIVACY_CANARY_123"));
const restored = await decryptVault(masterKey, envelope);
check("vault decrypt restores the original state",
  JSON.stringify(restored) === JSON.stringify(state));

const modifiedCiphertext = b64ToBytes(envelope.ct);
modifiedCiphertext[0] ^= 1;
try {
  await decryptVault(masterKey, { ...envelope, ct: bytesToB64(modifiedCiphertext) });
  check("modified ciphertext is rejected", false, "decrypt unexpectedly succeeded");
} catch {
  check("modified ciphertext is rejected", true);
}

console.log("\n[3] local cache stores ciphertext only");
const localValues = new Map();
globalThis.localStorage = {
  getItem: (key) => localValues.get(key) || null,
  setItem: (key, value) => localValues.set(key, String(value)),
  removeItem: (key) => localValues.delete(key),
};
const cache = await import(`../js/crypto/vault-cache.mjs?boundary=${Date.now()}`);
const cacheEnvelope = { v: 1, alg: "aes-gcm-256", nonce: "nonce", ct: "ciphertext" };
check("encrypted cache save succeeds", await cache.saveEncryptedVault("user_test", cacheEnvelope));
check("encrypted cache round-trips the envelope",
  (await cache.getEncryptedVault("user_test"))?.ct === "ciphertext");
check("encrypted cache contains no plaintext canary",
  !Array.from(localValues.values()).some((value) => value.includes("PRIVACY_CANARY_123")));
await cache.clearEncryptedVault("user_test");
check("encrypted cache clears", (await cache.getEncryptedVault("user_test")) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);