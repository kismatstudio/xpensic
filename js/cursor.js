// ──────────────────────────────────────────────────────────────────────────
// Cursor spotlight — the native OS cursor stays fully visible, and a soft
// radial glow trails gently behind it like an ambient light source.
//
// Design rules:
//   • Never hide the native cursor (no `cursor: none` anywhere). Text
//     selection, drag handles, resize grips and the I-beam over inputs
//     all keep working exactly as the OS provides them.
//   • The spotlight is purely decorative: pointer-events: none, low
//     opacity, layered above the page without ever repainting elements.
//   • Over interactive controls (buttons, links, nav items) the glow
//     blooms a little larger as feedback — buttons keep their own hover
//     styling instead of flipping to a black pill.
//   • Auto-disabled on touch devices and when the user prefers reduced
//     motion.
// ──────────────────────────────────────────────────────────────────────────

// Elements that make the spotlight bloom larger as hover feedback.
const INTERACTIVE_SELECTOR = [
  "a",
  "button:not([disabled])",
  ".btn:not(:disabled)",
  ".icon-btn",
  ".theme-toggle",
  ".month-picker button",
  "[role='button']:not([disabled])",
  "[role='link']",
  "[role='tab']",
  "[role='radio']",
  "[role='checkbox']",
  "[data-clickable]",
  ".nav-link",
  ".app-nav__profile-link",
  ".fab",
  "summary",
  "label",
].join(",");

let spotlight = null;
let active = false;
let targetX = 0;
let targetY = 0;
let glowX = 0;
let glowY = 0;
let rafId = 0;
let visible = false;
let lastInteractive = false;

function isFinePointer() {
  return window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function isTouchPrimary() {
  return window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
}

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function createElements() {
  if (spotlight) return;
  spotlight = document.createElement("div");
  spotlight.id = "cursor-spotlight";
  spotlight.className = "cursor-spotlight";
  spotlight.setAttribute("aria-hidden", "true");
  document.body.appendChild(spotlight);
}

function tick() {
  // Smooth lerp: the glow trails a little behind the real cursor, which
  // is what makes it read as ambient light rather than a second pointer.
  glowX += (targetX - glowX) * 0.16;
  glowY += (targetY - glowY) * 0.16;
  if (spotlight) {
    spotlight.style.transform = `translate3d(${glowX}px, ${glowY}px, 0)`;
  }
  rafId = requestAnimationFrame(tick);
}

function onMove(e) {
  targetX = e.clientX;
  targetY = e.clientY;
  if (!visible) {
    visible = true;
    // Snap the glow near the cursor on first appearance so it doesn't
    // slide in from a stale position.
    glowX = targetX;
    glowY = targetY;
    if (spotlight) spotlight.classList.add("is-visible");
  }
}

function onOver(e) {
  const t = e.target;
  if (!(t instanceof Element)) return;
  const isInteractive = Boolean(t.closest(INTERACTIVE_SELECTOR));
  if (isInteractive !== lastInteractive) {
    lastInteractive = isInteractive;
    if (spotlight) spotlight.classList.toggle("is-expanded", isInteractive);
  }
}

function onLeave() {
  visible = false;
  lastInteractive = false;
  if (spotlight) spotlight.classList.remove("is-visible", "is-expanded");
}

function onEnter() {
  // Re-show when the pointer re-enters the window; the next mousemove
  // will set a fresh position.
  if (visible && spotlight) spotlight.classList.add("is-visible");
}

function attach() {
  if (active) return;
  active = true;
  createElements();
  document.addEventListener("mousemove", onMove, { passive: true });
  document.addEventListener("mouseover", onOver, { passive: true });
  document.addEventListener("mouseleave", onLeave);
  document.addEventListener("mouseenter", onEnter);
  rafId = requestAnimationFrame(tick);
}

function detach() {
  if (!active) return;
  active = false;
  cancelAnimationFrame(rafId);
  document.removeEventListener("mousemove", onMove);
  document.removeEventListener("mouseover", onOver);
  document.removeEventListener("mouseleave", onLeave);
  document.removeEventListener("mouseenter", onEnter);
  if (spotlight) spotlight.remove();
  spotlight = null;
  visible = false;
  lastInteractive = false;
}

function initCursor({ force = false } = {}) {
  // On touch / coarse pointer devices, never enable.
  if (isTouchPrimary()) {
    document.documentElement.dataset.cursor = "off";
    detach();
    return;
  }
  // Respect reduced-motion: the trailing glow is purely decorative.
  if (prefersReducedMotion() && !force) {
    document.documentElement.dataset.cursor = "off";
    detach();
    return;
  }
  if (!isFinePointer() && !force) {
    document.documentElement.dataset.cursor = "off";
    detach();
    return;
  }
  document.documentElement.dataset.cursor = "spotlight";
  attach();
}

function destroyCursor() {
  document.documentElement.dataset.cursor = "off";
  detach();
}

function setCursorEnabled(enabled) {
  if (enabled) initCursor({ force: true });
  else destroyCursor();
}

// Public API
export { initCursor, destroyCursor, setCursorEnabled };
