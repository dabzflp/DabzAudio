(function () {
  // Capture a collaboration invite token from the URL before any auth redirect,
  // so it survives a trip through the login page.
  (function captureInvite() {
    const p = new URLSearchParams(location.search);
    const token = p.get("invite");
    if (token) {
      localStorage.setItem("lb_pending_invite", token);
      history.replaceState(null, "", location.pathname);
    }
  })();

  if (!window.LB.isAuthed()) {
    location.replace("login.html");
    return;
  }

  const els = {
    who: document.getElementById("who"),
    logoutBtn: document.getElementById("logoutBtn"),
    avatarBtn: document.getElementById("avatarBtn"),
    avatarImg: document.getElementById("avatarImg"),
    avatarInput: document.getElementById("avatarInput"),
    newBtn: document.getElementById("newBtn"),
    list: document.getElementById("lyricList"),
    title: document.getElementById("titleInput"),
    body: document.getElementById("bodyInput"),
    saveState: document.getElementById("saveState"),
    deleteBtn: document.getElementById("deleteBtn"),
    shareBtn: document.getElementById("shareBtn"),
    rolePill: document.getElementById("rolePill"),
    presence: document.getElementById("presence"),
    rhymeWord: document.getElementById("rhymeWord"),
    rhymeBtn: document.getElementById("rhymeBtn"),
    lastWordBtn: document.getElementById("lastWordBtn"),
    rhymeResults: document.getElementById("rhymeResults"),
    rhymeChips: document.getElementById("rhymeChips"),
    nearChips: document.getElementById("nearChips"),
    rhythmBox: document.getElementById("rhythmBox"),
    // collaboration
    invitesBtn: document.getElementById("invitesBtn"),
    invitesCount: document.getElementById("invitesCount"),
    shareModal: document.getElementById("shareModal"),
    shareClose: document.getElementById("shareClose"),
    shareForm: document.getElementById("shareForm"),
    shareEmail: document.getElementById("shareEmail"),
    shareRole: document.getElementById("shareRole"),
    shareMsg: document.getElementById("shareMsg"),
    collabList: document.getElementById("collabList"),
    invitesModal: document.getElementById("invitesModal"),
    invitesClose: document.getElementById("invitesClose"),
    inviteList: document.getElementById("inviteList")
  };

  let lyrics = [];
  let currentId = null;
  let saveTimer = null;
  let dirty = false;
  let canEdit = true; // access level for the currently open lyric

  // Real-time collaboration (Layer 2). The collab module may load slightly after
  // this script (it pulls in a bundled Yjs/Socket.io vendor module), so we queue
  // the lyric to connect and open it once the module signals readiness.
  let collabPendingId = null;
  function collabReady() {
    return !!window.LBCollab;
  }
  window.addEventListener("lbcollab-ready", () => {
    if (collabPendingId != null) openCollab(collabPendingId);
  });

  init();

  async function init() {
    try {
      const me = await window.LB.apiFetch("/api/auth/me");
      const name = (me.profile && (me.profile.artistName || me.profile.displayName)) || me.user.email;
      els.who.textContent = name;
      renderAvatar(me.profile && me.profile.avatarUrl, name);
    } catch {
      window.LB.clearToken();
      location.replace("login.html");
      return;
    }
    await acceptPendingInvite();
    await loadList();
    if (lyrics.length) selectLyric(lyrics[0].id);
    else setEditorEnabled(false);
    wire();
    loadInvites();
  }

  // If the user arrived from an emailed accept link, accept it now.
  async function acceptPendingInvite() {
    const token = localStorage.getItem("lb_pending_invite");
    if (!token) return;
    localStorage.removeItem("lb_pending_invite");
    try {
      await window.LB.apiFetch("/api/lyrics/share/accept", {
        method: "POST",
        body: JSON.stringify({ token })
      });
    } catch (err) {
      alert(err.message || "That invite link is no longer valid.");
    }
  }

  function wire() {
    els.logoutBtn.addEventListener("click", logout);
    els.avatarBtn.addEventListener("click", () => els.avatarInput.click());
    els.avatarInput.addEventListener("change", onAvatarPicked);
    els.newBtn.addEventListener("click", newLyric);
    els.deleteBtn.addEventListener("click", deleteCurrent);
    els.title.addEventListener("input", onEdit);
    els.body.addEventListener("input", function () {
      onEdit();
      renderRhythm();
    });
    els.rhymeBtn.addEventListener("click", () => runRhymes(els.rhymeWord.value));
    els.rhymeWord.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runRhymes(els.rhymeWord.value);
      }
    });
    els.lastWordBtn.addEventListener("click", () => {
      const w = window.LBSuggest.lastWord(els.body.value);
      if (w) {
        els.rhymeWord.value = w;
        runRhymes(w);
      }
    });
    window.addEventListener("beforeunload", flushSave);

    // Collaboration
    els.shareBtn.addEventListener("click", openShare);
    els.shareClose.addEventListener("click", () => closeModal(els.shareModal));
    els.shareForm.addEventListener("submit", sendInvite);
    els.invitesBtn.addEventListener("click", openInvites);
    els.invitesClose.addEventListener("click", () => closeModal(els.invitesModal));
    [els.shareModal, els.invitesModal].forEach((m) => {
      m.addEventListener("click", (e) => {
        if (e.target === m) closeModal(m);
      });
    });
  }

  async function loadList() {
    const data = await window.LB.apiFetch("/api/lyrics");
    lyrics = data.lyrics || [];
    renderList();
  }

  function renderList() {
    els.list.innerHTML = "";
    if (!lyrics.length) {
      const li = document.createElement("li");
      li.className = "empty-note";
      li.textContent = "No lyrics yet. Click “New lyric” to start.";
      els.list.appendChild(li);
      return;
    }
    lyrics.forEach((ly) => {
      const li = document.createElement("li");
      li.className = "lyric-item" + (ly.id === currentId ? " active" : "");
      li.dataset.id = ly.id;
      const t = document.createElement("div");
      t.className = "t";
      t.textContent = ly.title || "Untitled";
      if (ly.owned === false) {
        const b = document.createElement("span");
        b.className = "badge";
        b.textContent = ly.role === "viewer" ? "View" : "Shared";
        t.appendChild(b);
      } else if (Number(ly.collaborator_count) > 0) {
        const b = document.createElement("span");
        b.className = "badge muted";
        b.textContent = ly.collaborator_count + " shared";
        t.appendChild(b);
      }
      const d = document.createElement("div");
      d.className = "d";
      d.textContent = "Updated " + formatDate(ly.updated_at);
      li.appendChild(t);
      li.appendChild(d);
      li.addEventListener("click", () => selectLyric(ly.id));
      els.list.appendChild(li);
    });
  }

  async function selectLyric(id) {
    if (id === currentId) return;
    flushSave();
    closeCollab();
    try {
      const data = await window.LB.apiFetch("/api/lyrics/" + id);
      currentId = id;
      els.title.value = data.lyric.title || "";
      els.body.value = data.lyric.body || "";
      applyAccess(data.role || "owner", data.canEdit !== false);
      setEditorEnabled(true);
      setSaveState("Saved");
      renderRhythm();
      renderList();
      openCollab(id);
    } catch (err) {
      setSaveState(err.message || "Could not open");
    }
  }

  // Adapt the editor UI to the user's access level for the open lyric.
  function applyAccess(role, editable) {
    canEdit = editable;
    const isOwner = role === "owner";
    els.shareBtn.hidden = !isOwner;
    els.deleteBtn.hidden = !isOwner;
    els.title.readOnly = !editable;
    els.body.readOnly = !editable;
    if (isOwner) {
      els.rolePill.hidden = true;
    } else {
      els.rolePill.hidden = false;
      els.rolePill.textContent = editable ? "Shared • can edit" : "View only";
      els.rolePill.classList.toggle("view", !editable);
    }
  }

  async function newLyric() {
    flushSave();
    try {
      const data = await window.LB.apiFetch("/api/lyrics", {
        method: "POST",
        body: JSON.stringify({ title: "Untitled", body: "" })
      });
      lyrics.unshift({
        id: data.lyric.id,
        title: data.lyric.title,
        updated_at: data.lyric.updated_at,
        created_at: data.lyric.created_at,
        owned: true,
        role: "owner",
        collaborator_count: 0
      });
      currentId = data.lyric.id;
      renderList();
      els.title.value = data.lyric.title;
      els.body.value = "";
      applyAccess("owner", true);
      setEditorEnabled(true);
      setSaveState("Saved");
      renderRhythm();
      closeCollab();
      openCollab(currentId);
      els.title.focus();
      els.title.select();
    } catch (err) {
      setSaveState(err.message || "Could not create");
    }
  }

  async function deleteCurrent() {
    if (!currentId) return;
    const ly = lyrics.find((l) => l.id === currentId);
    const name = (ly && ly.title) || "this lyric";
    if (!confirm(`Delete “${name}”? This cannot be undone.`)) return;
    const id = currentId;
    try {
      await window.LB.apiFetch("/api/lyrics/" + id, { method: "DELETE" });
      closeCollab();
      lyrics = lyrics.filter((l) => l.id !== id);
      currentId = null;
      if (lyrics.length) selectLyric(lyrics[0].id);
      else {
        els.title.value = "";
        els.body.value = "";
        setEditorEnabled(false);
        renderRhythm();
      }
      renderList();
    } catch (err) {
      setSaveState(err.message || "Could not delete");
    }
  }

  function onEdit() {
    // When the realtime session is live it owns syncing + persistence, so we
    // skip the REST autosave to avoid double-writes. Otherwise fall back to it.
    if (collabActive()) return;
    dirty = true;
    setSaveState("Saving…");
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 700);
  }

  async function save() {
    if (!currentId || !dirty) return;
    const title = els.title.value.trim() || "Untitled";
    const body = els.body.value;
    dirty = false;
    try {
      const data = await window.LB.apiFetch("/api/lyrics/" + currentId, {
        method: "PUT",
        body: JSON.stringify({ title, body })
      });
      const ly = lyrics.find((l) => l.id === currentId);
      if (ly) {
        ly.title = data.lyric.title;
        ly.updated_at = data.lyric.updated_at;
      }
      // Move edited lyric to top, keep selection.
      lyrics.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
      renderList();
      setSaveState("Saved");
    } catch (err) {
      dirty = true;
      setSaveState(err.message || "Save failed");
    }
  }

  function flushSave() {
    if (saveTimer) clearTimeout(saveTimer);
    if (dirty) save();
  }

  /* ---------- Real-time collaboration (Layer 2) ---------- */
  function collabActive() {
    return !!(window.LBCollab && window.LBCollab.isActive());
  }

  function openCollab(lyricId) {
    collabPendingId = null;
    if (!collabReady()) {
      // Module not loaded yet — remember which lyric to connect once it is.
      collabPendingId = lyricId;
      return;
    }
    const apiBase = (window.LB_API_BASE || "").replace(/\/$/, "");
    window.LBCollab.open({
      lyricId,
      token: window.LB.getToken(),
      apiBase,
      titleInput: els.title,
      bodyInput: els.body,
      onStatus: onCollabStatus,
      onPresence: renderPresence,
      onRemoteText: () => renderRhythm()
    });
  }

  function closeCollab() {
    collabPendingId = null;
    if (window.LBCollab) window.LBCollab.close();
    renderPresence([]);
  }

  function onCollabStatus(status) {
    if (status === "synced") setSaveState("Live");
    else if (status === "offline" || status === "reconnecting") setSaveState("Offline — reconnecting…");
    else if (status === "error") setSaveState("Saved"); // silently fall back to REST autosave
  }

  function renderPresence(users) {
    if (!els.presence) return;
    els.presence.innerHTML = "";
    // De-duplicate by name (a user may have multiple tabs).
    const seen = new Set();
    users.forEach((u) => {
      const info = u.user || {};
      const key = info.name || u.clientId;
      if (seen.has(key)) return;
      seen.add(key);
      const dot = document.createElement("span");
      dot.className = "presence-av";
      dot.title = (info.name || "Collaborator") + " · editing now";
      dot.style.background = colorFor(key);
      if (info.avatarUrl) {
        dot.style.backgroundImage = `url("${info.avatarUrl}")`;
        dot.textContent = "";
      } else {
        dot.textContent = initials(info.name);
      }
      els.presence.appendChild(dot);
    });
  }

  function colorFor(key) {
    const palette = ["#ff7a18", "#2d9cdb", "#27ae60", "#9b51e0", "#eb5757", "#f2c94c", "#56ccf2"];
    let h = 0;
    const s = String(key);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return palette[h % palette.length];
  }

  function setEditorEnabled(on) {
    els.title.disabled = !on;
    els.body.disabled = !on;
    els.deleteBtn.disabled = !on;
    if (!on) {
      setSaveState("");
      els.shareBtn.hidden = true;
      els.deleteBtn.hidden = true;
      els.rolePill.hidden = true;
    }
  }

  function setSaveState(text) {
    els.saveState.textContent = text;
  }

  async function logout() {
    flushSave();
    closeCollab();
    try {
      await window.LB.apiFetch("/api/auth/logout", { method: "POST" });
    } catch {}
    window.LB.clearToken();
    location.replace("login.html");
  }

  /* ---------- Profile picture ---------- */
  function renderAvatar(url, name) {
    if (url) {
      // bust cache so a freshly-replaced photo shows immediately
      els.avatarBtn.style.backgroundImage = `url("${url}?t=${Date.now()}")`;
      els.avatarImg.textContent = "";
    } else {
      els.avatarBtn.style.backgroundImage = "";
      els.avatarImg.textContent = initials(name);
    }
  }

  function initials(name) {
    const s = String(name || "").trim();
    if (!s) return "DA";
    const parts = s.split(/\s+/);
    const a = parts[0][0] || "";
    const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (a + b).toUpperCase() || s.slice(0, 2).toUpperCase();
  }

  function onAvatarPicked(e) {
    const file = e.target.files && e.target.files[0];
    els.avatarInput.value = "";
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      alert("Please choose a PNG, JPG, or WebP image.");
      return;
    }
    // Downscale to a small square in the browser before upload so large
    // photos never exceed the request size limit.
    downscaleImage(file, 512)
      .then(uploadAvatar)
      .catch(() => alert("Sorry, that image could not be read. Try another one."));
  }

  function downscaleImage(file, max) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.85));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function uploadAvatar(dataUrl) {
    els.avatarBtn.classList.add("uploading");
    try {
      const data = await window.LB.apiFetch("/api/profile/avatar", {
        method: "POST",
        body: JSON.stringify({ imageBase64: dataUrl })
      });
      const name = (data.profile && (data.profile.artistName || data.profile.displayName)) || els.who.textContent;
      renderAvatar(data.profile && data.profile.avatarUrl, name);
    } catch (err) {
      alert(err.message || "Could not upload image.");
      renderAvatar(null, els.who.textContent);
    } finally {
      els.avatarBtn.classList.remove("uploading");
    }
  }

  /* ---------- Suggestions ---------- */
  async function runRhymes(word) {
    word = String(word || "").trim();
    if (!word) return;
    els.rhymeResults.style.display = "block";
    els.rhymeChips.innerHTML = "<span class='empty-note' style='padding:4px'>Searching…</span>";
    els.nearChips.innerHTML = "";
    const { rhymes, near } = await window.LBSuggest.fetchRhymes(word);
    renderChips(els.rhymeChips, rhymes, "No rhymes found.");
    renderChips(els.nearChips, near, "No near rhymes found.");
  }

  function renderChips(container, items, emptyText) {
    container.innerHTML = "";
    if (!items.length) {
      container.innerHTML = `<span class='empty-note' style='padding:4px'>${emptyText}</span>`;
      return;
    }
    items.forEach((it) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.innerHTML = `${it.word}<span class="syl">${it.syllables}</span>`;
      chip.title = "Insert “" + it.word + "”";
      chip.addEventListener("click", () => insertWord(it.word));
      container.appendChild(chip);
    });
  }

  function insertWord(word) {
    if (els.body.disabled || els.body.readOnly || !canEdit) return;
    const start = els.body.selectionStart;
    const end = els.body.selectionEnd;
    const val = els.body.value;
    const before = val.slice(0, start);
    const needsSpace = before.length && !/\s$/.test(before);
    const insert = (needsSpace ? " " : "") + word;
    els.body.value = before + insert + val.slice(end);
    const pos = start + insert.length;
    els.body.focus();
    els.body.setSelectionRange(pos, pos);
    // Dispatch a real input event so both the REST autosave path and the
    // realtime (Yjs) binding pick up this programmatic change uniformly.
    els.body.dispatchEvent(new Event("input"));
  }

  function renderRhythm() {
    const text = els.body.value || "";
    const lines = text.split("\n");
    const rows = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      rows.push({ line: line.trim(), n: window.LBSuggest.countLineSyllables(line) });
    }
    if (!rows.length) {
      els.rhythmBox.innerHTML = "<div class='empty-note' style='padding:6px'>Start typing to see your line rhythm.</div>";
      return;
    }
    const shown = rows.slice(-14);
    els.rhythmBox.innerHTML = "";
    shown.forEach((r) => {
      const div = document.createElement("div");
      div.className = "rhythm-line";
      const s = document.createElement("span");
      s.textContent = r.line;
      const b = document.createElement("b");
      b.textContent = r.n + (r.n === 1 ? " syl" : " syl");
      div.appendChild(s);
      div.appendChild(b);
      els.rhythmBox.appendChild(div);
    });
  }

  /* ---------- Collaboration ---------- */
  function closeModal(m) {
    m.hidden = true;
  }

  function openShare() {
    if (!currentId) return;
    els.shareMsg.textContent = "";
    els.shareMsg.className = "msg";
    els.shareEmail.value = "";
    els.shareRole.value = "editor";
    els.shareModal.hidden = false;
    els.shareEmail.focus();
    loadCollaborators();
  }

  async function loadCollaborators() {
    els.collabList.innerHTML = "";
    try {
      const data = await window.LB.apiFetch("/api/lyrics/" + currentId + "/collaborators");
      renderCollaborators(data.collaborators || []);
    } catch (err) {
      els.collabList.innerHTML = `<li class="empty-note" style="padding:8px">${err.message || "Could not load."}</li>`;
    }
  }

  function renderCollaborators(rows) {
    els.collabList.innerHTML = "";
    rows.forEach((c) => {
      const li = document.createElement("li");
      li.className = "collab-row";

      const av = document.createElement("div");
      av.className = "collab-av";
      if (c.avatarUrl) av.style.backgroundImage = `url("${c.avatarUrl}")`;
      else av.textContent = initials(c.name);

      const meta = document.createElement("div");
      meta.className = "collab-meta";
      const n = document.createElement("div");
      n.className = "n";
      n.textContent = c.name;
      const e = document.createElement("div");
      e.className = "e";
      e.textContent = c.email + " · " + (c.role === "viewer" ? "can view" : "can edit");
      meta.appendChild(n);
      meta.appendChild(e);

      const tag = document.createElement("span");
      tag.className = "collab-tag" + (c.status === "pending" ? " pending" : "");
      tag.textContent = c.status === "pending" ? "Pending" : "Accepted";

      const rm = document.createElement("button");
      rm.className = "link-btn";
      rm.type = "button";
      rm.textContent = "Remove";
      rm.addEventListener("click", () => removeCollaborator(c.id, c.name));

      li.appendChild(av);
      li.appendChild(meta);
      li.appendChild(tag);
      li.appendChild(rm);
      els.collabList.appendChild(li);
    });
  }

  async function sendInvite(e) {
    e.preventDefault();
    const email = els.shareEmail.value.trim();
    const role = els.shareRole.value;
    if (!email) return;
    els.shareMsg.className = "msg";
    els.shareMsg.textContent = "Sending…";
    try {
      const data = await window.LB.apiFetch("/api/lyrics/" + currentId + "/share", {
        method: "POST",
        body: JSON.stringify({ email, role })
      });
      els.shareMsg.className = "msg ok";
      els.shareMsg.textContent = data.message || "Invite sent.";
      els.shareEmail.value = "";
      loadCollaborators();
      // reflect "shared" badge on the owner's list item
      const ly = lyrics.find((l) => l.id === currentId);
      if (ly) ly.collaborator_count = Number(ly.collaborator_count || 0) + 1;
      renderList();
    } catch (err) {
      els.shareMsg.className = "msg err";
      els.shareMsg.textContent = err.message || "Could not send invite.";
    }
  }

  async function removeCollaborator(collabId, name) {
    if (!confirm(`Remove ${name}'s access to this lyric?`)) return;
    try {
      await window.LB.apiFetch("/api/lyrics/" + currentId + "/share/" + collabId, {
        method: "DELETE"
      });
      loadCollaborators();
      const ly = lyrics.find((l) => l.id === currentId);
      if (ly) ly.collaborator_count = Math.max(0, Number(ly.collaborator_count || 1) - 1);
      renderList();
    } catch (err) {
      els.shareMsg.className = "msg err";
      els.shareMsg.textContent = err.message || "Could not remove.";
    }
  }

  function openInvites() {
    els.invitesModal.hidden = false;
    loadInvites();
  }

  async function loadInvites() {
    let invites = [];
    try {
      const data = await window.LB.apiFetch("/api/invites");
      invites = data.invites || [];
    } catch {
      invites = [];
    }
    els.invitesCount.textContent = invites.length;
    els.invitesBtn.hidden = invites.length === 0;
    if (!els.invitesModal.hidden) renderInvites(invites);
  }

  function renderInvites(invites) {
    els.inviteList.innerHTML = "";
    invites.forEach((inv) => {
      const li = document.createElement("li");
      li.className = "invite-row";
      const meta = document.createElement("div");
      meta.className = "collab-meta";
      const n = document.createElement("div");
      n.className = "n";
      n.textContent = inv.title;
      const e = document.createElement("div");
      e.className = "e";
      e.textContent = `${inv.inviter} · ${inv.role === "viewer" ? "view only" : "can edit"}`;
      meta.appendChild(n);
      meta.appendChild(e);

      const actions = document.createElement("div");
      actions.className = "invite-actions";
      const acc = document.createElement("button");
      acc.className = "btn small";
      acc.type = "button";
      acc.textContent = "Accept";
      acc.addEventListener("click", () => acceptInvite(inv.id));
      const dec = document.createElement("button");
      dec.className = "btn subtle small";
      dec.type = "button";
      dec.textContent = "Decline";
      dec.addEventListener("click", () => declineInvite(inv.id));
      actions.appendChild(acc);
      actions.appendChild(dec);

      li.appendChild(meta);
      li.appendChild(actions);
      els.inviteList.appendChild(li);
    });
  }

  async function acceptInvite(id) {
    try {
      const data = await window.LB.apiFetch("/api/invites/" + id + "/accept", { method: "POST" });
      closeModal(els.invitesModal);
      await loadList();
      loadInvites();
      if (data.lyricId) selectLyric(data.lyricId);
    } catch (err) {
      alert(err.message || "Could not accept invite.");
    }
  }

  async function declineInvite(id) {
    try {
      await window.LB.apiFetch("/api/invites/" + id + "/decline", { method: "POST" });
      loadInvites();
    } catch (err) {
      alert(err.message || "Could not decline invite.");
    }
  }

  function formatDate(iso) {
    try {
      const d = new Date(iso);
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return d.toLocaleDateString([], { month: "short", day: "numeric" });
    } catch {
      return "";
    }
  }
})();
