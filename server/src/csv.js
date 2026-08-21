// RFC 4180-ish CSV parser and writer. Plain UTF-8 (no BOM), LF line
// endings, double-quote quoting with `""` as the escape. We don't need
// any of Excel's quirks — the goal is a stable, diff-friendly on-disk
// format that's still easy to open in a spreadsheet tool.
//
// Header handling: writers always emit a header row. Readers require a
// header row and return an array of objects keyed by header name.
// Type coercion is the caller's responsibility — values are strings
// unless you parse them yourself. This matches how the rest of the
// server treats user input (the auth route does its own validation).

/**
 * Parse a CSV string into an array of records (objects keyed by header).
 * Empty input returns []. The first non-empty line is treated as the
 * header; subsequent lines are data rows.
 *
 * @param {string} text
 * @returns {Array<Record<string, string>>}
 */
export function parseCsv(text) {
  const records = [];
  if (!text) return records;
  const rows = splitCsvRows(text);
  if (rows.length === 0) return records;
  const header = rows[0].map((h) => h.trim());
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    // Skip fully-blank lines (a trailing newline produces one).
    if (row.length === 1 && row[0] === "") continue;
    const record = {};
    for (let c = 0; c < header.length; c++) {
      record[header[c]] = row[c] === undefined ? "" : row[c];
    }
    records.push(record);
  }
  return records;
}

/**
 * Serialise an array of records to a CSV string. If `records` is empty
 * the result is just the header line (so the file is never empty).
 *
 * @param {string[]} header   ordered list of column names
 * @param {Array<Record<string, any>>} records
 * @returns {string}
 */
export function writeCsv(header, records) {
  const lines = [header.map(escapeCell).join(",")];
  for (const rec of records) {
    lines.push(header.map((h) => escapeCell(rec?.[h])).join(","));
  }
  return lines.join("\n") + "\n";
}

/** Escape a single CSV cell. Wraps in quotes when needed; doubles quotes. */
function escapeCell(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s === "") return "";
  // Quote if the value contains a comma, newline, CR, or a quote.
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Tokenise CSV text into rows of cells. Handles quoted cells that
 * contain commas / newlines / escaped quotes. Returns rows as arrays
 * of un-escaped strings.
 *
 * @param {string} text
 * @returns {string[][]}
 */
function splitCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (ch === "\r") {
      // Eat CR (handle CRLF); the LF will close the row.
      continue;
    }
    cell += ch;
  }
  // Flush the last cell/row if the file doesn't end with a newline.
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}