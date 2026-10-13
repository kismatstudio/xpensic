// Receipt text → structured expense hints.
//
// Pure functions (no DOM, no network) so they can be unit-tested with
// realistic OCR output. The OCR engine itself lives in views/scan-receipt.js;
// this module only turns the recognised text into:
//
//   • total      — the final payable amount, plus other plausible candidates
//   • date/time  — when the bill was issued (if printed)
//   • merchant   — the shop / restaurant name (first meaningful header line)
//   • items      — "name … price" lines found between header and totals
//   • category   — best default-category id, chosen by scoring the products
//   • payment    — cash / upi / card hints printed on the bill
//
// Receipts are messy and OCR makes mistakes, so everything here returns a
// confidence signal and alternatives; the UI always lets the user confirm
// or correct before anything is saved.

import { CATEGORY_WORDS } from "./categorize.js?v=31";

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

// One money-looking token: optional currency marker, digits with optional
// thousands grouping (1,234 / 1,23,456) and an optional 1–2 digit fraction.
const MONEY_RE = /(?:₹|rs\.?|inr|rupees?)?\s*(\d{1,3}(?:\.\d{3})+,\d{1,2}|\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?!\d)/gi;

/** Fix classic OCR slips inside a token that is mostly digits (O→0, l→1…). */
function fixDigits(token) {
  if (!/\d/.test(token)) return token;
  const letters = token.replace(/[\d.,\s]/g, "");
  if (letters.length > 2) return token;
  return token
    .replace(/[Oo]/g, "0")
    .replace(/[lI|]/g, "1")
    .replace(/S/g, "5")
    .replace(/B/g, "8");
}

