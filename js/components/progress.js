// Progress bar — a simple, accessible horizontal bar used by budget widgets.
// Color thresholds:
//   • < 80%        → default (uses --color-primary)
//   • ≥ 80% & < 100% → warn    (uses --color-warn)
//   • ≥ 100%       → danger  (uses --color-danger)
// The bar clamps at 100% visually so a massive overspend doesn't make the
// layout jump; the actual percentage is still passed through to ARIA.

/**
 * @param {object} opts
 * @param {number} opts.value    — current value
 * @param {number} opts.max      — max value (denominator). Must be > 0.
 * @param {string} [opts.label]  — optional accessible label, e.g. "Food budget"
 * @returns {HTMLDivElement}
 */
export function buildProgressBar({ value, max, label }) {
  const safeMax = max > 0 ? max : 1;
  // Clamp the visual fill to 100% so a 500% over-budget doesn't blow up the row.
  const fraction = Math.max(0, Math.min(1, value / safeMax));
  // For ARIA we report the unclamped percentage so screen readers convey
  // how far over the user is (e.g. "120 percent").
  const ariaPercent = Math.round((value / safeMax) * 100);

  const bar = document.createElement("div");
  bar.className = "progress";
  // role + aria-valuenow makes this a proper progressbar for assistive tech.
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  bar.setAttribute("aria-valuenow", String(ariaPercent));
  if (label) bar.setAttribute("aria-label", label);

  // Threshold class drives the color via CSS (cleaner than inline styles).
  if (fraction >= 1) bar.classList.add("progress--danger");
  else if (fraction >= 0.8) bar.classList.add("progress--warn");

  const fill = document.createElement("div");
  fill.className = "progress__fill";
  fill.style.width = `${fraction * 100}%`;
  bar.appendChild(fill);

  return bar;
}
