import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

process.env.RESEND_API_KEY = "";
const transferRoot = await mkdtemp(path.join(os.tmpdir(), "lyric-book-transfers-"));
process.env.TRANSFER_DIR = transferRoot;
const { pool } = await import("../db.js");
const { cleanupTransfers, registerTransferRoutes } = await import("../transfers.js");

test.after(() => rm(transferRoot, { recursive: true, force: true }));

test("upload completion defers email and the separate send action leaves failures retryable", async () => {
  const transfer = {
    id: "transfer-1",
    user_id: "user-1",
    token: "share-token",
    message: "",
    total_bytes: 12,
    status: "uploading",
    expires_at: new Date(Date.now() + 4 * 86400000),
    created_at: new Date(),
    download_count: 0
  };
  const file = { id: 2, transfer_id: transfer.id, name: "stems.wav", size: 12, completed: true };
  const recipient = { id: 3, transfer_id: transfer.id, email: "creative@example.com", notified_at: null };
  const queries = [];
  const originalQuery = pool.query;
  pool.query = async (sql) => {
    queries.push(sql);
    if (sql.startsWith("SELECT id, status FROM lb_transfers")) return { rows: [] };
    if (sql.includes("SELECT * FROM lb_transfers WHERE id = $1 AND user_id = $2")) return { rows: [transfer] };
    if (sql.includes("SELECT * FROM lb_transfer_files WHERE transfer_id = $1")) return { rows: [file] };
    if (sql.includes("UPDATE lb_transfers")) {
      transfer.status = "ready";
      return { rows: [] };
    }
    if (sql === "SELECT * FROM lb_transfers WHERE id = $1") return { rows: [transfer] };
    if (sql.includes("SELECT * FROM lb_transfer_recipients WHERE transfer_id = $1")) return { rows: [recipient] };
    if (sql.includes("FROM lb_users u LEFT JOIN lb_profiles")) return { rows: [{ name: "Sender" }] };
    if (sql.includes("UPDATE lb_transfer_recipients")) return { rows: [] };
    throw new Error("Unexpected database query: " + sql);
  };

  try {
    const routes = new Map();
    const app = {
      get: (path, ...handlers) => routes.set("GET " + path, handlers.at(-1)),
      post: (path, ...handlers) => routes.set("POST " + path, handlers.at(-1)),
      put: (path, ...handlers) => routes.set("PUT " + path, handlers.at(-1)),
      delete: (path, ...handlers) => routes.set("DELETE " + path, handlers.at(-1))
    };
    registerTransferRoutes(app);

    async function call(handler, body = {}) {
      const response = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(value) { this.payload = value; return this; }
      };
      await handler({
        params: { id: transfer.id },
        user: { id: transfer.user_id, email: "sender@example.com" },
        protocol: "https",
        get: () => "dabzaudio.test",
        body
      }, response);
      return response;
    }

    const complete = await call(routes.get("POST /api/transfers/:id/complete"), { sendEmails: false });
    assert.equal(complete.statusCode, 200);
    assert.equal(complete.payload.transfer.status, "ready");
    assert.equal(complete.payload.emailPending, 1);
    assert.equal(complete.payload.emailFailed, 0);
    assert.equal(queries.some((sql) => sql.includes("UPDATE lb_transfer_recipients")), false);

    const send = routes.get("POST /api/transfers/:id/send");
    const firstAttempt = await call(send);
    const retry = await call(send);
    for (const response of [firstAttempt, retry]) {
      assert.equal(response.statusCode, 200);
      assert.equal(response.payload.emailed, 0);
      assert.equal(response.payload.emailFailed, 1);
      assert.equal(response.payload.emailPending, 1);
    }
    assert.equal(recipient.notified_at, null);
    assert.equal(queries.filter((sql) => sql.includes("UPDATE lb_transfer_recipients")).length, 0);
  } finally {
    pool.query = originalQuery;
  }
});

