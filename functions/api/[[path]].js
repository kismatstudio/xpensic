// Cloudflare Pages Function — proxies /api/* to the API Worker.
//
// The frontend always calls a SAME-ORIGIN `/api/...` path (no hardcoded
// ET_API_BASE). This function forwards the request to the API Worker,
// whose base URL is supplied per-environment by the Pages env var
// `API_ORIGIN` (set in the Cloudflare dashboard under your Pages project:
// Production vs Preview/Staging).
//
// Benefits:
//   • No code changes between staging and production — only the env var
//     differs.
//   • Cookies are first-party again (SameSite=Lax is fine), so auth just
//     works without cross-site cookie gymnastics.

export async function onRequest(context) {
  const target = context.env.API_ORIGIN;
  if (!target) {
    return new Response(
      JSON.stringify({ ok: false, error: "API_ORIGIN env var is not set on this Pages environment." }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  const url = new URL(context.request.url);
  const pathname = url.pathname; // "/api/...".
  // Strip query string and rebuild the upstream URL.
  const targetUrl = target.replace(/\/$/, "") + pathname + url.search;

  try {
    const method = context.request.method;
    const headers = new Headers(context.request.headers);
    // Server-to-server: drop hop-by-hop / host headers that don't apply.
    headers.delete("host");
    headers.delete("connection");
    headers.delete("cf-connecting-ip");
    headers.delete("x-forwarded-for");

    const hasBody = !["GET", "HEAD"].includes(method);
    const body = hasBody ? await context.request.arrayBuffer() : undefined;

    const upstream = await fetch(targetUrl, {
      method,
      headers,
      body,
      redirect: "manual",
    });

    const respHeaders = new Headers(upstream.headers);
    // The upstream Worker may set CORS headers assuming a browser client.
    // Here /api is same-origin, so those are unnecessary — strip them to
    // avoid duplicates.
    respHeaders.delete("access-control-allow-origin");
    respHeaders.delete("access-control-allow-credentials");

    return new Response(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: "Upstream API unreachable: " + (err?.message || "network error") }),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }
}