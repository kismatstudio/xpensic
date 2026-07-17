// Single source of truth for app data. Everything reads/writes through here.
// Versioned schema; on version mismatch we surface an error rather than silently
// dropping data — the user is in control.

import { newId } from "./ids.js";

const STORAGE_KEY = "expense-tracker:v1";
const SCHEMA_VERSION = 3;

const DEFAULT_CATEGORIES = [
  { id: "cat_food",        name: "Food",           color: "#ef4444", isDefault: true  },
  { id: "cat_transport",   name: "Transport",      color: "#3b82f6", isDefault: true  },
  { id: "cat_housing",     name: "Housing",        color: "#10b981", isDefault: true  },
  { id: "cat_utilities",   name: "Utilities",      color: "#f59e0b", isDefault: true  },
  { id: "cat_entertainment", name: "Entertainment", color: "#a855f7", isDefault: true  },
  { id: "cat_health",      name: "Health",         color: "#06b6d4", isDefault: true  },
  { id: "cat_shopping",    name: "Shopping",       color: "#ec4899", isDefault: true  },
  { id: "cat_other",       name: "Other",          color: "#64748b", isDefault: true  },
];

const DEFAULT_SETTINGS = {
  currency: "INR",
  currencySymbol: "₹",
  currencyPosition: "before",
  dateFormat: "YYYY-MM-DD",
  theme: "system",
};

function freshState() {
  return {
    version: SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    // Profile is filled in by the sign-in / sign-up flow. Until then
    // `phone` and `userId` are empty and the app shows the auth gate.
    // The top-level `profiles` registry lists every account that has
    // ever been created on this device so the "Sign in" tab can match
    // a phone to its userId and profile.
    profile: { userId: "", name: "", phone: "", avatarDataUrl: "" },
    profiles: {},
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    budgets: { monthly: {} },
    expenses: [],
  };
}

function isPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

export function validate(state) {
  if (!isPlainObject(state)) return "Stored data is not an object.";
  if (state.version !== SCHEMA_VERSION) {
    return `Unsupported schema version: ${state.version}. Expected ${SCHEMA_VERSION}.`;
  }
  if (!isPlainObject(state.settings)) return "Settings section is missing.";
  if (!Array.isArray(state.categories)) return "Categories section is missing.";
  if (!Array.isArray(state.expenses)) return "Expenses section is missing.";
  // `profile` and `profiles` are optional in storage (only v3+ have them)
  // so we don't fail here — load() backfills them after validation runs.
  return null;
}

/**
 * Upgrade an older state object to the current schema in-place. We do this
 * before validation so older users don't see a hard error — they get the
 * new fields and the app prompts them to fill in / sign back in.
 */
export function migrate(state) {
  if (!isPlainObject(state)) return state;
  if (state.version === SCHEMA_VERSION) return state;
  // Walk the upgrade chain one step at a time. Each `if` may set
  // `state.version` to the next step's number so the loop falls through
  // into the next migration when several versions are behind.
  if (state.version === 1) {
    state.profile = { userId: "", name: "", phone: "", avatarDataUrl: "" };
    state.profiles = {};
    state.version = 2;
  }
  if (state.version === 2) {
    if (isPlainObject(state.profile) && typeof state.profile.userId !== "string") {
      state.profile.userId = "";
    }
    if (!isPlainObject(state.profiles)) state.profiles = {};
    state.version = 3;
  }
  return state;
}

/**
 * Normalize a single expense record so it always has the latest fields.
 * This lets us add new optional fields (paymentMethod, upiApp, time)
 * without forcing users to wipe their data.
 */
export function normalizeExpense(e) {
  // Phase 3 fields: payment method, UPI app, and optional time-of-day.
  // Defaults keep the form valid (paymentMethod is required, so we mark
  // legacy entries as "cash" since the user could only have entered data
  // through the form before this field existed).
  if (typeof e.paymentMethod !== "string") e.paymentMethod = "cash";
  if (typeof e.upiApp !== "string") e.upiApp = "";
  if (typeof e.time !== "string") e.time = "";
  // If the user used UPI for a legacy record the UPI app will be empty —
  // the form's validator will only require it going forward.
  if (e.paymentMethod !== "upi") e.upiApp = "";
  return e;
}

