// Voice expense entry — Web Speech API wrapper.
//
// Browsers: Chrome and Edge support `webkitSpeechRecognition`. Firefox
// and Safari don't, so we expose `isSupported()` and the button can
// gracefully hide itself.
//
// Behavior:
//   • Tap the mic → start recognition
//   • Listens in *continuous* mode for up to 15 seconds so the user can
//     speak a full utterance ("Coffee 180 rupees on PhonePe") without
//     being cut off mid-sentence. The mic button shows a countdown.
//   • On `onresult`, parses the transcript with parseVoiceCommand() —
//     extracts amount, note, payment method (cash / UPI / debit / credit
//     / bank transfer + UPI app), and category (keyword match).
//   • Auto-stops on silence (no speech for ~1.5s) or at the 15s mark.
//   • User can tap the mic again to stop early.
//
// We use the live transcript (interimResults=true) so the form can show
// what the mic is hearing in real time.

const DEFAULT_MAX_MS = 15_000;     // 15 seconds — long enough for a sentence
const SILENCE_STOP_MS = 1_500;     // 1.5 seconds of silence ends the session

/**
 * @returns {boolean} true if the current browser exposes SpeechRecognition.
 */
export function isSupported() {
  return typeof window !== "undefined" &&
    (Boolean(window.SpeechRecognition) || Boolean(window.webkitSpeechRecognition));
}

/**
 * Start a recognition session.
 *
 * @param {{
 *   lang?: string,
 *   maxMs?: number,           // total listen window (default 15s)
 *   silenceStopMs?: number,   // end on this much silence (default 1.5s)
 *   categories?: Array<{id, name, icon}>,  // for keyword → category match
 *   onInterim?: (transcript: string) => void,
 *   onFinal?: (result: {
 *     amount: number|null,
 *     note: string,
 *     paymentMethod: string,   // "cash" | "upi" | "debit_card" | "credit_card" | "bank_transfer"
 *     upiApp: string,          // known UPI app code or ""
 *     categoryId: string,      // "" if no match
 *     transcript: string,
 *   }) => void,
 *   onTick?: (remainingMs: number) => void,  // fires every 250ms
 *   onError?: (err: { code: string, message: string }) => void,
 *   onEnd?: () => void,
 * }} opts
 * @returns {{ stop: () => void }} — call .stop() to abort early.
 */
export function startListening(opts = {}) {
  if (!isSupported()) {
    opts.onError?.({ code: "unsupported", message: "Voice entry is not supported in this browser." });
    return { stop: () => {} };
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recog = new SR();
  recog.lang = opts.lang || "en-IN";
  recog.interimResults = true;
  recog.continuous = true;          // multiple utterances until we stop
  recog.maxAlternatives = 1;

  const maxMs = opts.maxMs ?? DEFAULT_MAX_MS;
  const silenceMs = opts.silenceStopMs ?? SILENCE_STOP_MS;

  let finalTranscript = "";
  let lastHeardAt = Date.now();
  let stopped = false;

  // Hard stop after maxMs.
  const hardTimer = setTimeout(() => {
    if (stopped) return;
    finalize("Listening window ended — capturing what we heard.");
  }, maxMs);

  // Tick callback for the UI countdown (every 250ms).
  const tickTimer = setInterval(() => {
    if (stopped) return;
    const remaining = Math.max(0, maxMs - (Date.now() - startedAt));
    opts.onTick?.(remaining);
    // Silence stop: nothing heard for `silenceMs` → end.
    if (Date.now() - lastHeardAt > silenceMs && finalTranscript.trim()) {
      finalize("Stopped after silence — capturing result.");
    }
  }, 250);

  const startedAt = Date.now();

  function finalize(reason) {
    if (stopped) return;
    stopped = true;
    clearTimeout(hardTimer);
    clearInterval(tickTimer);
    const parsed = parseVoiceCommand(finalTranscript, opts.categories);
    opts.onFinal?.({
      amount: parsed.amount,
      note: parsed.note,
      paymentMethod: parsed.paymentMethod,
      upiApp: parsed.upiApp,
      categoryId: parsed.categoryId,
      transcript: finalTranscript,
    });
    try { recog.stop(); } catch { /* ignore */ }
    // Defer onEnd by a tick so consumers see onFinal first.
    setTimeout(() => opts.onEnd?.(), 0);
  }

  recog.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      const txt = r[0].transcript;
      if (r.isFinal) {
        finalTranscript += (finalTranscript && !finalTranscript.endsWith(" ") ? " " : "") + txt.trim();
      } else {
        interim += txt;
      }
    }
    lastHeardAt = Date.now();
    const combined = (finalTranscript + " " + interim).trim();
    if (combined) opts.onInterim?.(combined);
  };

  recog.onerror = (event) => {
    const code = event.error || "unknown";
    if (code === "no-speech" && finalTranscript.trim()) {
      // Treat as silence — capture what we have.
      finalize("Stopped after silence — capturing result.");
      return;
    }
    opts.onError?.({ code, message: friendlyError(code) });
  };

  recog.onend = () => {
    if (!stopped && finalTranscript.trim()) {
      finalize("Stopped on speech end — capturing result.");
    } else {
      stopped = true;
      clearTimeout(hardTimer);
      clearInterval(tickTimer);
      opts.onEnd?.();
    }
  };

  try {
    recog.start();
  } catch (err) {
    clearTimeout(hardTimer);
    clearInterval(tickTimer);
    opts.onError?.({ code: "start-failed", message: err?.message || "Could not start listening." });
  }

  return {
    stop() {
      if (stopped) return;
      finalize("Stopped manually.");
    },
  };
}

