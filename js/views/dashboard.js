// Dashboard view — Phase 4.
//
// Layout:
//   ┌────────────────────────────────────────────────────────────┐
//   │ Header (KPI grid)                                          │
//   ├────────────────────────────────────────────────────────────┤
//   │ Quick Add (one-line)                                       │
//   ├────────────────────────────┬───────────────────────────────┤
//   │ Category breakdown (chart) │ Recent expenses + budget alert│
//   └────────────────────────────┴───────────────────────────────┘
//
// All amounts come from the store; formatting goes through `formatCurrency`
// so changing the currency in Settings updates every KPI / chip / value
// without touching the view.

import { Store } from "../store.js";
import { formatCurrency, formatDate } from "../format.js";
import { toast } from "../components/toast.js";
import { buildProgressBar } from "../components/progress.js";
import { renderBarChart } from "../components/chart.js";
import { confirmDialog } from "../components/confirm.js";
import {
  parseQuickAdd,
  escapeHtml,
  paymentMethodLabel,
  upiAppLabel,
  suggestCategory,
  todayISO,
  currentTimeHHMM,
  monthKey,
  formatMonth,
} from "../util.js";

/**
 * Renders the Dashboard into the given container.
 * @param {HTMLElement} container
 * @param {object} ctx — { state, session, navigate, refresh }.
 *   session.currentMonth is the month the dashboard reflects.
 */
