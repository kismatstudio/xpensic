// Formatting helpers: currency, dates, percents.
// All currency formatting is driven by settings (code, symbol, position).

const INDIAN_GROUPING = new Intl.NumberFormat("en-IN");

export function formatCurrency(amount, settings) {
  const value = Number.isFinite(amount) ? amount : 0;
  const num = INDIAN_GROUPING.format(Math.round(value * 100) / 100);
  const symbol = settings?.currencySymbol ?? "₹";
  const position = settings?.currencyPosition ?? "before";
  return position === "after" ? `${num} ${symbol}` : `${symbol}${num}`;
}

export function formatDate(iso, settings) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const fmt = settings?.dateFormat ?? "YYYY-MM-DD";
  if (fmt === "DD/MM/YYYY") {
    return `${pad(d)}/${pad(m)}/${y}`;
  }
  if (fmt === "MM/DD/YYYY") {
    return `${pad(m)}/${pad(d)}/${y}`;
  }
  return `${y}-${pad(m)}-${pad(d)}`;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

// Note: a `formatPercent` helper used to live here. It was removed when a
// project-wide search confirmed nothing imports it. Re-add if a future
// view needs to display a percentage (the budgets view does its own
// integer-percentage math inline).

