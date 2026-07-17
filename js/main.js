// Entry point: hash-based router + view mounting + month picker + theme + store.
// Phase 1: data layer (store) is wired; Settings has real controls for currency + theme.
// Phase 2: expense CRUD — Add/Edit modal + Expenses list view + Dashboard "Add" button.

import { Store } from "./store.js";
import { formatCurrency } from "./format.js";
import { initTheme, cycleTheme, getThemePref, setTheme } from "./theme.js";
import { renderExpenses as renderExpensesView } from "./views/expenses.js";
import { renderDashboard as renderDashboardView } from "./views/dashboard.js";
import { renderCategories as renderCategoriesView } from "./views/categories.js";
import { renderBudgets as renderBudgetsView } from "./views/budgets.js";
import { renderProfile as renderProfileView } from "./views/profile.js";
import { mountLogin } from "./views/login.js";
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

// ---- Route table -----------------------------------------------------------
// Each route maps to a title (for the document title) and a render function.
const ROUTES = {
  profile:    { title: "Profile",    render: renderProfile    },
  dashboard:  { title: "Dashboard",  render: renderDashboard  },
  expenses:   { title: "Expenses",   render: renderExpenses   },
  budgets:    { title: "Budgets",    render: renderBudgets    },
  categories: { title: "Categories", render: renderCategories },
  settings:   { title: "Settings",   render: renderSettings   },
};
const DEFAULT_ROUTE = "dashboard";

// ---- Session state ---------------------------------------------------------
// `state` is the mutable store object — views read it directly and call Store
// helpers to mutate. Keeping it here (rather than in localStorage on every read)
// makes the views fast and lets us re-render selectively.
const session = {
  storeResult: null,
  state: null,
  currentMonth: startOfMonth(new Date()),
};

// ---- Date helpers ----------------------------------------------------------
// (startOfMonth, formatMonth, monthKey all live in util.js — imported above.)

// Pull the route name out of the URL hash, falling back to the default route.
function getRouteFromHash() {
  const raw = (window.location.hash || "").replace(/^#\/?/, "");
  return ROUTES[raw] ? raw : DEFAULT_ROUTE;
}

// Highlight the active link in the sidebar/top-tab nav.
function setActiveNav(route) {
  document.querySelectorAll(".nav-link").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.route === route);
  });
}

// Renders the profile section at the top of the nav drawer (avatar + name
// + phone). Cheap; called on boot and after the profile is edited.
function renderNavProfile() {
  const host = document.getElementById("app-nav-profile");
  if (!host) return;
  const p = session.state.profile || {};
  const avatar = p.avatarDataUrl || generateAvatarDataUrl(p);
  const phoneDisplay = formatIndianPhone(p.phone) || "";
  const name = p.name || "—";
  host.innerHTML = `
    <a class="app-nav__profile-link" href="#/profile" data-route="profile">
      <img class="app-nav__profile-avatar" src="${escapeHtml(avatar)}" alt="" />
      <div class="app-nav__profile-id">
        <div class="app-nav__profile-name">${escapeHtml(name)}</div>
        ${phoneDisplay ? `<div class="app-nav__profile-phone">${escapeHtml(phoneDisplay)}</div>` : ""}
      </div>
    </a>
  `;
  host.querySelector(".app-nav__profile-link")?.classList.toggle(
    "is-active",
    getRouteFromHash() === "profile",
  );
}

// Clear the view container and re-render the current route.
function render() {
  const route = getRouteFromHash();
  const view = ROUTES[route];
  const container = document.getElementById("view");
  setActiveNav(route);
  renderNavProfile();
  document.title = `${view.title} · Expense Tracker`;
  container.innerHTML = "";
  view.render(container);
}

// ---- Theme button (Light / Dark / System cycle) ---------------------------

const THEME_LABEL = { light: "Light", dark: "Dark", system: "System" };
const THEME_ICON  = { light: "☀", dark: "☾", system: "◐" };
// Click order: light → dark → system → light. We use this to tell the
// user (via aria-label) what the next click will do, so screen-reader
// users can predict the result without trial and error.
const THEME_CYCLE_ORDER = ["light", "dark", "system"];
const nextTheme = (pref) => THEME_CYCLE_ORDER[(THEME_CYCLE_ORDER.indexOf(pref) + 1) % THEME_CYCLE_ORDER.length];

