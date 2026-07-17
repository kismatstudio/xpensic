// ID generation. Uses crypto.randomUUID when available, falls back to a
// timestamp + random suffix for older runtimes.

export function newId(prefix = "id") {
  let core;
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    core = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  } else {
    core = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
  return `${prefix}_${core}`;
}
