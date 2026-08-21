// Minimal .env loader — reads KEY=VALUE lines from a .env file in the
// process's working directory and merges them into process.env. Anything
// already in process.env wins (so real shell exports still take
// precedence over the file). No dependencies; Node 18+ built-ins only.
//
// Why not `dotenv`? One more dep, one more failure mode. The file
// format is well-defined and we don't need variable expansion, multiline
// values, or any of dotenv's other features.
//
// Lines that start with `#` are comments. Empty lines are skipped.
// Values may optionally be quoted with single or double quotes; quotes
// are stripped. Backslash escapes inside double quotes are honoured.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILES = [".env", ".env.local"];

/**
 * Load KEY=VALUE pairs from the first existing `.env` / `.env.local`
 * in `cwd` (defaults to `process.cwd()`) into `process.env`. Existing
 * env vars take precedence — we only fill in keys that are unset.
 *
 * Returns the path of the file that was loaded (or `null` if none).
 *
 * @param {{ cwd?: string, files?: string[] }} [opts]
 * @returns {string | null}
 */
export function loadEnvFile(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const files = opts.files || ENV_FILES;
  for (const name of files) {
    const path = resolve(cwd, name);
    if (!existsSync(path)) continue;
    try {
      const text = readFileSync(path, "utf8");
      applyEnvText(text);
      return path;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[env] could not read ${path}: ${err?.message || err}`);
    }
  }
  return null;
}

function applyEnvText(text) {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
      if (value.startsWith('"')) {
        value = value.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
    }
    if (process.env[key] === undefined) {
      // Only fill from file when the key is truly absent. An explicitly
      // empty string in the parent env ("RESEND_API_KEY=" in a test
      // harness) is treated as a deliberate force-disable and wins.
      process.env[key] = value;
    }
  }
}