// Sync the header button's label/icon/aria with the current preference.
// The button is a 3-state cycle, so aria-pressed (binary) doesn't fit;
// instead we name the current state in the aria-label and say what the
// next click will do. We also mirror the active state as a data-theme
// attribute so CSS can react to it (e.g. for an outline on the active
// theme's icon).
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

// Month picker: ‹ / › buttons. Emits a `monthchange` event so other views
// (Dashboard, future charts) can react without a global pub/sub.
function mountMonthPicker() {
  const label = document.getElementById("month-label");
  const prev = document.getElementById("month-prev");
  const next = document.getElementById("month-next");

  const update = () => {
    label.textContent = formatMonth(session.currentMonth);
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

  update();
}

// Nav toggle. The drawer is a slide-out on every screen size — the
// hamburger button is always visible and the drawer overlays the app
// with a translucent scrim. Closes on link tap, scrim click, or Escape.
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

  // Tapping any nav link closes the drawer.
  nav.addEventListener("click", (e) => {
    if (e.target.closest(".nav-link") || e.target.closest(".app-nav__profile-link")) {
      closeDrawer();
    }
  });

  // Scrim click closes the drawer.
  scrim?.addEventListener("click", closeDrawer);

  // Escape closes the drawer — but not while typing in an input or
  // while another modal is open (Escape is reserved for those).
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && btn.getAttribute("aria-expanded") === "true") {
      const t = e.target;
      if (t && (t.matches?.("input, textarea, select") || t.closest?.("[role='dialog']"))) return;
      closeDrawer();
    }
  });
}

// Header theme button: cycles Light → Dark → System and persists the choice.
function mountThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    cycleTheme();
    // Mirror the choice into the settings store so it survives a reload even
    // if the user later clears the theme-only localStorage key.
    const pref = getThemePref();
    Store.updateSettings(session.state, { theme: pref });
    Store.save(session.state);
    updateThemeButton();
  });
  updateThemeButton();
}

// ---- Views -----------------------------------------------------------------

// Dashboard — Phase 4: Quick Add, KPI grid, category chart, recent expenses,
// budget alerts panel. The view is large enough that it lives in
// `views/dashboard.js`; this wrapper just hands it the shared session
// and a callback to refresh on any change.
function renderDashboard(container) {
  renderDashboardView(container, {
    state: session.state,
    session,
    openAddExpenseModal,
    // re-render the dashboard in-place after an add/edit/delete
    refresh: () => render(),
  });
}

// Expenses list — delegated to the dedicated view module.
function renderExpenses(container) {
  renderExpensesView(container, { state: session.state });
}

// Budgets — Phase 6: per-category monthly budgets with progress bars, copy
// from last month, and live dashboard alerts.
function renderBudgets(container) {
  renderBudgetsView(container, {
    state: session.state,
    session,
    refresh: () => render(),
  });
}

// Categories — Phase 5: full CRUD (add / rename / recolor / reassign-on-delete).
// The view is in `views/categories.js`; this wrapper passes it the shared
// state and a refresh callback.
function renderCategories(container) {
  renderCategoriesView(container, {
    state: session.state,
    refresh: () => render(),
  });
}

// Profile — full Profile screen accessible from the drawer.
function renderProfile(container) {
  renderProfileView(container, {
    state: session.state,
    refresh: () => render(),
    refreshNav: () => renderNavProfile(),
    onSignOut: () => signOut(),
  });
}