// --- Smart parser -----------------------------------------------------------
// Pulls amount, payment method, UPI app, and a category suggestion from
// a free-form spoken sentence. Examples:
//
//   "coffee 180 rupees"            → { amount: 180, note: "coffee", paymentMethod: "cash" }
//   "lunch 320 via phonepe"        → { amount: 320, note: "lunch", paymentMethod: "upi", upiApp: "phonepe" }
//   "petrol 1500 on credit card"   → { amount: 1500, note: "petrol", paymentMethod: "credit_card" }
//   "groceries 850 cash"           → { amount: 850, note: "groceries", paymentMethod: "cash" }
//   "uber 220"                     → { amount: 220, note: "uber", paymentMethod: "cash", categoryId: "cat_transport" }
//   "one eighty for coffee"        → { amount: 180, note: "coffee", paymentMethod: "cash" }
//   "rs 450 petrol"                → { amount: 450, note: "petrol", paymentMethod: "cash" }
//   "₹250 lunch"                    → { amount: 250, note: "lunch", paymentMethod: "cash" }

import { parseQuickAdd, suggestCategory } from "./util.js";

// Phrases we strip from the note text once we've identified them.
// Order matters: longer phrases first so "credit card" wins over "card".
const PAYMENT_PHRASES = [
  { match: /\b(credit\s*card|by\s+credit\s+card|via\s+credit\s+card|through\s+credit\s+card|using\s+credit\s+card)\b/i, value: "credit_card" },
  { match: /\b(debit\s*card|by\s+debit\s+card|via\s+debit\s+card|through\s+debit\s+card|using\s+debit\s+card)\b/i,        value: "debit_card" },
  { match: /\b(bank\s*transfer|neft|imps|by\s+bank\s+transfer|via\s+bank\s+transfer|through\s+bank\s+transfer)\b/i,           value: "bank_transfer" },
  { match: /\b(phonepe|phone\s*pe|phone\s*pay)\b/i,                                       upi: "phonepe",    payment: "upi" },
  { match: /\b(google\s*pay|gpay|g\s*pay)\b/i,                                            upi: "googlepay",  payment: "upi" },
  { match: /\b(paytm)\b/i,                                                     upi: "paytm",      payment: "upi" },
  { match: /\bsuper[.\s-]*money\b/i,                                           upi: "supermoney", payment: "upi" },
  { match: /\b(bhim)\b/i,                                                      upi: "bhim",      payment: "upi" },
  { match: /\b(cred)\b/i,                                                      upi: "cred",      payment: "upi" },
  { match: /\b(upi)\b/i,                                                       payment: "upi" },
  { match: /\b(card)\b/i,                                                     payment: "debit_card" }, // generic "card" → debit (most common)
  { match: /\b(cash|by\s+cash|in\s+cash|using\s+cash)\b/i,                    payment: "cash" },
];

