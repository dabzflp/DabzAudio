(function () {
  function clock(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    return Math.floor(seconds / 60) + ":" + String(Math.floor(seconds % 60)).padStart(2, "0");
  }

  function mount(audio, options = {}) {
    audio.controls = false;
    audio.classList.add("native-audio");
    const player = document.createElement("div");
    player.className = "custom-player";
    player.innerHTML = '<button class="player-play" type="button" aria-label="Play">▶</button><span class="player-time player-current">0:00</span><input class="player-seek" type="range" min="0" max="1000" value="0" aria-label="Seek through track" /><span class="player-time player-duration">0:00</span><button class="player-mute" type="button" aria-label="Mute">VOL</button><input class="player-volume" type="range" min="0" max="1" step="0.01" value="1" aria-label="Volume" />';
    audio.parentNode.insertBefore(player, audio);

    const play = player.querySelector(".player-play");
    const current = player.querySelector(".player-current");
    const duration = player.querySelector(".player-duration");
    const seek = player.querySelector(".player-seek");
    const mute = player.querySelector(".player-mute");
    const volume = player.querySelector(".player-volume");

    function sync() {
      current.textContent = clock(audio.currentTime);
      duration.textContent = clock(audio.duration);
      seek.value = audio.duration ? Math.round((audio.currentTime / audio.duration) * 1000) : 0;
      seek.style.setProperty("--played", (Number(seek.value) / 10) + "%");
    }
    function syncPlay() {
      play.textContent = audio.paused ? "▶" : "Ⅱ";
      play.setAttribute("aria-label", audio.paused ? "Play" : "Pause");
      player.classList.toggle("is-playing", !audio.paused);
    }

    play.addEventListener("click", () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); });
    seek.addEventListener("input", () => {
      if (!audio.duration) return;
      audio.currentTime = (Number(seek.value) / 1000) * audio.duration;
      sync();
    });
    volume.addEventListener("input", () => {
      audio.volume = Number(volume.value);
      audio.muted = audio.volume === 0;
      mute.textContent = audio.muted ? "MUT" : "VOL";
    });
    mute.addEventListener("click", () => {
      audio.muted = !audio.muted;
      mute.textContent = audio.muted ? "MUT" : "VOL";
    });
    ["loadedmetadata", "durationchange", "timeupdate", "progress", "ended"].forEach((event) => audio.addEventListener(event, sync));
    ["play", "pause", "ended"].forEach((event) => audio.addEventListener(event, syncPlay));
    if (options.protectedAudio) player.addEventListener("contextmenu", (event) => event.preventDefault());
    sync();
    syncPlay();
    return player;
  }

  window.LBPlaybackPlayer = { mount };
})();
