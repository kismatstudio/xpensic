// Small shared utilities used across views and components.

// ---------------------------------------------------------------------------
// Profile helpers (login gate + drawer)
// ---------------------------------------------------------------------------

/**
 * Validates a 10-digit Indian mobile number. Accepts the common variants the
 * user might type ("9876543210", "91 98765 43210", "+91-9876543210") and
 * returns just the 10 digits in `value`, or an error otherwise.
 */
export function validateIndianPhone(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    return { ok: true, value: digits.slice(2) };
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    return { ok: true, value: digits.slice(1) };
  }
  if (digits.length === 10) {
    return { ok: true, value: digits };
  }
  return { ok: false, error: "Enter a 10-digit Indian mobile number." };
}

/** Formats a 10-digit phone as "+91 98XXX XXXXX" for display. */
export function formatIndianPhone(digits) {
  const d = String(digits || "").replace(/\D/g, "").slice(-10);
  if (d.length !== 10) return "";
  return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
}

/**
 * Generates a small SVG avatar (initials on a colored background) and returns
 * it as a data: URL. The color is derived deterministically from the phone
 * number (or name as a fallback) so the avatar is stable across reloads.
 *
 * No network calls, no file uploads — just an inline SVG string.
 */
export function generateAvatarDataUrl({ name, phone } = {}) {
  const initials = getInitials(name) || "U";
  const palette = [
    "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#a855f7",
    "#ec4899", "#06b6d4", "#64748b", "#84cc16", "#f97316",
  ];
  // Hash the phone (or name) into a stable color index.
  const seed = String(phone || name || "user");
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const color = palette[h % palette.length];

  // 96×96 is plenty for a 32–40px chip; bigger numbers just bloat the data URL.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">` +
    `<rect width="96" height="96" rx="48" fill="${escapeAttr(color)}"/>` +
    `<text x="50%" y="50%" text-anchor="middle" dy=".35em" ` +
    `font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" ` +
    `font-size="42" font-weight="600" fill="#ffffff">${escapeAttr(initials)}</text>` +
    `</svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

/** Pulls 1–2 initials out of a name; uppercase; falls back to "" when empty. */
function getInitials(name) {
  const s = String(name || "").trim();
  if (!s) return "";
  const parts = s.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0] || "").join("").toUpperCase();
}

/** Minimal attribute escape for inline SVG. */
function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---------------------------------------------------------------------------
// Built-in animal avatar pack
// ---------------------------------------------------------------------------
// The Profile-edit modal lets the user pick one of these as their avatar
// instead of uploading a photo. Each entry is a tiny inline SVG drawn from
// generic geometric primitives — no third-party assets, no copyrighted
// illustrations, no real photographs.
//
// The twelve animals are widely recognizable species that have been
// depicted as generic symbols in art and culture for centuries (and most
// of which the user's own camera will produce on a casual trip to a zoo
// or wildlife park). They are drawn as abstract silhouettes with distinct
// shape + color so the user can pick one by feel.
//
// Why no real likenesses/IP: stylized representations of common animal
// shapes (round cat head + ears, oval head with trunk + ear flap, bird
// silhouette with wings) are not copyrightable expression. We're not
// drawing "the tiger from movie X" — we're drawing "a tiger", which is a
// shared cultural symbol. Each entry is built from primitives (paths,
// circles, ellipses) that any SVG tutorial would teach.
//
// `shape` selects the silhouette. Each shape keeps the same simple layout
// — a circular gradient background, the animal silhouette overlay, and a
// small chest emblem with the first letter of the animal name.

// Built-in animal avatar pack — 12 characters, each with a personal
// finance theme. Drawn from SVG primitives only (no third-party assets,
// no copyrighted likenesses, no real photographs). Each silhouette is
// a generic, easily-recognizable animal rendered in a rounded,
// "Pixar-style" cartoon aesthetic — soft shapes, expressive eyes, and
// a themed prop (coin, calculator, target, bar chart, etc.) that gives
// the avatar its character.
//
// Why no real likenesses/IP: stylized representations of common animal
// shapes (round elephant head + ears, oval bird with wings, fluffy bee
// body) are not copyrightable expression. We're not drawing "the tiger
// from movie X" — we're drawing "an elephant", which is a shared cultural
// symbol. Each entry is built from primitives (paths, circles, ellipses,
// gradients) that any SVG tutorial would teach.
//
// Each entry has a palette (fur / belly / accent / eye) so the result
// reads as a real illustration rather than a flat logo. The prop shape
// selector (e.g. "coin", "calculator", "piggy_bank") picks which themed
// accessory sits next to the animal — matching the avatar picker grid.

const HERO_AVATARS = [
  // 1. Elephant — Financial Wisdom (gold coin)
  { id: "animal_elephant", name: "Elephant", file: "elephant.png", shape: "elephant",
    palette: { fur: "#a8b4c8", belly: "#e6ebf2", accent: "#5b6b80", eye: "#1a2230", cheek: "#f4a8b8" },
    prop: "coin",       letter: "E", tagline: "Financial Wisdom" },
  // 2. Owl — Smart Budgeting (book + calculator)
  { id: "animal_owl",     name: "Owl",     file: "owl.png",     shape: "owl",
    palette: { fur: "#8b6b3a", belly: "#f4e4c1", accent: "#3b2412", eye: "#fef3c7", cheek: "#f4a8b8" },
    prop: "calculator", letter: "O", tagline: "Smart Budgeting" },
  // 3. Fox — Best Deals & Discounts (percent tag)
  { id: "animal_fox",     name: "Fox",     file: "fox.png",     shape: "fox",
    palette: { fur: "#ef6b3a", belly: "#fff7ed", accent: "#7a3412", eye: "#1a2230", cheek: "#f4a8b8" },
    prop: "percent",     letter: "F", tagline: "Best Deals & Discounts" },
  // 4. Squirrel — Saving Money (stacked coins)
  { id: "animal_squirrel", name: "Squirrel", file: "squirrel.png", shape: "squirrel",
    palette: { fur: "#c76339", belly: "#fce4cf", accent: "#5b2c14", eye: "#1a2230", cheek: "#f4a8b8" },
    prop: "coins",       letter: "S", tagline: "Saving Money" },
  // 5. Ant — Expense Discipline (pencil + chart)
  { id: "animal_ant",     name: "Ant",     file: "ant.png",     shape: "ant",
    palette: { fur: "#3a2418", belly: "#5b3a24", accent: "#1a1208", eye: "#ffffff", cheek: "#f4a8b8" },
    prop: "chart",       letter: "A", tagline: "Expense Discipline" },
  // 6. Eagle — Financial Goals (target / bullseye)
  { id: "animal_eagle",   name: "Eagle",   file: "eagle.png",   shape: "eagle",
    palette: { fur: "#1e3a5f", belly: "#fef3c7", accent: "#0f1f3a", eye: "#fef3c7", cheek: "#f4a8b8" },
    prop: "target",      letter: "E", tagline: "Financial Goals" },
  // 7. Turtle — Long-Term Investing (piggy bank)
  { id: "animal_turtle",  name: "Turtle",  file: "turtle.png",  shape: "turtle",
    palette: { fur: "#3a8048", belly: "#cce8d4", accent: "#1a4a24", eye: "#1a2230", cheek: "#f4a8b8" },
    prop: "piggy",       letter: "T", tagline: "Long-Term Investing" },
  // 8. Bee — Consistent Income (honey + dollar)
  { id: "animal_bee",     name: "Bee",     file: "bee.png",     shape: "bee",
    palette: { fur: "#f5b820", belly: "#fff7ed", accent: "#1a1208", eye: "#1a2230", cheek: "#f4a8b8" },
    prop: "honey",       letter: "B", tagline: "Consistent Income" },
  // 9. Bear — Safe Spending (shield + check)
  { id: "animal_bear",    name: "Bear",    file: "bear.png",    shape: "bear",
    palette: { fur: "#7a4a2a", belly: "#f4d4b0", accent: "#3b1f0a", eye: "#1a2230", cheek: "#f4a8b8" },
    prop: "shield",      letter: "B", tagline: "Safe Spending" },
  // 10. Wolf — Independent Earner (mountain badge)
  { id: "animal_wolf",    name: "Wolf",    file: "wolf.png",    shape: "wolf",
    palette: { fur: "#5b6b80", belly: "#d4dce6", accent: "#2a3548", eye: "#fbbf24", cheek: "#f4a8b8" },
    prop: "mountain",    letter: "W", tagline: "Independent Earner" },
  // 11. Rhino — Financial Strength (storm shield)
  { id: "animal_rhino",   name: "Rhino",   file: "rhino.png",   shape: "rhino",
    palette: { fur: "#7a8090", belly: "#c8ccd4", accent: "#2a2e36", eye: "#fbbf24", cheek: "#f4a8b8" },
    prop: "shield",      letter: "R", tagline: "Financial Strength" },
  // 12. Leopard — Fast Growth (rising bar chart)
  { id: "animal_leopard", name: "Leopard", file: "leopard.png", shape: "leopard",
    palette: { fur: "#e8a020", belly: "#fef3c7", accent: "#3b2412", eye: "#1a6b3a", cheek: "#f4a8b8" },
    prop: "growth",      letter: "L", tagline: "Fast Growth" },
];

/**
 * Look up a built-in animal by id. Unknown ids fall back to the first
 * entry so the picker never returns undefined.
 */
export function getHeroAvatar(id) {
  return HERO_AVATARS.find((h) => h.id === id) || HERO_AVATARS[0];
}

/** Return the list of built-in animals — used by the picker UI.
 *  The `bg` field carries the primary `fur` colour so the picker
 *  swatch (a small filled circle) reads as the animal's main hue. */
export function listHeroAvatars() {
  return HERO_AVATARS.map((h) => ({ id: h.id, name: h.name, bg: h.palette.fur, tagline: h.tagline }));
}

/**
 * Tiny helper for inline `<circle>` elements. We keep them as template
 * strings (with simple `&` -> `&amp;` attribute safety) so the SVG stays
 * human-readable in DevTools.
 */
function heroCircle(x, y, r, fill, opacity) {
  const op = opacity !== undefined ? ` opacity="${opacity}"` : "";
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"${op}/>`;
}

/**
 * Pixar-style eye: a layered cartoon eye with a dark iris, a coloured
 * pupil, a tiny white catch-light, and a subtle lower-shadow for depth.
 * Used by every animal.
 *
 * Premium upgrade (Phase 12):
 *   • Larger sclera + softer outer ring for a friendlier "kawaii" read.
 *   • Multi-stop iris gradient (darker at top, lighter at bottom) so the
 *     eye has physical depth like a real PBR render.
 *   • A bigger, brighter primary catch-light plus a secondary rim-light
 *     spark — the cinematic "Pixar eye shine" trick.
 *   • Subtle upper eyelid shadow painted as an arc for added dimension.
 */
