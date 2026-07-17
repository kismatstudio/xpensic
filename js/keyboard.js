// Global keyboard shortcuts.
//
// We listen on `document` (capture: false) so the page's own form inputs
// can still receive the keys when they have focus. Shortcuts are only
// triggered when the user is not actively typing into a text field
// (input, textarea, contenteditable). That keeps shortcuts from fighting
// the search box or the expense form's amount input.
//
// Available shortcuts:
//   n        → go to Expenses view + open the Add modal
//   /        → go to Expenses view + focus the search box
//   e        → go to Expenses view
//   b        → go to Budgets view
//   c        → go to Categories view
//   s        → go to Settings view
//   d        → go to Dashboard
//   t        → cycle theme (header button)
//   ?        → open the keyboard help modal
//   Esc      → close the topmost modal (handled inside openModal)

import { openModal } from "./components/modal.js";

/**
 * Mount global keyboard shortcuts. `navigate` is the function main.js
 * uses to switch routes: navigate("expenses") etc.
 *
 * @param {(route:string) => void} navigate
 * @param {{ openAddExpense: () => void, cycleTheme: () => void }} actions
 */
export function mountKeyboardShortcuts(navigate, actions) {
  const onKey = (e) => {
    // Don't hijack keys the user is typing in a form.
    if (shouldIgnoreKey(e)) return;
    // Don't fire on modifier combos (Ctrl/Cmd/Alt) — those belong to the
    // browser or OS, not us.
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.key) {
      case "n":
        e.preventDefault();
        navigate("expenses");
        // Defer the modal open so the route has a chance to render the
        // Add button (which is what the modal's openAddExpense handler
        // would otherwise hook to).
        setTimeout(() => actions.openAddExpense && actions.openAddExpense(), 0);
        break;
      case "/":
        e.preventDefault();
        navigate("expenses");
        setTimeout(() => focusSearchInput(), 0);
        break;
      case "e":
        e.preventDefault();
        navigate("expenses");
        break;
      case "b":
        e.preventDefault();
        navigate("budgets");
        break;
      case "c":
        e.preventDefault();
        navigate("categories");
        break;
      case "s":
        e.preventDefault();
        navigate("settings");
        break;
      case "d":
        e.preventDefault();
        navigate("dashboard");
        break;
      case "t":
        e.preventDefault();
        actions.cycleTheme && actions.cycleTheme();
        break;
      case "?":
        e.preventDefault();
        showHelpModal();
        break;
    }
  };

  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}

function shouldIgnoreKey(e) {
  const t = e.target;
  if (!t) return false;
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (t.isContentEditable) return true;
  return false;
}

function focusSearchInput() {
  const el = document.getElementById("exp-search");
  if (el) el.focus();
}

function showHelpModal() {
  openModal({
    title: "Keyboard shortcuts",
    body: `
      <div class="shortcut-list">
        <div class="shortcut"><kbd>n</kbd><span>Add new expense (goes to Expenses + opens the form)</span></div>
        <div class="shortcut"><kbd>/</kbd><span>Focus the search box (goes to Expenses)</span></div>
        <div class="shortcut"><kbd>e</kbd><span>Go to Expenses</span></div>
        <div class="shortcut"><kbd>b</kbd><span>Go to Budgets</span></div>
        <div class="shortcut"><kbd>c</kbd><span>Go to Categories</span></div>
        <div class="shortcut"><kbd>s</kbd><span>Go to Settings</span></div>
        <div class="shortcut"><kbd>d</kbd><span>Go to Dashboard</span></div>
        <div class="shortcut"><kbd>t</kbd><span>Cycle theme (Light → Dark → System)</span></div>
        <div class="shortcut"><kbd>?</kbd><span>Open this help</span></div>
        <div class="shortcut"><kbd>Esc</kbd><span>Close any open modal</span></div>
        <p class="muted" style="margin-top: var(--space-3); font-size: var(--text-sm)">
          Shortcuts are disabled while typing in a text field, so they never
          fight your input.
        </p>
      </div>
    `,
    actions: [{ label: "Got it", value: true, kind: "primary" }],
  });
}
