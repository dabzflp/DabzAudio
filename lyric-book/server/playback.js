import crypto from "crypto";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";

const MAX_TRACK_BYTES = 25 * 1024 * 1024;
const MAX_COVER_BYTES = 5 * 1024 * 1024;
const MAX_LIBRARY_BYTES = 500 * 1024 * 1024;
const AUDIO_TYPES = new Set([
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave",
  "audio/ogg", "audio/flac", "audio/mp4", "audio/aac", "audio/x-m4a"
]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 2, fileSize: MAX_TRACK_BYTES },
  fileFilter: (req, file, cb) => {
    const allowed = file.fieldname === "audio" ? AUDIO_TYPES.has(file.mimetype) : IMAGE_TYPES.has(file.mimetype);
    cb(allowed ? null : new Error("Unsupported file type."), allowed);
  }
});

function uploadSingle(field) {
  return (req, res, next) => upload.single(field)(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: field === "cover" ? "Cover art must be 5 MB or smaller." : "Audio files must be 25 MB or smaller." });
    }
    return res.status(400).json({ error: err.message || "Unsupported upload." });
  });
}

function token() {
  return crypto.randomBytes(18).toString("base64url");
}

function appBase() {
  const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  if (!base || /\/lyric-book$/i.test(base)) return base;
  return `${base}/lyric-book`;
}

function playbackPageBase() {
  return appBase() || "/lyric-book";
}

function fileUpload(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
    stream.end(buffer);
  });
}

function destroyAsset(publicId, resourceType) {
  if (!publicId || !cloudinary.config().cloud_name) return Promise.resolve();
  return new Promise((resolve) => {
    cloudinary.uploader.destroy(publicId, { resource_type: resourceType }, () => resolve());
  });
}

function publicTrack(row, shareToken) {
  return {
    id: row.id,
    title: row.title,
    trackNumber: row.track_number,
    audioUrl: row.audio_url || `${appBase()}/api/playback/tracks/${row.id}/audio?token=${encodeURIComponent(shareToken)}`,
    durationSeconds: row.duration_seconds,
    playCount: Number(row.play_count || 0),
    playUrl: `${appBase()}/api/playback/tracks/${row.id}/play?token=${encodeURIComponent(shareToken)}`,
    createdAt: row.created_at
  };
}

function publicRelease(row, tracks = []) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    releaseType: row.release_type,
    coverUrl: row.cover_url || "",
    shareToken: row.share_token,
    shareUrl: `${playbackPageBase()}/playback.html?share=${row.share_token}`,
    tracks: tracks.map((track) => publicTrack(track, row.share_token)),
    createdAt: row.created_at
  };
}

async function getRelease(userId, releaseId) {
  const result = await pool.query(
    "SELECT * FROM lb_playback_releases WHERE id = $1 AND user_id = $2",
    [releaseId, userId]
  );
  return result.rows[0] || null;
}

