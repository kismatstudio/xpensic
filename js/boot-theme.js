// Runs synchronously in <head> before styles paint, to avoid a light/dark flash.
//
// Default theme is "system". The pref in localStorage is reset to "system"
// whenever the login gate is showing, and holds the signed-in user's
// choice otherwise (see theme.js).
(function () {
  try {
    var pref = localStorage.getItem("expense-tracker:theme-pref") || "system";
    var resolved = pref;
    if (pref === "system") {
      resolved = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    var root = document.documentElement;
    root.dataset.theme = resolved;
    root.dataset.themePref = pref;
    root.style.colorScheme = resolved;
    // Sync the favicon to the resolved theme before the browser paints
    // the tab. We only ship a single PNG favicon (it reads well on both
    // light and dark tab backgrounds), so no swap is needed — but we
    // update the href so the theme-change handler in theme.js can
    // toggle it later if the brand team ships theme-specific favicons.
    var favicon = document.getElementById("brand-favicon");
    if (favicon) {
      favicon.setAttribute("href", "assets/brand/favicon.png");
    }
  } catch (e) {
    /* ignore */
  }
})();
