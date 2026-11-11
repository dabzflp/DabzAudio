import assert from "node:assert/strict";
import test from "node:test";

process.env.RESEND_API_KEY = "";
const { pool } = await import("../db.js");
const { registerTransferRoutes } = await import("../transfers.js");

test("upload completion defers email and the separate send action leaves failures retryable", async () => {
  const transfer = {
    id: "transfer-1",
    user_id: "user-1",
    token: "share-token",
    message: "",
    total_bytes: 12,
    status: "uploading",
    expires_at: new Date(Date.now() + 7 * 86400000),
    created_at: new Date(),
    download_count: 0
  };
  const file = { id: 2, transfer_id: transfer.id, name: "stems.wav", size: 12, completed: true };
  const recipient = { id: 3, transfer_id: transfer.id, email: "creative@example.com", notified_at: null };
  const queries = [];
  const originalQuery = pool.query;
  pool.query = async (sql) => {
    queries.push(sql);
    if (sql.startsWith("SELECT id FROM lb_transfers")) return { rows: [] };
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
