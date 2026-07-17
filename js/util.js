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

const HERO_AVATARS = [
  // anime animal pack — 10 species, drawn from SVG primitives. Each entry
  // has its own palette (fur/belly/accent/eye) so the result reads as a
  // real illustration rather than a flat logo. None of these rely on a
  // copyrighted likeness; they're generic animal tropes.
  { id: "animal_tiger",    name: "Tiger",    shape: "tiger",
    palette: { fur: "#f59e0b", belly: "#fff7ed", accent: "#1f2937", eye: "#0f172a" },
    letter: "T" },
  { id: "animal_lion",     name: "Lion",     shape: "lion",
    palette: { fur: "#d97706", belly: "#fef3c7", accent: "#78350f", eye: "#451a03" },
    letter: "L" },
  { id: "animal_elephant", name: "Elephant", shape: "elephant",
    palette: { fur: "#94a3b8", belly: "#e2e8f0", accent: "#475569", eye: "#1f2937" },
    letter: "E" },
  { id: "animal_fox",      name: "Fox",      shape: "fox",
    palette: { fur: "#ea580c", belly: "#fff7ed", accent: "#9a3412", eye: "#1f2937" },
    letter: "F" },
  { id: "animal_wolf",     name: "Wolf",     shape: "wolf",
    palette: { fur: "#6b7280", belly: "#e5e7eb", accent: "#374151", eye: "#fbbf24" },
    letter: "W" },
  { id: "animal_panther",  name: "Panther",  shape: "panther",
    palette: { fur: "#0f172a", belly: "#475569", accent: "#1e293b", eye: "#fbbf24" },
    letter: "P" },
  { id: "animal_jaguar",   name: "Jaguar",   shape: "jaguar",
    palette: { fur: "#ca8a04", belly: "#fef9c3", accent: "#713f12", eye: "#16a34a" },
    letter: "J" },
  { id: "animal_hyena",    name: "Hyena",    shape: "hyena",
    palette: { fur: "#a8a29e", belly: "#f5f5f4", accent: "#44403c", eye: "#fb923c" },
    letter: "H" },
  { id: "animal_eagle",    name: "Eagle",    shape: "eagle",
    palette: { fur: "#1e3a8a", belly: "#fef3c7", accent: "#fbbf24", eye: "#dc2626" },
    letter: "E" },
  { id: "animal_rhino",    name: "Rhino",    shape: "rhino",
    palette: { fur: "#71717a", belly: "#d4d4d8", accent: "#27272a", eye: "#fbbf24" },
    letter: "R" },
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
  return HERO_AVATARS.map((h) => ({ id: h.id, name: h.name, bg: h.palette.fur }));
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
 * Returns the SVG fragment for the chosen animal silhouette. Each shape is
 * drawn from primitives so no third-party asset is loaded.
 *
 * Layout: all animals render inside the 96×96 viewbox, fitting roughly
 * inside the upper ~55px so the chest emblem at y≈86 stays visible.
 */
/**
 * Returns the SVG fragment for the chosen animal, drawn in an anime
 * aesthetic. Each species gets:
 *   • Anime-style huge eyes (large dark iris + a tiny white catch-light)
 *   • A fur body in the species' natural colour (from `fur`)
 *   • A small lighter belly / muzzle panel (from `belly`) so the
 *     illustration reads as a 3D face, not a flat logo
 *   • Species-specific features (stripes, mane, antlers, trunk, beak)
 *
 * Every shape is composed from SVG primitives — no third-party assets,
 * no copyrighted likenesses, no real photographs.
 *
 * Layout: animal fits inside the upper ~70px of the 96x96 viewBox so the
 * chest emblem (rendered separately at y~86) stays visible at the bottom.
 *
 * `p` is the full entry from HERO_AVATARS so we can read its palette + shape.
 */
/**
 * Returns the SVG fragment for the chosen animal, drawn in an anime
 * aesthetic. Each species gets:
 *   • Big anime-style eyes with a tiny white catch-light
 *   • A fur body in the species' natural colour (palette.fur)
 *   • A lighter belly / muzzle panel (palette.belly) so the illustration
 *     reads as a 3D face rather than a flat logo
 *   • Species-specific features (stripes, mane, trunk, beak, horns)
 *
 * Every shape is composed from SVG primitives — no third-party assets,
 * no copyrighted likenesses, no real photographs.
 *
 * Layout: animal fits inside the upper ~70px of the 96x96 viewBox so the
 * chest emblem (rendered separately at y~86) stays visible at the bottom.
 */
function heroSilhouetteSvg(p) {
  const fur = p.palette.fur;
  const belly = p.palette.belly;
  const accent = p.palette.accent;
  const eye = p.palette.eye;

  const animeEyes = (cxL, cxR, cy) =>
    heroCircle(cxL, cy, 5.5, "#ffffff") +
    heroCircle(cxL, cy, 4, eye) +
    heroCircle(cxL + 1, cy - 1, 1.4, "#ffffff") +
    heroCircle(cxR, cy, 5.5, "#ffffff") +
    heroCircle(cxR, cy, 4, eye) +
    heroCircle(cxR + 1, cy - 1, 1.4, "#ffffff");

  switch (p.shape) {
    case "tiger": {
      return (
        `<path d="M22 40 L30 22 L36 36 Q48 22 60 36 L66 22 L74 40 Q80 56 70 66 Q58 74 48 74 Q38 74 26 66 Q16 56 22 40 Z" fill="${fur}"/>` +
        `<path d="M36 56 Q48 64 60 56 Q60 70 48 72 Q36 70 36 56 Z" fill="${belly}"/>` +
        `<path d="M40 28 L44 36 L40 38 Z" fill="${accent}"/>` +
        `<path d="M52 28 L48 36 L52 38 Z" fill="${accent}"/>` +
        `<path d="M44 38 L42 44 L46 44 Z" fill="${accent}"/>` +
        `<path d="M54 38 L56 44 L52 44 Z" fill="${accent}"/>` +
        `<path d="M32 50 L28 56 L32 58 Z" fill="${accent}"/>` +
        `<path d="M64 50 L68 56 L64 58 Z" fill="${accent}"/>` +
        animeEyes(38, 58, 50) +
        `<path d="M46 58 L48 62 L50 58 Z" fill="${accent}"/>`);
    }
    case "lion": {
      return (
        `<path d="M16 40 L24 22 L30 36 Q40 18 48 26 Q56 18 66 36 L72 22 L80 40 Q86 56 76 64 L74 72 L66 70 L60 76 L52 76 L44 76 L36 76 L30 70 L22 72 L20 64 Q10 56 16 40 Z" fill="${fur}"/>` +
        `<path d="M28 40 L34 32 L42 30 Q56 30 64 32 L70 40 Q72 56 60 62 Q48 64 36 62 Q24 56 28 40 Z" fill="${accent}" opacity="0.55"/>` +
        `<path d="M40 56 Q48 62 56 56 Q58 70 48 72 Q38 70 40 56 Z" fill="${belly}"/>` +
        animeEyes(40, 56, 52) +
        `<path d="M46 60 L48 64 L50 60 Z" fill="${accent}"/>`);
    }
    case "panther": {
      return (
        `<path d="M22 42 L30 22 L38 36 Q48 22 58 36 L66 22 L74 42 Q80 58 70 68 Q58 76 48 76 Q38 76 26 68 Q16 58 22 42 Z" fill="${fur}"/>` +
        `<path d="M30 50 Q48 56 66 50 L66 66 Q48 72 30 66 Z" fill="${accent}" opacity="0.45"/>` +
        heroCircle(38, 52, 5, "#fde047") +
        heroCircle(58, 52, 5, "#fde047") +
        `<ellipse cx="38" cy="52" rx="0.9" ry="3.2" fill="${eye}"/>` +
        `<ellipse cx="58" cy="52" rx="0.9" ry="3.2" fill="${eye}"/>` +
        `<path d="M46 60 L48 64 L50 60 Z" fill="${belly}"/>`);
    }
    case "jaguar": {
      return (
        `<path d="M22 40 L30 22 L36 34 Q48 22 60 34 L66 22 L74 40 Q80 56 70 66 Q58 74 48 74 Q38 74 26 66 Q16 56 22 40 Z" fill="${fur}"/>` +
        `<path d="M36 56 Q48 62 60 56 Q58 70 48 72 Q38 70 36 56 Z" fill="${belly}"/>` +
        `<g fill="none" stroke="${accent}" stroke-width="1.6" opacity="0.85">` +
          `<circle cx="32" cy="34" r="4.5"/>` +
          `<circle cx="48" cy="28" r="4.5"/>` +
          `<circle cx="64" cy="34" r="4.5"/>` +
          `<circle cx="68" cy="52" r="4.5"/>` +
          `<circle cx="48" cy="46" r="4.5"/>` +
          `<circle cx="30" cy="54" r="4.5"/>` +
          `<circle cx="52" cy="62" r="4.5"/>` +
        `</g>` +
        heroCircle(33, 35, 1.6, accent, 0.9) +
        heroCircle(49, 29, 1.6, accent, 0.9) +
        heroCircle(65, 35, 1.6, accent, 0.9) +
        heroCircle(69, 53, 1.6, accent, 0.9) +
        heroCircle(49, 47, 1.6, accent, 0.9) +
        heroCircle(31, 55, 1.6, accent, 0.9) +
        heroCircle(53, 63, 1.6, accent, 0.9) +
        animeEyes(38, 58, 52) +
        `<path d="M46 60 L48 64 L50 60 Z" fill="${accent}"/>`);
    }
    case "hyena": {
      return (
        `<path d="M22 44 L28 26 L34 38 Q48 22 62 38 L68 26 L74 44 Q82 60 72 68 Q60 74 48 74 Q36 74 24 68 Q14 60 22 44 Z" fill="${fur}"/>` +
        `<path d="M30 22 L28 12 L34 22 L36 10 L38 22 L40 12 L42 22 L44 10 L46 22 L48 10 L50 22 Z" fill="${accent}"/>` +
        `<path d="M36 56 Q48 64 60 56 Q60 70 48 72 Q36 70 36 56 Z" fill="${belly}"/>` +
        heroCircle(28, 50, 2, accent, 0.55) +
        heroCircle(34, 62, 2, accent, 0.55) +
        heroCircle(42, 50, 2, accent, 0.55) +
        heroCircle(54, 50, 2, accent, 0.55) +
        heroCircle(62, 62, 2, accent, 0.55) +
        heroCircle(68, 50, 2, accent, 0.55) +
        heroCircle(38, 50, 5, "#ffffff") +
        heroCircle(38, 50, 4, "#fb923c") +
        heroCircle(39, 49, 1.4, "#ffffff") +
        heroCircle(58, 50, 5, "#ffffff") +
        heroCircle(58, 50, 4, "#fb923c") +
        heroCircle(59, 49, 1.4, "#ffffff") +
        `<path d="M44 60 L48 66 L52 60 L48 62 Z" fill="${accent}"/>`);
    }
    case "elephant": {
      return (
        `<path d="M22 30 Q22 18 36 18 L60 18 Q76 18 76 32 L76 56 Q74 66 66 66 L62 64 L60 60 Q66 76 56 82 Q44 86 38 78 Q44 64 50 60 Q42 58 36 54 Q22 50 22 38 Q22 32 22 30 Z" fill="${fur}"/>` +
        `<path d="M18 28 Q4 28 8 50 Q14 66 28 60 Q34 50 30 38 Q26 28 18 28 Z" fill="${accent}" opacity="0.85"/>` +
        `<path d="M40 62 Q44 70 46 64" stroke="${belly}" stroke-width="2.5" fill="none" stroke-linecap="round"/>` +
        animeEyes(40, 56, 38) +
        `<path d="M34 30 L42 32" stroke="${accent}" stroke-width="1.6" stroke-linecap="round"/>` +
        `<path d="M56 32 L62 30" stroke="${accent}" stroke-width="1.6" stroke-linecap="round"/>`);
    }
    case "fox": {
      return (
        `<path d="M22 38 L28 16 L40 32 Q48 26 56 32 L68 16 L74 38 Q78 54 70 60 L66 68 Q60 72 54 68 L52 64 L46 68 L40 68 L34 64 L30 60 Q20 50 22 38 Z" fill="${fur}"/>` +
        `<path d="M30 50 Q40 58 48 50 Q56 58 66 50 L64 60 Q56 64 48 60 Q40 64 32 60 Z" fill="${belly}"/>` +
        `<path d="M44 26 L48 32 L52 26 Z" fill="${belly}"/>` +
        animeEyes(40, 56, 46) +
        `<ellipse cx="48" cy="56" rx="2" ry="1.5" fill="${accent}"/>`);
    }
    case "wolf": {
      return (
        `<path d="M22 36 L30 14 L40 30 Q48 24 56 30 L66 14 L74 36 Q80 50 72 60 L66 70 Q60 72 56 64 L54 60 L48 64 Q42 64 42 60 L40 64 Q36 72 30 70 L24 60 Q16 50 22 36 Z" fill="${fur}"/>` +
        `<path d="M32 18 L34 28 L28 26 Z" fill="${accent}"/>` +
        `<path d="M64 18 L62 28 L68 26 Z" fill="${accent}"/>` +
        `<path d="M38 56 Q48 62 58 56 Q60 66 48 68 Q36 66 38 56 Z" fill="${belly}"/>` +
        heroCircle(38, 48, 5, "#ffffff") +
        heroCircle(38, 48, 4, "#fbbf24") +
        heroCircle(39, 47, 1.4, "#ffffff") +
        heroCircle(58, 48, 5, "#ffffff") +
        heroCircle(58, 48, 4, "#fbbf24") +
        heroCircle(59, 47, 1.4, "#ffffff") +
        `<ellipse cx="48" cy="60" rx="2.5" ry="1.6" fill="${accent}"/>`);
    }
    case "eagle": {
      return (
        `<path d="M28 28 Q28 18 38 16 L58 16 Q68 18 70 28 L70 52 Q66 62 58 64 L48 66 Q38 66 32 60 Q28 52 28 28 Z" fill="${fur}"/>` +
        `<path d="M38 30 L58 30 L56 50 Q48 56 40 50 Z" fill="${belly}"/>` +
        `<path d="M40 16 L36 6 L42 14 L48 4 L54 14 L60 6 L56 16 Z" fill="${fur}"/>` +
        `<path d="M44 54 L48 64 L52 54 Z" fill="${accent}"/>` +
        heroCircle(40, 42, 5, "#ffffff") +
        heroCircle(40, 42, 4, eye) +
        heroCircle(41, 41, 1.4, "#ffffff") +
        heroCircle(56, 42, 5, "#ffffff") +
        heroCircle(56, 42, 4, eye) +
        heroCircle(57, 41, 1.4, "#ffffff") +
        `<path d="M34 36 L42 32" stroke="${accent}" stroke-width="2" stroke-linecap="round"/>` +
        `<path d="M62 36 L54 32" stroke="${accent}" stroke-width="2" stroke-linecap="round"/>`);
    }
    case "rhino": {
      return (
        `<path d="M16 42 Q22 22 38 18 L56 18 Q72 22 80 42 Q82 60 72 66 L60 68 L52 72 L44 72 L36 68 L24 66 Q14 60 16 42 Z" fill="${fur}"/>` +
        `<path d="M32 58 Q48 64 64 58 Q66 70 48 72 Q30 70 32 58 Z" fill="${belly}"/>` +
        `<path d="M44 18 L40 38 L52 36 L56 18 Z" fill="${accent}"/>` +
        `<path d="M62 22 L60 34 L70 32 Z" fill="${accent}"/>` +
        `<ellipse cx="22" cy="32" rx="5" ry="4" fill="${fur}"/>` +
        `<ellipse cx="22" cy="32" rx="2.5" ry="2" fill="${accent}" opacity="0.7"/>` +
        `<ellipse cx="74" cy="32" rx="5" ry="4" fill="${fur}"/>` +
        `<ellipse cx="74" cy="32" rx="2.5" ry="2" fill="${accent}" opacity="0.7"/>` +
        heroCircle(36, 46, 5, "#ffffff") +
        heroCircle(36, 46, 4, eye) +
        heroCircle(37, 45, 1.4, "#ffffff") +
        heroCircle(60, 46, 5, "#ffffff") +
        heroCircle(60, 46, 4, eye) +
        heroCircle(61, 45, 1.4, "#ffffff"));
    }
    default:
      return `<circle cx="48" cy="48" r="22" fill="${fur}"/>`;
  }
}


/**
 * Build a data-URL avatar for one of the built-in anime-animal avatars.
 * Unknown ids fall back to the first entry. The output is a 96×96 inline
 * SVG with a gradient circle background, the animal illustration, and a
 * small chest emblem showing the first letter of the animal name.
 *
 * Uses template literals so the SVG markup can carry its own double
 * quotes without breaking the JS string.
 */
export function generateHeroAvatarDataUrl(id) {
  const hero = getHeroAvatar(id);
  const fur = escapeAttr(hero.palette.fur);
  const accent = escapeAttr(hero.palette.accent);
  const letter = escapeAttr(hero.letter || (hero.name || "?").slice(0, 1).toUpperCase());

  // Uniquely gradient id per archetype so multiple avatars on a page
  // don't share a <linearGradient id="bg"> reference.
  const gradId = `g_${hero.id}`;
  const silhouette = heroSilhouetteSvg(hero);

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${fur}"/>
          <stop offset="1" stop-color="${accent}"/>
        </linearGradient>
      </defs>
      <rect width="96" height="96" rx="48" fill="url(#${gradId})"/>
      ${silhouette}
      <circle cx="48" cy="86" r="9" fill="#ffffff"/>
      <text x="48" y="89" text-anchor="middle"
            font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
            font-size="11" font-weight="700" fill="${fur}">${letter}</text>
    </svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
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
  { id: "cat_food",        words: ["coffee", "tea", "lunch", "dinner", "breakfast", "snack", "swiggy", "zomato", "restaurant", "groceries", "food", "cafe", "starbucks", "mcdonald", "kfc", "dominos", "pizza", "burger"] },
  { id: "cat_transport",   words: ["uber", "ola", "rapido", "auto", "taxi", "cab", "bus", "metro", "train", "flight", "petrol", "diesel", "fuel", "parking", "toll"] },
  { id: "cat_housing",     words: ["rent", "maintenance", "society", "apartment", "mortgage"] },
  { id: "cat_utilities",   words: ["electricity", "water", "gas", "internet", "wifi", "broadband", "mobile", "recharge", "postpaid", "utility"] },
  { id: "cat_entertainment", words: ["netflix", "spotify", "prime", "hotstar", "movie", "cinema", "concert", "game", "pubg", "playstation"] },
  { id: "cat_health",      words: ["pharmacy", "medicine", "doctor", "hospital", "clinic", "gym", "yoga", "dental", "health"] },
  { id: "cat_shopping",    words: ["amazon", "flipkart", "myntra", "ajio", "shopping", "clothes", "shoes", "mall"] },
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
 *   "₹250 Lunch"        → { amount: 250, note: "₹ Lunch" } (₹ is preserved in the note)
 *   "Lunch 12.50"       → { amount: 12.5, note: "Lunch" }
 *   "Hello"             → { amount: null, note: "Hello" } (no number → caller can decide)
 */
export function parseQuickAdd(text) {
  const raw = (text || "").trim();
  if (!raw) return { amount: null, note: "" };
  // Match a number, optionally with a decimal part. Commas in numbers are
  // converted to dots so "12,50" parses as 12.5.
  const m = raw.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return { amount: null, note: raw };
  const amountStr = m[1].replace(",", ".");
  const amount = Number(amountStr);
  // Note = original text minus the matched amount (and any surrounding spaces).
  const note = (raw.slice(0, m.index) + raw.slice(m.index + m[0].length)).trim();
  return { amount: Number.isFinite(amount) ? amount : null, note };
}
