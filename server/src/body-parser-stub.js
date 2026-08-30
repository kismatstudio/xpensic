// body-parser stub for Cloudflare Workers.
//
// `express` requires `body-parser` at module load (to expose
// `express.json()` / `express.urlencoded()` etc.), which pulls in
// `raw-body` → `iconv-lite`. `iconv-lite` uses `require_streams`,
// which is not compatible with the Workers bundler and fails at
// deploy time with "require_streams(...) is not a function".
//
// We never call `express.json()` — server.js uses a custom body
// parser that reads the raw request body directly. So this stub only
// needs to load cleanly and expose the same shape express expects.
// The middleware functions are no-ops that pass through to `next()`.

function passthrough() {
  return function (_req, _res, next) {
    next();
  };
}

module.exports = {
  json: passthrough,
  urlencoded: passthrough,
  raw: passthrough,
  text: passthrough,
};
