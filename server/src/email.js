// Email delivery — wraps the Resend transactional email API.
//
// Resend's HTTP API is a single POST to https://api.resend.com/emails
// with a Bearer token, so we don't need an SDK. The call is short
// enough that an inline fetch keeps the dependency footprint at zero.
//
// Configuration (env vars):
//   RESEND_API_KEY   — required for live sending. If absent, the module
//                      falls back to "demo mode" and returns the code in
//                      its result so the caller can surface it on
//                      screen. This keeps local dev working without
//                      leaking secrets.
//   RESEND_FROM      — the "From" header. Defaults to
//                      "XPENSIC <onboarding@resend.dev>" which is the
//                      shared Resend sandbox address (good enough for
//                      testing). In production set this to a verified
//                      sender on your own domain.
//
// We never throw from this module — sending email should not block
// sign-in. Callers should check `result.ok` and react accordingly.

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "XPENSIC <onboarding@resend.dev>";

function cfg() {
  return {
    apiKey: process.env.RESEND_API_KEY || "",
    from: process.env.RESEND_FROM || DEFAULT_FROM,
  };
}

export function isEmailLive() {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * Send a one-time login OTP to `to` (must be a real email address).
 * Returns one of:
 *   { ok: true,  live: true,  messageId }   — sent via Resend
 *   { ok: true,  live: false, code }       — demo fallback, code
 *                                            returned to the caller
 *   { ok: false, error }                   — real send failed
 *
 * Phone numbers are rejected — Resend is email-only. The caller is
 * expected to filter phone identifiers before calling.
 *
 * @param {string} to
 * @param {string} code  4-digit OTP
 * @param {{ ttlMinutes?: number }} [opts]
 */
export async function sendOtpEmail(to, code, opts = {}) {
  const ttlMinutes = opts.ttlMinutes ?? 5;
  const { apiKey, from } = cfg();

  const subject = `${code} is your XPENSIC login code`;
  const html = renderOtpHtml(code, ttlMinutes);
  const text = renderOtpText(code, ttlMinutes);

  if (!apiKey) {
    // No key configured — let the caller show the code on screen so
    // developers can test without a Resend account.
    return { ok: true, live: false, code };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        text,
      }),
      // Hard ceiling — Resend usually responds in <2s, but allow 8s.
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json())?.message || ""; } catch { /* ignore */ }
      return {
        ok: false,
        error: detail || `Resend rejected the request (HTTP ${res.status}).`,
      };
    }

    let messageId = "";
    try { messageId = (await res.json())?.id || ""; } catch { /* ignore */ }
    // Include the resolved "From" address so the caller can surface it
    // to the user ("check your inbox, sent from …"). Helps debugging
    // when the sender is the Resend sandbox vs. a verified domain.
    return { ok: true, live: true, messageId, from };
  } catch (err) {
    return {
      ok: false,
      error:
        err?.name === "TimeoutError"
          ? "Email service timed out. Please try again."
          : `Could not reach the email service (${err?.message || "network error"}).`,
    };
  }
}

// --- Templates --------------------------------------------------------------
// Kept inline (no MJML, no Handlebars) so the file is self-contained.

