// Resilience of the local caches / session handling (the "app freezes, then a
// refresh lands on Unlock your vault" class of bugs):
//   • IndexedDB wrapper: never hangs, never caches a failed open, reopens.
//   • api.js: concurrent 401s share ONE token refresh; requests bypass the
//     HTTP cache.
//   • Wiring checks for the boot / sync hardening in main.js and the
//     no-store / no-cache headers.

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, dirname } from "node:path";

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}` + (extra ? `  (${extra})` : "")); fail++; }
}
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
console.log("\n[1] IndexedDB wrapper");
const { createIdb, withTimeout } = await import(pathToFileURL(join(root, "js/crypto/idb.mjs")).href);

function fakeIndexedDB(behaviour) {
  const data = new Map();
  const state = { opens: 0, behaviour };
  const makeDb = () => ({
    objectStoreNames: { contains: () => true },
    transaction() {
      if (state.behaviour.txThrows) { state.behaviour.txThrows = false; throw new Error("InvalidStateError"); }
      const tx = {};
      tx.objectStore = () => ({
        get(key) {
          const req = {};
          if (!state.behaviour.txHangs) queueMicrotask(() => { req.result = data.get(key); req.onsuccess?.(); tx.oncomplete?.(); });
          return req;
        },
        put(row) {
          const req = {};
          if (!state.behaviour.txHangs) queueMicrotask(() => { data.set(row.userId, row); req.result = row.userId; req.onsuccess?.(); tx.oncomplete?.(); });
          return req;
        },
      });
      return tx;
    },
    close() {},
  });
  return {
    state,
    open() {
      state.opens++;
      const req = {};
      if (state.behaviour.openHangs) return req; // never fires
      if (state.behaviour.openBlocked) { queueMicrotask(() => req.onblocked?.()); return req; }
      queueMicrotask(() => { req.result = makeDb(); req.onsuccess?.(); });
      return req;
    },
  };
}
const cfg = { name: "t", version: 1, store: "s", upgrade() {}, timeoutMs: 60 };

{
  globalThis.indexedDB = fakeIndexedDB({ openHangs: true });
  const idb = createIdb(cfg);
  const t0 = Date.now();
  const r = await idb.withStore("readonly", (s) => s.get("u"));
  check("a hung open resolves to null instead of freezing", r === null && Date.now() - t0 < 1000);
  check("isOpenable() is false while it hangs", (await idb.isOpenable()) === false);
}
{
  const fake = fakeIndexedDB({ openHangs: true });
  globalThis.indexedDB = fake;
  const idb = createIdb(cfg);
  await idb.withStore("readonly", (s) => s.get("u"));
  fake.state.behaviour.openHangs = false; // the database recovers
  const row = await idb.withStore("readwrite", (s) => s.put({ userId: "u", v: 1 }));
  check("a failed open is not cached — the next call succeeds", row === "u");
  const got = await idb.withStore("readonly", (s) => s.get("u"));
  check("reads back what was stored", got && got.v === 1);
}
{
  const fake = fakeIndexedDB({ openBlocked: true });
  globalThis.indexedDB = fake;
  const idb = createIdb(cfg);
  const t0 = Date.now();
  const r = await idb.withStore("readonly", (s) => s.get("u"));
  check("a 'blocked' open is bounded by the timeout", r === null && Date.now() - t0 < 1000);
  fake.state.behaviour.openBlocked = false;
  check("…and works once the blocker is gone", (await idb.withStore("readwrite", (s) => s.put({ userId: "x" }))) === "x");
}
{
  const fake = fakeIndexedDB({ txHangs: true });
  globalThis.indexedDB = fake;
  const idb = createIdb(cfg);
  const t0 = Date.now();
  const r = await idb.withStore("readonly", (s) => s.get("u"));
  check("a transaction that never completes resolves to null", r === null && Date.now() - t0 < 1000);
}
{
  const fake = fakeIndexedDB({ txThrows: true });
  globalThis.indexedDB = fake;
  const idb = createIdb(cfg);
  const row = await idb.withStore("readwrite", (s) => s.put({ userId: "y" }));
  check("a connection closed under us is reopened once", row === "y" && fake.state.opens === 2, `opens=${fake.state.opens}`);
}
{
  let timedOut = false;
  try { await withTimeout(new Promise(() => {}), 30, "x"); } catch { timedOut = true; }
  check("withTimeout rejects a promise that never settles", timedOut);
  check("withTimeout passes through a fast result", (await withTimeout(Promise.resolve(7), 100)) === 7);
}
delete globalThis.indexedDB;

// ---------------------------------------------------------------------------
console.log("\n[2] api.js: one shared refresh");
{
  let refreshCalls = 0;
  let refreshed = false;
  const seenCache = [];
  globalThis.fetch = async (url, opts = {}) => {
    seenCache.push(opts.cache);
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (String(url).endsWith("/api/auth/refresh")) {
      refreshCalls++;
      await sleep(30);
      refreshed = true;
      return json(200, { ok: true });
    }
    if (!refreshed) return json(401, { ok: false, error: "expired" });
    return json(200, { ok: true, user: { userId: "u1" } });
  };
  const { Auth } = await import(pathToFileURL(join(root, "js/api.js")).href);
  const results = await Promise.all([Auth.whoami(), Auth.whoami(), Auth.whoami(), Auth.whoami(), Auth.whoami()]);
  check("five concurrent 401s trigger a single refresh", refreshCalls === 1, `refreshCalls=${refreshCalls}`);
  check("every request is retried and succeeds", results.every((r) => r.user && r.user.userId === "u1"));
  check("requests bypass the HTTP cache", seenCache.every((c) => c === "no-store"));
}

// ---------------------------------------------------------------------------
console.log("\n[3] Wiring");
const main = read("js/main.js");
check("vault sync is bounded by a watchdog", /withTimeout\(saveEncryptedVault\(session\.state\)/.test(main));
check("failed syncs retry on their own", /function scheduleSyncRetry/.test(main) && /addEventListener\("online"/.test(main));
check("a failed master-key fetch no longer routes to vault setup", /mountConnectionProblem\(\{/.test(main) && /wrapsFetched/.test(main));
check("auto-unlock retries the vault load and handles an empty vault", /for \(let attempt = 0; attempt < 3; attempt\+\+\)[\s\S]{0,300}loadEncryptedVault/.test(main) && /if \(!state\) state = \{ \.\.\.Store\.reset\(\) \}/.test(main));
check("device setup after unlock is time-bounded", /Device setup/.test(main));
check("both IndexedDB stores use the defensive wrapper",
  /createIdb/.test(read("js/crypto/device-key.mjs")) && /createIdb/.test(read("js/crypto/vault-cache.mjs")));
check("API responses are served no-store", /Cache-Control", "no-store/.test(read("server/src/server.js")));
check("static assets always revalidate on Pages", /\/js\/\*\s*\n\s*Cache-Control: no-cache/.test(read("_headers")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
