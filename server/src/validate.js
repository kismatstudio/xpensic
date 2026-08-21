// Validation helpers used by the auth and data routes. Keeping them
// in one place so both routes agree on what a valid email / phone /
// password looks like.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9]{10}$/;

export function validateEmail(email) {
  const s = String(email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(s)) return null;
  return s;
}

export function validatePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "").slice(-10);
  if (!PHONE_RE.test(digits)) return null;
  return digits;
}

export function validateIdentifier(id) {
  // An "identifier" is what the user types into the login field — either
  // an email or a 10-digit phone. We return a normalized form
  // ({ kind: "email" | "phone", value }) or null if neither matches.
  const email = validateEmail(id);
  if (email) return { kind: "email", value: email };
  const phone = validatePhone(id);
  if (phone) return { kind: "phone", value: phone };
  return null;
}

export function validatePassword(pw) {
  // Minimum: 8 characters. No other composition rules — the user is
  // the only one affected by their password strength here.
  const s = String(pw || "");
  if (s.length < 8) return null;
  return s;
}

export function validateName(name) {
  const s = String(name || "").trim();
  if (s.length < 1 || s.length > 60) return null;
  return s;
}
