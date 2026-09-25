(async function () {
  const root = document.getElementById("sharedPlayback");
  const token = new URLSearchParams(location.search).get("share");
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
  if (!token) { root.innerHTML = '<div class="playback-empty"><div class="empty-note">This Playback link is incomplete.</div></div>'; return; }
  try {
    const data = await window.LB.apiFetch("/api/playback/share/" + encodeURIComponent(token));
    const release = data.release;
    document.title = release.title + " | Playback";
    const cover = release.coverUrl ? '<img class="shared-cover" src="' + release.coverUrl + '" alt="">' : '<div class="shared-cover shared-cover-empty">♪</div>';
    root.innerHTML = '<section class="shared-release"><div class="shared-top">' + cover + '<div><p class="playback-kicker">' + (release.releaseType === "album" ? "ALBUM" : "SINGLE") + '</p><h1></h1><p class="shared-artist"></p><p class="sub shared-description"></p></div></div><ol class="shared-track-list"></ol></section>';
    root.querySelector("h1").textContent = release.title;
    root.querySelector(".shared-artist").textContent = release.artistName;
    root.querySelector(".shared-description").textContent = release.description || "";
    const tracks = root.querySelector(".shared-track-list");
    release.tracks.forEach((track) => {
      const item = document.createElement("li");
      item.className = "shared-track";
      item.innerHTML = '<div><span class="shared-track-number"></span><b></b><small class="shared-track-plays"></small></div><div class="shared-track-controls"><audio controls preload="metadata"></audio><button class="repeat-track" type="button" aria-pressed="false">Repeat</button></div>';
      item.querySelector(".shared-track-number").textContent = String(track.trackNumber).padStart(2, "0");
      item.querySelector("b").textContent = track.title;
      const count = item.querySelector(".shared-track-plays");
      const audio = item.querySelector("audio");
      const repeat = item.querySelector(".repeat-track");
      audio.setAttribute("controlsList", "nodownload noplaybackrate");
      audio.setAttribute("disableRemotePlayback", "true");
      audio.addEventListener("contextmenu", (event) => event.preventDefault());
      repeat.addEventListener("click", () => {
        audio.loop = !audio.loop;
        repeat.classList.toggle("active", audio.loop);
        repeat.setAttribute("aria-pressed", String(audio.loop));
      });
      count.textContent = playLabel(track.playCount);
      audio.src = track.audioUrl;
      window.LBPlaybackPlayer.mount(audio, { protectedAudio: true });
      audio.addEventListener("play", () => {
        fetch(track.playUrl, { method: "POST", credentials: "omit" })
          .then((response) => response.ok ? response.json() : null)
          .then((data) => {
            if (data && data.playCount != null) {
              track.playCount = data.playCount;
              count.textContent = playLabel(data.playCount);
            }
          })
          .catch(() => {});
      });
      tracks.appendChild(item);
    });
    if (!release.tracks.length) tracks.innerHTML = '<li class="empty-note">Tracks are being added to this release.</li>';
  } catch (err) {
    root.innerHTML = '<div class="playback-empty"><div class="empty-note">' + (err.message || "This release is unavailable.") + '</div></div>';
  }
})();