function pixarEye(cx, cy, scale = 1) {
  const r = 7.2 * scale;
  const iris = 5.4 * scale;
  const pupil = 2.6 * scale;
  // Per-eye gradient id so multiple eyes on one canvas don't collide.
  // We hash the coords to keep the id short and unique-ish.
  const gid = `eye_${Math.round(cx)}_${Math.round(cy)}`;
  return (
    // Outer soft halo (very faint) so the eye doesn't sit flat against fur
    `<ellipse cx="${cx}" cy="${cy + 1.2 * scale}" rx="${r + 0.6 * scale}" ry="${(r + 0.6 * scale) * 0.85}" fill="#ffffff" opacity="0.85"/>` +
    // Sclera (white of the eye)
    `<ellipse cx="${cx}" cy="${cy + 1.2 * scale}" rx="${r}" ry="${r * 0.85}" fill="#ffffff"/>` +
    // Iris with a top-down gradient for depth
    `<defs><radialGradient id="${gid}" cx="50%" cy="35%" r="65%">` +
      `<stop offset="0" stop-color="#3b4860"/>` +
      `<stop offset="0.6" stop-color="#1a2230"/>` +
      `<stop offset="1" stop-color="#0a0f18"/>` +
    `</radialGradient></defs>` +
    `<ellipse cx="${cx}" cy="${cy + 1.2 * scale}" rx="${iris}" ry="${iris * 0.85}" fill="url(#${gid})"/>` +
    // Pupil — small dark dot inside the iris
    `<ellipse cx="${cx}" cy="${cy + 1.4 * scale}" rx="${pupil}" ry="${pupil * 0.95}" fill="#000000"/>` +
    // Primary catch-light (big, bright) — top-left
    `<ellipse cx="${cx + 1.0 * scale}" cy="${cy - 1.8 * scale}" rx="${1.9 * scale}" ry="${1.5 * scale}" fill="#ffffff"/>` +
    // Secondary catch-light (small, subtle) — bottom-right for double-spark
    `<circle cx="${cx + 2.6 * scale}" cy="${cy + 2.4 * scale}" r="${0.6 * scale}" fill="#ffffff" opacity="0.9"/>` +
    // Upper eyelid shadow arc — soft dark crescent across the top of the eye
    `<path d="M ${cx - r * 0.95} ${cy - r * 0.05} Q ${cx} ${cy - r * 0.85} ${cx + r * 0.95} ${cy - r * 0.05}" stroke="#0a0f18" stroke-width="${0.8 * scale}" fill="none" stroke-linecap="round" opacity="0.55"/>`
  );
}

/**
 * Returns the themed prop accessory that sits next to / in the paws of
 * each animal — matching the picker grid (coin, calculator, percent,
 * coins, chart, target, piggy, honey, shield, mountain, growth).
 *
 * Premium upgrade (Phase 12): every prop now uses radial gradients for
 * PBR-style lighting, drop-shadow + rim-highlight strokes for that
 * metallic/glass "lifted off the page" feel, and inner embossing on
 * the text so the glyphs read as 3D rather than flat ink.
 */
