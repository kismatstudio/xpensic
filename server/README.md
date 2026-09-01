# XPENSIC — Server

Tiny authentication and encrypted-vault relay. Pairs with the static
client in the parent directory (`../`).

> **Stack:** Node + Express + D1 (Cloudflare) / SQLite (local) + bcryptjs + JWT
> **Storage:** Cloudflare D1 on Workers; a local SQLite adapter (`node:sqlite`)
> for development. The storage layer is isolated to `src/d1.js` +
> `src/crypto-d1.js`.
> **Goal:** Authenticate accounts and persist opaque encrypted vault
> envelopes without receiving decrypted user data.

---

## Run locally

```bash
cd server
npm install                # one-time
npm start                  # starts on PORT (default 8787)

# Smoke test (boots the API and checks the E2EE boundary)
npm run smoke
```

Then run the client with `npm run dev` from the parent directory.
The client talks to `http://127.0.0.1:8787` by default — see
[`js/api.js`](../js/api.js).

### Environment variables

| Variable         | Default                          | What it does                                       |
|------------------|----------------------------------|----------------------------------------------------|
| `PORT`           | `8787`                           | HTTP port                                          |
| `JWT_SECRET`     | `dev-secret-change-me`           | Signs the session cookie — **set in production**   |
| `DB_PATH`        | `:memory:`                       | Local SQLite file (dev only). Omit for in-memory.  |
| `NODE_ENV`       | _(unset)_                | Set to `production` to enable `Secure` cookies     |
| `RESEND_API_KEY` | _(unset)_                | Required for real OTP emails. When unset the       |
|                  |                          | server falls back to demo mode (code returned in   |
|                  |                          | the response) so local development keeps working. |
| `RESEND_FROM`    | `XPENSIC <onboarding@resend.dev>` | "From" address for OTP emails. Set to a |
|                  |                          | verified sender on your own domain in production. |

---

## Frontend ↔ API wiring (Cloudflare Pages)

The frontend defaults to a **same-origin `/api`** path (`window.ET_API_BASE`
is empty by default). Two things make that work:

1. **Local dev**: `dev-server.cjs` proxies `/api/*` → the local API
   (`localhost:8787`).
2. **Cloudflare Pages**: a **Pages Function**
   (`functions/api/[[path]].js`) proxies `/api/*` → the API Worker.

The Pages Function reads the target Worker URL from the **`API_ORIGIN`**
Pages env var. Set it per-environment in the Cloudflare dashboard (e.g.
Production = `https://api.xpensic.com`, Preview/Staging = the staging
Worker URL). Because the base URL is env-driven, **no code changes are
needed** when switching between staging and production.

Because `/api` is same-origin on Pages, cookies stay first-party
(`SameSite=Lax`), so browser auth works without cross-site cookie setup.
The Worker's `CLIENT_ORIGIN` secret is only needed if you call the Worker
directly (e.g. via `api.xpensic.com`) instead of through the Pages proxy.

Set `window.ET_API_BASE` only to hard-override the base for a one-off
deployment.

---

## Deploy to Cloudflare Workers + D1

The API runs as a Cloudflare Worker using the Express-on-Workers
pattern (`nodejs_compat` + `httpServerHandler`). Storage is Cloudflare
D1.

### 1. Create the D1 database

```bash
cd server
npx wrangler d1 create xpensic-staging-db
```

Copy the returned `database_id` into `wrangler.toml` (the binding is
`xpensic_staging_db`).

### 2. Apply the schema

```bash
npx wrangler d1 execute xpensic-staging-db --remote --file=./schemas/schema.sql
```

`schema.sql` is for a new database and is non-destructive. For an existing
database, apply only the numbered migrations after reviewing their effect.
`001-add-vault-revision.sql` is additive. `002-remove-legacy-plaintext-tables.sql`
permanently deletes retired plaintext tables and must not be run until any
existing data has been reviewed and backed up as authorized.

### 3. Set secrets

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put RESEND_API_KEY   # optional, for live OTP emails
npx wrangler secret put RESEND_FROM      # optional
```

### 4. Deploy

```bash
npm run deploy
```

The Worker URL is printed (e.g. `https://xpensic-api.<subdomain>.workers.dev`).

### 5. Point the frontend at the API

On Cloudflare Pages, set `window.ET_API_BASE` to the Worker URL. The
easiest way is to inject it at build time — add a build step that
writes it into `index.html`, or set it via a Pages build env var and a
small inline script. In local dev it stays empty (the static server
proxies `/api/*`).

---

## API

