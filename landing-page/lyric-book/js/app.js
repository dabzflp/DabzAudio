(function () {
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
    rhymeWord: document.getElementById("rhymeWord"),
    rhymeBtn: document.getElementById("rhymeBtn"),
    lastWordBtn: document.getElementById("lastWordBtn"),
    rhymeResults: document.getElementById("rhymeResults"),
    rhymeChips: document.getElementById("rhymeChips"),
    nearChips: document.getElementById("nearChips"),
    rhythmBox: document.getElementById("rhythmBox")
  };

  let lyrics = [];
  let currentId = null;
  let saveTimer = null;
  let dirty = false;

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
    await loadList();
    if (lyrics.length) selectLyric(lyrics[0].id);
    else setEditorEnabled(false);
    wire();
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
    try {
      const data = await window.LB.apiFetch("/api/lyrics/" + id);
      currentId = id;
      els.title.value = data.lyric.title || "";
      els.body.value = data.lyric.body || "";
      setEditorEnabled(true);
      setSaveState("Saved");
      renderRhythm();
      renderList();
    } catch (err) {
      setSaveState(err.message || "Could not open");
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
        created_at: data.lyric.created_at
      });
      currentId = data.lyric.id;
      renderList();
      els.title.value = data.lyric.title;
      els.body.value = "";
      setEditorEnabled(true);
      setSaveState("Saved");
      renderRhythm();
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

  function setEditorEnabled(on) {
    els.title.disabled = !on;
    els.body.disabled = !on;
    els.deleteBtn.disabled = !on;
    if (!on) setSaveState("");
  }

  function setSaveState(text) {
    els.saveState.textContent = text;
  }

  async function logout() {
    flushSave();
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
    if (els.body.disabled) return;
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
    onEdit();
    renderRhythm();
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