// Settings — currency, date format, theme. All persist live to the store.
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
    <div class="theme-options" role="group" aria-label="Theme">
      <button class="theme-options__btn" type="button" data-theme="light">☀ Light</button>
      <button class="theme-options__btn" type="button" data-theme="dark">☾ Dark</button>
      <button class="theme-options__btn" type="button" data-theme="system">◐ System</button>
    </div>
  `;
  wrap.appendChild(themeCard);

  // --- Data card (Phase 8: JSON / CSV import + export) -------------------
  const dataCard = document.createElement("div");
  dataCard.className = "card";
  dataCard.innerHTML = `
    <div class="card__title">Data</div>
    <div class="card__subtitle">
      Everything lives in this browser. Back up regularly — clearing site
      data will erase your expenses, categories, and budgets.
    </div>
    <div class="muted" id="set-stats" style="margin-bottom: var(--space-3)"></div>

    <div class="data-actions">
      <div class="data-actions__group">
        <div class="data-actions__heading">Full backup (JSON)</div>
        <div class="data-actions__hint muted">Includes settings, categories, expenses, and budgets.</div>
        <div class="data-actions__buttons">
          <button class="btn btn--primary" type="button" id="data-export-json">Export JSON</button>
          <button class="btn" type="button" id="data-import-json">Import JSON</button>
          <input type="file" id="data-import-json-input" accept="application/json,.json" style="display:none" />
        </div>
      </div>

      <div class="data-actions__group">
        <div class="data-actions__heading">Expenses (CSV)</div>
        <div class="data-actions__hint muted">Round-trip safe; open in Excel or Google Sheets.</div>
        <div class="data-actions__buttons">
          <button class="btn btn--primary" type="button" id="data-export-csv">Export CSV</button>
          <button class="btn" type="button" id="data-import-csv">Import CSV</button>
          <input type="file" id="data-import-csv-input" accept=".csv,text/csv" style="display:none" />
        </div>
      </div>

      <div class="data-actions__group data-actions__group--danger">
        <div class="data-actions__heading">Danger zone</div>
        <div class="data-actions__hint muted">Wipes all data in this browser. There is no undo.</div>
        <div class="data-actions__buttons">
          <button class="btn btn--danger" type="button" id="data-erase">Erase all data…</button>
        </div>
      </div>
    </div>
  `;
  wrap.appendChild(dataCard);

  container.appendChild(wrap);

  // --- Hydrate controls from current state --------------------------------
  const $code = currencyCard.querySelector("#set-currency");
  const $symbol = currencyCard.querySelector("#set-symbol");
  const $pos = currencyCard.querySelector("#set-pos");
  const $date = currencyCard.querySelector("#set-date");
  const $preview = currencyCard.querySelector("#set-preview");
  $code.value = s.currency;
  $symbol.value = s.currencySymbol;
  $pos.value = s.currencyPosition;
  $date.value = s.dateFormat;

  // Re-render the preview using whatever the controls currently say.
  const updatePreview = () => {
    $preview.textContent = formatCurrency(1234.5, {
      currency: $code.value,
      currencySymbol: $symbol.value || $code.value,
      currencyPosition: $pos.value,
    });
  };
  updatePreview();

  // Tracks whether the symbol is still the auto-synced default for the
  // current currency — once the user edits it manually, stop overwriting.
  let symbolAutoSynced = true;
  $symbol.addEventListener("input", () => { symbolAutoSynced = false; });

  // Persist the current control values into the store.
  const persistSettings = () => {
    Store.updateSettings(state, {
      currency: $code.value,
      currencySymbol: $symbol.value,
      currencyPosition: $pos.value,
      dateFormat: $date.value,
    });
    Store.save(state);
    updatePreview();
  };

  $code.addEventListener("change", () => {
    const SYMBOLS = { INR: "₹", USD: "$", EUR: "€", GBP: "£", JPY: "¥" };
    // Only auto-replace the symbol if the user hasn't customized it yet.
    if (symbolAutoSynced) $symbol.value = SYMBOLS[$code.value] ?? $code.value;
    persistSettings();
    toast("Settings saved", "success");
  });
  $symbol.addEventListener("input", persistSettings);
  $pos.addEventListener("change", () => { persistSettings(); toast("Settings saved", "success"); });
  $date.addEventListener("change", () => { persistSettings(); toast("Settings saved", "success"); });

  // --- Theme buttons ------------------------------------------------------
  // These are a mutually-exclusive group, so we expose them as a real
  // radio group: the container is role="radiogroup" and each button is
  // role="radio" with aria-checked reflecting the active theme. The
  // visible "is-active" class continues to drive the visual highlight.
  themeCard.querySelector(".theme-options")?.setAttribute("role", "radiogroup");
  themeCard.querySelectorAll("[data-theme]").forEach((b) => {
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", b.dataset.theme === getThemePref() ? "true" : "false");
  });
  function renderThemeActive() {
    const pref = getThemePref();
    themeCard.querySelectorAll("[data-theme]").forEach((b) => {
      const isActive = b.dataset.theme === pref;
      b.classList.toggle("is-active", isActive);
      b.setAttribute("aria-checked", isActive ? "true" : "false");
    });
  }
  themeCard.querySelectorAll("[data-theme]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setTheme(btn.dataset.theme);
      Store.updateSettings(state, { theme: btn.dataset.theme });
      Store.save(state);
      updateThemeButton();
      renderThemeActive();
    });
  });
  renderThemeActive();

  // --- Stats line ---------------------------------------------------------
  dataCard.querySelector("#set-stats").textContent =
    `${state.expenses.length} expenses · ${state.categories.length} categories · schema v${state.version}`;

  // --- Data: JSON export --------------------------------------------------
  // Writes a pretty-printed JSON file with the current state. The filename
  // includes the date so consecutive backups don't overwrite each other.
  dataCard.querySelector("#data-export-json").addEventListener("click", () => {
    const json = exportFullState(state);
    const filename = `expense-tracker-${todayISO()}.json`;
    downloadAsFile(filename, json, "application/json");
    toast("Backup downloaded", "success");
  });

  // --- Data: JSON import --------------------------------------------------
  // The hidden <input type="file"> is clicked by the visible button so the
  // browser shows the standard file picker. On selection we read the file
  // and ask the user to merge or replace.
  const $importJsonInput = dataCard.querySelector("#data-import-json-input");
  dataCard.querySelector("#data-import-json").addEventListener("click", () => {
    $importJsonInput.click();
  });
  $importJsonInput.addEventListener("change", async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const result = parseFullState(text);
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }
      const incoming = result.state;
      const counts = `${incoming.expenses.length} expenses, ${incoming.categories.length} categories`;
      // Ask Merge vs Replace vs Cancel. openModal is callback-based, so
      // we wrap it in a Promise to keep this handler readable.
      const choice = await new Promise((resolve) => {
        openModal({
          title: "Import backup?",
          body: `
            <p style="margin: 0 0 var(--space-3) 0;">
              Found <strong>${escapeHtml(counts)}</strong> in
              <strong>${escapeHtml(file.name)}</strong>.
            </p>
            <p class="muted" style="margin: 0; font-size: var(--text-sm)">
              <strong>Merge</strong> adds new items without touching your current data.<br/>
              <strong>Replace</strong> wipes your current data and uses the backup as-is.
            </p>
          `,
          actions: [
            { label: "Cancel", value: "cancel", kind: "default" },
            { label: "Merge", value: "merge", kind: "primary" },
            { label: "Replace", value: "replace", kind: "danger" },
          ],
          onAction: (v) => { resolve(v); return true; },
        });
      });
      if (choice === "cancel" || choice === false) return;
      if (choice === "replace") {
        // Wholesale swap: take the backup as the new state. We preserve
        // the user's theme preference so the UI doesn't get flipped.
        const themePref = state.settings.theme;
        Object.assign(state, incoming);
        state.settings.theme = themePref;
        Store.save(state);
        toast(`Restored backup (${incoming.expenses.length} expenses)`, "success");
      } else {
        // Merge: add categories/expenses/budgets that aren't already present.
        const merged = mergeState(state, incoming);
        Object.assign(state, merged);
        Store.save(state);
        const added = merged.expenses.length - state.expenses.length;
        // (Sanity: state and merged should be the same object after Object.assign.)
        const addedExpenses = (incoming.expenses || []).filter(
          (e) => !state.expenses.some((x) => x.id === e.id)
        ).length;
        toast(
          `Merged ${addedExpenses} new expense${addedExpenses === 1 ? "" : "s"}`,
          "success",
        );
      }
      render();
    } catch (e) {
      toast("Could not read file: " + (e.message || e), "error");
    } finally {
      // Clear so picking the same file again still fires "change".
      ev.target.value = "";
    }
  });

  // --- Data: CSV export ---------------------------------------------------
  dataCard.querySelector("#data-export-csv").addEventListener("click", () => {
    if (state.expenses.length === 0) {
      toast("No expenses to export", "error");
      return;
    }
    const csv = expensesToCSV(state.expenses, state.categories);
    const filename = `expenses-${todayISO()}.csv`;
    downloadAsFile(filename, csv, "text/csv");
    toast(`Exported ${state.expenses.length} expenses`, "success");
  });

  // --- Data: CSV import ---------------------------------------------------
  const $importCsvInput = dataCard.querySelector("#data-import-csv-input");
  dataCard.querySelector("#data-import-csv").addEventListener("click", () => {
    $importCsvInput.click();
  });
  $importCsvInput.addEventListener("change", async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const result = csvToExpenses(text, state.categories);
      if (!result.ok && result.expenses.length === 0) {
        // Hard failure — show the first error and bail.
        toast(result.errors[0]?.message || "Could not parse CSV.", "error");
        return;
      }
      // Soft failure (some rows had errors) — confirm before importing the good ones.
      if (result.errors.length > 0) {
        const ok = await confirmDialog({
          title: "Some rows had errors",
          message: `${result.expenses.length} row(s) look good, ${result.errors.length} had problems and will be skipped. Continue?`,
          confirmLabel: `Import ${result.expenses.length} row(s)`,
        });
        if (!ok) return;
      }
      // Apply: dedupe by id so a re-import of the same CSV is a no-op.
      // The CSV writer emits the `id` column for every row, so two parses
      // of the same file produce the same ids; without this check every
      // re-import would double the user's data.
      const existingIds = new Set(state.expenses.map((e) => e.id));
      let added = 0;
      let skipped = 0;
      for (const e of result.expenses) {
        // Rows without an id (e.g. a hand-edited CSV) always go in; the
        // store generates a fresh id for them.
        if (e.id && existingIds.has(e.id)) {
          skipped++;
          continue;
        }
        Store.addExpense(state, e);
        if (e.id) existingIds.add(e.id);
        added++;
      }
      Store.save(state);
      const skipTail = skipped > 0 ? ` · ${skipped} skipped (already imported)` : "";
      toast(`Imported ${added} expense${added === 1 ? "" : "s"}${skipTail}`, "success");
      render();
    } catch (e) {
      toast("Could not read file: " + (e.message || e), "error");
    } finally {
      ev.target.value = "";
    }
  });

  // --- Data: Erase all ---------------------------------------------------
  dataCard.querySelector("#data-erase").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Erase all data?",
      message: "This deletes every expense, category, and budget in this browser. There is no undo. Consider exporting a JSON backup first.",
      confirmLabel: "Erase everything",
      cancelLabel: "Keep my data",
      danger: true,
    });
    if (!ok) return;
    Store.reset();
    // Re-apply the user's theme preference on top of the freshly-seeded
    // settings (Store.reset() creates a new state object, so any in-memory
    // reference is now stale — re-render to pick up the new state).
    session.state = JSON.parse(localStorage.getItem(Store.STORAGE_KEY));
    render();
    toast("All data erased", "success");
  });
}

// Shared placeholder card for views that aren't implemented yet.
function placeholder(title, body) {
  const el = document.createElement("div");
  el.innerHTML = `
    <h1 class="section-title">${escapeHtml(title)}</h1>
    <div class="placeholder">
      <div class="placeholder__title">Coming in a later phase</div>
      <div>${body}</div>
    </div>
  `;
  return el;
}

// ---- Shared Add-Expense modal opener --------------------------------------
// Used by the Dashboard's "Add" button. The Expenses view uses its own
// equivalent so it can re-render the table after a save.
function openAddExpenseModal() {
  const form = buildExpenseForm({ categories: session.state.categories });
  openModal({
    title: "Add expense",
    body: form,
    actions: [
      { label: "Cancel", value: false, kind: "default" },
      { label: "Add expense", value: true, kind: "primary" },
    ],
    onAction: (value) => {
      if (!value) return true;        // Cancel — close the modal
      const result = form.readValues();
      if (!result.ok) return false;   // Invalid — keep the modal open
      Store.addExpense(session.state, result.value);
      Store.save(session.state);
      toast("Expense added", "success");
      // Re-render the current view so totals / tables reflect the new row.
      render();
      return true;
    },
  });
}

// Sign out — clears the active profile (NOT expenses/categories/budgets and
// NOT the on-device profile registry) and puts the app back behind the auth
// gate. The user's data and the registered profile entry are preserved so
// the same person can sign back in with the same name + phone later.
function signOut() {
  Store.updateProfile(session.state, { userId: "", name: "", phone: "", avatarDataUrl: "" });
  Store.save(session.state);
  toast("Signed out", "success");
  // Reset the route silently to dashboard. We use history.replaceState
  // (not `window.location.hash =`) because the latter fires a `hashchange`
  // event, which would re-render the current view against the just-cleared
  // profile before bootLoginGate() can mount the gate — producing a visible
  // flash of the app shell with an empty profile. replaceState changes the
  // URL without firing the event, so the gate covers everything cleanly.
  if (window.location.hash !== "#/dashboard") {
    history.replaceState(null, "", "#/dashboard");
  }
  // Re-show the gate. Now called synchronously, so there's no window
  // where the user can see the app shell rendered with an empty profile.
  bootLoginGate();
}

// Mounts the app shell (header, nav, theme, keyboard shortcuts, route
// rendering). Called from bootLoginGate in both the "already signed in"
// and "just finished the gate" paths. Fires the one-time first-run
// welcome toast the first time it runs after a brand-new install.
function mountAppShell() {
  document.body.classList.remove("app-locked");
  mountMonthPicker();
  mountNavToggle();
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
        updateThemeButton();
      },
    },
  );
  window.addEventListener("hashchange", render);
  render();
  // One-time first-run welcome. We fire it after the app shell is up so
  // the user actually sees the toast (otherwise the gate would swallow it).
  // Hot-reloads don't re-fire it because we clear the flag immediately.
  if (session.firstRun) {
    const name = (session.state.profile && session.state.profile.name) || "";
    const greeting = name ? `Welcome, ${name}!` : "Welcome to Expense Tracker!";
    toast(greeting, "success", 4000);
    session.firstRun = false;
  }
}

// Mounts the login gate if there's no profile, then mounts the app.
function bootLoginGate() {
  const profile = session.state.profile;
  if (profile && profile.userId && profile.phone) {
    // Already signed in — show the app shell directly.
    mountAppShell();
    return;
  }
  // Hide the hamburger / app shell so the user can't see the app behind the
  // gate. We keep the app shell in the DOM so it can show instantly on login.
  document.body.classList.add("app-locked");
  mountLogin({
    state: session.state,
    onComplete: () => {
      mountAppShell();
    },
  });
}

// ---- Bootstrap -------------------------------------------------------------
// Order matters: load the store, apply theme, then either show the login
// gate or mount the UI.
function init() {
  session.storeResult = Store.load();
  session.state = session.storeResult.state;
  // `firstRun` is true only when Store.load() seeded a brand-new state
  // from scratch (no existing localStorage, no errors). We use it to
  // fire a one-time "Welcome!" toast right after the user lands on the
  // app shell — the gate hides the app until login, so the toast
  // naturally waits for the first successful sign-in.
  session.firstRun = session.storeResult.ok === true && session.storeResult.seeded === true;
  if (!session.storeResult.ok) {
    // Non-fatal — the app still runs with a fresh state. Surface in the console.
    console.warn("Store load issue:", session.storeResult.error);
  }

  initTheme();
  if (session.state.settings.theme) {
    setTheme(session.state.settings.theme);
  }
  updateThemeButton();

  // Gate the app on profile. If a profile exists, mount the app shell;
  // otherwise the gate handles the mount on completion.
  bootLoginGate();
}

window.addEventListener("DOMContentLoaded", init);
