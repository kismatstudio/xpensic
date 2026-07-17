// Modal component — a focus-trapped, ESC-closable dialog used for forms
// (add/edit expense) and confirmations. Returns a controller with `close()`.
//
// We build it imperatively (not as a Web Component) so the codebase stays
// framework-free and easy to reason about. The modal mounts into <body> at
// the end so its stacking context always wins.

/**
 * @param {object} opts
 * @param {string} opts.title        — heading shown at the top of the modal
 * @param {string|Node} opts.body    — HTML string or DOM node placed under the title
 * @param {Array<{label:string, kind?:string, value:any}>} [opts.actions]
 *                                     — buttons in the footer; the last one with value===true
 *                                       is treated as the primary action
 * @param {(action:any) => (void|boolean|Promise<void|boolean>)} [opts.onAction]
 *                                     — called on every action click. Return `false` to
 *                                       keep the modal open (useful for validation).
 * @returns {{ el: HTMLElement, close: () => void }}
 */
export function openModal(opts) {
  // ---- Build the DOM in one template so the structure stays predictable ----
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.setAttribute("role", "presentation");

  const dialog = document.createElement("div");
  dialog.className = "modal";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "modal-title");
  dialog.tabIndex = -1;

  const header = document.createElement("header");
  header.className = "modal__header";
  const title = document.createElement("h2");
  title.id = "modal-title";
  title.className = "modal__title";
  title.textContent = opts.title;
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "icon-btn";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";
  header.append(title, closeBtn);

  const body = document.createElement("div");
  body.className = "modal__body";
  if (typeof opts.body === "string") body.innerHTML = opts.body;
  else if (opts.body instanceof Node) body.appendChild(opts.body);

  const footer = document.createElement("footer");
  footer.className = "modal__footer";
  const actions = opts.actions || [{ label: "Close", value: false }];
  const buttons = actions.map((a) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn" + (a.kind === "primary" ? " btn--primary" : a.kind === "danger" ? " btn--danger" : "");
    b.textContent = a.label;
    b.dataset.value = JSON.stringify(a.value ?? false);
    footer.appendChild(b);
    return b;
  });

  dialog.append(header, body, footer);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // ---- Focus management: remember what had focus, then move into the dialog ----
  // We restore focus on close so keyboard users land back where they triggered the modal.
  const previouslyFocused = document.activeElement;

  // ---- Close helpers ----
  let isClosing = false;
  function close() {
    // Guard against double-close (ESC + button click in the same frame).
    if (isClosing) return;
    isClosing = true;
    overlay.remove();
    if (previouslyFocused && typeof previouslyFocused.focus === "function") {
      previouslyFocused.focus();
    }
    document.removeEventListener("keydown", onKey);
  }

  // ---- Wire actions: each button click calls onAction; falsy return closes the modal ----
  buttons.forEach((b) => {
    b.addEventListener("click", async () => {
      const value = JSON.parse(b.dataset.value);
      if (typeof opts.onAction === "function") {
        // If the handler returns a Promise, await it; treat `false` as "stay open".
        const result = await opts.onAction(value);
        if (result === false) return;
      }
      close();
    });
  });

  // ESC and click-on-overlay close the modal (clicks inside the dialog do not).
  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      // Lightweight focus trap: cycle Tab/Shift+Tab across focusable elements in the dialog.
      const focusables = dialog.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);

  // Initial focus into the dialog.
  requestAnimationFrame(() => {
    const firstFocusable = dialog.querySelector(
      'input, select, textarea, button:not([aria-label="Close"])',
    );
    (firstFocusable || dialog).focus();
  });

  return { el: overlay, close };
}
