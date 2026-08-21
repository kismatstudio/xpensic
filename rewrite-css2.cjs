// Surgical CSS edits that are hard to do via replace_string_in_file
// because of em-dash characters in comments.

const fs = require("fs");
const path = "c:/Users/Zeeshan Khan/KS-Training/expense-tracker/css/components.css";
let text = fs.readFileSync(path, "utf8");
const lines = text.split("\n");

// Update 1: max-height: 260px → 360px (so the wider card has more
// scroll room while staying aligned with the row of 3 single-col KPIs).
const MAX_H_OLD = ".kpi--budget-alert { \n  display: flex; \n  flex-direction: column; \n  gap: var(--space-2); \n  max-height: 260px; \n}";
const MAX_H_NEW = ".kpi--budget-alert { \n  display: flex; \n  flex-direction: column; \n  gap: var(--space-2); \n  max-height: 360px; \n}";
if (!text.includes(MAX_H_OLD)) {
  console.error("Could not find max-height block");
  process.exit(1);
}
text = text.replace(MAX_H_OLD, MAX_H_NEW);
console.log("Updated max-height: 260px → 360px");

// Update 2: replace the .app-nav__footer display:none !important rule
// (which was preventing the footer from rendering in print styles)
// with the proper nav-footer styles + a print override.
const FOOTER_HIDE_OLD = "  .app-nav__footer { display: none !important; }";
const FOOTER_HIDE_NEW = `  .app-nav__footer { display: none !important; } /* legacy hide — see .app-nav__signout for current styling */`;
if (!text.includes(FOOTER_HIDE_OLD)) {
  console.error("Could not find footer hide block");
  process.exit(1);
}
text = text.replace(FOOTER_HIDE_OLD, FOOTER_HIDE_NEW);
console.log("Annotated legacy footer hide");

// Update 3: Add the budgets__split 60/40 grid + app-nav__footer show +
// .app-nav__signout styling. Insert BEFORE the print styles block so
// the cascade order matches existing pattern (component → layout → print).
const INSERT_BEFORE_PRINT = "/* Print styles */\n@media print {";
// Find the unique "Print styles" header — which is the second-to-last
// closing comment before the @media print block. We'll search for the
// marker that doesn't have em-dash issues.
const PRINT_MARKER = "@media print {";
const idx = text.indexOf(PRINT_MARKER);
if (idx < 0) {
  console.error("Could not find @media print block");
  process.exit(1);
}
const blockToInsert = `/* Budgets split layout: category list 60% / smart suggestions 40% */
.budgets__split {
  display: grid;
  grid-template-columns: 3fr 2fr;  /* 60% / 40% */
  gap: var(--space-4);
  align-items: start;
  margin-bottom: var(--space-5);
}
.budgets__split-list {
  min-width: 0;  /* let the card shrink inside the grid track */
}
.budgets__split-tips {
  min-width: 0;
  align-self: stretch;
  /* Make the smart-tips card fill the column with the same glass-card
     treatment as the editor list — the inner .budget-tips card stacks
     inside this column. */
  display: flex;
  flex-direction: column;
}
.budgets__split-tips > .card.budget-tips {
  flex: 1 1 auto;
  margin: 0;
  /* Cap the tips column at the height of the editor list so neither
     side dominates the page when there are only 1-2 tips. */
  max-height: 100%;
  overflow-y: auto;
}
@media (max-width: 960px) {
  /* Tablet + phone: stack the tips below the editor instead of
     cramming both into a narrow split. */
  .budgets__split {
    grid-template-columns: 1fr;
  }
}

/* Nav drawer footer (sign-out) — glass card pinned to the bottom of
   the drawer so it's always reachable from the hamburger menu. */
.app-nav__footer {
  margin-top: auto;
  padding: var(--space-3);
  border-top: 1px solid var(--glass-border);
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.app-nav__signout {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: var(--space-3);
  padding: 10px var(--space-3);
  border-radius: var(--radius-md);
  color: var(--color-text);
  font-weight: 600;
  font-size: var(--text-sm);
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background var(--dur-med) var(--ease-out),
              color var(--dur-med) var(--ease-out),
              border-color var(--dur-med) var(--ease-out);
}
.app-nav__signout:hover {
  background: var(--color-danger-soft);
  color: var(--color-danger);
  border-color: var(--color-danger-soft);
}
.app-nav__signout:focus-visible {
  outline: none;
  background: var(--color-danger-soft);
  color: var(--color-danger);
  border-color: var(--color-danger);
}
.app-nav__signout__icon {
  width: 18px;
  height: 18px;
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
}
.app-nav__signout__icon svg { width: 18px; height: 18px; }
.app-nav__signout__label { flex: 1; }
.app-nav__signout__chev { color: var(--color-text-muted); }

`;
text = text.slice(0, idx) + blockToInsert + text.slice(idx);
console.log("Inserted budgets__split + app-nav__signout block");

fs.writeFileSync(path, text, "utf8");
console.log("Wrote", text.length, "bytes");