// --- Public API ---

export const Store = {
  STORAGE_KEY,
  SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  DEFAULT_CATEGORIES,
  normalizeExpense,

  load() {
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return { ok: false, state: freshState(), error: `localStorage unavailable: ${e?.message || e}` };
    }

    if (!raw) {
      const seeded = freshState();
      Store._write(seeded);
      return { ok: true, state: seeded, seeded: true };
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      // Don't delete — surface a clear error so the user can recover.
      return { ok: false, state: freshState(), error: "Stored data is corrupted JSON." };
    }

    // Upgrade older schemas in-place before validating. This way a v1
    // user upgrading to v2 doesn't see a hard error — they get the new
    // `profile` field and the login gate asks them to fill it in.
    migrate(parsed);

    const err = validate(parsed);
    if (err) return { ok: false, state: freshState(), error: err };

    // Forward-migrate any old expense records to the latest shape.
    // `normalizeExpense` only adds defaults; it never deletes data.
    parsed.expenses.forEach(Store.normalizeExpense);

    // Backfill the profile field for users upgrading from v1/v2. Keep the
    // existing settings/categories/expenses/budgets untouched; the user
    // will be prompted to set up their profile on next visit (phone is empty).
    if (!isPlainObject(parsed.profile)) {
      parsed.profile = { userId: "", name: "", phone: "", avatarDataUrl: "" };
    } else {
      if (typeof parsed.profile.userId !== "string") parsed.profile.userId = "";
      if (typeof parsed.profile.name !== "string") parsed.profile.name = "";
      if (typeof parsed.profile.phone !== "string") parsed.profile.phone = "";
      if (typeof parsed.profile.avatarDataUrl !== "string") parsed.profile.avatarDataUrl = "";
    }
    // Profiles registry (v3+). Always a plain object keyed by userId.
    if (!isPlainObject(parsed.profiles)) {
      parsed.profiles = {};
    } else {
      // Drop any non-object entries to keep the registry clean.
      for (const k of Object.keys(parsed.profiles)) {
        if (!isPlainObject(parsed.profiles[k])) delete parsed.profiles[k];
      }
    }

    return { ok: true, state: parsed, seeded: false };
  },

  save(state) {
    return Store._write(state);
  },

  reset() {
    const s = freshState();
    Store._write(s);
    return s;
  },

  _write(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },

  // --- Settings ---
  updateSettings(state, patch) {
    state.settings = { ...state.settings, ...patch };
    return state;
  },

  // --- Profile ---
  // Saves the user's userId, name, and phone. The avatar is regenerated
  // by the caller if it needs to change (we don't recompute it here).
  // All four fields are overwritten on each call — callers that want to
  // preserve a value (e.g. the Edit-Profile flow keeping the same userId)
  // should re-pass it explicitly. Sign-out passes empty strings to clear
  // the active profile (and put the gate back up).
  updateProfile(state, { userId, name, phone, avatarDataUrl } = {}) {
    const prev = state.profile || {};
    state.profile = {
      userId: typeof userId === "string" ? userId : prev.userId || "",
      name: typeof name === "string" ? name : prev.name || "",
      phone: typeof phone === "string" ? phone : prev.phone || "",
      avatarDataUrl:
        typeof avatarDataUrl === "string"
          ? avatarDataUrl
          : prev.avatarDataUrl || "",
    };
    return state.profile;
  },

  // Look up a registered profile by 10-digit phone number.
  // Returns { userId, name, phone, avatarDataUrl } or null. The lookup
  // is O(n) over the registry, which is fine for the in-browser scale
  // (a few entries at most). We compare on the normalized 10-digit form
  // so the user doesn't have to match leading zeros or the +91 prefix.
  findProfileByPhone(state, phone) {
    if (!isPlainObject(state.profiles)) return null;
    const target = String(phone || "").replace(/\D/g, "").slice(-10);
    if (target.length !== 10) return null;
    for (const entry of Object.values(state.profiles)) {
      if (!isPlainObject(entry)) continue;
      const entryPhone = String(entry.phone || "").replace(/\D/g, "").slice(-10);
      if (entryPhone === target) {
        return {
          userId: String(entry.userId || ""),
          name: String(entry.name || ""),
          phone: entryPhone,
          avatarDataUrl: String(entry.avatarDataUrl || ""),
        };
      }
    }
    return null;
  },

  // Register or update a profile in the registry, keyed by userId.
  // Returns the registered entry. Existing entries with the same
  // userId are overwritten; existing entries with the same phone but a
  // different userId are preserved (multi-account on the same device).
  registerProfile(state, { userId, name, phone, avatarDataUrl } = {}) {
    if (!isPlainObject(state.profiles)) state.profiles = {};
    if (!userId || !phone) return null;
    const cleanPhone = String(phone).replace(/\D/g, "").slice(-10);
    if (cleanPhone.length !== 10) return null;
    const entry = {
      userId: String(userId),
      name: String(name || ""),
      phone: cleanPhone,
      avatarDataUrl: String(avatarDataUrl || ""),
    };
    state.profiles[entry.userId] = entry;
    return entry;
  },

  // --- Categories ---
  addCategory(state, { name, color }) {
    const cat = { id: newId("cat"), name: name.trim(), color, isDefault: false };
    state.categories.push(cat);
    return cat;
  },

  updateCategory(state, id, patch) {
    const cat = state.categories.find((c) => c.id === id);
    if (!cat) return null;
    Object.assign(cat, patch);
    return cat;
  },

  deleteCategory(state, id, { reassignTo } = {}) {
    const idx = state.categories.findIndex((c) => c.id === id);
    if (idx === -1) return { ok: false, error: "Category not found." };
    const inUse = state.expenses.some((e) => e.categoryId === id);
    if (inUse && !reassignTo) {
      return { ok: false, error: "Category in use; provide reassignTo." };
    }
    state.categories.splice(idx, 1);
    if (reassignTo) {
      state.expenses.forEach((e) => {
        if (e.categoryId === id) e.categoryId = reassignTo;
      });
    }
    return { ok: true };
  },

  // --- Expenses ---
  addExpense(state, { amount, date, categoryId, note, time, paymentMethod, upiApp, id }) {
    // Persist every input field explicitly so the stored shape is predictable
    // (and round-trip safe through JSON export/import). The `id` is optional:
    // when a caller supplies one (e.g. CSV import) we keep it so re-imports
    // of the same file are idempotent; otherwise we generate a fresh one.
    const exp = {
      id: (typeof id === "string" && id) ? id : newId("exp"),
      amount,
      date,
      categoryId,
      note: note || "",
      // Optional time-of-day, captured automatically by the form's default.
      time: time || "",
      // Payment method is required; upiApp is required only when paymentMethod === "upi".
      paymentMethod: paymentMethod || "cash",
      upiApp: paymentMethod === "upi" ? (upiApp || "") : "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.expenses.push(exp);
    return exp;
  },

  updateExpense(state, id, patch) {
    const exp = state.expenses.find((e) => e.id === id);
    if (!exp) return null;
    Object.assign(exp, patch, { updatedAt: new Date().toISOString() });
    return exp;
  },

  deleteExpense(state, id) {
    const idx = state.expenses.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    state.expenses.splice(idx, 1);
    return true;
  },

  // --- Budgets ---
  setBudget(state, monthKey, categoryId, amount) {
    if (!state.budgets.monthly[monthKey]) state.budgets.monthly[monthKey] = {};
    if (amount == null || amount === "" || Number(amount) === 0) {
      delete state.budgets.monthly[monthKey][categoryId];
    } else {
      state.budgets.monthly[monthKey][categoryId] = Number(amount);
    }
    // Clean up empty month buckets
    if (Object.keys(state.budgets.monthly[monthKey]).length === 0) {
      delete state.budgets.monthly[monthKey];
    }
  },
};
