// Server smoke test — boots the API in-process on a random port, signs
// up + signs in + verifies OTP + reads/writes data. Runs in <2s.
//
// Run with: `npm run smoke` (from the server/ directory), or
//           `node tests/smoke.mjs` directly.

import { spawn } from "node:child_process";
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
function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

function fetchJson(url, opts = {}, cookieJar = {}) {
  const headers = { "content-type": "application/json", ...(opts.headers || {}) };
  if (cookieJar.cookie) headers.cookie = cookieJar.cookie;
  return fetch(url, { ...opts, headers }).then(async (res) => {
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      // Pull out the et_token cookie value only (simple parser). If the
      // value is empty (clearCookie) we drop our copy of the cookie too.
      const m = /et_token=([^;]*)/.exec(setCookie);
      if (m) {
        if (m[1] === "") {
          delete cookieJar.cookie;
        } else {
          cookieJar.cookie = `et_token=${m[1]}`;
        }
      }
    }
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  });
}

async function main() {
  // Reset the test DB so the smoke test is idempotent.
  try { rmSync(DB_PATH, { force: true }); } catch {}

  const child = spawn(
    process.execPath,
    [resolve(root, "src/server.js")],
    {
      cwd: root,
      // Force demo mode for the smoke test so the assertions about
      // `delivered: "demo"` and the returned `code` hold even on a
      // machine that has RESEND_API_KEY set in a local .env.
      env: {
        ...process.env,
        PORT: String(PORT),
        DB_PATH,
        NODE_ENV: "test",
        RESEND_API_KEY: "",
        RESEND_FROM: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});

  // Wait for /api/health to come up.
  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (r.ok) up = true;
    } catch {
      await wait(100);
    }
  }
  if (!up) {
    console.error("Server did not start in time");
    child.kill();
    process.exit(2);
  }

  try {
    const base = `http://127.0.0.1:${PORT}`;
    const jar = {};

    // --- Health ---
    console.log("\n[1] Health");
    {
      const r = await fetchJson(`${base}/api/health`);
      check("health 200", r.status === 200 && r.body?.ok === true);
    }

    // --- Signup ---
    console.log("\n[2] Signup");
    const email = "test+" + Date.now() + "@example.com";
    {
      const r = await fetchJson(
        `${base}/api/auth/signup`,
        {
          method: "POST",
          body: JSON.stringify({
            identifier: email,
            password: "password123",
            confirmPassword: "password123",
            displayName: "Smoke Tester",
          }),
        },
        jar
      );
      check("signup 200", r.status === 200 && r.body?.ok === true, JSON.stringify(r.body));
      check("user returned", r.body?.user?.email === email);
      check("cookie set", !!jar.cookie);
    }
    {
      // duplicate signup fails
      const r = await fetchJson(
        `${base}/api/auth/signup`,
        {
          method: "POST",
          body: JSON.stringify({
            identifier: email,
            password: "password123",
            confirmPassword: "password123",
          }),
        }
      );
      check("duplicate signup 409", r.status === 409, JSON.stringify(r.body));
    }
    {
      // password mismatch fails
      const r = await fetchJson(
        `${base}/api/auth/signup`,
        {
          method: "POST",
          body: JSON.stringify({
            identifier: "x@example.com",
            password: "password123",
            confirmPassword: "different",
          }),
        }
      );
      check("password mismatch 400", r.status === 400, JSON.stringify(r.body));
    }

    // --- Signin ---
    console.log("\n[3] Signin");
    {
      const r = await fetchJson(
        `${base}/api/auth/signin`,
        {
          method: "POST",
          body: JSON.stringify({ identifier: email, password: "password123" }),
        },
        jar
      );
      check("signin 200", r.status === 200 && r.body?.ok === true, JSON.stringify(r.body));
      check("user echoed", r.body?.user?.email === email);
    }
    {
      const r = await fetchJson(
        `${base}/api/auth/signin`,
        {
          method: "POST",
          body: JSON.stringify({ identifier: email, password: "WRONG" }),
        }
      );
      check("wrong password 401", r.status === 401, JSON.stringify(r.body));
    }
    {
      const r = await fetchJson(
        `${base}/api/auth/signin`,
        {
          method: "POST",
          body: JSON.stringify({ identifier: "nobody@example.com", password: "password123" }),
        }
      );
      check("unregistered 401 with signup hint", r.status === 401 && /sign up/i.test(r.body?.error || ""));
    }

    // --- whoami ---
    console.log("\n[4] whoami");
    {
      const r = await fetchJson(`${base}/api/auth/whoami`, {}, jar);
      check("whoami returns user", r.body?.user?.email === email);
    }
    {
      const r = await fetchJson(`${base}/api/auth/whoami`);
      check("whoami unauth 401", r.status === 401);
    }

    // --- OTP (demo / Resend fallback) ---
    console.log("\n[5] OTP (demo / Resend fallback)");
    let otp;
    {
      const r = await fetchJson(`${base}/api/auth/send-otp`, {
        method: "POST",
        body: JSON.stringify({ identifier: email }),
      });
      check("send-otp 200", r.status === 200 && r.body?.ok === true);
      check("send-otp delivered flag is 'demo' (no RESEND_API_KEY)",
        r.body?.delivered === "demo" && /^[0-9]{4}$/.test(r.body?.code || ""));
      otp = r.body.code;
    }
    {
      const r = await fetchJson(`${base}/api/auth/send-otp`, {
        method: "POST",
        body: JSON.stringify({ identifier: "nobody-resend@example.com" }),
      });
      check("send-otp unknown email 401", r.status === 401);
    }
    {
      const r = await fetchJson(`${base}/api/auth/verify-otp`, {
        method: "POST",
        body: JSON.stringify({ identifier: email, code: otp }),
      });
      check("verify-otp correct 200", r.status === 200 && r.body?.ok === true);
    }
    {
      const r = await fetchJson(`${base}/api/auth/verify-otp`, {
        method: "POST",
        body: JSON.stringify({ identifier: email, code: "0000" }),
      });
      check("verify-otp wrong 400", r.status === 400);
    }

    // --- Forgot password flow ---
    console.log("\n[5b] Forgot password flow");
    {
      const r = await fetchJson(`${base}/api/auth/forgot/send-otp`, {
        method: "POST",
        body: JSON.stringify({ identifier: email }),
      });
      check("forgot/send-otp 200", r.status === 200 && r.body?.ok === true);
      check("forgot/send-otp demo fallback (no RESEND_API_KEY)",
        r.body?.delivered === "demo" && /^[0-9]{4}$/.test(r.body?.code || ""));
      var forgotOtp = r.body.code;
    }
    {
      const r = await fetchJson(`${base}/api/auth/forgot/send-otp`, {
        method: "POST",
        body: JSON.stringify({ identifier: "ghost@example.com" }),
      });
      check("forgot/send-otp unknown email returns generic 200",
        r.status === 200 && r.body?.ok === true);
      check("forgot/send-otp unknown email does not leak the code",
        !r.body?.code);
    }
    let resetToken;
    {
      const r = await fetchJson(`${base}/api/auth/forgot/verify`, {
        method: "POST",
        body: JSON.stringify({ identifier: email, code: forgotOtp }),
      });
      check("forgot/verify 200", r.status === 200 && r.body?.ok === true);
      check("forgot/verify issues a reset token", typeof r.body?.resetToken === "string" && r.body.resetToken.length > 20);
      resetToken = r.body.resetToken;
    }
    {
      const r = await fetchJson(`${base}/api/auth/forgot/verify`, {
        method: "POST",
        body: JSON.stringify({ identifier: email, code: "0000" }),
      });
      check("forgot/verify wrong code 400", r.status === 400);
    }
    {
      const r = await fetchJson(`${base}/api/auth/forgot/reset`, {
        method: "POST",
        body: JSON.stringify({
          identifier: email,
          code: forgotOtp,
          resetToken,
          newPassword: "newpassword123",
        }),
      });
      check("forgot/reset 200", r.status === 200 && r.body?.ok === true);
    }
    {
      // Old password no longer works
      const r = await fetchJson(`${base}/api/auth/signin`, {
        method: "POST",
        body: JSON.stringify({ identifier: email, password: "password123" }),
      });
      check("old password 401 after reset", r.status === 401);
    }
    {
      // New password works
      const r = await fetchJson(`${base}/api/auth/signin`, {
        method: "POST",
        body: JSON.stringify({ identifier: email, password: "newpassword123" }),
      }, jar);
      check("new password 200 after reset", r.status === 200 && r.body?.ok === true);
    }
    {
      // Reset token without matching identifier is rejected
      const r = await fetchJson(`${base}/api/auth/forgot/reset`, {
        method: "POST",
        body: JSON.stringify({
          identifier: "x@example.com",
          code: "0000",
          resetToken: "not-a-real-token",
          newPassword: "newpassword123",
        }),
      });
      check("forgot/reset bad token 401", r.status === 401);
    }

    // --- Per-resource data endpoints ---
    console.log("\n[6] Per-resource data (expenses / categories / budgets / settings)");
    {
      // GET /api/data still works (assembles blob from per-table reads)
      const r = await fetchJson(`${base}/api/data`, {}, jar);
      check("GET /api/data 200", r.status === 200 && r.body?.ok === true);
      // E2EE architecture: categories are encrypted in the client vault and
      // seeded client-side on first unlock. The server never holds plaintext
      // category lists for a fresh account.
      check("data has 0 categories server-side (E2EE)", r.body?.data?.categories?.length === 0);
      check("data has 0 expenses initially", r.body?.data?.expenses?.length === 0);
    }
    {
      // PUT /api/data is gone — should 404 (route no longer exists)
      const r = await fetchJson(`${base}/api/data`, { method: "PUT", body: JSON.stringify({}) }, jar);
      check("PUT /api/data removed (404)", r.status === 404);
    }

    // --- Expenses CRUD ---
    console.log("\n[6a] Expenses CRUD");
    let expId;
    {
      const r = await fetchJson(`${base}/api/expenses`, {
        method: "POST",
        body: JSON.stringify({
          amount: 250.50,
          date: "2026-08-04",
          categoryId: "cat_food",
          note: "smoke test lunch",
          time: "12:30",
          paymentMethod: "cash",
        }),
      }, jar);
      check("POST /api/expenses 200", r.status === 200 && r.body?.ok === true);
      check("expense has id", typeof r.body?.expense?.id === "string");
      check("expense has userId", typeof r.body?.expense?.userId === "string");
      expId = r.body?.expense?.id;
    }
    {
      const r = await fetchJson(`${base}/api/expenses`, {}, jar);
      check("GET /api/expenses 200", r.status === 200 && r.body?.ok === true);
      check("expense appears in list", r.body?.expenses?.length === 1);
      check("expense amount matches", r.body?.expenses?.[0]?.amount === 250.50);
    }
    {
      const r = await fetchJson(`${base}/api/expenses/${expId}`, {
        method: "PUT",
        body: JSON.stringify({
          amount: 300,
          date: "2026-08-04",
          categoryId: "cat_food",
          note: "updated note",
          time: "12:30",
          paymentMethod: "upi",
          upiApp: "gpay",
        }),
      }, jar);
      check("PUT /api/expenses/:id 200", r.status === 200 && r.body?.ok === true);
      check("expense updated", r.body?.expense?.amount === 300);
      check("upiApp set when paymentMethod=upi", r.body?.expense?.upiApp === "gpay");
    }
    {
      // unauthenticated expense create rejected
      const r = await fetchJson(`${base}/api/expenses`, {
        method: "POST",
        body: JSON.stringify({ amount: 1, date: "2026-01-01", categoryId: "cat_food", paymentMethod: "cash" }),
      });
      check("POST /api/expenses unauth 401", r.status === 401);
    }

    // --- Categories CRUD ---
    console.log("\n[6b] Categories CRUD");
    let catId;
    {
      const r = await fetchJson(`${base}/api/categories`, {
        method: "POST",
        body: JSON.stringify({ name: "Test Cat", color: "#ff0000", icon: "🧪" }),
      }, jar);
      check("POST /api/categories 200", r.status === 200 && r.body?.ok === true);
      catId = r.body?.category?.id;
    }
    {
      const r = await fetchJson(`${base}/api/categories`, {}, jar);
      check("GET /api/categories 200", r.status === 200 && r.body?.ok === true);
      check("custom category appears", r.body?.categories?.some((c) => c.id === catId));
    }
    {
      const r = await fetchJson(`${base}/api/categories/${catId}`, {
        method: "PUT",
        body: JSON.stringify({ name: "Renamed Cat", color: "#00ff00", icon: "✏️" }),
      }, jar);
      check("PUT /api/categories/:id 200", r.status === 200 && r.body?.ok === true);
      check("category renamed", r.body?.category?.name === "Renamed Cat");
    }

    // --- Budgets ---
    console.log("\n[6c] Budgets");
    {
      const r = await fetchJson(`${base}/api/budgets`, {
        method: "PUT",
        body: JSON.stringify({ monthly: { "2026-08": { cat_food: 500, cat_transport: 200 } } }),
      }, jar);
      check("PUT /api/budgets 200", r.status === 200 && r.body?.ok === true);
    }
    {
      const r = await fetchJson(`${base}/api/budgets`, {}, jar);
      check("GET /api/budgets 200", r.status === 200 && r.body?.ok === true);
      check("budget for cat_food matches", r.body?.budgets?.monthly?.["2026-08"]?.cat_food === 500);
      check("budget for cat_transport matches", r.body?.budgets?.monthly?.["2026-08"]?.cat_transport === 200);
    }

    // --- Settings ---
    console.log("\n[6d] Settings");
    {
      const r = await fetchJson(`${base}/api/settings`, {
        method: "PUT",
        body: JSON.stringify({ currency: "USD", currencySymbol: "$" }),
      }, jar);
      check("PUT /api/settings 200", r.status === 200 && r.body?.ok === true);
      check("settings updated", r.body?.settings?.currency === "USD");
    }
    {
      const r = await fetchJson(`${base}/api/settings`, {}, jar);
      check("GET /api/settings 200", r.status === 200 && r.body?.ok === true);
      check("settings persisted", r.body?.settings?.currency === "USD");
    }

    // --- Profile (PATCH /api/auth/profile → users.csv) ---
    console.log("\n[6e] Profile update");
    {
      const r = await fetchJson(`${base}/api/auth/profile`, {
        method: "PATCH",
        body: JSON.stringify({ displayName: "Updated Name", phone: "9876543210" }),
      }, jar);
      check("PATCH /api/auth/profile 200", r.status === 200 && r.body?.ok === true);
      check("profile name updated", r.body?.user?.displayName === "Updated Name");
    }
    {
      const r = await fetchJson(`${base}/api/auth/whoami`, {}, jar);
      check("whoami reflects profile update", r.body?.user?.displayName === "Updated Name");
    }

    // --- GET /api/data assembles everything ---
    console.log("\n[6f] GET /api/data assembles blob");
    {
      const r = await fetchJson(`${base}/api/data`, {}, jar);
      check("assembled blob has expense", r.body?.data?.expenses?.length === 1);
      check("assembled blob has custom category", r.body?.data?.categories?.some((c) => c.id === catId));
      check("assembled blob has budget", r.body?.data?.budgets?.monthly?.["2026-08"]?.cat_food === 500);
      check("assembled blob has settings", r.body?.data?.settings?.currency === "USD");
      check("assembled blob has profile name", r.body?.data?.profile?.name === "Updated Name");
    }

    // --- Delete expense ---
    console.log("\n[6g] Delete expense");
    {
      const r = await fetchJson(`${base}/api/expenses/${expId}`, { method: "DELETE" }, jar);
      check("DELETE /api/expenses/:id 200", r.status === 200 && r.body?.ok === true);
    }
    {
      const r = await fetchJson(`${base}/api/expenses`, {}, jar);
      check("expense gone after delete", r.body?.expenses?.length === 0);
    }
    {
      const r = await fetchJson(`${base}/api/expenses/${expId}`, { method: "DELETE" }, jar);
      check("DELETE non-existent 404", r.status === 404);
    }

    // --- Signout ---
    console.log("\n[7] Signout");
    {
      const r = await fetchJson(`${base}/api/auth/signout`, { method: "POST" }, jar);
      check("signout 200", r.status === 200 && r.body?.ok === true);
    }
    {
      const r = await fetchJson(`${base}/api/auth/whoami`, {}, jar);
      check("whoami after signout 401", r.status === 401);
    }
  } finally {
    child.kill();
    await wait(100);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