function heroProp(prop, palette) {
  const accent = palette.accent;
  const fur = palette.fur;
  const cheek = palette.cheek || "#f4a8b8";
  switch (prop) {
    case "coin":
      // Gold coin with a "$" emblem — held by the elephant.
      // PBR: dark-gold outer rim, polished mid-tone, bright top-left highlight,
      // and a darker bottom-right shadow for that minted-coin feel.
      return (
        `<defs><radialGradient id="g_coin" cx="35%" cy="30%" r="75%">` +
          `<stop offset="0" stop-color="#fde68a"/>` +
          `<stop offset="0.4" stop-color="#f5b820"/>` +
          `<stop offset="1" stop-color="#a87a0a"/>` +
        `</radialGradient></defs>` +
        `<circle cx="20" cy="74" r="9.5" fill="#7a4a0a" opacity="0.5"/>` +
        `<circle cx="20" cy="74" r="9" fill="url(#g_coin)"/>` +
        `<circle cx="20" cy="74" r="9" fill="none" stroke="#a87a0a" stroke-width="1.2"/>` +
        `<circle cx="18" cy="71" r="3" fill="#fef3c7" opacity="0.85"/>` +
        `<circle cx="22.5" cy="77" r="1.2" fill="#5a3a08" opacity="0.5"/>` +
        `<text x="20" y="78" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="10" font-weight="800" fill="#5a3a08" opacity="0.6">$</text>` +
        `<text x="20" y="77.5" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="10" font-weight="800" fill="#fde68a">$</text>`
      );
    case "calculator":
      // Calculator + book the owl is holding.
      // Brushed-metal body with a tinted glass screen and 3D keys.
      return (
        `<defs><linearGradient id="g_calc" x1="0" y1="0" x2="0" y2="1">` +
          `<stop offset="0" stop-color="#2a3548"/>` +
          `<stop offset="1" stop-color="#0a0f18"/>` +
        `</linearGradient></defs>` +
        `<rect x="13.5" y="67.5" width="15" height="15" rx="2.5" fill="#0a0f18" opacity="0.5"/>` +
        `<rect x="14" y="68" width="14" height="14" rx="2" fill="url(#g_calc)"/>` +
        // Screen with a slight green LCD tint
        `<rect x="16" y="70" width="10" height="3" rx="0.5" fill="#3a8048"/>` +
        `<rect x="16" y="70" width="10" height="3" rx="0.5" fill="none" stroke="#1a4a24" stroke-width="0.4"/>` +
        `<rect x="16.5" y="70.5" width="3" height="2" fill="#86efac" opacity="0.6"/>` +
        // Keys — each with a tiny inset highlight for 3D
        `<rect x="16" y="74" width="2" height="2" rx="0.4" fill="#cbd5e1"/>` +
        `<rect x="19" y="74" width="2" height="2" rx="0.4" fill="#cbd5e1"/>` +
        `<rect x="22" y="74" width="2" height="2" rx="0.4" fill="#cbd5e1"/>` +
        `<rect x="16" y="77" width="2" height="2" rx="0.4" fill="#cbd5e1"/>` +
        `<rect x="19" y="77" width="2" height="2" rx="0.4" fill="#fbbf24"/>` +
        `<rect x="22" y="77" width="2" height="2" rx="0.4" fill="#cbd5e1"/>` +
        `<rect x="16" y="80" width="8" height="1.5" rx="0.3" fill="#cbd5e1"/>` +
        // Top sheen highlight on the body
        `<rect x="14" y="68" width="14" height="1.5" rx="0.5" fill="#ffffff" opacity="0.18"/>`
      );
    case "percent":
      // Green % price tag the fox is holding.
      return (
        `<defs><linearGradient id="g_tag" x1="0" y1="0" x2="0" y2="1">` +
          `<stop offset="0" stop-color="#4ade80"/>` +
          `<stop offset="1" stop-color="#166534"/>` +
        `</linearGradient></defs>` +
        `<path d="M14 64 L24 74 L20 82 L10 72 Z" fill="#0a3a1a" opacity="0.45"/>` +
        `<path d="M14 64 L24 74 L20 82 L10 72 Z" fill="url(#g_tag)"/>` +
        `<path d="M14 64 L24 74 L20 82 L10 72 Z" fill="none" stroke="#0a3a1a" stroke-width="0.8"/>` +
        // Tag hole (the eyelet for the string)
        `<circle cx="11" cy="71" r="1.6" fill="#fde68a"/>` +
        `<circle cx="11" cy="71" r="0.8" fill="#0a3a1a"/>` +
        // Embossed %
        `<text x="16" y="75.5" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="9" font-weight="800" fill="#0a3a1a" opacity="0.6">%</text>` +
        `<text x="16" y="75" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="9" font-weight="800" fill="#f0fdf4">%</text>` +
        // Sheen on the tag surface
        `<path d="M12 66 L21 75" stroke="#ffffff" stroke-width="0.6" opacity="0.5"/>`
      );
    case "coins":
      // Stack of gold coins the squirrel is clutching.
      return (
        `<defs><radialGradient id="g_coinstack" cx="35%" cy="30%" r="75%">` +
          `<stop offset="0" stop-color="#fde68a"/>` +
          `<stop offset="0.5" stop-color="#f5b820"/>` +
          `<stop offset="1" stop-color="#a87a0a"/>` +
        `</radialGradient></defs>` +
        `<ellipse cx="22" cy="78.5" rx="8.2" ry="2.7" fill="#5a3a08" opacity="0.4"/>` +
        `<rect x="14" y="72" width="16" height="6" fill="url(#g_coinstack)"/>` +
        `<ellipse cx="22" cy="72" rx="8" ry="2.5" fill="#fde68a"/>` +
        `<ellipse cx="22" cy="74" rx="8" ry="2.5" fill="#a87a0a"/>` +
        `<rect x="14" y="68" width="16" height="6" fill="url(#g_coinstack)"/>` +
        `<ellipse cx="22" cy="68" rx="8" ry="2.5" fill="#fde68a"/>` +
        `<ellipse cx="22" cy="69.5" rx="6" ry="1.2" fill="#fef3c7" opacity="0.7"/>` +
        `<text x="22" y="72.5" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="6" font-weight="800" fill="#5a3a08" opacity="0.6">$</text>` +
        `<text x="22" y="72" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="6" font-weight="800" fill="#fde68a">$</text>`
      );
    case "chart":
      // Bar chart the ant is pointing at. Up-trending green bars + sparkline.
      return (
        `<rect x="14" y="78" width="3" height="6" rx="0.5" fill="#1e4a6b"/>` +
        `<rect x="14" y="78" width="3" height="2" rx="0.5" fill="#5b9fc7"/>` +
        `<rect x="18" y="74" width="3" height="10" rx="0.5" fill="#1e4a6b"/>` +
        `<rect x="18" y="74" width="3" height="2" rx="0.5" fill="#5b9fc7"/>` +
        `<rect x="22" y="70" width="3" height="14" rx="0.5" fill="#1e4a6b"/>` +
        `<rect x="22" y="70" width="3" height="2" rx="0.5" fill="#5b9fc7"/>` +
        `<rect x="26" y="64" width="3" height="20" rx="0.5" fill="#1a4a24"/>` +
        `<rect x="26" y="64" width="3" height="2" rx="0.5" fill="#4ade80"/>` +
        // Sparkline drawn over the bars
        `<path d="M14 70 L18 67 L22 64 L26 60 L29 58" stroke="#fde68a" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
        // Tiny glow dot at the end of the sparkline
        `<circle cx="29" cy="58" r="1.2" fill="#fde68a"/>` +
        `<circle cx="29" cy="58" r="0.6" fill="#ffffff"/>`
      );
    case "target":
      // Bullseye target the eagle is staring at.
      return (
        `<defs><radialGradient id="g_target" cx="35%" cy="35%" r="70%">` +
          `<stop offset="0" stop-color="#ffffff"/>` +
          `<stop offset="1" stop-color="#d1d5db"/>` +
        `</radialGradient></defs>` +
        `<circle cx="20" cy="74" r="9.5" fill="#0a0f18" opacity="0.45"/>` +
        `<circle cx="20" cy="74" r="9" fill="url(#g_target)"/>` +
        `<circle cx="20" cy="74" r="9" fill="none" stroke="#1a2230" stroke-width="0.6"/>` +
        `<circle cx="20" cy="74" r="6" fill="#dc2626"/>` +
        `<circle cx="20" cy="74" r="6" fill="none" stroke="#7f1d1d" stroke-width="0.4"/>` +
        `<circle cx="20" cy="74" r="3" fill="#ffffff"/>` +
        `<circle cx="20" cy="74" r="1.5" fill="#dc2626"/>` +
        // Crosshair ticks
        `<path d="M20 64 L20 60 M20 88 L20 84 M10 74 L14 74 M30 74 L26 74" stroke="#1a2230" stroke-width="1.3" stroke-linecap="round"/>` +
        // Highlight arc on the outer ring
        `<path d="M13 70 Q15 65 19 63" stroke="#ffffff" stroke-width="0.8" fill="none" opacity="0.6" stroke-linecap="round"/>` +
        // Arrow piercing the bullseye
        `<path d="M27 67 L33 61 M27 67 L30 67 L27 67 L27 70" stroke="#fbbf24" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<circle cx="33" cy="61" r="1.2" fill="#fbbf24"/>` +
        `<circle cx="33" cy="61" r="0.5" fill="#ffffff"/>`
      );
    case "piggy":
      // Pink piggy bank the turtle is hugging. Glassy ceramic body + shiny snout.
      return (
        `<defs><radialGradient id="g_piggy" cx="35%" cy="30%" r="75%">` +
          `<stop offset="0" stop-color="#fbcfe8"/>` +
          `<stop offset="0.6" stop-color="#f4a8b8"/>` +
          `<stop offset="1" stop-color="#9d4a5a"/>` +
        `</radialGradient></defs>` +
        `<ellipse cx="22" cy="76.5" rx="9.2" ry="6.2" fill="#5a2a30" opacity="0.4"/>` +
        `<ellipse cx="22" cy="76" rx="9" ry="6" fill="url(#g_piggy)"/>` +
        `<ellipse cx="22" cy="76" rx="9" ry="6" fill="none" stroke="#9d4a5a" stroke-width="0.5"/>` +
        // Top sheen
        `<ellipse cx="19" cy="73" rx="3.5" ry="1.5" fill="#ffffff" opacity="0.6"/>` +
        // Eye (cute button)
        `<ellipse cx="16" cy="73" rx="1.5" ry="1.5" fill="#1a2230"/>` +
        `<circle cx="16.4" cy="72.6" r="0.5" fill="#ffffff"/>` +
        // Legs
        `<rect x="12" y="80" width="2" height="3" rx="0.5" fill="#9d4a5a"/>` +
        `<rect x="30" y="80" width="2" height="3" rx="0.5" fill="#9d4a5a"/>` +
        // Ears
        `<path d="M28 73 L30 70 L32 72 L33 70 L33 75" fill="#f4a8b8" stroke="#9d4a5a" stroke-width="0.4"/>` +
        `<path d="M28.5 71.5 L30 70.5 L31.5 71.5" stroke="#fbcfe8" stroke-width="0.5" fill="none"/>` +
        // Coin slot
        `<rect x="20" y="73.5" width="3" height="0.6" rx="0.3" fill="#5a2a30"/>` +
        // Falling coin
        `<circle cx="22" cy="70" r="1.5" fill="#f5b820"/>` +
        `<circle cx="22" cy="70" r="1.5" fill="none" stroke="#a87a0a" stroke-width="0.3"/>` +
        `<text x="22" y="71" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="2.2" font-weight="800" fill="#7a4a0a">$</text>`
      );
    case "honey":
      // Hexagonal honeycomb + dollar coin the bee is buzzing around.
      return (
        `<defs><linearGradient id="g_honey" x1="0" y1="0" x2="0" y2="1">` +
          `<stop offset="0" stop-color="#fde68a"/>` +
          `<stop offset="1" stop-color="#a87a0a"/>` +
        `</linearGradient></defs>` +
        `<polygon points="14,72 18,70 22,72 22,76 18,78 14,76" fill="url(#g_honey)" stroke="#7a4a0a" stroke-width="0.4"/>` +
        `<polygon points="22,72 26,70 30,72 30,76 26,78 22,76" fill="#fde68a" stroke="#a87a0a" stroke-width="0.4"/>` +
        `<polygon points="18,78 22,76 26,78 26,82 22,84 18,82" fill="url(#g_honey)" stroke="#7a4a0a" stroke-width="0.4"/>` +
        // Sheen on the honeycombs
        `<polygon points="14.5,72 18,70.3 18,71.5 14.5,73" fill="#fef3c7" opacity="0.6"/>` +
        `<polygon points="22.5,72 26,70.3 26,71.5 22.5,73" fill="#fef3c7" opacity="0.5"/>` +
        // Center coin with golden gradient
        `<circle cx="22" cy="74" r="2.2" fill="url(#g_coin)" stroke="#7a4a0a" stroke-width="0.3"/>` +
        `<circle cx="21.3" cy="73.3" r="0.7" fill="#fef3c7" opacity="0.7"/>` +
        `<text x="22" y="76" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="3.5" font-weight="800" fill="#5a3a08" opacity="0.6">$</text>` +
        `<text x="22" y="75.5" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="3.5" font-weight="800" fill="#fde68a">$</text>`
      );
    case "shield":
      // Blue shield with a checkmark — same shield is reused for bear + rhino.
      // Metallic steel-blue with embossed check + outer rim shadow.
      return (
        `<defs><linearGradient id="g_shield" x1="0" y1="0" x2="0" y2="1">` +
          `<stop offset="0" stop-color="#60a5fa"/>` +
          `<stop offset="0.5" stop-color="#3b6b8a"/>` +
          `<stop offset="1" stop-color="#1e3a5f"/>` +
        `</linearGradient></defs>` +
        `<path d="M20 61 L29 65 L29 74 Q29 80 20 84 Q11 80 11 74 L11 65 Z" fill="#0a1f3a" opacity="0.5"/>` +
        `<path d="M20 62 L28 66 L28 74 Q28 80 20 83 Q12 80 12 74 L12 66 Z" fill="url(#g_shield)" stroke="#1e3a5f" stroke-width="0.5"/>` +
        // Inner rim highlight
        `<path d="M20 63.5 L26 67 L26 73.5" stroke="#bfdbfe" stroke-width="0.6" fill="none" opacity="0.7" stroke-linecap="round"/>` +
        // Outer rim shadow
        `<path d="M14 75 Q14 79 20 82" stroke="#0a1f3a" stroke-width="0.5" fill="none" opacity="0.6" stroke-linecap="round"/>` +
        // Embossed checkmark
        `<path d="M15.5 73 L18.5 76 L25 69.5" stroke="#1e3a5f" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>` +
        `<path d="M16 73 L19 76 L25.5 69.5" stroke="#ffffff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
        // Verification badge dot at the top
        `<circle cx="20" cy="63.5" r="1.5" fill="#fbbf24"/>` +
        `<circle cx="20" cy="63.5" r="1" fill="#fef3c7"/>`
      );
    case "mountain":
      // Mountain emblem the wolf wears. Layered peaks with snow caps + tiny stars.
      return (
        `<defs><linearGradient id="g_mtn" x1="0" y1="0" x2="0" y2="1">` +
          `<stop offset="0" stop-color="#94a3b8"/>` +
          `<stop offset="1" stop-color="#2a3548"/>` +
        `</linearGradient></defs>` +
        // Mountain base shadow
        `<path d="M11.5 81 L18 70 L22 76 L26 68 L32.5 81 Z" fill="#0a0f18" opacity="0.4"/>` +
        `<path d="M12 80 L18 70 L22 76 L26 68 L32 80 Z" fill="url(#g_mtn)" stroke="#1a2230" stroke-width="0.4"/>` +
        // Snow caps
        `<path d="M18 70 L20 73 L18 71 L17 73 Z" fill="#ffffff"/>` +
        `<path d="M26 68 L28 72 L26 70 L25 72 Z" fill="#ffffff"/>` +
        // Tiny stars (achievement sparkles)
        `<circle cx="14" cy="74" r="0.9" fill="#fbbf24"/>` +
        `<circle cx="14" cy="74" r="0.4" fill="#fef3c7"/>` +
        `<circle cx="29" cy="74" r="0.7" fill="#fbbf24"/>` +
        `<circle cx="29" cy="74" r="0.3" fill="#fef3c7"/>` +
        // Sun behind the peaks
        `<circle cx="22" cy="73" r="2" fill="#fbbf24" opacity="0.45"/>`
      );
    case "growth":
      // Up-arrow bar chart the leopard is leaping past. Glowing green bars + gold trend line.
      return (
        `<defs><linearGradient id="g_growth" x1="0" y1="1" x2="0" y2="0">` +
          `<stop offset="0" stop-color="#166534"/>` +
          `<stop offset="1" stop-color="#4ade80"/>` +
        `</linearGradient></defs>` +
        // Shadow under the bars
        `<rect x="12" y="84.5" width="4" height="0.6" rx="0.3" fill="#0a3a1a" opacity="0.5"/>` +
        `<rect x="17" y="84.5" width="4" height="0.6" rx="0.3" fill="#0a3a1a" opacity="0.5"/>` +
        `<rect x="22" y="84.5" width="4" height="0.6" rx="0.3" fill="#0a3a1a" opacity="0.5"/>` +
        `<rect x="27" y="84.5" width="4" height="0.6" rx="0.3" fill="#0a3a1a" opacity="0.5"/>` +
        // Bars
        `<rect x="12" y="78" width="4" height="6" rx="0.5" fill="url(#g_growth)"/>` +
        `<rect x="17" y="74" width="4" height="10" rx="0.5" fill="url(#g_growth)"/>` +
        `<rect x="22" y="70" width="4" height="14" rx="0.5" fill="url(#g_growth)"/>` +
        `<rect x="27" y="64" width="4" height="20" rx="0.5" fill="url(#g_growth)"/>` +
        // Top highlights on each bar
        `<rect x="12" y="78" width="4" height="1.2" rx="0.5" fill="#86efac" opacity="0.7"/>` +
        `<rect x="17" y="74" width="4" height="1.2" rx="0.5" fill="#86efac" opacity="0.7"/>` +
        `<rect x="22" y="70" width="4" height="1.2" rx="0.5" fill="#86efac" opacity="0.7"/>` +
        `<rect x="27" y="64" width="4" height="1.2" rx="0.5" fill="#86efac" opacity="0.7"/>` +
        // Trend arrow with a glow.
        // SVG forbids redefining the same attribute on a single element,
        // so the glow is drawn as a separate, wider, semi-transparent
        // path underneath the crisp stroke. Browsers silently accepted
        // the previous duplicate (`stroke-width="2.4" ... stroke-width="4"`)
        // and used the first value; strict renderers (sharp/librsvg) failed
        // outright. Splitting them keeps the visual effect identical.
        `<path d="M14 76 L28 60" stroke="#fbbf24" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.35"/>` +
        `<path d="M14 76 L28 60" stroke="#fbbf24" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<path d="M28 60 L24 60 L28 60 L28 64" stroke="#fbbf24" stroke-width="1.5" fill="none" stroke-linecap="round"/>` +
        // Arrow tip spark
        `<circle cx="28" cy="60" r="1.4" fill="#fef3c7"/>` +
        `<circle cx="28" cy="60" r="0.7" fill="#ffffff"/>`
      );
    default:
      return "";
  }
}

