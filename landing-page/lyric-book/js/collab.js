/**
 * collab.js (frontend) — Real-time collaborative editing client (Layer 2).
 *
 * Loaded as an ES module. Imports Yjs + y-protocols + socket.io-client from a
 * locally-bundled vendor module (js/vendor/collab-deps.js — no CDN at runtime),
 * binds a lyric's title/body inputs to a shared Yjs document, and exposes a small
 * imperative API on `window.LBCollab` that the main app (js/app.js) calls when a
 * lyric is opened/closed.
 *
 * Falls back silently: if the realtime connection can't be established, the app
 * keeps using its REST autosave path, so editing always works.
 */
import {
  io,
  Y,
  syncProtocol,
  awarenessProtocol,
  encoding,
  decoding
} from "./vendor/collab-deps.js";

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

let session = null; // current open session

function close() {
  if (!session) return;
  const s = session;
  session = null;
  try {
    if (s.yTitle) s.yTitle.unobserve(s.onYTitle);
    if (s.yContent) s.yContent.unobserve(s.onYContent);
    if (s.titleEl) s.titleEl.removeEventListener("input", s.onTitleInput);
    if (s.bodyEl) {
      s.bodyEl.removeEventListener("input", s.onBodyInput);
      s.bodyEl.removeEventListener("keyup", s.onCursor);
      s.bodyEl.removeEventListener("click", s.onCursor);
      s.bodyEl.removeEventListener("scroll", s.onScroll);
    }
    if (s.awareness) {
      s.awareness.off("change", s.onAwareness);
      awarenessProtocol.removeAwarenessStates(s.awareness, [s.doc.clientID], "close");
    }
    if (s.socket) s.socket.disconnect();
    if (s.doc) s.doc.destroy();
  } catch (err) {
    console.warn("[collab] close error", err);
  }
}

