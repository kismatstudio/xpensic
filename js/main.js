// Entry point: hash-based router + view mounting + month picker + theme + auth.
//
// Auth model (since the backend landed):
//   • On boot, we ask the server `/api/auth/whoami`. If the cookie is
//     valid, we fetch the user's data blob and mount the app shell.
//   • If the server is unreachable or the cookie is missing/invalid, we
//     mount the login gate. The gate signs the user in and hands us a
//     user object; we then fetch the data blob.
//   • Every state mutation that previously called `Store.save(...)` now
//     also pushes to the server via `syncToServer` (debounced 500ms).
//     localStorage is still used as a write-through cache so reloads
//     are instant and the app still works offline against the last
//     known good blob.

import { Store, migrate } from "./store.js";
import { formatCurrency } from "./format.js";
import { initTheme, cycleTheme, getThemePref, setTheme } from "./theme.js";
import { initCursor } from "./cursor.js";
import { renderExpenses as renderExpensesView } from "./views/expenses.js";
import { renderDashboard as renderDashboardView } from "./views/dashboard.js";
import { renderCategories as renderCategoriesView } from "./views/categories.js";
import { renderBudgets as renderBudgetsView } from "./views/budgets.js";
import { renderProfile as renderProfileView } from "./views/profile.js";
import { renderSplits as renderSplitsView } from "./views/splits.js";
import { mountLogin } from "./views/login.js";
import { mountUnlock } from "./views/unlock.js";
import { mountVaultSetup } from "./views/vault-setup.js";
import { exportFullState, parseFullState, mergeState, downloadAsFile, readFileAsText } from "./backup.js";
import { expensesToCSV, csvToExpenses } from "./csv.js";
import { confirmDialog } from "./components/confirm.js";
import { mountKeyboardShortcuts } from "./keyboard.js";
import { openModal } from "./components/modal.js";
import { toast } from "./components/toast.js";
import { buildExpenseForm } from "./views/expense-form.js";
import {
  todayISO, escapeHtml,
  startOfMonth, monthKey, formatMonth,
  formatIndianPhone, generateAvatarDataUrl,
} from "./util.js";
import { Auth, Data, Crypto, apiBase, ApiError, Expenses, Categories, Budgets, Settings, Splits } from "./api.js";
import { getDeviceKey, isAvailable as deviceKeyAvailable, clearDeviceKey as clearLocalDeviceKey, needsReauth, touchLastUnlockAt } from "./crypto/device-key.mjs";
import { unwrapWithDeviceKey, wrapWithDeviceKey, newDeviceKey, getDeviceId } from "./crypto/keystore.mjs";
import { setMasterKey, getMasterKey as readMasterKey } from "./crypto/unlock-gate.mjs";
import { loadVault as loadEncryptedVault } from "./crypto/vault-sync.mjs";

// ---- Route table -----------------------------------------------------------

const ROUTES = {
  profile:    { title: "Profile",    render: renderProfile    },
  dashboard:  { title: "Dashboard",  render: renderDashboard  },
  expenses:   { title: "Expenses",   render: renderExpenses   },
  budgets:    { title: "Budgets",    render: renderBudgets    },
  categories: { title: "Categories", render: renderCategories },
  splits:     { title: "Splits",     render: renderSplits     },
  settings:   { title: "Settings",   render: renderSettings   },
};
const DEFAULT_ROUTE = "dashboard";

// ---- Session state ---------------------------------------------------------
// `state` is the mutable in-memory blob. Views read it directly. Mutations
// flow through Store helpers and trigger `syncToServer` (debounced).
const session = {
  state: null,
  currentMonth: startOfMonth(new Date()),
  firstRun: false,
  serverOnline: true,
};

// ---- Server sync -----------------------------------------------------------
// Smart diff sync: instead of pushing the whole blob on every mutation,
// we diff the current state against `lastKnownServerState` and fire
// per-resource API calls only for what changed.
//
//   • Expense added/edited/deleted → POST/PUT/DELETE /api/expenses/:id
//   • Category added/edited/deleted → POST/PUT/DELETE /api/categories/:id
//   • Budgets changed → PUT /api/budgets (whole-blob replace)
//   • Settings changed → PUT /api/settings (merge patch)
//   • Profile changed → PATCH /api/auth/profile
//   • Split added/edited/deleted   → POST/PUT/DELETE /api/splits/:id
//
// Every `Store.save(...)` from any view automatically fires a sync via
// the listener registered below — callers don't need to remember to
// call syncToServer() themselves.
let syncTimer = null;
let syncPending = false;

// The last server-confirmed state. Initialised after GET /api/data on
// boot and updated after every successful per-resource push. We diff
// against this to know what to send.
let lastKnownServerState = null;

function syncToServer() {
  syncPending = true;
  if (syncTimer) return;
  syncTimer = setTimeout(() => {
    syncTimer = null;
    if (!syncPending) return;
    syncPending = false;
    flushSync();
  }, 500);
}

// Expose syncToServer on window so other views (e.g. the Splits view)
// can force an immediate flush after a mutation instead of waiting
// for the 500ms debounce. Also makes the function visible in dev
// tools for debugging.
if (typeof window !== "undefined") {
  window.syncToServer = syncToServer;
}

// Wire Store.save → syncToServer. Registering once at boot covers every
// view (expenses, budgets, categories, profile, splits, dashboard).
Store.onSave(() => syncToServer());

async function flushSync() {
  if (!session.state || !session.state.profile?.userId) return;
  if (!lastKnownServerState) {
    // Defensive: if for any reason lastKnownServerState is still null
    // (e.g. a race where the user mutated state in the same tick as the
    // unlock snapshot), bootstrap it from an EMPTY baseline so this
    // round's diffs — including any pending Quick Add entries — are
    // pushed immediately. The old behaviour (seed from current state)
    // silently dropped the mutation that triggered this flush, which is
    // exactly the "Quick Add entry never recorded" symptom.
    lastKnownServerState = {
      expenses: [], categories: [], splits: [],
      budgets: { monthly: {} }, settings: {},
    };
  }
  const userId = session.state.profile.userId;
  const diffs = computeDiffs(lastKnownServerState, session.state);
  if (diffs.length === 0) return;
  // eslint-disable-next-line no-console
  console.log("[sync] flushing", diffs.length, "op(s):", diffs.map((o) => o.type).join(", "));
  let allOk = true;
  for (const op of diffs) {
    try {
      await executeOp(userId, op);
    } catch (err) {
      allOk = false;
      // eslint-disable-next-line no-console
      console.warn(`[sync] ${op.type} failed:`, err?.message || err, err?.status);
    }
  }
  if (allOk) {
    // Update the known state to match what we just pushed.
    lastKnownServerState = JSON.parse(JSON.stringify(session.state));
    // Mirror the new state into the encrypted vault so a fresh
    // device can decrypt everything on first unlock. Best-effort —
    // if the vault write fails (vault locked, server down, etc.)
    // the per-resource sync above already kept the server in sync.
    try {
      const { saveVault } = await import("./crypto/vault-sync.mjs");
      await saveVault(session.state);
    } catch (e) {
      console.warn("[sync] vault mirror failed:", e?.message || e);
    }
    setServerOnline(true);
  } else {
    setServerOnline(false, new Error("Some sync operations failed"));
  }
}

/** Alias used by tests + signOut. The per-resource flush above also
 *  mirrors the encrypted vault, so this is the canonical "flush all
 *  pending sync" entry point. */
