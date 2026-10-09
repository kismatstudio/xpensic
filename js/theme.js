// Theme system: light / dark / system.
// Applies a `data-theme` attribute on <html> so tokens.css can swap values.
// Listens to system color-scheme changes when theme === "system".

const STORAGE_KEY = "expense-tracker:theme-pref"; // transient, separate from store
const VALID = new Set(["light", "dark", "system"]);

// The theme is "system" on the login / sign-up / unlock gates and for any
// account that hasn't chosen one. Once a user is signed in their own choice
// applies; it's remembered per account on this device so it can be restored
// right after the password step (before the encrypted vault is opened).
const DEFAULT_PREF = "system";
let currentUserId = "";

function userKey() {
  return currentUserId ? `${STORAGE_KEY}:${currentUserId}` : "";
}

function readPref() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return VALID.has(v) ? v : DEFAULT_PREF;
  } catch {
    return DEFAULT_PREF;
  }
}

function writePref(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
    const key = userKey();
    if (key) localStorage.setItem(key, theme);
  } catch {
    /* ignore */
  }
}

/**
 * Pre-login screens (sign in, sign up, forgot password, unlock): always the
 * System theme, whatever the last user picked. Nothing is saved per account.
 */
export function enterGateTheme() {
  currentUserId = "";
  try { localStorage.setItem(STORAGE_KEY, DEFAULT_PREF); } catch { /* ignore */ }
  return applyTheme(DEFAULT_PREF);
}

/**
 * Called once the server has accepted the sign-in: switch to this account's
 * remembered theme (System if they never chose one).
 */
export function enterUserTheme(userId) {
  currentUserId = String(userId || "");
  let pref = DEFAULT_PREF;
  try {
    const saved = currentUserId ? localStorage.getItem(userKey()) : null;
    if (VALID.has(saved)) pref = saved;
  } catch { /* ignore */ }
  return setTheme(pref);
}

function resolve(pref) {
  if (pref === "light" || pref === "dark") return pref;
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

export function applyTheme(pref = readPref()) {
  const resolved = resolve(pref);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePref = pref;
  // Hint to the browser for form controls / scrollbars
  root.style.colorScheme = resolved;
  // Sync the favicon href to the resolved theme. Currently we ship a
  // single PNG that works on both light and dark tab backgrounds, so
  // the href is the same either way — but wiring this here means that
  // the day the brand team ships a dark-tab-specific favicon, only
  // this line needs to change.
  syncFavicon(resolved);
  return { pref, resolved };
}

/**
 * Update the favicon href to match the active theme. Falls back to a
 * no-op when the link isn't on the page yet (boot-theme.js handles the
 * pre-paint initial state).
 */
function syncFavicon(theme) {
  if (typeof document === "undefined") return;
  const link = document.getElementById("brand-favicon");
  if (!link) return;
  // The current brand ships one PNG favicon that reads on both tab
  // backgrounds, so we always point at it. If a future variant is
  // added, swap this to: theme === "dark" ? "...dark.png" : "...light.png"
  link.setAttribute("href", "assets/brand/favicon.png");
}

export function initTheme() {
  applyTheme();
  if (typeof window !== "undefined" && window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (readPref() === "system") applyTheme("system");
    };
    if (mq.addEventListener) mq.addEventListener("change", handler);
    else if (mq.addListener) mq.addListener(handler);
  }
}

export function cycleTheme() {
  const current = readPref();
  const next = current === "light" ? "dark" : current === "dark" ? "system" : "light";
  writePref(next);
  return applyTheme(next);
}

export function setTheme(pref) {
  if (!VALID.has(pref)) return readPref();
  writePref(pref);
  return applyTheme(pref);
}

export function getThemePref() {
  return readPref();
}
