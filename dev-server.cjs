// Tiny zero-dependency static file server for development.
// Reads files from disk on every request (no caching) and serves the
// project root on the given port. Replaces npx http-server, which was
// serving stale copies of edited files in some environments.

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = Number(process.env.PORT) || 8765;
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

server.listen(PORT, () => {
  console.log(`dev-server: http://127.0.0.1:${PORT}/  (root: ${ROOT})`);
});
