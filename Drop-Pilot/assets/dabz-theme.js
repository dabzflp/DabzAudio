/* DabzAudio theme for Drop Pilot: stored choice, ?theme= from Lyric Book, inline [data-dp-theme-btn] controls. */
(function () {
  "use strict";
  var KEY = "dabz-theme";
  var root = document.documentElement;

  function initial() {
    var fromUrl = new URLSearchParams(location.search).get("theme");
    if (fromUrl === "light" || fromUrl === "dark") {
      localStorage.setItem(KEY, fromUrl);
      return fromUrl;
    }
    var saved = localStorage.getItem(KEY);
    return saved === "light" || saved === "dark" ? saved : "dark";
  }

  var SUN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  function syncButtons(theme) {
    var nextLabel = theme === "light" ? "Dark mode" : "Light mode";
    var fullLabel = theme === "light" ? "Switch to dark mode" : "Switch to light mode";
    var icon = theme === "light" ? MOON : SUN;
    document.querySelectorAll("[data-dp-theme-btn]").forEach(function (btn) {
      if (btn.dataset.dpThemeApplied === theme) return;
      btn.dataset.dpThemeApplied = theme;
      btn.title = fullLabel;
      btn.setAttribute("aria-label", fullLabel);
      var iconEl = btn.querySelector("[data-dp-theme-icon]");
      if (iconEl) iconEl.innerHTML = icon;
      var labelEl = btn.querySelector("[data-dp-theme-label]");
      if (labelEl) labelEl.textContent = nextLabel;
    });
  }

  function apply(theme) {
    root.setAttribute("data-theme", theme);
    localStorage.setItem(KEY, theme);
    syncButtons(theme);
  }

  apply(initial());

  document.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest("[data-dp-theme-btn]") : null;
    if (!btn) return;
    e.preventDefault();
    apply(root.getAttribute("data-theme") === "light" ? "dark" : "light");
  });

  function init() {
    syncButtons(root.getAttribute("data-theme") || "dark");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  new MutationObserver(init).observe(document.documentElement, { childList: true, subtree: true });
})();
