/**
 * DabzAudio Community Hub - Backend API (Node + Express)
 * Change: BLOG POSTS ARE ADMIN-ONLY.
 *
 * How admin-only works:
 * - Set an env var: ADMIN_TOKEN=some-long-secret
 * - When creating a blog post, client must send header: x-admin-token: <ADMIN_TOKEN>
 * - Forum posts do NOT require admin token
 *
 * Users can still comment on blog posts (and forum posts) without admin token.
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./db.js";
import { v2 as cloudinary } from "cloudinary";
import { startAutoposter, runAutopostNow } from "./autoposter.js";

dotenv.config();

process.on("unhandledRejection", (err) => {
  console.error("❌ UnhandledRejection", err);
});
process.on("uncaughtException", (err) => {
  console.error("❌ UncaughtException", err);
  process.exit(1);
});

// Configure Cloudinary (optional for image uploads)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const app = express();
app.use(cors());
// Increase body size to allow base64 image uploads (default ~100kb is too small)
app.use(express.json({ limit: "10mb" }));

// Serve static frontend
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

function requireAdminForBlog(req) {
  const token = req.headers["x-admin-token"];
  const admin = process.env.ADMIN_TOKEN;
  return admin && token && token === admin;
}

/**
 * CREATE POST
 * type: "forum" or "blog"
 * BLOG posts require x-admin-token header
 */
app.post("/api/posts", async (req, res) => {
  try {
    const { type, category = "General", title, content, author = "Anonymous", image_url = null } = req.body;

    if (!type || !title || !content) {
      return res.status(400).json({ error: "Missing required fields: type, title, content" });
    }
    if (type !== "forum" && type !== "blog") {
      return res.status(400).json({ error: "type must be 'forum' or 'blog'" });
    }

    // NEW: Blog is admin-only
    if (type === "blog" && !requireAdminForBlog(req)) {
      return res.status(403).json({ error: "Blog publishing is admin-only." });
    }

    const q = `
      INSERT INTO posts (type, category, title, content, author, image_url)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
    `;
    const { rows } = await pool.query(q, [type, category, title, content, author, image_url]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error creating post" });
  }
});

/**
 * LIST POSTS (paged)
 */
app.get("/api/posts", async (req, res) => {
  try {
    const type = req.query.type || "";
    const category = req.query.category || "";
    const limit = Math.min(parseInt(req.query.limit || "10", 10), 50);
    const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);

    const where = [];
    const params = [];
    let i = 1;

    if (type) {
      if (type !== "forum" && type !== "blog") return res.status(400).json({ error: "Invalid type" });
      where.push(`type = $${i++}`);
      params.push(type);
    }
    if (category) {
      where.push(`category = $${i++}`);
      params.push(category);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const q = `
      SELECT * FROM posts
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${i++} OFFSET $${i++}
    `;
    params.push(limit, offset);

    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error listing posts" });
  }
});

app.get("/api/posts/:id", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM posts WHERE id = $1", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Post not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error getting post" });
  }
});

/**
 * ADD COMMENT (allowed for everyone)
 */
app.post("/api/comments", async (req, res) => {
  try {
    const { post_id, content, author = "Anonymous" } = req.body;
    if (!post_id || !content) return res.status(400).json({ error: "Missing post_id or content" });

    const q = `
      INSERT INTO comments (post_id, content, author)
      VALUES ($1,$2,$3)
      RETURNING *
    `;
    const { rows } = await pool.query(q, [post_id, content, author]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error creating comment" });
  }
});

// Admin-only image upload to Cloudinary
app.post("/api/upload", async (req, res) => {
  try {
    if (!requireAdminForBlog(req)) {
      return res.status(403).json({ error: "Admin token required" });
    }

    if (!cloudinary.config().cloud_name) {
      return res.status(500).json({ error: "Cloudinary not configured" });
    }

    const { image_base64 } = req.body || {};
    if (!image_base64) return res.status(400).json({ error: "image_base64 is required" });
    if (image_base64.length > 8 * 1024 * 1024) {
      return res.status(400).json({ error: "Image too large (limit ~8MB base64)" });
    }

    const result = await cloudinary.uploader.upload(image_base64, {
      folder: "dabzaudio",
      resource_type: "image"
    });

    return res.json({ url: result.secure_url });
  } catch (err) {
    console.error("Upload error", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

app.get("/api/comments", async (req, res) => {
  try {
    const postId = req.query.post_id;
    if (!postId) return res.status(400).json({ error: "post_id is required" });

    const { rows } = await pool.query(
      "SELECT * FROM comments WHERE post_id = $1 ORDER BY created_at ASC",
      [postId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error listing comments" });
  }
});

// Manual autoposter trigger (admin-only) to force a single post now.
app.post("/api/autoposter/trigger", async (req, res) => {
  try {
    if (!requireAdminForBlog(req)) {
      return res.status(403).json({ error: "Admin token required" });
    }
    const result = await runAutopostNow({ force: true });
    if (!result) return res.status(429).json({ error: "Skipped due to recent autopost" });
    res.json({ ok: true, post: result });
  } catch (err) {
    console.error("Autoposter trigger error", err);
    res.status(500).json({ error: "Failed to trigger autoposter" });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("✅ DabzAudio Community Hub running on port", PORT));

if (process.env.AUTPOSTER_ENABLED === "true") {
  startAutoposter().catch((err) => console.error("Autoposter failed to start", err));
}

// Quick DB connectivity check on boot (won't crash app if it fails)
(async () => {
  try {
    await pool.query("select 1");
    console.log("✅ DB connection ok");
  } catch (err) {
    console.error("❌ DB connection failed", err);
  }
})();
