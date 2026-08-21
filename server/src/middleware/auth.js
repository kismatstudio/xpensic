// Auth middleware. Reads the JWT cookie (or `Authorization: Bearer`),
// verifies it, and attaches the decoded payload to `req.user`.
//
// Routes that should reject anonymous callers should mount this as
// `authRequired`; routes that just want the user *if present* can use
// `attachUser`.

import jwt from "jsonwebtoken";

export function authRequired(req, res, next) {
  const user = decodeUser(req);
  if (!user) {
    return res.status(401).json({ ok: false, error: "Not authenticated." });
  }
  req.user = user;
  next();
}

export function attachUser(req, _res, next) {
  const user = decodeUser(req);
  if (user) req.user = user;
  next();
}

function decodeUser(req) {
  const secret = process.env.JWT_SECRET || "dev-secret-change-me";
  const token =
    req.cookies?.et_token ||
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "") ||
    null;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, secret);
    if (!payload?.userId) return null;
    return { userId: payload.userId, email: payload.email || "" };
  } catch {
    return null;
  }
}