// Words / tokens that we strip from the note but don't carry meaning on
// their own — prepositions, articles, and common currency markers. We
// remove them so "coffee 180 rupees" doesn't save the note as "coffee
// rupees".
const FILLER_WORDS = [
  // Currency markers (₹, rs, rupee, rupees, rupay, inr, dollars, etc.)
  /\b(?:rupees?|rupay|rs\.?|inr|dollars?|bucks?)\b/gi,
  // Intent prepositions: "coffee for 180", "petrol of 500", "tea at 50"
  // These are very common in voice input and add no information to the note.
  /\b(?:for|of|at|on|to|is|was|were|amount|cost|price|of\s+about|about|around|approximately|approx)\b/gi,
  // "I had", "I bought", "spent on", "paid for" — leftover verbs from
  // natural speech. Recognising them and removing them keeps the note clean.
  /\b(?:i\s+had|i\s+got|i\s+buy|i\s+pa?i?d|i\s+spent|we\s+had|we\s+spent|spent\s+on|paid\s+for|paid\s+to|spent\s+for|bought|get|gave\s+for)\b/gi,
];

/**
 * Parse a voice transcript into a structured expense hint.
 *
 * @param {string} transcript
 * @param {Array<{id, name}>} [categories] — for keyword-based category detection
 * @returns {{
 *   amount: number|null,
 *   note: string,
 *   paymentMethod: string,
 *   upiApp: string,
 *   categoryId: string,
 * }}
 */
export function parseVoiceCommand(transcript, categories) {
  const text = String(transcript || "").trim();
  const result = {
    amount: null,
    note: "",
    paymentMethod: "cash",
    upiApp: "",
    categoryId: "",
  };
  if (!text) return result;

  // 1) Extract the amount. We try a few strategies in order of
  //    specificity. The Web Speech API often returns the amount as a
  //    pretty-written number ("one eighty", "two hundred fifty") so we
  //    normalise those first; only then do we fall back to parseQuickAdd.
  const amount = extractAmount(text);
  result.amount = amount;

  // 2) Identify payment method / UPI app. We scan the full transcript
  //    (not just the note) because people often say the amount after
  //    the note ("lunch 320 via phonepe") or before ("phonepe 320 lunch").
  let noteText = text;
  let paymentFound = "";
  let upiFound = "";
  for (const p of PAYMENT_PHRASES) {
    const m = text.match(p.match);
    if (!m) continue;
    if (!paymentFound && p.value) paymentFound = p.value;
    if (!paymentFound && p.payment) paymentFound = p.payment;
    if (!upiFound && p.upi) upiFound = p.upi;
    // Remove the matched phrase (and surrounding whitespace) from the note
    // so it doesn't pollute the saved description.
    noteText = noteText.replace(m[0], " ");
  }
  // Strip the raw numeric amount token (after number-word conversion)
  // so it doesn't pollute the note. We match the literal digits that
  // appeared in the original transcript, not the converted number.
  const rawNumberMatch = text.match(/(\d{1,7}(?:[.,]\d{1,2})?)/);
  if (rawNumberMatch) noteText = noteText.replace(rawNumberMatch[0], " ");

  // Strip the currency / filler words. These don't convey meaning in
  // the final note and consistently appear in voice transcripts.
  for (const re of FILLER_WORDS) {
    noteText = noteText.replace(re, " ");
  }
  // Collapse whitespace + trim.
  noteText = noteText.replace(/\s+/g, " ").trim();

  if (paymentFound) result.paymentMethod = paymentFound;
  if (upiFound) result.upiApp = upiFound;
  if (noteText) result.note = noteText;
  else if (text) result.note = text.replace(/\d+/g, "").replace(/\s+/g, " ").trim();

  // 3) Category: use the existing suggestCategory() helper on the note so
  //    we get the same keyword map as the rest of the app.
  if (Array.isArray(categories) && categories.length > 0 && result.note) {
    try {
      const match = suggestCategory(result.note);
      if (match) result.categoryId = match.id;
    } catch {
      // Fallback: substring match on category name (only if suggestCategory
      // ever throws — it normally doesn't).
      const lc = result.note.toLowerCase();
      for (const c of categories) {
        const name = String(c.name || "").toLowerCase();
        if (name && lc.includes(name)) { result.categoryId = c.id; break; }
      }
    }
  }

  return result;
}

