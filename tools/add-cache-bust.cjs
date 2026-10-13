// One-shot script: add ?v=<VERSION> to every relative import in js/.
// Run from the repo root: `node tools/add-cache-bust.cjs`
//
// Why: Chrome aggressively caches parsed ES modules even when the
// dev server sends Cache-Control: no-store. The only reliable way
// to force a fresh fetch is a unique URL per deploy — we append a
// version query string to every relative import. The entry script
// tag in index.html is bumped in lockstep.
//
// Idempotent: skips paths that already carry a query string.

const fs = require("fs");
const path = require("path");

const VERSION = process.argv[2] || "14";
const ROOT = path.join(__dirname, "..", "js");

let updated = 0;
let skipped = 0;

function processFile(filePath) {
  const original = fs.readFileSync(filePath, "utf8");
  let content = original;

  // Static imports: from "./path" | from "../path" | from "./path.mjs"
  content = content.replace(
    /(from\s+["'])(\.\.?\/[^"']+)(["'])/g,
    (match, prefix, importPath, suffix) => {
      if (importPath.includes("?")) {
        skipped++;
        return match;
      }
      updated++;
      return `${prefix}${importPath}?v=${VERSION}${suffix}`;
    },
  );

  // Dynamic imports: import("./path") | import("../path")
  content = content.replace(
    /(import\s*\(\s*["'])(\.\.?\/[^"']+)(["'])/g,
    (match, prefix, importPath, suffix) => {
      if (importPath.includes("?")) {
        skipped++;
        return match;
      }
      updated++;
      return `${prefix}${importPath}?v=${VERSION}${suffix}`;
    },
  );

  if (content !== original) {
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`  updated ${path.relative(path.join(__dirname, ".."), filePath)}`);
  }
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) {
      processFile(full);
    }
  }
}

console.log(`Adding ?v=${VERSION} to relative imports under ${ROOT}`);
walk(ROOT);
console.log(`Done. ${updated} imports versioned, ${skipped} already had a query string.`);
