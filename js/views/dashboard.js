// Dashboard view — Phase 4 + Premium redesign.
//
// Layout:
//   ┌────────────────────────────────────────────────────────────┐
//   │ Hero card (greeting + remaining budget + ring + streak)    │
//   ├────────────────────────────────────────────────────────────┤
//   │ Smart insights (4 cards)                                   │
//   ├────────────────────────────────────────────────────────────┤
//   │ KPI grid: this month / last month / daily avg /           │
//   │            budget-alert card (spans 2 columns for breathing │
//   │            room + an internal scroll for long lists)       │
//   ├────────────────────────────────────────────────────────────┤
//   │ Quick Add (one-line)                                       │
//   ├────────────────────────────┬───────────────────────────────┤
//   │ Category breakdown (chart) │ Recent transactions (cards)   │
//   └────────────────────────────┴───────────────────────────────┘
//
// All amounts come from the store; formatting goes through `formatCurrency`
// so changing the currency in Settings updates every KPI / chip / value
// without touching the view.

import { Store } from "../store.js";
import { formatCurrency, formatDate } from "../format.js";
import { isSupported as voiceSupported, startListening as startVoice } from "../voice.js";
import { toast } from "../components/toast.js";
import { buildProgressBar } from "../components/progress.js";
import { renderBarChart } from "../components/chart.js";
import { confirmDialog } from "../components/confirm.js";
import { parseQuickAdd, escapeHtml, paymentMethodLabel, upiAppLabel, suggestCategory, todayISO, currentTimeHHMM, monthKey, formatMonth } from "../util.js";

