// Formatting helpers: currency, dates, percents.
// All currency formatting is driven by settings (code, symbol, position).

const INDIAN_GROUPING = new Intl.NumberFormat("en-IN");

// Canonical symbol for each currency code we offer. Switching the code in
// Settings re-derives the symbol from here so the two can never drift —
// previously the symbol input kept whatever the user had before, so
// changing INR → USD still rendered "₹".
//
// Keep this in sync with the currency codes listed in the Settings view
// (js/main.js, `#set-currency`).
const CURRENCY_SYMBOLS = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
};

/** Fallback symbol for an unknown/blank code. */
export const DEFAULT_CURRENCY_SYMBOL = "₹";

/**
 * Canonical symbol for a currency code (case-insensitive). Returns ""
 * when the code is unknown so callers can decide whether to fall back.
 */
export function currencySymbolFor(code) {
  if (typeof code !== "string") return "";
  return CURRENCY_SYMBOLS[code.trim().toUpperCase()] || "";
}

/**
 * Resolve the symbol to display for a settings object. Prefers the
 * canonical symbol for the selected code and falls back to the stored
 * symbol — use this anywhere a raw symbol (rather than a formatted
 * amount) is rendered, so those spots don't drift either.
 */
export function symbolForSettings(settings) {
  return (
    currencySymbolFor(settings?.currency) ||
    settings?.currencySymbol ||
    DEFAULT_CURRENCY_SYMBOL
  );
}

export function formatCurrency(amount, settings) {
  const value = Number.isFinite(amount) ? amount : 0;
  const num = INDIAN_GROUPING.format(Math.round(value * 100) / 100);
  const symbol = symbolForSettings(settings);
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