export function registerPlaybackRoutes(app) {
  app.get("/api/playback", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT r.*, COALESCE(json_agg(t ORDER BY t.track_number) FILTER (WHERE t.id IS NOT NULL), '[]') AS track_rows
           FROM lb_playback_releases r
           LEFT JOIN lb_playback_tracks t ON t.release_id = r.id
          WHERE r.user_id = $1
          GROUP BY r.id
          ORDER BY r.position, r.created_at DESC`,
        [req.user.id]
      );
      res.json({ releases: rows.map((row) => publicRelease(row, row.track_rows)) });
    } catch (err) {
      console.error("Playback list error:", err);
      res.status(500).json({ error: "Could not load Playback." });
    }
  });

  app.post("/api/playback/releases", requireAuth, async (req, res) => {
    const title = String(req.body?.title || "").trim().slice(0, 160);
    const description = String(req.body?.description || "").trim().slice(0, 1000);
    const releaseType = req.body?.releaseType === "album" ? "album" : "single";
    if (!title) return res.status(400).json({ error: "Give this release a title." });
    try {
      const { rows } = await pool.query(
        `INSERT INTO lb_playback_releases (user_id, title, description, release_type, share_token, position)
         VALUES ($1, $2, $3, $4, $5, COALESCE((SELECT MAX(position) + 1 FROM lb_playback_releases WHERE user_id = $1), 0))
         RETURNING *`,
        [req.user.id, title, description, releaseType, token()]
      );
      res.status(201).json({ release: publicRelease(rows[0]) });
    } catch (err) {
      console.error("Playback release create error:", err);
      res.status(500).json({ error: "Could not create release." });
    }
  });

  app.put("/api/playback/releases/:id/cover", requireAuth, uploadSingle("cover"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Choose a cover image." });
    if (req.file.size > MAX_COVER_BYTES) return res.status(413).json({ error: "Cover art must be 5 MB or smaller." });
    try {
      const release = await getRelease(req.user.id, req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found." });
      if (!cloudinary.config().cloud_name) return res.status(503).json({ error: "Image uploads are not configured." });
      const result = await fileUpload(req.file.buffer, { folder: "lyricbook/playback/covers", resource_type: "image" });
      const { rows } = await pool.query(
        "UPDATE lb_playback_releases SET cover_url = $1, cover_public_id = $2, updated_at = NOW() WHERE id = $3 RETURNING *",
        [result.secure_url, result.public_id, release.id]
      );
      await destroyAsset(release.cover_public_id, "image");
      res.json({ release: publicRelease(rows[0]) });
    } catch (err) {
      console.error("Playback cover error:", err);
      res.status(500).json({ error: "Could not upload cover art." });
    }
  });

  app.post("/api/playback/releases/:id/tracks", requireAuth, uploadSingle("audio"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Choose an audio file." });
    try {
      const release = await getRelease(req.user.id, req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found." });
      const usage = await pool.query(
        `SELECT COALESCE(SUM(t.file_size), 0)::bigint AS bytes
           FROM lb_playback_tracks t
           JOIN lb_playback_releases r ON r.id = t.release_id
          WHERE r.user_id = $1`,
        [req.user.id]
      );
      if (Number(usage.rows[0].bytes) + req.file.size > MAX_LIBRARY_BYTES) {
        return res.status(413).json({ error: "Your Playback library is full. Remove a track before uploading more." });
      }
      const title = String(req.body?.title || req.file.originalname.replace(/\.[^.]+$/, "")).trim().slice(0, 160) || "Untitled track";
      const nextNumber = await pool.query("SELECT COALESCE(MAX(track_number) + 1, 1) AS n FROM lb_playback_tracks WHERE release_id = $1", [release.id]);
      const { rows } = await pool.query(
        `INSERT INTO lb_playback_tracks
          (release_id, title, audio_url, audio_data, audio_mime_type, file_size, duration_seconds, track_number)
         VALUES ($1, $2, '', $3, $4, $5, 0, $6) RETURNING *`,
        [release.id, title, req.file.buffer, req.file.mimetype, req.file.size, nextNumber.rows[0].n]
      );
      res.status(201).json({ track: publicTrack(rows[0], release.share_token) });
    } catch (err) {
      console.error("Playback track error:", err);
      res.status(500).json({ error: "Could not upload this track." });
    }
  });

  app.get("/api/playback/tracks/:id/audio", async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT t.audio_data, t.audio_mime_type, t.file_size
           FROM lb_playback_tracks t
           JOIN lb_playback_releases r ON r.id = t.release_id
          WHERE t.id = $1 AND r.share_token = $2`,
        [req.params.id, String(req.query.token || "")]
      );
      if (!rows.length || !rows[0].audio_data?.length) return res.status(404).json({ error: "Audio not found." });
      res.set({
        "Content-Type": rows[0].audio_mime_type || "audio/mpeg",
        "Content-Length": rows[0].file_size,
        "Content-Disposition": "inline",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Content-Type-Options": "nosniff"
      });
      res.send(rows[0].audio_data);
    } catch (err) {
      console.error("Playback audio stream error:", err);
      res.status(500).json({ error: "Could not play this track." });
    }
  });

  app.post("/api/playback/tracks/:id/play", async (req, res) => {
    try {
      const { rows } = await pool.query(
        `UPDATE lb_playback_tracks t
            SET play_count = t.play_count + 1
           FROM lb_playback_releases r
          WHERE t.release_id = r.id AND t.id = $1 AND r.share_token = $2
        RETURNING t.play_count`,
        [req.params.id, String(req.query.token || "")]
      );
      if (!rows.length) return res.status(404).json({ error: "Track not found." });
      res.json({ playCount: Number(rows[0].play_count) });
    } catch (err) {
      console.error("Playback play count error:", err);
      res.status(500).json({ error: "Could not record this play." });
    }
  });

  app.delete("/api/playback/releases/:releaseId/tracks/:trackId", requireAuth, async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const owned = await client.query(
        `SELECT t.id
           FROM lb_playback_tracks t
           JOIN lb_playback_releases r ON r.id = t.release_id
          WHERE t.id = $1 AND t.release_id = $2 AND r.user_id = $3`,
        [req.params.trackId, req.params.releaseId, req.user.id]
      );
      if (!owned.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Track not found." });
      }
      await client.query("DELETE FROM lb_playback_tracks WHERE id = $1", [req.params.trackId]);
      await client.query(
        `WITH numbered AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY track_number, id) AS next_number
            FROM lb_playback_tracks
           WHERE release_id = $1
        )
        UPDATE lb_playback_tracks t
           SET track_number = numbered.next_number
          FROM numbered
         WHERE t.id = numbered.id`,
        [req.params.releaseId]
      );
      await client.query("COMMIT");
      res.json({ ok: true });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Playback track delete error:", err);
      res.status(500).json({ error: "Could not delete this track." });
    } finally {
      client.release();
    }
  });

  app.delete("/api/playback/releases/:id", requireAuth, async (req, res) => {
    try {
      const release = await getRelease(req.user.id, req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found." });
      const tracks = await pool.query("SELECT audio_public_id FROM lb_playback_tracks WHERE release_id = $1", [release.id]);
      await pool.query("DELETE FROM lb_playback_releases WHERE id = $1", [release.id]);
      await Promise.all([
        destroyAsset(release.cover_public_id, "image"),
        ...tracks.rows.map((track) => destroyAsset(track.audio_public_id, "video"))
      ]);
      res.json({ ok: true });
    } catch (err) {
      console.error("Playback release delete error:", err);
      res.status(500).json({ error: "Could not delete this release." });
    }
  });

  app.put("/api/playback/releases/:id/tracks/order", requireAuth, async (req, res) => {
    const ids = Array.isArray(req.body?.trackIds) ? req.body.trackIds.map(Number).filter(Number.isInteger) : [];
    if (!ids.length) return res.status(400).json({ error: "Provide the track order." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const release = await client.query("SELECT id FROM lb_playback_releases WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
      if (!release.rows.length) return res.status(404).json({ error: "Release not found." });
      for (let index = 0; index < ids.length; index++) {
        await client.query("UPDATE lb_playback_tracks SET track_number = $1 WHERE id = $2 AND release_id = $3", [index + 1, ids[index], req.params.id]);
      }
      await client.query("COMMIT");
      res.json({ ok: true });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Playback reorder error:", err);
      res.status(500).json({ error: "Could not reorder tracks." });
    } finally {
      client.release();
    }
  });

  app.get("/api/playback/share/:shareToken", async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT r.*, p.artist_name, p.display_name
           FROM lb_playback_releases r
           JOIN lb_profiles p ON p.user_id = r.user_id
          WHERE r.share_token = $1`,
        [req.params.shareToken]
      );
      if (!rows.length) return res.status(404).json({ error: "This Playback link is no longer available." });
      const release = rows[0];
      const tracks = await pool.query("SELECT * FROM lb_playback_tracks WHERE release_id = $1 ORDER BY track_number", [release.id]);
      res.json({ release: { ...publicRelease(release, tracks.rows), artistName: release.artist_name || release.display_name || "Artist" } });
    } catch (err) {
      console.error("Playback share error:", err);
      res.status(500).json({ error: "Could not load this release." });
    }
  });
}

export { MAX_TRACK_BYTES, MAX_COVER_BYTES, MAX_LIBRARY_BYTES };