/**
 * Pulls a numeric amount out of a transcript. Handles three formats:
 *
 *   1. Digits: "coffee 180"            → 180
 *   2. Currency-prefixed: "₹250 lunch" → 250
 *   3. Spoken number-words: "one eighty for coffee"
 *                              → 180
 *                              (handles 0-999, with the "x-y" pattern
 *                               that callers in INR commonly use)
 *
 * Returns the first amount found, or null if there isn't one. The
 * number-word conversion is deliberately conservative — we only
 * translate sequences that read like amounts, not English prose.
 *
 * Grammar (informed by how numbers are spoken in en-IN):
 *   hundreds:           "one hundred" / "a hundred" / "hundred"
 *   hundreds + tens:    "one hundred fifty" / "two hundred five"
 *   hundreds + units:   "one hundred and one" / "two hundred seven"
 *   tens + units:       "twenty one" / "forty five"
 *   magnitude x unit:   "one eighty" → 1 * 100 + 80 = 180
 *   magnitude x tens:   "one twenty" → 1 * 100 + 20 = 120
 *   magnitudes:         "two thousand" / "five hundred"
 *
 * The math walks a `current` accumulator that's flushed to `total`
 * whenever a magnitude (hundred/thousand) is seen:
 *   • Unit token   → add to current.
 *   • Ten token    → if current is a single unit (1-9), promote it:
 *                   "one eighty" → total += 1*100 + 80. Otherwise
 *                   just add the tens digit to current.
 *   • Magnitude    → multiply current by the magnitude, flush to total,
 *                   then reset current.
 */
function extractAmount(text) {
  // 1) Numeric form (digits, optional decimals, optional currency prefix).
  const numeric = parseQuickAdd(text);
  if (numeric.amount != null) return numeric.amount;

  // 2) Number-word form. The pattern matches:
  //    - "one eighty"            → 1 * 100 + 80 = 180
  //    - "two hundred fifty"     → 200 + 50 = 250
  //    - "one thousand two hundred" → 1000 + 200 = 1200
  //    - "five hundred"          → 500
  const words = text.toLowerCase().match(/\b[a-z]+\b/g);
  if (!words) return null;
  const wordSeq = words.map(englishToNumber).filter((n) => n !== null);
  if (wordSeq.length === 0) return null;

  let total = 0;
  let current = 0;
  let sawAny = false;
  for (const [value, kind] of wordSeq) {
    if (kind === "magnitude") {
      // current is the coefficient of the magnitude (default 1, so
      // "hundred" alone = 100).
      if (current === 0) current = 1;
      current *= value;
      total += current;
      current = 0;
    } else if (kind === "ten") {
      // "one eighty" → "one" is a unit; the trailing "eighty" is a ten
      // that should be multiplied by 100 (unit-times-hundred). We
      // detect this by promoting the current unit to a magnitude
      // coefficient.
      if (current > 0 && current < 10) {
        // Promote: e.g. current=1, value=80 → total += 1*100 + 80.
        total += current * 100 + value;
        current = 0;
      } else {
        // Otherwise it's a plain tens digit ("forty five" → 40 then 5).
        current += value;
      }
    } else {
      // Plain unit digit.
      current += value;
    }
    sawAny = true;
  }
  total += current;
  return sawAny && total > 0 ? total : null;
}

const NUMBER_WORDS = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100, thousand: 1000,
};

function englishToNumber(word) {
  if (!(word in NUMBER_WORDS)) return null;
  const v = NUMBER_WORDS[word];
  if (v === 100 || v === 1000) return [v, "magnitude"];
  if (v >= 20 && v < 100) return [v, "ten"];
  return [v, "unit"];
}

function friendlyError(code) {
  switch (code) {
    case "no-speech":
      return "Didn't catch that — try again?";
    case "audio-capture":
      return "No microphone detected.";
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone permission was denied.";
    case "network":
      return "Network error — speech recognition needs an internet connection.";
    case "aborted":
      return "Listening was cancelled.";
    case "unsupported":
      return "Voice entry is not supported in this browser. Try Chrome or Edge.";
    default:
      return "Could not capture speech (" + code + ").";
  }
}
