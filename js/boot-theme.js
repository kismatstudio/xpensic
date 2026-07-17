// Runs synchronously in <head> before styles paint, to avoid a light/dark flash.
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
  } catch (e) {
    /* ignore */
  }
})();
