(function () {
  const pageMsg = document.getElementById("pageMsg");
  const list = document.getElementById("releaseList");
  const createPanel = document.getElementById("createPanel");
  const releaseTemplate = document.getElementById("releaseTemplate");
  let releases = [];

  function setMessage(text, error = false) {
    pageMsg.textContent = text || "";
    pageMsg.className = "msg" + (error ? " err" : " ok");
  }

  function upload(path, formData, method = "POST", onProgress) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      const startedAt = Date.now();
      request.open(method, (window.LB_API_BASE || "").replace(/\/$/, "") + path);
      request.withCredentials = true;
      const token = window.LB.getToken();
      if (token) request.setRequestHeader("Authorization", "Bearer " + token);
      request.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable || typeof onProgress !== "function") return;
        const elapsed = (Date.now() - startedAt) / 1000;
        const rate = event.loaded / Math.max(elapsed, 0.1);
        const remaining = rate ? Math.max(0, (event.total - event.loaded) / rate) : 0;
        onProgress({ percent: Math.round((event.loaded / event.total) * 100), remaining });
      });
      request.addEventListener("error", () => reject(new Error("Network error. Check your connection and try again.")));
      request.addEventListener("timeout", () => reject(new Error("Upload timed out. Please try again.")));
      request.timeout = 10 * 60 * 1000;
      request.addEventListener("load", () => {
        let data = {};
        try { data = JSON.parse(request.responseText || "{}"); } catch { /* non-JSON server error */ }
        if (request.status < 200 || request.status >= 300) {
          reject(new Error(data.error || "Upload failed. Please try again."));
          return;
        }
        resolve(data);
      });
      request.send(formData);
    });
  }

  function uploadLabel(progress) {
    if (progress.percent < 100) {
      const eta = progress.remaining > 1 ? " · about " + Math.ceil(progress.remaining) + "s left" : "";
      return "Uploading " + progress.percent + "%" + eta;
    }
    return "Upload received · processing...";
  }

  async function copyLink(text, input, button) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        input.focus();
        input.select();
        if (!document.execCommand("copy")) throw new Error("Copy unavailable");
      }
      button.textContent = "Copied";
      setTimeout(() => { button.textContent = "Copy link"; }, 1800);
    } catch {
      input.focus();
      input.select();
      window.prompt("Copy this Playback link", text);
    }
  }

  function formatDuration(seconds) {
    const value = Number(seconds || 0);
    if (!value) return "";
    return Math.floor(value / 60) + ":" + String(value % 60).padStart(2, "0");
  }

  function playLabel(count) {
    const value = Number(count || 0);
    return value + (value === 1 ? " play" : " plays");
  }

  document.addEventListener("play", (event) => {
    if (event.target.tagName !== "AUDIO") return;
    document.querySelectorAll("audio").forEach((audio) => {
      if (audio !== event.target) audio.pause();
    });
  }, true);

  function recordPlay(audio, track, countElement) {
    audio.addEventListener("play", () => {
      fetch(track.playUrl, { method: "POST", credentials: "omit" })
        .then((response) => response.ok ? response.json() : null)
        .then((data) => {
          if (!data || data.playCount == null) return;
          track.playCount = data.playCount;
          countElement.textContent = formatDuration(track.durationSeconds) + " · " + playLabel(data.playCount);
        })
        .catch(() => {});
    });
  }

  function render() {
    list.innerHTML = "";
    if (!releases.length) {
      list.innerHTML = '<div class="playback-empty"><div class="empty-note">Your Playback library is ready for its first release.</div><button class="btn small" id="emptyNewBtn" type="button">Create a release</button></div>';
      document.getElementById("emptyNewBtn").addEventListener("click", openCreate);
      return;
    }
    releases.forEach((release) => list.appendChild(renderRelease(release)));
  }

  function renderRelease(release) {
    const card = releaseTemplate.content.firstElementChild.cloneNode(true);
    const image = card.querySelector(".release-art img");
    const mark = card.querySelector(".release-art-mark");
    const type = card.querySelector(".release-type");
    const title = card.querySelector(".release-title");
    const description = card.querySelector(".release-description");
    const share = card.querySelector(".share-btn");
    const preview = card.querySelector(".preview-release");
    const deleteRelease = card.querySelector(".delete-release");
    const editRelease = card.querySelector(".edit-release");
    const releaseEdit = card.querySelector(".release-edit");
    const releaseEditTitle = card.querySelector(".release-edit-title");
    const releaseEditDescription = card.querySelector(".release-edit-description");
    const releaseEditMsg = card.querySelector(".release-edit-msg");
    const shareBox = card.querySelector(".release-share");
    const shareInput = shareBox.querySelector("input");
    const coverInput = card.querySelector(".cover-input");
    const trackForm = card.querySelector(".track-form");
    const trackInput = card.querySelector(".track-input");
    const trackTitle = card.querySelector(".track-title");
    const trackList = card.querySelector(".track-list");
    const coverStatus = card.querySelector(".cover-status");
    const trackStatus = card.querySelector(".track-status");

    title.textContent = release.title;
    type.textContent = release.releaseType === "album" ? "Album" : "Single";
    description.textContent = release.description || "";
    description.hidden = !release.description;
    shareInput.value = release.shareUrl;
    if (release.coverUrl) {
      image.src = release.coverUrl;
      image.hidden = false;
      mark.hidden = true;
    } else {
      image.hidden = true;
    }

    share.addEventListener("click", () => { shareBox.hidden = !shareBox.hidden; });
    preview.addEventListener("click", () => {
      window.open(release.shareUrl, "_blank", "noopener,noreferrer");
    });
    editRelease.addEventListener("click", () => {
      releaseEdit.hidden = !releaseEdit.hidden;
      releaseEditTitle.value = release.title;
      releaseEditDescription.value = release.description || "";
      if (!releaseEdit.hidden) releaseEditTitle.focus();
    });
    card.querySelector(".cancel-release-edit").addEventListener("click", () => { releaseEdit.hidden = true; });
    releaseEdit.addEventListener("submit", async (event) => {
      event.preventDefault();
      releaseEditMsg.textContent = "Saving...";
      try {
        const data = await window.LB.apiFetch("/api/playback/releases/" + release.id, {
          method: "PUT",
          body: JSON.stringify({ title: releaseEditTitle.value, description: releaseEditDescription.value })
        });
        Object.assign(release, data.release);
        render();
      } catch (err) { releaseEditMsg.textContent = err.message; releaseEditMsg.className = "msg err release-edit-msg"; }
    });
    deleteRelease.addEventListener("click", async () => {
      if (!confirm("Delete this release and its tracks? This cannot be undone.")) return;
      try {
        await window.LB.apiFetch("/api/playback/releases/" + release.id, { method: "DELETE" });
        releases = releases.filter((entry) => entry.id !== release.id);
        render();
      } catch (err) { setMessage(err.message, true); }
    });
    shareBox.querySelector(".copy-btn").addEventListener("click", async () => {
      await copyLink(release.shareUrl, shareInput, shareBox.querySelector(".copy-btn"));
    });
    coverInput.addEventListener("change", async () => {
      const file = coverInput.files[0];
      if (!file) return;
      coverStatus.className = "upload-status is-loading";
      coverStatus.textContent = "Preparing cover upload...";
      try {
        const form = new FormData();
        form.append("cover", file);
        const data = await upload("/api/playback/releases/" + release.id + "/cover", form, "PUT", (progress) => {
          coverStatus.textContent = progress.percent < 100 ? uploadLabel(progress) : "Upload received · saving cover...";
        });
        Object.assign(release, data.release);
        render();
      } catch (err) {
        coverStatus.className = "upload-status is-error";
        coverStatus.textContent = err.message;
      }
    });
    trackInput.addEventListener("change", async () => {
      const file = trackInput.files[0];
      if (!file) return;
      trackForm.classList.add("is-uploading");
      trackStatus.className = "upload-status is-loading";
      trackStatus.textContent = "Preparing track upload...";
      try {
        const form = new FormData();
        form.append("audio", file);
        form.append("title", trackTitle.value.trim());
        const data = await upload("/api/playback/releases/" + release.id + "/tracks", form, "POST", (progress) => {
          trackStatus.textContent = uploadLabel(progress);
        });
        release.tracks.push(data.track);
        trackTitle.value = "";
        render();
      } catch (err) {
        trackStatus.className = "upload-status is-error";
        trackStatus.textContent = err.message;
      }
      finally { trackForm.classList.remove("is-uploading"); trackInput.value = ""; }
    });

    release.tracks.forEach((track) => {
      const item = document.createElement("li");
      item.className = "track-row";
      item.draggable = true;
      item.dataset.id = track.id;
      item.innerHTML = '<span class="drag-handle" title="Drag to reorder">⠿</span><span class="track-number"></span><div class="track-meta"><b></b><small></small><span class="replace-status" aria-live="polite"></span></div><button class="track-edit" type="button" title="Rename track">Edit</button><label class="track-replace">Replace audio<input class="replace-audio-input" type="file" accept="audio/mpeg,audio/wav,audio/ogg,audio/flac,audio/mp4,audio/aac,audio/x-m4a" hidden /></label><div class="track-controls"><audio controls preload="none"></audio><button class="repeat-track" type="button" aria-pressed="false">Repeat</button></div><button class="track-delete" type="button" title="Delete track" aria-label="Delete track">&times;</button>';
      item.querySelector(".track-number").textContent = track.trackNumber;
      item.querySelector("b").textContent = track.title;
      const trackInfo = item.querySelector("small");
      const audio = item.querySelector("audio");
      const repeat = item.querySelector(".repeat-track");
      const replaceInput = item.querySelector(".replace-audio-input");
      const replaceStatus = item.querySelector(".replace-status");
      trackInfo.textContent = formatDuration(track.durationSeconds) + " · " + playLabel(track.playCount);
      audio.src = track.audioUrl;
      window.LBPlaybackPlayer.mount(audio);
      repeat.addEventListener("click", () => {
        audio.loop = !audio.loop;
        repeat.classList.toggle("active", audio.loop);
        repeat.setAttribute("aria-pressed", String(audio.loop));
      });
      recordPlay(audio, track, trackInfo);
      replaceInput.addEventListener("change", async () => {
        const file = replaceInput.files[0];
        if (!file) return;
        replaceStatus.className = "replace-status is-loading";
        replaceStatus.textContent = "Preparing replacement...";
        try {
          const form = new FormData();
          form.append("audio", file);
          const data = await upload("/api/playback/releases/" + release.id + "/tracks/" + track.id + "/audio", form, "PUT", (progress) => {
            replaceStatus.textContent = progress.percent < 100 ? uploadLabel(progress) : "Upload received · saving audio...";
          });
          Object.assign(track, data.track);
          render();
        } catch (err) {
          replaceStatus.className = "replace-status is-error";
          replaceStatus.textContent = err.message;
        } finally { replaceInput.value = ""; }
      });
      item.querySelector(".track-edit").addEventListener("click", async (event) => {
        event.stopPropagation();
        const title = window.prompt("Track name", track.title);
        if (title == null || !title.trim() || title.trim() === track.title) return;
        try {
          const data = await window.LB.apiFetch("/api/playback/releases/" + release.id + "/tracks/" + track.id, {
            method: "PUT", body: JSON.stringify({ title: title.trim() })
          });
          Object.assign(track, data.track);
          render();
        } catch (err) { setMessage(err.message, true); }
      });
      item.querySelector(".track-delete").addEventListener("click", async (event) => {
        event.stopPropagation();
        if (!confirm('Delete "' + track.title + '" from this release?')) return;
        try {
          await window.LB.apiFetch("/api/playback/releases/" + release.id + "/tracks/" + track.id, { method: "DELETE" });
          release.tracks = release.tracks.filter((entry) => entry.id !== track.id);
          release.tracks.forEach((entry, index) => { entry.trackNumber = index + 1; });
          render();
        } catch (err) { setMessage(err.message, true); }
      });
      item.addEventListener("dragstart", () => item.classList.add("dragging"));
      item.addEventListener("dragend", async () => {
        item.classList.remove("dragging");
        const ids = [...trackList.children].map((row) => Number(row.dataset.id));
        release.tracks.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        release.tracks.forEach((entry, index) => { entry.trackNumber = index + 1; });
        [...trackList.children].forEach((row, index) => { row.querySelector(".track-number").textContent = index + 1; });
        try {
          await window.LB.apiFetch("/api/playback/releases/" + release.id + "/tracks/order", { method: "PUT", body: JSON.stringify({ trackIds: ids }) });
        } catch (err) { setMessage(err.message, true); }
      });
      item.addEventListener("dragover", (event) => {
        event.preventDefault();
        const dragging = trackList.querySelector(".dragging");
        if (dragging && dragging !== item) trackList.insertBefore(dragging, item);
      });
      trackList.appendChild(item);
    });
    return card;
  }

  function openCreate() {
    createPanel.hidden = false;
    document.getElementById("releaseTitle").focus();
  }

  async function load() {
    if (!window.LB.isAuthed()) { location.replace("login.html"); return; }
    try {
      releases = (await window.LB.apiFetch("/api/playback")).releases || [];
      render();
    } catch (err) {
      if (err.status === 401) { location.replace("login.html"); return; }
      setMessage(err.message, true);
    }
  }

  document.getElementById("newReleaseBtn").addEventListener("click", openCreate);
  document.getElementById("createClose").addEventListener("click", () => { createPanel.hidden = true; });
  document.getElementById("releaseForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.getElementById("createMsg");
    message.textContent = "Creating...";
    try {
      const data = await window.LB.apiFetch("/api/playback/releases", { method: "POST", body: JSON.stringify({
        title: document.getElementById("releaseTitle").value,
        description: document.getElementById("releaseDescription").value,
        releaseType: document.getElementById("releaseType").value
      }) });
      releases.unshift(data.release);
      event.target.reset();
      createPanel.hidden = true;
      render();
    } catch (err) { message.textContent = err.message; message.className = "msg err"; }
  });

  const share = new URLSearchParams(location.search).get("share");
  if (share) {
    location.replace("playback-share.html?share=" + encodeURIComponent(share));
  } else {
    load();
  }
})();
