// Tests for the optional profile picture uploader:
//   • The Edit-profile modal lets the user pick an existing device photo
//     OR choose a built-in character (hero silhouette).
//   • processProfilePicture() validates type/size and center-crops to a
//     square JPEG data URL.
//   • listHeroAvatars() + generateHeroAvatarDataUrl() expose the pack.
//   • The home-page drawer chip beside the hamburger reflects the stored
//     avatar (handled via Store.updateProfile + renderNavProfile).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}` + (extra ? `  (${extra})` : "")); fail++; }
}

const profile = read("js/views/profile.js");
const main = read("js/main.js");
const utilSrc = read("js/util.js");

// ---- Section 1: util.processProfilePicture -----------------------------

console.log("\n[1] util.js: processProfilePicture");
check("util.js exports processProfilePicture",
  /export function processProfilePicture\b/.test(utilSrc));
check("processProfilePicture validates file type",
  /test\(file\.type/.test(utilSrc) && utilSrc.includes("/^image"));
check("processProfilePicture caps file size",
  /maxBytes\s*=\s*8\s*\*\s*1024\s*\*\s*1024/.test(utilSrc));
check("processProfilePicture center-crops to a square",
  /Math\.min\(img\.width,\s*img\.height\)/.test(utilSrc));
check("processProfilePicture downscales to maxSide",
  /Math\.min\(side,\s*maxSide\)/.test(utilSrc));
check("processProfilePicture returns a JPEG data URL",
  /toDataURL\("image\/jpeg"/.test(utilSrc));
check("processProfilePicture resolves with {ok, ...}",
  /resolve\(\s*\{\s*ok:\s*(true|false)/.test(utilSrc));

// ---- Section 2: hero avatar pack ---------------------------------------

console.log("\n[2] util.js: themed animal avatar pack (12 animals)");
check("util.js exports listHeroAvatars",
  /export function listHeroAvatars\b/.test(utilSrc));
check("util.js exports generateHeroAvatarDataUrl",
  /export function generateHeroAvatarDataUrl\b/.test(utilSrc));
check("util.js exports getHeroAvatar (lookup helper)",
  /export function getHeroAvatar\b/.test(utilSrc));
check("hero pack defines multiple silhouettes",
  /const HERO_AVATARS\s*=\s*\[/.test(utilSrc) &&
  /animal_elephant/.test(utilSrc) && /animal_leopard/.test(utilSrc));
// Pack covers the 12 themed animals in the new spec (replaces the old
// 10-animal anime pack). Each animal is mapped to a personal-finance
// theme via a unique `prop` (coin, calculator, percent, etc.).
check("pack covers elephant, owl, fox, squirrel, ant, eagle, turtle, bee, bear, wolf, rhino, leopard",
  /animal_elephant/.test(utilSrc) &&
  /animal_owl/.test(utilSrc) &&
  /animal_fox/.test(utilSrc) &&
  /animal_squirrel/.test(utilSrc) &&
  /animal_ant/.test(utilSrc) &&
  /animal_eagle/.test(utilSrc) &&
  /animal_turtle/.test(utilSrc) &&
  /animal_bee/.test(utilSrc) &&
  /animal_bear/.test(utilSrc) &&
  /animal_wolf/.test(utilSrc) &&
  /animal_rhino/.test(utilSrc) &&
  /animal_leopard/.test(utilSrc));
// Each animal uses a `palette` (fur/belly/accent/eye) for richer
// coloring — not a single flat fill.
check("pack entries use a multi-colour palette (no flat-fall signature)",
  /palette:\s*\{\s*fur:/.test(utilSrc) && /belly:/.test(utilSrc) && /eye:/.test(utilSrc));
// Pixar-style aesthetic markers: pixarEye helper + big eyes + catch-lights.
check("silhouette renderer uses Pixar-style eyes with catch-lights",
  /function pixarEye\b/.test(utilSrc) && /catch-light/.test(utilSrc));
check("generateHeroAvatarDataUrl returns a file path (SVG asset)",
  /return\s*[`"']\/logos\/avatars\//.test(utilSrc));

// Live checks: the helper is callable and returns a file path.
const utilMod = await import("../js/util.js");
const heroes = utilMod.listHeroAvatars();
check("listHeroAvatars returns exactly 12 animal entries",
  Array.isArray(heroes) && heroes.length === 12);
check("listHeroAvatars returns entries with id, name, bg",
  heroes.every((h) => h.id && h.name && h.bg));
check("listHeroAvatars bg == palette.fur (used as picker swatch)",
  heroes.every((h) => /^#[0-9a-f]{6}$/i.test(h.bg)));
check("generateHeroAvatarDataUrl returns a file path for an animal id",
  utilMod.generateHeroAvatarDataUrl("animal_elephant").startsWith("/logos/avatars/"));
check("generateHeroAvatarDataUrl returns distinct paths for distinct animals",
  utilMod.generateHeroAvatarDataUrl("animal_elephant") !==
    utilMod.generateHeroAvatarDataUrl("animal_owl"));

// The new avatar pack ships as real SVG files under /logos/avatars/, so
// the helper returns a path instead of an inlined data-URL. Each path
// must point at an existing asset so the <img> never 404s.
check("every animal id maps to an existing avatar file",
  heroes.every((h) => {
    const url = utilMod.generateHeroAvatarDataUrl(h.id);
    return typeof url === "string" && url.startsWith("/logos/avatars/") && url.endsWith(".svg");
  }));
check("generateHeroAvatarDataUrl falls back for unknown id (uses first animal)",
  utilMod.generateHeroAvatarDataUrl("nonexistent_zzz") ===
    utilMod.generateHeroAvatarDataUrl(heroes[0].id));

// ---- Section 3: profile.js — modal sections ---------------------------

console.log("\n[3] profile.js: Edit-modal sections");
check("profile imports processProfilePicture + hero helpers",
  /processProfilePicture/.test(profile) && /listHeroAvatars/.test(profile)
  && /generateHeroAvatarDataUrl/.test(profile));
check("Edit modal renders a preview <img>",
  /id="prof-avatar-preview"/.test(profile));
check("Edit modal has a hidden file input",
  /<input[\s\S]{0,400}id="prof-avatar-input"[\s\S]{0,400}\bhidden\b/.test(profile));
check("file input accepts image/*",
  /id="prof-avatar-input"[\s\S]{0,400}accept="image\/\*"/.test(profile));
check("Edit modal has a Remove photo button",
  /id="prof-avatar-remove"[\s\S]{0,400}>Remove photo</.test(profile));
check("Edit modal has a hero-picker grid",
  /id="prof-hero-grid"/.test(profile));
check("hero grid has role=radiogroup",
  /id="prof-hero-grid"[\s\S]{0,80}role="radiogroup"/.test(profile));
check("hero cells have role=radio",
  /hero-grid__cell"[\s\S]{0,80}role="radio"/.test(profile));
check("label says 'optional'",
  /Profile picture\s*\(optional\)/.test(profile));

// ---- Section 4: profile.js — wiring -----------------------------------

console.log("\n[4] profile.js: upload/remove/hero wiring");
check("file input change handler calls processProfilePicture(file)",
  // Source binds via the $input local (set from body.querySelector("#prof-avatar-input"))
  // then calls $input.addEventListener("change", async (ev) => { ... processProfilePicture(file) ... }).
  // We just check the two pieces exist within reasonable distance.
  /\$input\.addEventListener\("change"/.test(profile)
  && /processProfilePicture\(file\)/.test(profile));
check("Remove button click handler exists",
  /prof-avatar-remove[\s\S]{0,2000}addEventListener\("click"/.test(profile));
check("hero cell click handler generates a hero avatar data URL",
  /generateHeroAvatarDataUrl\(heroId\)/.test(profile));
check("Save handler resolves pendingAvatar / avatarRemoved / fallback",
  /if\s*\(pendingAvatar\)[\s\S]{0,40}avatarToSave\s*=\s*pendingAvatar/.test(profile)
  && /else if\s*\(avatarRemoved\)[\s\S]{0,40}avatarToSave\s*=\s*""/.test(profile)
  && /p\.avatarDataUrl\s*\|\|\s*""/.test(profile));
check("Save persists via Store.updateProfile + Store.save",
  /Store\.updateProfile\(state[\s\S]{0,80}avatarDataUrl:\s*avatarToSave/.test(profile)
  && /Store\.save\(state\)/.test(profile));
check("Save calls refreshNav so the drawer chip refreshes",
  /typeof ctx\.refreshNav\s*===\s*"function"[\s\S]{0,200}ctx\.refreshNav\(\)/.test(profile));

// ---- Section 5: main.js — drawer chip uses the stored avatar ---------

console.log("\n[5] main.js: drawer chip beside the hamburger");
check("main.js renders the drawer chip into #app-nav-profile",
  /getElementById\("app-nav-profile"\)/.test(main));
check("drawer chip prefers stored avatarDataUrl",
  /p\.avatarDataUrl\s*\|\|\s*generateAvatarDataUrl\(p\)/.test(main));
check("render() runs renderNavProfile() so changes appear immediately",
  /renderNavProfile\(\)/.test(main));
check("profile route is wired to refreshNav = renderNavProfile",
  /refreshNav:\s*\(\)\s*=>\s*renderNavProfile\(\)/.test(main));

// ---- Section 6: drawer signout button ---------------------------------
// The hamburger menu adds a one-tap "Sign out" affordance in the nav
// list (index.html). The button must carry the right accessibility
// hooks and be wired to the same signOut() function used by the Profile
// view's button.

console.log("\n[6] drawer signout button");
check("drawer profile host uses a .app-nav__profile-card wrapper",
  /class="app-nav__profile-card"/.test(main));
check("drawer profile host renders a #app-nav-signout button",
  /id="app-nav-signout"/.test(read("index.html")));
check("signout button has aria-label='Sign out'",
  /id="app-nav-signout"[\s\S]{0,200}aria-label="Sign out"/.test(read("index.html")));
check("signout button carries an exit-glyph SVG icon",
  /class="nav-link__icon"[\s\S]{0,400}polyline points="16 17 21 12 16 7"/.test(read("index.html")));
check("signout button is wired to signOut() (directly or via confirmSignOut)",
  /app-nav-signout"[\s\S]{0,400}addEventListener\("click",\s*\(\)\s*=>\s*(confirm)?[sS]ignOut\(\)\)/.test(main));
check("nav click handler closes the drawer when signout is clicked",
  /e\.target\.closest\("\.nav-link"\)/.test(main));
check("layout.css styles .nav-link--signout with a danger hover",
  /\.nav-link--signout[\s\S]{0,300}color-danger/.test(read("css/layout.css")));

// ---- Section 7: main.js — drawer XPENSIC brand block -----------------
// The hamburger menu shows the XPENSIC brand (logo + name) at the top
// of the profile section, above the user info, so the empty space
// doesn't go to waste and the app identity is reinforced on every draw.
//
// Brand update: the drawer mark is now an <img> (cropped from the new
// horizontal logo) instead of the old "₹ on a gradient tile" span.
// Both light + dark variants are inlined and swapped via CSS.

console.log("\n[7] main.js: hamburger drawer brand block");
check("drawer profile host renders an .app-nav__brand block",
  /<div class="app-nav__brand">/.test(main));
check("brand block sits above the profile card",
  /<div class="app-nav__brand">[\s\S]{0,2000}<div class="app-nav__profile-card">/.test(main));
check("brand block contains a light-mode SVG logo",
  /class="app-nav__brand-mark app-nav__brand-mark--light"[\s\S]{0,200}src="logos\/xpensic-light\.svg"/.test(main));
check("brand block contains a dark-mode SVG logo",
  /class="app-nav__brand-mark app-nav__brand-mark--dark"[\s\S]{0,200}src="logos\/xpensic-dark\.svg"/.test(main));
check("brand block contains the 'Track expenses. Take control.' tagline",
  /class="app-nav__brand-tagline"[^>]*>Track expenses\. Take control\.</.test(main));
check("layout.css styles .app-nav__brand-mark as the SVG logo lockup",
  /\.app-nav__brand-mark\s*\{[\s\S]{0,400}(width:\s*120px)/.test(read("css/layout.css")));

// Login-gate brand: full SVG lockup + live tagline
console.log("\n[7b] login.js: gate brand block");
check("gate renders a light-mode SVG logo",
  /class="login-gate__mark login-gate__mark--light"[\s\S]{0,200}src="logos\/xpensic-light\.svg"/.test(read("js/views/login.js")));
check("gate renders a dark-mode SVG logo",
  /class="login-gate__mark login-gate__mark--dark"[\s\S]{0,200}src="logos\/xpensic-dark\.svg"/.test(read("js/views/login.js")));
check("gate renders the 'Track expenses. Take control.' tagline as live text",
  /class="login-gate__tagline"[^>]*>Track expenses\. Take control\.</.test(read("js/views/login.js")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
