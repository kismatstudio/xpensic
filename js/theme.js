// Theme system: light / dark / system.
// Applies a `data-theme` attribute on <html> so tokens.css can swap values.
// Listens to system color-scheme changes when theme === "system".

const STORAGE_KEY = "expense-tracker:theme-pref"; // transient, separate from store
const VALID = new Set(["light", "dark", "system"]);

function readPref() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return VALID.has(v) ? v : "system";
  } catch {
    return "system";
  }
}

function writePref(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
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
  return { pref, resolved };
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
