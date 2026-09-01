// In-memory source of truth for app data. Encrypted vault persistence is
// handled by js/crypto/vault-sync.mjs; this module never stores user state.

import { newId } from "./ids.js";

const STORAGE_KEY = "expense-tracker:v1";
const SCHEMA_VERSION = 6;

// `icon` is an emoji shown next to the color swatch. Default categories get
// engaging icons; custom categories default to "" (no icon) until the user
// picks one. Stored alongside the rest of the category object and preserved
// across JSON import/export. NOT included in CSV (CSV stays name-only for
// spreadsheet round-trip safety — see CSV_COLUMNS in csv.js).
//
// Order is the order the categories appear in the picker (most-used first
// for the typical Indian personal-finance use case). IDs are stable so
// existing expense rows keep pointing at the same category after upgrades.
const DEFAULT_CATEGORIES = [
  { id: "cat_food",            name: "Food & Dining",           color: "#ef4444", icon: "🍽️", isDefault: true },
  { id: "cat_groceries",       name: "Groceries",               color: "#f97316", icon: "🛒", isDefault: true },
  { id: "cat_housing",         name: "Housing",                 color: "#10b981", icon: "🏠", isDefault: true },
  { id: "cat_utilities",       name: "Utilities",               color: "#f59e0b", icon: "💡", isDefault: true },
  { id: "cat_internet",        name: "Internet & Mobile",       color: "#0ea5e9", icon: "📶", isDefault: true },
  { id: "cat_transport",       name: "Fuel & Transportation",   color: "#3b82f6", icon: "⛽🚖", isDefault: true },
  { id: "cat_health",          name: "Healthcare",              color: "#06b6d4", icon: "🏥", isDefault: true },
  { id: "cat_education",       name: "Education",               color: "#6366f1", icon: "🎓", isDefault: true },
  { id: "cat_shopping",        name: "Shopping",                color: "#ec4899", icon: "🛍️", isDefault: true },
  { id: "cat_entertainment",   name: "Entertainment",           color: "#a855f7", icon: "🎬", isDefault: true },
  { id: "cat_travel",          name: "Travel",                  color: "#14b8a6", icon: "✈️", isDefault: true },
  { id: "cat_gifts",           name: "Gifts",                   color: "#f43f5e", icon: "🎁", isDefault: true },
  { id: "cat_loans",           name: "Loans & Credit",          color: "#8b5cf6", icon: "💳", isDefault: true },
  { id: "cat_investments",     name: "Investments",             color: "#22c55e", icon: "💰", isDefault: true },
  { id: "cat_other",           name: "Other",                   color: "#64748b", icon: "📦", isDefault: true },
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
    profile: { userId: "", name: "", phone: "", avatarDataUrl: "" },
    profiles: {},
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    budgets: { monthly: {} },
    expenses: [],
    splits: [],
    loginDays: [],
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
  return null;
}

