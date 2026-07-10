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

import { v2 as cloudinary } from "cloudinary";

import http from "http";

import { pool, connectWithRetry } from "./db.js";
import { signToken, requireAuth, cookieOptions, COOKIE_NAME } from "./auth.js";
import { sendPasswordReset, sendShareInvite, emailEnabled } from "./email.js";
import { getLyricAccess, displayNameForUser } from "./access.js";
import { initCollab, revokeCollabAccess } from "./collab.js";
import { registerPaymentRoutes, stripeWebhookHandler } from "./payments.js";
import { ensureUniqueUsername, validateUsername } from "./username.js";

dotenv.config();

// Cloudinary for profile-picture uploads (optional: if unset, avatar upload
// returns a clear error but the rest of the app works).
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

process.on("unhandledRejection", (err) => console.error("UnhandledRejection", err));
process.on("uncaughtException", (err) => console.error("UncaughtException", err));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const corsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Allow the configured origins, plus Netlify deploy previews
// (deploy-preview-*--<site>.netlify.app) so PR previews can call the API.
export function isAllowedOrigin(origin) {
  if (!origin) return true; // non-browser clients (curl, server-to-server)
  if (!corsOrigins.length) return true;
  if (corsOrigins.includes(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+--dabzaudio\.netlify\.app$/i.test(origin)) return true;
  return false;
}
app.use(
  cors({
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
    credentials: true
  })
);
// Stripe webhook must read the RAW body for signature verification, so it is
// mounted before express.json() parses the body for every other route.
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), stripeWebhookHandler);

// Allow base64 image payloads for avatar uploads (default 100kb is too small).
app.use(express.json({ limit: "8mb" }));
app.use(cookieParser());

// Gift Me (Stripe Connect) routes — additive; no-op if STRIPE_SECRET_KEY unset.
registerPaymentRoutes(app);

// Serve the frontend statically too (handy for local dev / standalone deploy).
app.use(express.static(path.join(__dirname, "..", "..", "landing-page", "lyric-book")));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeProfile(row) {
  return {
    displayName: row.display_name,
    artistName: row.artist_name,
    genre: row.genre,
    influences: row.influences,
    experience: row.experience,
    avatarUrl: row.avatar_url || "",
    username: row.username || ""
  };
}

function appBaseUrl(req) {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  return `${proto}://${req.get("host")}`;
}

// Attach any pending invites addressed to this email to the user's account
// (so an invite sent before they registered shows up once they sign in).
async function linkPendingInvites(userId, email) {
  if (!email) return;
  try {
    await pool.query(
      `UPDATE lb_lyric_collaborators
       SET user_id = $1
       WHERE user_id IS NULL AND LOWER(invited_email) = LOWER($2)`,
      [userId, email]
    );
  } catch (err) {
    console.error("linkPendingInvites error", err);
  }
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
      const username = await ensureUniqueUsername(
        client,
        String(email).split("@")[0] || artistName || displayName
      );
      await client.query(
        `INSERT INTO lb_profiles (user_id, display_name, artist_name, genre, influences, experience, username)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [user.id, displayName, artistName, genre, influences, experience, username]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    await linkPendingInvites(user.id, user.email);

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

    await linkPendingInvites(user.id, user.email);

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
    await linkPendingInvites(req.user.id, req.user.email);
    const { rows } = await pool.query(
      `SELECT u.id, u.email, p.display_name, p.artist_name, p.genre, p.influences, p.experience, p.avatar_url, p.username
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
    const body = req.body || {};
    // Fields absent from the request are left unchanged (COALESCE keeps the
    // existing value), so a username-only update doesn't wipe the profile.
    const nz = (v) => (v === undefined ? null : String(v));
    const displayName = nz(body.displayName);
    const artistName = nz(body.artistName);
    const genre = nz(body.genre);
    const influences = nz(body.influences);
    const experience = nz(body.experience);

    // Username is optional; when provided it is validated and must be unique.
    let handle = null;
    if (body.username !== undefined) {
      const wanted = String(body.username).trim().toLowerCase();
      const bad = validateUsername(wanted);
      if (bad) return res.status(400).json({ error: bad });
      const taken = await pool.query(
        "SELECT 1 FROM lb_profiles WHERE LOWER(username) = $1 AND user_id <> $2 LIMIT 1",
        [wanted, req.user.id]
      );
      if (taken.rows.length) {
        return res.status(409).json({ error: "That username is already taken." });
      }
      handle = wanted;
    }

    const { rows } = await pool.query(
      `UPDATE lb_profiles
       SET display_name = COALESCE($2, display_name),
           artist_name  = COALESCE($3, artist_name),
           genre        = COALESCE($4, genre),
           influences   = COALESCE($5, influences),
           experience   = COALESCE($6, experience),
           username     = COALESCE($7, username),
           updated_at = NOW()
       WHERE user_id = $1
       RETURNING display_name, artist_name, genre, influences, experience, avatar_url, username`,
      [req.user.id, displayName, artistName, genre, influences, experience, handle]
    );
    res.json({ profile: sanitizeProfile(rows[0]) });
  } catch (err) {
    if (err && err.code === "23505") {
      return res.status(409).json({ error: "That username is already taken." });
    }
    console.error("profile error", err);
    res.status(500).json({ error: "Could not save profile." });
  }
});

