/**
 * transfers.js - "Transfer files": temporary large-file transfers between creatives.
 *
 * Files are uploaded in parts and assembled on the server's storage driver.
 * Currently only the "local" disk driver is implemented (TRANSFER_DIR); the
 * driver functions below are the seam for a Railway Bucket (S3) driver.
 * Transfers and their files are deleted TRANSFER_TTL_DAYS (7) after creation.
 *
 * Env vars (all optional):
 *  - TRANSFER_DIR          storage folder (default server/.transfers)
 *  - TRANSFER_MAX_GB       max size of one transfer (default 10)
 *  - TRANSFER_USER_QUOTA_GB  max active transfer storage per user (default 20)
 */
import crypto from "crypto";
import { ZipArchive } from "archiver";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { fileURLToPath } from "url";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { rateLimit } from "./rate-limit.js";
import { displayNameForUser } from "./access.js";
import { sendTransferEmail, sendTransferDownloaded } from "./email.js";

const GB = 1024 * 1024 * 1024;
const MAX_TRANSFER_BYTES = Number(process.env.TRANSFER_MAX_GB || 10) * GB;
const USER_QUOTA_BYTES = Number(process.env.TRANSFER_USER_QUOTA_GB || 20) * GB;
const TTL_DAYS = 7;
const PART_SIZE = 16 * 1024 * 1024;
const MAX_FILES = 1000;
const MAX_RECIPIENTS = 10;
const STALE_UPLOAD_HOURS = 24;
const NOTIFY_THROTTLE_MS = 15 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.TRANSFER_DIR || path.join(__dirname, ".transfers"));

/* ---------- local storage driver ---------- */
const storage = {
  dir: (transferId) => path.join(ROOT, String(transferId)),
  partsDir: (transferId, fileId) => path.join(ROOT, String(transferId), `${fileId}.parts`),
  filePath: (transferId, fileId) => path.join(ROOT, String(transferId), String(fileId)),

  async writePart(req, transferId, fileId, index, maxBytes) {
    const dir = storage.partsDir(transferId, fileId);
    await fs.promises.mkdir(dir, { recursive: true });
    const target = path.join(dir, String(index));
    const temp = `${target}.tmp`;
    let received = 0;
    req.on("data", (chunk) => {
      received += chunk.length;
      if (received > maxBytes) req.destroy(new Error("Part too large."));
    });
    try {
      await pipeline(req, fs.createWriteStream(temp));
      await fs.promises.rename(temp, target);
    } catch (err) {
      await fs.promises.rm(temp, { force: true });
      throw err;
    }
    return received;
  },

  async assemble(transferId, fileId, partCount, expectedSize) {
    const dir = storage.partsDir(transferId, fileId);
    const out = storage.filePath(transferId, fileId);
    const temp = `${out}.assembling`;
    const ws = fs.createWriteStream(temp);
    try {
      for (let i = 0; i < partCount; i += 1) {
        await pipeline(fs.createReadStream(path.join(dir, String(i))), ws, { end: false });
      }
      await new Promise((resolve, reject) => ws.end((err) => (err ? reject(err) : resolve())));
      const { size } = await fs.promises.stat(temp);
      if (size !== expectedSize) throw new Error("Uploaded size does not match.");
      await fs.promises.rename(temp, out);
    } catch (err) {
      ws.destroy();
      await fs.promises.rm(temp, { force: true });
      throw err;
    }
    await fs.promises.rm(dir, { recursive: true, force: true });
  },

  async listParts(transferId, fileId) {
    try {
      const names = await fs.promises.readdir(storage.partsDir(transferId, fileId));
      return names.filter((n) => /^\d+$/.test(n)).map(Number).sort((a, b) => a - b);
    } catch {
      return [];
    }
  },

  removeTransfer: (transferId) => fs.promises.rm(storage.dir(transferId), { recursive: true, force: true })
};

/* ---------- helpers ---------- */
function newToken() {
  return crypto.randomBytes(18).toString("base64url");
}

function linkBase(req) {
  const configured = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  if (configured) return /\/lyric-book$/i.test(configured) ? configured : `${configured}/lyric-book`;
  return `${req.protocol}://${req.get("host")}/lyric-book`;
}

