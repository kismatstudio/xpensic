// Smoke tests for the Voice Entry module.
//
// We can't easily exercise SpeechRecognition in Node, so we test:
//   • isSupported() returns false when neither global is present.
//   • isSupported() returns true when one is mocked in.
//   • startListening() with no support calls onError({ code: "unsupported" }).
//   • startListening() with a mocked SR instance dispatches the right
//     events and applies parseQuickAdd correctly.

import { isSupported, startListening } from "../js/voice.js";

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}` + (extra ? `  (${extra})` : "")); fail++; }
}

console.log("\n[1] isSupported without SR globals");
{
  // Save / clear globals to simulate an unsupported browser.
  const origSR = globalThis.SpeechRecognition;
  const origWebkit = globalThis.webkitSpeechRecognition;
  delete globalThis.SpeechRecognition;
  delete globalThis.webkitSpeechRecognition;
  check("returns false when neither is defined", isSupported() === false);
  if (origSR) globalThis.SpeechRecognition = origSR;
  if (origWebkit) globalThis.webkitSpeechRecognition = origWebkit;
}

console.log("\n[2] isSupported with a mocked global");
{
  class FakeSR {}
  globalThis.window = globalThis.window || {};
  globalThis.window.webkitSpeechRecognition = FakeSR;
  check("returns true when window.webkitSpeechRecognition is defined", isSupported() === true);
  delete globalThis.window.webkitSpeechRecognition;
}

console.log("\n[3] startListening in unsupported browser → onError fires");
{
  // Save any prior values and clear so the test really exercises "unsupported".
  const origSR = globalThis.window?.SpeechRecognition;
  const origWebkit = globalThis.window?.webkitSpeechRecognition;
  if (globalThis.window) {
    delete globalThis.window.SpeechRecognition;
    delete globalThis.window.webkitSpeechRecognition;
  }
  let errored = null;
  const handle = startListening({
    onError: (e) => { errored = e; },
  });
  check("onError called with unsupported", errored?.code === "unsupported",
    JSON.stringify(errored));
  check("stop() is a no-op function", typeof handle.stop === "function");
  // Restore (no-op since we deleted).
  if (origSR && globalThis.window) globalThis.window.SpeechRecognition = origSR;
  if (origWebkit && globalThis.window) globalThis.window.webkitSpeechRecognition = origWebkit;
}

console.log("\n[4] startListening with mocked SR dispatches onresult/onerror");
{
  let onresult = null, onerror = null, onend = null;
  class MockSR {
    constructor() {
      this.lang = "";
      this.interimResults = false;
      this.continuous = false;
      this.maxAlternatives = 0;
    }
    start() {}
    stop() {
      queueMicrotask(() => onend && onend());
    }
  }
  globalThis.window = globalThis.window || {};
  class HookedSR extends MockSR {
    constructor() {
      super();
      onresult = (event) => this.onresult(event);
      onerror  = (event) => this.onerror(event);
      onend    = () => this.onend();
    }
  }
  globalThis.window.webkitSpeechRecognition = HookedSR;

  let final = null;
  let errors = [];
  const handle = startListening({
    onFinal: (r) => { final = r; },
    onError: (e) => { errors.push(e); },
    onEnd: () => {},
  });

  // Simulate a final result: "coffee 180". In continuous mode the
  // session keeps listening — finalization happens on silence, the hard
  // timer, or manual stop. We drive it via onerror("no-speech") which
  // the new voice.js treats as "end on silence" when a transcript exists.
  onresult({
    resultIndex: 0,
    results: [
      [{ transcript: "coffee 180 " }, { transcript: "ignored" }],
    ].map((arr, idx) => ({
      isFinal: idx === 0,
      0: arr[0],
      length: arr.length,
    })),
  });

  // no-speech after a transcript -> finalize, no error.
  onerror({ error: "no-speech" });
  check("onFinal fired with parsed amount", final?.amount === 180);
  check("onFinal fired with parsed note", /coffee/i.test(final?.note || ""));
  check("no onError fired", errors.length === 0);
  check("stop() returned a handle", typeof handle.stop === "function");

  // Now simulate a no-speech on a *fresh* session with no transcript —
  // this should still surface as an error to the caller.
  errors.length = 0;
  final = null;
  const handle2 = startListening({
    onError: (e) => { errors.push(e); },
    onEnd: () => {},
  });
  onerror({ error: "no-speech" });
  check("no-speech with no transcript surfaces as an error",
    errors.some((e) => e.code === "no-speech"));
  handle2.stop?.();

  // Cleanup
  delete globalThis.window.webkitSpeechRecognition;
}


console.log("\n[5] parseVoiceCommand extracts structured fields");
{
  const { parseVoiceCommand } = await import("../js/voice.js");
  const cats = [
    { id: "cat_food", name: "Food" },
    { id: "cat_transport", name: "Transport" },
  ];
  const r1 = parseVoiceCommand("coffee 180", cats);
  check(`"coffee 180" amount=180, note=coffee, payment=cash`,
    r1.amount === 180 && r1.note === "coffee" && r1.paymentMethod === "cash");
  const r2 = parseVoiceCommand("lunch 320 via phonepe", cats);
  check(`"lunch 320 via phonepe" -> upi/phonepe`,
    r2.paymentMethod === "upi" && r2.upiApp === "phonepe" && r2.amount === 320);
  const r3 = parseVoiceCommand("petrol 1500 on credit card", cats);
  check(`"petrol 1500 on credit card" -> credit_card`,
    r3.paymentMethod === "credit_card" && r3.amount === 1500);
  const r4 = parseVoiceCommand("uber 220", cats);
  check(`"uber 220" -> category=Transport via keyword`,
    r4.categoryId === "cat_transport");
  const r5 = parseVoiceCommand("", cats);
  check(`empty transcript -> defaults`,
    r5.amount === null && r5.note === "" && r5.paymentMethod === "cash");
}

console.log("\n[5] startListening handles abort cleanly");
{
  let started = false;
  class SR {
    constructor() {
      this.lang = ""; this.interimResults = false; this.continuous = false; this.maxAlternatives = 0;
    }
    start() { started = true; }
    stop() {}
  }
  globalThis.window = globalThis.window || {};
  globalThis.window.webkitSpeechRecognition = SR;

  let ended = false;
  const handle = startListening({ onEnd: () => { ended = true; } });
  check("start() called", started === true);
  handle.stop();
  check("stop() doesn't throw", true);
  // Note: in the real browser, onend would fire after stop. Our mock
  // doesn't simulate that, so we just confirm the handle is usable.
  check("ended flag default (we can't simulate it here)", ended === false);

  delete globalThis.window.webkitSpeechRecognition;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