// Upload (or replace) the signed-in artist's profile picture.
// Accepts a base64 data URL; stores it on Cloudinary in lyricbook/avatars
// and saves the secure URL on the profile.
app.post("/api/profile/avatar", requireAuth, async (req, res) => {
  try {
    if (!cloudinary.config().cloud_name) {
      return res.status(503).json({ error: "Image uploads are not configured yet." });
    }
    const { imageBase64 } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return res.status(400).json({ error: "No image provided." });
    }
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(imageBase64)) {
      return res.status(400).json({ error: "Unsupported image type." });
    }
    if (imageBase64.length > 8 * 1024 * 1024) {
      return res.status(400).json({ error: "Image too large (max ~5MB)." });
    }

    const result = await cloudinary.uploader.upload(imageBase64, {
      folder: "lyricbook/avatars",
      public_id: `user_${req.user.id}`,
      overwrite: true,
      resource_type: "image",
      transformation: [
        { width: 256, height: 256, crop: "fill", gravity: "face" },
        { quality: "auto", fetch_format: "auto" }
      ]
    });

    const url = result.secure_url;
    const { rows } = await pool.query(
      `UPDATE lb_profiles SET avatar_url = $2, updated_at = NOW()
       WHERE user_id = $1
       RETURNING display_name, artist_name, genre, influences, experience, avatar_url, username`,
      [req.user.id, url]
    );
    res.json({ profile: sanitizeProfile(rows[0]) });
  } catch (err) {
    console.error("avatar upload error", err);
    res.status(500).json({ error: "Could not upload image." });
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
    // Lyrics the user owns, plus lyrics shared with them (accepted only).
    const { rows } = await pool.query(
      `SELECT l.id, l.title, l.updated_at, l.created_at,
              TRUE AS owned, 'owner' AS role,
              (SELECT COUNT(*) FROM lb_lyric_collaborators c WHERE c.lyric_id = l.id) AS collaborator_count
         FROM lb_lyrics l
        WHERE l.user_id = $1
       UNION ALL
       SELECT l.id, l.title, l.updated_at, l.created_at,
              FALSE AS owned, c.role,
              0 AS collaborator_count
         FROM lb_lyrics l
         JOIN lb_lyric_collaborators c ON c.lyric_id = l.id
        WHERE c.user_id = $1 AND c.status = 'accepted'
        ORDER BY updated_at DESC`,
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
    const access = await getLyricAccess(req.params.id, req.user.id);
    if (!access) return res.status(404).json({ error: "Lyric not found." });
    const { rows } = await pool.query(
      "SELECT id, title, body, created_at, updated_at FROM lb_lyrics WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Lyric not found." });
    res.json({ lyric: rows[0], role: access.role, canEdit: access.canEdit });
  } catch (err) {
    console.error("get lyric error", err);
    res.status(500).json({ error: "Could not load lyric." });
  }
});

