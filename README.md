# XPENSIC

A lightweight expense tracker with browser-side end-to-end encryption,
account authentication, and encrypted multi-device sync.

> **Status:** Encrypted-vault staging release.
> Stack: HTML + CSS + Vanilla JavaScript, ES modules, no client build step.

---

## Features

- **Quick Add** — type `Coffee 180` on the dashboard and save in one line. The amount is parsed automatically, the date is today, the time is the current clock, and the category is suggested from the note ("Coffee" → Food).
- **Smart search** — the Expenses search box understands `Food last month`, `>1000`, `January`, `2026-07`, `today`, and more. See the full list under "Keyboard shortcuts" below.
- **Filters** — date range, category multi-select, and free-text search compose with the smart search.
- **Categories** — full CRUD. Delete is guarded by a reassign dialog if expenses use the category. Default categories can be renamed/recolored but not deleted.
- **Payment methods** — Cash / UPI / Debit card / Credit card / Bank transfer. UPI shows a sub-dropdown (PhonePe / Google Pay / Paytm).
- **Budgets** — per-category monthly budgets with progress bars (yellow at 80%, red at 100%). "Copy from last month" makes setting up each month fast.
- **Dashboard** — KPI cards (this-month total, vs. last month delta, daily average, today), category breakdown chart, recent expenses, and budget alerts that link to the Budgets view.
- **Import / Export** — full-state JSON backup and round-trip-safe CSV of expenses. The CSV opens directly in **Google Sheets** (File → Import → Upload) and **Microsoft Excel** (just double-click). No conversion needed.
- **Account & multi-device** — sign up with email or 10-digit mobile + password; sign in on any device and your data is there. OTP sign-in (demo mode) for users who don't want to remember a password.
- **End-to-end encrypted vault** — expenses, categories, budgets, splits, settings, profile data, and login history are encrypted in the browser before upload. The server stores ciphertext and key wraps only.
- **Categories with icons** — every category has an emoji icon (🍔 Food, 🚗 Transport, 🏠 Housing, …). Custom categories get to pick from an icon grid.
- **Currency** — INR by default, but any ISO code with a custom symbol and position is supported. Indian digit grouping (`1,23,456.78`) is the default for INR.
- **Voice entry** (Chrome / Edge) — say "Coffee 180" and the expense is captured with the right amount, date, and category suggestion.
- **Keyboard shortcuts** — `n` to add, `/` to search, letters to navigate, `t` to cycle theme, `?` for the full help.

---

## Run

This is a static web app with no build step. You need a local HTTP server
because ES modules do not load over `file://`.

```bash
# Client + encrypted local cache. A server is required for accounts and
# multi-device sync; the browser stores only encrypted vault envelopes.
npm run dev          # starts the custom dev server on :8765

# Full mode with auth + encrypted multi-device sync.
cd server && npm install && npm start      # backend on :8787
npm run dev                                # client on :8765

# Or any other static server:
node dev-server.cjs
# then open http://127.0.0.1:8765/
```

The backend defaults to `http://127.0.0.1:8787`. See
[`server/README.md`](server/README.md) for the API, environment
variables, and the encrypted-boundary smoke test.

If you'd rather skip the server entirely, you can drag `index.html`
into a modern browser, but account sync and the encrypted cloud vault
require the backend.

---

## Data

The browser keeps the active state in memory. When the backend is
available, the client encrypts the complete state with the vault master
key and uploads one opaque envelope to `/api/crypto/vault`. The local
cache contains the same encrypted envelope, never the decrypted state.

The server stores account identifiers, authentication hashes, encrypted
master-key wraps, and encrypted vault envelopes. It cannot read vault
contents. Clearing site data removes the local cache; the server vault
can be recovered only with the vault password, recovery phrase, or a
trusted device wrap.

### Recommended backup workflow

- **Weekly**: Export JSON from Settings → Data. This is a plaintext
  backup created locally, so save it somewhere safe (cloud drive, email
  to yourself, version control). JSON captures **everything** —
  categories, expenses, budgets, profile.
- **Before any big change**: Export JSON. The Replace dialog asks
  for confirmation.
- **For Excel / Google Sheets**: click *Export for Sheets/Excel (CSV)*
  in Settings. The file is RFC 4180 CSV with a `.csv` extension and
  a `text/csv` MIME type, so it opens with a double-click in Excel
  and via *File → Import → Upload* in Google Sheets. Columns:
  `id, date, time, amount, category, paymentMethod, upiApp, note`.

### Data model