// `syncToServer` is exposed on window by main.js so views can kick the
// server-side mirror immediately after a mutation. We grab it lazily
// (and tolerate it being absent — e.g. in tests) so this module has no
// hard dependency on main.js's bootstrap order.
const _syncToServer = () => {
  try {
    if (typeof window !== "undefined" && typeof window.syncToServer === "function") {
      window.syncToServer();
    }
  } catch { /* best-effort */ }
};

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

  // --- Compute this month + last month totals ----------------------------
  const thisMonthExpenses = state.expenses.filter((e) => e.date?.startsWith(currentKey));
  const thisTotal = sum(thisMonthExpenses);

  // Last month = the calendar month before the current one.
  const lastDate = new Date(session.currentMonth.getFullYear(), session.currentMonth.getMonth() - 1, 1);
  const lastKey = monthKey(lastDate);
  const lastMonthExpenses = state.expenses.filter((e) => e.date?.startsWith(lastKey));
  const lastTotal = sum(lastMonthExpenses);

  // --- Compute category breakdown for the current month ------------------
  const breakdown = buildCategoryBreakdown(thisMonthExpenses, state.categories);
  const catById = new Map(state.categories.map((c) => [c.id, c]));

  // --- Compute budget totals for the hero card ---------------------------
  const monthBudgets = (state.budgets.monthly || {})[currentKey] || {};
  const totalBudget = Object.values(monthBudgets).reduce((s, v) => s + (Number(v) || 0), 0);
  const remaining = totalBudget - thisTotal;
  const usedPct = totalBudget > 0 ? Math.min(100, Math.round((thisTotal / totalBudget) * 100)) : 0;

  // --- Compute streak (consecutive days the user has signed in) ----------
  // The streak is driven by login days (recorded in `state.loginDays`
  // every time the user successfully signs in), not by expense entries.
  // This means the badge reflects "how often you open the app" rather
  // than "how often you log an expense".
  const streak = computeLoginStreak(state.loginDays, todayISO());

  // --- Compute smart insights --------------------------------------------
  // Streak is intentionally NOT surfaced here — it lives only on the
  // Hero card (see renderHeroCard). The "consistency" insight below used
  // to repeat the streak number; it now falls back to a generic nudge
  // when the month has no expenses yet, so the grid has a placeholder.
  const insights = buildInsights({
    thisTotal, lastTotal, thisMonthExpenses, breakdown, totalBudget, remaining, settings,
  });

  // --- Build DOM ---------------------------------------------------------
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    ${renderHeroCard({
      name: state.profile?.name || "",
      remaining, totalBudget, thisTotal, usedPct, streak, settings,
      monthLabel: formatMonth(session.currentMonth),
    })}

    ${renderInsights(insights)}

    <!-- KPI cards: this month, last month, daily average -->
    <div class="kpi-grid" id="kpi-grid"></div>

    <!-- Quick Add: one-line entry, e.g. "Coffee 180" -->
    <div class="dash-card" style="margin-bottom: var(--space-4)">
      <div class="dash-card__title">
        Quick add
        <span class="dash-card__hint">Type a note and amount, e.g. <code>Coffee 180</code></span>
      </div>
      <form class="quick-add" id="quick-add-form" autocomplete="off">
        <!-- Row 1: text input + mic + Add button -->
        <div class="quick-add__row quick-add__row--primary">
          <input
            class="quick-add__input"
            type="text"
            id="quick-add-input"
            placeholder="Coffee 180"
            aria-label="Quick add expense"
          />
          <button class="btn voice-entry__btn quick-add__mic" type="button"
                  id="quick-add-mic" aria-label="Speak expense">
            <span aria-hidden="true">🎙️</span>
          </button>
          <button class="btn btn--primary" type="submit">Add</button>
        </div>
        <!-- Row 2: category + payment method dropdowns (always visible) -->
        <div class="quick-add__row quick-add__row--meta">
          <label class="quick-add__field">
            <span class="quick-add__label">Category</span>
            <select
              class="field__select quick-add__cat"
              id="quick-add-cat"
              aria-label="Category"
              title="Category"></select>
          </label>
          <label class="quick-add__field">
            <span class="quick-add__label">Payment</span>
            <select
              class="field__select quick-add__pay"
              id="quick-add-pay"
              aria-label="Payment method"
              title="Payment method">
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="debit_card">Debit card</option>
              <option value="credit_card">Credit card</option>
              <option value="bank_transfer">Bank transfer</option>
            </select>
          </label>
          <label class="quick-add__field quick-add__field--upi" id="quick-add-upi-wrap" hidden>
            <span class="quick-add__label">UPI app</span>
            <select
              class="field__select quick-add__upi"
              id="quick-add-upi"
              aria-label="UPI app"
              title="UPI app">
              <option value="phonepe">PhonePe</option>
              <option value="googlepay">Google Pay</option>
              <option value="paytm">Paytm</option>
            </select>
          </label>
          <label class="quick-add__field quick-add__field--note">
            <span class="quick-add__label">Note (optional)</span>
            <input
              class="quick-add__note"
              type="text"
              id="quick-add-note"
              placeholder="Add a note"
              aria-label="Note for the expense (optional)"
              maxlength="200"
            />
          </label>
        </div>
      </form>
      <div class="quick-add__preview" id="quick-add-preview" aria-live="polite"></div>
      <div class="quick-add__mic-status muted" id="quick-add-mic-status" aria-live="polite"></div>
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

      <!-- Recent transactions -->
      <div class="dash-card">
        <div class="dash-card__title">Recent transactions</div>
        <div id="recent-list"></div>
      </div>
    </div>
  `;
  container.appendChild(wrap);

  // --- KPI cards ---------------------------------------------------------
  wrap.querySelector("#kpi-grid").innerHTML = renderKpiGrid({
    thisTotal, thisCount: thisMonthExpenses.length,
    lastTotal, lastCount: lastMonthExpenses.length,
    session, settings, breakdown, state,
  });

  // --- Quick Add ---------------------------------------------------------
  mountQuickAdd(wrap, ctx);

  // --- Breakdown chart ---------------------------------------------------
  renderBarChart(wrap.querySelector("#breakdown-chart"), {
    data: breakdown,
    valuePrefix: settings.currencySymbol,
    emptyText: "No expenses this month yet.",
  });

  // --- Recent transactions (modern cards) --------------------------------
  renderRecent(wrap.querySelector("#recent-list"), { state, session, navigate });

  // --- Add expense (full form) ------------------------------------------
  // Delegate to main.js's shared openAddExpenseModal so the full form has
  // the same modal + validation flow used by the Expenses view's Add button.
  wrap.querySelector("#dash-add-btn")?.addEventListener("click", () => ctx.openAddExpenseModal?.());
}

// ─── Hero card ────────────────────────────────────────────────────────────
function renderHeroCard({ name, remaining, totalBudget, thisTotal, usedPct, streak, settings, monthLabel }) {
  const greeting = pickGreeting(name);
  const motivation = pickMotivation({ remaining, totalBudget, usedPct });
  const ringCircumference = 2 * Math.PI * 56; // r=56
  const ringOffset = ringCircumference * (1 - usedPct / 100);

  return `
    <section class="hero-card" aria-label="Monthly overview">
      <div class="hero-card__row">
        <div>
          <div class="hero-card__greeting">${escapeHtml(greeting)}</div>
          <h1 class="hero-card__name">${escapeHtml(monthLabel)}</h1>
          <div class="hero-card__sub">Here's how your money is doing this month.</div>

          <div class="hero-card__budget">
            <span class="hero-card__budget-label">${totalBudget > 0 ? "Remaining budget" : "Spent so far"}</span>
            <span class="hero-card__budget-value">
              ${totalBudget > 0 ? formatCurrency(remaining, settings) : formatCurrency(thisTotal, settings)}
            </span>
            <span class="hero-card__budget-meta">
              ${totalBudget > 0
                ? `of ${formatCurrency(totalBudget, settings)} budgeted`
                : `Set a budget to start tracking`}
            </span>
          </div>

          <!-- Streak badge — lives ONLY on the hero card (never repeated
               in the insights grid or anywhere else). Renders in two
               states:
                 • streak > 0  → flame + "N-day login streak"
                 • streak == 0 → flame + "Start your streak today!"
               Both variants are pill-shaped, sit in the same spot, and
               carry the same aria-label, so the layout never reflows
               between users who have an active streak and new users
               who are about to start one. The number is the centerpiece
               either way. -->
          <div class="hero-card__streak" aria-label="Login streak">
            <span class="hero-card__streak-icon" aria-hidden="true">${streak > 0 ? "🔥" : "✨"}</span>
            <span>
              ${streak > 0
                ? `<strong>${streak}-day</strong> login streak`
                : `Start your streak today!`}
            </span>
          </div>

          <div class="hero-card__motivation" role="note">
            <span aria-hidden="true">✨</span>
            <span>${escapeHtml(motivation)}</span>
          </div>
        </div>

        <div class="hero-card__ring" aria-label="Budget used: ${usedPct}%">
          <svg viewBox="0 0 140 140" aria-hidden="true">
            <circle class="hero-card__ring-track" cx="70" cy="70" r="56" />
            <circle class="hero-card__ring-fill" cx="70" cy="70" r="56"
                    stroke-dasharray="${ringCircumference}"
                    stroke-dashoffset="${ringCircumference}"
                    data-target-offset="${ringOffset}" />
          </svg>
          <div class="hero-card__ring-center">
            <div>
              <div class="hero-card__ring-pct">${totalBudget > 0 ? usedPct + "%" : "—"}</div>
              <div class="hero-card__ring-label">${totalBudget > 0 ? "Used" : "No budget"}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function pickGreeting(name) {
  const h = new Date().getHours();
  const tod = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return name ? `${tod}, ${name}` : `${tod}`;
}

