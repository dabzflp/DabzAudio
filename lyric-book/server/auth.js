/**
 * auth.js
 * JWT helpers + Express middleware for the Lyric Book.
 *
 * The token is sent two ways for flexibility:
 *  - httpOnly cookie `lb_token` (used when the frontend is proxied same-origin)
 *  - Authorization: Bearer <token> header (used for cross-origin / localStorage)
 */
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-insecure-secret-change-me";
const TOKEN_TTL = "30d";
export const COOKIE_NAME = "lb_token";

export function signToken(user) {
  return jwt.sign({ uid: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: TOKEN_TTL
  });
}

export function cookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000
  };
}

function extractToken(req) {
  const header = req.headers["authorization"] || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  if (req.cookies && req.cookies[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  return null;
}

export function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: "Not signed in." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.uid, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }
}
