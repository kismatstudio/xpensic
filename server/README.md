# XPENSIC — Server

Tiny auth + per-user data backend. Pairs with the static client in
the parent directory (`../`).

> **Stack:** Node + Express + CSV-file storage + bcryptjs + JWT
> **Storage:** One CSV file per table inside `server/data/` — zero native deps
> **Goal:** A no-fuss backend so the client can do real account-based
> auth, multi-device sign-in, and per-user data persistence.

> **Why CSV, not SQLite or a single JSON?** We want zero native
> dependencies so `npm install` works without a C++ toolchain on
> Windows. Splitting into per-table CSVs keeps each file tiny,
> human-inspectable, and trivially diff-able in git. Writes are
> debounced and atomic (write to `.tmp` then rename), so a crash
> mid-write can never corrupt a file. The data layer is isolated to
> `db.js` — swap in real Postgres / SQLite if you grow past hobby scale.

---

## Run

```bash
cd server
npm install                # one-time
npm start                  # starts on PORT (default 8787)

# Smoke test (boots the API on a random port, exercises every route)
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
| `DB_DIR` / `DB_PATH` | `server/data/`              | Directory holding the CSV files. `DB_PATH` is honoured too — if it points at an existing *file* the server uses its parent directory (so legacy `DB_PATH=...db.json` still works) |
| `NODE_ENV`       | _(unset)_                | Set to `production` to enable `Secure` cookies     |
| `RESEND_API_KEY` | _(unset)_                | Required for real OTP emails. When unset the       |
|                  |                          | server falls back to demo mode (code returned in   |
|                  |                          | the response) so local development keeps working. |
| `RESEND_FROM`    | `XPENSIC <onboarding@resend.dev>` | "From" address for OTP emails. Set to a |
|                  |                          | verified sender on your own domain in production. |

---

## API

All endpoints accept and return JSON. Auth is a JWT in an httpOnly
cookie named `et_token` — the client uses `credentials: "include"`
on every fetch so it never sees the token.

| Method | Path                              | Body / Notes                                     |
|--------|-----------------------------------|--------------------------------------------------|
| GET    | `/api/health`                     | `{ ok, ts }`                                     |
| POST   | `/api/auth/signup`                | `{ identifier, password, confirmPassword, displayName? }` |
| POST   | `/api/auth/signin`                | `{ identifier, password }`                       |
| POST   | `/api/auth/send-otp`              | `{ identifier }` — delivers a 4-digit code via Resend (or demo mode if `RESEND_API_KEY` is unset) |
| POST   | `/api/auth/verify-otp`            | `{ identifier, code }`                           |
| POST   | `/api/auth/forgot/send-otp`       | `{ identifier }` — same delivery channel as sign-in, but always returns a generic success message so we never leak which emails are registered |
| POST   | `/api/auth/forgot/verify`         | `{ identifier, code }` → returns `{ resetToken }` (short-lived JWT, 10-min TTL) |
| POST   | `/api/auth/forgot/reset`          | `{ identifier, code, resetToken, newPassword }`  |
| GET    | `/api/auth/whoami`                | Returns `{ user }` or 401                        |
| PATCH  | `/api/auth/profile`               | `{ displayName?, avatarDataUrl? }`               |
| POST   | `/api/auth/signout`               | Clears the cookie                                |
| GET    | `/api/data`                       | Returns the user's full data blob                |
| PUT    | `/api/data`                       | Replaces the user's full data blob               |
| DELETE | `/api/data`                       | Erases the user's data blob                      |

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

### Data blob shape

The PUT body is the same v5 JSON blob the client uses today
(`categories`, `budgets`, `expenses`, `settings`, `profile`).
We don't normalize the fields; the client owns the schema. Server
only checks the minimum structure (arrays for categories/expenses,
object for budgets).

### Storage layout

On disk the server uses one CSV per table inside `server/data/`:

```
server/data/
  users.csv       one row per account         (userId, email, passwordHash, …)
  expenses.csv    one row per expense         (denormalised: userId on every row)
  categories.csv  one row per category        (denormalised: userId on every row)
  budgets.csv     one row per (user, month, category) — the JSON's nested
                    {monthly: { "2026-07": { cat_food: 400 }}} becomes three
                    flat columns
  blobs.csv       one row per user — the full v5 client blob, JSON-encoded,
                    so PUT /api/data and GET /api/data round-trip unchanged
```

Writes are debounced (250ms) and atomic (write to `*.tmp` then rename), so a crash mid-write can never corrupt a file.

#### Migrating from the old JSON store

The old `server/expense-tracker.db.json` is still supported on first boot: `db.js` detects it, fans it out into the four CSVs, and renames the JSON to `expense-tracker.db.json.migrated` so the migration only runs once. After that, the JSON is left untouched and the server reads/writes only the CSV files.

---

## Project layout

```
server/
├── data/                   # CSV storage (auto-created on first boot)
│   ├── users.csv
│   ├── expenses.csv
│   ├── categories.csv
│   ├── budgets.csv
│   └── blobs.csv
├── package.json
├── src/
│   ├── server.js          # entry, Express setup
│   ├── env.js             # tiny .env loader
│   ├── db.js              # CSV-backed store + JSON→CSV migration
│   ├── csv.js             # RFC 4180 parser / writer
│   ├── email.js           # Resend transactional email client
│   ├── ids.js             # ULID-style id helper
│   ├── validate.js        # email / phone / password / name
│   ├── middleware/
│   │   └── auth.js        # JWT verify, attaches req.user
│   └── routes/
│       ├── auth.js        # signup / signin / OTP / profile / signout
│       └── data.js        # GET / PUT / DELETE data blob
└── tests/
    └── smoke.mjs          # in-process end-to-end API test
```

---

## Tested in

Node 18+ on Windows. The smoke test passes on first run with a fresh
DB.