function pickMotivation({ remaining, totalBudget, usedPct }) {
  if (totalBudget === 0) {
    return "Set a monthly budget to unlock insights and savings goals.";
  }
  if (usedPct >= 100) {
    return "You've crossed your budget — review your top categories to find quick wins.";
  }
  if (usedPct >= 80) {
    return "Almost at your limit. Slow down on non-essentials for the rest of the month.";
  }
  if (remaining > 0 && usedPct < 50) {
    return "You're well within budget. Consider moving some of the surplus to a savings goal.";
  }
  return "Small consistent actions beat big occasional ones. You're doing great.";
}

// ─── Smart insights ───────────────────────────────────────────────────────
function buildInsights({ thisTotal, lastTotal, thisMonthExpenses, breakdown, totalBudget, remaining, settings }) {
  const insights = [];

  // 1. vs last month
  if (lastTotal > 0) {
    const diff = thisTotal - lastTotal;
    const pct = Math.round((diff / lastTotal) * 100);
    if (diff > 0) {
      insights.push({
        icon: "📈",
        iconClass: "insight__icon--warn",
        title: `+${pct}% vs last month`,
        text: `You spent ${formatCurrency(diff, settings)} more than last month. Check your top categories.`,
      });
    } else if (diff < 0) {
      insights.push({
        icon: "🎉",
        iconClass: "insight__icon--success",
        title: `${Math.abs(pct)}% less than last month`,
        text: `Nice — you saved ${formatCurrency(Math.abs(diff), settings)} compared to last month.`,
      });
    } else {
      insights.push({
        icon: "🎯",
        iconClass: "insight__icon--primary",
        title: "Same as last month",
        text: "Your spending is steady. Try a small reduction next month.",
      });
    }
  } else if (thisTotal > 0) {
    insights.push({
      icon: "🚀",
      iconClass: "insight__icon--primary",
      title: "First month tracked",
      text: "Welcome! Next month we'll compare your progress automatically.",
    });
  }

  // 2. Top category
  if (breakdown.length > 0) {
    const top = breakdown[0];
    const pct = thisTotal > 0 ? Math.round((top.value / thisTotal) * 100) : 0;
    insights.push({
      icon: top.icon || "🏷️",
      iconClass: "insight__icon--accent",
      title: `${top.name} is your top category`,
      text: `${formatCurrency(top.value, settings)} (${pct}% of this month's spend).`,
    });
  }

  // 3. Budget status
  if (totalBudget > 0) {
    if (remaining < 0) {
      insights.push({
        icon: "⚠️",
        iconClass: "insight__icon--danger",
        title: "Over budget",
        text: `You're ${formatCurrency(Math.abs(remaining), settings)} over your monthly budget.`,
      });
    } else if (remaining > 0 && remaining < totalBudget * 0.2) {
      insights.push({
        icon: "🪙",
        iconClass: "insight__icon--warn",
        title: "Budget almost used",
        text: `Only ${formatCurrency(remaining, settings)} left for the rest of the month.`,
      });
    } else if (remaining > 0) {
      insights.push({
        icon: "💰",
        iconClass: "insight__icon--success",
        title: "On track",
        text: `${formatCurrency(remaining, settings)} remaining — keep it up!`,
      });
    }
  }

  // 4. Fresh-start nudge — shows the "✨ Fresh start" card when the
  // month has no expenses yet. The streak badge used to live here too,
  // but per the latest spec the streak is exposed only on the Hero
  // card (renderHeroCard), not in the insights grid.
  if (thisMonthExpenses.length === 0) {
    insights.push({
      icon: "✨",
      iconClass: "insight__icon--accent",
      title: "Fresh start",
      text: "Add your first expense this month to begin tracking.",
    });
  }

  return insights.slice(0, 4);
}

