import crypto from "crypto";
import { pool } from "./db.js";

/**
 * Auth endpoints use the shared PostgreSQL limiter below. The in-memory
 * limiter remains for non-auth routes where a process-local limit is adequate.
 */

const store = new Map();
const cleanupSharedLimits = setInterval(() => {
  pool.query("DELETE FROM lb_rate_limits WHERE window_started_at < NOW() - INTERVAL '1 day'")
    .catch((err) => console.error("Rate limit cleanup failed:", err.message));
}, 60 * 60 * 1000);
cleanupSharedLimits.unref();

function cleanup() {
  const now = Date.now();
  for (const [key, record] of store.entries()) {
    if (now - record.firstHit > record.windowMs) {
      store.delete(key);
    }
  }
}

export function rateLimit({ windowMs = 15 * 60 * 1000, max = 20 } = {}) {
  return function (req, res, next) {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const key = `${ip}:${req.method}:${req.path}`;
    const now = Date.now();

    cleanup();

    const record = store.get(key);
    if (!record || now - record.firstHit > windowMs) {
      store.set(key, { firstHit: now, count: 1, windowMs });
      return next();
    }

    record.count += 1;
    if (record.count > max) {
      return res.status(429).json({
        error: "Too many attempts. Please wait a few minutes and try again."
      });
    }
    next();
  };
}

export function sharedRateLimit({ windowMs = 15 * 60 * 1000, max = 20, key }) {
  if (typeof key !== "function") throw new TypeError("sharedRateLimit requires a key function.");

  return async function (req, res, next) {
    const identity = key(req);
    if (!identity) return next();
    const bucketHash = crypto.createHash("sha256").update(String(identity)).digest("hex");

    try {
      const { rows } = await pool.query(
        `INSERT INTO lb_rate_limits (bucket_hash, window_started_at, hit_count)
         VALUES ($1, NOW(), 1)
         ON CONFLICT (bucket_hash) DO UPDATE SET
           window_started_at = CASE
             WHEN lb_rate_limits.window_started_at <= NOW() - ($2 * INTERVAL '1 millisecond') THEN NOW()
             ELSE lb_rate_limits.window_started_at
           END,
           hit_count = CASE
             WHEN lb_rate_limits.window_started_at <= NOW() - ($2 * INTERVAL '1 millisecond') THEN 1
             ELSE lb_rate_limits.hit_count + 1
           END
         RETURNING hit_count,
           GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
             window_started_at + ($2 * INTERVAL '1 millisecond') - NOW()
           ))))::integer AS retry_after`,
        [bucketHash, windowMs]
      );
      if (rows[0].hit_count > max) {
        res.setHeader("Retry-After", String(rows[0].retry_after));
        return res.status(429).json({
          error: "Too many attempts. Please wait a few minutes and try again."
        });
      }
      next();
    } catch (err) {
      console.error("Shared rate limit failed:", err.message);
      res.status(503).json({ error: "Sign-in protection is temporarily unavailable. Please try again shortly." });
    }
  };
}
