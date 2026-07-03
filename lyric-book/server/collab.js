/**
 * collab.js
 * Real-time collaborative editing for Lyric Book (Layer 2).
 *
 * Attaches a Socket.io server to the existing HTTP server, authenticates
 * connections via JWT, enforces the same row-level security as the REST API
 * (access = owner OR accepted collaborator), and keeps Yjs CRDT documents in
 * sync across clients.
 *
 * Persistence: debounce-saves the merged Yjs state to `lb_lyric_docs` (binary)
 * and mirrors the plaintext to `lb_lyrics.title/body` so the REST layer, sidebar
 * list, and suggestions panel keep working unchanged.
 */
import { Server } from "socket.io";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness.js";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

import { verifyToken } from "./auth.js";
import { getLyricAccess, displayNameForUser } from "./access.js";
import { pool } from "./db.js";

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

const SAVE_DEBOUNCE_MS = 2000;
const ROOM_GC_MS = 30_000;

// lyricId -> Room
const rooms = new Map();

// --------------- Room lifecycle ---------------

class Room {
  constructor(lyricId) {
    this.lyricId = lyricId;
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.sockets = new Map(); // socket.id -> { socket, userId, canEdit, clientId }
    this.saveTimer = null;
    this.gcTimer = null;
    this.loaded = false;
    this.saving = false;

    this._onDocUpdate = (update, origin) => {
      if (this.sockets.size === 0) return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.writeUpdate(enc, update);
      const msg = encoding.toUint8Array(enc);
      const excludeId = origin && typeof origin.id === "string" ? origin.id : null;
      this.broadcast(msg, excludeId);
      this.scheduleSave();
    };

    this._onAwarenessChange = ({ added, updated, removed }, origin) => {
      const changed = added.concat(updated, removed);
      if (!changed.length) return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_AWARENESS);
      encoding.writeVarUint8Array(
        enc,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed)
      );
      const msg = encoding.toUint8Array(enc);
      const excludeId = origin && typeof origin.id === "string" ? origin.id : null;
      this.broadcast(msg, excludeId);
    };

    this.doc.on("update", this._onDocUpdate);
    this.awareness.on("update", this._onAwarenessChange);
  }

  async load() {
    if (this.loaded) return;
    const { rows } = await pool.query(
      "SELECT state FROM lb_lyric_docs WHERE lyric_id = $1",
      [this.lyricId]
    );
    if (rows.length && rows[0].state) {
      Y.applyUpdate(this.doc, rows[0].state);
    } else {
      const { rows: lr } = await pool.query(
        "SELECT title, body FROM lb_lyrics WHERE id = $1",
        [this.lyricId]
      );
      if (lr.length) {
        const title = this.doc.getText("title");
        const body = this.doc.getText("content");
        this.doc.transact(() => {
          if (lr[0].title && !title.length) title.insert(0, lr[0].title);
          if (lr[0].body && !body.length) body.insert(0, lr[0].body);
        });
      }
    }
    this.loaded = true;
  }

  scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
  }

  async flush() {
    if (this.saving) return;
    this.saving = true;
    try {
      const state = Buffer.from(Y.encodeStateAsUpdate(this.doc));
      const title = this.doc.getText("title").toString() || "Untitled";
      const body = this.doc.getText("content").toString();
      await pool.query(
        `INSERT INTO lb_lyric_docs (lyric_id, state, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (lyric_id) DO UPDATE SET state = $2, updated_at = NOW()`,
        [this.lyricId, state]
      );
      await pool.query(
        `UPDATE lb_lyrics SET title = $2, body = $3, updated_at = NOW() WHERE id = $1`,
        [this.lyricId, title, body]
      );
    } catch (err) {
      console.error(`[collab] flush error lyric=${this.lyricId}`, err.message);
    } finally {
      this.saving = false;
    }
  }

  addSocket(socket, userId, canEdit) {
    // clientId comes from the client's "hello" (its real Yjs clientID) so
    // awareness state can be cleaned up on disconnect. It may already be on
    // socket.data if "hello" arrived before this room finished setup.
    const clientId = Number.isFinite(socket.data.clientId) ? socket.data.clientId : null;
    this.sockets.set(socket.id, { socket, userId, canEdit, clientId });
    if (this.gcTimer) {
      clearTimeout(this.gcTimer);
      this.gcTimer = null;
    }
  }

  removeSocket(socket) {
    const entry = this.sockets.get(socket.id);
    if (entry && entry.clientId != null) {
      awarenessProtocol.removeAwarenessStates(this.awareness, [entry.clientId], null);
    }
    this.sockets.delete(socket.id);
    if (this.sockets.size === 0) {
      this.flush();
      this.gcTimer = setTimeout(() => this.destroy(), ROOM_GC_MS);
    }
  }

  broadcast(message, excludeSocketId) {
    const buf = Buffer.from(message);
    for (const [sid, { socket }] of this.sockets) {
      if (sid !== excludeSocketId) {
        socket.emit("y", buf);
      }
    }
  }

  destroy() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.doc.off("update", this._onDocUpdate);
    this.awareness.off("update", this._onAwarenessChange);
    this.awareness.destroy();
    this.doc.destroy();
    rooms.delete(this.lyricId);
  }
}