/**
 * Returns a horizontal sheen arc that sits along the top of a fur/skin
 * surface. Painted as a soft white stroke that fades to transparent —
 * simulates a studio key-light catching the upper contour of the head.
 *
 * Premium upgrade (Phase 12): every animal head now gets this arc so the
 * silhouette reads as lit-from-above rather than flat-coloured.
 *
 * @param {number} cx    centre x
 * @param {number} cy    centre y of the arc (top of the head)
 * @param {number} rx    horizontal radius of the arc
 * @param {number} ry    vertical radius of the arc
 */
function heroHeadSheen(cx, cy, rx, ry) {
  return (
    `<path d="M ${cx - rx} ${cy} Q ${cx} ${cy - ry} ${cx + rx} ${cy}" ` +
    `stroke="#ffffff" stroke-width="1.6" fill="none" stroke-linecap="round" opacity="0.55"/>`
  );
}

/**
 * Returns a small group of fur/feather tick marks for the top of the
 * head — short, slightly-curved strokes that hint at hair direction.
 * Adds Pixar-quality "fur texture" detail without overwhelming the
 * silhouette.
 *
 * @param {number} cx   centre x of the head
 * @param {number} cy   top-of-head y
 * @param {number} rx   spread radius (how wide the cluster is)
 */
function heroFurTufts(cx, cy, rx, color) {
  // Three small arcs at different angles — like wisps of fur on top.
  return (
    `<path d="M ${cx - rx * 0.6} ${cy + 0.3} Q ${cx - rx * 0.55} ${cy - 0.8} ${cx - rx * 0.35} ${cy - 1.2}" stroke="${color}" stroke-width="0.5" fill="none" stroke-linecap="round" opacity="0.6"/>` +
    `<path d="M ${cx - rx * 0.1} ${cy - 0.4} Q ${cx - rx * 0.05} ${cy - 1.6} ${cx + rx * 0.15} ${cy - 1.8}" stroke="${color}" stroke-width="0.5" fill="none" stroke-linecap="round" opacity="0.6"/>` +
    `<path d="M ${cx + rx * 0.4} ${cy + 0.2} Q ${cx + rx * 0.55} ${cy - 0.6} ${cx + rx * 0.7} ${cy - 0.4}" stroke="${color}" stroke-width="0.5" fill="none" stroke-linecap="round" opacity="0.6"/>`
  );
}

/**
 * Returns an SVG fragment for the chosen animal, drawn in a rounded,
 * Pixar-style cartoon aesthetic. Each species gets:
 *   • A rounded body shape (smooth curves, no sharp edges)
 *   • A lighter belly / muzzle panel for depth
 *   • Pixar-style big eyes with white catch-lights
 *   • Species-specific features (trunk, beak, antennae, antlers, etc.)
 *   • A themed "prop" accessory drawn from heroProp()
 *
 * Every shape is composed from SVG primitives — no third-party assets,
 * no copyrighted likenesses, no real photographs.
 *
 * Layout: animal fits inside the upper ~70px of the 96x96 viewBox; the
 * themed prop sits in the lower-left corner (rendered separately above
 * the animal so it appears the animal is holding it).
 */
