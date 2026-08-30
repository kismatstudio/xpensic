// Server entry — a tiny Express + JSON-file backend that powers auth and
// per-user data sync for the XPENSIC client.
//
// Architecture:
//   • One process, one SQLite file (`expense-tracker.db`).
//   • Stateless auth via signed JWT in an httpOnly cookie. The client
//     reads the cookie automatically via `withCredentials: true`.
//   • Per-user data is stored as a single JSON blob keyed by userId, so
//     we don't need a separate table per field. Keeps the schema tiny.
//
// Run with `npm run start` (or `node src/server.js`). The port defaults
// to 8787 and is overridable with PORT. Set JWT_SECRET in production.

import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { isEmailLive } from "./email.js";
import { initDb } from "./d1.js";
import { initCryptoDb } from "./crypto-d1.js";
import { authRouter } from "./routes/auth.js";
import { dataRouter } from "./routes/data.js";
import { expensesRouter } from "./routes/expenses.js";
import { categoriesRouter } from "./routes/categories.js";
import { budgetsRouter, settingsRouter } from "./routes/budgets.js";
import { splitsRouter } from "./routes/splits.js";
import { cryptoRouter } from "./routes/crypto.js";
import { devicesRouter } from "./routes/devices.js";
import { pairRouter } from "./routes/pair.js";
import { blobsRouter } from "./routes/blobs.js";
import { authRequired } from "./middleware/auth.js";

// Pick up RESEND_API_KEY / RESEND_FROM / etc. from a local .env file
// if present. Existing process.env values still win — see env.js.
// On Workers this is a no-op (no filesystem); env comes from bindings.
let envFile = null;
try {
  const { loadEnvFile } = await import("./env.js");
  const { resolve } = await import("node:path");
  envFile = loadEnvFile({ cwd: resolve(process.cwd()) });
} catch {
  // Workers: no filesystem / node:path — env comes from bindings.
  envFile = null;
}

const PORT = Number(process.env.PORT || 8787);
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

/**
 * Build the Express app. On Workers, call `initDb(env.DB)` /
 * `initCryptoDb(env.DB)` before serving requests (see worker.js).
 */
export function buildApp() {
  const app = express();
  app.disable("x-powered-by");

  // Custom JSON body parser. We avoid `express.json()` because it pulls
  // in `body-parser` → `raw-body` → `iconv-lite`, which uses Node APIs
  // that aren't available on the Workers runtime. Reading the raw body
  // directly works everywhere (Node + Workers).
  app.use((req, _res, next) => {
    if (req.method === "GET" || req.method === "HEAD") return next();
    let data = "";
    req.setEncoding && req.setEncoding("utf8");
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      if (data) {
        try {
          req.body = JSON.parse(data);
        } catch {
          req.body = {};
        }
      } else {
        req.body = {};
      }
      next();
    });
    req.on("error", (err) => next(err));
  });

  app.use(cookieParser(JWT_SECRET));

  // CORS: allow the static client served from any origin during dev. In
  // production you'd tighten this to a known origin list.
  app.use(
    cors({
      origin: true,
      credentials: true,
    })
  );

  // Health check — used by the smoke test and by ops.
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  // Auth routes (signup, signin, send-otp, verify-otp, signout, profile).
  app.use("/api/auth", authRouter);

  // Per-user data routes — expenses / categories / budgets / settings.
  // All routes require a valid JWT cookie.
  app.use("/api/data", authRequired, dataRouter);
  app.use("/api/expenses", authRequired, expensesRouter);
  app.use("/api/categories", authRequired, categoriesRouter);
  app.use("/api/budgets", authRequired, budgetsRouter);
  app.use("/api/settings", authRequired, settingsRouter);
  app.use("/api/splits", authRequired, splitsRouter);

  // E2EE routes — crypto wraps, vault blob, devices, pairing, blobs.
  // The server is a dumb relay for these; every value is AEAD ciphertext.
  app.use("/api/crypto", authRequired, cryptoRouter);
  app.use("/api/devices", authRequired, devicesRouter);
  app.use("/api/pair", authRequired, pairRouter);
  app.use("/api/blobs", authRequired, blobsRouter);

  // Centralized error handler. Catches anything thrown in routes and
  // returns a JSON error. Keep the surface minimal: don't leak stacks.
  app.use((err, _req, res, _next) => {
    const status = Number.isInteger(err?.status) ? err.status : 500;
    const message = err?.message || "Internal server error";
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error("[server] error:", err);
    }
    res.status(status).json({ ok: false, error: message });
  });

  return app;
}

// Only auto-listen when run directly (Node). On Workers the entry point
// (worker.js) builds the app and hands it to httpServerHandler.
const isDirectRun =
  typeof process !== "undefined" &&
  process.argv?.[1] &&
  (process.argv[1].endsWith("server.js") || process.argv[1].endsWith("/server.js"));

if (isDirectRun) {
  // Node path: use the local SQLite adapter that mimics the D1 API.
  const { createLocalD1 } = await import("./local-d1.js");
  const localDb = createLocalD1();
  initDb(localDb);
  initCryptoDb(localDb);
  const app = buildApp();
  const server = app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[xpensic-server] listening on http://127.0.0.1:${PORT}`);
    if (envFile) {
      // eslint-disable-next-line no-console
      console.log(`[xpensic-server] loaded env from ${envFile}`);
    }
    if (isEmailLive()) {
      // eslint-disable-next-line no-console
      console.log(`[xpensic-server] Resend: LIVE — OTPs will be emailed via ${process.env.RESEND_FROM || "default sender"}`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`[xpensic-server] Resend: DEMO MODE — set RESEND_API_KEY to send real OTPs`);
    }
  });

  // Graceful shutdown so the smoke test (and Ctrl+C) can stop cleanly.
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      server.close(() => process.exit(0));
    });
  }
}