/** Normalises "1.250,00" / "1 250.00" style numbers to a JS number. */
function toNumber(raw) {
  let s = String(raw).trim();
  // European style: 1.250,00 → 1250.00
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  // "12,50" (single comma, 1–2 trailing digits) is a decimal comma.
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** All money tokens on one line, left to right: [{ value, text, hasFraction, marked }]. */
export function moneyTokens(line) {
  const out = [];
  const src = fixDigitsInLine(String(line || ""));
  for (const m of src.matchAll(MONEY_RE)) {
    const value = toNumber(m[1]);
    if (value == null) continue;
    const full = m[0];
    out.push({
      value,
      text: m[1],
      hasFraction: /[.,]\d{1,2}$/.test(m[1]) && !/^\d{1,3}(,\d{2,3})+$/.test(m[1]),
      marked: /^(?:₹|rs|inr|rupee)/i.test(full.trim()),
      index: m.index,
    });
  }
  return out;
}

function fixDigitsInLine(line) {
  // Only touch whitespace-separated tokens that already contain digits.
  return line.replace(/\S+/g, (tok) => (/\d/.test(tok) ? fixDigits(tok) : tok));
}

// Lines that carry a number but are NOT the amount to pay.
const NOT_TOTAL_RE = new RegExp(
  [
    "sub\\s*-?\\s*total", "total\\s+(?:qty|quantity|items?|units?|savings?|saved|discount|tax|gst|vat|cgst|sgst|igst|mrp)",
    "you\\s+saved", "savings?", "discount", "\\bdisc\\b", "\\bcgst\\b", "\\bsgst\\b", "\\bigst\\b", "\\bgst\\b", "\\bvat\\b",
    "\\bcess\\b", "service\\s+charge", "\\btax(?:es)?\\b", "round(?:ing)?\\s*off", "\\bchange\\b", "tendered",
    "\\bmrp\\b", "\\bpoints?\\b", "\\bqty\\b", "\\bhsn\\b", "\\bgstin\\b", "\\binvoice\\b", "bill\\s*no", "\\border\\s*(?:no|id)",
    "\\bphone\\b", "\\btel\\b", "\\bmob(?:ile)?\\b", "\\bpin\\s*code\\b", "\\btable\\b", "\\bcashier\\b", "\\btoken\\b",
  ].join("|"),
  "i",
);

// Keyword tiers for "this line holds the final amount". Higher = stronger.
const TOTAL_TIERS = [
  { score: 100, re: /grand\s*total|net\s*(?:amount\s*)?payable|amount\s*payable|total\s*payable|payable\s*amount|net\s*bill\s*amount|amount\s*to\s*pay|total\s*amount\s*(?:due|payable)|bill\s*amount\s*payable/i },
  { score: 90,  re: /total\s*amount|bill\s*total|invoice\s*total|net\s*total|total\s*due|amount\s*due|balance\s*due|net\s*amount|total\s*bill|total\s*value|total\s*invoice\s*value|bill\s*amount|final\s*amount/i },
  { score: 70,  re: /\btotal\b/i },
  { score: 55,  re: /\bamount\b|\bpayable\b|\bdue\b/i },
  { score: 35,  re: /\b(?:paid|cash|card|upi|visa|master\s*card|gpay|phonepe|paytm)\b/i },
];

/**
 * Finds the final payable amount.
 * @returns {{ total: number|null, confidence: "high"|"medium"|"low", candidates: number[] }}
 */
export function findTotal(lines) {
  const cands = [];
  lines.forEach((line, idx) => {
    const toks = moneyTokens(line);
    if (!toks.length) return;
    const excluded = NOT_TOTAL_RE.test(line);
    let tier = null;
    for (const t of TOTAL_TIERS) {
      if (t.re.test(line)) { tier = t; break; }
    }
    if (tier && !excluded) {
      // The amount sits at the right end of a "Total … 123.00" line.
      const tok = toks[toks.length - 1];
      cands.push({ value: tok.value, score: tier.score, idx, kw: true, fraction: tok.hasFraction });
      return;
    }
    // Plain amount lines (item rows, standalone figures) are weak fallbacks.
    // Skip lines that are clearly something else (dates, ids, phone numbers).
    if (excluded) return;
    for (const tok of toks) {
      if (!tok.hasFraction && !tok.marked) continue;      // bare integers are too ambiguous
      if (tok.value >= 10000000) continue;
      cands.push({ value: tok.value, score: 10, idx, kw: false, fraction: tok.hasFraction });
    }
  });

  const valid = cands.filter((c) => c.value > 0 && c.value < 10000000);
  if (!valid.length) return { total: null, confidence: "low", candidates: [] };

  // Best keyword candidate; later lines win ties (totals are at the bottom),
  // then the larger value (grand total ≥ pre-tax total).
  const keyword = valid.filter((c) => c.kw);
  let best;
  let confidence;
  if (keyword.length) {
    best = keyword.reduce((a, b) => {
      if (b.score !== a.score) return b.score > a.score ? b : a;
      if (b.idx !== a.idx) return b.idx > a.idx ? b : a;
      return b.value > a.value ? b : a;
    });
    confidence = best.score >= 90 ? "high" : best.score >= 70 ? "high" : "medium";
    // "Total 450 … Grand Total 472.50": a stronger tier above handles it.
    // But a "Total" line lower than a *larger* weaker candidate is fine too.
  } else {
    // No keyword line at all: use the biggest decimal figure (a bill's total
    // is its largest amount), but flag it as a guess.
    best = valid.reduce((a, b) => (b.value > a.value ? b : a));
    confidence = "low";
  }

  // Alternatives for the UI: other distinct amounts, strongest first. When a
  // total/amount keyword line exists only those are offered — item prices
  // are never the bill total. Without any keyword line the biggest figures
  // are offered instead.
  const seen = new Set([best.value]);
  const alts = [];
  const pool = keyword.length ? keyword : valid;
  [...pool].sort((a, b) => b.score - a.score || b.value - a.value).forEach((c) => {
    if (seen.has(c.value)) return;
    seen.add(c.value);
    alts.push(c.value);
  });
  return { total: best.value, confidence, candidates: alts.slice(0, 4) };
}

// ---------------------------------------------------------------------------
// Date / time
// ---------------------------------------------------------------------------

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

function pad2(n) { return String(n).padStart(2, "0"); }

function isoIfPlausible(y, m, d, now) {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  const max = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const min = new Date(now.getFullYear() - 5, 0, 1);
  if (dt > max || dt < min) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** @returns {{ date: string, time: string }} ISO date and HH:MM ("" when absent). */
export function findDateTime(text, now = new Date()) {
  let date = "";
  const patterns = [
    // 12/03/2024, 12-03-24, 12.03.2024 (Indian bills are day-first)
    [/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g, (m) => isoIfPlausible(+m[3], +m[2], +m[1], now)],
    // 2024-03-12
    [/\b(20\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/g, (m) => isoIfPlausible(+m[1], +m[2], +m[3], now)],
    // 12 Mar 2024, 12-Mar-24, Mar 12, 2024
    [/\b(\d{1,2})[\s\-]*([A-Za-z]{3,9})[\s\-,.]*(\d{2,4})\b/g, (m) => {
      const mo = MONTHS[m[2].slice(0, 4).toLowerCase()] || MONTHS[m[2].slice(0, 3).toLowerCase()];
      return mo ? isoIfPlausible(+m[3], mo, +m[1], now) : null;
    }],
    [/\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/g, (m) => {
      const mo = MONTHS[m[1].slice(0, 4).toLowerCase()] || MONTHS[m[1].slice(0, 3).toLowerCase()];
      return mo ? isoIfPlausible(+m[3], mo, +m[2], now) : null;
    }],
  ];
  outer: for (const [re, conv] of patterns) {
    for (const m of text.matchAll(re)) {
      const iso = conv(m);
      if (iso) { date = iso; break outer; }
    }
  }

  let time = "";
  const tm = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\s*(am|pm)?\b/i);
  if (tm) {
    let h = +tm[1];
    const ap = (tm[3] || "").toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    time = `${pad2(h)}:${tm[2]}`;
  }
  return { date, time };
}

// ---------------------------------------------------------------------------
// Merchant + items
// ---------------------------------------------------------------------------

const HEADER_SKIP_RE = /invoice|tax|gstin|gst\s*no|\bbill\b|receipt|cash\s*memo|welcome|thank|\btel\b|phone|\bmob|date|time|\bno\.?\b|address|www\.|@|^[\W\d_]+$/i;

export function findMerchant(lines) {
  for (const raw of lines.slice(0, 8)) {
    const line = raw.trim();
    const letters = (line.match(/[A-Za-z]/g) || []).length;
    if (letters < 3 || letters / line.length < 0.5) continue;
    if (HEADER_SKIP_RE.test(line)) continue;
    return line.replace(/[^\w&'.,\- ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  }
  return "";
}

/** "Paneer Tikka   2 x 180.00   360.00" → { name, amount }. */
export function findItems(lines) {
  const items = [];
  for (const line of lines) {
    // Skip tax/discount rows, total rows and payment rows ("CASH 701.00").
    if (NOT_TOTAL_RE.test(line) || TOTAL_TIERS.some((t) => t.re.test(line))) continue;
    const toks = moneyTokens(line);
    if (!toks.length) continue;
    const last = toks[toks.length - 1];
    if (!last.hasFraction && !last.marked) continue;
    const name = line.slice(0, toks[0].index)
      .replace(/^[\s\d.\-)\]]+/, "")              // leading serial numbers "1." "2)"
      .replace(/\b\d+\s*[xX×]\s*$/, "")           // trailing "2 x"
      .replace(/\b(?:hsn|sku|code)\s*:?\s*\d+/gi, "")
      .replace(/[^\w&'()/%.,\- ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if ((name.match(/[A-Za-z]/g) || []).length < 3) continue;
    items.push({ name, amount: last.value });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Payment hint
// ---------------------------------------------------------------------------

export function findPayment(text) {
  const t = text.toLowerCase();
  if (/phone\s*pe|phonepe/.test(t)) return { paymentMethod: "upi", upiApp: "phonepe" };
  if (/google\s*pay|gpay/.test(t)) return { paymentMethod: "upi", upiApp: "googlepay" };
  if (/paytm/.test(t)) return { paymentMethod: "upi", upiApp: "paytm" };
  if (/\bupi\b|bhim/.test(t)) return { paymentMethod: "upi", upiApp: "" };
  if (/credit\s*card/.test(t)) return { paymentMethod: "credit_card", upiApp: "" };
  if (/debit\s*card|\bvisa\b|master\s*card|\brupay\b|\bpos\b|card\s*(?:payment|no|number|sale)/.test(t)) {
    return { paymentMethod: "debit_card", upiApp: "" };
  }
  if (/\bcash\b/.test(t)) return { paymentMethod: "cash", upiApp: "" };
  return { paymentMethod: "", upiApp: "" };
}

// ---------------------------------------------------------------------------
// Category from the products
// ---------------------------------------------------------------------------
//
// Each default category has a weighted vocabulary. Product lines score 1 per
// hit, the merchant/header lines score 3 (a shop name says a lot), and a few
// "venue" words score higher (e.g. "KOT", "table", "waiter" ⇒ restaurant).
// The best-scoring category wins; if nothing scores we fall back to "Other".
// Generic words that appear on every bill ("bill", "tax", "total") are not
// in any vocabulary.

// Words that only appear on restaurant bills — they tip a food-vs-grocery tie.
const RESTAURANT_STRONG = /(?:kot|waiter|dine[s-]?in|steward|restaurant|cafe|café|dhaba|biryani|thali)/i;

function wordRegex(word) {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Allow a plural "s" on single words; phrases match as written.
  const plural = /^[a-z]+$/.test(word) ? "s?" : "";
  return new RegExp(`(?:^|[^a-z0-9])${esc}${plural}(?=$|[^a-z0-9])`, "i");
}

const COMPILED = Object.fromEntries(
  Object.entries(CATEGORY_WORDS).map(([id, words]) => [id, words.map((w) => ({ w, re: wordRegex(w) }))]),
);

/**
 * Scores every category against the merchant, header and item lines.
 * @returns {{ categoryId: string, confidence: "high"|"medium"|"low", matched: string[] }}
 */
export function classifyReceipt({ merchant = "", headerLines = [], items = [], lines = [] }) {
  const scores = {};
  const hits = {};
  const add = (id, w, weight) => {
    scores[id] = (scores[id] || 0) + weight;
    (hits[id] = hits[id] || new Set()).add(w);
  };
  const scan = (text, weight) => {
    const t = ` ${String(text).toLowerCase()} `;
    for (const [id, list] of Object.entries(COMPILED)) {
      for (const { w, re } of list) if (re.test(t)) add(id, w, weight);
    }
  };

  scan(merchant, 3);
  headerLines.forEach((l) => scan(l, 1.5));
  items.forEach((it) => scan(it.name, 1));
  // Anything else on the bill (footers, "Dine In", etc.) counts a little.
  const itemText = new Set(items.map((i) => i.name));
  lines.forEach((l) => { if (![...itemText].some((n) => l.includes(n))) scan(l, 0.5); });

  // Restaurant-specific context nudges food above grocery when both hit.
  const full = lines.join("\n");
  if (RESTAURANT_STRONG.test(full)) add("cat_food", "restaurant bill", 2);

  // "hotel" is ambiguous: a restaurant ("Hotel Saravana Bhavan") or lodging.
  // It only counts for travel when room/check-in words are present.
  if (hits.cat_travel && hits.cat_travel.has("hotel") && !/\b(room|check[\s-]?in|lodging|night)\b/i.test(full)) {
    scores.cat_travel -= 1.5;
    hits.cat_travel.delete("hotel");
  }

  let best = "cat_other";
  let top = 0;
  let second = 0;
  for (const [id, s] of Object.entries(scores)) {
    if (s > top) { second = top; top = s; best = id; }
    else if (s > second) second = s;
  }
  if (top < 1.5) return { categoryId: "cat_other", confidence: "low", matched: [] };
  const confidence = top >= 4 && top >= second * 1.5 ? "high" : "medium";
  return { categoryId: best, confidence, matched: [...(hits[best] || [])].slice(0, 6) };
}

// ---------------------------------------------------------------------------
// Everything together
// ---------------------------------------------------------------------------

/**
 * @param {string} ocrText  raw text from the OCR engine
 * @param {Date}   [now]
 */
export function parseReceipt(ocrText, now = new Date()) {
  const lines = String(ocrText || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);

  const { total, confidence: totalConfidence, candidates } = findTotal(lines);
  const { date, time } = findDateTime(lines.join("\n"), now);
  const merchant = findMerchant(lines);
  const items = findItems(lines);
  const payment = findPayment(lines.join("\n"));
  const category = classifyReceipt({ merchant, headerLines: lines.slice(0, 4), items, lines });

  return {
    lines,
    total,
    totalConfidence,
    otherAmounts: candidates,
    date,
    time,
    merchant,
    items,
    payment,
    categoryId: category.categoryId,
    categoryConfidence: category.confidence,
    categoryMatched: category.matched,
  };
}