All endpoints accept and return JSON. Auth is a JWT in an httpOnly
cookie named `et_token` — the client uses `credentials: "include"`
on every fetch so it never sees the token.

| Method | Path                              | Body / Notes                                     |
|--------|-----------------------------------|--------------------------------------------------|
| GET    | `/api/health`                     | `{ ok, ts }`                                     |
| POST   | `/api/auth/signup`                | `{ identifier, password, confirmPassword }` |
| POST   | `/api/auth/signin`                | `{ identifier, password }`                       |
| POST   | `/api/auth/send-otp`              | `{ identifier }` — delivers a 4-digit code via Resend (or demo mode if `RESEND_API_KEY` is unset) |
| POST   | `/api/auth/verify-otp`            | `{ identifier, code }`                           |
| POST   | `/api/auth/forgot/send-otp`       | `{ identifier }` — same delivery channel as sign-in, but always returns a generic success message so we never leak which emails are registered |
| POST   | `/api/auth/forgot/verify`         | `{ identifier, code }` → returns `{ resetToken }` (short-lived JWT, 10-min TTL) |
| POST   | `/api/auth/forgot/reset`          | `{ identifier, code, resetToken, newPassword }`  |
| GET    | `/api/auth/whoami`                | Returns `{ user }` or 401                        |
| POST   | `/api/auth/signout`               | Clears the cookie                                |
| GET    | `/api/crypto/master-key`          | Returns opaque master-key wraps                 |
| PUT    | `/api/crypto/master-key`          | Replaces opaque master-key wraps                |
| GET    | `/api/crypto/vault`               | Returns the encrypted vault envelope            |
| PUT    | `/api/crypto/vault`               | Stores an encrypted vault envelope              |
| DELETE | `/api/crypto/vault`               | Deletes the encrypted vault                     |

### Identifiers

Users sign up / sign in with an **email OR a 10-digit mobile number**.
The server normalizes phone numbers (drops country code) and stores
phone-only accounts under a synthetic `phone:<digits>` email key.

### OTP (Resend for email, demo fallback otherwise)

OTPs are 4-digit codes valid for **5 minutes**. The server delivers them
differently depending on the identifier and configuration:

  * **Email identifiers + `RESEND_API_KEY` set** → real transactional
    email via [Resend](https://resend.com). The server POSTs to
    `https://api.resend.com/emails` using a Bearer token; no SDK
    dependency.
  * **Email identifiers + `RESEND_API_KEY` unset** → "demo mode". The
    code is returned in the response so the client can show it on
    screen. Useful for local development.
  * **Phone identifiers** → no SMS provider wired up yet; demo mode
    only (code in response).

In all three paths the route shape and the response are the same,
so swapping in Twilio / MSG91 for SMS delivery doesn't change the
client. See `src/email.js` for the exact delivery logic.

### Encrypted vault contract

The client serializes the complete state and encrypts it with a random
32-byte master key using AES-GCM-256 before calling `/api/crypto/vault`.
The server validates only the outer envelope (`v`, `alg`, `nonce`, and
`ct`) and stores it as opaque JSON. It never parses the decrypted state.

Master-key wraps are independently encrypted with the vault password,
recovery phrase, or browser device key. The server stores the wraps but
never receives the wrapping keys or the master key.

### Storage layout

The local adapter and Cloudflare D1 use only these tables:

```
users          account identifier and password hash only
crypto_wraps   opaque per-user master-key wrap envelopes
vault_blobs    opaque per-user encrypted vault envelopes
refresh_tokens hashed authentication sessions
```

There are no server-side expense, category, budget, split, profile, or
full-state tables. JSON exports are created locally and are plaintext by
design because the user explicitly requested an export.

---

## Project layout

```
server/
├── package.json
├── src/
│   ├── server.js          # entry, Express setup
│   ├── worker.js          # Cloudflare Workers entry point
│   ├── d1.js              # auth + refresh-token persistence
│   ├── crypto-d1.js       # opaque wrap + vault persistence
│   ├── email.js           # Resend transactional email client
│   ├── ids.js             # ULID-style id helper
│   ├── validate.js        # email / phone / password validation
│   ├── middleware/
│   │   └── auth.js        # JWT verify, attaches req.user
│   └── routes/
│       ├── auth.js        # signup / signin / OTP / reset / signout
│       └── crypto.js      # opaque vault + master-key wrap relay
└── tests/
  └── smoke.mjs          # encrypted-boundary API test
```

---

## Tested in

Node 22.5+ is recommended for the local SQLite adapter. The smoke test
passes on first run with a fresh DB.