export function renderDashboard(container, ctx) {
  const { state, session, navigate } = ctx;
  const settings = state.settings;
  const currentKey = monthKey(session.currentMonth);
  // We rebuild the entire view on every render. Simple, predictable, and
  // fast enough for a single-user app of this size.

  // --- Compute this month + last month totals ----------------------------
  const thisMonthExpenses = state.expenses.filter((e) => e.date?.startsWith(currentKey));
  const thisTotal = sum(thisMonthExpenses);

  // Last month = the calendar month before the current one.
  const lastDate = new Date(session.currentMonth.getFullYear(), session.currentMonth.getMonth() - 1, 1);
  const lastKey = monthKey(lastDate);
  const lastMonthExpenses = state.expenses.filter((e) => e.date?.startsWith(lastKey));
  const lastTotal = sum(lastMonthExpenses);

  // --- Compute category breakdown for the current month ------------------
  // "Other" bucket collects any category not in the top 7 so the chart stays
  // readable when there are many small categories.
  const breakdown = buildCategoryBreakdown(thisMonthExpenses, state.categories);
  const catById = new Map(state.categories.map((c) => [c.id, c]));

  // --- Build DOM ---------------------------------------------------------
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="view-header">
      <h1 class="section-title">Dashboard</h1>
      <button class="btn btn--primary" type="button" id="dash-add-btn">+ Add expense</button>
    </div>

    <!-- KPI cards: this month, last month, daily average -->
    <div class="kpi-grid" id="kpi-grid"></div>

    <!-- Quick Add: one-line entry, e.g. "Coffee 180" -->
    <div class="dash-card" style="margin-bottom: var(--space-4)">
      <div class="dash-card__title">
        Quick add
        <span class="dash-card__hint">Type a note and amount, e.g. <code>Coffee 180</code></span>
      </div>
      <form class="quick-add" id="quick-add-form" autocomplete="off">
        <input
          class="quick-add__input"
          type="text"
          id="quick-add-input"
          placeholder="Coffee 180"
          aria-label="Quick add expense"
        />
        <button class="btn btn--primary" type="submit">Add</button>
        <input
          class="quick-add__note"
          type="text"
          id="quick-add-note"
          placeholder="Add a note (optional)"
          aria-label="Note for the expense (optional)"
          maxlength="200"
        />
      </form>
      <div class="quick-add__preview" id="quick-add-preview" aria-live="polite"></div>
    </div>

    <div class="dash-grid">
      <!-- Category breakdown chart -->
      <div class="dash-card">
        <div class="dash-card__title">
          Category breakdown
          <span class="dash-card__hint">${escapeHtml(formatMonth(session.currentMonth))}</span>
        </div>
        <div id="breakdown-chart"></div>
      </div>

      <!-- Recent expenses + budget alerts -->
      <div style="display:flex; flex-direction:column; gap: var(--space-4)">
        <div class="dash-card">
          <div class="dash-card__title">Recent expenses</div>
          <div id="recent-list"></div>
        </div>
        <div class="dash-card">
          <div class="dash-card__title">Budget alerts</div>
          <div id="budget-alerts"></div>
        </div>
      </div>
    </div>
  `;
  container.appendChild(wrap);

  // --- KPI cards ---------------------------------------------------------
  wrap.querySelector("#kpi-grid").innerHTML = renderKpiGrid({
    thisTotal, thisCount: thisMonthExpenses.length,
    lastTotal, lastCount: lastMonthExpenses.length,
    session, settings,
  });

  // --- Quick Add ---------------------------------------------------------
  mountQuickAdd(wrap, ctx);

  // --- Breakdown chart ---------------------------------------------------
  renderBarChart(wrap.querySelector("#breakdown-chart"), {
    data: breakdown,
    valuePrefix: settings.currencySymbol,
    emptyText: "No expenses this month yet.",
  });

  // --- Recent expenses ---------------------------------------------------
  renderRecent(wrap.querySelector("#recent-list"), { state, session, navigate });

  // --- Budget alerts panel -----------------------------------------------
  // Phase 6 will introduce real per-category budgets. For now we derive
  // a soft "spend vs. spend × 4" cap so the progress bar UI is visible
  // and the color thresholds are exercised.
  renderBudgetAlerts(wrap.querySelector("#budget-alerts"), {
    state, session, settings, breakdown,
  });

  // --- Add expense (full form) ------------------------------------------
  // Delegate to main.js's shared openAddExpenseModal so the full form has
  // the same modal + validation flow used by the Expenses view's Add button.
  wrap.querySelector("#dash-add-btn").addEventListener("click", () => ctx.openAddExpenseModal());
}

// --- Sub-renderers --------------------------------------------------------

function renderKpiGrid({ thisTotal, thisCount, lastTotal, lastCount, session, settings }) {
  // Daily average = total spent / day-of-month (clamped to 1 to avoid /0).
  const today = new Date();
  const isCurrentMonth =
    today.getFullYear() === session.currentMonth.getFullYear() &&
    today.getMonth() === session.currentMonth.getMonth();
  const dayCount = isCurrentMonth ? Math.max(1, today.getDate()) : 1;
  const daily = thisCount > 0 ? thisTotal / dayCount : 0;

  // "vs. last month" — absolute and percentage. Direction-aware styling.
  let deltaHtml = '<span class="kpi__delta">no data last month</span>';
  if (lastCount > 0) {
    const diff = thisTotal - lastTotal;
    const pct = Math.round((diff / lastTotal) * 100);
    const dirClass = diff > 0 ? "kpi__delta--up" : diff < 0 ? "kpi__delta--down" : "";
    const sign = diff > 0 ? "+" : "";
    const verb = diff > 0 ? "more" : diff < 0 ? "less" : "same as";
    deltaHtml = `<span class="kpi__delta ${dirClass}">${sign}${formatCurrency(diff, settings)} (${sign}${pct}%) ${verb} than last month</span>`;
  } else if (thisCount > 0) {
    deltaHtml = `<span class="kpi__delta">new this month (last month: ${formatCurrency(0, settings)})</span>`;
  }

  return `
    <div class="kpi">
      <div class="kpi__label">${escapeHtml(formatMonth(session.currentMonth))} total</div>
      <div class="kpi__value">${formatCurrency(thisTotal, settings)}</div>
      <div class="kpi__delta">${thisCount} expense${thisCount === 1 ? "" : "s"}</div>
    </div>
    <div class="kpi">
      <div class="kpi__label">vs. last month</div>
      <div class="kpi__value" style="font-size: var(--text-md)">${formatCurrency(lastTotal, settings)}</div>
      ${deltaHtml}
    </div>
    <div class="kpi">
      <div class="kpi__label">Daily average</div>
      <div class="kpi__value">${formatCurrency(daily, settings)}</div>
      <div class="kpi__delta">so far this month</div>
    </div>
    <div class="kpi">
      <div class="kpi__label">Today</div>
      <div class="kpi__value" style="font-size: var(--text-md)">${formatDate(todayISO(), settings)}</div>
    </div>
  `;
}

function mountQuickAdd(wrap, ctx) {
  const form = wrap.querySelector("#quick-add-form");
  const input = wrap.querySelector("#quick-add-input");
  const noteInput = wrap.querySelector("#quick-add-note");
  const preview = wrap.querySelector("#quick-add-preview");
  // Capture settings so the toast message can format the amount the same
  // way the rest of the dashboard does (incl. INR / position / symbol).
  const settings = ctx.state.settings;

  // Live preview — as the user types, show what the parser will pick out.
  // Updating the preview on every input event gives instant feedback
  // ("yes, 180 was recognized as the amount").
  input.addEventListener("input", () => {
    const raw = input.value;
    if (!raw.trim()) {
      preview.innerHTML = "";
      return;
    }
    const { amount, note } = parseQuickAdd(raw);
    const settings = ctx.state.settings;
    // Look up the suggested category from the note and resolve the full
    // category object so we can show its color + name in the preview.
    const catById = new Map(ctx.state.categories.map((c) => [c.id, c]));
    const sugMatch = suggestCategory(note);
    const sug = sugMatch ? catById.get(sugMatch.id) : null;
    const sugChip = sug
      ? `<span class="cat-chip"><span class="cat-swatch" style="background:${sug.color}"></span>${escapeHtml(sug.name)}</span>`
      : "";
    const noteChip = note
      ? `<span class="muted">“${escapeHtml(note)}”</span>`
      : `<span class="muted">(no note)</span>`;
    const amountChip = amount != null
      ? `<strong>${formatCurrency(amount, settings)}</strong>`
      : `<span class="muted">no amount detected</span>`;
    preview.innerHTML = `${amountChip} ${noteChip} ${sugChip}`;
  });

  // Submit handler: parse → validate → save directly.
  // For Quick Add we don't open the full review modal — the whole point is
  // one-line entry. We still validate the amount and category so we never
  // persist garbage, and we show a toast so the user knows it worked.
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const raw = input.value;
    const { amount } = parseQuickAdd(raw);
    // Note precedence: explicit note field > parsed-from-input > raw input.
    // The user can leave the note field empty to skip it; we fall back to
    // whatever the parser extracted (e.g. "Coffee" from "Coffee 180") so
    // the auto-suggestion still works.
    const explicitNote = (noteInput?.value || "").trim();
    const parsedNote = parseQuickAdd(raw).note;
    const finalNote = explicitNote || parsedNote || raw;

    // If the user typed something but no number was found, ask for confirmation
    // before adding a 0-amount entry — that would just be clutter.
    if (amount == null) {
      const ok = await confirmDialog({
        title: "No amount detected",
        message: `“${raw}” doesn't contain a number. Add it anyway with ${settings.currencySymbol}0?`,
        confirmLabel: "Add anyway",
        cancelLabel: "Keep editing",
      });
      if (!ok) return;
    }

    // Build the expense. Use the first category as a safe fallback if no
    // suggestion is found; the user can always change it via Edit later.
    // The category suggestion is driven by whichever note wins (explicit
    // takes priority), so the user's typed note still controls the auto-pick.
    const sug = suggestCategory(finalNote);
    const fallbackId = ctx.state.categories[0]?.id || "";
    const expense = {
      amount: amount != null ? amount : 0,
      date: todayISO(),
      time: currentTimeHHMM(),
      categoryId: sug?.id || fallbackId,
      note: finalNote,
      paymentMethod: "cash",
      upiApp: "",
    };

    // Guard: at least one category must exist.
    if (!expense.categoryId) {
      toast("Add a category first (Categories view)", "error");
      return;
    }

    Store.addExpense(ctx.state, expense);
    Store.save(ctx.state);
    // Show the note in the toast only if the user actually provided one —
    // otherwise the toast stays short ("Added ₹180 · expense").
    const noteTail = explicitNote ? ` · "${explicitNote}"` : "";
    toast(`Added ${formatCurrency(expense.amount, settings)}${noteTail}`, "success");
    input.value = "";
    if (noteInput) noteInput.value = "";
    preview.innerHTML = "";
    ctx.refresh();
  });
}