async function flushVaultSync() {
  return flushSync();
}

/**
 * Compute the list of per-resource operations needed to bring the
 * server from `prev` to `cur`. Returns an array of op descriptors.
 */
function computeDiffs(prev, cur) {
  const ops = [];
  if (!prev || !cur) return ops;

  // --- Expenses ---
  const prevExp = new Map((prev.expenses || []).map((e) => [e.id, e]));
  for (const e of (cur.expenses || [])) {
    const old = prevExp.get(e.id);
    if (!old) {
      ops.push({ type: "expense-create", expense: e });
    } else if (JSON.stringify(old) !== JSON.stringify(e)) {
      ops.push({ type: "expense-update", id: e.id, expense: e });
    }
    prevExp.delete(e.id);
  }
  for (const e of prevExp.values()) {
    ops.push({ type: "expense-delete", id: e.id });
  }

  // --- Categories ---
  const prevCat = new Map((prev.categories || []).map((c) => [c.id, c]));
  for (const c of (cur.categories || [])) {
    const old = prevCat.get(c.id);
    if (!old) {
      ops.push({ type: "category-create", category: c });
    } else if (JSON.stringify(old) !== JSON.stringify(c)) {
      ops.push({ type: "category-update", id: c.id, category: c });
    }
    prevCat.delete(c.id);
  }
  for (const c of prevCat.values()) {
    ops.push({ type: "category-delete", id: c.id });
  }

  // --- Splits ---
  // Splits are stored as self-contained JSON blobs (with userId
  // denormalised onto the row), so we strip that field before
  // comparing so the equality check isn't fooled by transient writes.
  const stripSplit = (s) => {
    if (!s) return s;
    const { userId, ...rest } = s;
    return rest;
  };
  const prevSplits = new Map((prev.splits || []).map((s) => [s.id, stripSplit(s)]));
  for (const s of (cur.splits || [])) {
    const old = prevSplits.get(s.id);
    const next = stripSplit(s);
    if (!old) {
      ops.push({ type: "split-create", split: s });
    } else if (JSON.stringify(old) !== JSON.stringify(next)) {
      ops.push({ type: "split-update", id: s.id, split: s });
    }
    prevSplits.delete(s.id);
  }
  for (const s of prevSplits.values()) {
    ops.push({ type: "split-delete", id: s.id });
  }

  // --- Budgets (whole-blob replace) ---
  if (JSON.stringify(prev.budgets || {}) !== JSON.stringify(cur.budgets || {})) {
    ops.push({ type: "budgets-put", budgets: cur.budgets || { monthly: {} } });
  }

  // --- Settings (merge patch) ---
  const prevSet = prev.settings || {};
  const curSet = cur.settings || {};
  const settingsChanged = Object.keys({ ...prevSet, ...curSet }).some(
    (k) => prevSet[k] !== curSet[k]
  );
  if (settingsChanged) {
    ops.push({ type: "settings-put", patch: { ...curSet } });
  }

  // --- Profile (name / phone / avatar / loginDays) ---
  // loginDays lives at the top level of state (not inside .profile),
  // but it's user-scoped metadata that belongs on the user record.
  // We diff it here so the server stays in sync with the streak
  // counter — without this, the server never learns about new login
  // days and the streak fails to persist across devices.
  const prevProf = prev.profile || {};
  const curProf = cur.profile || {};
  const profilePatch = {};
  for (const k of ["name", "phone", "avatarDataUrl"]) {
    if (prevProf[k] !== curProf[k]) profilePatch[k] = curProf[k];
  }
  const prevDays = JSON.stringify(Array.isArray(prev.loginDays) ? prev.loginDays : []);
  const curDays  = JSON.stringify(Array.isArray(cur.loginDays)  ? cur.loginDays  : []);
  if (prevDays !== curDays) {
    profilePatch.loginDays = Array.isArray(cur.loginDays) ? cur.loginDays : [];
  }
  if (Object.keys(profilePatch).length > 0) {
    ops.push({ type: "profile-patch", patch: profilePatch });
  }

  return ops;
}

async function executeOp(userId, op) {
  switch (op.type) {
    case "expense-create":
      await Expenses.create({ ...op.expense, userId });
      break;
    case "expense-update":
      await Expenses.update(op.id, { ...op.expense, userId });
      break;
    case "expense-delete":
      await Expenses.remove(op.id);
      break;
    case "category-create":
      await Categories.create({ ...op.category, userId });
      break;
    case "category-update":
      await Categories.update(op.id, { ...op.category, userId });
      break;
    case "category-delete":
      await Categories.remove(op.id);
      break;
    case "budgets-put":
      await Budgets.put(op.budgets);
      break;
    case "settings-put":
      await Settings.put(op.patch);
      break;
    case "profile-patch":
      await Auth.updateProfile(op.patch);
      break;
    case "split-create":
      // Splits are stored as a JSON blob that already carries userId /
      // id; we forward everything as-is.
      // eslint-disable-next-line no-console
      console.log("[sync] split-create → POST /api/splits", { id: op.split.id, title: op.split.title });
      await Splits.create({ ...op.split, userId });
      break;
    case "split-update":
      // eslint-disable-next-line no-console
      console.log("[sync] split-update → PUT /api/splits/" + op.id);
      await Splits.update(op.id, { ...op.split, userId });
      break;
    case "split-delete":
      // eslint-disable-next-line no-console
      console.log("[sync] split-delete → DELETE /api/splits/" + op.id);
      await Splits.remove(op.id);
      break;
    default:
      // eslint-disable-next-line no-console
      console.warn("[sync] unknown op type:", op.type);
  }
}

function setServerOnline(online, err) {
  if (session.serverOnline === online) return;
  session.serverOnline = online;
  if (online) {
    toast("Back online — saved to server", "success");
  } else {
    // eslint-disable-next-line no-console
    console.warn("server sync failed:", err);
    toast(
      "Couldn't reach the server (" + (err?.message || "offline") +
        "). Changes saved locally and will retry.",
      "error",
      5000
    );
  }
}

// ---- Date helpers ----------------------------------------------------------

function getRouteFromHash() {
  const raw = (window.location.hash || "").replace(/^#\/?/, "");
  return ROUTES[raw] ? raw : DEFAULT_ROUTE;
}

function setActiveNav(route) {
  document.querySelectorAll(".nav-link").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.route === route);
  });
}

