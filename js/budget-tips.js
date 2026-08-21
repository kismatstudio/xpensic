// Rule-based "AI" budget tips.
//
// No LLM here — just deterministic rules over the user's expenses,
// budgets, and history. The tips feel personalised because they're
// computed from real data, not from a canned list.
//
// Each rule returns a tip object:
//   { id, kind: "saving" | "warning" | "suggestion" | "info",
//     title, body, action? }
//
// The Budgets view renders these in a "Smart suggestions" card below
// the main list. They re-compute on every render, so they're always
// up-to-date with the latest expense / budget state.

const DAY_MS = 86_400_000;

function inMonth(date, year, month /* 0-based */) {
  const d = new Date(date);
  return d.getFullYear() === year && d.getMonth() === month;
}

function totalForCategoryInMonth(expenses, categoryId, year, month) {
  let sum = 0;
  for (const e of expenses) {
    if (e.categoryId !== categoryId) continue;
    if (!inMonth(e.date, year, month)) continue;
    sum += Number(e.amount) || 0;
  }
  return sum;
}

function totalInMonth(expenses, year, month) {
  let sum = 0;
  for (const e of expenses) {
    if (!inMonth(e.date, year, month)) continue;
    sum += Number(e.amount) || 0;
  }
  return sum;
}

/**
 * Compute personalized budget tips for the given month.
 *
 * @param {{ categories: Array, expenses: Array, budgets: { monthly: {[monthKey]: {[catId]: number}}} }} state
 * @param {{ month: Date }} ctx — the month being viewed (defaults to "now")
 * @returns {Array<{id, kind, title, body, action?}>}
 */
export function computeBudgetTips(state, ctx = {}) {
  const tips = [];
  const now = ctx.month instanceof Date ? ctx.month : new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;

  const categories = state.categories || [];
  const expenses = state.expenses || [];
  const monthly = state.budgets?.monthly?.[monthKey] || {};

  // --- Rule 1: over-budget categories get a "reduce by X%" suggestion ---
  for (const cat of categories) {
    const budget = Number(monthly[cat.id]) || 0;
    if (budget <= 0) continue;
    const spent = totalForCategoryInMonth(expenses, cat.id, year, month);
    if (spent > budget) {
      const overshoot = spent - budget;
      const targetSpend = Math.round(budget * 0.85);
      const cutBy = Math.round(((spent - targetSpend) / spent) * 100);
      tips.push({
        id: `overshoot-${cat.id}`,
        kind: "warning",
        title: `${cat.name} is over budget`,
        body:
          `You've spent ${fmt(spent)} against a budget of ${fmt(budget)} ` +
          `(over by ${fmt(overshoot)}). Cutting ${cat.name} by ${cutBy}% would ` +
          `save roughly ${fmt(spent - targetSpend)} this month.`,
      });
    }
  }

  // --- Rule 2: "you could save ₹X if Y is reduced by Z%" ---
  // For any category that has a budget and is between 60% and 99% of it,
  // suggest a small reduction that brings spending to 80% of budget.
  for (const cat of categories) {
    const budget = Number(monthly[cat.id]) || 0;
    if (budget <= 0) continue;
    const spent = totalForCategoryInMonth(expenses, cat.id, year, month);
    if (spent >= budget) continue;          // already over, covered above
    if (spent < budget * 0.6) continue;      // still healthy
    const reduceBy = 15; // %
    const targetSpend = spent * (1 - reduceBy / 100);
    const saved = Math.round(spent - targetSpend);
    if (saved < 50) continue;               // noise floor
    tips.push({
      id: `reduce-${cat.id}`,
      kind: "saving",
      title: `Save ~${fmt(saved)}/month`,
      body:
        `If you cut ${cat.name} by ${reduceBy}%, you'd save about ` +
        `${fmt(saved)} per month — ${fmt(saved * 12)} per year. ` +
        `Current pace: ${fmt(spent)} / ${fmt(budget)} budget.`,
    });
  }

  // --- Rule 3: weekend-heavy spending ---
  // If more than 55% of expenses (by count) fall on Sat/Sun in the last
  // 60 days, surface a tip.
  const cutoff = Date.now() - 60 * DAY_MS;
  let weekend = 0;
  let total = 0;
  for (const e of expenses) {
    const t = new Date(e.date).getTime();
    if (!Number.isFinite(t) || t < cutoff) continue;
    const dow = new Date(e.date).getDay();
    if (dow === 0 || dow === 6) weekend++;
    total++;
  }
  if (total >= 10 && weekend / total > 0.55) {
    tips.push({
      id: "weekend-heavy",
      kind: "info",
      title: "Most expenses happen on weekends",
      body:
        `About ${Math.round((weekend / total) * 100)}% of your last ` +
        `60 days of spending was on Sat/Sun. Setting a weekend-only ` +
        `cap could keep things in check without changing weekday habits.`,
    });
  }

  // --- Rule 4: categories with no budget but heavy spending ---
  for (const cat of categories) {
    const spent = totalForCategoryInMonth(expenses, cat.id, year, month);
    if (Number(monthly[cat.id]) > 0) continue;     // already has budget
    if (spent < 1000) continue;                    // noise floor (INR-agnostic)
    tips.push({
      id: `no-budget-${cat.id}`,
      kind: "suggestion",
      title: `Set a ${cat.name} budget`,
      body:
        `${cat.name} is one of your top categories this month ` +
        `(${fmt(spent)}). Try setting a budget to track it explicitly.`,
      action: { kind: "go-budgets", catId: cat.id },
    });
  }

  // --- Rule 5: no budgets at all ---
  const hasAnyBudget = Object.values(monthly).some((v) => Number(v) > 0);
  if (!hasAnyBudget && expenses.length > 0) {
    tips.push({
      id: "no-budgets",
      kind: "info",
      title: "Try setting your first budget",
      body:
        "Budgets help you see warning signs early. Start with one " +
        "category — Food or Transport usually works — and add more later.",
    });
  }

  // --- Rule 6: low total activity ---
  const monthTotal = totalInMonth(expenses, year, month);
  if (monthTotal === 0 && expenses.length > 0) {
    tips.push({
      id: "no-month-spend",
      kind: "info",
      title: "No expenses logged this month",
      body:
        "Looks like a fresh start. Add today's expenses to keep your " +
        "monthly trends accurate.",
    });
  }

  // Cap to 6 tips — too many is worse than too few.
  return tips.slice(0, 6);
}

function fmt(n) {
  // Lightweight formatter: round to integer and add thousands separator.
  // The view's formatCurrency handles the actual symbol/position, but
  // for tip body text we just want a readable number.
  const v = Math.round(Number(n) || 0);
  return "₹" + v.toLocaleString("en-IN");
}

/**
 * Icon for a tip kind. Used by the rendering layer.
 */
export const TIP_KIND_ICON = {
  saving:     "💡",
  warning:    "⚠️",
  suggestion: "✨",
  info:       "ℹ️",
};