function heroSilhouetteSvg(p) {
  const fur = p.palette.fur;
  const belly = p.palette.belly;
  const accent = p.palette.accent;
  const eye = p.palette.eye;
  const cheek = p.palette.cheek || "#f4a8b8";

  switch (p.shape) {
    case "elephant": {
      // Round elephant head with big floppy ears + trunk curling down to a coin.
      return (
        // Premium: studio key-light sheen on top of the head + fur tufts.
        heroHeadSheen(48, 22, 18, 5) +
        heroFurTufts(48, 22, 16, accent) +
        // Ears (drawn first so the head sits on top)
        `<ellipse cx="22" cy="40" rx="14" ry="16" fill="${fur}"/>` +
        `<ellipse cx="22" cy="40" rx="9" ry="11" fill="${cheek}" opacity="0.55"/>` +
        `<ellipse cx="74" cy="40" rx="14" ry="16" fill="${fur}"/>` +
        `<ellipse cx="74" cy="40" rx="9" ry="11" fill="${cheek}" opacity="0.55"/>` +
        // Head
        `<path d="M28 24 Q28 16 38 16 L58 16 Q68 16 68 26 L68 48 Q68 60 56 62 L52 60 L52 56 Q60 68 50 76 Q40 78 38 70 Q42 56 48 56 Q40 56 34 52 Q28 48 28 38 Z" fill="${fur}"/>` +
        // Trunk
        `<path d="M52 60 Q60 72 56 78 Q50 82 46 78 Q42 70 46 64" fill="${fur}" stroke="${accent}" stroke-width="0.5"/>` +
        // Tusk / smile accent
        `<path d="M50 64 L54 60 L52 66 Z" fill="#fff7ed"/>` +
        // Belly highlight
        `<path d="M38 50 Q48 56 58 50 Q58 58 48 60 Q38 58 38 50 Z" fill="${belly}" opacity="0.65"/>` +
        // Eyes
        pixarEye(40, 36) + pixarEye(56, 36) +
        // Eyebrows
        `<path d="M35 30 L42 28" stroke="${accent}" stroke-width="1.5" stroke-linecap="round"/>` +
        `<path d="M61 30 L54 28" stroke="${accent}" stroke-width="1.5" stroke-linecap="round"/>` +
        // Glasses (financial wisdom)
        `<circle cx="40" cy="36" r="8" fill="none" stroke="${accent}" stroke-width="1.5"/>` +
        `<circle cx="56" cy="36" r="8" fill="none" stroke="${accent}" stroke-width="1.5"/>` +
        `<line x1="48" y1="36" x2="48" y2="36" stroke="${accent}" stroke-width="1.5"/>` +
        `<path d="M32 36 L31 36 M64 36 L65 36" stroke="${accent}" stroke-width="1.5" stroke-linecap="round"/>` +
        // Cheek blush
        `<ellipse cx="34" cy="44" rx="3" ry="2" fill="${cheek}" opacity="0.6"/>` +
        `<ellipse cx="62" cy="44" rx="3" ry="2" fill="${cheek}" opacity="0.6"/>` +
        heroProp(p.prop, p.palette)
      );
    }
    case "owl": {
      // Round owl body with big eyes, small wings, and a calculator.
      return (
        // Premium: studio key-light sheen on top of the head + feather tufts.
        heroHeadSheen(48, 24, 20, 4) +
        heroFurTufts(48, 24, 18, accent) +
        // Body
        `<ellipse cx="48" cy="48" rx="26" ry="26" fill="${fur}"/>` +
        // Belly
        `<ellipse cx="48" cy="52" rx="16" ry="18" fill="${belly}"/>` +
        // Ear tufts
        `<path d="M28 28 L34 18 L36 30 Z" fill="${fur}"/>` +
        `<path d="M68 28 L62 18 L60 30 Z" fill="${fur}"/>` +
        // Eye discs (lighter rings around the eyes)
        `<circle cx="38" cy="40" r="11" fill="${belly}"/>` +
        `<circle cx="58" cy="40" r="11" fill="${belly}"/>` +
        `<circle cx="38" cy="40" r="10" fill="none" stroke="${accent}" stroke-width="1.2"/>` +
        `<circle cx="58" cy="40" r="10" fill="none" stroke="${accent}" stroke-width="1.2"/>` +
        // Eyes
        `<circle cx="38" cy="40" r="6" fill="${eye}"/>` +
        `<circle cx="58" cy="40" r="6" fill="${eye}"/>` +
        `<circle cx="40" cy="38" r="2" fill="#ffffff"/>` +
        `<circle cx="60" cy="38" r="2" fill="#ffffff"/>` +
        // Beak
        `<path d="M44 48 L52 48 L48 56 Z" fill="${accent}"/>` +
        // Wing tips
        `<path d="M22 50 Q20 60 26 68 L30 64 Z" fill="${accent}" opacity="0.6"/>` +
        `<path d="M74 50 Q76 60 70 68 L66 64 Z" fill="${accent}" opacity="0.6"/>` +
        // Cheek blush
        `<ellipse cx="30" cy="52" rx="3" ry="2" fill="${cheek}" opacity="0.5"/>` +
        `<ellipse cx="66" cy="52" rx="3" ry="2" fill="${cheek}" opacity="0.5"/>` +
        heroProp(p.prop, p.palette)
      );
    }
    case "fox": {
      // Fox with pointy ears + bushy tail holding a % tag.
      return (
        // Premium: studio key-light sheen across the forehead + fur tufts.
        heroHeadSheen(48, 22, 14, 4) +
        heroFurTufts(48, 22, 14, accent) +
        // Ears (pointy triangles)
        `<path d="M28 30 L20 12 L36 24 Z" fill="${fur}"/>` +
        `<path d="M68 30 L76 12 L60 24 Z" fill="${fur}"/>` +
        `<path d="M28 28 L24 18 L33 24 Z" fill="${cheek}" opacity="0.7"/>` +
        `<path d="M68 28 L72 18 L63 24 Z" fill="${cheek}" opacity="0.7"/>` +
        // Head
        `<path d="M30 28 Q28 22 38 22 L58 22 Q68 22 66 28 L66 50 Q66 60 56 64 L48 66 L40 64 Q30 60 30 50 Z" fill="${fur}"/>` +
        // Snout
        `<path d="M40 50 L48 62 L56 50 Q54 56 48 58 Q42 56 40 50 Z" fill="${belly}"/>` +
        // Nose
        `<ellipse cx="48" cy="50" rx="3" ry="2.5" fill="${accent}"/>` +
        // Mouth
        `<path d="M48 54 L48 58 M48 58 Q44 60 42 58 M48 58 Q52 60 54 58" stroke="${accent}" stroke-width="1.2" fill="none" stroke-linecap="round"/>` +
        // Eyes
        pixarEye(40, 38) + pixarEye(56, 38) +
        // Eyebrows
        `<path d="M34 32 L42 36" stroke="${accent}" stroke-width="1.5" stroke-linecap="round"/>` +
        `<path d="M62 32 L54 36" stroke="${accent}" stroke-width="1.5" stroke-linecap="round"/>` +
        // Cheek tufts
        `<ellipse cx="34" cy="48" rx="4" ry="2" fill="${cheek}" opacity="0.45"/>` +
        `<ellipse cx="62" cy="48" rx="4" ry="2" fill="${cheek}" opacity="0.45"/>` +
        heroProp(p.prop, p.palette)
      );
    }
    case "squirrel": {
      // Round squirrel body with bushy tail curling up and ears.
      return (
        // Premium: studio key-light sheen on top of the head + fur tufts.
        heroHeadSheen(48, 20, 14, 4) +
        heroFurTufts(48, 20, 14, accent) +
        // Bushy tail (behind the body)
        `<path d="M70 30 Q88 30 86 50 Q84 64 72 64 Q74 50 70 38 Z" fill="${fur}"/>` +
        `<path d="M76 38 Q82 42 80 50 Q78 56 74 56" fill="${belly}" opacity="0.5"/>` +
        // Ears
        `<path d="M34 22 L36 12 L42 22 Z" fill="${fur}"/>` +
        `<path d="M62 22 L60 12 L54 22 Z" fill="${fur}"/>` +
        `<path d="M36 20 L38 14 L40 20 Z" fill="${cheek}" opacity="0.7"/>` +
        `<path d="M60 20 L58 14 L56 20 Z" fill="${cheek}" opacity="0.7"/>` +
        // Head
        `<ellipse cx="48" cy="36" rx="18" ry="18" fill="${fur}"/>` +
        // Belly
        `<ellipse cx="48" cy="42" rx="11" ry="13" fill="${belly}"/>` +
        // Eyes
        `<circle cx="40" cy="36" r="5" fill="#1a2230"/>` +
        `<circle cx="56" cy="36" r="5" fill="#1a2230"/>` +
        `<circle cx="42" cy="34" r="1.6" fill="#ffffff"/>` +
        `<circle cx="58" cy="34" r="1.6" fill="#ffffff"/>` +
        // Nose
        `<ellipse cx="48" cy="46" rx="2.5" ry="2" fill="${accent}"/>` +
        // Mouth
        `<path d="M48 48 L48 52 M48 52 Q44 54 42 52 M48 52 Q52 54 54 52" stroke="${accent}" stroke-width="1.2" fill="none" stroke-linecap="round"/>` +
        // Cheek blush
        `<ellipse cx="34" cy="44" rx="3" ry="2" fill="${cheek}" opacity="0.55"/>` +
        `<ellipse cx="62" cy="44" rx="3" ry="2" fill="${cheek}" opacity="0.55"/>` +
        // Body
        `<ellipse cx="48" cy="64" rx="14" ry="10" fill="${fur}"/>` +
        `<ellipse cx="48" cy="66" rx="9" ry="6" fill="${belly}"/>` +
        heroProp(p.prop, p.palette)
      );
    }
    case "ant": {
      // Small ant body with head, antennae, and a bar chart it points at.
      return (
        // Premium: chitin sheen on the head dome + a subtle rim-light stroke.
        `<ellipse cx="46" cy="26" rx="10" ry="3" fill="#ffffff" opacity="0.25"/>` +
        `<path d="M34 36 Q48 24 62 36" stroke="#ffffff" stroke-width="0.8" fill="none" stroke-linecap="round" opacity="0.45"/>` +
        // Antennae
        `<path d="M40 28 Q34 18 32 14" stroke="${accent}" stroke-width="1.5" fill="none" stroke-linecap="round"/>` +
        `<circle cx="32" cy="14" r="1.5" fill="${accent}"/>` +
        `<path d="M56 28 Q62 18 64 14" stroke="${accent}" stroke-width="1.5" fill="none" stroke-linecap="round"/>` +
        `<circle cx="64" cy="14" r="1.5" fill="${accent}"/>` +
        // Head
        `<ellipse cx="48" cy="34" rx="14" ry="12" fill="${fur}"/>` +
        // Mandibles
        `<path d="M40 42 Q36 46 34 44" stroke="${accent}" stroke-width="1.5" fill="none" stroke-linecap="round"/>` +
        `<path d="M56 42 Q60 46 62 44" stroke="${accent}" stroke-width="1.5" fill="none" stroke-linecap="round"/>` +
        // Eyes (large and googly)
        `<circle cx="42" cy="32" r="5" fill="#ffffff"/>` +
        `<circle cx="54" cy="32" r="5" fill="#ffffff"/>` +
        `<circle cx="43" cy="32" r="2.5" fill="#1a2230"/>` +
        `<circle cx="55" cy="32" r="2.5" fill="#1a2230"/>` +
        `<circle cx="43.5" cy="31" r="0.8" fill="#ffffff"/>` +
        `<circle cx="55.5" cy="31" r="0.8" fill="#ffffff"/>` +
        // Body (3 segments)
        `<ellipse cx="48" cy="54" rx="8" ry="6" fill="${fur}"/>` +
        `<ellipse cx="48" cy="64" rx="9" ry="7" fill="${fur}"/>` +
        // Legs
        `<path d="M40 56 L34 64 M40 62 L34 72 M56 56 L62 64 M56 62 L62 72" stroke="${accent}" stroke-width="1.2" fill="none" stroke-linecap="round"/>` +
        // Cheek blush
        `<ellipse cx="36" cy="38" rx="2.5" ry="1.5" fill="${cheek}" opacity="0.5"/>` +
        `<ellipse cx="60" cy="38" rx="2.5" ry="1.5" fill="${cheek}" opacity="0.5"/>` +
        heroProp(p.prop, p.palette)
      );
    }
    case "eagle": {
      // Eagle with white head, golden beak, and a target in front.
      return (
        // Premium: feather sheen across the top of the head + a tiny crest highlight.
        heroHeadSheen(48, 22, 18, 4) +
        heroFurTufts(48, 22, 16, accent) +
        // Head (white)
        `<ellipse cx="48" cy="38" rx="22" ry="20" fill="${belly}"/>` +
        // Body (brown)
        `<path d="M30 56 Q28 70 38 78 L58 78 Q68 70 66 56 Q60 60 48 60 Q36 60 30 56 Z" fill="${fur}"/>` +
        // Belly
        `<path d="M36 60 Q48 66 60 60 Q60 74 48 76 Q36 74 36 60 Z" fill="${belly}" opacity="0.6"/>` +
        // Beak
        `<path d="M44 42 L52 42 L48 50 Z" fill="#f5b820"/>` +
        `<path d="M44 44 L52 44" stroke="#a87a0a" stroke-width="0.8"/>` +
        // Eyes
        `<circle cx="40" cy="34" r="5" fill="#fef3c7"/>` +
        `<circle cx="56" cy="34" r="5" fill="#fef3c7"/>` +
        `<circle cx="40" cy="34" r="2.5" fill="#1a2230"/>` +
        `<circle cx="56" cy="34" r="2.5" fill="#1a2230"/>` +
        `<circle cx="41" cy="33" r="1" fill="#ffffff"/>` +
        `<circle cx="57" cy="33" r="1" fill="#ffffff"/>` +
        // Eyebrows (stern)
        `<path d="M34 28 L42 30" stroke="${accent}" stroke-width="1.5" stroke-linecap="round"/>` +
        `<path d="M62 28 L54 30" stroke="${accent}" stroke-width="1.5" stroke-linecap="round"/>` +
        // Cheek blush
        `<ellipse cx="34" cy="46" rx="3" ry="2" fill="${cheek}" opacity="0.5"/>` +
        `<ellipse cx="62" cy="46" rx="3" ry="2" fill="${cheek}" opacity="0.5"/>` +
        // Wings (small pokes)
        `<path d="M28 60 Q22 70 28 76 L34 72 Z" fill="${accent}"/>` +
        `<path d="M68 60 Q74 70 68 76 L62 72 Z" fill="${accent}"/>` +
        heroProp(p.prop, p.palette)
      );
    }
    case "turtle": {
      // Turtle with rounded shell, sticking head out, holding a piggy bank.
      return (
        // Premium: shell sheen across the top + a soft rim highlight.
        `<path d="M24 50 Q48 30 72 50" stroke="#ffffff" stroke-width="1.2" fill="none" stroke-linecap="round" opacity="0.55"/>` +
        `<ellipse cx="38" cy="42" rx="6" ry="2" fill="#ffffff" opacity="0.25"/>` +
        `<ellipse cx="58" cy="42" rx="6" ry="2" fill="#ffffff" opacity="0.25"/>` +
        // Shell (green dome)
        `<ellipse cx="48" cy="58" rx="28" ry="20" fill="${fur}"/>` +
        `<ellipse cx="48" cy="50" rx="22" ry="6" fill="#5b8a64" opacity="0.55"/>` +
        // Shell segments
        `<path d="M30 50 Q48 36 66 50" stroke="${accent}" stroke-width="1.2" fill="none"/>` +
        `<path d="M30 56 Q48 42 66 56" stroke="${accent}" stroke-width="1.2" fill="none"/>` +
        `<path d="M30 62 Q48 48 66 62" stroke="${accent}" stroke-width="1.2" fill="none"/>` +
        `<ellipse cx="36" cy="44" rx="5" ry="3" fill="${accent}" opacity="0.5"/>` +
        `<ellipse cx="48" cy="40" rx="5" ry="3" fill="${accent}" opacity="0.5"/>` +
        `<ellipse cx="60" cy="44" rx="5" ry="3" fill="${accent}" opacity="0.5"/>` +
        // Head poking out
        `<ellipse cx="48" cy="28" rx="14" ry="11" fill="#7a8050"/>` +
        // Belly
        `<ellipse cx="48" cy="30" rx="9" ry="6" fill="${belly}"/>` +
        // Smile
        `<path d="M44 30 Q48 33 52 30" stroke="${accent}" stroke-width="1.2" fill="none" stroke-linecap="round"/>` +
        // Eyes
        `<circle cx="42" cy="24" r="3.5" fill="#1a2230"/>` +
        `<circle cx="54" cy="24" r="3.5" fill="#1a2230"/>` +
        `<circle cx="43" cy="23" r="1.2" fill="#ffffff"/>` +
        `<circle cx="55" cy="23" r="1.2" fill="#ffffff"/>` +
        // Feet
        `<ellipse cx="32" cy="76" rx="5" ry="3" fill="#5b6b3a"/>` +
        `<ellipse cx="64" cy="76" rx="5" ry="3" fill="#5b6b3a"/>` +
        // Cheek blush
        `<ellipse cx="38" cy="32" rx="2.5" ry="1.5" fill="${cheek}" opacity="0.5"/>` +
        `<ellipse cx="58" cy="32" rx="2.5" ry="1.5" fill="${cheek}" opacity="0.5"/>` +
        heroProp(p.prop, p.palette)
      );
    }
    case "bee": {
      // Round bee with stripes, wings, and a honeycomb hexagon.
      return (
        // Premium: gloss highlight on the body + sheen on the wings.
        `<ellipse cx="44" cy="32" rx="11" ry="5" fill="#ffffff" opacity="0.45"/>` +
        `<ellipse cx="44" cy="32" rx="5" ry="2" fill="#fef9c3" opacity="0.7"/>` +
        // Wings (behind body)
        `<ellipse cx="34" cy="34" rx="8" ry="12" fill="#ffffff" opacity="0.75" transform="rotate(-20 34 34)"/>` +
        `<ellipse cx="62" cy="34" rx="8" ry="12" fill="#ffffff" opacity="0.75" transform="rotate(20 62 34)"/>` +
        // Body
        `<ellipse cx="48" cy="46" rx="20" ry="22" fill="${fur}"/>` +
        // Stripes
        `<path d="M30 42 Q48 38 66 42 L66 50 Q48 46 30 50 Z" fill="${accent}"/>` +
        `<path d="M30 56 Q48 52 66 56 L66 64 Q48 60 30 64 Z" fill="${accent}"/>` +
        // Belly highlight
        `<ellipse cx="48" cy="50" rx="10" ry="14" fill="${belly}" opacity="0.6"/>` +
        // Eyes
        `<circle cx="42" cy="32" r="5" fill="#ffffff"/>` +
        `<circle cx="54" cy="32" r="5" fill="#ffffff"/>` +
        `<circle cx="42" cy="32" r="3" fill="#1a2230"/>` +
        `<circle cx="54" cy="32" r="3" fill="#1a2230"/>` +
        `<circle cx="43" cy="31" r="1" fill="#ffffff"/>` +
        `<circle cx="55" cy="31" r="1" fill="#ffffff"/>` +
        // Smile
        `<path d="M44 42 Q48 46 52 42" stroke="${accent}" stroke-width="1.2" fill="none" stroke-linecap="round"/>` +
        // Antennae
        `<path d="M42 26 Q38 20 36 16" stroke="${accent}" stroke-width="1.5" fill="none" stroke-linecap="round"/>` +
        `<circle cx="36" cy="16" r="1.5" fill="${accent}"/>` +
        `<path d="M54 26 Q58 20 60 16" stroke="${accent}" stroke-width="1.5" fill="none" stroke-linecap="round"/>` +
        `<circle cx="60" cy="16" r="1.5" fill="${accent}"/>` +
        // Cheek blush
        `<ellipse cx="36" cy="40" rx="2.5" ry="1.5" fill="${cheek}" opacity="0.55"/>` +
        `<ellipse cx="60" cy="40" rx="2.5" ry="1.5" fill="${cheek}" opacity="0.55"/>` +
        heroProp(p.prop, p.palette)
      );
    }
    case "bear": {
      // Round bear with small ears, snout, and a shield with a check.
      return (
        // Premium: fur sheen + tufts on the crown.
        heroHeadSheen(48, 22, 16, 4) +
        heroFurTufts(48, 22, 14, accent) +
        // Ears
        `<circle cx="30" cy="22" r="8" fill="${fur}"/>` +
        `<circle cx="66" cy="22" r="8" fill="${fur}"/>` +
        `<circle cx="30" cy="22" r="4" fill="${belly}"/>` +
        `<circle cx="66" cy="22" r="4" fill="${belly}"/>` +
        // Head
        `<ellipse cx="48" cy="40" rx="24" ry="22" fill="${fur}"/>` +
        // Snout
        `<ellipse cx="48" cy="50" rx="14" ry="10" fill="${belly}"/>` +
        // Nose
        `<ellipse cx="48" cy="46" rx="4" ry="3" fill="${accent}"/>` +
        // Mouth
        `<path d="M48 49 L48 54 M48 54 Q44 56 42 54 M48 54 Q52 56 54 54" stroke="${accent}" stroke-width="1.2" fill="none" stroke-linecap="round"/>` +
        // Eyes
        `<circle cx="40" cy="36" r="4" fill="#1a2230"/>` +
        `<circle cx="56" cy="36" r="4" fill="#1a2230"/>` +
        `<circle cx="41" cy="35" r="1.2" fill="#ffffff"/>` +
        `<circle cx="57" cy="35" r="1.2" fill="#ffffff"/>` +
        // Eyebrows
        `<path d="M34 30 L42 32" stroke="${accent}" stroke-width="1.5" stroke-linecap="round"/>` +
        `<path d="M62 30 L54 32" stroke="${accent}" stroke-width="1.5" stroke-linecap="round"/>` +
        // Cheek blush
        `<ellipse cx="32" cy="46" rx="3" ry="2" fill="${cheek}" opacity="0.55"/>` +
        `<ellipse cx="64" cy="46" rx="3" ry="2" fill="${cheek}" opacity="0.55"/>` +
        heroProp(p.prop, p.palette)
      );
    }
    case "wolf": {
      // Wolf with pointy ears, sharp face, and a mountain badge.
      return (
        // Premium: fur sheen + tufts on the crown.
        heroHeadSheen(48, 22, 14, 4) +
        heroFurTufts(48, 22, 14, accent) +
        // Ears (pointy)
        `<path d="M28 28 L24 6 L38 24 Z" fill="${fur}"/>` +
        `<path d="M68 28 L72 6 L58 24 Z" fill="${fur}"/>` +
        `<path d="M28 26 L26 12 L34 24 Z" fill="${accent}" opacity="0.5"/>` +
        `<path d="M68 26 L70 12 L62 24 Z" fill="${accent}" opacity="0.5"/>` +
        // Head (more angular than the bear)
        `<path d="M30 30 Q28 24 36 22 L60 22 Q68 24 66 30 L66 50 Q66 60 56 64 L48 66 L40 64 Q30 60 30 50 Z" fill="${fur}"/>` +
        // Snout
        `<path d="M40 50 L48 62 L56 50 Q54 56 48 58 Q42 56 40 50 Z" fill="${belly}"/>` +
        // Nose
        `<ellipse cx="48" cy="50" rx="3" ry="2.5" fill="${accent}"/>` +
        // Eyes (yellow wolf eyes)
        `<ellipse cx="40" cy="38" rx="4.5" ry="3.5" fill="#fbbf24"/>` +
        `<ellipse cx="56" cy="38" rx="4.5" ry="3.5" fill="#fbbf24"/>` +
        `<ellipse cx="40" cy="38" rx="1.5" ry="2.5" fill="#1a2230"/>` +
        `<ellipse cx="56" cy="38" rx="1.5" ry="2.5" fill="#1a2230"/>` +
        `<circle cx="41" cy="37" r="0.8" fill="#ffffff"/>` +
        `<circle cx="57" cy="37" r="0.8" fill="#ffffff"/>` +
        // Eyebrows
        `<path d="M34 32 L42 34" stroke="${accent}" stroke-width="1.5" stroke-linecap="round"/>` +
        `<path d="M62 32 L54 34" stroke="${accent}" stroke-width="1.5" stroke-linecap="round"/>` +
        // Mouth
        `<path d="M48 54 L48 58 M48 58 Q44 60 42 58 M48 58 Q52 60 54 58" stroke="${accent}" stroke-width="1.2" fill="none" stroke-linecap="round"/>` +
        // Cheek tufts
        `<ellipse cx="34" cy="48" rx="4" ry="2" fill="${cheek}" opacity="0.4"/>` +
        `<ellipse cx="62" cy="48" rx="4" ry="2" fill="${cheek}" opacity="0.4"/>` +
        heroProp(p.prop, p.palette)
      );
    }
    case "rhino": {
      // Rhodo with a horn + thick eyebrows + shield.
      return (
        // Premium: skin sheen across the forehead.
        heroHeadSheen(48, 26, 16, 4) +
        // Ears
        `<path d="M28 22 L24 14 L34 22 Z" fill="${fur}"/>` +
        `<path d="M68 22 L72 14 L62 22 Z" fill="${fur}"/>` +
        `<path d="M28 22 L26 16 L30 22 Z" fill="${cheek}" opacity="0.5"/>` +
        `<path d="M68 22 L70 16 L66 22 Z" fill="${cheek}" opacity="0.5"/>` +
        // Head (blocky)
        `<path d="M28 30 Q28 22 38 22 L58 22 Q68 22 68 30 L68 52 Q68 62 58 64 L48 66 L38 64 Q28 62 28 52 Z" fill="${fur}"/>` +
        // Snout
        `<ellipse cx="48" cy="56" rx="12" ry="6" fill="#c8ccd4"/>` +
        // Horn
        `<path d="M48 50 L46 38 L50 38 Z" fill="${accent}"/>` +
        `<path d="M46 38 L50 38 L48 50 Z" fill="#a8b4c8" opacity="0.5"/>` +
        // Second horn
        `<path d="M38 54 L40 48 L42 54 Z" fill="${accent}"/>` +
        // Eyes
        `<circle cx="40" cy="36" r="4" fill="#fbbf24"/>` +
        `<circle cx="56" cy="36" r="4" fill="#fbbf24"/>` +
        `<circle cx="40" cy="36" r="2" fill="#1a2230"/>` +
        `<circle cx="56" cy="36" r="2" fill="#1a2230"/>` +
        `<circle cx="41" cy="35" r="0.8" fill="#ffffff"/>` +
        `<circle cx="57" cy="35" r="0.8" fill="#ffffff"/>` +
        // Thick eyebrows (fierce)
        `<path d="M32 30 L46 32" stroke="${accent}" stroke-width="2.5" stroke-linecap="round"/>` +
        `<path d="M64 30 L50 32" stroke="${accent}" stroke-width="2.5" stroke-linecap="round"/>` +
        // Nostrils
        `<ellipse cx="44" cy="56" rx="1.5" ry="1" fill="${accent}"/>` +
        `<ellipse cx="52" cy="56" rx="1.5" ry="1" fill="${accent}"/>` +
        // Mouth
        `<path d="M44 60 L48 62 L52 60" stroke="${accent}" stroke-width="1.2" fill="none" stroke-linecap="round"/>` +
        heroProp(p.prop, p.palette)
      );
    }
    case "leopard": {
      // Spotted leopard with a green growth chart.
      // Drawing notes (Premium upgrade):
      //   • Ears are pulled DOWN so they overlap the head silhouette (which
      //     was the original "balloon" glitch — they were floating above
      //     the head). The inner-ear tone is the dark accent.
      //   • Spots are re-arranged on a 32-grid that respects the head
      //     ellipse (cx=48 cy=40 rx=24 ry=22) so none of them sit on
      //     the snout/cheek bones. Named spots (forehead, cheek, chin)
      //     match the leopard's actual markings.
      //   • Snout is repositioned a hair lower so the nose + mouth read
      //     as a separate muzzle, not a flat blob.
      return (
        // Premium: fur sheen + tufts between the ears.
        heroHeadSheen(48, 24, 16, 4) +
        heroFurTufts(48, 24, 14, accent) +
        // Rounded ears — tucked into the head (cy=24 vs original cy=20)
        // so they don't float above the silhouette. The inner-ear disk
        // is a darker accent so the ear reads as a real ear, not a ball.
        `<circle cx="32" cy="24" r="7" fill="${fur}"/>` +
        `<circle cx="64" cy="24" r="7" fill="${fur}"/>` +
        `<circle cx="32" cy="24" r="3.5" fill="${accent}" opacity="0.65"/>` +
        `<circle cx="64" cy="24" r="3.5" fill="${accent}" opacity="0.65"/>` +
        // Head
        `<ellipse cx="48" cy="40" rx="24" ry="22" fill="${fur}"/>` +
        // Spots — clustered on the head ONLY, avoiding the snout (y=40 to y=56)
        // and the lower-face cheek area. The forehead pair sits between the
        // eyes; the cheek pair sits on the sides of the muzzle above the snout.
        `<g fill="${accent}" opacity="0.55">` +
          // Forehead twin spots (between the eyes, above the nose line)
          `<circle cx="42" cy="28" r="2"/>` +
          `<circle cx="54" cy="28" r="2"/>` +
          // Upper cheek spots (above the snout, on the head proper)
          `<circle cx="32" cy="36" r="2.4"/>` +
          `<circle cx="64" cy="36" r="2.4"/>` +
          // Side-of-head spots (on the cheek, away from the snout)
          `<circle cx="28" cy="46" r="2.2"/>` +
          `<circle cx="68" cy="46" r="2.2"/>` +
          // Lower cheek spots (just below the snout, on the chin line)
          `<circle cx="38" cy="58" r="2"/>` +
          `<circle cx="58" cy="58" r="2"/>` +
          // Crown spot (between the ears, hair whorl)
          `<circle cx="48" cy="22" r="1.5"/>` +
        `</g>` +
        // Snout — moved down to y=50 so the nose/mouth read as a muzzle
        // and the spots at y=58 don't sit on top of the snout.
        `<ellipse cx="48" cy="50" rx="11" ry="7" fill="${belly}"/>` +
        // Nose
        `<ellipse cx="48" cy="48" rx="3" ry="2.2" fill="${accent}"/>` +
        // Mouth — drawn so the curve sits inside the snout ellipse cleanly
        `<path d="M48 50 L48 53 M48 53 Q44 55 42 53 M48 53 Q52 55 54 53" stroke="${accent}" stroke-width="1.2" fill="none" stroke-linecap="round"/>` +
        // Eyes (green predator eyes)
        `<ellipse cx="40" cy="36" rx="5" ry="3.5" fill="#fef3c7"/>` +
        `<ellipse cx="56" cy="36" rx="5" ry="3.5" fill="#fef3c7"/>` +
        `<ellipse cx="40" cy="36" rx="1.5" ry="2.8" fill="#1a6b3a"/>` +
        `<ellipse cx="56" cy="36" rx="1.5" ry="2.8" fill="#1a6b3a"/>` +
        `<circle cx="41" cy="35" r="0.9" fill="#ffffff"/>` +
        `<circle cx="57" cy="35" r="0.9" fill="#ffffff"/>` +
        // Eyebrows
        `<path d="M34 30 L42 32" stroke="${accent}" stroke-width="1.5" stroke-linecap="round"/>` +
        `<path d="M62 30 L54 32" stroke="${accent}" stroke-width="1.5" stroke-linecap="round"/>` +
        // Cheek blush — moved outside the snout (snout is x=37..59, y=43..57)
        // so the blush sits on the fur, not on the muzzle.
        `<ellipse cx="28" cy="52" rx="3" ry="1.8" fill="${cheek}" opacity="0.5"/>` +
        `<ellipse cx="68" cy="52" rx="3" ry="1.8" fill="${cheek}" opacity="0.5"/>` +
        heroProp(p.prop, p.palette)
      );
    }
    default:
      return `<circle cx="48" cy="48" r="22" fill="${fur}"/>`;
  }
}