app.put("/api/lyrics/:id", requireAuth, async (req, res) => {
  try {
    const access = await getLyricAccess(req.params.id, req.user.id);
    if (!access) return res.status(404).json({ error: "Lyric not found." });
    if (!access.canEdit) {
      return res.status(403).json({ error: "You have view-only access to this lyric." });
    }
    const { title, body } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE lb_lyrics
       SET title = COALESCE($2, title), body = COALESCE($3, body), updated_at = NOW()
       WHERE id = $1
       RETURNING id, title, body, created_at, updated_at`,
      [req.params.id, title != null ? String(title).slice(0, 200) : null, body]
    );
    if (!rows.length) return res.status(404).json({ error: "Lyric not found." });
    res.json({ lyric: rows[0], role: access.role, canEdit: access.canEdit });
  } catch (err) {
    console.error("update lyric error", err);
    res.status(500).json({ error: "Could not save lyric." });
  }
});

// Only the owner can permanently delete a lyric.
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

/* ----------------------- SHARING / COLLAB ----------------------- */

// List collaborators on a lyric (owner only).
app.get("/api/lyrics/:id/collaborators", requireAuth, async (req, res) => {
  try {
    const owned = await pool.query(
      "SELECT id FROM lb_lyrics WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.id]
    );
    if (!owned.rows.length) {
      return res.status(403).json({ error: "Only the owner can manage sharing." });
    }
    const { rows } = await pool.query(
      `SELECT c.id, c.invited_email, c.role, c.status, c.created_at, c.accepted_at,
              COALESCE(NULLIF(p.artist_name,''), NULLIF(p.display_name,''), u.email) AS name,
              p.avatar_url
         FROM lb_lyric_collaborators c
         LEFT JOIN lb_users u ON u.id = c.user_id
         LEFT JOIN lb_profiles p ON p.user_id = c.user_id
        WHERE c.lyric_id = $1
        ORDER BY c.created_at ASC`,
      [req.params.id]
    );
    res.json({
      collaborators: rows.map((r) => ({
        id: r.id,
        email: r.invited_email,
        name: r.name || r.invited_email,
        avatarUrl: r.avatar_url || "",
        role: r.role,
        status: r.status
      }))
    });
  } catch (err) {
    console.error("list collaborators error", err);
    res.status(500).json({ error: "Could not load collaborators." });
  }
});

// Invite someone to collaborate on a lyric (owner only).
app.post("/api/lyrics/:id/share", requireAuth, async (req, res) => {
  try {
    let { email, role = "editor" } = req.body || {};
    email = String(email || "").trim().toLowerCase();
    role = role === "viewer" ? "viewer" : "editor";
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }

    const owned = await pool.query(
      "SELECT id, title FROM lb_lyrics WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.id]
    );
    const lyric = owned.rows[0];
    if (!lyric) {
      return res.status(403).json({ error: "Only the owner can share this lyric." });
    }
    if (email === String(req.user.email).toLowerCase()) {
      return res.status(400).json({ error: "You already own this lyric." });
    }

    // Is the invitee already a registered user?
    const existing = await pool.query("SELECT id FROM lb_users WHERE email = $1", [email]);
    const inviteeUserId = existing.rows[0] ? existing.rows[0].id : null;

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days

    // Upsert the invite (re-inviting the same email updates role/token).
    await pool.query(
      `INSERT INTO lb_lyric_collaborators
         (lyric_id, user_id, invited_email, role, status, token_hash, expires_at, invited_by)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)
       ON CONFLICT (lyric_id, LOWER(invited_email))
       DO UPDATE SET role = EXCLUDED.role,
                     token_hash = EXCLUDED.token_hash,
                     expires_at = EXCLUDED.expires_at,
                     invited_by = EXCLUDED.invited_by,
                     user_id = COALESCE(lb_lyric_collaborators.user_id, EXCLUDED.user_id)`,
      [lyric.id, inviteeUserId, email, role, tokenHash, expires, req.user.id]
    );

    const inviterName = (await displayNameForUser(req.user.id, req.user.email)).name;
    const base = appBaseUrl(req);
    const acceptUrl = inviteeUserId
      ? `${base}/app.html?invite=${rawToken}`
      : `${base}/signup.html?invite=${rawToken}&email=${encodeURIComponent(email)}`;

    let emailSent = false;
    try {
      const r = await sendShareInvite(email, {
        inviterName,
        lyricTitle: lyric.title,
        acceptUrl,
        hasAccount: !!inviteeUserId
      });
      emailSent = !!(r && r.sent);
    } catch (e) {
      console.error("share email error", e);
    }

    res.status(201).json({
      ok: true,
      hasAccount: !!inviteeUserId,
      emailSent,
      message: inviteeUserId
        ? "Invite sent. They'll see it next time they open the Lyric Book."
        : "Invite sent. They'll be prompted to create an account first."
    });
  } catch (err) {
    console.error("share error", err);
    res.status(500).json({ error: "Could not share this lyric." });
  }
});

// Accept an invite via the emailed token (must be signed in as the invited email).
app.post("/api/lyrics/share/accept", requireAuth, async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: "Missing invite token." });
    const tokenHash = crypto.createHash("sha256").update(String(token)).digest("hex");
    const { rows } = await pool.query(
      `SELECT id, lyric_id, invited_email, expires_at
         FROM lb_lyric_collaborators
        WHERE token_hash = $1
        ORDER BY id DESC LIMIT 1`,
      [tokenHash]
    );
    const invite = rows[0];
    if (!invite) return res.status(400).json({ error: "This invite is invalid or has expired." });
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return res.status(400).json({ error: "This invite has expired." });
    }
    if (String(invite.invited_email).toLowerCase() !== String(req.user.email).toLowerCase()) {
      return res.status(403).json({
        error: `This invite was sent to ${invite.invited_email}. Sign in with that email to accept.`
      });
    }
    await pool.query(
      `UPDATE lb_lyric_collaborators
         SET status = 'accepted', user_id = $2, token_hash = NULL, accepted_at = NOW()
       WHERE id = $1`,
      [invite.id, req.user.id]
    );
    res.json({ ok: true, lyricId: invite.lyric_id });
  } catch (err) {
    console.error("accept invite error", err);
    res.status(500).json({ error: "Could not accept this invite." });
  }
});

// Pending invites addressed to the signed-in user (in-app notifications).
app.get("/api/invites", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.role, l.title,
              COALESCE(NULLIF(p.artist_name,''), NULLIF(p.display_name,''), owner.email) AS inviter
         FROM lb_lyric_collaborators c
         JOIN lb_lyrics l ON l.id = c.lyric_id
         LEFT JOIN lb_users owner ON owner.id = c.invited_by
         LEFT JOIN lb_profiles p ON p.user_id = c.invited_by
        WHERE c.status = 'pending'
          AND (c.user_id = $1 OR LOWER(c.invited_email) = LOWER($2))
        ORDER BY c.created_at DESC`,
      [req.user.id, req.user.email]
    );
    res.json({
      invites: rows.map((r) => ({
        id: r.id,
        title: r.title || "Untitled",
        role: r.role,
        inviter: r.inviter || "A DabzAudio artist"
      }))
    });
  } catch (err) {
    console.error("list invites error", err);
    res.status(500).json({ error: "Could not load invites." });
  }
});

