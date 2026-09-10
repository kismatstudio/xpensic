// Feedback routes — accept bug reports, feature requests, and general
// feedback from authenticated users, persist them to D1, and fire a
// Resend notification email.
//
// Endpoints:
//   POST /api/feedback   → create a feedback record
//
// Design notes:
//   • Only authenticated users can submit (mounted behind authRequired).
//   • The database write is the source of truth. The email is a
//     fire-and-forget side effect — if it fails we log and still return
//     success so the user's submission is never lost.
//   • Basic rate limiting (per-user, in-memory) prevents spam.

import { Router } from "express";
import { newId } from "../ids.js";
import { createFeedback, findUserById } from "../d1.js";
import { sendFeedbackEmail } from "../email.js";

export const feedbackRouter = Router();

const FEEDBACK_TYPES = new Set(["bug", "feature", "feedback"]);
const FEEDBACK_STATUSES = new Set(["new", "under_review", "planned", "completed", "rejected"]);

const MAX_SUBJECT = 120;
const MAX_DESCRIPTION = 4000;
const MAX_META = 200;

// Basic per-user rate limiting: at most N submissions per window.
const RATE_LIMIT = { max: 5, windowMs: 60 * 60 * 1000 }; // 5 / hour
const submissions = new Map(); // userId -> { count, windowStart }

function rateLimited(userId) {
  const now = Date.now();
  const entry = submissions.get(userId);
  if (!entry || now - entry.windowStart >= RATE_LIMIT.windowMs) {
    submissions.set(userId, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT.max;
}

function cleanString(value, max) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

// POST /api/feedback — create a feedback record.
feedbackRouter.post("/", async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, error: "Not authenticated." });

  if (rateLimited(req.user.userId)) {
    return res.status(429).json({
      ok: false,
      error: "You've sent a lot of feedback recently. Please try again later.",
    });
  }

  const body = req.body || {};
  const type = cleanString(body.type, 20);
  const subject = cleanString(body.subject, MAX_SUBJECT);
  const description = cleanString(body.description, MAX_DESCRIPTION);

  if (!FEEDBACK_TYPES.has(type)) {
    return res.status(400).json({ ok: false, error: "Invalid feedback type." });
  }
  if (!subject) {
    return res.status(400).json({ ok: false, error: "Subject is required." });
  }
  if (!description) {
    return res.status(400).json({ ok: false, error: "Description is required." });
  }

  // Resolve the user's email from the account record (never trust a
  // client-supplied email for the association).
  let userEmail = "";
  let userName = "";
  try {
    const user = await findUserById(req.user.userId);
    if (user) {
      userEmail = user.email || "";
      // The server only stores email/phone/passwordHash — the display
      // name lives in the encrypted vault, so we can't resolve it here.
      // The client sends it as metadata for the notification email only.
      userName = cleanString(body.userName, 80);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[feedback] user lookup failed:", err?.message || err);
  }

  const now = new Date().toISOString();
  const record = {
    id: newId("fb"),
    userId: req.user.userId,
    userEmail,
    type,
    subject,
    description,
    status: "new",
    currentPage: cleanString(body.currentPage, MAX_META),
    browser: cleanString(body.browser, MAX_META),
    deviceType: cleanString(body.deviceType, MAX_META),
    appVersion: cleanString(body.appVersion, MAX_META),
    submittedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  // 1) Persist first — this is the source of truth.
  let saved;
  try {
    saved = await createFeedback(record);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[feedback] save failed:", err?.message || err);
    return res.status(500).json({ ok: false, error: "Could not save your feedback. Please try again." });
  }

  // 2) Fire the notification email (best-effort). Never fail the request
  //    on email failure — the feedback is already stored.
  try {
    const emailResult = await sendFeedbackEmail(saved, { userName });
    if (!emailResult.ok) {
      // eslint-disable-next-line no-console
      console.error("[feedback] email failed:", emailResult.error);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[feedback] email threw:", err?.message || err);
  }

  return res.status(201).json({ ok: true, feedback: { id: saved.id, status: saved.status } });
});