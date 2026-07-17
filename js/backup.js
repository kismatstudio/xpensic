// JSON backup / restore — full-state export/import.
//
// The full state is just the same shape the store uses:
//   { version, settings, categories, budgets, expenses }
//
// On import we migrate older schemas in place (so a v1 backup from before
// the login gate is still importable), then re-validate and hand the
// parsed state back to the caller. The caller decides whether to merge
// or replace. We never write directly to localStorage here — keep side
// effects in the caller (main.js / settings view).

import { migrate, validate, normalizeExpense } from "./store.js";

export function exportFullState(state) {
  // Stringify with 2-space indent so the file is human-readable and
  // diff-friendly (useful for users who commit their backup to a repo).
  return JSON.stringify(state, null, 2);
}

/**
 * Parse a full-state JSON string.
 * @returns {{ ok: true, state } | { ok: false, error: string }}
 */
export function parseFullState(text) {
  if (!text || !text.trim()) {
    return { ok: false, error: "File is empty." };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: "Not valid JSON: " + (e.message || String(e)) };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Top-level value must be a JSON object." };
  }
  // Migrate older schemas in place (e.g. v1 → v2 adds the profile field).
  // `migrate` is a no-op when the backup is already at the current version,
  // so v2 backups (the only thing the app currently exports) pass through
  // unchanged. Future versions that go *backwards* on disk would be left
  // alone here; `validate` below then rejects them with a clear error.
  migrate(parsed);

  // Reject anything we don't understand, or anything missing a required
  // section. `validate` returns `null` on success and an error string
  // otherwise — same shape the live store uses, so the messages stay
  // consistent.
  const err = validate(parsed);
  if (err) return { ok: false, error: err };

  if (!parsed.budgets || typeof parsed.budgets !== "object") {
    parsed.budgets = { monthly: {} };
  }
  if (!parsed.budgets.monthly || typeof parsed.budgets.monthly !== "object") {
    parsed.budgets.monthly = {};
  }
  // Same forward-migration the live store runs: backfill any new fields
  // (paymentMethod, upiApp, time) on legacy expense records so they pass
  // the form's validation if the user later edits them.
  if (Array.isArray(parsed.expenses)) {
    parsed.expenses.forEach(normalizeExpense);
  }
  return { ok: true, state: parsed };
}

/**
 * Merge an imported state into an existing state.
 *
 * - Categories: keep the local set; add any from the backup that don't
 *   share an id. (User's customizations win.)
 * - Expenses: keep the local set; add any from the backup whose id
 *   doesn't already exist locally. (No duplicates.)
 * - Budgets: per-month, per-category. Local budgets win on conflict.
 * - Settings: keep the local ones.
 */
export function mergeState(local, incoming) {
  const merged = {
    version: local.version,
    settings: { ...local.settings },
    categories: local.categories.slice(),
    budgets: { monthly: { ...local.budgets.monthly } },
    expenses: local.expenses.slice(),
  };

  // Categories: dedupe by id.
  const localCatIds = new Set(merged.categories.map((c) => c.id));
  for (const c of incoming.categories) {
    if (!localCatIds.has(c.id)) {
      merged.categories.push(c);
      localCatIds.add(c.id);
    }
  }

  // Expenses: dedupe by id.
  const localExpIds = new Set(merged.expenses.map((e) => e.id));
  for (const e of incoming.expenses) {
    if (!localExpIds.has(e.id)) {
      merged.expenses.push(e);
      localExpIds.add(e.id);
    }
  }

  // Budgets: merge per-month, per-category. Local values win.
  for (const [monthKey, byCat] of Object.entries(incoming.budgets?.monthly || {})) {
    if (!merged.budgets.monthly[monthKey]) merged.budgets.monthly[monthKey] = {};
    for (const [catId, amount] of Object.entries(byCat)) {
      if (merged.budgets.monthly[monthKey][catId] == null) {
        merged.budgets.monthly[monthKey][catId] = amount;
      }
    }
  }

  return merged;
}

/** Helper: download a string as a file in the browser. */
export function downloadAsFile(filename, content, mime = "application/octet-stream") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before revoking the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Helper: read a File (from <input type="file">) as text. */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("Could not read file."));
    r.readAsText(file);
  });
}
