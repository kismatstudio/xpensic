// Entry point: hash-based router + view mounting + month picker + theme + auth.
//
// Auth model (since the backend landed):
//   • On boot, we ask the server `/api/auth/whoami`. If the cookie is
//     valid, we fetch the user's data blob and mount the app shell.
//   • If the server is unreachable or the cookie is missing/invalid, we
//     mount the login gate. The gate signs the user in and hands us a
//     user object; we then fetch the data blob.
//   • Every unlocked state mutation is encrypted in the browser and
//     uploaded as one vault envelope. The local cache is encrypted too.

import { Store } from "./store.js";
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
import { Auth, Crypto, apiBase, ApiError } from "./api.js";
import { getDeviceKey, isAvailable as deviceKeyAvailable, clearDeviceKey as clearLocalDeviceKey, needsReauth, touchLastUnlockAt } from "./crypto/device-key.mjs";
import { unwrapWithDeviceKey, wrapWithDeviceKey, newDeviceKey, getDeviceId } from "./crypto/keystore.mjs";
import {
  setMasterKey,
  getMasterKey as readMasterKey,
  getState as getUnlockState,
  lock as lockVault,
} from "./crypto/unlock-gate.mjs";
import {
  loadVault as loadEncryptedVault,
  saveVault as saveEncryptedVault,
  clearVaultCache,
} from "./crypto/vault-sync.mjs";

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

// ---- Encrypted vault sync --------------------------------------------------
// Every Store.save() queues the complete state for client-side encryption.
// The server receives one opaque vault envelope and never receives individual
// expense, category, budget, split, settings, or profile records.
let syncTimer = null;
let syncPending = false;
let syncInFlight = false;

function syncToServer() {
  syncPending = true;
  if (syncTimer || syncInFlight) return;
  syncTimer = setTimeout(() => {
    syncTimer = null;
    if (!syncPending) return;
    flushVaultSync().catch(() => {});
  }, 500);
}

Store.onSave(() => syncToServer());