function renderRecent(host, { state, session, navigate }) {
  // Show the 5 most recent expenses regardless of the selected month.
  // Sorting by date desc, then time desc gives a stable order.
  const recent = state.expenses
    .slice()
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.time || "").localeCompare(a.time || "");
    })
    .slice(0, 5);

  if (recent.length === 0) {
    host.innerHTML = `<div class="muted">No expenses yet.</div>`;
    return;
  }
  const catById = new Map(state.categories.map((c) => [c.id, c]));
  host.innerHTML = `
    <ul class="recent-list" role="list">
      ${recent.map((e) => {
        const cat = catById.get(e.categoryId);
        const method = paymentMethodLabel(e.paymentMethod);
        const app = e.paymentMethod === "upi" && e.upiApp ? " · " + upiAppLabel(e.upiApp) : "";
        return `
          <li class="recent-item">
            <span class="cat-swatch" style="background:${cat?.color || "var(--color-border-strong)"}"></span>
            <span class="recent-item__title">
              <strong>${escapeHtml(cat?.name || "—")}</strong>
              <span class="muted"> · ${escapeHtml(method)}${escapeHtml(app)}</span>
              ${e.note ? `<div class="muted" style="font-size:var(--text-xs)">${escapeHtml(e.note)}</div>` : ""}
            </span>
            <span class="recent-item__amount">${formatCurrency(e.amount, state.settings)}</span>
          </li>
        `;
      }).join("")}
    </ul>
    <div style="margin-top: var(--space-2)">
      <a class="muted" href="#/expenses" style="font-size: var(--text-sm)">View all →</a>
    </div>
  `;
}

