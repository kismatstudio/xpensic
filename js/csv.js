// CSV import/export for expenses.
//
// Why a tiny custom parser instead of a library? Our CSV is small and the
// columns are fixed, so a hand-rolled parser keeps the bundle at zero
// dependencies. We follow RFC 4180:
//   • Fields are comma-separated
//   • Fields containing commas, quotes, or newlines are wrapped in double
//     quotes
//   • Double quotes inside quoted fields are escaped by doubling them
//
// The writer always quotes fields that contain any of: , " \n \r.
// The parser detects that on read, so hand-edited CSVs work too.

import { validateAmount } from "./validators.js";
import { paymentMethodLabel, upiAppLabel } from "./util.js";

/** Column order used for both export and import. Keep these in sync. */
export const CSV_COLUMNS = [
  "id",
  "date",
  "time",
  "amount",
  "category",
  "paymentMethod",
  "upiApp",
  "note",
];

/**
 * Convert a list of expenses to a CSV string.
 * @param {Array} expenses
 * @param {Array} categories — used to resolve category IDs to names
 * @returns {string}
 */
export function expensesToCSV(expenses, categories) {
  const catById = new Map(categories.map((c) => [c.id, c]));
  const lines = [CSV_COLUMNS.join(",")];
  for (const e of expenses) {
    const cat = catById.get(e.categoryId);
    const row = [
      e.id || "",
      e.date || "",
      e.time || "",
      // Amount is stored as a number; write it without thousands separators
      // so the parser can read it back cleanly.
      e.amount != null ? String(e.amount) : "",
      cat ? cat.name : "",
      e.paymentMethod || "",
      e.upiApp || "",
      e.note || "",
    ];
    lines.push(row.map(quote).join(","));
  }
  // Trailing newline so the file ends cleanly (POSIX-friendly).
  return lines.join("\n") + "\n";
}

/** Quote a CSV field if it contains any of: , " \n \r. */
function quote(v) {
  const s = v == null ? "" : String(v);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Parse a CSV string into expense records.
 * Returns { ok, expenses, errors }. Each row produces a partial expense
 * with whatever fields parsed cleanly, plus a `_row` line number so the
 * caller can show useful error messages.
 *
 * The parser is forgiving: it never throws on a bad row. It collects
 * errors and skips the row, but keeps the rest.
 *
 * @param {string} text
 * @param {Array} categories — used to resolve category names to IDs
 * @returns {{ ok: boolean, expenses: Array, errors: Array<{line:number, message:string}> }}
 */
export function csvToExpenses(text, categories) {
  const rows = parseCSVRows(text);
  if (rows.length === 0) {
    return { ok: false, expenses: [], errors: [{ line: 0, message: "CSV is empty." }] };
  }
  const header = rows[0].map((c) => c.trim());
  // Build a column→index map. Unknown columns are ignored on import; known
  // columns are required (well, at least `date` and `amount`).
  const idx = {};
  for (const col of CSV_COLUMNS) {
    const i = header.indexOf(col);
    if (i >= 0) idx[col] = i;
  }
  if (idx.date == null || idx.amount == null) {
    return {
      ok: false,
      expenses: [],
      errors: [{ line: 1, message: "CSV is missing required columns (date, amount)." }],
    };
  }

  const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  const expenses = [];
  const errors = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    // Skip completely empty trailing lines.
    if (row.length === 0 || (row.length === 1 && row[0] === "")) continue;
    const get = (col) => (idx[col] != null ? (row[idx[col]] || "").trim() : "");

    const amountRaw = get("amount");
    const amt = validateAmount(amountRaw);
    if (!amt.ok) {
      errors.push({ line: r + 1, message: `Row ${r + 1}: invalid amount "${amountRaw}".` });
      continue;
    }
    const date = get("date");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push({ line: r + 1, message: `Row ${r + 1}: invalid date "${date}".` });
      continue;
    }
    const catName = get("category").toLowerCase();
    const cat = catByName.get(catName);
    if (!cat) {
      errors.push({ line: r + 1, message: `Row ${r + 1}: unknown category "${get("category")}".` });
      continue;
    }

    expenses.push({
      // Preserve the id from the file so a re-import of the same CSV is
      // idempotent (the Settings view dedupes on this id and skips rows
      // it already has). When the row has no id we let Store.addExpense
      // generate a fresh one.
      id: get("id") || undefined,
      date,
      time: get("time") || "",
      amount: amt.value,
      categoryId: cat.id,
      paymentMethod: get("paymentMethod") || "cash",
      upiApp: get("upiApp") || "",
      note: get("note") || "",
    });
  }

  return { ok: errors.length === 0, expenses, errors };
}

// --- Tiny RFC 4180 parser -------------------------------------------------

/**
 * Parse a CSV string into a 2D array of strings.
 * Handles quoted fields, escaped quotes (""), and embedded newlines.
 */
function parseCSVRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  const len = text.length;

  while (i < len) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          // Escaped quote inside a quoted field.
          field += '"';
          i += 2;
        } else {
          // End of the quoted field.
          inQuotes = false;
          i++;
        }
      } else {
        // Any character (including commas and newlines) is literal inside quotes.
        field += c;
        i++;
      }
    } else {
      if (c === '"') {
        // Opening quote — but only if it's the first character of the field.
        // A stray quote mid-field is treated as literal to be forgiving.
        if (field === "") {
          inQuotes = true;
          i++;
        } else {
          field += c;
          i++;
        }
      } else if (c === ",") {
        row.push(field);
        field = "";
        i++;
      } else if (c === "\r") {
        // Handle CRLF by ignoring the CR and letting the LF terminate the row.
        if (text[i + 1] === "\n") i++;
        else {
          row.push(field);
          rows.push(row);
          row = [];
          field = "";
          i++;
        }
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        i++;
      } else {
        field += c;
        i++;
      }
    }
  }
  // Flush the last field/row.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
