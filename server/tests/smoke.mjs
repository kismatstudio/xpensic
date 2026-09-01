// Server smoke test for the auth and encrypted-vault boundary.

import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as wait } from "node:timers/promises";
import { rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const DB_PATH = resolve(root, "expense-tracker.test.db");
const PORT = 18787;

let passed = 0;
let failed = 0;
function check(name, condition, extra = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

function fetchJson(url, options = {}, cookieJar = {}) {
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  if (cookieJar.cookie) headers.cookie = cookieJar.cookie;
  return fetch(url, { ...options, headers }).then(async (response) => {
    const setCookie = response.headers.get("set-cookie");
    const cookies = new Map(
      (cookieJar.cookie || "").split(/;\s*/).filter(Boolean).map((part) => {
        const [name, ...value] = part.split("=");
        return [name, value.join("=")];
      }),
    );
    for (const name of ["et_token", "et_refresh"]) {
      const token = new RegExp(`(?:^|,\\s*)${name}=([^;]*)`).exec(setCookie || "");
      if (token) {
        if (token[1]) cookies.set(name, token[1]);
        else cookies.delete(name);
      }
    }
    cookieJar.cookie = [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
    let body = null;
    try { body = await response.json(); } catch { /* non-JSON 404 is expected */ }
    return { status: response.status, body };
  });
}

async function main() {
  try { rmSync(DB_PATH, { force: true }); } catch { /* already absent */ }

  const child = spawn(process.execPath, [resolve(root, "src/server.js")], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH,
      NODE_ENV: "test",
      RESEND_API_KEY: "",
      RESEND_FROM: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});

  let up = false;
  for (let attempt = 0; attempt < 50 && !up; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      up = response.ok;
    } catch {
      await wait(100);
    }
  }
  if (!up) {
    child.kill();
    console.error("Server did not start in time");
    process.exit(2);
  }

  const base = `http://127.0.0.1:${PORT}`;
  const jar = {};
  try {
    console.log("\n[1] Authentication");
    const email = `test+${Date.now()}@example.com`;
    {
      const response = await fetchJson(`${base}/api/auth/signup`, {
        method: "POST",
        body: JSON.stringify({
          identifier: email,
          password: "password123",
          confirmPassword: "password123",
          displayName: "Must stay private",
        }),
      }, jar);
      check("signup succeeds", response.status === 200 && response.body?.ok === true);
      check("auth response has no private profile", !Object.hasOwn(response.body?.user || {}, "displayName"));
      check("session cookie is set", !!jar.cookie);
    }
    {
      const response = await fetchJson(`${base}/api/auth/whoami`, {}, jar);
      check("whoami succeeds", response.status === 200 && response.body?.user?.email === email);
      check("whoami has no private profile", !Object.hasOwn(response.body?.user || {}, "displayName"));
    }
    {
      const response = await fetchJson(`${base}/api/auth/refresh`, { method: "POST" }, jar);
      check("refresh succeeds", response.status === 200 && response.body?.ok === true);
    }

    console.log("\n[2] Legacy plaintext routes are unavailable");
    for (const path of [
      "/api/data",
      "/api/expenses",
      "/api/categories",
      "/api/budgets",
      "/api/settings",
      "/api/splits",
      "/api/auth/profile",
    ]) {
      const response = await fetchJson(`${base}${path}`, {}, jar);
      check(`${path} is unavailable`, response.status === 404);
    }

    console.log("\n[3] Opaque crypto storage");
    const wrap = {
      v: 1,
      wrapType: "password",
      alg: "aes-gcm-256",
      kdf: "pbkdf2-sha256",
      salt: "opaque-salt",
      nonce: "opaque-nonce",
      ct: "opaque-wrap-ciphertext",
      params: { iters: 600000 },
      createdAt: new Date().toISOString(),
    };
    {
      const response = await fetchJson(`${base}/api/crypto/master-key`, {
        method: "PUT",
        body: JSON.stringify({ wraps: [wrap] }),
      }, jar);
      check("master-key PUT succeeds", response.status === 200 && response.body?.ok === true);
    }
    {
      const response = await fetchJson(`${base}/api/crypto/master-key`, {}, jar);
      check("master-key GET succeeds", response.status === 200 && response.body?.ok === true);
      check("wrap envelope round-trips opaque", response.body?.wraps?.[0]?.envelope?.ct === wrap.ct);
    }
    const vault = {
      v: 1,
      alg: "aes-gcm-256",
      nonce: "opaque-vault-nonce",
      ct: "opaque-vault-ciphertext",
      fingerprint: "opaque-fingerprint",
      updatedAt: new Date().toISOString(),
    };
    {
      const response = await fetchJson(`${base}/api/crypto/vault`, {
        method: "PUT",
        body: JSON.stringify({ envelope: vault, revision: 0 }),
      }, jar);
      check("vault PUT succeeds", response.status === 200 && response.body?.ok === true);
      check("vault PUT returns revision 1", response.body?.revision === 1);
    }
    {
      const response = await fetchJson(`${base}/api/crypto/vault`, {}, jar);
      check("vault GET succeeds", response.status === 200 && response.body?.vault?.ct === vault.ct);
      check("vault GET returns revision 1", response.body?.revision === 1);
    }
    {
      const response = await fetchJson(`${base}/api/crypto/vault`, {
        method: "PUT",
        body: JSON.stringify({ envelope: vault, revision: 0 }),
      }, jar);
      check("stale vault PUT is rejected", response.status === 409);
    }
    {
      const response = await fetchJson(`${base}/api/crypto/vault`, { method: "DELETE" }, jar);
      check("vault DELETE succeeds", response.status === 200 && response.body?.ok === true);
      const afterDelete = await fetchJson(`${base}/api/crypto/vault`, {}, jar);
      check("deleted vault returns null", afterDelete.body?.vault === null);
    }
    {
      const response = await fetchJson(`${base}/api/crypto/master-key`, {
        method: "PUT",
        body: JSON.stringify({ wraps: [] }),
      }, jar);
      check("wrap deletion succeeds", response.status === 200 && response.body?.wraps?.length === 0);
    }
    {
      const response = await fetchJson(`${base}/api/crypto/vault`);
      check("unauthenticated vault access is rejected", response.status === 401);
    }

    console.log("\n[4] Database schema contains no plaintext data tables");
    const db = new DatabaseSync(DB_PATH);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
    const allowed = new Set(["users", "crypto_wraps", "vault_blobs", "refresh_tokens"]);
    check("only auth and crypto tables exist", tables.every((name) => allowed.has(name)), tables.join(", "));
    check("plaintext financial tables are absent", !tables.some((name) => /expense|categor|budget|split/i.test(name)));
    const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table'").all().map((row) => row.sql || "").join(" ");
    check("users table has no private profile columns", !/displayName|avatarDataUrl|loginDays/.test(schema));
    check("refresh-token row persisted", db.prepare("SELECT COUNT(*) AS count FROM refresh_tokens").get().count > 0);
    db.close();
  } finally {
    child.kill();
    await wait(100);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
