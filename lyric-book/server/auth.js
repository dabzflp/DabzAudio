/**
 * auth.js
 * JWT helpers + Express middleware for the Lyric Book.
 *
 * The token is sent two ways for flexibility:
 *  - httpOnly cookie `lb_token` (used when the frontend is proxied same-origin)
 *  - Authorization: Bearer <token> header (used for cross-origin / localStorage)
 */
import dotenv from "dotenv";
dotenv.config();

import jwt from "jsonwebtoken";

const isProd = process.env.NODE_ENV === "production";
const rawSecret = process.env.JWT_SECRET || "";

if (isProd && !rawSecret) {
  throw new Error(
    "JWT_SECRET is required in production. Set it in Railway Variables."
  );
}

const JWT_SECRET = rawSecret || "dev-only-insecure-secret-change-me";
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

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
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