function renderBudgetAlerts(host, { state, session, settings, breakdown }) {
  // Real per-category budgets (Phase 6). The dashboard shows every category
  // that has a budget set for the current month, sorted by how close they
  // are to their limit (the most urgent at the top).
  const currentKey = monthKey(session.currentMonth);
  const monthBudgets = (state.budgets.monthly || {})[currentKey] || {};
  const catById = new Map(state.categories.map((c) => [c.id, c]));

  // Build rows: { id, name, color, spent, budget, fraction }.
  const rows = [];
  for (const [catId, budget] of Object.entries(monthBudgets)) {
    if (!budget || budget <= 0) continue;
    const cat = catById.get(catId);
    if (!cat) continue; // category was deleted; ignore its orphan budget
    const spent = breakdown.find((b) => b.id === catId)?.value || 0;
    rows.push({ id: catId, name: cat.name, color: cat.color, spent, budget, fraction: spent / budget });
  }

  if (rows.length === 0) {
    host.innerHTML = `
      <div class="muted">
        No budgets set for this month.
        <br />
        <a class="muted" href="#/budgets" style="font-size: var(--text-sm)">Set one in the Budgets view →</a>
      </div>
    `;
    return;
  }

  // Sort: highest fraction first (most urgent), then by absolute overspend.
  rows.sort((a, b) => b.fraction - a.fraction || (b.spent - b.budget) - (a.spent - a.budget));

  host.innerHTML = rows.map((r) => {
    const over = r.spent > r.budget;
    return `
      <div class="budget-alert">
        <div class="budget-alert__name">
          <span class="cat-swatch" style="background:${r.color}"></span>
          ${escapeHtml(r.name)}
        </div>
        <div class="budget-alert__amounts">
          ${formatCurrency(r.spent, settings)} / ${formatCurrency(r.budget, settings)}
          ${over ? `<br/><span class="kpi__delta kpi__delta--up">over by ${formatCurrency(r.spent - r.budget, settings)}</span>` : ""}
        </div>
      </div>
      <div class="budget-alert__bar" data-attach-progress
           data-value="${r.spent}" data-max="${r.budget}" data-label="${escapeHtml(r.name)} budget"
           style="margin-bottom: var(--space-3)"></div>
    `;
  }).join("");

  // After the HTML is in the DOM, swap the placeholder for a real
  // progress bar so we can use the proper ARIA attributes and a11y wiring.
  host.querySelectorAll("[data-attach-progress]").forEach((el) => {
    el.replaceWith(buildProgressBar({
      value: Number(el.dataset.value),
      max: Number(el.dataset.max),
      label: el.dataset.label,
    }));
  });
}

// --- Helpers --------------------------------------------------------------

/** Build a sorted list of category → total for the chart. */
function buildCategoryBreakdown(expenses, categories) {
  const totals = new Map();
  for (const e of expenses) {
    if (!e.categoryId) continue;
    totals.set(e.categoryId, (totals.get(e.categoryId) || 0) + e.amount);
  }
  const catById = new Map(categories.map((c) => [c.id, c]));
  const out = [];
  for (const [id, value] of totals) {
    const cat = catById.get(id);
    if (!cat) continue;
    out.push({ id, label: cat.name, value, color: cat.color });
  }
  return out;
}

function sum(expenses) {
  return expenses.reduce((s, e) => s + (e.amount || 0), 0);
}

// todayISO, currentTimeHHMM, monthKey, formatMonth are all imported from
// ../util.js (single source of truth, used by main.js / budgets.js too).