/**
 * Build a data-URL avatar for one of the built-in anime-animal avatars.
 * Unknown ids fall back to the first entry. The output is a 96×96 inline
 * SVG with a premium gradient circle background, the animal illustration,
 * and a small chest emblem showing the first letter of the animal name.
 *
 * Premium upgrade (Phase 12):
 *   • Multi-stop radial gradient on the background for a true PBR-style
 *     colour falloff (lighter top-left, deeper bottom-right).
 *   • A second inner radial overlay simulates a soft studio key-light so
 *     the centre of the disc reads as "lit" against a darker edge.
 *   • A subtle vignette (darker corners) for cinematic framing.
 *   • A faint outer rim-light halo that lifts the character off the page.
 *
 * Uses template literals so the SVG markup can carry its own double
 * quotes without breaking the JS string.
 */
export function generateHeroAvatarDataUrl(id) {
  const hero = getHeroAvatar(id);
  // Return the on-disk SVG asset path. The new avatar pack ships as real
  // SVG files under /logos/avatars/, so we point straight at the file
  // instead of inlining a generated data-URL. Callers use the result as
  // an <img src>, so a path is a drop-in replacement and stays crisp on
  // Retina displays.
  return `/logos/avatars/${hero.file}`;
}




/**
 * Read a File / Blob and resolve with a small square JPEG data URL suitable
 * for use as a profile avatar. The image is center-cropped to a square and
 * resized so the longest side is at most `maxSide` px (default 256) — this
 * keeps the stored string under a few KB even for very large uploads, and
 * matches the 96×96 / 128×128 sizes the UI actually renders at.
 *
 * Returns `{ ok: true, dataUrl }` on success or `{ ok: false, error }` on
 * failure (unsupported type, decode error, oversize file, etc.). The
 * caller (the Profile Edit modal) maps the error onto a field-level
 * message; the file input stays open so the user can pick a different one.
 */
