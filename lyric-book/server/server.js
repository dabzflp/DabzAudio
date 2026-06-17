/**
 * DabzAudio Lyric Book - Backend API (Node + Express + PostgreSQL)
 *
 * Separate Railway service from the Community Hub. Shares the same Postgres
 * instance but uses lb_* tables, so the Hub is never touched.
 *
 * Env vars (Railway Variables):
 *  - DATABASE_URL        Postgres connection string
 *  - JWT_SECRET          long random string for signing sessions
 *  - RESEND_API_KEY      (optional) enables password-reset emails
 *  - EMAIL_FROM          (optional) verified sender, e.g. "DabzAudio <no-reply@dabzaudio.com>"
 *  - APP_BASE_URL        (optional) public URL of the frontend, used in reset links
 *  - CORS_ORIGIN         (optional) comma-separated allowed origins for cross-origin use
 *  - NODE_ENV=production  enables SSL + secure cookies
 */
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import { fileURLToPath } from "url";

import { pool, connectWithRetry } from "./db.js";
import { signToken, requireAuth, cookieOptions, COOKIE_NAME } from "./auth.js";
import { sendPasswordReset, emailEnabled } from "./email.js";

dotenv.config();

process.on("unhandledRejection", (err) => console.error("UnhandledRejection", err));
process.on("uncaughtException", (err) => console.error("UncaughtException", err));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const corsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: corsOrigins.length ? corsOrigins : true,
    credentials: true
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// Serve the frontend statically too (handy for local dev / standalone deploy).
app.use(express.static(path.join(__dirname, "..", "..", "landing-page", "lyric-book")));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeProfile(row) {
  return {
    displayName: row.display_name,
    artistName: row.artist_name,
    genre: row.genre,
    influences: row.influences,
    experience: row.experience
  };
}

function appBaseUrl(req) {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  return `${proto}://${req.get("host")}`;
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, email: emailEnabled(), time: new Date().toISOString() });
});

/* ----------------------------- AUTH ----------------------------- */

app.post("/api/auth/signup", async (req, res) => {
  try {
    const {
      email,
      password,
      displayName = "",
      artistName = "",
      genre = "",
      influences = "",
      experience = ""
    } = req.body || {};

    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const exists = await pool.query("SELECT id FROM lb_users WHERE email = $1", [
      email.toLowerCase()
    ]);
    if (exists.rows.length) {
      return res.status(409).json({ error: "An account with that email already exists." });
    }

    const password_hash = await bcrypt.hash(String(password), 10);
    const client = await pool.connect();
    let user;
    try {
      await client.query("BEGIN");
      const u = await client.query(
        "INSERT INTO lb_users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
        [email.toLowerCase(), password_hash]
      );
      user = u.rows[0];
      await client.query(
        `INSERT INTO lb_profiles (user_id, display_name, artist_name, genre, influences, experience)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [user.id, displayName, artistName, genre, influences, experience]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    const token = signToken(user);
    res.cookie(COOKIE_NAME, token, cookieOptions());
    res.status(201).json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error("signup error", err);
    res.status(500).json({ error: "Could not create account." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }
    const { rows } = await pool.query(
      "SELECT id, email, password_hash FROM lb_users WHERE email = $1",
      [String(email).toLowerCase()]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: "Invalid email or password." });

    const ok = await bcrypt.compare(String(password), user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid email or password." });

    const token = signToken(user);
    res.cookie(COOKIE_NAME, token, cookieOptions());
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error("login error", err);
    res.status(500).json({ error: "Could not sign in." });
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, p.display_name, p.artist_name, p.genre, p.influences, p.experience
       FROM lb_users u LEFT JOIN lb_profiles p ON p.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: "User not found." });
    res.json({
      user: { id: row.id, email: row.email },
      profile: sanitizeProfile(row)
    });
  } catch (err) {
    console.error("me error", err);
    res.status(500).json({ error: "Could not load profile." });
  }
});

app.put("/api/profile", requireAuth, async (req, res) => {
  try {
    const {
      displayName = "",
      artistName = "",
      genre = "",
      influences = "",
      experience = ""
    } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE lb_profiles
       SET display_name = $2, artist_name = $3, genre = $4, influences = $5, experience = $6, updated_at = NOW()
       WHERE user_id = $1
       RETURNING display_name, artist_name, genre, influences, experience`,
      [req.user.id, displayName, artistName, genre, influences, experience]
    );
    res.json({ profile: sanitizeProfile(rows[0]) });
  } catch (err) {
    console.error("profile error", err);
    res.status(500).json({ error: "Could not save profile." });
  }
});

/* ------------------------ PASSWORD RESET ------------------------ */

app.post("/api/auth/forgot", async (req, res) => {
  // Always respond the same way so we never reveal which emails exist.
  const generic = {
    ok: true,
    message: "If that email is registered, a reset link is on its way."
  };
  try {
    const { email } = req.body || {};
    if (!email || !EMAIL_RE.test(email)) return res.json(generic);

    const { rows } = await pool.query("SELECT id FROM lb_users WHERE email = $1", [
      String(email).toLowerCase()
    ]);
    const user = rows[0];
    if (!user) return res.json(generic);

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      "INSERT INTO lb_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
      [user.id, tokenHash, expires]
    );

    const resetUrl = `${appBaseUrl(req)}/reset.html?token=${rawToken}`;
    await sendPasswordReset(String(email).toLowerCase(), resetUrl);
    res.json(generic);
  } catch (err) {
    console.error("forgot error", err);
    res.json(generic);
  }
});