function getOrCreateRoom(lyricId) {
  let room = rooms.get(lyricId);
  if (!room) {
    room = new Room(lyricId);
    rooms.set(lyricId, room);
  }
  return room;
}

// --------------- Public helpers ---------------

/**
 * Immediately disconnect a user from a lyric's collab room.
 * Called when sharing is revoked so the removed user stops receiving
 * real-time updates the moment access is removed.
 */
export function revokeCollabAccess(lyricId, userId) {
  const room = rooms.get(lyricId);
  if (!room) return;
  for (const [sid, entry] of room.sockets) {
    if (entry.userId === userId) {
      entry.socket.emit("err", { code: "access_revoked" });
      entry.socket.disconnect(true);
      // removeSocket is called by the "disconnect" event handler
    }
  }
}

// --------------- Socket.io init ---------------

export function initCollab(httpServer, isAllowedOrigin) {
  const io = new Server(httpServer, {
    path: "/collab",
    cors: {
      origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
      credentials: true
    },
    transports: ["websocket", "polling"],
    maxHttpBufferSize: 1e6
  });

  // JWT auth middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("auth_required"));
    try {
      const payload = verifyToken(token);
      socket.data.uid = payload.uid;
      socket.data.email = payload.email;
      next();
    } catch {
      return next(new Error("auth_invalid"));
    }
  });

  io.on("connection", async (socket) => {
    // Register the "hello" handler synchronously, before any await — the client
    // emits it on connect and it can arrive before the async access/room setup
    // below finishes. We stash the real Yjs clientID on the socket so awareness
    // (presence) state is cleaned up on disconnect (avoids ghost collaborators).
    socket.on("hello", (d) => {
      if (d && Number.isFinite(d.clientId)) {
        socket.data.clientId = d.clientId;
        const r = rooms.get(Number(socket.handshake.auth.lyricId));
        const entry = r && r.sockets.get(socket.id);
        if (entry) entry.clientId = d.clientId;
      }
    });

    const lyricId = Number(socket.handshake.auth.lyricId);
    if (!lyricId || Number.isNaN(lyricId)) {
      socket.emit("err", { code: "bad_lyric_id" });
      return socket.disconnect(true);
    }

    let access;
    try {
      access = await getLyricAccess(lyricId, socket.data.uid);
    } catch (err) {
      console.error("[collab] access check error", err.message);
      socket.emit("err", { code: "access_error" });
      return socket.disconnect(true);
    }
    if (!access) {
      socket.emit("err", { code: "no_access" });
      return socket.disconnect(true);
    }

    const room = getOrCreateRoom(lyricId);
    try {
      await room.load();
    } catch (err) {
      console.error(`[collab] room load error lyric=${lyricId}`, err.message);
      socket.emit("err", { code: "load_error" });
      return socket.disconnect(true);
    }

    room.addSocket(socket, socket.data.uid, access.canEdit);

    // Send sync step 1 (state vector request)
    {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.writeSyncStep1(enc, room.doc);
      socket.emit("y", Buffer.from(encoding.toUint8Array(enc)));
    }
    // Send sync step 2 (full document state)
    {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.writeSyncStep2(enc, room.doc);
      socket.emit("y", Buffer.from(encoding.toUint8Array(enc)));
    }
    // Send current awareness states
    {
      const clients = Array.from(room.awareness.getStates().keys());
      if (clients.length) {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_AWARENESS);
        encoding.writeVarUint8Array(
          enc,
          awarenessProtocol.encodeAwarenessUpdate(room.awareness, clients)
        );
        socket.emit("y", Buffer.from(encoding.toUint8Array(enc)));
      }
    }

    // Send role / user metadata
    const userInfo = await displayNameForUser(socket.data.uid, socket.data.email);
    socket.emit("meta", {
      role: access.role,
      canEdit: access.canEdit,
      user: { name: userInfo.name, avatarUrl: userInfo.avatarUrl }
    });

    // ---------- Incoming messages ----------
    socket.on("y", (data) => {
      try {
        const buf = new Uint8Array(data);
        const decoder = decoding.createDecoder(buf);
        const msgType = decoding.readVarUint(decoder);

        if (msgType === MSG_SYNC) {
          // Peek at sync message type to block viewer updates
          const peekDec = decoding.createDecoder(buf);
          decoding.readVarUint(peekDec); // skip MSG_SYNC
          const syncType = decoding.readVarUint(peekDec);
          if (syncType === 2 && !access.canEdit) return; // viewer tried to push an update

          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, MSG_SYNC);
          syncProtocol.readSyncMessage(decoder, enc, room.doc, socket);
          if (encoding.length(enc) > 1) {
            socket.emit("y", Buffer.from(encoding.toUint8Array(enc)));
          }
        } else if (msgType === MSG_AWARENESS) {
          const update = decoding.readVarUint8Array(decoder);
          awarenessProtocol.applyAwarenessUpdate(room.awareness, update, socket);
        }
      } catch (err) {
        console.error("[collab] message error", err.message);
      }
    });

    socket.on("disconnect", () => {
      room.removeSocket(socket);
    });
  });

  return io;
}