function shareUrl(req, token) {
  return `${linkBase(req)}/transfer-share.html?t=${encodeURIComponent(token)}`;
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (n >= GB) return `${(n / GB).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

// Keeps folder structure ("Stems/Kick.wav") but strips anything that could
// escape the folder (.., absolute paths, control characters).
function safeName(name) {
  const segments = String(name || "file")
    .replace(/\\/g, "/")
    .split("/")
    .map((seg) => seg.replace(/[\u0000-\u001f]/g, "_").trim().slice(0, 200))
    .filter((seg) => seg && seg !== "." && seg !== "..");
  return segments.join("/").slice(0, 600) || "file";
}

function baseName(name) {
  return String(name).split("/").pop() || "file";
}

function partCountFor(size) {
  return Math.max(1, Math.ceil(size / PART_SIZE));
}

async function ownedTransfer(id, userId) {
  const { rows } = await pool.query("SELECT * FROM lb_transfers WHERE id = $1 AND user_id = $2 AND expires_at > NOW()", [id, userId]);
  return rows[0] || null;
}

function publicTransfer(row, files, recipients, req) {
  return {
    id: row.id,
    message: row.message,
    status: row.status,
    totalBytes: Number(row.total_bytes),
    downloadCount: row.download_count,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    link: shareUrl(req, row.token),
    files: files.map((f) => ({ id: f.id, name: f.name, size: Number(f.size), completed: f.completed })),
    recipients: recipients.map((r) => r.email)
  };
}

async function sendPendingEmails(req, transfer, files, recipients) {
  const pending = recipients.filter((r) => !r.notified_at);
  if (pending.length) {
    const senderName = (await displayNameForUser(req.user.id, req.user.email)).name;
    const url = shareUrl(req, transfer.token);
    for (const recipient of pending) {
      try {
        const result = await sendTransferEmail(recipient.email, {
          senderName,
          message: transfer.message,
          fileCount: files.length,
          totalLabel: formatBytes(transfer.total_bytes),
          expiresLabel: new Date(transfer.expires_at).toUTCString().slice(0, 16),
          downloadUrl: url
        });
        if (!result.sent) continue;
        await pool.query("UPDATE lb_transfer_recipients SET notified_at = NOW() WHERE id = $1", [recipient.id]);
        recipient.notified_at = new Date();
      } catch (err) {
        console.error("Transfer email failed:", err.message);
      }
    }
  }
  const emailed = recipients.filter((r) => r.notified_at).length;
  const emailPending = recipients.length - emailed;
  return { emailed, emailFailed: emailPending, emailPending };
}

async function purgeTransfer(id) {
  await storage.removeTransfer(id);
  await pool.query("DELETE FROM lb_transfers WHERE id = $1", [id]);
}

export async function cleanupTransfers() {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM lb_transfers
        WHERE expires_at <= NOW()
           OR (status = 'uploading' AND created_at < NOW() - ($1 || ' hours')::interval)`,
      [String(STALE_UPLOAD_HOURS)]
    );
    for (const row of rows) {
      try { await purgeTransfer(row.id); } catch (err) { console.error("Transfer cleanup failed:", row.id, err.message); }
    }
    if (rows.length) console.log(`Transfer cleanup removed ${rows.length} transfer(s).`);
  } catch (err) {
    console.error("Transfer cleanup error:", err.message);
  }
}