function renderNavProfile() {
  const host = document.getElementById("app-nav-profile");
  if (!host) return;
  const p = session.state.profile || {};
  const avatar = p.avatarDataUrl || generateAvatarDataUrl(p);
  const phoneDisplay = formatIndianPhone(p.phone) || "";
  const name = p.name || "—";
  // The drawer mirrors the top of the Profile screen (avatar + name +
  // phone) with a chevron affordance that links to the Profile view.
  // Sign-out now lives in the nav list (index.html) so the profile card
  // stays clean and focused on identity.
  //
  // The drawer also carries an XPENSIC brand block at the very top of
  // the profile section so the empty space above the user info isn't
  // wasted and the app identity is reinforced on every navigation.
  host.innerHTML = `
    <div class="app-nav__brand">
      <!-- Drawer brand: the full SVG lockup (wordmark included) with a
           light/dark swap. Anchored at the very top of the drawer with
           minimal padding so no space is wasted above the logo. -->
      <img
        class="app-nav__brand-mark app-nav__brand-mark--light"
        src="assets/brand/xpensic-light.png"
        alt="Xpensic"
        width="155"
        height="48"
      />
      <img
        class="app-nav__brand-mark app-nav__brand-mark--dark"
        src="assets/brand/xpensic-dark.png"
        alt="Xpensic"
        width="255"
        height="75"
      />
    </div>
    <div class="app-nav__profile-card">
      <a class="app-nav__profile-link" href="#/profile" data-route="profile">
        <img class="app-nav__profile-avatar" src="${escapeHtml(avatar)}" alt="" />
        <div class="app-nav__profile-id">
          <div class="app-nav__profile-name">${escapeHtml(name)}</div>
          ${phoneDisplay ? `<div class="app-nav__profile-phone">${escapeHtml(phoneDisplay)}</div>` : ""}
        </div>
        <span class="app-nav__profile-chevron" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </span>
      </a>
    </div>
  `;
  host.querySelector(".app-nav__profile-link")?.classList.toggle(
    "is-active",
    getRouteFromHash() === "profile",
  );
}

function render() {
  const route = getRouteFromHash();
  const view = ROUTES[route];
  const container = document.getElementById("view");
  setActiveNav(route);
  renderNavProfile();
  document.title = `${view.title} · XPENSIC`;
  container.innerHTML = "";
  view.render(container);
}

// ---- Theme -----------------------------------------------------------------

const THEME_LABEL = { light: "Light", dark: "Dark", system: "System" };
const THEME_ICON  = { light: "☀", dark: "☾", system: "◐" };
const THEME_CYCLE_ORDER = ["light", "dark", "system"];
const nextTheme = (pref) => THEME_CYCLE_ORDER[(THEME_CYCLE_ORDER.indexOf(pref) + 1) % THEME_CYCLE_ORDER.length];

function updateThemeButton() {
  const pref = getThemePref();
  const btn = document.getElementById("theme-toggle");
  const label = document.getElementById("theme-label");
  const icon = document.getElementById("theme-icon");
  if (label) label.textContent = THEME_LABEL[pref];
  if (icon) icon.textContent = THEME_ICON[pref];
  if (btn) {
    btn.setAttribute("aria-label", `Theme: ${THEME_LABEL[pref]}. Click to switch to ${THEME_LABEL[nextTheme(pref)]}.`);
    btn.setAttribute("title",     `Theme: ${THEME_LABEL[pref]} (click for ${THEME_LABEL[nextTheme(pref)]})`);
    btn.setAttribute("data-theme", pref);
  }
}

// ---- Header mounts ---------------------------------------------------------

function mountMonthPicker() {
  const label = document.getElementById("month-label");
  const prev = document.getElementById("month-prev");
  const next = document.getElementById("month-next");

  // Both the header label AND the active view need to refresh when the
  // month changes (Dashboard KPIs / chart / recent, Expenses filters,
  // Budgets month list). Re-render the view in place so the URL and
  // scroll position are preserved.
  const update = () => {
    label.textContent = formatMonth(session.currentMonth);
    render();
    document.dispatchEvent(
      new CustomEvent("monthchange", { detail: { monthKey: monthKey(session.currentMonth) } }),
    );
  };

  prev.addEventListener("click", () => {
    session.currentMonth = new Date(
      session.currentMonth.getFullYear(),
      session.currentMonth.getMonth() - 1, 1,
    );
    update();
  });

  next.addEventListener("click", () => {
    session.currentMonth = new Date(
      session.currentMonth.getFullYear(),
      session.currentMonth.getMonth() + 1, 1,
    );
    update();
  });

  // Initial label render only — the full `render()` already happened
  // during mountAppShell, so we don't need to re-render the view here.
  label.textContent = formatMonth(session.currentMonth);
}

function mountNavToggle() {
  const btn = document.querySelector(".nav-toggle");
  const nav = document.getElementById("app-nav");
  const scrim = document.getElementById("nav-scrim");
  if (!btn || !nav) return;

  function openDrawer() {
    btn.setAttribute("aria-expanded", "true");
    btn.setAttribute("aria-label", "Close menu");
    nav.classList.add("is-open");
    nav.setAttribute("aria-hidden", "false");
    if (scrim) {
      scrim.hidden = false;
      // Force a reflow so the CSS transition actually animates.
      // eslint-disable-next-line no-unused-expressions
      scrim.offsetHeight;
      scrim.classList.add("is-open");
    }
  }
  function closeDrawer() {
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", "Open menu");
    nav.classList.remove("is-open");
    nav.setAttribute("aria-hidden", "true");
    if (scrim) scrim.classList.remove("is-open");
    if (scrim) setTimeout(() => { scrim.hidden = true; }, 200);
  }

  btn.addEventListener("click", () => {
    const isOpen = btn.getAttribute("aria-expanded") === "true";
    if (isOpen) closeDrawer();
    else openDrawer();
  });

  nav.addEventListener("click", (e) => {
    // Close the drawer whenever the user activates any link, the
    // profile link, a quick action, or the signout button — the nav is
    // a transient surface and shouldn't stay open while the user is
    // being navigated or signed out.
    if (e.target.closest(".nav-link") ||
        e.target.closest(".app-nav__profile-link") ||
        e.target.closest(".app-nav__quick-btn") ||
        e.target.closest(".app-nav__signout")) {
      closeDrawer();
    }
  });

  scrim?.addEventListener("click", closeDrawer);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && btn.getAttribute("aria-expanded") === "true") {
      const t = e.target;
      if (t && (t.matches?.("input, textarea, select") || t.closest?.("[role='dialog']"))) return;
      closeDrawer();
    }
  });
}

// Wire the drawer's quick-action buttons (Add Expense / Create Budget /
// Scan Receipt) and the sign-out button. These live in the static nav
// shell (index.html) so they're mounted once when the app shell mounts.
function mountNavActions() {
  const nav = document.getElementById("app-nav");
  if (!nav) return;

  nav.querySelectorAll(".app-nav__quick-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.quick;
      if (action === "add-expense") {
        openAddExpenseModal();
      } else if (action === "create-budget") {
        window.location.hash = "#/budgets";
      } else if (action === "scan-receipt") {
        toast("Coming Soon", "info");
      }
    });
  });

  const signoutBtn = nav.querySelector("#app-nav-signout");
  if (signoutBtn) {
    signoutBtn.addEventListener("click", () => confirmSignOut());
  }
}

function mountThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    cycleTheme();
    const pref = getThemePref();
    Store.updateSettings(session.state, { theme: pref });
    // Persist via the standard path (localStorage + server).
    Store.save(session.state);
    syncToServer();
    updateThemeButton();
  });
  updateThemeButton();
}

// ---- Views -----------------------------------------------------------------

function renderDashboard(container) {
  renderDashboardView(container, {
    state: session.state,
    session,
    openAddExpenseModal,
    refresh: () => render(),
    // Resolve the LIVE state at call time. `session.state` is replaced
    // (not mutated) by hydrateFromServer()/afterUnlock()/auto-unlock, so
    // a closure that captured `state` at render time can go stale. Quick
    // Add must write to the current object or the entry lands in a
    // detached copy and never shows up in the re-rendered dashboard.
    getState: () => session.state,
  });
}

function renderExpenses(container) {
  renderExpensesView(container, { state: session.state, refresh: () => render() });
}

function renderBudgets(container) {
  renderBudgetsView(container, {
    state: session.state,
    session,
    refresh: () => render(),
  });
}

