(function () {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  let audioContext = null;
  let activeMediaSessionAudio = null;

  function clock(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    return Math.floor(seconds / 60) + ":" + String(Math.floor(seconds % 60)).padStart(2, "0");
  }

  function normalizeMixSettings(value) {
    const settings = value && typeof value === "object" ? value : {};
    const gain = (key) => {
      const amount = Number(settings[key]);
      return Number.isFinite(amount) ? Math.max(-12, Math.min(12, amount)) : 0;
    };
    return { lowDb: gain("lowDb"), midDb: gain("midDb"), highDb: gain("highDb"), bypass: settings.bypass === true };
  }

  function createMixer(audio, initialSettings) {
    const settings = normalizeMixSettings(initialSettings);
    if (!AudioContextConstructor) return { setMixSettings: () => settings, getMixSettings: () => ({ ...settings }), supported: false };

    let source = null;
    let low = null;
    let mid = null;
    let high = null;
    let bypassed = null;

    function apply() {
      if (!source) {
        audioContext ||= new AudioContextConstructor({ latencyHint: "playback" });
        source = audioContext.createMediaElementSource(audio);
        low = audioContext.createBiquadFilter();
        low.type = "lowshelf";
        low.frequency.value = 180;
        mid = audioContext.createBiquadFilter();
        mid.type = "peaking";
        mid.frequency.value = 1000;
        mid.Q.value = 0.8;
        high = audioContext.createBiquadFilter();
        high.type = "highshelf";
        high.frequency.value = 8000;
      }
      const now = audioContext.currentTime;
      low.gain.setTargetAtTime(settings.lowDb, now, 0.025);
      mid.gain.setTargetAtTime(settings.midDb, now, 0.025);
      high.gain.setTargetAtTime(settings.highDb, now, 0.025);
      if (bypassed === settings.bypass) return;
      source.disconnect();
      if (settings.bypass) {
        source.connect(audioContext.destination);
      } else {
        source.connect(low);
        low.connect(mid);
        mid.connect(high);
        high.connect(audioContext.destination);
      }
      bypassed = settings.bypass;
    }

    const needsEqualizer = () => !settings.bypass && (settings.lowDb !== 0 || settings.midDb !== 0 || settings.highDb !== 0);
    if (needsEqualizer()) apply();
    return {
      supported: true,
      setMixSettings(value) {
        Object.assign(settings, normalizeMixSettings(value));
        if (source || needsEqualizer()) apply();
        return { ...settings };
      },
      getMixSettings: () => ({ ...settings }),
      resume: () => audioContext?.state === "suspended" ? audioContext.resume() : Promise.resolve()
    };
  }

  function updateMediaSession(audio, metadata, mixer) {
    const session = navigator.mediaSession;
    if (!session) return;

    const handlers = {
      play: async () => {
        try {
          await mixer.resume();
          await audio.play();
        } catch (error) {
          console.error("Playback media-session play failed:", error);
        }
      },
      pause: () => audio.pause(),
      seekbackward: (details) => {
        audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 10));
      },
      seekforward: (details) => {
        audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + (details.seekOffset || 10));
      },
      seekto: (details) => {
        if (Number.isFinite(details.seekTime)) audio.currentTime = details.seekTime;
      }
    };

    function updatePosition() {
      if (activeMediaSessionAudio !== audio) return;
      if (!Number.isFinite(audio.duration) || audio.duration <= 0 || !session.setPositionState) return;
      try {
        session.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate,
          position: Math.min(audio.currentTime, audio.duration)
        });
      } catch { /* Position updates are optional on some browsers. */ }
    }
    function updateState() {
      if (activeMediaSessionAudio !== audio) return;
      session.playbackState = audio.ended ? "paused" : audio.paused ? "paused" : "playing";
      updatePosition();
    }

    audio.addEventListener("play", () => {
      activeMediaSessionAudio = audio;
      if (typeof MediaMetadata === "function") {
        session.metadata = new MediaMetadata({
          title: metadata.title || document.title,
          artist: metadata.artist || "DabzAudio",
          album: metadata.album || "Playback",
          artwork: metadata.artwork ? [{ src: metadata.artwork }] : []
        });
      }
      Object.entries(handlers).forEach(([action, handler]) => {
        try { session.setActionHandler(action, handler); } catch { /* Unsupported media action. */ }
      });
      updateState();
    });
    audio.addEventListener("pause", updateState);
    audio.addEventListener("ended", updateState);
    audio.addEventListener("timeupdate", updatePosition);
    audio.addEventListener("loadedmetadata", updatePosition);
    updateState();
  }

  function mount(audio, options = {}) {
    audio.controls = false;
    audio.setAttribute("playsinline", "");
    audio.setAttribute("webkit-playsinline", "");
    audio.classList.add("native-audio");
    const player = document.createElement("div");
    player.className = "custom-player";
    player.innerHTML = '<button class="player-play" type="button" aria-label="Play">▶</button><span class="player-time player-current">0:00</span><input class="player-seek" type="range" min="0" max="1000" value="0" aria-label="Seek through track" /><span class="player-time player-duration">0:00</span>';
    audio.parentNode.insertBefore(player, audio);

    const play = player.querySelector(".player-play");
    const current = player.querySelector(".player-current");
    const duration = player.querySelector(".player-duration");
    const seek = player.querySelector(".player-seek");
    const mixer = createMixer(audio, options.mixSettings);
    updateMediaSession(audio, options.metadata || {}, mixer);

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

    play.addEventListener("click", async () => {
      if (audio.paused) {
        try {
          await mixer.resume();
          await audio.play();
        } catch (error) {
          console.error("Playback could not start:", error);
        }
      }
      else audio.pause();
    });
    seek.addEventListener("input", () => {
      if (!audio.duration) return;
      audio.currentTime = (Number(seek.value) / 1000) * audio.duration;
      sync();
    });
    ["loadedmetadata", "durationchange", "timeupdate", "progress", "ended"].forEach((event) => audio.addEventListener(event, sync));
    ["play", "pause", "ended"].forEach((event) => audio.addEventListener(event, syncPlay));
    if (options.protectedAudio) player.addEventListener("contextmenu", (event) => event.preventDefault());
    sync();
    syncPlay();
    return { element: player, mixer };
  }

  window.LBPlaybackPlayer = { mount };
})();
