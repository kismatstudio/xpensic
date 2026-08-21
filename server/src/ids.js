// Tiny id helper, mirroring the client's ids.js. Kept in the server so
// the server can mint userIds without depending on a client module
// (which targets the browser).

import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32

export function newId(prefix) {
  // 16 bytes of randomness → 26 base32 chars. Same shape as the client.
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `${prefix}_${out}`;
}
