// Toast notifications — small, non-blocking status messages.
// Replaces the inline toast helper that lived in main.js during Phase 1
// so any module can show feedback (forms, deletes, imports, etc).

/**
 * @param {string} message
 * @param {"info"|"success"|"error"} [kind="info"]
 * @param {number} [duration=2600]
 * @param {{center?: boolean}} [opts]
 */
export function toast(message, kind = "info", duration = 2600, opts) {
  const centered = !!(opts && opts.center);
  // Find or create the toast region declared in index.html.
  let region = document.getElementById(centered ? "toast-region-center" : "toast-region");
  if (!region) {
    region = document.createElement("div");
    region.id = centered ? "toast-region-center" : "toast-region";
    region.className = centered ? "toast--center" : "toast-region";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-atomic", "true");
    document.body.appendChild(region);
  }

  const el = document.createElement("div");
  el.className = `toast toast--${kind}`;
  el.textContent = message;

  // Append, then fade in on the next frame so the transition runs.
  region.appendChild(el);
  requestAnimationFrame(() => el.classList.add("toast--visible"));

  // Auto-dismiss: fade out, then remove from the DOM.
  setTimeout(() => {
    el.classList.remove("toast--visible");
    setTimeout(() => el.remove(), 200);
  }, duration);
}