export function migrate(state) {
  if (!isPlainObject(state) || state.version === SCHEMA_VERSION) return state;
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
  if (state.version === 3) {
    if (!isPlainObject(state.profiles)) state.profiles = {};
    const ownerId = Object.keys(state.profiles)[0];
    if (ownerId && isPlainObject(state.profiles[ownerId])) {
      state.profiles[ownerId].expenses = Array.isArray(state.expenses) ? state.expenses : [];
      state.profiles[ownerId].budgets = isPlainObject(state.budgets)
        ? state.budgets
        : { monthly: {} };
      state.profiles[ownerId].categories = Array.isArray(state.categories)
        ? state.categories
        : [];
    }
    state.version = 4;
  }
  if (state.version === 4) {
    const iconById = Object.fromEntries(DEFAULT_CATEGORIES.map((c) => [c.id, c.icon || ""]));
    const iconByName = Object.fromEntries(DEFAULT_CATEGORIES.map((c) => [c.name.toLowerCase(), c.icon || ""]));
    const applyIcons = (categories) => {
      for (const category of categories || []) {
        if (typeof category.icon !== "string") {
          category.icon = iconById[category.id] || iconByName[String(category.name || "").toLowerCase()] || "";
        }
      }
    };
    applyIcons(state.categories);
    if (isPlainObject(state.profiles)) {
      for (const entry of Object.values(state.profiles)) {
        if (isPlainObject(entry)) applyIcons(entry.categories);
      }
    }
    state.version = 5;
  }
  if (state.version === 5) {
    const renames = {
      cat_food: "Food & Dining",
      cat_transport: "Fuel & Transportation",
      cat_health: "Healthcare",
    };
    const mergeDefaults = (categories) => {
      const list = Array.isArray(categories) ? categories : [];
      const present = new Set(list.map((category) => category.id));
      for (const category of list) {
        const bare = String(category.id || "").replace(/^cat_/, "");
        if (category.isDefault && renames[category.id] && String(category.name || "").toLowerCase() === bare) {
          category.name = renames[category.id];
        }
      }
      for (const category of DEFAULT_CATEGORIES) {
        if (!present.has(category.id)) list.push({ ...category });
      }
      const order = DEFAULT_CATEGORIES.map((category) => category.id);
      list.sort((a, b) => {
        const ia = order.indexOf(a.id);
        const ib = order.indexOf(b.id);
        if (ia === -1 && ib === -1) return 0;
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });
      return list;
    };
    state.categories = mergeDefaults(state.categories);
    if (isPlainObject(state.profiles)) {
      for (const entry of Object.values(state.profiles)) {
        if (isPlainObject(entry)) entry.categories = mergeDefaults(entry.categories);
      }
    }
    state.version = 6;
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
    return { ok: true, state: freshState(), seeded: true };
  },

  save(state) {
    const result = { ok: true };
    // Notify any registered listener (e.g. main.js wires this to
    // syncToServer) so every view's mutation reaches the server
    // without each call site having to remember to push manually.
    for (const fn of Store._listeners) {
      try { fn(state, result); } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[store] save listener threw:", e?.message || e);
      }
    }
    return result;
  },

  /**
   * Subscribe to every successful `Store.save`. Returns an unsubscribe
   * function. Used by main.js to wire `syncToServer` once at boot.
   */
  onSave(fn) {
    Store._listeners.add(fn);
    return () => Store._listeners.delete(fn);
  },

  _listeners: new Set(),

  reset() {
    return freshState();
  },

  clearPlaintextCache() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      return true;
    } catch {
      return false;
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

  // --- Per-user data isolation ------------------------------------------
  // v4+ stores each profile's expenses / budgets / categories inside the
  // registry entry. The top-level state fields are kept in sync with the
  // active profile (sign-in / sign-out / sign-up keep them aligned) so
  // every view can keep reading `state.expenses` etc. without change.
  //
  // The "active" profile is the one currently signed in. When the auth
  // gate is up, `state.profile.userId` is "" and the helpers are no-ops
  // (the views are hidden anyway).

  /** Make sure a registry entry has the v4 per-user fields. Idempotent. */
  _ensurePerUserFields(entry) {
    if (!isPlainObject(entry)) return;
    if (!Array.isArray(entry.expenses)) entry.expenses = [];
    if (!isPlainObject(entry.budgets)) entry.budgets = { monthly: {} };
    if (!isPlainObject(entry.budgets.monthly)) entry.budgets.monthly = {};
    if (!Array.isArray(entry.categories)) {
      entry.categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
    }
  },

  /**
   * Stash the current top-level expenses / budgets / categories into the
   * registry entry for `userId`. No-op if there's no active profile or
   * the entry doesn't exist (e.g. the user signed out and the registry
   * was cleared).
   */
  snapshotPerUserData(state, userId) {
    if (!userId) return;
    if (!isPlainObject(state.profiles)) state.profiles = {};
    const entry = state.profiles[userId];
    if (!isPlainObject(entry)) return;
    Store._ensurePerUserFields(entry);
    // Deep-clone the top-level arrays/objects so the registry holds its
    // own copy and later mutations to state.* don't leak across users.
    entry.expenses = JSON.parse(JSON.stringify(state.expenses || []));
    entry.budgets = JSON.parse(JSON.stringify(state.budgets || { monthly: {} }));
    // Categories: only stow the user's custom (non-default) categories.
    // Default categories are shared and re-provided by freshState() on
    // every sign-in, so we don't need to copy them per-user.
    entry.categories = (state.categories || [])
      .filter((c) => !c.isDefault)
      .map((c) => ({ ...c }));
  },

  /**
   * Restore the registry entry's per-user fields into the top-level
   * state. Returns true if anything was restored. If the entry has no
   * stored data, the top-level fields are seeded with the default
   * category list and empty expenses / budgets.
   */
  restorePerUserData(state, userId) {
    if (!userId) return false;
    if (!isPlainObject(state.profiles)) state.profiles = {};
    const entry = state.profiles[userId];
    if (!isPlainObject(entry)) return false;
    Store._ensurePerUserFields(entry);

    // Categories: defaults + any custom ones this user added.
    state.categories = [
      ...DEFAULT_CATEGORIES.map((c) => ({ ...c })),
      ...(entry.categories || []).map((c) => ({ ...c })),
    ];
    state.expenses = JSON.parse(JSON.stringify(entry.expenses || []));
    state.budgets = JSON.parse(JSON.stringify(entry.budgets || { monthly: {} }));
    return true;
  },

  /**
   * Initialize a brand-new per-user data set in the registry entry.
   * Used on sign-up so the new profile has its own (empty) state from
   * the start, never inheriting from whoever signed in last.
   */
  initPerUserData(state, userId, { adoptFrom } = {}) {
    if (!userId) return;
    if (!isPlainObject(state.profiles)) state.profiles = {};
    const entry = state.profiles[userId];
    if (!isPlainObject(entry)) return;
    if (adoptFrom) {
      // Adopt whatever is currently in the top-level slots, then wipe
      // them. Used on the very first sign-up so we don't lose whatever
      // data the user created before auth was wired up.
      entry.expenses = JSON.parse(JSON.stringify(state.expenses || []));
      entry.budgets = JSON.parse(JSON.stringify(state.budgets || { monthly: {} }));
      entry.categories = (state.categories || [])
        .filter((c) => !c.isDefault)
        .map((c) => ({ ...c }));
    } else {
      entry.expenses = [];
      entry.budgets = { monthly: {} };
      entry.categories = [];
    }
  },

  /**
   * Reset the top-level data fields to the default "no user signed in"
   * view. Used when the user signs out, so the next sign-in starts from
   * a clean slate.
   */
  clearTopLevelData(state) {
    state.categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
    state.expenses = [];
    state.budgets = { monthly: {} };
  },

  // --- Categories ---
  // `icon` is an optional emoji (defaults to ""). We accept it but don't
  // require it — older callers and CSV imports won't pass one, and that's
  // fine (the UI hides the icon slot when the value is empty).
  addCategory(state, { name, color, icon }) {
    const cat = {
      id: newId("cat"),
      name: name.trim(),
      color,
      icon: typeof icon === "string" ? icon : "",
      isDefault: false,
    };
    state.categories.push(cat);
    return cat;
  },

  /**
   * Look up a category by id and return its emoji icon, or "" if missing.
   * Used by views that render the icon next to a category name.
   */
  getCategoryIcon(state, id) {
    const c = (state.categories || []).find((x) => x.id === id);
    return c && typeof c.icon === "string" ? c.icon : "";
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

  // --- Login-day tracking (used by the dashboard streak) ---
  /**
   * Record today as a login day. Idempotent — calling twice on the same
   * day is a no-op. Returns true if the list was changed (i.e. today
   * wasn't already recorded). The list is deduplicated and sorted
   * ascending so the dashboard's consecutive-day math is straightforward.
   *
   * The caller passes `isoDate` (YYYY-MM-DD) so the function is testable
   * without monkey-patching the system clock. In production we pass
   * `todayISO()` from util.js.
   */
  recordLoginDay(state, isoDate) {
    if (typeof isoDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
      return false;
    }
    if (!Array.isArray(state.loginDays)) state.loginDays = [];
    const set = new Set(state.loginDays);
    const had = set.has(isoDate);
    set.add(isoDate);
    state.loginDays = [...set].sort();
    return !had;
  },

  /**
   * Compute the current login streak — the number of consecutive days
   * (counting back from `todayIso`) on which the user signed in. Useful
   * for tests; the dashboard does the math inline so it can reuse the
   * precomputed `cursor` for the "last 7 days" visualisation.
   */
  computeLoginStreak(state, todayIso) {
    if (!Array.isArray(state.loginDays) || !todayIso) return 0;
    const days = new Set(state.loginDays);
    let cursor = new Date(`${todayIso}T00:00:00`);
    if (Number.isNaN(cursor.getTime())) return 0;
    // Allow today to be missing — start counting from yesterday if so.
    // This matches the previous expense-based behaviour and means the
    // streak doesn't reset just because the user hasn't opened the app
    // yet today.
    if (!days.has(toISODate(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
    }
    let streak = 0;
    while (days.has(toISODate(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  },
};

// Local date helper used by computeLoginStreak. Kept at module scope so
// the function above can share it without polluting the exported surface.
function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
