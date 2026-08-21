// Budgets view — Phase 6.
//
// A real per-category, per-month budget editor.
//
// Features:
//   • Month selector with prev/next + "Today" jump
//   • One row per category with an editable budget amount
//   • Live progress bar per row using the same threshold colors as the
//     dashboard (default <80%, warn ≥80%, danger ≥100%)
//   • Top totals: total budget, total spent, remaining, % used
//   • "Copy from last month" button (handy at the start of each month)
//   • Empty state if no categories exist
//
// Budgets are stored in `state.budgets.monthly[YYYY-MM][categoryId] = number`.
// Amounts of 0 / empty / NaN are stored as "no budget" (the row is hidden
// from the totals). The store handles this via Store.setBudget().

import { Store } from "../store.js";
import { formatCurrency } from "../format.js";
import { buildProgressBar } from "../components/progress.js";
import { toast } from "../components/toast.js";
import { escapeHtml, startOfMonth, monthKey, formatMonth } from "../util.js";
import { computeBudgetTips, TIP_KIND_ICON } from "../budget-tips.js";

/**
 * Renders the Budgets view.
 * @param {HTMLElement} container
 * @param {object} ctx — { state, session, refresh }
 *   session.currentMonth determines which month the view shows.
 */
export function renderBudgets(container, { state, session, refresh }) {
  const settings = state.settings;
  const currentKey = monthKey(session.currentMonth);
  const currentLabel = formatMonth(session.currentMonth);
  const lastKey = monthKey(new Date(session.currentMonth.getFullYear(), session.currentMonth.getMonth() - 1, 1));
  const lastLabel = formatMonth(new Date(session.currentMonth.getFullYear(), session.currentMonth.getMonth() - 1, 1));

  // --- Header + month selector + copy button ---------------------------
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="view-header">
      <h1 class="section-title">Budgets</h1>
      <div class="view-header__actions">
        <button class="btn" type="button" id="budget-prev" aria-label="Previous month">‹</button>
        <span class="budgets__month" id="budget-month">${escapeHtml(currentLabel)}</span>
        <button class="btn" type="button" id="budget-next" aria-label="Next month">›</button>
        <button class="btn btn--ghost" type="button" id="budget-today">Today</button>
        <button class="btn" type="button" id="budget-copy">Copy from last month</button>
      </div>
    </div>

    <!-- Totals card -->
    <div class="kpi-grid" id="budget-totals"></div>

    <!-- Two-column layout: per-category editor on the left (60%),
         smart suggestions on the right (40%) so both stay visible
         together instead of the tips being pushed below the long
         category list. -->
    <div class="budgets__split">
      <!-- Per-category budget list (with inline budget editor) -->
      <div class="card budgets__split-list" style="padding:0">
        <div id="budget-list"></div>
      </div>

      <!-- Smart tips (rule-based "AI" suggestions) -->
      <div class="budgets__split-tips" id="budget-smart-tips"></div>
    </div>
  `;
  container.appendChild(wrap);

  // --- Month navigation -------------------------------------------------
  wrap.querySelector("#budget-prev").addEventListener("click", () => {
    session.currentMonth = new Date(
      session.currentMonth.getFullYear(),
      session.currentMonth.getMonth() - 1, 1,
    );
    refresh();
  });
  wrap.querySelector("#budget-next").addEventListener("click", () => {
    session.currentMonth = new Date(
      session.currentMonth.getFullYear(),
      session.currentMonth.getMonth() + 1, 1,
    );
    refresh();
  });
  wrap.querySelector("#budget-today").addEventListener("click", () => {
    session.currentMonth = startOfMonth(new Date());
    refresh();
  });
  wrap.querySelector("#budget-copy").addEventListener("click", () => {
    copyFromLastMonth(state, currentKey, lastKey, lastLabel, refresh);
  });

  // --- Render the totals + list -----------------------------------------
  const totalsHost = wrap.querySelector("#budget-totals");
  const listHost = wrap.querySelector("#budget-list");
  renderTotals(totalsHost, { state, currentKey, currentLabel, settings });
  renderList(listHost, { state, currentKey, currentLabel, settings, refresh });
  renderSmartTips(wrap, { state, currentMonth: session.currentMonth, refresh });
}

function renderTotals(host, { state, currentKey, currentLabel, settings }) {
  const monthBudgets = state.budgets.monthly[currentKey] || {};
  const monthExpenses = state.expenses.filter((e) => e.date?.startsWith(currentKey));

  const totalBudget = sumBy(monthBudgets, Object.keys(monthBudgets), (id) => monthBudgets[id]);
  const totalSpent = sumBy(monthExpenses, monthExpenses, (e) => e.amount);
  const remaining = totalBudget - totalSpent;
  const pct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

  // Color the "remaining" delta based on sign.
  const remainingClass = remaining < 0
    ? "kpi__delta kpi__delta--up"   // over budget
    : totalBudget === 0 ? "kpi__delta" : "kpi__delta kpi__delta--down";
  const remainingText = totalBudget === 0
    ? "Set a budget below to see remaining"
    : remaining < 0
      ? `Over by ${formatCurrency(-remaining, settings)}`
      : `${formatCurrency(remaining, settings)} left`;

  host.innerHTML = `
    <div class="kpi">
      <div class="kpi__label">${escapeHtml(currentLabel)} budget</div>
      <div class="kpi__value">${formatCurrency(totalBudget, settings)}</div>
      <div class="kpi__delta">${Object.keys(monthBudgets).filter((k) => monthBudgets[k] > 0).length} categor${Object.keys(monthBudgets).filter((k) => monthBudgets[k] > 0).length === 1 ? "y" : "ies"}</div>
    </div>
    <div class="kpi">
      <div class="kpi__label">Spent so far</div>
      <div class="kpi__value">${formatCurrency(totalSpent, settings)}</div>
      <div class="kpi__delta">${monthExpenses.length} expense${monthExpenses.length === 1 ? "" : "s"}</div>
    </div>
    <div class="kpi">
      <div class="kpi__label">Remaining</div>
      <div class="kpi__value" style="font-size:var(--text-md)">${totalBudget > 0 ? formatCurrency(Math.max(0, remaining), settings) : "—"}</div>
      <div class="${remainingClass}">${remainingText}</div>
    </div>
    <div class="kpi">
      <div class="kpi__label">Used</div>
      <div class="kpi__value">${totalBudget > 0 ? pct + "%" : "—"}</div>
      <div class="kpi__delta">of total budget</div>
    </div>
  `;
}

function renderList(host, { state, currentKey, currentLabel, settings, refresh }) {
  if (state.categories.length === 0) {
    host.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__title">No categories</div>
        <div class="empty-state__body">Add one in the Categories view to set budgets.</div>
      </div>
    `;
    return;
  }

  const monthBudgets = state.budgets.monthly[currentKey] || {};
  // Compute per-category spend for this month so the row can show progress
  // even when the user hasn't entered a budget yet.
  const spendByCat = new Map();
  for (const e of state.expenses) {
    if (!e.date?.startsWith(currentKey)) continue;
    spendByCat.set(e.categoryId, (spendByCat.get(e.categoryId) || 0) + e.amount);
  }

  // Build a category lookup for the post-render pass that mounts bars.
  const catByIdLocal = new Map(state.categories.map((c) => [c.id, c]));

  // Sort: categories with a budget first (by amount desc), then without.
  const cats = state.categories.slice().sort((a, b) => {
    const ab = monthBudgets[a.id] || 0;
    const bb = monthBudgets[b.id] || 0;
    if (ab > 0 && bb === 0) return -1;
    if (ab === 0 && bb > 0) return 1;
    if (ab !== bb) return bb - ab;
    return a.name.localeCompare(b.name);
  });

  host.innerHTML = `
    <ul class="budget-list" role="list">
      ${cats.map((c) => {
        const budget = monthBudgets[c.id] || 0;
        const spent = spendByCat.get(c.id) || 0;
        return renderRow({ cat: c, budget, spent, settings });
      }).join("")}
    </ul>
  `;

  // Replace each placeholder `<div data-row-bar-host="...">` with a real
  // progress bar. We do this after innerHTML so we can use the bar builder
  // (which returns a real DOM node with the correct ARIA + color class).
  host.querySelectorAll("[data-row-bar-host]").forEach((ph) => {
    const catId = ph.dataset.rowBarHost;
    const cat = catByIdLocal.get(catId);
    const budget = monthBudgets[catId] || 0;
    const spent = spendByCat.get(catId) || 0;
    if (!cat || budget <= 0) return;
    const bar = buildProgressBar({ value: spent, max: budget, label: `${cat.name} budget` });
    ph.replaceWith(bar);
  });

  // Wire the input + Clear button per row. Re-render the totals + list
  // after every change so progress bars and the totals card stay in sync.
  const refreshTotalsAndList = () => {
    const totalsHost = document.getElementById("budget-totals");
    if (totalsHost) {
      renderTotals(totalsHost, { state, currentKey, currentLabel, settings });
    }
    renderList(host, { state, currentKey, currentLabel, settings, refresh });
  };

  host.querySelectorAll("[data-budget-input]").forEach((input) => {
    input.addEventListener("change", () => {
      const catId = input.dataset.catId;
      const raw = input.value;
      // Empty / 0 / non-numeric → clear the budget for this category/month.
      const num = raw === "" ? 0 : Number(raw);
      const value = Number.isFinite(num) && num > 0 ? num : 0;
      Store.setBudget(state, currentKey, catId, value);
      Store.save(state);
      refreshTotalsAndList();
      refresh();
    });
  });
  host.querySelectorAll("[data-budget-clear]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const catId = btn.dataset.catId;
      Store.setBudget(state, currentKey, catId, 0);
      Store.save(state);
      refreshTotalsAndList();
      refresh();
    });
  });
}

