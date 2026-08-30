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