function renderCategories(container) {
  renderCategoriesView(container, {
    state: session.state,
    refresh: () => render(),
  });
}

function renderSplits(container) {
  renderSplitsView(container, {
    state: session.state,
    refresh: () => render(),
  });
}


function renderProfile(container) {
  renderProfileView(container, {
    state: session.state,
    refresh: () => render(),
    refreshNav: () => renderNavProfile(),
    onSignOut: () => confirmSignOut(),
  });
}

function renderSettings(container) {
  const { state } = session;
  const s = state.settings;

  const wrap = document.createElement("div");
  wrap.innerHTML = `<h1 class="section-title">Settings</h1>`;

  // --- Currency card ------------------------------------------------------
  const currencyCard = document.createElement("div");
  currencyCard.className = "card";
  currencyCard.style.marginBottom = "var(--space-4)";
  currencyCard.innerHTML = `
    <div class="card__title">Currency</div>
    <div class="card__subtitle">Used everywhere amounts are shown.</div>
    <div class="field">
      <label class="field__label" for="set-currency">Currency code</label>
      <select class="field__select" id="set-currency">
        <option value="INR">INR — Indian Rupee (₹)</option>
        <option value="USD">USD — US Dollar ($)</option>
        <option value="EUR">EUR — Euro (€)</option>
        <option value="GBP">GBP — British Pound (£)</option>
        <option value="JPY">JPY — Japanese Yen (¥)</option>
      </select>
    </div>
    <div class="field">
      <label class="field__label" for="set-symbol">Symbol</label>
      <input class="field__input" id="set-symbol" type="text" maxlength="3" />
    </div>
    <div class="field">
      <label class="field__label" for="set-pos">Symbol position</label>
      <select class="field__select" id="set-pos">
        <option value="before">Before amount (₹1,234)</option>
        <option value="after">After amount (1,234 ₹)</option>
      </select>
    </div>
    <div class="field">
      <label class="field__label" for="set-date">Date format</label>
      <select class="field__select" id="set-date">
        <option value="YYYY-MM-DD">YYYY-MM-DD (2026-07-10)</option>
        <option value="DD/MM/YYYY">DD/MM/YYYY (10/07/2026)</option>
        <option value="MM/DD/YYYY">MM/DD/YYYY (07/10/2026)</option>
      </select>
    </div>
    <div style="margin-top:var(--space-3); display:flex; gap:var(--space-2); align-items:center;">
      <span class="muted">Preview:</span>
      <strong id="set-preview" style="font-size:var(--text-md)"></strong>
    </div>
  `;
  wrap.appendChild(currencyCard);

  // --- Theme card ---------------------------------------------------------
  const themeCard = document.createElement("div");
  themeCard.className = "card";
  themeCard.style.marginBottom = "var(--space-4)";
  themeCard.innerHTML = `
    <div class="card__title">Appearance</div>
    <div class="card__subtitle">Choose how the app looks. The header button cycles Light → Dark → System.</div>
    <div class="theme-options" role="radiogroup" aria-label="Theme">
      <button class="theme-options__btn" type="button" role="radio" data-theme="light" aria-checked="false">☀ Light</button>
      <button class="theme-options__btn" type="button" role="radio" data-theme="dark" aria-checked="false">☾ Dark</button>
      <button class="theme-options__btn" type="button" role="radio" data-theme="system" aria-checked="false">◐ System</button>
    </div>
  `;
  wrap.appendChild(themeCard);

  // --- Data card (Phase 8: JSON / CSV import + export) -------------------
  const dataCard = document.createElement("div");
  dataCard.className = "card";
  dataCard.innerHTML = `
    <div class="card__title">Data</div>
    <div class="card__subtitle">
      Back up your data as JSON (full state) or CSV (expenses only, Google
      Sheets / Excel friendly).
    </div>
    <div class="field">
      <label class="field__label" for="data-action">Data actions</label>
      <select class="field__select" id="data-action">
        <option value="">Select action…</option>
        <option value="export-json">Export full backup (JSON)</option>
        <option value="import-json">Import backup (JSON)</option>
        <option value="export-csv">Export for Sheets/Excel (CSV)</option>
        <option value="import-csv">Import CSV</option>
      </select>
      <input type="file" id="data-import-json-input" accept="application/json,.json" hidden />
      <input type="file" id="data-import-csv-input" accept=".csv,text/csv" hidden />
    </div>
  `;
  wrap.appendChild(dataCard);

  // --- Account card -------------------------------------------------------
  const acctCard = document.createElement("div");
  acctCard.className = "card";
  acctCard.style.marginTop = "var(--space-4)";
  acctCard.innerHTML = `
    <div class="card__title">Account</div>
    <div class="card__subtitle">
      Your data lives on the server at <code>${escapeHtml(apiBase)}</code>.
      Sign out to clear this device's local cache.
    </div>
    <div class="field">
      <label class="field__label" for="account-action">Account actions</label>
      <select class="field__select" id="account-action">
        <option value="">Select action…</option>
        <option value="sync">Sync now</option>
        <option value="signout">Sign out</option>
      </select>
    </div>
  `;
  wrap.appendChild(acctCard);

  // --- Danger card (wipe server data) ------------------------------------
  const dangerCard = document.createElement("div");
  dangerCard.className = "card";
  dangerCard.style.marginTop = "var(--space-4)";
  dangerCard.innerHTML = `
    <div class="card__title" style="color:var(--color-danger)">Danger zone</div>
    <div class="card__subtitle">
      Permanently erase your data on the server. This cannot be undone —
      export a backup first if you want to keep anything.
    </div>
    <div class="field">
      <label class="field__label" for="danger-action">Danger actions</label>
      <select class="field__select" id="danger-action">
        <option value="">Select action…</option>
        <option value="erase">Erase all server data</option>
      </select>
    </div>
    <div class="field" style="margin-top:var(--space-2)">
      <label class="field__label" for="danger-confirm">
        Type <strong>ERASE</strong> to confirm
      </label>
      <input class="field__input" id="danger-confirm" type="text" />
      <div class="field__error" id="danger-confirm-error" hidden></div>
    </div>
  `;
  wrap.appendChild(dangerCard);

  container.appendChild(wrap);

  // --- Currency wiring ---------------------------------------------------
  const $currency = currencyCard.querySelector("#set-currency");
  const $symbol = currencyCard.querySelector("#set-symbol");
  const $pos = currencyCard.querySelector("#set-pos");
  const $date = currencyCard.querySelector("#set-date");
  const $preview = currencyCard.querySelector("#set-preview");

  $currency.value = s.currency || "INR";
  $symbol.value = s.currencySymbol || "₹";
  $pos.value = s.currencyPosition || "before";
  $date.value = s.dateFormat || "YYYY-MM-DD";

  const updatePreview = () => {
    const settings = {
      currency: $currency.value,
      currencySymbol: $symbol.value,
      currencyPosition: $pos.value,
      dateFormat: $date.value,
    };
    $preview.textContent = formatCurrency(1234.5, settings);
  };
  updatePreview();

  const persistSettings = () => {
    Store.updateSettings(state, {
      currency: $currency.value,
      currencySymbol: $symbol.value,
      currencyPosition: $pos.value,
      dateFormat: $date.value,
    });
    Store.save(state);
    syncToServer();
    updatePreview();
    render();
  };
  [$currency, $symbol, $pos, $date].forEach((el) => {
    el.addEventListener("change", persistSettings);
  });

  // --- Theme wiring ------------------------------------------------------
  function setThemeActive(theme) {
    themeCard.querySelectorAll(".theme-options__btn").forEach((b) => {
      const active = b.dataset.theme === theme;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-checked", active ? "true" : "false");
    });
  }
  setThemeActive(state.settings?.theme || "system");
  themeCard.querySelectorAll(".theme-options__btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pref = btn.dataset.theme;
      Store.updateSettings(state, { theme: pref });
      setTheme(pref);
      Store.save(state);
      syncToServer();
      setThemeActive(pref);
      updateThemeButton();
      // Don't re-render the whole settings view — that would steal
      // focus from the button we just clicked.
    });
  });

  // --- Data wiring -------------------------------------------------------
  const $dataAction = dataCard.querySelector("#data-action");
  const $importInput = dataCard.querySelector("#data-import-json-input");
  const $importCsvInput = dataCard.querySelector("#data-import-csv-input");

  $dataAction.addEventListener("change", () => {
    const action = $dataAction.value;
    $dataAction.value = "";
    if (action === "export-json") {
      const json = exportFullState(state);
      const filename = `expense-tracker-${todayISO()}.json`;
      downloadAsFile(filename, json, "application/json");
      toast("Backup downloaded", "success");
    } else if (action === "import-json") {
      $importInput.click();
    } else if (action === "export-csv") {
      if (state.expenses.length === 0) {
        toast("No expenses to export", "error");
        return;
      }
      const csv = expensesToCSV(state.expenses, state.categories);
      const filename = `expenses-${todayISO()}.csv`;
      downloadAsFile(filename, csv, "text/csv");
      toast(`Exported ${state.expenses.length} expenses (open in Google Sheets / Excel)`, "success", 4500);
    } else if (action === "import-csv") {
      $importCsvInput.click();
    }
  });

  $importInput.addEventListener("change", async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const result = parseFullState(text);
      if (!result.ok) {
        toast(result.error || "Could not parse JSON.", "error");
        return;
      }
      const ok = await confirmDialog({
        title: "Import backup?",
        message: `Replace your current data with this backup? This will overwrite categories, expenses, and budgets.`,
        confirmLabel: "Replace",
        danger: true,
      });
      if (!ok) return;
      mergeState(state, result.state);
      Store.save(state);
      syncToServer();
      toast("Backup imported", "success");
      render();
    } catch (e) {
      toast("Could not read file: " + (e.message || e), "error");
    } finally {
      ev.target.value = "";
    }
  });

  $importCsvInput.addEventListener("change", async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const result = csvToExpenses(text, state.categories);
      if (!result.ok && result.expenses.length === 0) {
        toast(result.errors[0]?.message || "Could not parse CSV.", "error");
        return;
      }
      if (result.errors.length > 0) {
        const ok = await confirmDialog({
          title: "Some rows had errors",
          message: `${result.expenses.length} rows look good; ${result.errors.length} had errors. Import the good ones anyway?`,
          confirmLabel: "Import good rows",
        });
        if (!ok) return;
      }
      let added = 0;
      result.expenses.forEach((e) => {
        Store.addExpense(state, e);
        added++;
      });
      Store.save(state);
      syncToServer();
      toast(`Imported ${added} expenses`, "success");
      render();
    } catch (e) {
      toast("Could not read file: " + (e.message || e), "error");
    } finally {
      ev.target.value = "";
    }
  });

  // --- Account wiring ----------------------------------------------------
  const $acctAction = acctCard.querySelector("#account-action");
  $acctAction.addEventListener("change", async () => {
    const action = $acctAction.value;
    $acctAction.value = "";
    if (action === "sync") {
      try {
        await flushSync();
        toast("Synced", "success");
      } catch (err) {
        toast("Sync failed: " + (err?.message || "unknown"), "error");
      }
    } else if (action === "signout") {
      confirmSignOut();
    }
  });

  // --- Danger wiring -----------------------------------------------------
  const $confirm = dangerCard.querySelector("#danger-confirm");
  const $err = dangerCard.querySelector("#danger-confirm-error");
  const $dangerAction = dangerCard.querySelector("#danger-action");
  $dangerAction.addEventListener("change", () => {
    const action = $dangerAction.value;
    $dangerAction.value = "";
    if (action === "erase") {
      const ok = $confirm.value.trim() === "ERASE";
      if (!ok) {
        $err.hidden = false;
        $err.textContent = "Type ERASE (uppercase) to confirm.";
        return;
      }
      doErase();
    }
  });
  $confirm.addEventListener("input", () => {
    $err.hidden = true;
    $err.textContent = "";
  });
  async function doErase() {
    try {
      // Erase per-resource: delete all expenses + categories + splits,
      // reset budgets + settings. PUT /api/data is gone, so we fan out.
      const exps = session.state.expenses || [];
      for (const e of exps) {
        try { await Expenses.remove(e.id); } catch { /* ignore */ }
      }
      const cats = (session.state.categories || []).filter((c) => !c.isDefault);
      for (const c of cats) {
        try { await Categories.remove(c.id); } catch { /* ignore */ }
      }
      const splits = session.state.splits || [];
      for (const s of splits) {
        try { await Splits.remove(s.id); } catch { /* ignore */ }
      }
      try { await Budgets.put({ monthly: {} }); } catch { /* ignore */ }
      Store.clearTopLevelData(session.state);
      Store.save(session.state);
      lastKnownServerState = JSON.parse(JSON.stringify(session.state));
      toast("All server data erased", "success");
      render();
    } catch (err) {
      toast("Could not erase: " + (err?.message || "unknown"), "error");
    }
  }
}

