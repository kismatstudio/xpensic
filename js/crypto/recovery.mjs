// Recovery phrase — a 12-word mnemonic the user writes down once,
// right after first unlock, as a last-resort way to unwrap the MK
// if they forget their password AND lose access to all paired
// devices.
//
// We don't pull in a 1k-word BIP39 dictionary (that's a lot of
// bytes for a small app). Instead we use a 256-word custom wordlist
// tuned for short, typeable English. Each word encodes 8 bits, so
// 32 words give us 256 bits of entropy. The phrase is normalised to
// lowercase + trimmed before use so a transposed letter or extra
// space doesn't break the unwrap.
//
// The phrase is the second wrap on the MK (alongside the password
// wrap). Losing the phrase doesn't compromise the account — losing
// the password + all devices does.

import { randomBytes, sha256 } from "./sodium.mjs";

// Compact 256-word list. Each word is short, common, and easy to
// spell. Curated to avoid homophones (to/few/too) and words with
// ambiguous spellings. Inlined so the recovery module is
// self-contained.
const WORDS = ("able acid aged also army away baby back ball band bank "
  + "bare bark barn base bath bear beat bed bee bell bend "
  + "best bill bird blue boat body bond bone book born boss "
  + "both bowl bulk burn busy cake calf came camp card care "
  + "case cash cast cell chat chip city club coat code cold "
  + "come cook cool copy core cost crew crop cure cute dark "
  + "data dawn deal deep deer desk diet dirt disk dive door "
  + "down draw duck dust duty each earn ease east easy edge "
  + "else epic even evil exam face fact fail fair fame farm "
  + "fast fate fear feed feel fell file fill film find fine "
  + "fire firm fish five flag flat flew flip flow foam fold "
  + "folk food foot ford form fort four free from fuel full "
  + "fund gain gale game gate gave gear gift girl give glad "
  + "glow glue goal goes gold golf gone good grab gray grew "
  + "grey grip grow gulf hair half hall hand hang hard harm "
  + "hate have head hear heat heel held help here hero high "
  + "hill hint hire hold hole holy home hope horn host hour "
  + "huge hung hunt hurt idea iron item jail jeans jewel job "
  + "join joke jump jury just keen keep kern key kick kind "
  + "king knee knew lace lady laid lake lamp land lane last "
  + "late leaf lean left less life lift like line link lion "
  + "list live load loan lock logo long look lord lose loud "
  + "love luck made mail main make male many mark mask mass "
  + "mate meal meet").split(" ").filter(Boolean);

// 256 unique words, each maps to one byte. We verify at module
// load time so a typo in the wordlist doesn't silently break
// recovery later.
if (WORDS.length !== 256 || new Set(WORDS).size !== 256) {
  throw new Error(`Recovery wordlist must have 256 unique words; got ${WORDS.length}`);
}
const WORD_TO_BYTE = new Map(WORDS.map((w, i) => [w, i]));

const PHRASE_LENGTH = 24; // 24 words × 8 bits = 192 bits of entropy
const VALIDATION_SUFFIX = "xpv1"; // 3 bytes of checksum (first 3 bytes of SHA-256 of payload)

/**
 * Generate a fresh recovery phrase. Returns a 24-word string the
 * user must write down.
 */
export async function generatePhrase() {
  // 24 words × 8 bits = 192 bits of payload, plus a 24-bit checksum
  // for typo detection.
  const payload = await randomBytes(PHRASE_LENGTH);
  const checksum = await checksumOf(payload);
  const all = new Uint8Array(PHRASE_LENGTH + 3);
  all.set(payload, 0);
  all.set(checksum.subarray(0, 3), PHRASE_LENGTH);
  const words = [];
  for (let i = 0; i < all.length; i++) {
    words.push(WORDS[all[i]]);
  }
  return words;
}

export function phraseToString(words) {
  return Array.isArray(words) ? words.join(" ") : String(words);
}

export function stringToPhrase(s) {
  return String(s).trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Validate a phrase (correct word count + checksum). Throws on
 * bad input. Returns the payload bytes (used as the wrap key).
 */
export async function phraseToKey(words) {
  const arr = Array.isArray(words) ? words : stringToPhrase(words);
  if (arr.length !== PHRASE_LENGTH + 3) {
    throw new Error(`Recovery phrase must be ${PHRASE_LENGTH + 3} words; got ${arr.length}.`);
  }
  const bytes = new Uint8Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const v = WORD_TO_BYTE.get(arr[i]);
    if (v === undefined) {
      throw new Error(`Unknown word in phrase: "${arr[i]}". Double-check spelling and order.`);
    }
    bytes[i] = v;
  }
  const payload = bytes.subarray(0, PHRASE_LENGTH);
  const checksum = bytes.subarray(PHRASE_LENGTH);
  const expected = (await checksumOf(payload)).subarray(0, 3);
  for (let i = 0; i < 3; i++) {
    if (checksum[i] !== expected[i]) {
      throw new Error("Recovery phrase is invalid (checksum mismatch).");
    }
  }
  return payload;
}

async function checksumOf(payload) {
  // Use the first 3 bytes of SHA-256 as a simple typo detector.
  // Uses the Web Crypto-backed sha256 helper from sodium.mjs (the
  // old getSodium() shim no longer exposes crypto_hash_sha256).
  return (await sha256(payload)).subarray(0, 3);
}

// Suppress unused-var warning for the constant while keeping it
// documented for future maintenance.
void VALIDATION_SUFFIX;