function renderInsights(insights) {
  if (!insights.length) return "";
  return `
    <div class="insights-grid">
      ${insights.map((i) => `
        <div class="insight">
          <div class="insight__icon ${escapeHtml(i.iconClass || "insight__icon--primary")}" aria-hidden="true">${escapeHtml(i.icon)}</div>
          <div class="insight__body">
            <div class="insight__title">${escapeHtml(i.title)}</div>
            <div class="insight__text">${escapeHtml(i.text)}</div>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

// ─── KPI grid ─────────────────────────────────────────────────────────────
// The grid hosts three numeric KPIs plus a budget-alert card. The alert
// card fills the same slot the "Today" / "streak" chips used to occupy,
// replacing low-value information with the more useful "which categories
// are about to / already over budget" view. It scrolls internally so a
// long list of categories fits the same footprint as the other KPIs.
function renderKpiGrid({ thisTotal, thisCount, lastTotal, lastCount, session, settings, breakdown, state }) {
  const today = new Date();
  const isCurrentMonth =
    today.getFullYear() === session.currentMonth.getFullYear() &&
    today.getMonth() === session.currentMonth.getMonth();
  const dayCount = isCurrentMonth ? Math.max(1, today.getDate()) : 1;
  const daily = thisCount > 0 ? thisTotal / dayCount : 0;

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
    ${renderBudgetAlertKpi({ state, session, settings, breakdown })}
  `;
}

// Budget-alert KPI: scrolls internally, surfaces over-budget categories
// at the top, descending spend order after. Fits the same grid cell the
// "Today" / streak chips used to occupy.
function renderBudgetAlertKpi({ state, session, settings, breakdown }) {
  const currentKey = monthKey(session.currentMonth);
  const monthBudgets = (state.budgets.monthly || {})[currentKey] || {};
  const catById = new Map(state.categories.map((c) => [c.id, c]));

  const rows = [];
  for (const [catId, budget] of Object.entries(monthBudgets)) {
    if (!budget || budget <= 0) continue;
    const cat = catById.get(catId);
    if (!cat) continue;
    const spent = breakdown.find((b) => b.id === catId)?.value || 0;
    rows.push({
      id: catId,
      name: cat.name,
      color: cat.color,
      icon: cat.icon,
      spent,
      budget,
      fraction: spent / budget,
    });
  }

  // Over-budget categories float to the top, then everyone else in
  // descending fraction (so the most-utilised are most visible).
  rows.sort((a, b) => {
    const aOver = a.spent > a.budget ? 1 : 0;
    const bOver = b.spent > b.budget ? 1 : 0;
    if (aOver !== bOver) return bOver - aOver;
    return b.fraction - a.fraction;
  });

  const hasBudgets = rows.length > 0;
  const overCount = rows.filter((r) => r.spent > r.budget).length;

  const rowsHtml = hasBudgets
    ? rows.map((r) => {
        const over = r.spent > r.budget;
        const pct = Math.min(100, Math.round(r.fraction * 100));
        return `
          <li class="budget-alert-kpi__row ${over ? "budget-alert-kpi__row--over" : ""}">
            <span class="cat-swatch" style="background:${r.color}"></span>
            <span class="budget-alert-kpi__name">${escapeHtml(r.name)}</span>
            <span class="budget-alert-kpi__amt">${formatCurrency(r.spent, settings)} / ${formatCurrency(r.budget, settings)}</span>
            <span class="budget-alert-kpi__bar"><span class="budget-alert-kpi__fill" style="width:${pct}%; background:${over ? "var(--color-danger, #ef4444)" : r.color}"></span></span>
          </li>
        `;
      }).join("")
    : "";

  // The chip's TEXT is the summary — e.g. "3 over budget · 7 on track".
  // The colour class is applied separately so the chip can be rendered
  // as a real styled pill (not a raw `<span>`). Kept as a plain string
  // (no wrapper elements) so the chip's className is the only thing
  // that owns the visual state.
  const subText = hasBudgets
    ? (overCount > 0
        ? `${overCount} over budget · ${rows.length - overCount} on track`
        : `All ${rows.length} categories on track`)
    : "No budgets set yet";

  // The "N over budget" summary is rendered inline in the label row so
  // it doesn't consume a whole line above the list. When the user is
  // over budget on at least one category, the chip renders in danger
  // colour; otherwise it renders in the muted text colour. The chip
  // is hidden when there are no budgets at all (the empty-state copy
  // already communicates that).
  const summaryChip = hasBudgets
    ? `<span class="budget-alert-kpi__chip ${overCount > 0 ? "budget-alert-kpi__chip--over" : "budget-alert-kpi__chip--ok"}" aria-label="Exceeded budgets">${escapeHtml(subText)}</span>`
    : "";

  return `
    <div class="kpi kpi--wide kpi--budget-alert" aria-label="Budget alerts">
      <div class="kpi__label">
        <span class="budget-alert-kpi__title">Budget alerts</span>
        <span class="budget-alert-kpi__label-right">
          ${summaryChip}
          <a class="budget-alert-kpi__link" href="#/budgets">Manage →</a>
        </span>
      </div>
      ${hasBudgets
        ? `<ul class="budget-alert-kpi__list">${rowsHtml}</ul>`
        : `<div class="budget-alert-kpi__empty">
             <a class="btn btn--sm btn--primary" href="#/budgets">Set a budget</a>
           </div>`}
    </div>
  `;
}

// ─── Quick Add ─────────────────────────────────────────────────────────────
function mountQuickAdd(wrap, ctx) {
  const form = wrap.querySelector("#quick-add-form");
  const input = wrap.querySelector("#quick-add-input");
  const noteInput = wrap.querySelector("#quick-add-note");
  const preview = wrap.querySelector("#quick-add-preview");
  const paySelect = wrap.querySelector("#quick-add-pay");
  const upiSelect = wrap.querySelector("#quick-add-upi");
  const catSelect = wrap.querySelector("#quick-add-cat");

  function refreshCategoryOptions() {
    if (!catSelect) return;
    catSelect.innerHTML = "";
    for (const c of ctx.state.categories) {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.icon ? c.icon + "  " + c.name : c.name;
      catSelect.appendChild(opt);
    }
  }
  refreshCategoryOptions();

  function syncPayFields() {
    if (!paySelect) return;
    const isUpi = paySelect.value === "upi";
    const upiWrap = wrap.querySelector("#quick-add-upi-wrap");
    if (upiWrap) upiWrap.hidden = !isUpi;
    if (upiSelect) {
      upiSelect.required = isUpi;
      upiSelect.disabled = !isUpi;
    }
  }
  if (paySelect) {
    paySelect.addEventListener("change", syncPayFields);
    syncPayFields();
  }

  const micBtn = wrap.querySelector("#quick-add-mic");
  const micStatus = wrap.querySelector("#quick-add-mic-status");
  if (micBtn && voiceSupported()) {
    let voiceActive = null;
    micBtn.addEventListener("click", () => {
      if (voiceActive) {
        voiceActive.stop();
        return;
      }
      micBtn.classList.add("is-listening");
      const originalLabel = micBtn.innerHTML;
      const resetLabel = () => { micBtn.classList.remove("is-listening"); micBtn.innerHTML = originalLabel; };
      voiceActive = startVoice({
        categories: ctx.state.categories,
        onTick: (remainingMs) => {
          const s = Math.ceil(remainingMs / 1000);
          micBtn.innerHTML = `<span aria-hidden="true">🎙️</span> ${s}s`;
        },
        onInterim: (t) => {
          if (micStatus) micStatus.textContent = `Hearing: "${t}"`;
        },
        onFinal: (r) => {
          if (r.amount != null) {
            input.value = `${r.note || ""} ${r.amount}`.trim();
          } else if (r.note) {
            input.value = r.note;
          }
          if (r.note) noteInput.value = r.note;
          if (r.paymentMethod && paySelect) {
            paySelect.value = r.paymentMethod;
            paySelect.dispatchEvent(new Event("change", { bubbles: true }));
          }
          if (r.upiApp && upiSelect) {
            upiSelect.value = r.upiApp;
          }
          if (r.categoryId && catSelect) {
            catSelect.value = r.categoryId;
          }
          if (micStatus) {
            const bits = [];
            if (r.amount != null) bits.push(`₹${r.amount}`);
            if (r.note) bits.push(`"${r.note}"`);
            if (r.paymentMethod && r.paymentMethod !== "cash") bits.push(r.paymentMethod.replace("_", " "));
            if (r.upiApp) bits.push(r.upiApp);
            micStatus.textContent = bits.length
              ? `Captured: ${bits.join(" · ")} — hit Add to save.`
              : `Couldn't capture anything from "${r.transcript}".`;
          }
          voiceActive = null;
          resetLabel();
          input.dispatchEvent(new Event("input", { bubbles: true }));
        },
        onError: (err) => {
          if (micStatus) micStatus.textContent = err.message;
          voiceActive = null;
          resetLabel();
        },
        onEnd: () => {
          if (voiceActive) {
            voiceActive = null;
            resetLabel();
          }
        },
      });
    });
  } else if (micBtn) {
    micBtn.style.display = "none";
  }
  const settings = ctx.state.settings;

  input.addEventListener("input", () => {
    const raw = input.value;
    if (!raw.trim()) {
      preview.innerHTML = "";
      return;
    }
    const { amount, note } = parseQuickAdd(raw);
    const settings = ctx.state.settings;
    const catById = new Map(ctx.state.categories.map((c) => [c.id, c]));
    const sugMatch = suggestCategory(note);
    const sug = sugMatch ? catById.get(sugMatch.id) : null;
    const sugChip = sug
      ? `<span class="cat-chip"><span class="cat-swatch" style="background:${sug.color}"></span>${sug.icon ? `<span class="cat-icon" aria-hidden="true">${escapeHtml(sug.icon)}</span>` : ""}${escapeHtml(sug.name)}</span>`
      : "";
    const noteChip = note
      ? `<span class="muted">“${escapeHtml(note)}”</span>`
      : `<span class="muted">(no note)</span>`;
    const amountChip = amount != null
      ? `<strong>${formatCurrency(amount, settings)}</strong>`
      : `<span class="muted">no amount detected</span>`;
    preview.innerHTML = `${amountChip} ${noteChip} ${sugChip}`;
  });

  if (!wrap._quickAddBound) {
    wrap._quickAddBound = true;
    document.addEventListener("expense-tracker:categories-changed", refreshCategoryOptions);
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const raw = input.value;
    const trimmedRaw = (raw || "").trim();

    // Guard: empty / whitespace-only input → nudge the user instead of
    // silently creating a 0-amount expense. The hint text below the
    // input already explains the format ("Coffee 180"); we just make
    // sure the button can't fire on an empty form.
    if (!trimmedRaw) {
      toast("Type a note and amount, e.g. Coffee 180", "info");
      input.focus();
      return;
    }

    const { amount } = parseQuickAdd(raw);
    const explicitNote = (noteInput?.value || "").trim();
    const parsedNote = parseQuickAdd(raw).note;
    const finalNote = explicitNote || parsedNote || raw;

    if (amount == null) {
      const ok = await confirmDialog({
        title: "No amount detected",
        message: `"${raw}" doesn't contain a number. Add it anyway with ${settings.currencySymbol}0?`,
        confirmLabel: "Add anyway",
        cancelLabel: "Keep editing",
      });
      if (!ok) return;
    }

    const sug = suggestCategory(finalNote);
    const fallbackId = ctx.state.categories[0]?.id || "";
    const paymentMethod = (paySelect && paySelect.value) || "cash";
    const upiApp = (upiSelect && paymentMethod === "upi") ? upiSelect.value : "";
    const explicitCat = catSelect && catSelect.value ? catSelect.value : "";
    const expense = {
      amount: amount != null ? amount : 0,
      date: todayISO(),
      time: currentTimeHHMM(),
      categoryId: explicitCat || (sug && sug.id) || fallbackId,
      note: finalNote,
      paymentMethod,
      upiApp,
    };

    if (!expense.categoryId) {
      toast("Add a category first (Categories view)", "error");
      return;
    }

    // Capture the running count BEFORE adding so we can show a
    // "first expense!" hint on the first add of the session.
    const wasFirst = ctx.state.expenses.length === 0;

    Store.addExpense(ctx.state, expense);
    // Save + sync immediately (not waiting for the 500ms debounce) so
    // the toast fires the same instant the expense is on disk. The
    // sync helper is still debounced internally; this just kicks the
    // debounce timer off right now.
    Store.save(ctx.state);
    _syncToServer();

    // Reset the form fields BEFORE re-rendering. Doing this in the
    // wrong order is what made the form feel "broken" — the user
    // would click Add, the page would refresh, and the freshly
    // rebuilt input still had the old value (because the old form was
    // already gone). Clearing inputs explicitly first, then asking the
    // app to re-render, keeps both halves correct.
    input.value = "";
    if (noteInput) noteInput.value = "";
    preview.innerHTML = "";

    const noteTail = explicitNote ? ` · "${explicitNote}"` : "";
    const greeting = wasFirst ? "🎉 First expense logged — nice!" : "Added";
    toast(`${greeting} ${formatCurrency(expense.amount, settings)}${noteTail}`, "success", 3000);

    // Defer the re-render by a microtask so the toast has a chance to
    // paint and the focused element doesn't get clobbered mid-keystroke.
    // The expense is already in state and persisted, so this is purely
    // a UI refresh.
    setTimeout(() => { try { ctx.refresh(); } catch { /* best-effort */ } }, 50);
  });
}

