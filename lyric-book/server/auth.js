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
import { pool } from "./db.js";

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
  return jwt.sign({ uid: user.id, email: user.email, av: Number(user.auth_version || 0) }, JWT_SECRET, {
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

const ACCESS_EXEMPT_PATHS = new Set([
  "/api/auth/me",
  "/api/profile/country",
  "/api/auth/mfa/status",
  "/api/auth/mfa/setup",
  "/api/auth/mfa/enable",
  "/api/auth/mfa/disable"
]);

export async function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: "Not signed in." });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.uid, email: payload.email };
  } catch {
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }

  const path = req.path;
  const accessExempt = ACCESS_EXEMPT_PATHS.has(path) || (path === "/api/me" && req.method === "DELETE");
  const billingRoute = path === "/api/subscription" || path.startsWith("/api/subscription/");

  try {
    const { rows } = await pool.query(
      `SELECT u.country_code, u.billing_exempt, u.auth_version, s.status, s.trial_ends_at, s.current_period_end
         FROM lb_users u
         LEFT JOIN lb_subscriptions s ON s.user_id = u.id
        WHERE u.id = $1`,
      [req.user.id]
    );
    const billing = rows[0];
    req.user.countryCode = billing?.country_code || null;
    if (!billing) return res.status(401).json({ error: "Account not found." });
    const currentAuthVersion = Number(billing.auth_version || 0);
    if (Number(payload.av ?? 0) !== currentAuthVersion) {
      res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
      return res.status(401).json({ code: "SESSION_REVOKED", error: "Your session has ended. Please sign in again." });
    }
    req.user.authVersion = currentAuthVersion;
    if (!req.user.countryCode && !accessExempt) {
      return res.status(428).json({ code: "COUNTRY_REQUIRED", error: "Choose your country to continue." });
    }
    if (accessExempt || billingRoute) return next();

    const now = Date.now();
    const trialActive = billing?.status === "trialing" && billing.trial_ends_at && new Date(billing.trial_ends_at).getTime() > now;
    const paidThrough = ["active", "past_due"].includes(billing?.status) &&
      (!billing.current_period_end || new Date(billing.current_period_end).getTime() > now);
    if (billing?.billing_exempt || trialActive || paidThrough) return next();
    return res.status(402).json({
      code: "SUBSCRIPTION_REQUIRED",
      error: "Your free trial has ended. Choose a plan to continue using Lyric Book.",
      trialEndedAt: billing?.trial_ends_at || null
    });
  } catch (err) {
    console.error("Subscription access check failed:", err.message);
    return res.status(500).json({ error: "Could not verify your Lyric Book access." });
  }
}