test("public download endpoints return readable errors instead of downloadable JSON when files are missing", async () => {
  const transfer = { id: "missing-transfer", user_id: "user-1", token: "share-token" };
  const file = { id: 2, transfer_id: transfer.id, name: "stems.wav", size: 12, completed: true };
  const originalQuery = pool.query;
  pool.query = async (sql) => {
    if (sql.startsWith("SELECT id, status FROM lb_transfers")) return { rows: [] };
    if (sql.includes("WHERE token = $1 AND status = 'ready'")) return { rows: [transfer] };
    if (sql.includes("SELECT * FROM lb_transfer_files WHERE transfer_id = $1 AND completed")) return { rows: [file] };
    if (sql.includes("SELECT * FROM lb_transfer_files WHERE id = $1 AND transfer_id = $2 AND completed")) return { rows: [file] };
    throw new Error("Unexpected database query: " + sql);
  };

  try {
    const routes = new Map();
    const app = {
      get: (route, ...handlers) => routes.set("GET " + route, handlers.at(-1)),
      post: () => {},
      put: () => {},
      delete: () => {}
    };
    registerTransferRoutes(app);

    async function call(handler, params) {
      const response = {
        statusCode: 200,
        headersSent: false,
        status(code) { this.statusCode = code; return this; },
        type(value) { this.contentType = value; return this; },
        send(value) { this.body = value; this.headersSent = true; return this; }
      };
      await handler({ params, headers: {} }, response);
      return response;
    }

    const zip = await call(routes.get("GET /api/transfers/public/:token/zip"), { token: transfer.token });
    const single = await call(routes.get("GET /api/transfers/public/:token/files/:fileId"), {
      token: transfer.token,
      fileId: String(file.id)
    });

    for (const response of [zip, single]) {
      assert.equal(response.statusCode, 404);
      assert.equal(response.contentType, "text/plain");
      assert.match(response.body, /transfer file is unavailable/i);
      assert.doesNotMatch(response.body, /^\s*\{/);
    }
  } finally {
    pool.query = originalQuery;
  }
});

test("download-all streams a ZIP archive with download headers", async () => {
  const transfer = { id: "zip-transfer", user_id: "user-1", token: "zip-token" };
  const files = [
    { id: 2, transfer_id: transfer.id, name: "stems/kick.wav", size: 4, completed: true },
    { id: 3, transfer_id: transfer.id, name: "stems/bass.wav", size: 4, completed: true }
  ];
  await mkdir(path.join(transferRoot, transfer.id), { recursive: true });
  await writeFile(path.join(transferRoot, transfer.id, "2"), "kick");
  await writeFile(path.join(transferRoot, transfer.id, "3"), "bass");

  const queries = [];
  const originalQuery = pool.query;
  pool.query = async (sql, params) => {
    queries.push({ sql, params });
    if (sql.startsWith("SELECT id, status FROM lb_transfers")) return { rows: [] };
    if (sql.includes("WHERE token = $1 AND status = 'ready'")) return { rows: [transfer] };
    if (sql.includes("SELECT * FROM lb_transfer_files WHERE transfer_id = $1 AND completed")) return { rows: files };
    if (sql.includes("INSERT INTO lb_transfer_downloads")) return { rows: [] };
    if (sql.includes("UPDATE lb_transfers")) return { rows: [] };
    throw new Error("Unexpected database query: " + sql);
  };

  try {
    const routes = new Map();
    const app = {
      get: (route, ...handlers) => routes.set("GET " + route, handlers.at(-1)),
      post: () => {},
      put: () => {},
      delete: () => {}
    };
    registerTransferRoutes(app);

    const response = new PassThrough();
    const headers = new Map();
    response.setHeader = (name, value) => headers.set(name.toLowerCase(), value);
    const chunks = [];
    response.on("data", (chunk) => chunks.push(chunk));
    const finished = new Promise((resolve, reject) => {
      response.once("finish", resolve);
      response.once("error", reject);
    });

    await routes.get("GET /api/transfers/public/:token/zip")({ params: { token: transfer.token } }, response);
    await finished;
    const archive = Buffer.concat(chunks);
    assert.equal(headers.get("content-type"), "application/zip");
    assert.match(headers.get("content-disposition"), /attachment; filename="DabzAudio-transfer\.zip"/);
    assert.deepEqual(archive.subarray(0, 4), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    await new Promise((resolve) => setImmediate(resolve));
    const downloadLog = queries.find(({ sql }) => sql.includes("INSERT INTO lb_transfer_downloads"));
    assert.deepEqual(downloadLog.params, [transfer.id, files.map((file) => file.name), "zip"]);
  } finally {
    pool.query = originalQuery;
  }
});

test("expiration removes transfer bytes but retains the history record", async () => {
  const transferId = "expired-log-transfer";
  const directory = path.join(transferRoot, transferId);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "old-file"), "data");
  const queries = [];
  const originalQuery = pool.query;
  pool.query = async (sql) => {
    queries.push(sql);
    if (sql.startsWith("SELECT id, status FROM lb_transfers")) {
      return { rows: [{ id: transferId, status: "ready" }] };
    }
    if (sql.includes("UPDATE lb_transfers SET status = 'expired'")) return { rows: [] };
    throw new Error("Unexpected database query: " + sql);
  };

  try {
    await cleanupTransfers();
    await assert.rejects(access(directory));
    assert.equal(queries.some((sql) => sql.includes("DELETE FROM lb_transfers")), false);
    assert.equal(queries.some((sql) => sql.includes("SET status = 'expired'")), true);
  } finally {
    pool.query = originalQuery;
  }
});

