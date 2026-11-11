(function () {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  let audioContext = null;

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

    audioContext ||= new AudioContextConstructor();
    const source = audioContext.createMediaElementSource(audio);
    const low = audioContext.createBiquadFilter();
    low.type = "lowshelf";
    low.frequency.value = 180;
    const mid = audioContext.createBiquadFilter();
    mid.type = "peaking";
    mid.frequency.value = 1000;
    mid.Q.value = 0.8;
    const high = audioContext.createBiquadFilter();
    high.type = "highshelf";
    high.frequency.value = 8000;
    let bypassed = null;

    function apply() {
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

    apply();
    return {
      supported: true,
      setMixSettings(value) {
        Object.assign(settings, normalizeMixSettings(value));
        apply();
        return { ...settings };
      },
      getMixSettings: () => ({ ...settings }),
      resume: () => audioContext.state === "suspended" ? audioContext.resume() : Promise.resolve()
    };
  }

  function mount(audio, options = {}) {
    audio.controls = false;
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

    play.addEventListener("click", () => {
      if (audio.paused) {
        mixer.resume();
        audio.play().catch(() => {});
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
