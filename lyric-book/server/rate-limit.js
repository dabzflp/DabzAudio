/**
 * rate-limit.js
 * Tiny in-memory rate limiter. Good enough for a single-node deploy.
 * For multi-node, switch to Redis or a CDN/proxy rate limit.
 *
 * Tracks attempts per IP per endpoint. Returns 429 when exceeded.
 */

const store = new Map();

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
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      "unknown";
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