// ---- Expense modal (shared by Dashboard + Expenses) ------------------------

function openAddExpenseModal() {
  openExpenseForm({ state: session.state });
}

function openEditExpenseModal(id) {
  const exp = session.state.expenses.find((e) => e.id === id);
  if (!exp) return;
  openExpenseForm({ state: session.state, expense: exp });
}

function openExpenseForm({ state, expense }) {
  const form = buildExpenseForm({
    categories: state.categories,
    expense: expense || null,
  });
  openModal({
    title: expense ? "Edit expense" : "Add expense",
    body: form,
    actions: [
      { label: "Cancel", value: false, kind: "default" },
      { label: expense ? "Save" : "Add", value: true, kind: "primary" },
    ],
    onAction: (value) => {
      if (!value) return true;
      const result = form.readValues();
      if (!result.ok) {
        // Validation errors already rendered inside the form.
        return false;
      }
      if (expense) {
        Store.updateExpense(state, expense.id, result.value);
      } else {
        Store.addExpense(state, result.value);
      }
      Store.save(state);
      syncToServer();
      toast(expense ? "Expense updated" : "Expense added", "success");
      render();
      return true;
    },
  });
}

// ---- Sign out --------------------------------------------------------------

/**
 * Show a confirmation modal before signing out. The user can cancel
 * (default action) or confirm (danger action). We always go through
 * this gate so a stray click on the nav sign-out button doesn't
 * silently wipe the local device key + vault cache.
 */
