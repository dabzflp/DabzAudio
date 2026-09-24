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

  async function upload(path, formData, method = "POST") {
    const headers = {};
    const token = window.LB.getToken();
    if (token) headers.Authorization = "Bearer " + token;
    const response = await fetch((window.LB_API_BASE || "").replace(/\/$/, "") + path, {
      method,
      headers,
      body: formData,
      credentials: "include"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Upload failed.");
    return data;
  }

  function formatDuration(seconds) {
    const value = Number(seconds || 0);
    if (!value) return "";
    return Math.floor(value / 60) + ":" + String(value % 60).padStart(2, "0");
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
    const deleteRelease = card.querySelector(".delete-release");
    const shareBox = card.querySelector(".release-share");
    const shareInput = shareBox.querySelector("input");
    const coverInput = card.querySelector(".cover-input");
    const trackForm = card.querySelector(".track-form");
    const trackInput = card.querySelector(".track-input");
    const trackTitle = card.querySelector(".track-title");
    const trackList = card.querySelector(".track-list");

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
    deleteRelease.addEventListener("click", async () => {
      if (!confirm("Delete this release and its tracks? This cannot be undone.")) return;
      try {
        await window.LB.apiFetch("/api/playback/releases/" + release.id, { method: "DELETE" });
        releases = releases.filter((entry) => entry.id !== release.id);
        render();
      } catch (err) { setMessage(err.message, true); }
    });
    shareBox.querySelector(".copy-btn").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(release.shareUrl);
        shareBox.querySelector(".copy-btn").textContent = "Copied";
      } catch { shareInput.select(); document.execCommand("copy"); }
    });
    coverInput.addEventListener("change", async () => {
      const file = coverInput.files[0];
      if (!file) return;
      try {
        const form = new FormData();
        form.append("cover", file);
        const data = await upload("/api/playback/releases/" + release.id + "/cover", form, "PUT");
        Object.assign(release, data.release);
        render();
      } catch (err) { setMessage(err.message, true); }
    });
    trackInput.addEventListener("change", async () => {
      const file = trackInput.files[0];
      if (!file) return;
      trackForm.classList.add("is-uploading");
      try {
        const form = new FormData();
        form.append("audio", file);
        form.append("title", trackTitle.value.trim());
        const data = await upload("/api/playback/releases/" + release.id + "/tracks", form);
        release.tracks.push(data.track);
        trackTitle.value = "";
        render();
      } catch (err) { setMessage(err.message, true); }
      finally { trackForm.classList.remove("is-uploading"); trackInput.value = ""; }
    });

    release.tracks.forEach((track) => {
      const item = document.createElement("li");
      item.className = "track-row";
      item.draggable = true;
      item.dataset.id = track.id;
      item.innerHTML = '<span class="drag-handle" title="Drag to reorder">⠿</span><span class="track-number"></span><div class="track-meta"><b></b><small></small></div><audio controls preload="none"></audio>';
      item.querySelector(".track-number").textContent = track.trackNumber;
      item.querySelector("b").textContent = track.title;
      item.querySelector("small").textContent = formatDuration(track.durationSeconds);
      item.querySelector("audio").src = track.audioUrl;
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
