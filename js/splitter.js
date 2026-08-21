// Local expense splitter.
//
// Pure math + storage helpers — no backend. The Splits view (js/views/splits.js)
// wires this up to the UI.
//
// Two responsibilities:
//   1. Compute per-head amounts for a given total + participants, with
//      optional per-person weights.
//   2. Persist splits as their own log (state.splits) so the user can see
//      their split history alongside regular expenses.
//
// Note: cross-device "send to a friend" requires a backend. Without one,
// the friend code is just a stable identifier the user can share verbally
// or via screenshot; the recipient enters it on their side manually.

import { newId } from "./ids.js";

/**
 * Compute a split given a total amount and a list of participants.
 *
 * @param {number} total
 * @param {Array<{name: string, share?: number, paid?: number}>} participants
 *   • share (optional): relative weight (default 1). Higher = more.
 *   • paid (optional):  how much this person actually paid (default 0).
 *
 * @returns {Array<{name, share, paid, owes, perHead}>}
 *   • perHead — base amount each "unit" of share costs
 *   • owes   — perHead * share - paid (negative = they are owed)
 *
 * Rounding: perHead is rounded to 2 decimals. The remaining rounding
 * dust is assigned to the first participant so the totals always balance.
 */
export function computeSplit(total, participants) {
  const sum = participants.reduce((s, p) => s + (Number(p.share) || 0), 0);
  if (sum <= 0) {
    return participants.map((p) => ({
      name: p.name,
      share: Number(p.share) || 0,
      paid: Number(p.paid) || 0,
      owes: 0,
      perHead: 0,
    }));
  }
  // Round perHead to 2 dp, then round each row's owed amount to 2 dp
  // *before* adding to the running total. The running total is built from
  // rounded values, so the drift correction is the difference between the
  // exact total and the sum of rounded values — a small integer-cents
  // quantity that we hand to the first participant.
  const rawPerHead = Number(total) / sum;
  const perHead = Math.round(rawPerHead * 100) / 100;

  const rounded = participants.map((p) => {
    const share = Number(p.share) || 0;
    const paid = Number(p.paid) || 0;
    const owedRounded = Math.round((perHead * share) * 100) / 100 - paid;
    return { name: p.name, share, paid, owes: owedRounded, perHead };
  });

  const allocated = rounded.reduce((s, r) => s + r.owes, 0);
  const drift = Math.round((Number(total) - allocated) * 100) / 100;
  if (rounded.length > 0) {
    rounded[0].owes = Math.round((rounded[0].owes + drift) * 100) / 100;
  }

  return rounded;
}

/**
 * Compute the total spent across all participants' "paid" fields.
 */
export function sumPaid(participants) {
  return participants.reduce((s, p) => s + (Number(p.paid) || 0), 0);
}

/**
 * Generate a 6-character friend code (uppercase letters + digits, no
 * ambiguous chars). Two devices entering the same code are linked for
 * the purpose of a single split; without a backend this is purely a
 * visual identifier (the receiving device still has to enter the same
 * numbers manually).
 */
export function generateFriendCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

// --- Persistence ----------------------------------------------------------
// Splits live in their own array on state. Each split is a self-contained
// record so the user can browse history independently of regular expenses.

export function addSplit(state, split) {
  if (!Array.isArray(state.splits)) state.splits = [];
  const record = {
    id: newId("spl"),
    title: split.title || "Untitled split",
    total: Number(split.total) || 0,
    note: split.note || "",
    participants: Array.isArray(split.participants) ? split.participants : [],
    friendCode: split.friendCode || "",
    createdAt: new Date().toISOString(),
  };
  state.splits.push(record);
  return record;
}

export function deleteSplit(state, id) {
  if (!Array.isArray(state.splits)) return false;
  const i = state.splits.findIndex((s) => s.id === id);
  if (i === -1) return false;
  state.splits.splice(i, 1);
  return true;
}