function confirmSignOut() {
  openModal({
    title: "Sign out of XPENSIC?",
    body: `
      <p style="margin:0 0 var(--space-3) 0;color:var(--color-text-muted);line-height:1.5;">
        You'll need your master password to sign back in on this device.
      </p>
      <p style="margin:0;color:var(--color-text-muted);line-height:1.5;">
        Your data stays safe on the server — signing out only clears this
        browser's local cache and the auto-unlock key.
      </p>
    `,
    actions: [
      { label: "Cancel", value: false, kind: "default" },
      { label: "Sign out", value: true, kind: "danger" },
    ],
    onAction: (value) => {
      if (!value) return true; // close on cancel
      signOut();
      return true;
    },
  });
}

async function signOut() {
  // Flush any pending writes before we lose the session.
  if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; syncPending = false; }
  try { await flushSync(); } catch { /* ignore — we're signing out anyway */ }
  // Wipe the local device key from IndexedDB so the next sign-in
  // on this browser re-prompts for the master password. Without
  // this, signing out and closing the tab would still let anyone
  // with access to this browser auto-unlock the next account that
  // signs in here.
  try { await clearLocalDeviceKey(session.state?.profile?.userId || ""); } catch { /* ignore */ }
  try { await Auth.signout(); } catch { /* even if the server is down, clear locally */ }
  // Clear the active-session flag so any in-flight 401 retries from
  // the just-cleared session don't bounce the user back to a now-
  // meaningless login gate.
  if (typeof window !== "undefined") {
    window.__xpensicCurrentUserId = "";
  }
  // Reset the diff baseline so the next sign-in starts with a fresh
  // snapshot instead of the just-cleared user's data.
  lastKnownServerState = null;
  Store.updateProfile(session.state, { userId: "", name: "", phone: "", avatarDataUrl: "" });
  Store.clearTopLevelData(session.state);
  Store.save(session.state);
  toast("Signed out", "success");
  if (window.location.hash !== "#/dashboard") {
    history.replaceState(null, "", "#/dashboard");
  }
  bootLoginGate();
}

// ---- App shell + boot ------------------------------------------------------

function mountAppShell() {
  document.body.classList.remove("app-locked");
  mountMonthPicker();
  mountNavToggle();
  mountNavActions();
  mountThemeToggle();
  mountKeyboardShortcuts(
    (route) => { window.location.hash = `#/${route}`; },
    {
      openAddExpense: openAddExpenseModal,
      cycleTheme: () => {
        cycleTheme();
        const pref = getThemePref();
        Store.updateSettings(session.state, { theme: pref });
        Store.save(session.state);
        syncToServer();
        updateThemeButton();
      },
    },
  );
  window.addEventListener("hashchange", render);
  render();

  if (session.firstRun) {
    const name = (session.state.profile && session.state.profile.name) || "";
    const greeting = name ? `Welcome, ${name}!` : "Welcome to XPENSIC!";
    toast(greeting, "success", 4000);
    session.firstRun = false;
  }
}

function bootLoginGate() {
  document.body.classList.add("app-locked");
  mountLogin({
    onComplete: ({ user, justSignedUp }) => {
      // Adopt the server's user identity locally. We don't touch
      // any of the user data yet — the E2EE unlock flow is the
      // source of truth, and it loads the encrypted vault next.
      session.state.profile = {
        userId: user.userId,
        name: user.name || "",
        phone: user.phone || "",
        avatarDataUrl: user.avatarDataUrl || "",
      };
      session.firstRun = justSignedUp;
      // Branch on whether the user has any wraps. If they do, send
      // them through the unlock screen (password or recovery phrase).
      // If they don't, this is a brand-new account and we walk them
      // through the vault-setup wizard (pick a master password, opt
      // into a recovery phrase, etc).
      bootUnlockOrSetup({ user, justSignedUp });
    },
  });
}

/**
 * Decide whether the signed-in user has an existing encrypted vault
 * (unlock flow) or needs to set one up (first-time flow). Both
 * flows end with `onUnlocked(state)` which we use to mount the app
 * shell. Decoupled from `bootLoginGate` so the whoami path can
 * reuse it without re-mounting the login gate.
 */
async function bootUnlockOrSetup({ user, justSignedUp }) {
  let wraps = [];
  try {
    // Crypto.getMasterKey normalises the server response into an
    // array of { wrapType, envelope, createdAt } objects. We check
    // Array.isArray directly — unwrapping `res.wraps` here would
    // always be undefined because the API client already did the
    // extraction.
    const res = await Crypto.getMasterKey();
    wraps = Array.isArray(res) ? res : [];
  } catch (err) {
    // The crypto endpoint may not be live (older server, network
    // glitch). Fall through with empty wraps so we either set up
    // a fresh vault or surface a clear error.
    console.warn("[boot] master-key fetch failed:", err?.message || err);
  }

  if (wraps.length === 0) {
    // Brand-new account — walk them through the vault setup wizard.
    // passwordUnlock: true because the user just chose their master
    // password, which counts as an explicit unlock for re-auth timing.
    mountVaultSetup({
      profile: { name: user.name || "", userId: user.userId, phone: user.phone || "", avatarDataUrl: user.avatarDataUrl || "" },
      onComplete: (state) => afterUnlock(state, { justSignedUp, freshVault: true, passwordUnlock: true }).catch(() => {}),
    });
    return;
  }

  // Returning user. Try the silent auto-unlock path first: if we
  // find a device wrap matching this device's IndexedDB-bound key,
  // we can decrypt the vault without re-prompting for the master
  // password. This keeps a page refresh from sending the user back
  // to the unlock screen on every reload.
  const autoUnlocked = await tryDeviceAutoUnlock({ user, wraps });
  if (autoUnlocked) return;

  // Fall through to the manual unlock screen (password / phrase).
  // passwordUnlock: true so afterUnlock resets the 7-day re-auth timer.
  mountUnlock({
    profile: { name: user.name || "", userId: user.userId },
    onUnlocked: (state) => {
      afterUnlock(state, { justSignedUp, passwordUnlock: true }).then(() => {
        // Same rationale as tryDeviceAutoUnlock: pull the live
        // per-resource state from the server so the user immediately
        // sees categories/expenses added from other devices. The
        // vault is the source of truth but can lag by one or two
        // syncs; /api/data is the authoritative read for "what the
        // server currently has." Non-fatal if it fails.
        hydrateFromServer().catch(() => {});
      }).catch(() => {});
    },
  });
}

/**
 * Attempt to silently unlock the vault using this browser's
 * IndexedDB-bound device wrap. Returns true on success (caller
 * should bail out of the unlock flow) and false on any failure
 * (caller should fall back to the manual unlock screen).
 *
 * Failures are silent — we don't want a missing device wrap or a
 * corrupt IndexedDB entry to confuse the user when they could
 * just type their password instead.
 */
