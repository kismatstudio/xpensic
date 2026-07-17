# Tests

This directory holds smoke tests for the expense-tracker codebase. They're
plain Node ESM scripts — no test framework, no dependencies.

## Running

```bash
node tests/run-all.mjs          # run every test file
node tests/run-all.mjs --bail   # stop on the first failing file

# or run an individual file
node tests/test-backup-version.mjs
```

The runner discovers every `test-*.mjs` in this directory, runs them in
order, prints a per-file summary, and exits non-zero if any file failed.

## Conventions

- **No external dependencies.** Tests only use `node:fs`, `node:path`,
  `node:child_process`, and the project's own modules.
- **Each file is self-contained.** Importing the project's modules and
  re-implementing small bits of logic is preferred over complex fixtures.
- **Assertion style.** Use the local `check(name, cond, extra?)` helper
  and print a `<n> passed, <m> failed` summary on the last line so the
  runner can parse it.
- **Structural tests are fine.** For browser-only modules (views,
  components), test the source via string/regex assertions — the goal is
  to catch regressions, not to fully exercise the DOM.

## File index

| File | What it covers |
|------|----------------|
| `test-backup-version.mjs` | JSON export/import round-trips; v1 → v2 migration; malformed-input rejection |
| `test-csv-dedupe.mjs` | CSV export → re-import is idempotent (no duplicates); row-merge on partial overlap |
| `test-data-labels.mjs` | Each table `<td>` has a `data-label`; mobile CSS has exactly one media block |
| `test-date-helpers-dedupe.mjs` | `startOfMonth`/`monthKey`/`formatMonth`/`todayISO`/`currentTimeHHMM` come from `util.js` (no duplicates) |
| `test-dead-code-removal.mjs` | `formatPercent` is gone; main.js no longer imports `formatDate`/`pad`/`applyTheme` |
| `test-first-run-toast.mjs` | Fresh install shows a "Welcome" toast; corrupted store doesn't; flag cleared after firing |
| `test-login-and-profile.mjs` | Login form validation + DOM structure; profile view + sign-out flow; replaceState (no render flash) |
| `test-store-crud.mjs` | Categories / expenses / budgets / settings / profile mutators |
| `test-theme-a11y.mjs` | Theme toggle is a 3-state cycle with proper aria-label; Settings theme picker is a radio group |
| `test-validators.mjs` | Every form validator (amount, date, time, category, payment, UPI, note) |
