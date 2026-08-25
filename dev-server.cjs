// Tiny zero-dependency static file server for development.
// Reads files from disk on every request (no caching) and serves the
// project root on the given port. Replaces npx http-server, which was
// serving stale copies of edited files in some environments.
//
// Also proxies /api/* requests to the backend API server (default
// http://localhost:8787) so the client and API share the same origin.
// This eliminates cross-origin cookie issues in incognito mode and
// browsers with strict SameSite enforcement.

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = Number(process.env.PORT) || 8765;
const API_PORT = Number(process.env.API_PORT) || 8787;
const API_HOST = "127.0.0.1";
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".mjs":  "text/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".ico":  "image/x-icon",
  ".txt":  "text/plain; charset=utf-8",
};

const server = http.createServer((req, res) => {
  // Parse the request path; default to index.html for the root.
  const parsed = url.parse(req.url);
  let pathname = decodeURIComponent(parsed.pathname || "/");
  if (pathname === "/") pathname = "/index.html";

  // Proxy /api/* requests to the backend API server so the client
  // and API share the same origin. This fixes cross-origin cookie
  // rejection in incognito mode and browsers with strict SameSite.
  //
  // The check uses a path-segment boundary (the next char after
  // "/api" must be "/" or nothing). Without this guard, requests
  // for client-side files like `/api.js` would also be proxied to
  // the backend — the backend doesn't know that path, returns a
  // JSON 404, and the browser tries to parse JSON as JavaScript
  // and chokes on `export` ("Unexpected token 'export'" at line 1).
  // The boundary check makes `/api/auth/whoami` proxy while
  // `/api.js?v=2` and `/api/something/somefile.js` (if it ever
  // existed) would NOT be proxied. We also strip a trailing `?` so
  // `/api?...` doesn't sneak through.
  const apiPath = pathname.split("?")[0];
  if (apiPath === "/api" || apiPath.startsWith("/api/")) {
    return proxyApi(req, res);
  }

  // Resolve and prevent directory traversal (../).
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }

  console.log(`[req] ${req.method} ${pathname} -> ${filePath}`);

  // Read from disk every time — no cache. If the file is missing, 404.
  fs.readFile(filePath, (err, data) => {
    if (err) {
      console.log(`[404] ${pathname}  (${err.code})`);
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found: " + pathname);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    console.log(`[200] ${pathname}  ${data.length} bytes`);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-store, must-revalidate",
    });
    res.end(data);
  });
});

/**
 * Proxy a request to the API server (127.0.0.1:API_PORT).
 * Forwards method, headers, and body verbatim, and passes through
 * Set-Cookie / status / content-type headers on the response.
 */
function proxyApi(req, res) {
  const parsed = url.parse(req.url);
  const proxyPath = parsed.path; // includes query string

  const proxyHeaders = { ...req.headers };
  proxyHeaders.host = `${API_HOST}:${API_PORT}`;

  const proxyReq = http.request(
    {
      host: API_HOST,
      port: API_PORT,
      path: proxyPath,
      method: req.method,
      headers: proxyHeaders,
    },
    (proxyRes) => {
      // Forward status + headers, including Set-Cookie.
      const respHeaders = { ...proxyRes.headers };
      res.writeHead(proxyRes.statusCode, respHeaders);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", (err) => {
    console.log(`[proxy-error] ${req.method} ${proxyPath}: ${err.message}`);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "API server unreachable. Is it running on port " + API_PORT + "?" }));
  });

  // Forward the request body (if any) to the API server.
  req.pipe(proxyReq);
}

server.listen(PORT, () => {
  console.log(`dev-server: http://127.0.0.1:${PORT}/  (root: ${ROOT})`);
});