// Wire Store.save to the encrypted queue once at boot. The function is
// also visible in dev tools for diagnostics.
async function flushVaultSync() {
  if (!session.state?.profile?.userId || !getUnlockState().isUnlocked) {
    syncPending = false;
    return;
  }
  if (syncInFlight) return;

  syncInFlight = true;
  syncPending = false;
  try {
    await saveEncryptedVault(session.state);
    setServerOnline(true);
  } catch (err) {
    setServerOnline(false, err);
    throw err;
  } finally {
    syncInFlight = false;
    if (syncPending && !syncTimer) syncToServer();
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
        e.target.closest(".app-nav__signout") ||
        e.target.closest(".app-nav__encrypted")) {
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

  const encryptedBtn = nav.querySelector("#app-nav-encrypted");
  if (encryptedBtn && encryptedBtn.dataset.bound !== "true") {
    encryptedBtn.addEventListener("click", () => openEncryptionInfoModal());
    encryptedBtn.dataset.bound = "true";
  }
}

function openEncryptionInfoModal() {
  openModal({
    title: "End-to-end encryption",
    body: `
      <div class="e2ee-info">
        <p class="e2ee-info__intro">
          Your vault is encrypted in this browser before it is uploaded. Here is
          the boundary between data Xpensic cannot read and service metadata the
          team can see.
        </p>
        <p class="e2ee-info__source">
          Public source code:
          <a href="https://github.com/kismatstudio/xpensic" target="_blank" rel="noopener noreferrer">View Xpensic on GitHub</a>
        </p>
        <div class="e2ee-boundary">
          <section class="e2ee-boundary__panel e2ee-boundary__panel--private" aria-labelledby="e2ee-private-title">
            <div class="e2ee-boundary__heading">
              <span class="e2ee-boundary__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="m9 15 2 2 4-4"/></svg>
              </span>
              <div>
                <h3 id="e2ee-private-title">Not readable by Xpensic</h3>
                <p>Encrypted before it leaves your browser</p>
              </div>
            </div>
            <ul class="e2ee-boundary__list">
              <li><span class="e2ee-boundary__item-icon" aria-hidden="true">&#10003;</span><span>Expense amounts, notes, and payment details</span></li>
              <li><span class="e2ee-boundary__item-icon" aria-hidden="true">&#10003;</span><span>Categories, budgets, and splits</span></li>
              <li><span class="e2ee-boundary__item-icon" aria-hidden="true">&#10003;</span><span>Profile details, settings, and in-app login history</span></li>
              <li><span class="e2ee-boundary__item-icon" aria-hidden="true">&#10003;</span><span>Vault password, recovery phrase, and decrypted contents</span></li>
            </ul>
          </section>
          <section class="e2ee-boundary__panel e2ee-boundary__panel--visible" aria-labelledby="e2ee-visible-title">
            <div class="e2ee-boundary__heading">
              <span class="e2ee-boundary__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>
              </span>
              <div>
                <h3 id="e2ee-visible-title">Visible to the Xpensic team</h3>
                <p>Needed for accounts and encrypted sync</p>
              </div>
            </div>
            <ul class="e2ee-boundary__list">
              <li><span class="e2ee-boundary__item-icon" aria-hidden="true">&#8226;</span><span>Your account email or phone identifier</span></li>
              <li><span class="e2ee-boundary__item-icon" aria-hidden="true">&#8226;</span><span>Password hash and session metadata, never your password</span></li>
              <li><span class="e2ee-boundary__item-icon" aria-hidden="true">&#8226;</span><span>Vault revision, timestamps, and encrypted payload size</span></li>
              <li><span class="e2ee-boundary__item-icon" aria-hidden="true">&#8226;</span><span>Encrypted key wraps and vault ciphertext</span></li>
            </ul>
          </section>
        </div>
        <p class="e2ee-info__warning">
          <strong>Key loss:</strong> Your vault password and recovery phrase are
          never sent to us. If both are lost and no trusted device can unlock
          the vault, nobody, including XPENSIC, can recover it.
        </p>
      </div>
    `,
    actions: [{ label: "Close", value: false, kind: "default" }],
  });
}

function mountThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    cycleTheme();
    const pref = getThemePref();
    Store.updateSettings(session.state, { theme: pref });
    // Persist through the encrypted vault path.
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
    // (not mutated) by afterUnlock()/auto-unlock, so a closure that
    // captured `state` at render time can go stale. Quick
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
        await flushVaultSync();
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
      const userId = session.state?.profile?.userId || "";
      await Crypto.deleteVault();
      await Crypto.putMasterKey([]);
      await clearVaultCache(userId);
      await clearLocalDeviceKey(userId);
      lockVault();
      session.state = Store.reset();
      await Auth.signout().catch(() => {});
      if (typeof window !== "undefined") window.__xpensicCurrentUserId = "";
      toast("All server data erased", "success");
      bootLoginGate();
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
  try { await flushVaultSync(); } catch { /* ignore — we're signing out anyway */ }
  const userId = session.state?.profile?.userId || "";
  // Wipe the local device key from IndexedDB so the next sign-in
  // on this browser re-prompts for the master password. Without
  // this, signing out and closing the tab would still let anyone
  // with access to this browser auto-unlock the next account that
  // signs in here.
  try { await clearLocalDeviceKey(userId); } catch { /* ignore */ }
  try { await clearVaultCache(userId); } catch { /* ignore */ }
  lockVault();
  try { await Auth.signout(); } catch { /* even if the server is down, clear locally */ }
  // Clear the active-session flag so any in-flight 401 retries from
  // the just-cleared session don't bounce the user back to a now-
  // meaningless login gate.
  if (typeof window !== "undefined") {
    window.__xpensicCurrentUserId = "";
  }
  session.state = Store.reset();
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
      afterUnlock(state, { justSignedUp, passwordUnlock: true }).catch(() => {});
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
    try { state = await loadEncryptedVault({ userId: user.userId }); } catch { state = null; }
    if (!state) return false;
    // The vault owns private profile fields. Only bind its state to the
    // authenticated account id supplied by the auth session.
    state.profile = {
      ...(state.profile || {}),
      userId: user.userId,
    };
    session.state = state;
    // afterUnlock is now async (it awaits ensureDeviceWrap so the
    // device key is in IndexedDB before the user can interact).
    // We don't need to block on it here — the device wrap already
    // exists (that's why auto-unlock succeeded), so ensureDeviceWrap
    // will be a no-op. Fire-and-forget is fine.
    afterUnlock(state, { justSignedUp: false }).catch(() => {});
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
 * vault, records today's login day, persists the encrypted envelope, and
 * mounts the app shell.
 *
 * `passwordUnlock` should be true when the user just entered their
 * vault password (or recovery phrase) manually. It's false for
 * silent auto-unlocks. When true, we stamp `lastUnlockAt` in
 * IndexedDB so the 7-day periodic re-auth window resets.
 */
async function afterUnlock(state, { justSignedUp = false, freshVault = false, passwordUnlock = false } = {}) {
  const signedInUserId = session.state?.profile?.userId || state?.profile?.userId || "";
  session.state = state;
  if (signedInUserId) {
    session.state.profile = { ...(session.state.profile || {}), userId: signedInUserId };
  }
  if (!Array.isArray(session.state.loginDays)) session.state.loginDays = [];
  Store.recordLoginDay(session.state, todayISO());
  Store.save(session.state);
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
    if (signedInUserId) touchLastUnlockAt(signedInUserId).catch(() => {});
  }
  syncToServer();
  mountAppShell();
}

function readMasterKeySafe() {
  try { return readMasterKey(); } catch { return null; }
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

  // Start with an empty in-memory state. The encrypted vault is loaded only
  // after the authenticated user unlocks it.
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
