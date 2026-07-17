// Confirm dialog — wraps openModal with a simple yes/no API.
// Used for destructive actions (e.g. delete expense, delete category).

import { openModal } from "./modal.js";

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.message
 * @param {string} [opts.confirmLabel="Confirm"]
 * @param {string} [opts.cancelLabel="Cancel"]
 * @param {boolean} [opts.danger=false] — render the confirm button in red
 * @returns {Promise<boolean>} resolves true if confirmed, false if cancelled
 */
export function confirmDialog(opts) {
  return new Promise((resolve) => {
    openModal({
      title: opts.title,
      body: `<p style="margin:0; color:var(--color-text);">${escapeHtml(opts.message)}</p>`,
      actions: [
        { label: opts.cancelLabel || "Cancel", value: false, kind: "default" },
        {
          label: opts.confirmLabel || "Confirm",
          value: true,
          kind: opts.danger ? "danger" : "primary",
        },
      ],
      onAction: (value) => {
        // Returning a plain value lets openModal close itself afterwards.
        resolve(Boolean(value));
      },
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
