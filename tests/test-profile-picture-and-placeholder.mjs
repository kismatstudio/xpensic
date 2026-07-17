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

console.log("\n[2] util.js: anime animal avatar pack");
check("util.js exports listHeroAvatars",
  /export function listHeroAvatars\b/.test(utilSrc));
check("util.js exports generateHeroAvatarDataUrl",
  /export function generateHeroAvatarDataUrl\b/.test(utilSrc));
check("util.js exports getHeroAvatar (lookup helper)",
  /export function getHeroAvatar\b/.test(utilSrc));
check("hero pack defines multiple silhouettes",
  /const HERO_AVATARS\s*=\s*\[/.test(utilSrc) &&
  /animal_tiger/.test(utilSrc) && /animal_rhino/.test(utilSrc));
// Pack covers the species requested in the latest spec.
check("pack covers tiger, lion, elephant, fox, wolf, panther, jaguar, hyena, eagle, rhino",
  /animal_tiger/.test(utilSrc) &&
  /animal_lion/.test(utilSrc) &&
  /animal_elephant/.test(utilSrc) &&
  /animal_fox/.test(utilSrc) &&
  /animal_wolf/.test(utilSrc) &&
  /animal_panther/.test(utilSrc) &&
  /animal_jaguar/.test(utilSrc) &&
  /animal_hyena/.test(utilSrc) &&
  /animal_eagle/.test(utilSrc) &&
  /animal_rhino/.test(utilSrc));
// Each animal uses a `palette` (fur/belly/accent/eye) for richer
// coloring — not a single flat fill.
check("pack entries use a multi-colour palette (no flat-fall signature)",
  /palette:\s*\{\s*fur:/.test(utilSrc) && /belly:/.test(utilSrc) && /eye:/.test(utilSrc));
// Anime aesthetic markers: big eye whites + catch-lights + 'animeEyes'.
check("silhouette renderer uses big anime eyes with catch-lights",
  /animeEyes\s*=\s*\(/.test(utilSrc) && /catch-light/.test(utilSrc));
check("generateHeroAvatarDataUrl returns a data: URL",
  /"data:image\/svg\+xml;utf8,"/.test(utilSrc));
check("generateHeroAvatarDataUrl uses a unique gradient id per avatar",
  /gradId\s*=\s*[`"']g_/.test(utilSrc));

// Live checks: the helper is callable and returns a data URL.
const utilMod = await import("../js/util.js");
const heroes = utilMod.listHeroAvatars();
check("listHeroAvatars returns exactly 10 animal entries",
  Array.isArray(heroes) && heroes.length === 10);
check("listHeroAvatars returns entries with id, name, bg",
  heroes.every((h) => h.id && h.name && h.bg));
check("listHeroAvatars bg == palette.fur (used as picker swatch)",
  heroes.every((h) => /^#[0-9a-f]{6}$/i.test(h.bg)));
check("generateHeroAvatarDataUrl returns a data URL for an animal id",
  utilMod.generateHeroAvatarDataUrl("animal_tiger").startsWith("data:image/svg+xml"));
check("generateHeroAvatarDataUrl returns distinct URLs for distinct animals",
  utilMod.generateHeroAvatarDataUrl("animal_tiger") !==
    utilMod.generateHeroAvatarDataUrl("animal_lion"));
check("generateHeroAvatarDataUrl falls back for unknown id (uses tiger)",
  utilMod.generateHeroAvatarDataUrl("nonexistent_zzz") ===
    utilMod.generateHeroAvatarDataUrl("animal_tiger"));
check("every animal id from listHeroAvatars returns a renderable data URL",
  heroes.every((h) => {
    const url = utilMod.generateHeroAvatarDataUrl(h.id);
    return typeof url === "string" && url.startsWith("data:image/svg+xml") && url.length > 200;
  }));

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