```jsonc
{
  "version": 1,
  "settings": {
    "currency": "INR", "currencySymbol": "₹", "currencyPosition": "before",
    "dateFormat": "YYYY-MM-DD", "theme": "system"
  },
  "categories": [
    { "id": "cat_food", "name": "Food", "color": "#ef4444", "isDefault": true }
    // ...
  ],
  "budgets": { "monthly": { "2026-07": { "cat_food": 500 } } },
  "expenses": [
    {
      "id": "exp_abc123", "amount": 250, "date": "2026-07-10", "time": "11:26",
      "categoryId": "cat_food", "note": "Lunch",
      "paymentMethod": "upi", "upiApp": "phonepe",
      "createdAt": "...", "updatedAt": "..."
    }
  ]
}
```

- `version` is the schema version. Backups from a different version are
  rejected with a clear error.
- `paymentMethod` is one of: `cash`, `upi`, `debit_card`, `credit_card`,
  `bank_transfer`.
- `upiApp` is required only when `paymentMethod === "upi"`. It can be
  `phonepe`, `googlepay`, `paytm`, `supermoney`, `bhim`, or `cred`.

---

## Keyboard shortcuts

| Key   | Action |
|-------|--------|
| `n`   | Add new expense (navigates to Expenses + opens the form) |
| `/`   | Focus the search box (navigates to Expenses) |
| `e`   | Go to Expenses |
| `b`   | Go to Budgets |
| `c`   | Go to Categories |
| `s`   | Go to Settings |
| `d`   | Go to Dashboard |
| `t`   | Cycle theme (Light → Dark → System) |
| `?`   | Open the keyboard help |
| `Esc` | Close any open modal |

Shortcuts are disabled while typing in a text field, so they never
fight your input.

### Smart search cheat sheet

| Query | What it does |
|-------|--------------|
| `Food` | Match the category named "Food" |
| `Food last month` | Category + time range |
| `>1000` | Amount greater than 1000 |
| `>=100` | Amount at least 100 |
| `<2000` | Amount less than 2000 |
| `=250` | Amount exactly 250 |
| `today` / `yesterday` | The current / previous day |
| `this month` / `last month` | The current / previous calendar month |
| `this week` / `last week` | The trailing 7 days, anchored to today |
| `this year` / `last year` | The current / previous calendar year |
| `January` ... `December` | The most recent occurrence of that month |
| `2026` | The whole year 2026 |
| `2026-07` | July 2026 only |
| `rent` | Free-text match against note + amount |
| `Food rent` | Category + free-text note match |

Multiple tokens are AND'd together. All structured tokens are surfaced
in the count line (e.g. "2 of 5 expenses (category: Food · <2000)").

---

## Project layout

```
Expense-tracker/
├── PLAN.md                   # original design + phased plan
├── README.md                 # this file
├── index.html                # entry point
├── dev-server.cjs           # tiny no-cache static server (CommonJS)
├── css/
│   ├── reset.css
│   ├── tokens.css            # design tokens + dark theme
│   ├── layout.css
│   └── components.css
└── js/
    ├── main.js               # hash router, mounts views
    ├── store.js              # in-memory state store
    ├── theme.js              # light/dark/system, no-flash boot
    ├── format.js             # currency + date formatters
    ├── validators.js
    ├── util.js               # id, todayISO, smart-search parser, etc.
    ├── ids.js
    ├── csv.js                # RFC 4180 CSV writer + parser
    ├── backup.js             # JSON full-state export/import + file helpers
    ├── keyboard.js           # global keyboard shortcuts
    ├── boot-theme.js         # synchronous head script (no theme flash)
    ├── crypto/               # vault encryption, key wraps, and encrypted cache
    ├── components/
    │   ├── modal.js
    │   ├── confirm.js
    │   ├── toast.js
    │   ├── progress.js
    │   └── chart.js          # hand-rolled SVG bar chart
    └── views/
        ├── dashboard.js
        ├── expenses.js
        ├── categories.js
        ├── budgets.js
        └── expense-form.js
```

---

## Keyboard-driven workflows

- Press `n` anywhere → start a new expense. Tab through the form, Enter to
  save.
- Press `/` → type `Food last month >100` → Enter to see the result
  with the parsed description in the count line.
- Press `t` → cycle to dark mode for evening use.
- Press `?` → see the full shortcut list.

---

## Tested in

Chrome 120+ on Windows. The app should work in any modern browser
(Chrome, Edge, Firefox, Safari) that supports ES modules and
`localStorage`. Mobile browsers work too; the layout collapses to a
single column at ≤720px width.

---

## What's next

This project shipped the nine phases from [PLAN.md](PLAN.md). Some ideas
that didn't make the v1 scope (and would each be their own phase):

- Recurring expenses (rent, subscriptions, …)
- Bill reminders
- Savings goals with progress bars
- Multi-currency per expense
- Tags (in addition to categories)
- Receipt uploads + OCR
- Cloud sync and multi-user

Each of these is a multi-day effort on its own. The current scope is
deliberately tight: a polished, single-user, offline-first tool that does
the basics really well.