// Accept a pending invite by its id (from the in-app invites list).
app.post("/api/invites/:id/accept", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE lb_lyric_collaborators
         SET status = 'accepted', user_id = $1, token_hash = NULL, accepted_at = NOW()
       WHERE id = $2 AND status = 'pending'
         AND (user_id = $1 OR LOWER(invited_email) = LOWER($3))
       RETURNING lyric_id`,
      [req.user.id, req.params.id, req.user.email]
    );
    if (!rows.length) return res.status(404).json({ error: "Invite not found." });
    res.json({ ok: true, lyricId: rows[0].lyric_id });
  } catch (err) {
    console.error("accept invite by id error", err);
    res.status(500).json({ error: "Could not accept this invite." });
  }
});

// Decline a pending invite addressed to the signed-in user.
app.post("/api/invites/:id/decline", requireAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM lb_lyric_collaborators
        WHERE id = $1 AND status = 'pending'
          AND (user_id = $2 OR LOWER(invited_email) = LOWER($3))`,
      [req.params.id, req.user.id, req.user.email]
    );
    if (!rowCount) return res.status(404).json({ error: "Invite not found." });
    res.json({ ok: true });
  } catch (err) {
    console.error("decline invite error", err);
    res.status(500).json({ error: "Could not decline this invite." });
  }
});

// Stop sharing: owner removes a collaborator, or a collaborator removes themselves.
app.delete("/api/lyrics/:id/share/:collabId", requireAuth, async (req, res) => {
  try {
    const owned = await pool.query(
      "SELECT id FROM lb_lyrics WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.id]
    );
    const isOwner = owned.rows.length > 0;
    let result;
    if (isOwner) {
      result = await pool.query(
        "DELETE FROM lb_lyric_collaborators WHERE id = $1 AND lyric_id = $2 RETURNING user_id",
        [req.params.collabId, req.params.id]
      );
    } else {
      // A collaborator can remove only their own membership (leave).
      result = await pool.query(
        "DELETE FROM lb_lyric_collaborators WHERE id = $1 AND lyric_id = $2 AND user_id = $3 RETURNING user_id",
        [req.params.collabId, req.params.id, req.user.id]
      );
    }
    if (!result.rowCount) return res.status(404).json({ error: "Collaborator not found." });

    // Kick the removed user from the live collab room (if connected)
    const removedUserId = result.rows[0].user_id;
    revokeCollabAccess(Number(req.params.id), removedUserId);

    res.json({ ok: true });
  } catch (err) {
    console.error("stop sharing error", err);
    res.status(500).json({ error: "Could not update sharing." });
  }
});

const PORT = process.env.PORT || 4000;
const httpServer = http.createServer(app);

// Real-time collaborative editing (Layer 2): attaches a Socket.io server that
// shares this HTTP server, so REST + WebSockets run on the same port/origin.
initCollab(httpServer, isAllowedOrigin);

connectWithRetry().then((ok) => {
  if (!ok) console.error("⚠️  Starting without confirmed DB connection.");
  httpServer.listen(PORT, () => console.log(`✅ Lyric Book API + realtime on :${PORT}`));
});
