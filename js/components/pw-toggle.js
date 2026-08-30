// Password visibility toggle — adds an "eye" button inside every
// password input so users can verify what they typed.
//
// Usage:
//   import { enhancePasswordInputs } from "../components/pw-toggle.js";
//   enhancePasswordInputs(root);           // enhance every password
//                                          // input inside `root`
//
// The enhancer wraps each <input type="password"> in a `.pw-field`
// container and absolutely positions a small ghost icon-button at the
// right edge. Clicking it swaps the input type between "password" and
// "text" and swaps the eye / eye-off SVG accordingly. ARIA attributes
// keep screen readers informed ("Show password" / "Hide password").

const EYE_OPEN = `
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
       stroke="currentColor" stroke-width="2" stroke-linecap="round"
       stroke-linejoin="round" aria-hidden="true">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>`;

const EYE_OFF = `
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
       stroke="currentColor" stroke-width="2" stroke-linecap="round"
       stroke-linejoin="round" aria-hidden="true">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>`;

/**
 * Enhance every password input found inside `scope`.
 * @param {ParentNode} [scope]
 */
export function enhancePasswordInputs(scope = document) {
  scope.querySelectorAll('input[type="password"]').forEach((input) => {
    enhancePasswordInput(input);
  });
}

/**
 * Enhance a single password input with an eye toggle.
 * Safe to call twice — already-enhanced inputs are skipped.
 * @param {HTMLInputElement} input
 */
export function enhancePasswordInput(input) {
  if (!input || input.dataset.pwToggle === "on") return;
  input.dataset.pwToggle = "on";

  // Wrap the input so the button can be positioned inside the field.
  const wrap = document.createElement("div");
  wrap.className = "pw-field";
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pw-toggle";
  btn.setAttribute("aria-label", "Show password");
  btn.setAttribute("aria-pressed", "false");
  btn.tabIndex = 0;
  btn.innerHTML = EYE_OPEN;
  wrap.appendChild(btn);

  btn.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.innerHTML = show ? EYE_OFF : EYE_OPEN;
    btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    btn.setAttribute("aria-pressed", show ? "true" : "false");
    btn.classList.toggle("is-active", show);
    // Keep the caret where the user was typing.
    const len = input.value.length;
    input.focus({ preventScroll: true });
    try { input.setSelectionRange(len, len); } catch { /* not focusable */ }
  });
}