// ─── Recent transactions (modern cards) ───────────────────────────────────
function renderRecent(host, { state, session, navigate }) {
  const currentKey = monthKey(session.currentMonth);
  const recent = state.expenses
    .filter((e) => e.date?.startsWith(currentKey))
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.time || "").localeCompare(a.time || "");
    })
    .slice(0, 6);

  if (recent.length === 0) {
    host.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__title">No transactions yet</div>
        <div class="empty-state__body">Add your first expense to start tracking.</div>
      </div>
    `;
    return;
  }
  const catById = new Map(state.categories.map((c) => [c.id, c]));
  host.innerHTML = `
    <ul class="tx-list" role="list">
      ${recent.map((e) => {
        const cat = catById.get(e.categoryId);
        const method = paymentMethodLabel(e.paymentMethod);
        const app = e.paymentMethod === "upi" && e.upiApp ? " · " + upiAppLabel(e.upiApp) : "";
        return `
          <li class="tx-card">
            <div class="tx-card__icon" aria-hidden="true" style="background:${cat?.color || "var(--color-surface-3)"}20;color:${cat?.color || "var(--color-text-muted)"}">
              ${escapeHtml(cat?.icon || "•")}
            </div>
            <div class="tx-card__body">
              <div class="tx-card__title">${escapeHtml(e.note || cat?.name || "Expense")}</div>
              <div class="tx-card__meta">
                <span>${escapeHtml(cat?.name || "—")}</span>
                <span aria-hidden="true">·</span>
                <span>${escapeHtml(method)}${escapeHtml(app)}</span>
              </div>
            </div>
            <div class="tx-card__amount">${formatCurrency(e.amount, state.settings)}</div>
          </li>
        `;
      }).join("")}
    </ul>
    <div style="margin-top: var(--space-3); text-align: right">
      <a class="btn btn--ghost btn--sm" href="#/expenses">View all →</a>
    </div>
  `;
}

// ─── Budget alerts (KPI card) ────────────────────────────────────────────
// Note: the budget-alert card moved into the KPI grid (see
// renderBudgetAlertKpi). The original inline card in the right column
// has been removed; the popup-on-mount flow has been removed too. The
// KPI cell scrolls internally and floats over-budget categories to the
// top.

// ─── Helpers ──────────────────────────────────────────────────────────────
function sum(expenses) {
  return expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
}

function buildCategoryBreakdown(expenses, categories) {
  const totals = new Map();
  for (const e of expenses) {
    if (!e.categoryId) continue;
    totals.set(e.categoryId, (totals.get(e.categoryId) || 0) + (Number(e.amount) || 0));
  }
  const catById = new Map(categories.map((c) => [c.id, c]));
  const rows = [];
  for (const [id, value] of totals) {
    const cat = catById.get(id);
    if (!cat) continue;
    rows.push({ id, name: cat.name, color: cat.color, icon: cat.icon, value });
  }
  rows.sort((a, b) => b.value - a.value);
  // Bucket anything past the top 7 into "Other" so the chart stays readable.
  if (rows.length > 7) {
    const top = rows.slice(0, 7);
    const otherValue = rows.slice(7).reduce((s, r) => s + r.value, 0);
    top.push({ id: "__other", name: "Other", color: "#94A3B8", icon: "•", value: otherValue });
    return top;
  }
  return rows;
}

/**
 * Compute the user's current "login streak" — the number of consecutive
 * days (counting back from `today`) on which the user signed in. Backed
 * by `state.loginDays` (a list of YYYY-MM-DD strings maintained by the
 * Store on every successful sign-in). Today being absent is tolerated —
 * the cursor starts at yesterday so the streak doesn't reset just because
 * the user hasn't opened the app yet today.
 *
 * The function is intentionally local to the dashboard (the Hero card is
 * the only surface that displays the streak). The Store exposes
 * `Store.computeLoginStreak(state, todayISO)` for the test suite, but
 * the dashboard re-implements the math inline so it can reuse the
 * resolved `state.loginDays` from the surrounding context.
 */
function computeLoginStreak(loginDays, todayIso) {
  if (!Array.isArray(loginDays) || !todayIso) return 0;
  const days = new Set(loginDays);
  const cursor = new Date(`${todayIso}T00:00:00`);
  if (Number.isNaN(cursor.getTime())) return 0;
  if (!days.has(toISODate(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  while (days.has(toISODate(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