/* ---------- routes ---------- */
export function registerTransferRoutes(app) {
  cleanupTransfers();
  setInterval(cleanupTransfers, 60 * 60 * 1000).unref();

  app.get("/api/transfers", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT * FROM lb_transfers WHERE user_id = $1 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 100",
        [req.user.id]
      );
      const ids = rows.map((r) => r.id);
      const files = ids.length ? (await pool.query("SELECT * FROM lb_transfer_files WHERE transfer_id = ANY($1) ORDER BY id", [ids])).rows : [];
      const recips = ids.length ? (await pool.query("SELECT * FROM lb_transfer_recipients WHERE transfer_id = ANY($1) ORDER BY id", [ids])).rows : [];
      res.json({
        maxTransferBytes: MAX_TRANSFER_BYTES,
        ttlDays: TTL_DAYS,
        transfers: rows.map((r) => publicTransfer(r, files.filter((f) => f.transfer_id === r.id), recips.filter((x) => x.transfer_id === r.id), req))
      });
    } catch (err) {
      console.error("List transfers error:", err);
      res.status(500).json({ error: "Could not load your transfers." });
    }
  });

  app.post("/api/transfers", requireAuth, rateLimit({ windowMs: 60 * 60 * 1000, max: 30 }), async (req, res) => {
    try {
      const message = String(req.body?.message || "").trim().slice(0, 1000);
      const rawFiles = Array.isArray(req.body?.files) ? req.body.files : [];
      const emails = [...new Set((Array.isArray(req.body?.recipients) ? req.body.recipients : [])
        .map((e) => String(e).trim().toLowerCase()).filter(Boolean))];

      if (!rawFiles.length) return res.status(400).json({ error: "Choose at least one file." });
      if (rawFiles.length > MAX_FILES) return res.status(400).json({ error: `You can send up to ${MAX_FILES} files at once.` });
      if (emails.length > MAX_RECIPIENTS) return res.status(400).json({ error: `You can email up to ${MAX_RECIPIENTS} people at once.` });
      const badEmail = emails.find((e) => !EMAIL_RE.test(e) || e.length > 254);
      if (badEmail) return res.status(400).json({ error: `"${badEmail}" is not a valid email address.` });

      const files = rawFiles.map((f) => ({
        name: safeName(f.name),
        size: Number(f.size),
        type: String(f.type || "application/octet-stream").slice(0, 120)
      }));
      if (files.some((f) => !Number.isSafeInteger(f.size) || f.size <= 0)) {
        return res.status(400).json({ error: "Empty files can't be transferred." });
      }
      const total = files.reduce((sum, f) => sum + f.size, 0);
      if (total > MAX_TRANSFER_BYTES) {
        return res.status(413).json({ error: `A transfer can be up to ${formatBytes(MAX_TRANSFER_BYTES)}.` });
      }

      const used = await pool.query(
        "SELECT COALESCE(SUM(total_bytes), 0) AS used FROM lb_transfers WHERE user_id = $1 AND expires_at > NOW()",
        [req.user.id]
      );
      if (Number(used.rows[0].used) + total > USER_QUOTA_BYTES) {
        return res.status(413).json({ error: `You have reached your active transfer limit of ${formatBytes(USER_QUOTA_BYTES)}. Delete a transfer or wait for one to expire.` });
      }

      const client = await pool.connect();
      let transfer;
      let saved = [];
      try {
        await client.query("BEGIN");
        transfer = (await client.query(
          `INSERT INTO lb_transfers (user_id, token, message, total_bytes, expires_at)
           VALUES ($1, $2, $3, $4, NOW() + ($5 || ' days')::interval) RETURNING *`,
          [req.user.id, newToken(), message, total, String(TTL_DAYS)]
        )).rows[0];
        for (const f of files) {
          saved.push((await client.query(
            "INSERT INTO lb_transfer_files (transfer_id, name, size, mime_type) VALUES ($1, $2, $3, $4) RETURNING *",
            [transfer.id, f.name, f.size, f.type]
          )).rows[0]);
        }
        for (const email of emails) {
          await client.query("INSERT INTO lb_transfer_recipients (transfer_id, email) VALUES ($1, $2)", [transfer.id, email]);
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      res.status(201).json({
        transfer: publicTransfer(transfer, saved, emails.map((email) => ({ email })), req),
        partSize: PART_SIZE,
        files: saved.map((f) => ({ id: f.id, parts: partCountFor(Number(f.size)) }))
      });
    } catch (err) {
      console.error("Create transfer error:", err);
      res.status(500).json({ error: "Could not start the transfer." });
    }
  });

  // Parts already stored for a file, so an interrupted upload can resume.
  app.get("/api/transfers/:id/files/:fileId/parts", requireAuth, async (req, res) => {
    const transfer = await ownedTransfer(req.params.id, req.user.id);
    if (!transfer) return res.status(404).json({ error: "Transfer not found." });
    res.json({ parts: await storage.listParts(transfer.id, Number(req.params.fileId)) });
  });

  app.put("/api/transfers/:id/files/:fileId/parts/:index", requireAuth, async (req, res) => {
    try {
      const transfer = await ownedTransfer(req.params.id, req.user.id);
      if (!transfer || transfer.status !== "uploading") return res.status(404).json({ error: "Transfer not found." });
      const file = (await pool.query("SELECT * FROM lb_transfer_files WHERE id = $1 AND transfer_id = $2", [req.params.fileId, transfer.id])).rows[0];
      if (!file) return res.status(404).json({ error: "File not found." });
      const index = Number(req.params.index);
      const parts = partCountFor(Number(file.size));
      if (!Number.isInteger(index) || index < 0 || index >= parts) return res.status(400).json({ error: "Invalid part." });

      const expected = index === parts - 1 ? Number(file.size) - PART_SIZE * (parts - 1) : PART_SIZE;
      const received = await storage.writePart(req, transfer.id, file.id, index, expected);
      if (received !== expected) {
        await fs.promises.rm(path.join(storage.partsDir(transfer.id, file.id), String(index)), { force: true });
        return res.status(400).json({ error: "Part was incomplete. Retrying." });
      }
      res.json({ ok: true });
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: "Could not store that part." });
    }
  });

  app.post("/api/transfers/:id/complete", requireAuth, async (req, res) => {
    try {
      let transfer = await ownedTransfer(req.params.id, req.user.id);
      if (!transfer) return res.status(404).json({ error: "Transfer not found." });
      const files = (await pool.query("SELECT * FROM lb_transfer_files WHERE transfer_id = $1 ORDER BY id", [transfer.id])).rows;

      if (transfer.status === "uploading") {
        for (const file of files) {
          if (file.completed) continue;
          const parts = partCountFor(Number(file.size));
          const have = await storage.listParts(transfer.id, file.id);
          if (have.length < parts) return res.status(400).json({ error: `"${file.name}" has not finished uploading.` });
          await storage.assemble(transfer.id, file.id, parts, Number(file.size));
          await pool.query("UPDATE lb_transfer_files SET completed = TRUE WHERE id = $1", [file.id]);
          file.completed = true;
        }
        await pool.query(
          `UPDATE lb_transfers
              SET status = 'ready', expires_at = NOW() + ($2 || ' days')::interval
            WHERE id = $1 AND status = 'uploading'`,
          [transfer.id, String(TTL_DAYS)]
        );
        transfer = (await pool.query("SELECT * FROM lb_transfers WHERE id = $1", [transfer.id])).rows[0];
      }

      const recipients = (await pool.query("SELECT * FROM lb_transfer_recipients WHERE transfer_id = $1 ORDER BY id", [transfer.id])).rows;
      const delivery = req.body?.sendEmails === false
        ? { emailed: recipients.filter((r) => r.notified_at).length, emailFailed: 0, emailPending: recipients.filter((r) => !r.notified_at).length }
        : await sendPendingEmails(req, transfer, files, recipients);
      res.json({
        transfer: publicTransfer(transfer, files, recipients, req),
        ...delivery
      });
    } catch (err) {
      console.error("Complete transfer error:", err);
      res.status(500).json({ error: "Could not finish the transfer. Please try again." });
    }
  });

  app.post("/api/transfers/:id/send", requireAuth, rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), async (req, res) => {
    try {
      const transfer = await ownedTransfer(req.params.id, req.user.id);
      if (!transfer) return res.status(404).json({ error: "Transfer not found." });
      if (transfer.status !== "ready") return res.status(409).json({ error: "Upload must finish before sending email." });
      const files = (await pool.query("SELECT * FROM lb_transfer_files WHERE transfer_id = $1 ORDER BY id", [transfer.id])).rows;
      const recipients = (await pool.query("SELECT * FROM lb_transfer_recipients WHERE transfer_id = $1 ORDER BY id", [transfer.id])).rows;
      const delivery = await sendPendingEmails(req, transfer, files, recipients);
      res.json({
        transfer: publicTransfer(transfer, files, recipients, req),
        ...delivery
      });
    } catch (err) {
      console.error("Send transfer email error:", err);
      res.status(500).json({ error: "Could not send transfer email. Please try again." });
    }
  });

  app.delete("/api/transfers/:id", requireAuth, async (req, res) => {
    try {
      const transfer = await ownedTransfer(req.params.id, req.user.id);
      if (!transfer) return res.status(404).json({ error: "Transfer not found." });
      await purgeTransfer(transfer.id);
      res.json({ ok: true });
    } catch (err) {
      console.error("Delete transfer error:", err);
      res.status(500).json({ error: "Could not delete this transfer." });
    }
  });

  /* ----- public (recipient) ----- */
  async function readyByToken(token) {
    const { rows } = await pool.query(
      "SELECT * FROM lb_transfers WHERE token = $1 AND status = 'ready' AND expires_at > NOW()",
      [String(token)]
    );
    return rows[0] || null;
  }

  app.get("/api/transfers/public/:token", rateLimit({ windowMs: 15 * 60 * 1000, max: 120 }), async (req, res) => {
    try {
      const transfer = await readyByToken(req.params.token);
      if (!transfer) return res.status(404).json({ error: "This transfer has expired or was removed." });
      const files = (await pool.query("SELECT id, name, size FROM lb_transfer_files WHERE transfer_id = $1 ORDER BY id", [transfer.id])).rows;
      const owner = (await pool.query("SELECT email FROM lb_users WHERE id = $1", [transfer.user_id])).rows[0];
      res.json({
        senderName: (await displayNameForUser(transfer.user_id, owner?.email)).name,
        message: transfer.message,
        totalBytes: Number(transfer.total_bytes),
        expiresAt: transfer.expires_at,
        files: files.map((f) => ({ id: f.id, name: f.name, size: Number(f.size) }))
      });
    } catch (err) {
      console.error("Public transfer error:", err);
      res.status(500).json({ error: "Could not load this transfer." });
    }
  });

  app.get("/api/transfers/public/:token/zip", rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }), async (req, res) => {
    try {
      const transfer = await readyByToken(req.params.token);
      if (!transfer) return res.status(404).json({ error: "This transfer has expired or was removed." });
      const files = (await pool.query("SELECT * FROM lb_transfer_files WHERE transfer_id = $1 AND completed ORDER BY id", [transfer.id])).rows;
      if (!files.length) return res.status(404).json({ error: "File not found." });

      res.once("finish", () => {
        const fileName = files.length === 1 ? files[0].name : "All files (ZIP)";
        notifyDownload(req, transfer, fileName).catch((err) => console.error("Download notice failed:", err.message));
      });
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", 'attachment; filename="DabzAudio-transfer.zip"');
      // Media is already compressed, so store without deflating: fast, low CPU.
      const zip = new ZipArchive({ store: true, forceZip64: true });
      zip.on("error", (err) => { console.error("Zip error:", err.message); res.destroy(err); });
      res.on("close", () => zip.destroy());
      zip.pipe(res);
      const used = new Set();
      for (const file of files) {
        let entry = file.name;
        for (let n = 2; used.has(entry); n += 1) entry = `${n}-${file.name}`;
        used.add(entry);
        zip.file(storage.filePath(transfer.id, file.id), { name: entry });
      }
      await zip.finalize();
    } catch (err) {
      console.error("Zip download error:", err);
      if (!res.headersSent) res.status(500).json({ error: "Could not prepare the download." });
    }
  });

  app.get("/api/transfers/public/:token/files/:fileId", rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }), async (req, res) => {
    try {
      const transfer = await readyByToken(req.params.token);
      if (!transfer) return res.status(404).json({ error: "This transfer has expired or was removed." });
      const file = (await pool.query("SELECT * FROM lb_transfer_files WHERE id = $1 AND transfer_id = $2 AND completed", [req.params.fileId, transfer.id])).rows[0];
      if (!file) return res.status(404).json({ error: "File not found." });

      // Range requests (resumed downloads) only count as a download from byte 0.
      const isStart = !req.headers.range || /^bytes=0-/.test(req.headers.range);
      res.download(storage.filePath(transfer.id, file.id), baseName(file.name), { acceptRanges: true }, (err) => {
        if (err) {
          if (!res.headersSent) res.status(404).json({ error: "File not found." });
          return;
        }
        if (isStart) notifyDownload(req, transfer, file.name).catch((noticeErr) => console.error("Download notice failed:", noticeErr.message));
      });
    } catch (err) {
      console.error("Download error:", err);
      if (!res.headersSent) res.status(500).json({ error: "Could not download this file." });
    }
  });
}

async function notifyDownload(req, transfer, fileName) {
  const { rows } = await pool.query(
    `UPDATE lb_transfers
        SET download_count = download_count + 1,
            last_notified_at = CASE WHEN last_notified_at IS NULL OR last_notified_at < NOW() - ($2 || ' milliseconds')::interval THEN NOW() ELSE last_notified_at END
      WHERE id = $1
  RETURNING download_count, last_notified_at, (last_notified_at IS NOT DISTINCT FROM NOW()) AS notify`,
    [transfer.id, String(NOTIFY_THROTTLE_MS)]
  );
  if (!rows[0]?.notify) return;
  const owner = (await pool.query("SELECT email FROM lb_users WHERE id = $1", [transfer.user_id])).rows[0];
  if (!owner) return;
  await sendTransferDownloaded(owner.email, {
    fileName,
    count: rows[0].download_count,
    manageUrl: `${linkBase(req)}/transfer.html`
  });
}
