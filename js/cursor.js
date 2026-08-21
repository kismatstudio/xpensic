// ──────────────────────────────────────────────────────────────────────────
// Custom cursor — solid black dot + smooth trailing ring.
// Hovering a *real* button scales the dot up and highlights the button
// with a solid black background + white text.
//
// Design rules:
//   • No mix-blend-mode. mix-blend-mode: difference inverts black against
//     dark backgrounds, which made the cursor nearly invisible on the
//     glassmorphic UI. We use solid colors + a soft glow instead.
//   • The black highlight is applied ONLY to actual <button>/.btn/.icon-btn
//     elements (not text inputs, selects, labels, or generic glass cards).
//   • Buttons keep their pill shape (border-radius) — the highlight never
//     turns them into rectangles.
//   • On hover, the dot scales from 10px → 14px, the ring expands to 44px,
//     and a soft black glow appears around the hovered button.
// ──────────────────────────────────────────────────────────────────────────

// Elements that should get the black "pill" highlight when hovered.
// We restrict this to actual buttons / button-like controls so that
// <select>, <input type="text">, labels, and glass cards don't get an
// out-of-shape rectangle painted behind them.
const BUTTON_SELECTOR = [
  "button:not([disabled])",
  ".btn",
  ".icon-btn",
  ".theme-toggle",
  ".month-picker button",
  "[role='button']:not([disabled])",
  "[role='tab']",
  "[role='radio']",
  "[role='checkbox']",
  "[data-clickable]",
  ".fab",
].join(",");

// Broader set used to *scale* the cursor dot/ring, but NOT to recolour
// the underlying element. This makes the cursor feel responsive as it
// passes over links, glass cards, list items, etc., without forcing the
// entire surface to flip to black.
const HOVER_SELECTOR = [
  "a",
  ...BUTTON_SELECTOR.split(","),
  "label",
  "[role='link']",
  "summary",
  ".nav-link",
  ".app-nav__profile-link",
  ".cat-list__item",
  ".recent-item",
  ".budget-list__item",
  ".split-list__item",
  ".kpi",
  ".glass-card",
  ".quick-add__field",
  ".quick-add__input",
  ".insight",
  ".tx-card",
  ".goal-card",
  ".insight__icon",
  ".hero-card__streak",
  ".cat-swatch",
].join(",");

// Form controls that should NEVER trigger the highlight (they get the
// native text-cursor instead, signalled by reverting to the default
// "text" cursor shape on top of the custom cursor).
const IGNORE_SELECTOR = [
  "input:not([type='checkbox']):not([type='radio']):not([type='submit']):not([type='button'])",
  "textarea",
  "select",
].join(",");

let dot = null;
let ring = null;
let active = false;
let reducedMotion = false;
let targetX = 0;
let targetY = 0;
let ringX = 0;
let ringY = 0;
let rafId = 0;
let lastHovered = null;
let lastButtonTarget = null;

function isFinePointer() {
  return window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function isTouchPrimary() {
  return window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
}

function createElements() {
  if (dot) return;
  dot = document.createElement("div");
  dot.id = "cursor-dot";
  dot.className = "cursor-dot";
  ring = document.createElement("div");
  ring.id = "cursor-ring";
  ring.className = "cursor-ring";
  document.body.appendChild(ring);   // ring first so the dot sits on top
  document.body.appendChild(dot);
}

function styleElements() {
  if (!dot || !ring) return;
  // Dot — a solid black circle. No blend mode so it stays black on every
  // background, including the dark glass UI. A white halo + a soft drop
  // shadow keep it visible on both light and dark surfaces.
  Object.assign(dot.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "12px",
    height: "12px",
    background: "#000000",
    borderRadius: "50%",
    pointerEvents: "none",
    zIndex: "10001",
    transform: "translate3d(-50%, -50%, 0)",
    transition:
      "width 180ms cubic-bezier(0.16, 1, 0.3, 1), " +
      "height 180ms cubic-bezier(0.16, 1, 0.3, 1), " +
      "opacity 180ms ease, " +
      "box-shadow 220ms ease",
    willChange: "transform",
    boxShadow:
      "0 0 0 2px #FFFFFF, " +
      "0 4px 10px rgba(0, 0, 0, 0.35)",
  });
  // Ring — a black ring with a soft white fill so it reads on every
  // background, even on the dark glass cards.
  Object.assign(ring.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "40px",
    height: "40px",
    border: "2px solid #000000",
    borderRadius: "50%",
    pointerEvents: "none",
    zIndex: "10000",
    transform: "translate3d(-50%, -50%, 0)",
    transition:
      "width 220ms cubic-bezier(0.16, 1, 0.3, 1), " +
      "height 220ms cubic-bezier(0.16, 1, 0.3, 1), " +
      "border-color 220ms ease, " +
      "background 220ms ease, " +
      "opacity 220ms ease",
    willChange: "transform",
    background: "rgba(255, 255, 255, 0.18)",
    boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.4)",
  });
}