async function tryDeviceAutoUnlock({ user, wraps }) {
  try {
    if (!(await deviceKeyAvailable())) return false;
    // Periodic re-auth: if 7 days have passed since the last
    // password-based unlock on this device, skip auto-unlock and
    // fall through to the manual unlock screen. This ensures a
    // stolen device can't silently access the vault indefinitely.
    if (await needsReauth(user.userId)) {
      console.info("[boot] periodic re-auth required — skipping auto-unlock");
      return false;
    }
    const deviceId = getDeviceId();
    const myDeviceWrap = wraps.find(
      (w) => w.wrapType === "device" && w.envelope && w.envelope.deviceId === deviceId,
    );
    if (!myDeviceWrap) return false;
    const deviceKey = await getDeviceKey(user.userId);
    if (!deviceKey) return false;
    let mk;
    try { mk = await unwrapWithDeviceKey(myDeviceWrap.envelope, deviceKey); }
    catch { return false; }
    setMasterKey(mk);
    let state = null;
    try { state = await loadEncryptedVault(); } catch { state = null; }
    if (!state) return false;
    // Adopt the server-side profile so name/avatar are fresh.
    state.profile = {
      ...(state.profile || {}),
      userId: user.userId,
      name: user.displayName || state.profile?.name || "",
      phone: user.phone || state.profile?.phone || "",
      avatarDataUrl: user.avatarDataUrl || state.profile?.avatarDataUrl || "",
    };
    session.state = state;
    // afterUnlock is now async (it awaits ensureDeviceWrap so the
    // device key is in IndexedDB before the user can interact).
    // We don't need to block on it here — the device wrap already
    // exists (that's why auto-unlock succeeded), so ensureDeviceWrap
    // will be a no-op. Fire-and-forget is fine.
    afterUnlock(state, { justSignedUp: false }).catch(() => {});
    // Best-effort: also pull the live per-resource state from the
    // server. The encrypted vault can lag by one or two syncs (the
    // vault mirror is best-effort and runs after the per-resource
    // POSTs succeed). A quick GET /api/data here ensures the
    // dashboard reflects the most recent server-side changes
    // (e.g. categories added from another device) on the next
    // render. Failures are non-fatal — the vault is the source of
    // truth and we already have it loaded.
    hydrateFromServer().catch(() => {});
    return true;
  } catch (err) {
    // Any unexpected error → silent fallback to manual unlock.
    console.warn("[boot] device auto-unlock failed:", err?.message || err);
    return false;
  }
}

/**
 * Promote an unlocked session into a persistent device wrap so the
 * next reload can skip the unlock screen. Called after the user
 * successfully unlocks via password/phrase, or after they create
 * a brand-new vault.
 *
 * Behaviour:
 *   1. Look for an existing device wrap matching this deviceId.
 *      If one is already on the server, leave it alone — the
 *      IndexedDB key was used to unwrap it just now.
 *   2. Otherwise, generate a fresh device key, persist it to
 *      IndexedDB, wrap the MK with it, and upload the wrap to
 *      the server alongside the existing wraps.
 */
async function ensureDeviceWrap({ user, mk, existingWraps }) {
  try {
    if (!(await deviceKeyAvailable())) return;
    const { setDeviceKey } = await import("./crypto/device-key.mjs");
    const deviceId = getDeviceId();
    const hasMine = (existingWraps || []).some(
      (w) => w.wrapType === "device" && w.envelope && w.envelope.deviceId === deviceId,
    );
    if (hasMine) return; // already set up; nothing to do

    // Pull the device key for this user out of IndexedDB. If it
    // doesn't exist yet (first-time setup), generate + persist a
    // fresh one before wrapping.
    let deviceKey = await getDeviceKey(user.userId);
    if (!deviceKey) {
      deviceKey = newDeviceKey();
      await setDeviceKey(user.userId, deviceKey);
    }
    const wrap = await wrapWithDeviceKey(mk, deviceKey, deviceId);
    // Crypto.getMasterKey normalises wraps into { wrapType, envelope, createdAt }
    // shape, but Crypto.putMasterKey sends them to a server that expects each
    // wrap to be a self-contained envelope (ct/nonce/salt at the top level).
    // Flatten existing wraps back to envelope shape before merging with the
    // new device wrap (which is already flat from wrapWithDeviceKey).
    const flatExisting = (existingWraps || [])
      .filter(
        (w) => !(w.wrapType === "device" && w.envelope && w.envelope.deviceId === deviceId),
      )
      .map((w) => (w.envelope && typeof w.envelope === "object") ? w.envelope : w);
    const next = [...flatExisting, wrap];
    await Crypto.putMasterKey(next);
  } catch (err) {
    // Best-effort. If this fails the user can still use the app;
    // they just won't have silent auto-unlock until they sign out
    // and back in (or use a different device).
    console.warn("[boot] ensureDeviceWrap failed:", err?.message || err);
  }
}

/**
 * Common post-unlock path. Hydrates the in-memory state from the
 * vault, records today's login day, persists to localStorage, and
 * mounts the app shell.
 *
 * `passwordUnlock` should be true when the user just entered their
 * vault password (or recovery phrase) manually. It's false for
 * silent auto-unlocks. When true, we stamp `lastUnlockAt` in
 * IndexedDB so the 7-day periodic re-auth window resets.
 */
async function afterUnlock(state, { justSignedUp = false, freshVault = false, passwordUnlock = false } = {}) {
  session.state = state;
  if (!Array.isArray(session.state.loginDays)) session.state.loginDays = [];
  Store.recordLoginDay(session.state, todayISO());
  Store.save(session.state);
  // CRITICAL: diff-sync baseline. Without this, flushSync() exits
  // early and entries never reach the server/vault.
  if (!lastKnownServerState) {
    try { lastKnownServerState = JSON.parse(JSON.stringify(session.state)); }
    catch (e) { console.warn("[boot] baseline snapshot failed:", e?.message || e); }
  }
  if (typeof window !== "undefined") {
    window.__xpensicCurrentUserId = session.state.profile?.userId || "";
  }
  session.firstRun = justSignedUp || freshVault;
  if (freshVault) toast("Your encrypted vault is ready.", "success", 3500);
  // Promote the unlocked session into a persistent device wrap so
  // subsequent reloads can auto-unlock without re-prompting.
  //
  // CRITICAL: this MUST complete before mountAppShell() so the
  // device key is in IndexedDB by the time the user can interact.
  // Previously this was fire-and-forget — if the user reloaded
  // before the async chain finished, the device key was never
  // stored and every subsequent reload re-prompted for the
  // password. Now we await it (with a short timeout so a slow
  // server doesn't block the UI indefinitely).
  try {
    const userId = session.state.profile?.userId;
    const mk = readMasterKeySafe();
    if (userId && mk) {
      const wraps = await Crypto.getMasterKey();
      await ensureDeviceWrap({ user: { userId }, mk, existingWraps: wraps });
    }
  } catch (err) {
    console.warn("[boot] ensureDeviceWrap failed:", err?.message || err);
  }
  if (passwordUnlock) {
    const userId = session.state.profile?.userId;
    if (userId) touchLastUnlockAt(userId).catch(() => {});
  }
  syncToServer();
  mountAppShell();
}

function readMasterKeySafe() {
  try { return readMasterKey(); } catch { return null; }
}

