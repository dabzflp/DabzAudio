/* DabzAudio theme for Drop Pilot: stored choice, ?theme= from Lyric Book, floating toggle. */
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

  var SUN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  function apply(theme) {
    root.setAttribute("data-theme", theme);
    localStorage.setItem(KEY, theme);
    var btn = document.getElementById("dp-theme-toggle");
    if (btn) {
      btn.innerHTML = theme === "light" ? MOON : SUN;
      var label = theme === "light" ? "Switch to dark mode" : "Switch to light mode";
      btn.title = label;
      btn.setAttribute("aria-label", label);
    }
  }

  apply(initial());

  function mount() {
    if (document.getElementById("dp-theme-toggle")) return;
    var btn = document.createElement("button");
    btn.id = "dp-theme-toggle";
    btn.type = "button";
    btn.addEventListener("click", function () {
      apply(root.getAttribute("data-theme") === "light" ? "dark" : "light");
    });
    document.body.appendChild(btn);
    apply(root.getAttribute("data-theme") || "dark");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
  // Reflex re-renders the page between routes; make sure the button survives.
  new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: false });
})();