function renderRow({ cat, budget, spent, settings }) {
  // Show the input even when budget is 0 — the user is more likely to
  // want to type a number than to look for an "add budget" button.
  const value = budget > 0 ? String(budget) : "";
  const hasBudget = budget > 0;

  return `
    <li class="budget-list__item" data-id="${cat.id}">
      <div class="budget-list__head">
        <span class="cat-swatch" style="background:${cat.color}"></span>
        ${cat.icon ? `<span class="cat-icon" aria-hidden="true">${escapeHtml(cat.icon)}</span>` : ""}
        <span class="budget-list__name">${escapeHtml(cat.name)}</span>
        <span class="budget-list__spent muted">
          Spent: <strong>${formatCurrency(spent, settings)}</strong>
        </span>
        ${hasBudget
          ? `<button class="icon-btn budget-list__clear" type="button" data-budget-clear data-cat-id="${cat.id}" title="Clear budget">×</button>`
          : `<span class="budget-list__clear-spacer"></span>`}
      </div>
      <div class="budget-list__editor">
        <label class="budget-list__editor-label" for="budget-input-${escapeHtml(cat.id)}">
          Monthly budget
        </label>
        <div class="budget-list__editor-row">
          <span class="budget-list__editor-prefix" aria-hidden="true">${escapeHtml(settings.currencySymbol || "₹")}</span>
          <input
            type="number" min="0" step="50" inputmode="decimal"
            class="field__input budget-list__input"
            id="budget-input-${escapeHtml(cat.id)}"
            data-budget-input data-cat-id="${cat.id}"
            value="${escapeHtml(value)}" placeholder="0"
            aria-label="Budget for ${escapeHtml(cat.name)}"
          />
        </div>
      </div>
      ${hasBudget
        ? `<div class="budget-list__bar" data-row-bar-host="${cat.id}"></div>`
        : ""}
    </li>
  `;
}