function renderOtpHtml(code, ttlMinutes) {
  const safeCode = escapeHtml(code);
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f7fb;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111827;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
    <tr><td style="padding:24px 24px 0;text-align:center;">
      <div style="display:inline-block;width:40px;height:40px;border-radius:10px;background:#111827;color:#ffffff;text-align:center;line-height:40px;font-weight:700;font-size:20px;">₹</div>
      <h1 style="margin:12px 0 4px;font-size:18px;">Your XPENSIC login code</h1>
    </td></tr>
    <tr><td style="padding:16px 24px 8px;font-size:14px;color:#374151;line-height:1.5;text-align:center;">
      Use this one-time code to sign in. It expires in ${ttlMinutes} minutes.
    </td></tr>
    <tr><td style="padding:8px 24px 24px;text-align:center;">
      <div style="display:inline-block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;letter-spacing:8px;font-weight:700;background:#f3f4f6;border-radius:10px;padding:12px 20px;color:#111827;">${safeCode}</div>
    </td></tr>
    <tr><td style="padding:0 24px 24px;font-size:12px;color:#6b7280;line-height:1.5;text-align:center;">
      If you didn't request this code you can safely ignore this email.<br/>
      Never share this code with anyone — XPENSIC staff will never ask for it.
    </td></tr>
  </table>
</body></html>`;
}

function renderOtpText(code, ttlMinutes) {
  return [
    "Your XPENSIC login code",
    "",
    `Use this one-time code to sign in. It expires in ${ttlMinutes} minutes.`,
    "",
    `  ${code}`,
    "",
    "If you didn't request this code you can safely ignore this email.",
    "Never share this code with anyone — XPENSIC staff will never ask for it.",
  ].join("\n");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// --- Feedback notifications -------------------------------------------------
//
// Sends a "new feedback" notification to the product inbox. Unlike OTPs,
// this is a fire-and-forget side effect: the feedback row is already
// persisted by the time we send, so a failure here must never block or
// fail the user's submission. We therefore never throw — callers check
// `result.ok` and log on failure.

// NOTE: read lazily (inside the function), not as a module-level const.
// server.js loads this module via a static import, which is hoisted and
// evaluated before loadEnvFile() runs, so `process.env` isn't populated
// yet at module-load time. Reading it here, at send-time, is what lets
// the FEEDBACK_RECIPIENT value from .env actually take effect.
function feedbackRecipients() {
  return (process.env.FEEDBACK_RECIPIENT || "kaif@kismatstudio.com")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const FEEDBACK_TYPE_LABEL = {
  bug:      "Bug Report",
  feature:  "Feature Request",
  feedback: "Feedback",
};

const FEEDBACK_SUBJECT = {
  bug:      "[XPENSIC] New Bug Report",
  feature:  "[XPENSIC] New Feature Request",
  feedback: "[XPENSIC] New Feedback",
};

/**
 * Send a "new feedback" notification email to the product inbox.
 *
 * @param {object} f — the persisted feedback record (see d1.js rowToFeedback)
 * @param {{ userName?: string }} [opts]
 * @returns {Promise<{ ok: boolean, live?: boolean, messageId?: string, error?: string }>}
 */
export async function sendFeedbackEmail(f, opts = {}) {
  const { apiKey, from } = cfg();
  const type = FEEDBACK_TYPE_LABEL[f.type] || "Feedback";
  const subject = FEEDBACK_SUBJECT[f.type] || FEEDBACK_SUBJECT.feedback;

  const html = renderFeedbackHtml(f, opts.userName || "");
  const text = renderFeedbackText(f, opts.userName || "");

  if (!apiKey) {
    // Demo mode — no key configured. Report success so the submission
    // flow completes; the operator simply won't receive an email.
    return { ok: true, live: false };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: feedbackRecipients(),
        subject,
        html,
        text,
        replyTo: f.userEmail || undefined,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json())?.message || ""; } catch { /* ignore */ }
      return {
        ok: false,
        error: detail || `Resend rejected the request (HTTP ${res.status}).`,
      };
    }

    let messageId = "";
    try { messageId = (await res.json())?.id || ""; } catch { /* ignore */ }
    return { ok: true, live: true, messageId };
  } catch (err) {
    return {
      ok: false,
      error:
        err?.name === "TimeoutError"
          ? "Email service timed out."
          : `Could not reach the email service (${err?.message || "network error"}).`,
    };
  }
}

function renderFeedbackHtml(f, userName) {
  const rows = [
    ["Feedback Type", FEEDBACK_TYPE_LABEL[f.type] || f.type],
    ["User Name", userName],
    ["User Email", f.userEmail],
    ["Subject", f.subject],
    ["Description", f.description],
    ["Current Page", f.currentPage],
    ["Browser", f.browser],
    ["Device Type", f.deviceType],
    ["App Version", f.appVersion],
    ["Submission Time", f.submittedAt],
  ];
  const bodyRows = rows
    .filter(([, v]) => v)
    .map(([k, v]) => `
      <tr>
        <td style="padding:10px 16px;color:#6b7280;font-size:13px;white-space:nowrap;">${escapeHtml(k)}</td>
        <td style="padding:10px 16px;color:#111827;font-size:14px;line-height:1.5;">${escapeHtml(v)}</td>
      </tr>`)
    .join("");

  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f7fb;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111827;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
    <tr><td style="padding:24px 24px 0;text-align:center;">
      <div style="display:inline-block;width:40px;height:40px;border-radius:10px;background:#111827;color:#ffffff;text-align:center;line-height:40px;font-weight:700;font-size:20px;">₹</div>
      <h1 style="margin:12px 0 4px;font-size:18px;">${escapeHtml(FEEDBACK_TYPE_LABEL[f.type] || "Feedback")}</h1>
      <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">New submission from XPENSIC</p>
    </td></tr>
    <tr><td style="padding:16px 24px 8px;font-size:14px;color:#374151;line-height:1.5;">
      A user just submitted the following feedback. Review it and update the status in the admin queue.
    </td></tr>
    <tr><td style="padding:0 24px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
        ${bodyRows}
      </table>
    </td></tr>
    <tr><td style="padding:0 24px 24px;font-size:12px;color:#6b7280;line-height:1.5;text-align:center;">
      Sent automatically by XPENSIC · ${escapeHtml(f.appVersion || "")}
    </td></tr>
  </table>
</body></html>`;
}

function renderFeedbackText(f, userName) {
  const lines = [
    `${FEEDBACK_TYPE_LABEL[f.type] || f.type}`,
    "",
    `User Name:      ${userName}`,
    `User Email:     ${f.userEmail}`,
    `Subject:        ${f.subject}`,
    "",
    `Description:`,
    f.description,
    "",
    `Current Page:   ${f.currentPage}`,
    `Browser:        ${f.browser}`,
    `Device Type:    ${f.deviceType}`,
    `App Version:    ${f.appVersion}`,
    `Submission Time:${f.submittedAt}`,
  ];
  return lines.join("\n");
}