app.post("/api/auth/reset", async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password || String(password).length < 8) {
      return res.status(400).json({ error: "Invalid request. Password must be at least 8 characters." });
    }
    const tokenHash = crypto.createHash("sha256").update(String(token)).digest("hex");
    const { rows } = await pool.query(
      `SELECT id, user_id FROM lb_reset_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
       ORDER BY id DESC LIMIT 1`,
      [tokenHash]
    );
    const tok = rows[0];
    if (!tok) return res.status(400).json({ error: "This reset link is invalid or has expired." });

    const password_hash = await bcrypt.hash(String(password), 10);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE lb_users SET password_hash = $1 WHERE id = $2", [
        password_hash,
        tok.user_id
      ]);
      await client.query("UPDATE lb_reset_tokens SET used_at = NOW() WHERE id = $1", [tok.id]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    res.json({ ok: true, message: "Password updated. You can now sign in." });
  } catch (err) {
    console.error("reset error", err);
    res.status(500).json({ error: "Could not reset password." });
  }
});

/* ----------------------------- LYRICS ----------------------------- */

app.get("/api/lyrics", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, updated_at, created_at FROM lb_lyrics
       WHERE user_id = $1 ORDER BY updated_at DESC`,
      [req.user.id]
    );
    res.json({ lyrics: rows });
  } catch (err) {
    console.error("list lyrics error", err);
    res.status(500).json({ error: "Could not load lyrics." });
  }
});

app.post("/api/lyrics", requireAuth, async (req, res) => {
  try {
    const { title = "Untitled", body = "" } = req.body || {};
    const { rows } = await pool.query(
      `INSERT INTO lb_lyrics (user_id, title, body) VALUES ($1, $2, $3)
       RETURNING id, title, body, created_at, updated_at`,
      [req.user.id, String(title).slice(0, 200) || "Untitled", body]
    );
    res.status(201).json({ lyric: rows[0] });
  } catch (err) {
    console.error("create lyric error", err);
    res.status(500).json({ error: "Could not create lyric." });
  }
});

app.get("/api/lyrics/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, title, body, created_at, updated_at FROM lb_lyrics WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Lyric not found." });
    res.json({ lyric: rows[0] });
  } catch (err) {
    console.error("get lyric error", err);
    res.status(500).json({ error: "Could not load lyric." });
  }
});

app.put("/api/lyrics/:id", requireAuth, async (req, res) => {
  try {
    const { title, body } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE lb_lyrics
       SET title = COALESCE($3, title), body = COALESCE($4, body), updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id, title, body, created_at, updated_at`,
      [req.params.id, req.user.id, title != null ? String(title).slice(0, 200) : null, body]
    );
    if (!rows.length) return res.status(404).json({ error: "Lyric not found." });
    res.json({ lyric: rows[0] });
  } catch (err) {
    console.error("update lyric error", err);
    res.status(500).json({ error: "Could not save lyric." });
  }
});

app.delete("/api/lyrics/:id", requireAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM lb_lyrics WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: "Lyric not found." });
    res.json({ ok: true });
  } catch (err) {
    console.error("delete lyric error", err);
    res.status(500).json({ error: "Could not delete lyric." });
  }
});

const PORT = process.env.PORT || 4000;
connectWithRetry().then((ok) => {
  if (!ok) console.error("⚠️  Starting without confirmed DB connection.");
  app.listen(PORT, () => console.log(`✅ Lyric Book API on :${PORT}`));
});