// --- Copy from last month --------------------------------------------------

function copyFromLastMonth(state, currentKey, lastKey, lastLabel, refresh) {
  const lastBudgets = state.budgets.monthly[lastKey];
  if (!lastBudgets || Object.keys(lastBudgets).length === 0) {
    toast(`No budgets set for ${lastLabel}`, "error");
    return;
  }
  if (!state.budgets.monthly[currentKey]) state.budgets.monthly[currentKey] = {};
  // Copy only the categories that still exist; skip ones the user deleted.
  let copied = 0;
  for (const [catId, amount] of Object.entries(lastBudgets)) {
    if (state.categories.some((c) => c.id === catId) && amount > 0) {
      state.budgets.monthly[currentKey][catId] = amount;
      copied++;
    }
  }
  Store.save(state);
  toast(`Copied ${copied} budget${copied === 1 ? "" : "s"} from ${lastLabel}`, "success");
  refresh();
}

// --- Helpers ---------------------------------------------------------------

// startOfMonth, monthKey, formatMonth are imported from ../util.js so the
// date helpers have a single source of truth (main.js, dashboard.js, and
// budgets.js all use the same implementations).

function sumBy(_map, arr, pick) {
  let s = 0;
  for (const item of arr) s += pick(item) || 0;
  return s;
}

// --- Smart tips (rule-based "AI" suggestions) -----------------------------
// Rendered above the totals card on the Budgets view. Tips are computed
// pure-function style from state, so they're always in sync with the
// current month and the latest expenses.
function renderSmartTips(wrap, { state, currentMonth, refresh }) {
  const host = wrap.querySelector("#budget-smart-tips");
  if (!host) return;
  const tips = computeBudgetTips(state, { month: currentMonth });
  if (!tips || tips.length === 0) return;

  host.innerHTML = `
    <div class="card budget-tips" aria-labelledby="budget-tips-title">
      <div class="card__title" id="budget-tips-title">
        <span aria-hidden="true">✨</span> Smart suggestions
      </div>
      <div class="card__subtitle">
        Personalised tips based on your spending this month. No data leaves your device.
      </div>
      <ul class="budget-tips__list" role="list">
        ${tips.map((t) => `
          <li class="budget-tips__item budget-tips__item--${escapeHtml(t.kind)}">
            <span class="budget-tips__icon" aria-hidden="true">${TIP_KIND_ICON[t.kind] || "•"}</span>
            <div class="budget-tips__body">
              <div class="budget-tips__title">${escapeHtml(t.title)}</div>
              <div class="budget-tips__text">${escapeHtml(t.body)}</div>
            </div>
          </li>
        `).join("")}
      </ul>
    </div>
  `;
}