function tick() {
  // Smooth lerp from current ring position to target (the mouse).
  // The dot snaps directly to the target so it feels precise.
  const lerp = reducedMotion ? 1 : 0.22;
  ringX += (targetX - ringX) * lerp;
  ringY += (targetY - ringY) * lerp;
  if (dot) dot.style.transform = `translate3d(${targetX}px, ${targetY}px, 0) translate(-50%, -50%)`;
  if (ring) ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0) translate(-50%, -50%)`;
  rafId = requestAnimationFrame(tick);
}

function onMove(e) {
  targetX = e.clientX;
  targetY = e.clientY;
  if (dot && dot.style.opacity !== "1") dot.style.opacity = "1";
  if (ring && ring.style.opacity !== "0.6") ring.style.opacity = "0.6";
}

function onOver(e) {
  const t = e.target;
  if (!(t instanceof Element)) return;

  // Text-input controls keep the text caret (we just scale the dot
  // a touch so the user still gets a hover affordance).
  if (t.matches && t.matches(IGNORE_SELECTOR)) {
    setTextHover(true);
    clearButtonHighlight();
    return;
  }

  // First, see if we're hovering a *real button*. If so, paint the pill
  // highlight behind it.
  const buttonTarget = closestMatch(t, BUTTON_SELECTOR);
  applyButtonHighlight(buttonTarget);

  // Then, decide whether to scale the dot/ring. We scale over a wider
  // set of hoverable elements (links, glass cards, list rows…).
  const hoverTarget = closestMatch(t, HOVER_SELECTOR);
  setDotHover(Boolean(hoverTarget));

  // If we landed on a text input, prefer that look.
  if (buttonTarget) setTextHover(false);
  else setTextHover(t.matches && t.matches(IGNORE_SELECTOR));
}

function closestMatch(el, selector) {
  if (!el || !(el instanceof Element)) return null;
  if (typeof selector !== "string") return null;
  // `closest` walks up the DOM looking for a match.
  const m = el.closest(selector);
  return m || null;
}

function applyButtonHighlight(buttonTarget) {
  if (lastButtonTarget && lastButtonTarget !== buttonTarget) {
    lastButtonTarget.classList.remove("is-cursor-target");
    lastButtonTarget = null;
  }
  if (buttonTarget && buttonTarget !== lastButtonTarget) {
    buttonTarget.classList.add("is-cursor-target");
    lastButtonTarget = buttonTarget;
  }
}

function clearButtonHighlight() {
  if (lastButtonTarget) {
    lastButtonTarget.classList.remove("is-cursor-target");
    lastButtonTarget = null;
  }
}

function setDotHover(on) {
  if (!dot || !ring) return;
  if (on) {
    // Scale the dot up, expand the ring, give the dot a glow halo.
    dot.style.width = "18px";
    dot.style.height = "18px";
    dot.style.boxShadow =
      "0 0 0 2px #FFFFFF, " +
      "0 0 16px 4px rgba(0, 0, 0, 0.45), " +
      "0 6px 14px rgba(0, 0, 0, 0.40)";
    ring.style.width = "56px";
    ring.style.height = "56px";
    ring.style.borderColor = "#000000";
    ring.style.background = "rgba(0, 0, 0, 0.10)";
  } else {
    dot.style.width = "12px";
    dot.style.height = "12px";
    dot.style.boxShadow =
      "0 0 0 2px #FFFFFF, " +
      "0 4px 10px rgba(0, 0, 0, 0.35)";
    ring.style.width = "40px";
    ring.style.height = "40px";
    ring.style.borderColor = "#000000";
    ring.style.background = "rgba(255, 255, 255, 0.18)";
  }
}

function setTextHover(on) {
  if (!dot) return;
  if (on) {
    // Make the dot a thin I-beam-ish line when over text inputs.
    dot.style.width = "3px";
    dot.style.height = "18px";
    dot.style.borderRadius = "2px";
    dot.style.boxShadow = "0 0 0 1px rgba(255, 255, 255, 0.6)";
  } else {
    dot.style.borderRadius = "50%";
  }
}

function onDown() {
  if (!dot) return;
  dot.style.transform = `translate3d(${targetX}px, ${targetY}px, 0) translate(-50%, -50%) scale(0.65)`;
}
function onUp() {
  if (!dot) return;
  dot.style.transform = `translate3d(${targetX}px, ${targetY}px, 0) translate(-50%, -50%)`;
}

function onLeave() {
  if (dot) dot.style.opacity = "0";
  if (ring) ring.style.opacity = "0";
  clearButtonHighlight();
  setDotHover(false);
  lastHovered = null;
}

function onEnter() {
  if (dot) dot.style.opacity = "1";
  if (ring) ring.style.opacity = "0.6";
}

function attach() {
  if (active) return;
  active = true;
  createElements();
  styleElements();
  document.addEventListener("mousemove", onMove, { passive: true });
  document.addEventListener("mouseover", onOver, { passive: true });
  document.addEventListener("mousedown", onDown);
  document.addEventListener("mouseup", onUp);
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
  document.removeEventListener("mousedown", onDown);
  document.removeEventListener("mouseup", onUp);
  document.removeEventListener("mouseleave", onLeave);
  document.removeEventListener("mouseenter", onEnter);
  clearButtonHighlight();
  setDotHover(false);
  if (dot) dot.remove();
  if (ring) ring.remove();
  dot = null;
  ring = null;
}

function initCursor({ force = false } = {}) {
  reducedMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // On touch / coarse pointer devices, never enable.
  if (isTouchPrimary()) {
    document.documentElement.dataset.cursor = "off";
    detach();
    return;
  }
  if (!isFinePointer() && !force) {
    document.documentElement.dataset.cursor = "off";
    detach();
    return;
  }
  document.documentElement.dataset.cursor = "on";
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
