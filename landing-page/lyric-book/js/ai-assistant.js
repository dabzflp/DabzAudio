/**
 * ai-assistant.js — AI Assistant for the Lyric Book editor.
 *
 * Two surfaces share the same request logic: the full panel in the
 * Suggestions sidebar, and a quick "Ask AI" popover anchored in the editor
 * bar. Self-contained: reads the open lyric id from window.LBApp and talks to
 * /api/lyrics/:id/assistant. Does nothing if the user isn't signed in, so the
 * rest of the Lyric Book is completely unaffected if this script fails to load.
 */
(function () {
  if (!window.LB || !window.LB.isAuthed()) return;

  const body = document.getElementById("bodyInput");
  let currentLyricId = window.LBApp && window.LBApp.getCurrentLyricId();
  document.addEventListener("lb-lyric-open", (e) => {
    currentLyricId = e.detail && e.detail.id;
  });

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function selectedLyricText() {
    if (!body) return "";
    const { selectionStart, selectionEnd, value } = body;
    if (selectionStart == null || selectionStart === selectionEnd) return "";
    return value.slice(selectionStart, selectionEnd);
  }

  const speechLanguages = [
    { tag: "es-ES", names: ["spanish", "español", "espanol"] },
    { tag: "fr-FR", names: ["french", "français", "francais"] },
    { tag: "pt-PT", names: ["portuguese", "português", "portugues"] },
    { tag: "de-DE", names: ["german", "deutsch"] },
    { tag: "yo-NG", names: ["yoruba", "yorùbá"] },
    { tag: "ja-JP", names: ["japanese", "日本語"] },
    { tag: "en-US", names: ["english"] },
    { tag: "ar-SA", names: ["arabic"] },
    { tag: "it-IT", names: ["italian", "italiano"] },
    { tag: "zh-CN", names: ["chinese", "mandarin"] },
    { tag: "ko-KR", names: ["korean"] },
    { tag: "hi-IN", names: ["hindi"] },
    { tag: "ru-RU", names: ["russian"] },
    { tag: "nl-NL", names: ["dutch"] },
    { tag: "tr-TR", names: ["turkish"] },
    { tag: "ha-NG", names: ["hausa"] },
    { tag: "ig-NG", names: ["igbo"] },
    { tag: "sw-KE", names: ["swahili"] },
    { tag: "bn-BD", names: ["bengali"] },
    { tag: "pl-PL", names: ["polish"] },
    { tag: "vi-VN", names: ["vietnamese"] }
  ];
  let activeSpeechButton = null;
  let speechRunId = 0;
  let activeAudio = null;
  let activeAudioUrl = null;
  let preparedAudio = null;

  function resetSpeechButton(button) {
    if (!button) return;
    button.textContent = "🔊 Listen";
    button.setAttribute("aria-pressed", "false");
  }

  function stopSpeech() {
    speechRunId += 1;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.removeAttribute("src");
      activeAudio.load();
    }
    if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
    activeAudio = null;
    activeAudioUrl = null;
    preparedAudio = null;
    resetSpeechButton(activeSpeechButton);
    activeSpeechButton = null;
  }

  function speechChunks(text) {
    const chunks = [];
    String(text || "").split(/\r?\n/).forEach((line) => {
      const words = line.trim().split(/\s+/);
      let chunk = "";
      words.forEach((word) => {
        if (!word) return;
        if (chunk && `${chunk} ${word}`.length > 180) {
          chunks.push(chunk);
          chunk = word;
        } else {
          chunk = chunk ? `${chunk} ${word}` : word;
        }
      });
      if (chunk) chunks.push(chunk);
    });
    return chunks;
  }

  function showSpeechMessage(resultsEl, text, isError = false) {
    const message = resultsEl.parentElement?.querySelector(".msg");
    if (!message) return;
    message.textContent = text;
    message.className = "msg" + (isError ? " err" : "");
  }

  function finishSpeech(runId) {
    if (runId !== speechRunId) return;
    resetSpeechButton(activeSpeechButton);
    activeSpeechButton = null;
    if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
    activeAudio = null;
    activeAudioUrl = null;
    preparedAudio = null;
  }

  function playPreparedAudio(runId, resultsEl) {
    if (!preparedAudio || runId !== speechRunId) return;
    preparedAudio.audio.play().then(() => {
      if (runId !== speechRunId) return;
      preparedAudio.ready = false;
      activeSpeechButton.textContent = "Stop";
      activeSpeechButton.setAttribute("aria-pressed", "true");
      showSpeechMessage(resultsEl, "");
    }).catch(() => {
      if (runId !== speechRunId) return;
      preparedAudio.ready = true;
      activeSpeechButton.textContent = "▶ Play audio";
      activeSpeechButton.setAttribute("aria-pressed", "false");
      showSpeechMessage(resultsEl, "Audio is ready. Tap Play audio to start.");
    });
  }

  function speakWithBrowser(button, text, language, resultsEl, runId) {
    if (!("speechSynthesis" in window) || !window.SpeechSynthesisUtterance) {
      showSpeechMessage(resultsEl, "Natural speech is unavailable and this browser has no speech fallback.", true);
      finishSpeech(runId);
      return;
    }
    const chunks = speechChunks(text);
    if (!chunks.length) return finishSpeech(runId);
    let remaining = chunks.length;
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find((item) => item.lang.toLowerCase() === language.toLowerCase()) ||
      voices.find((item) => item.lang.toLowerCase().startsWith(language.split("-")[0].toLowerCase()));
    button.textContent = "Stop";
    button.setAttribute("aria-pressed", "true");
    showSpeechMessage(resultsEl, "Natural speech is unavailable; using your device voice.");
    chunks.forEach((chunk) => {
      const utterance = new window.SpeechSynthesisUtterance(chunk);
      utterance.lang = language;
      if (voice) utterance.voice = voice;
      utterance.onend = () => {
        if (runId === speechRunId && --remaining === 0) finishSpeech(runId);
      };
      utterance.onerror = () => {
        if (runId === speechRunId) {
          showSpeechMessage(resultsEl, "Device speech could not play this language.", true);
          finishSpeech(runId);
        }
      };
      window.speechSynthesis.speak(utterance);
    });
  }

  async function playSpeech(button, text, language, resultsEl) {
    if (activeSpeechButton === button) {
      if (preparedAudio?.ready) return playPreparedAudio(speechRunId, resultsEl);
      stopSpeech();
      return;
    }
    stopSpeech();
    const runId = speechRunId;
    activeSpeechButton = button;
    button.textContent = "Preparing audio…";
    button.setAttribute("aria-pressed", "true");
    showSpeechMessage(resultsEl, "Generating natural voice audio…");

    try {
      if (!currentLyricId) throw new Error("Open a lyric first.");
      const result = await window.LB.apiFetch(`/api/lyrics/${currentLyricId}/speech`, {
        method: "POST",
        body: JSON.stringify({ text, language })
      });
      if (runId !== speechRunId) return;
      const binary = atob(result.audioContent);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      activeAudioUrl = URL.createObjectURL(new Blob([bytes], { type: result.contentType || "audio/mpeg" }));
      activeAudio = new Audio(activeAudioUrl);
      preparedAudio = { audio: activeAudio, ready: false };
      activeAudio.addEventListener("ended", () => finishSpeech(runId), { once: true });
      activeAudio.addEventListener("error", () => {
        if (runId === speechRunId) {
          showSpeechMessage(resultsEl, "Generated audio could not be played.", true);
          finishSpeech(runId);
        }
      }, { once: true });
      playPreparedAudio(runId, resultsEl);
    } catch (err) {
      if (runId !== speechRunId) return;
      speakWithBrowser(button, text, language, resultsEl, runId);
    }
  }

  function detectSpeechLanguage(request) {
    const normalized = String(request || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!/\btranslat(?:e|ed|ing|ion)\b/.test(normalized)) return "";
    const match = speechLanguages.find((language) => language.names.some((name) => {
      const normalizedName = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return new RegExp(`(^|[^\\p{L}])${normalizedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`, "u").test(normalized);
    }));
    return match ? match.tag : "";
  }

  function languageTag(language) {
    const normalized = String(language || "").toLowerCase();
    const match = speechLanguages.find((item) => item.names.some((name) => name.toLowerCase() === normalized));
    return match ? match.tag : "";
  }

  document.addEventListener("lb-lyric-open", stopSpeech);

  function renderResult(resultsEl, data, speechLanguage = "") {
    const suggestions = (data.suggestions || [])
      .map(
        (s, i) =>
          `<div class="ai-suggestion" style="animation-delay:${i * 60}ms"><div class="ai-suggestion-head"><b>${i + 1}.</b>${speechLanguage ? `<button class="ai-speak-button" type="button" data-speech-index="${i}" aria-label="Listen to translation in ${esc(speechLanguage)}" aria-pressed="false" title="Generate natural speech in ${esc(speechLanguage)}">🔊 Listen</button>` : ""}</div><p>${esc(s.text)}</p><small>${esc(s.reason || "")}</small></div>`
      )
      .join("");
    const notes = (data.analysis && data.analysis.notes) || [];
    const notesHtml = notes.length
      ? `<div class="ai-notes">${notes.map((n) => `&gt; ${esc(n)}`).join("<br>")}</div>`
      : "";
    resultsEl.innerHTML = suggestions + notesHtml || '<div class="empty-note">No suggestions returned.</div>';
    resultsEl.style.display = "block";
    resultsEl.querySelectorAll(".ai-speak-button").forEach((button) => {
      const suggestion = (data.suggestions || [])[Number(button.dataset.speechIndex)];
      button.addEventListener("click", () => playSpeech(button, suggestion?.text, speechLanguage, resultsEl));
    });
  }

  // Creates a self-contained "surface" (a set of DOM hooks + its own runAction)
  // so different panels (sidebar, popovers) can each drive their own API call
  // without stepping on each other's status/results elements. `call` and
  // `render` default to the per-lyric assistant; Help overrides both.
  function createSurface({ msg, status, orb, results, buttons, call, render, getSelectedText }) {
    const doCall =
      call ||
      ((action, request) => {
        if (!currentLyricId) throw Object.assign(new Error("Open a lyric first."), { silent: true });
        return window.LB.apiFetch(`/api/lyrics/${currentLyricId}/assistant`, {
          method: "POST",
          body: JSON.stringify({ request, action, selectedText: getSelectedText ? getSelectedText() : selectedLyricText() })
        });
      });
    const doRender = render || renderResult;

    function setMsg(text, isError) {
      msg.textContent = text || "";
      msg.className = "msg" + (isError ? " err" : "");
    }
    function setStatus(text, state) {
      if (!status) return;
      status.textContent = text;
      status.className = "ai-status" + (state ? " is-" + state : "");
      if (orb) orb.classList.toggle("is-thinking", state === "thinking");
    }
    async function runAction(action, request, speechLanguage = "") {
      stopSpeech();
      setMsg("");
      setStatus("Thinking…", "thinking");
      results.style.display = "none";
      buttons.forEach((b) => { if (b) b.disabled = true; });
      try {
        const data = await doCall(action, request);
        setStatus("Ready");
        doRender(results, data, speechLanguage || (action === "ask" ? detectSpeechLanguage(request) : ""));
      } catch (err) {
        setStatus(err.silent ? "Ready" : "Error", err.silent ? undefined : "error");
        setMsg(err.message || "The AI assistant could not complete this request.", true);
      } finally {
        buttons.forEach((b) => { if (b) b.disabled = false; });
      }
    }
    function reset() {
      setMsg("");
      setStatus("Ready");
      results.style.display = "none";
      results.innerHTML = "";
    }
    return { runAction, reset };
  }

  // Shared open/close/outside-click/Escape wiring for an anchored popover.
  function setupPopover({ popover, toggle, closeBtn, input, onOpen }) {
    function open() {
      popover.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      if (window.matchMedia("(max-width: 860px)").matches) {
        document.documentElement.classList.add("ai-ask-open");
      }
      if (onOpen) onOpen();
      if (input) input.focus();
    }
    function close() {
      popover.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      document.documentElement.classList.remove("ai-ask-open");
    }
    toggle.addEventListener("click", () => (popover.hidden ? open() : close()));
    if (closeBtn) closeBtn.addEventListener("click", close);
    document.addEventListener("click", (e) => {
      if (!popover.hidden && !popover.contains(e.target) && e.target !== toggle && !toggle.contains(e.target)) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !popover.hidden) close();
    });
    return { open, close };
  }

  // --- Sidebar panel (Improve / Rhyme / Ideas / Ask / More tools) ------------
  const section = document.getElementById("aiSection");
  if (section) {
    const sidebarEls = {
      improveBtn: document.getElementById("aiImproveBtn"),
      rhymeBtn: document.getElementById("aiRhymeBtn"),
      ideasBtn: document.getElementById("aiIdeasBtn"),
      askInput: document.getElementById("aiAskInput"),
      askBtn: document.getElementById("aiAskBtn"),
      titleBtn: document.getElementById("aiTitleBtn"),
      tagBtn: document.getElementById("aiTagBtn"),
      structureBtn: document.getElementById("aiStructureBtn"),
      translateLang: document.getElementById("aiTranslateLang"),
      translateBtn: document.getElementById("aiTranslateBtn"),
      toneInput: document.getElementById("aiToneInput"),
      toneBtn: document.getElementById("aiToneBtn"),
      moreToggle: document.getElementById("aiMoreToggle"),
      more: document.getElementById("aiMore")
    };
    const sidebar = createSurface({
      msg: document.getElementById("aiMsg"),
      status: document.getElementById("aiStatus"),
      orb: document.getElementById("aiOrb"),
      results: document.getElementById("aiResults"),
      buttons: [
        sidebarEls.improveBtn, sidebarEls.rhymeBtn, sidebarEls.ideasBtn, sidebarEls.askBtn,
        sidebarEls.titleBtn, sidebarEls.tagBtn, sidebarEls.structureBtn, sidebarEls.translateBtn, sidebarEls.toneBtn
      ]
    });

    sidebarEls.improveBtn.addEventListener("click", () => sidebar.runAction("improve", "Improve the selected line."));
    sidebarEls.rhymeBtn.addEventListener("click", () => sidebar.runAction("rhyme", "Analyse the rhyme and structure."));
    sidebarEls.ideasBtn.addEventListener("click", () => sidebar.runAction("ideas", "Give me creative directions for this song."));
    sidebarEls.askBtn.addEventListener("click", () => {
      const question = sidebarEls.askInput.value.trim();
      if (!question) return;
      sidebar.runAction("ask", question);
    });
    sidebarEls.askInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); sidebarEls.askBtn.click(); }
    });

    sidebarEls.moreToggle.addEventListener("click", () => {
      const expanded = sidebarEls.moreToggle.getAttribute("aria-expanded") === "true";
      sidebarEls.moreToggle.setAttribute("aria-expanded", String(!expanded));
      sidebarEls.more.hidden = expanded;
    });
    sidebarEls.titleBtn.addEventListener("click", () => sidebar.runAction("title", "Suggest song titles."));
    sidebarEls.tagBtn.addEventListener("click", () => sidebar.runAction("tag", "Classify the genre, mood and tempo."));
    sidebarEls.structureBtn.addEventListener("click", () => sidebar.runAction("structure", "Suggest a verse/chorus/bridge structure."));
    sidebarEls.translateBtn.addEventListener("click", () => {
      const language = sidebarEls.translateLang.value;
      sidebar.runAction("translate", `Translate this into ${language}.`, languageTag(language));
    });
    sidebarEls.toneBtn.addEventListener("click", () => {
      const tone = sidebarEls.toneInput.value.trim();
      if (!tone) return;
      sidebar.runAction("tone", `Rewrite the tone: ${tone}.`);
    });
    sidebarEls.toneInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); sidebarEls.toneBtn.click(); }
    });

    document.addEventListener("lb-lyric-open", () => sidebar.reset());
  }

  // --- Editor-bar "Ask AI" popover --------------------------------------------
  const popover = document.getElementById("aiAskPopover");
  const toggle = document.getElementById("aiAskToggle");
  if (popover && toggle) {
    const popoverEls = {
      input: document.getElementById("aiPopoverInput"),
      scope: document.getElementById("aiPopoverScope"),
      send: document.getElementById("aiPopoverSend"),
      close: document.getElementById("aiAskPopoverClose")
    };
    function refreshScopeOptions() {
      const previous = popoverEls.scope.value || "lyric";
      const lines = (body?.value || "").split(/\r?\n/);
      const options = [new Option("The whole lyric", "lyric")];
      if (selectedLyricText()) options.push(new Option("Selected text", "selection"));
      lines.forEach((line, index) => {
        const excerpt = line.trim().replace(/\s+/g, " ");
        const label = excerpt ? excerpt.slice(0, 48) + (excerpt.length > 48 ? "…" : "") : "(blank line)";
        options.push(new Option(`Line ${index + 1}: ${label}`, `line:${index}`));
      });
      popoverEls.scope.replaceChildren(...options);
      popoverEls.scope.value = options.some((option) => option.value === previous) ? previous : "lyric";
    }
    function scopedLyricText() {
      const scope = popoverEls.scope.value;
      if (scope === "selection") return selectedLyricText();
      if (scope.startsWith("line:")) {
        const lineIndex = Number(scope.slice(5));
        return (body?.value || "").split(/\r?\n/)[lineIndex] || "";
      }
      return "";
    }
    const popoverSurface = createSurface({
      msg: document.getElementById("aiPopoverMsg"),
      status: document.getElementById("aiPopoverStatus"),
      orb: document.getElementById("aiPopoverOrb"),
      results: document.getElementById("aiPopoverResults"),
      buttons: [popoverEls.send],
      getSelectedText: scopedLyricText
    });
    const popoverCtrl = setupPopover({
      popover,
      toggle,
      closeBtn: popoverEls.close,
      input: popoverEls.input,
      onOpen: refreshScopeOptions
    });

    function ask() {
      const question = popoverEls.input.value.trim();
      if (!question) return;
      popoverSurface.runAction("ask", question, detectSpeechLanguage(question));
    }
    popoverEls.send.addEventListener("click", ask);
    popoverEls.scope.addEventListener("focus", refreshScopeOptions);
    body?.addEventListener("input", () => {
      if (!popover.hidden) refreshScopeOptions();
    });
    popoverEls.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); ask(); }
    });
    document.addEventListener("lb-lyric-open", () => {
      popoverCtrl.close();
      popoverEls.input.value = "";
      popoverEls.scope.value = "lyric";
      popoverSurface.reset();
    });
  }

  // --- Smart search: LLM-ranked search over the user's own lyrics ------------
  const smartSearchBtn = document.getElementById("aiSmartSearchBtn");
  const lyricSearchInput = document.getElementById("lyricSearch");
  const searchMsg = document.getElementById("aiSearchMsg");
  if (smartSearchBtn && lyricSearchInput) {
    function setSearchMsg(text, isError) {
      searchMsg.textContent = text || "";
      searchMsg.className = "msg" + (isError ? " err" : "");
    }
    smartSearchBtn.addEventListener("click", async () => {
      const query = lyricSearchInput.value.trim();
      if (!query) { setSearchMsg("Type something to search for first.", true); return; }
      smartSearchBtn.disabled = true;
      setSearchMsg("Searching…");
      try {
        const data = await window.LB.apiFetch("/api/lyrics/search", { method: "POST", body: JSON.stringify({ query }) });
        const ids = (data.matches || []).map((m) => Number(m.id));
        setSearchMsg(ids.length ? "" : "No matching lyrics found.");
        document.dispatchEvent(new CustomEvent("lb-search-results", { detail: { ids } }));
      } catch (err) {
        setSearchMsg(err.message || "Could not search your lyrics.", true);
      } finally {
        smartSearchBtn.disabled = false;
      }
    });
    // Typing manually escapes AI search mode back to the plain text filter.
    lyricSearchInput.addEventListener("input", () => {
      setSearchMsg("");
      document.dispatchEvent(new CustomEvent("lb-search-results", { detail: { ids: null } }));
    });
  }
})();