function open(options) {
  // options: { lyricId, token, apiBase, titleInput, bodyInput,
  //            onStatus, onMeta, onPresence, onRemoteText }
  close();

  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  const yTitle = doc.getText("title");
  const yContent = doc.getText("content");

  const s = {
    opts: options,
    doc,
    awareness,
    yTitle,
    yContent,
    titleEl: options.titleInput,
    bodyEl: options.bodyInput,
    socket: null,
    canEdit: true,
    synced: false,
    suppress: false, // guards programmatic value sets from re-triggering input
    prevTitle: "",
    prevBody: ""
  };
  session = s;

  const socket = io(options.apiBase, {
    path: "/collab",
    auth: { token: options.token, lyricId: options.lyricId },
    transports: ["websocket", "polling"],
    withCredentials: true,
    reconnection: true,
    reconnectionAttempts: 10
  });
  s.socket = socket;

  // ---- Diff a string change into Yjs ops ----
  function applyDiff(ytext, oldVal, newVal) {
    if (oldVal === newVal) return;
    let start = 0;
    const minLen = Math.min(oldVal.length, newVal.length);
    while (start < minLen && oldVal[start] === newVal[start]) start++;
    let endOld = oldVal.length;
    let endNew = newVal.length;
    while (endOld > start && endNew > start && oldVal[endOld - 1] === newVal[endNew - 1]) {
      endOld--;
      endNew--;
    }
    doc.transact(() => {
      if (endOld > start) ytext.delete(start, endOld - start);
      if (endNew > start) ytext.insert(start, newVal.slice(start, endNew));
    }, "local");
  }

  // ---- Adjust a caret index given a Yjs delta ----
  function adjustCaret(pos, delta) {
    let idx = 0;
    for (const op of delta) {
      if (op.retain != null) {
        idx += op.retain;
      } else if (op.insert != null) {
        const len = typeof op.insert === "string" ? op.insert.length : 1;
        if (idx <= pos) pos += len;
        idx += len;
      } else if (op.delete != null) {
        if (idx < pos) pos -= Math.min(op.delete, pos - idx);
      }
    }
    return Math.max(0, pos);
  }

  // ---- Local input -> Yjs ----
  s.onTitleInput = () => {
    if (s.suppress || !s.canEdit) return;
    const cur = s.titleEl.value;
    applyDiff(yTitle, s.prevTitle, cur);
    s.prevTitle = cur;
  };
  s.onBodyInput = () => {
    if (s.suppress || !s.canEdit) return;
    const cur = s.bodyEl.value;
    applyDiff(yContent, s.prevBody, cur);
    s.prevBody = cur;
  };

  // ---- Yjs -> local input (remote changes) ----
  s.onYTitle = (event) => {
    if (event.transaction.origin === "local") return;
    s.suppress = true;
    const newVal = yTitle.toString();
    const pos = adjustCaret(s.titleEl.selectionStart || 0, event.changes.delta);
    s.titleEl.value = newVal;
    try { s.titleEl.setSelectionRange(pos, pos); } catch {}
    s.prevTitle = newVal;
    s.suppress = false;
  };
  s.onYContent = (event) => {
    if (event.transaction.origin === "local") return;
    s.suppress = true;
    const newVal = yContent.toString();
    const start = adjustCaret(s.bodyEl.selectionStart || 0, event.changes.delta);
    const end = adjustCaret(s.bodyEl.selectionEnd || 0, event.changes.delta);
    s.bodyEl.value = newVal;
    try { s.bodyEl.setSelectionRange(start, end); } catch {}
    s.prevBody = newVal;
    s.suppress = false;
    if (options.onRemoteText) options.onRemoteText(newVal);
  };
  yTitle.observe(s.onYTitle);
  yContent.observe(s.onYContent);

  s.titleEl.addEventListener("input", s.onTitleInput);
  s.bodyEl.addEventListener("input", s.onBodyInput);

  // ---- Local cursor presence ----
  s.onCursor = () => {
    if (!s.synced) return;
    awareness.setLocalStateField("cursor", {
      anchor: s.bodyEl.selectionStart,
      head: s.bodyEl.selectionEnd
    });
  };
  s.bodyEl.addEventListener("keyup", s.onCursor);
  s.bodyEl.addEventListener("click", s.onCursor);

  s.onScroll = () => {
    if (options.onScroll) options.onScroll();
  };
  s.bodyEl.addEventListener("scroll", s.onScroll);

  // ---- Outgoing doc updates ----
  doc.on("update", (update, origin) => {
    // Only forward updates that did NOT come from the socket (i.e. local edits).
    if (origin === socket) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeUpdate(enc, update);
    socket.emit("y", encoding.toUint8Array(enc));
  });

  // ---- Outgoing awareness updates ----
  awareness.on("update", ({ added, updated, removed }) => {
    const changed = added.concat(updated, removed);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_AWARENESS);
    encoding.writeVarUint8Array(
      enc,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changed)
    );
    socket.emit("y", encoding.toUint8Array(enc));
  });

  s.onAwareness = () => {
    if (!options.onPresence) return;
    const users = [];
    awareness.getStates().forEach((state, clientId) => {
      if (clientId === doc.clientID) return;
      if (state.user) users.push({ clientId, user: state.user, cursor: state.cursor || null });
    });
    options.onPresence(users);
  };
  awareness.on("change", s.onAwareness);

  // ---- Socket events ----
  socket.on("connect", () => {
    // Report our real Yjs clientID so the server can clean up our presence
    // state when this socket disconnects.
    socket.emit("hello", { clientId: doc.clientID });
    if (options.onStatus) options.onStatus("connected");
  });
  socket.io.on("reconnect_attempt", () => options.onStatus && options.onStatus("reconnecting"));
  socket.on("disconnect", () => {
    s.synced = false;
    options.onStatus && options.onStatus("offline");
  });
  socket.on("connect_error", (err) => {
    options.onStatus && options.onStatus("error", err.message);
  });
  socket.on("err", (d) => {
    options.onStatus && options.onStatus("error", d && d.code);
  });

  socket.on("meta", (meta) => {
    s.canEdit = !!meta.canEdit;
    awareness.setLocalStateField("user", meta.user);
    if (options.onMeta) options.onMeta(meta);
  });

  socket.on("y", (data) => {
    try {
      const buf = new Uint8Array(data);
      const decoder = decoding.createDecoder(buf);
      const msgType = decoding.readVarUint(decoder);
      if (msgType === MSG_SYNC) {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_SYNC);
        syncProtocol.readSyncMessage(decoder, enc, doc, socket);
        if (encoding.length(enc) > 1) socket.emit("y", encoding.toUint8Array(enc));
        if (!s.synced) {
          s.synced = true;
          s.suppress = true;
          s.titleEl.value = yTitle.toString();
          s.bodyEl.value = yContent.toString();
          s.prevTitle = s.titleEl.value;
          s.prevBody = s.bodyEl.value;
          s.suppress = false;
          options.onStatus && options.onStatus("synced");
          if (options.onRemoteText) options.onRemoteText(s.bodyEl.value);
        }
      } else if (msgType === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(
          awareness,
          decoding.readVarUint8Array(decoder),
          socket
        );
      }
    } catch (err) {
      console.warn("[collab] msg error", err);
    }
  });

  return s;
}

function isActive() {
  return !!(session && session.socket && session.socket.connected && session.synced);
}

function getPresence() {
  if (!session) return [];
  const users = [];
  session.awareness.getStates().forEach((state, clientId) => {
    if (clientId === session.doc.clientID) return;
    if (state.user) users.push({ clientId, user: state.user, cursor: state.cursor || null });
  });
  return users;
}

window.LBCollab = { open, close, isActive, getPresence };
window.dispatchEvent(new Event("lbcollab-ready"));