async function hydrateFromServer() {
  try {
    const res = await Data.get();
    // Normalize the server blob to the current schema the client expects.
    // The server already seeds fresh users at SCHEMA_VERSION, but be
    // defensive — older accounts in the DB may be on v5.
    let raw = res.data || {};
    // Backfill required top-level fields before running migration so
    // validate() inside Store doesn't reject the blob.
    if (typeof raw.version !== "number") raw.version = 5;
    if (!Array.isArray(raw.categories)) raw.categories = [];
    if (!Array.isArray(raw.expenses)) raw.expenses = [];
    if (!Array.isArray(raw.splits)) raw.splits = [];
    if (!raw.budgets || typeof raw.budgets !== "object") raw.budgets = { monthly: {} };
    if (!raw.settings || typeof raw.settings !== "object") raw.settings = Store.DEFAULT_SETTINGS;
    if (!isPlainObject(raw.profile)) {
      raw.profile = { userId: "", name: "", phone: "", avatarDataUrl: "" };
    }
    if (!isPlainObject(raw.profiles)) raw.profiles = {};
    // CRITICAL: run the schema migration so v5 server blobs get the new
    // default categories (Food & Dining, Internet & Mobile, Travel, etc.)
    // added on the client side. Without this call the UI keeps showing
    // the old 8-category list because the server returns the user's
    // pre-upgrade blob verbatim.
    raw = migrate(raw);
    // Make sure the profile reflects the signed-in user (the server's
    // blob may not have the latest name/avatar from a recent update).
    raw.profile = {
      ...raw.profile,
      userId: session.state.profile.userId,
      name: session.state.profile.name,
      phone: session.state.profile.phone,
      avatarDataUrl: session.state.profile.avatarDataUrl,
    };

    // CRITICAL: don't clobber local state with stale server data if the
    // user has been making changes since we kicked off this fetch.
    // The original implementation blindly replaced `session.state` with
    // `raw`, which silently dropped any locally-added expense or budget
    // and made the dashboard show only the server's older view. The
    // merge rule is: for each list, take the union by id, preferring
    // the local copy on conflicts (local is fresher — the sync path
    // pushes it up asynchronously). Settings/profile are scalar so
    // we keep local there too.
    //
    // `cur` is captured BEFORE the fetch so we can merge against the
    // exact state that was live when hydration started. Because `cur`
    // holds a reference to the same object as `session.state`, any
    // mutations the user makes while the fetch is in flight (e.g. a
    // Quick Add expense pushed onto `session.state.expenses`) are
    // visible through `cur.expenses` too — the merge below picks them
    // up automatically.
    const cur = session.state;
    const mergeById = (localArr, serverArr) => {
      const out = [];
      const seen = new Set();
      for (const item of localArr || []) {
        out.push(item);
        seen.add(item.id);
      }
      for (const item of serverArr || []) {
        if (item && item.id && !seen.has(item.id)) out.push(item);
      }
      return out;
    };
    session.state = {
      ...raw,
      // Merge lists so any items added locally (not yet pushed to the
      // server at the moment this fetch started) are preserved.
      expenses: mergeById(cur.expenses, raw.expenses),
      categories: mergeById(cur.categories, raw.categories),
      splits: mergeById(cur.splits, raw.splits),
      // Budgets: object keyed by monthKey+categoryId. Local wins on
      // any conflict; server-only months are pulled in.
      budgets: {
        monthly: {
          ...(raw.budgets?.monthly || {}),
          ...(cur.budgets?.monthly || {}),
        },
      },
      // Settings + profile: local wins. The server is the authoritative
      // store, but local changes made after the fetch started have not
      // been pushed yet so we'd otherwise lose them.
      settings: { ...(raw.settings || {}), ...(cur.settings || {}) },
      profile: { ...(raw.profile || {}), ...(cur.profile || {}) },
    };
    Store.save(session.state);
    // Snapshot the hydrated state so the diff sync knows what the server
    // already has — subsequent mutations only push what actually changed.
    //
    // CRITICAL FIX (Quick Add silently lost): this baseline MUST reflect
    // what the SERVER currently holds — NOT the merged session.state.
    // The merge above folds locally-added-but-not-yet-pushed expenses
    // into session.state; snapshotting that made the diff-sync believe
    // the server already had them, so no POST /api/expenses ever fired
    // ("no footprint in dev tools") and the entries vanished on reload.
    // Basing the snapshot on the raw server payload keeps those local
    // items "pending", so the next flushSync() pushes them up.
    lastKnownServerState = JSON.parse(JSON.stringify({
      ...session.state,
      expenses: raw.expenses || [],
      categories: raw.categories || [],
      splits: raw.splits || [],
      budgets: { monthly: { ...(raw.budgets?.monthly || {}) } },
      settings: { ...(raw.settings || {}) },
    }));
    setServerOnline(true);
  } catch (err) {
    setServerOnline(false, err);
    throw err;
  }
}

// Tiny inline polyfill of isPlainObject so we don't have to import the
// store module just for one helper. Keeps `migrate` happy.
function isPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

// ---- Bootstrap -------------------------------------------------------------

async function init() {
  // Boot the theme immediately so the page doesn't flash white.
  initTheme();

  // Boot the custom cursor (fine-pointer devices only). Adds a small
  // black dot + smooth trailing ring that scales on hoverable elements.
  initCursor();

  // Session-expired watchdog. When the API layer detects that both the
  // access token AND the refresh token are dead (server restart, manual
  // sign-out on another device, etc), it dispatches this event. We
  // flush any pending local writes, clear the profile, and bounce the
  // user back to the login gate with a clear toast. Without this, the
  // user is stranded on the dashboard with a 401 storm in the console
  // and no UI affordance to recover.
  //
  // SAFETY: only fire when we've successfully signed in (a real
  // userId is loaded into session.state). On boot, init() calls
  // Auth.whoami() before the unlock flow completes — if that whoami
  // 401s (stale cookie, in-memory refresh store cleared on server
  // restart, etc) the event would otherwise bounce the user to the
  // login gate even though they're already authenticated and the
  // unlock screen is about to handle the situation. Guarding on the
  // userId makes this a true "mid-session expiration" handler.
  window.addEventListener("xpensic:session-expired", () => {
    if (!session.state?.profile?.userId) return; // not yet signed in
    if (document.body.classList.contains("app-locked")) return; // gate already up
    toast("Your session expired — please sign in again.", "info", 5000);
    // Persist any local state the user added offline so it's not lost.
    try { Store.save(session.state); } catch { /* ignore */ }
    Store.updateProfile(session.state, { userId: "", name: "", phone: "", avatarDataUrl: "" });
    bootLoginGate();
  });

  // Seed an in-memory state from localStorage as a cache / offline fallback.
  const cache = Store.load();
  session.state = cache.state;
  if (!cache.ok) {
    console.warn("Store load issue:", cache.error);
  }

  // Ask the server if we're already signed in (cookie-based session).
  try {
    const me = await Auth.whoami();
    if (me?.user) {
      // Returning user. We need to unwrap their master key from
      // one of their stored wraps (password or recovery phrase)
      // before we can decrypt the vault. Hand off to the same
      // unlock / setup flow that fresh sign-ins use.
      session.state.profile = {
        userId: me.user.userId,
        name: me.user.displayName || "",
        phone: me.user.phone || "",
        avatarDataUrl: me.user.avatarDataUrl || session.state.profile.avatarDataUrl,
      };
      // Mark the window so api.js knows the session is alive even
      // before unlock completes (e.g. for any mid-unlock reloads
      // racing the cookie expiry).
      if (typeof window !== "undefined") {
        window.__xpensicCurrentUserId = me.user.userId || "";
      }
      bootUnlockOrSetup({ user: { ...me.user, name: me.user.displayName || "" }, justSignedUp: false });
      return;
    }
  } catch (err) {
    // Server unreachable or cookie missing — either way, gate the app.
    // eslint-disable-next-line no-console
    console.warn("whoami failed:", err);
    if (err instanceof ApiError && err.status === 0) {
      toast(
        "Can't reach the server at " + apiBase + ". Start it with `cd server && npm start`.",
        "error",
        6000
      );
    }
  }

  if (session.state.settings?.theme) setTheme(session.state.settings.theme);
  updateThemeButton();
  bootLoginGate();
}

window.addEventListener("DOMContentLoaded", init);