export function processProfilePicture(file, { maxSide = 256, maxBytes = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    if (!file) return resolve({ ok: false, error: "No file selected." });
    if (!/^image\//.test(file.type || "")) {
      return resolve({ ok: false, error: "Please choose an image file (PNG, JPEG, GIF, or WebP)." });
    }
    if (typeof file.size === "number" && file.size > maxBytes) {
      const mb = (maxBytes / (1024 * 1024)).toFixed(0);
      return resolve({ ok: false, error: `Image is too large. Max ${mb} MB.` });
    }
    const reader = new FileReader();
    reader.onerror = () => resolve({ ok: false, error: "Could not read the file." });
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const img = new Image();
      img.onerror = () => resolve({ ok: false, error: "Could not decode the image." });
      img.onload = () => {
        try {
          // Center-crop to a square, then downscale to maxSide. Using a
          // square canvas + `object-fit: cover` style math (no CSS needed
          // here) keeps the avatar circular-looking at every render size.
          const side = Math.min(img.width, img.height);
          const sx = Math.floor((img.width - side) / 2);
          const sy = Math.floor((img.height - side) / 2);
          const out = Math.min(side, maxSide);
          const canvas = document.createElement("canvas");
          canvas.width = out;
          canvas.height = out;
          const ctx = canvas.getContext("2d");
          if (!ctx) return resolve({ ok: false, error: "Canvas not supported in this browser." });
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
          // JPEG at 0.85 keeps the data URL tiny for typical portraits.
          // We deliberately don't use PNG here because lossless encoding
          // can balloon the size to 100KB+ for no visible gain.
          const outDataUrl = canvas.toDataURL("image/jpeg", 0.85);
          resolve({ ok: true, dataUrl: outDataUrl });
        } catch (e) {
          resolve({ ok: false, error: "Could not process the image: " + (e?.message || e) });
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

/** Returns today's date as YYYY-MM-DD using local time (not UTC). */
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Returns the current local time as HH:MM (24h).
 * Used to pre-fill the optional time input on the expense form so the
 * system clock is captured automatically when the user adds an expense.
 */
export function currentTimeHHMM() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Pads a number with a leading zero (used to build YYYY-MM-DD / HH:MM strings). */
export function pad(n) {
  return String(n).padStart(2, "0");
}

/** Returns the first day of the month containing `d` (local time). */
export function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** "July 2026" — used in the header month picker and view labels. */
export function formatMonth(d) {
  return `${MONTH_NAMES_FULL[d.getMonth()]} ${d.getFullYear()}`;
}

/** "YYYY-MM" — used to filter expenses by the currently selected month. */
export function monthKey(d) {
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  return `${y}-${m}`;
}

/** Escapes user-supplied text for safe insertion into innerHTML. */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/** Compare two ISO dates (YYYY-MM-DD) as strings — works because the format is sortable. */
export function compareISO(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Compare two HH:MM time strings. */
export function compareHHMM(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

// ---------------------------------------------------------------------------
// Smart search parser (Phase 7)
// ---------------------------------------------------------------------------
//
// The expenses search box understands a small but useful query language:
//
//   • Amount comparisons:  >1000  <500  >=200  =250  (₹/Rs are stripped)
//   • Time tokens:         today, yesterday, this month, last month,
//                          this week, last week, this year, last year
//                          January..December, Jan..Dec, 2026, 2026-07
//   • Category names:      any word matching a category name restricts the
//                          result to that category
//   • Free text:           anything left over is matched against note +
//                          amount-as-string (the legacy Phase 3 behavior)
//
// parseSearchQuery(text, categories) returns a predicate { match(exp), describe() }
// that the Expenses view applies to each row. describe() returns a short
// human-readable summary used in the count line so the user can see what
// the parser understood.

const MONTH_NAMES_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_NAMES_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_BY_NAME = new Map();
for (let i = 0; i < 12; i++) {
  MONTH_BY_NAME.set(MONTH_NAMES_FULL[i].toLowerCase(), i);
  MONTH_BY_NAME.set(MONTH_NAMES_SHORT[i].toLowerCase(), i);
  // Also accept common variants ("sept", "september").
  MONTH_BY_NAME.set(MONTH_NAMES_FULL[i].slice(0, 3).toLowerCase(), i);
}

/**
 * Parse a free-text search query into a predicate + a description.
 * @param {string} text
 * @param {Array<{id:string,name:string}>} categories
 * @returns {{ match: (exp:any) => boolean, describe: () => string }}
 */
export function parseSearchQuery(text, categories) {
  const raw = (text || "").trim();
  const empty = {
    match: () => true,
    describe: () => "",
  };
  if (!raw) return empty;

  // Tokenize on whitespace, keeping original case for the free-text portion.
  // Before splitting, glue amount-comparison operators back onto the next
  // number so e.g. "Housing < 2000" parses as one "<2000" token. Users
  // almost never type "Housing <2000" without a space.
  const normalized = raw
    .replace(/\s*((?:>=|<=|>|<|=)\s*)/g, " $1") // keep operator visible to the next split
    .replace(/(>=|<=|>|<|=)\s+(\d+(?:\.\d+)?)/g, "$1$2"); // join "< 2000" → "<2000"
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const lower = tokens.map((t) => t.toLowerCase());

  // Collect structured predicates and the leftover free-text tokens.
  const predicates = [];   // each is (exp) => boolean
  const notes = [];        // unparsed tokens for note/amount substring match
  const describeParts = []; // human-readable summary

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const lo = lower[i];

    // 0) Year (4 digits) or year-month (YYYY-MM). Checked BEFORE amount
    //    comparisons so a bare "2026" parses as a year filter rather than
    //    an amount comparison (= 2026). The amount parser would otherwise
    //    greedily eat it (a bare number with no operator means "=value").
    const ym = parseYearOrYearMonth(tok);
    if (ym) {
      predicates.push((e) => e.date?.startsWith(ym.prefix));
      describeParts.push(ym.label);
      continue;
    }

    // 1) Amount comparisons: >, >=, <, <=, = followed by a number (₹/Rs allowed).
    const cmp = parseAmountCmp(tok);
    if (cmp) {
      predicates.push((e) => {
        const v = Number(e.amount);
        if (!Number.isFinite(v)) return false;
        switch (cmp.op) {
          case ">":  return v >  cmp.value;
          case ">=": return v >= cmp.value;
          case "<":  return v <  cmp.value;
          case "<=": return v <= cmp.value;
          case "=":  return v === cmp.value;
        }
        return false;
      });
      describeParts.push(cmp.label);
      continue;
    }

    // 2) Time tokens — exact phrases first (multi-word).
    if (lo === "this" || lo === "last") {
      const period = lower[i + 1];
      if (period) {
        const range = periodRange(lo, period);
        if (range) {
          predicates.push((e) => compareISO(e.date, range.from) >= 0 && compareISO(e.date, range.to) <= 0);
          describeParts.push(range.label);
          i++; // consume the next token
          continue;
        }
      }
    }
    // Single-word time tokens.
    const single = singleTimeToken(lo);
    if (single) {
      predicates.push((e) => compareISO(e.date, single.from) >= 0 && compareISO(e.date, single.to) <= 0);
      describeParts.push(single.label);
      continue;
    }

    // 3) Category name — match any token that equals a category name.
    //    (Whole-word only to avoid "food" matching "foodie" categories.)
    const cat = categories.find((c) => c.name.toLowerCase() === lo);
    if (cat) {
      predicates.push((e) => e.categoryId === cat.id);
      describeParts.push(`category: ${cat.name}`);
      continue;
    }

    // 5) Otherwise this is a free-text token for the legacy note/amount match.
    notes.push(lo);
  }

  // Build the combined predicate.
  const freeText = notes.join(" ");
  const match = (e) => {
    for (const p of predicates) if (!p(e)) return false;
    if (freeText) {
      const inNote = (e.note || "").toLowerCase().includes(freeText);
      const inAmt = String(e.amount).includes(freeText) || (+e.amount).toString().includes(freeText);
      if (!inNote && !inAmt) return false;
    }
    return true;
  };

  return { match, describe: () => describeParts.join(" · ") };
}

// --- Smart-search helpers -------------------------------------------------

/** Parse a token like ">1000", "<=500", "=₹250", "200" (bare number = "=value"). */
function parseAmountCmp(tok) {
  const m = tok.match(/^(>=|<=|>|<|=)?\s*(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)$/i);
  if (!m) return null;
  const op = m[1] || "=";
  const value = Number(m[2]);
  if (!Number.isFinite(value)) return null;
  const labels = { ">": ">", ">=": "≥", "<": "<", "<=": "≤", "=": "=" };
  return { op, value, label: `${labels[op]}${value}` };
}

/** "this month" / "last week" / etc. → { from, to, label }. */
function periodRange(direction, period) {
  // The current month as a reference point for "this/last" phrases.
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const day = now.getDate();
  let ref;
  switch (period) {
    case "month": ref = { y, m }; break;
    case "week":  ref = { y, m, d: day }; break; // d here just signals "use today"
    case "year":  ref = { y }; break;
    default: return null;
  }
  if (direction === "this") {
    if (period === "month") {
      const from = new Date(y, m, 1);
      const to = new Date(y, m + 1, 0); // last day of the month
      return isoRange(from, to, "this month");
    }
    if (period === "week") {
      // Anchor "this week" to a 7-day window ending today. (Mon–Sun would
      // require locale settings; a trailing 7 days is good enough for v1.)
      const to = new Date(y, m, day);
      const from = new Date(y, m, day - 6);
      return isoRange(from, to, "this week");
    }
    if (period === "year") {
      return { from: `${y}-01-01`, to: `${y}-12-31`, label: `${y}` };
    }
  }
  if (direction === "last") {
    if (period === "month") {
      const from = new Date(y, m - 1, 1);
      const to = new Date(y, m, 0);
      return isoRange(from, to, "last month");
    }
    if (period === "week") {
      const to = new Date(y, m, day - 7);
      const from = new Date(y, m, day - 13);
      return isoRange(from, to, "last week");
    }
    if (period === "year") {
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: `${y - 1}` };
    }
  }
  return null;
}

/** today / yesterday → { from, to, label } (both equal to the same day). */
function singleTimeToken(lo) {
  const now = new Date();
  if (lo === "today") {
    const iso = isoOf(now);
    return { from: iso, to: iso, label: "today" };
  }
  if (lo === "yesterday") {
    const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const iso = isoOf(y);
    return { from: iso, to: iso, label: "yesterday" };
  }
  // Month name (full or 3-letter) — match the entire calendar month of
  // the most recent occurrence. E.g. typing "January" alone in July 2026
  // matches January 2026.
  if (MONTH_BY_NAME.has(lo)) {
    const monthIdx = MONTH_BY_NAME.get(lo);
    const year = now.getFullYear();
    // If the named month is later than the current month, the user almost
    // certainly means last year.
    const useYear = monthIdx > now.getMonth() ? year - 1 : year;
    const from = new Date(useYear, monthIdx, 1);
    const to = new Date(useYear, monthIdx + 1, 0);
    return isoRange(from, to, `${MONTH_NAMES_FULL[monthIdx]} ${useYear}`);
  }
  return null;
}

/** "2026" or "2026-07" → { prefix, label }. */
function parseYearOrYearMonth(tok) {
  if (/^\d{4}$/.test(tok)) return { prefix: tok, label: tok };
  if (/^\d{4}-\d{2}$/.test(tok)) {
    const [y, m] = tok.split("-").map(Number);
    const from = new Date(y, m - 1, 1);
    const to = new Date(y, m, 0);
    return { prefix: tok, label: `${MONTH_NAMES_FULL[m - 1]} ${y}` };
  }
  return null;
}

function isoRange(from, to, label) {
  return { from: isoOf(from), to: isoOf(to), label };
}

function isoOf(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Payment method constants. Keeping them as a single source of truth so the
 * form, the store, the filter bar, and the row chip all use the same list
 * and labels.
 */
export const PAYMENT_METHODS = [
  { value: "cash",          label: "Cash" },
  { value: "upi",           label: "UPI" },
  { value: "debit_card",    label: "Debit card" },
  { value: "credit_card",   label: "Credit card" },
  { value: "bank_transfer", label: "Bank transfer" },
];

/** Sub-options shown only when the payment method is UPI. */
export const UPI_APPS = [
  { value: "phonepe",   label: "PhonePe" },
  { value: "googlepay", label: "Google Pay" },
  { value: "paytm",     label: "Paytm" },
  { value: "supermoney", label: "super.money" },
  { value: "bhim",      label: "BHIM" },
  { value: "cred",      label: "CRED" },
];

/** Resolve a payment method value to its display label, with a safe fallback. */
export function paymentMethodLabel(value) {
  return PAYMENT_METHODS.find((m) => m.value === value)?.label || "—";
}

/** Resolve a UPI app value to its display label, with a safe fallback. */
export function upiAppLabel(value) {
  return UPI_APPS.find((a) => a.value === value)?.label || "—";
}

// ---------------------------------------------------------------------------
// Smart entry helpers (Phase 4)
// ---------------------------------------------------------------------------
//
// The keyword map maps free-text hints to category IDs. It's used by:
//   • Quick Add on the dashboard ("Coffee 180" → suggests Food)
//   • The inline category-suggest pill in the full expense form
//
// It is intentionally small and easy to extend. Matching is case-insensitive
// and looks for whole-word matches first, then falls back to substring matches.

export const KEYWORD_CATEGORIES = [
  { id: "cat_food",          words: ["coffee", "tea", "lunch", "dinner", "breakfast", "snack", "swiggy", "zomato", "restaurant", "food", "cafe", "starbucks", "mcdonald", "kfc", "dominos", "pizza", "burger", "biryani", "dining", "eats", "meal"] },
  { id: "cat_groceries",     words: ["groceries", "grocery", "bigbasket", "blinkit", "instamart", "dunzo", "milk", "vegetables", "fruits", "supermarket", "dmart", "reliance fresh"] },
  { id: "cat_transport",     words: ["uber", "ola", "rapido", "auto", "taxi", "cab", "bus", "metro", "train", "flight", "petrol", "diesel", "fuel", "parking", "toll", "transport", "commute"] },
  { id: "cat_housing",       words: ["rent", "maintenance", "society", "apartment", "mortgage", "housing", "emi home", "house rent"] },
  { id: "cat_utilities",     words: ["electricity", "water", "gas", "utility", "utilities", "bill"] },
  { id: "cat_internet",      words: ["internet", "wifi", "broadband", "mobile", "recharge", "postpaid", "prepaid", "airtel", "jio", "vi", "bsnl", "data pack", "sim"] },
  { id: "cat_entertainment", words: ["netflix", "spotify", "prime", "hotstar", "movie", "cinema", "concert", "game", "pubg", "playstation", "entertainment", "theater", "ott"] },
  { id: "cat_health",        words: ["pharmacy", "medicine", "doctor", "hospital", "clinic", "gym", "yoga", "dental", "health", "healthcare", "apollo", "medplus", "consultation"] },
  { id: "cat_education",     words: ["course", "udemy", "coursera", "tuition", "school", "college", "fees", "book", "education", "class", "training", "certification"] },
  { id: "cat_shopping",      words: ["amazon", "flipkart", "myntra", "ajio", "shopping", "clothes", "shoes", "mall", "apparel"] },
  { id: "cat_travel",        words: ["hotel", "airbnb", "hostel", "makemytrip", "goibibo", "yatra", "cleartrip", "vacation", "holiday", "trip", "travel", "lodging", "oyo"] },
  { id: "cat_gifts",         words: ["gift", "gifts", "present", "donation", "charity", "birthday", "anniversary"] },
  { id: "cat_loans",         words: ["loan", "emi", "credit card", "bill payment", "finance", "credit", "instalment", "installment", "interest"] },
  { id: "cat_investments",   words: ["stocks", "mutual fund", "sip", "fd", "fixed deposit", "ppf", "nps", "crypto", "bitcoin", "gold", "investment", "invest", "zerodha", "groww", "upstox"] },
];

/**
 * Look up the best matching category for a free-text note.
 * Returns { id, word } if a match is found, or null otherwise.
 */
export function suggestCategory(text) {
  const t = (text || "").toLowerCase().trim();
  if (!t) return null;
  // 1) Whole-word match (most precise).
  for (const entry of KEYWORD_CATEGORIES) {
    for (const w of entry.words) {
      const re = new RegExp(`\\b${escapeRegex(w)}\\b`, "i");
      if (re.test(t)) return { id: entry.id, word: w };
    }
  }
  // 2) Substring fallback for short words (e.g. "ola" inside "Ola cab").
  for (const entry of KEYWORD_CATEGORIES) {
    for (const w of entry.words) {
      if (w.length >= 4 && t.includes(w)) return { id: entry.id, word: w };
    }
  }
  return null;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse a one-line Quick Add entry into { amount, note }.
 * Rule: the first numeric run in the string is the amount; everything
 * else becomes the note. Whitespace around both is trimmed.
 *
 * Examples:
 *   "Coffee 180"        → { amount: 180, note: "Coffee" }
 *   "₹250 Lunch"        → { amount: 250, note: "Lunch" } (₹ prefix is stripped)
 *   "Lunch 12.50"       → { amount: 12.5, note: "Lunch" }
 *   "Hello"             → { amount: null, note: "Hello" } (no number → caller can decide)
 */
export function parseQuickAdd(text) {
  const raw = (text || "").trim();
  if (!raw) return { amount: null, note: "" };
  // Match a number, optionally with a decimal part. We also accept a
  // leading currency marker (₹, rs, inr) so "₹250 lunch" parses as
  // 250 + "lunch" instead of dropping the rupee sign into the note.
  const m = raw.match(/(?:₹|rs\.?|inr)?\s*(\d+(?:[.,]\d+)?)/i);
  if (!m) return { amount: null, note: raw };
  const amountStr = m[1].replace(",", ".");
  const amount = Number(amountStr);
  // Note = original text minus the matched amount (and any surrounding spaces).
  const note = (raw.slice(0, m.index) + raw.slice(m.index + m[0].length)).trim();
  return { amount: Number.isFinite(amount) ? amount : null, note };
}
