// Single-command test runner. Discovers every test-*.mjs in this directory
// and runs them in order, printing a per-file summary and a grand total.
// Exit code is the number of failed test files (0 = all green).
//
// Usage:   node tests/run-all.mjs
//          node tests/run-all.mjs --bail   (stop on the first failing file)

import { readdirSync, statSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const testsDir = __dirname;
const bail = process.argv.includes("--bail");

// Discover test files: test-*.mjs at the top level only.
const files = readdirSync(testsDir)
  .filter((f) => f.startsWith("test-") && f.endsWith(".mjs"))
  .sort();

if (files.length === 0) {
  console.log("No test files found in", testsDir);
  process.exit(0);
}

console.log(`Running ${files.length} test file(s)…\n`);

let grandPass = 0;
let grandFail = 0;
let failedFiles = 0;
const start = Date.now();

for (const f of files) {
  process.stdout.write(`  ${f}  `);
  const t0 = Date.now();
  const result = spawnSync(process.execPath, [join(testsDir, f)], {
    cwd: dirname(testsDir), // project root, so the tests' relative paths work
    encoding: "utf8",
  });
  const elapsed = Date.now() - t0;
  if (result.status !== 0) {
    // The test failed — print its output so the user can see why.
    console.log(`\n\n${result.stdout || ""}${result.stderr || ""}`);
    console.log(`  ${f}  FAILED (exit ${result.status}, ${elapsed}ms)`);
    failedFiles++;
    if (bail) break;
    continue;
  }
  // Pull the "<n> passed, <m> failed" line out of the output.
  const out = result.stdout || "";
  const summary = out.split(/\r?\n/).reverse().find((l) => /^\d+ passed/.test(l.trim())) || "";
  if (summary) {
    const m = summary.trim().match(/^(\d+)\s+passed(?:,\s+(\d+)\s+failed)?/);
    if (m) {
      const pass = parseInt(m[1], 10);
      const fail = parseInt(m[2] || "0", 10);
      grandPass += pass;
      grandFail += fail;
      if (fail > 0) failedFiles++;
      console.log(`${summary.trim()}  (${elapsed}ms)`);
    } else {
      console.log(`(couldn't parse summary: ${JSON.stringify(summary)})`);
    }
  } else {
    console.log("(no summary found)");
  }
}

const total = Date.now() - start;
console.log(`\n${"─".repeat(60)}`);
console.log(`  TOTAL: ${grandPass} passed, ${grandFail} failed across ${files.length} file(s) in ${total}ms`);
if (failedFiles > 0) {
  console.log(`  ${failedFiles} file(s) failed.`);
  process.exit(failedFiles);
}
console.log(`  All green. ✓`);
process.exit(0);