test("owner history includes expired transfer metadata and download events", async () => {
  const transfer = {
    id: "history-transfer",
    user_id: "user-1",
    token: "expired-token",
    message: "Master files",
    total_bytes: 8,
    status: "expired",
    download_count: 1,
    expires_at: new Date("2026-01-05T00:00:00Z"),
    completed_at: new Date("2026-01-01T00:00:00Z"),
    created_at: new Date("2025-12-31T23:00:00Z")
  };
  const file = { id: "file-1", transfer_id: transfer.id, name: "stems/kick.wav", size: 8, completed: true };
  const download = {
    transfer_id: transfer.id,
    file_names: ["stems/kick.wav"],
    download_type: "file",
    downloaded_at: new Date("2026-01-02T00:00:00Z")
  };
  const originalQuery = pool.query;
  pool.query = async (sql) => {
    if (sql.startsWith("SELECT id, status FROM lb_transfers")) return { rows: [] };
    if (sql.includes("SELECT * FROM lb_transfers")) return { rows: [transfer] };
    if (sql.includes("SELECT * FROM lb_transfer_files")) return { rows: [file] };
    if (sql.includes("SELECT * FROM lb_transfer_recipients")) {
      return { rows: [{ transfer_id: transfer.id, email: "creative@example.com", notified_at: null }] };
    }
    if (sql.includes("SELECT * FROM lb_transfer_downloads")) return { rows: [download] };
    throw new Error("Unexpected database query: " + sql);
  };

  try {
    const routes = new Map();
    const app = {
      get: (route, ...handlers) => routes.set("GET " + route, handlers.at(-1)),
      post: () => {},
      put: () => {},
      delete: () => {}
    };
    registerTransferRoutes(app);
    const response = {
      json(value) { this.payload = value; return this; },
      status() { return this; }
    };
    await routes.get("GET /api/transfers")({
      params: {},
      query: {},
      user: { id: transfer.user_id },
      protocol: "https",
      get: () => "dabzaudio.test"
    }, response);

    assert.equal(response.payload.ttlDays, 4);
    assert.equal(response.payload.maxTransferBytes, 2 * 1024 * 1024 * 1024);
    assert.equal(response.payload.transfers[0].status, "expired");
    assert.deepEqual(response.payload.transfers[0].downloads[0].fileNames, ["stems/kick.wav"]);
    assert.equal(response.payload.transfers[0].recipients[0], "creative@example.com");
    assert.equal(response.payload.transfers[0].recipientDelivery[0].notifiedAt, null);
  } finally {
    pool.query = originalQuery;
  }
});

test("global active-storage cap prevents uploads from overrunning the small volume", async () => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const clientQueries = [];
  pool.query = async (sql) => {
    if (sql.startsWith("SELECT id, status FROM lb_transfers")) return { rows: [] };
    throw new Error("Unexpected pool query: " + sql);
  };
  pool.connect = async () => ({
    async query(sql) {
      clientQueries.push(sql);
      if (sql.includes("SUM(total_bytes)")) return { rows: [{ used: 2 * 1024 * 1024 * 1024 }] };
      return { rows: [] };
    },
    release() {}
  });

  try {
    const routes = new Map();
    const app = {
      get: () => {},
      post: (route, ...handlers) => routes.set("POST " + route, handlers.at(-1)),
      put: () => {},
      delete: () => {}
    };
    registerTransferRoutes(app);
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(value) { this.payload = value; return this; }
    };
    await routes.get("POST /api/transfers")({
      params: {},
      body: { files: [{ name: "small.wav", size: 8 }] },
      user: { id: "user-1" }
    }, response);

    assert.equal(response.statusCode, 413);
    assert.match(response.payload.error, /storage is temporarily full/i);
    assert.equal(clientQueries.some((sql) => sql.includes("pg_advisory_xact_lock")), true);
    assert.equal(clientQueries.includes("ROLLBACK"), true);
    assert.equal(clientQueries.some((sql) => sql.includes("INSERT INTO lb_transfers")), false);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  }
});
