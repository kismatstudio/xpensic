# XPENSIC — Project Plan

A lightweight expense tracker with browser-side end-to-end encryption, account authentication, and encrypted multi-device sync.

> **Stack:** HTML + CSS + Vanilla JavaScript
> **Storage:** In-memory state plus an encrypted vault envelope in IndexedDB/server storage
> **Goal:** A real personal finance tool that is fast, private, and works offline.

---

## 1. Goals & Non-Goals

### Goals
- Add, edit, and delete expenses in under 3 seconds.
- See a clear monthly summary and category breakdown at a glance.
- Set monthly budgets per category and get a warning when nearing the limit.
- Back up / restore data via CSV or JSON without losing anything.
- Run offline, with zero dependencies, on any modern browser.

### Non-Goals (for v1)
- Bank integration or automatic transaction import.
- Mobile app / PWA install (the responsive layout will work on mobile, but no service worker in v1).
- Multi-currency conversion (single currency per session, configurable).

---

## 2. User Stories

| # | As a user, I want to… | So that I can… |
|---|----------------------|----------------|
| 1 | Add a new expense (amount, date, category, note) | Track what I spend without friction. |
| 2 | Edit or delete an existing expense | Correct mistakes. |
| 3 | See all expenses for the current month in a sortable list | Review my recent activity. |
| 4 | Filter expenses by date range, category, or text | Find specific transactions quickly. |
| 5 | See a monthly summary (total spent, # of transactions, daily average) | Know how much I've spent this month. |
| 6 | See a category breakdown as a chart | Understand where my money goes. |
| 7 | Set a monthly budget per category | Plan my spending. |
| 8 | Get a visual warning when a category is at ≥80% / ≥100% of budget | Avoid overspending. |
| 9 | Export all data as JSON or CSV | Back up or analyze externally. |
| 10 | Import a JSON or CSV file | Restore a backup or migrate. |
| 11 | Manage categories (add, rename, recolor, delete) | Tailor the app to my life. |
| 12 | Use it on a phone, tablet, and desktop | Track expenses wherever I am. |

---

## 3. Feature Scope (v1)

### Must Have
1. **Expense CRUD** — add, edit, delete with amount, date, category, note.
2. **Category management** — built-in defaults (Food, Transport, Housing, Utilities, Entertainment, Health, Shopping, Other) plus custom add/rename/delete.
3. **Monthly summary** — total spent, transaction count, daily average, comparison vs. last month.
4. **Category breakdown chart** — horizontal bar chart (no external chart library; pure SVG).
5. **Budgets & alerts** — per-category monthly budget; progress bar turns yellow ≥80%, red ≥100%.
6. **CSV import / export** — round-trip safe for the standard fields.
7. **JSON backup / restore** — full app state (expenses + categories + budgets).
8. **Search & filters** — by date range, category, free-text note/amount match.
9. **Settings** — currency symbol/position, date format, start-of-week.

### Nice to Have (defer to v1.1 unless time permits)
- Recurring expenses (e.g., monthly rent).
- Dark mode toggle.
- Keyboard shortcuts (e.g., `n` for new expense, `/` for search).
- Print-friendly monthly report.

---

## 4. Information Architecture

### Data model (encrypted vault)

```jsonc
// Serialized locally, then encrypted with the vault master key.
{
  "version": 1,
  "settings": {
    "currency": "USD",
    "currencySymbol": "$",
    "currencyPosition": "before",
    "dateFormat": "YYYY-MM-DD",
    "theme": "light"
  },
  "categories": [
    { "id": "cat_food", "name": "Food", "color": "#ef4444", "isDefault": true },
    { "id": "cat_transport", "name": "Transport", "color": "#3b82f6", "isDefault": true }
  ],
  "budgets": { "monthly": { "2026-07": { "cat_food": 400 } } },
  "expenses": [
    {
      "id": "exp_01J...",
      "amount": 12.50,
      "date": "2026-07-09",
      "categoryId": "cat_food",
      "note": "Lunch with team",
      "createdAt": "2026-07-09T14:32:11.000Z",
      "updatedAt": "2026-07-09T14:32:11.000Z"
    }
  ]
}
```

### Storage rules
- The active state is held in memory and persisted only as an encrypted vault envelope.
- The server stores account metadata, encrypted master-key wraps, and encrypted vault envelopes.
- The client encrypts before every local or remote persistence operation.
- On schema or decryption mismatch, surface an error rather than silently losing data.

---

## 5. UI / Page Structure

Single-page app with three primary views, switched via a left sidebar (collapses to a top tab bar on mobile).

```
┌──────────────┬──────────────────────────────────────────────┐
│  SIDEBAR     │  HEADER (month picker, search, + Add)        │
│              ├──────────────────────────────────────────────┤
│  Dashboard   │                                              │
│  Expenses    │            ACTIVE VIEW                       │
│  Categories  │                                              │
│  Settings    │                                              │
│  ─────────   │                                              │
│  Import/Exp. │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

### Views
1. **Dashboard**
   - KPI cards: This month total, # transactions, Daily average, vs. last month (delta).
   - Budget alerts panel (categories at ≥80%).
   - Category breakdown chart (SVG bar chart, top 8 + "Other" bucket).
   - Recent 5 expenses list.
2. **Expenses**
   - Filters bar: date range, category multi-select, text search.
   - Sortable table: Date | Category | Note | Amount | Actions.
   - Inline edit (modal) and delete (confirm).
   - Empty state with a one-click "Add first expense" CTA.
3. **Budgets**
   - Month selector.
   - List of categories with a budget input and a progress bar.
   - "Copy from last month" button.
4. **Categories**
   - List with color swatch, name (inline edit), default/custom badge, delete (with reassign-to-other prompt).
   - "Add category" button.
5. **Settings**
   - Currency, date format, theme.
   - Import / Export section (JSON full backup, CSV expenses only).
   - Danger zone: "Erase all data" (typed confirmation).

### Reusable components
- `Modal` (focus-trapped, ESC-closable).
- `Toast` (success / error / info, auto-dismiss 3s).
- `ConfirmDialog` (destructive actions).
- `FormField` (label + input + inline error).
- `ProgressBar` (0–100%, color thresholds).
- `EmptyState` (icon + title + helper + CTA).

---

## 6. Tech Architecture

### File layout
```
Expense-tracker/
├── PLAN.md
├── README.md
├── index.html              # entry point, loads CSS + JS
├── css/
│   ├── reset.css           # minimal CSS reset
│   ├── tokens.css          # design tokens (colors, spacing, radii)
│   ├── layout.css          # app shell, responsive grid
│   └── components.css      # buttons, cards, tables, modals, charts
├── js/
│   ├── main.js             # app bootstrap, router, view mounting
│   ├── store.js            # in-memory state + validation
│   ├── crypto/             # vault encryption, key wraps, encrypted cache
│   ├── ids.js              # ULID/crypto.randomUUID wrapper
│   ├── format.js           # currency, date, percent formatters
│   ├── validators.js       # amount, date, category checks
│   ├── csv.js              # parse + serialize CSV
│   ├── backup.js           # JSON import/export
│   ├── charts.js           # SVG bar chart renderer
│   ├── views/
│   │   ├── dashboard.js
│   │   ├── expenses.js
│   │   ├── budgets.js
│   │   ├── categories.js
│   │   └── settings.js
│   └── components/
│       ├── modal.js
│       ├── toast.js
│       ├── confirm.js
│       └── progress.js
└── tests/
    ├── store.test.html     # opens in browser, asserts store behavior
    ├── csv.test.html
    └── format.test.html
```

### Module boundaries
- **Views** are pure render functions: `(state, container) => void`. They never touch persistence directly.
- **Main** wires events → store mutations → re-render.
- **Store** owns in-memory mutations; the crypto vault module owns encrypted persistence.
- **No globals** — use ES modules (`<script type="module">`).

### Why vanilla?
- Zero install. Open `index.html` and it works.
- No build step, no node_modules, easy to back up (it's just files).
- Sufficient for the scope: ~2–3k lines of JS total.

---

## 7. Design System (lightweight)

- **Color tokens:** primary, surface, surface-2, border, text, text-muted, success, warn, danger.
- **Spacing scale:** 4, 8, 12, 16, 24, 32, 48 px.
- **Radii:** 6 / 10 / 16 px.
- **Type:** system font stack (`-apple-system, Segoe UI, Roboto, ...`); 14px base, 12/16/20/28 scale.
- **Light theme in v1;** dark theme deferred but tokens designed to swap.
- **Accessibility:** all interactive elements keyboard-reachable; visible focus ring; color is never the only signal (use icons/text for warnings).

---

## 8. Implementation Plan (phased)

Each phase is a self-contained milestone you can demo.

### Phase 0 — Skeleton (½ day)
- Create `index.html`, CSS files, empty `main.js`.
- Set up app shell (sidebar + header + main area).
- Define design tokens and a few base components (button, card, input).

### Phase 1 — Data layer (½ day)
- `store.js` with `load()`, `save()`, `reset()`, and a versioned schema check.
- `ids.js`, `format.js`, `validators.js` utilities.
- Seed default categories on first run.

### Phase 2 — Expense CRUD (1 day)
- Add Expense modal (form + validation).
- Expenses list view with table and inline delete.
- Edit Expense modal.
- Toast notifications for success/error.

### Phase 3 — Filters & search (½ day)
- Date range picker (two `<input type="date">`).
- Category multi-select.
- Debounced text search over note + amount-as-string.

### Phase 4 — Dashboard & summary (1 day)
- KPI cards with month-to-date calculations.
- SVG bar chart for category breakdown.
- "vs. last month" delta.
- Recent expenses widget.

### Phase 5 — Categories management (½ day)
- CRUD for categories.
- Reassign-on-delete flow.
- Color picker (simple `<input type="color">`).

### Phase 6 — Budgets & alerts (1 day)
- Budgets view with per-category inputs.
- Progress bars with 80%/100% thresholds.
- Dashboard alert panel driven by budget state.

### Phase 7 — Settings (½ day)
- Currency, date format, theme.
- "Reset all data" with typed confirmation.

### Phase 8 — Import / Export (1 day)
- JSON full-state export + import (with validation and "merge vs replace" prompt).
- CSV export of expenses.
- CSV import with column mapping UI.

### Phase 9 — Polish (1 day)
- Empty states for every list.
- Loading/disabled states on buttons during save.
- Responsive pass: mobile sidebar → top tab bar, table → card list.
- Keyboard shortcuts (stretch).
- README with run instructions, data model, backup recommendation.

**Total estimate:** ~6 working days, end-to-end.

---

## 9. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `localStorage` cleared by browser / user | **High** — total data loss | Banner reminder to back up; one-click JSON export; consider auto-export to download every N days (v1.1). |
| Schema migration breaks old data | High | Versioned key + migration function with a "backup before migrate" prompt. |
| CSV format ambiguity across locales | Medium | Use ISO dates and `.` decimal in CSV; convert on import. |
| Deleting a category orphans expenses | Medium | Force a "reassign to…" step before delete is allowed. |
| Browser quota (~5MB) exceeded | Low for v1 | Monitor; later add archival of old months. |

---

## 10. Testing Strategy

- **Manual smoke tests** for each phase's user story.
- **Browser-runnable test pages** (`tests/*.test.html`) that load the relevant module and assert behavior:
  - `store.test.html` — load/save round trip, version mismatch handling, corruption recovery.
  - `csv.test.html` — round-trip export → import produces identical records.
  - `format.test.html` — currency and date formatting edge cases.
- **Manual responsive pass** on Chrome DevTools device toolbar (iPhone SE, iPad, desktop 1440).
- **Backup drill:** export JSON → reset all data → import JSON → verify nothing missing.

---

## 11. Run & Develop

```bash
# No install needed. Just open the file:
# Windows
start index.html

# Or serve locally for module isolation:
python -m http.server 8000
# then visit http://localhost:8000
```

> **Tip for development:** use the local HTTP server. `file://` works for the app itself but a few browser APIs behave differently.

---

## 12. Acceptance Checklist (v1 done when…)

- [ ] Can add, edit, delete an expense and see it in the list.
- [ ] Dashboard shows correct monthly total, count, daily average, and category chart.
- [ ] Budgets: setting one for a category makes the dashboard show a progress bar that turns yellow/red at thresholds.
- [ ] Can add, rename, recolor, and delete a custom category; deleting prompts to reassign existing expenses.
- [ ] Filters (date range, category, text) all work and combine.
- [ ] CSV export → re-import on a fresh profile produces the same expenses.
- [ ] JSON export → "Erase all data" → JSON import restores everything including categories and budgets.
- [ ] Layout is usable at 360px, 768px, and 1440px widths.
- [ ] All destructive actions require confirmation.
- [ ] README explains how to run, back up, and recover data.
