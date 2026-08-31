// Cloudflare Workers entry point for the XPENSIC Express API.
//
// Builds the Express app, binds the D1 database, and hands the app to
// Cloudflare's httpServerHandler so Express runs on the Workers runtime.
//
// Requires:
//   - wrangler config with `compatibility_flags = ["nodejs_compat"]`
//   - a D1 binding named `XPENSIC_DB` (each environment/config binds its
//     own database under this name)
//   - env vars: JWT_SECRET, RESEND_API_KEY (optional), RESEND_FROM (optional),
//     CLIENT_ORIGIN (the frontend origin for cross-site cookies)

import { env } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";
import { buildApp } from "./server.js";
import { initDb } from "./d1.js";
import { initCryptoDb } from "./crypto-d1.js";

// Bind the D1 database before any request is handled.
initDb(env.XPENSIC_DB);
initCryptoDb(env.XPENSIC_DB);

const app = buildApp();

// httpServerHandler expects the server object returned by app.listen()
// (it calls server.address() internally), not the Express app itself.
const server = app.listen(3000);

export default httpServerHandler(server);