(function () {
  "use strict";

  var STORAGE_KEY = "dabz-theme";
  var themeApplyVersion = 0;

  function resolve() {
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function setMetaColor(dark) {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.content = dark ? "#0c0c0c" : "#e8e8e8";
    }
  }

  function apply(theme) {
    var root = document.documentElement;
    var version = ++themeApplyVersion;
    root.classList.add("theme-switching");
    var isLight = theme === "light";
    root.setAttribute("data-theme", theme);
    setMetaColor(!isLight);
    root.classList.toggle("is-light", isLight);
    root.classList.toggle("is-dark", !isLight);
    localStorage.setItem(STORAGE_KEY, theme);
    updateIcons(theme);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (version === themeApplyVersion) root.classList.remove("theme-switching");
      });
    });
  }

  function updateIcons(theme) {
    var toggles = document.querySelectorAll(".theme-toggle");
    var sun = '<i class="bi bi-sun" aria-hidden="true"></i>';
    var moon = '<i class="bi bi-moon" aria-hidden="true"></i>';
    var svgSun = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
    var svgMoon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
    toggles.forEach(function (btn) {
      var own = btn.hasAttribute("data-svg");
      btn.innerHTML = theme === "light" ? (own ? svgMoon : moon) : (own ? svgSun : sun);
      btn.title = theme === "light" ? "Switch to dark mode" : "Switch to light mode";
      btn.setAttribute("aria-label", theme === "light" ? "Switch to dark mode" : "Switch to light mode");
    });
  }

  function toggle() {
    var next = resolve() === "dark" ? "light" : "dark";
    apply(next);
  }

  // Headers marked data-theme-slot get a toggle (product pages have no bootstrap-icons).
  function injectToggles() {
    document.querySelectorAll("[data-theme-slot]").forEach(function (header) {
      if (header.querySelector(".theme-toggle")) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "theme-toggle theme-toggle--header";
      btn.setAttribute("data-svg", "");
      header.appendChild(btn);
      var prev = btn.previousElementSibling;
      if (prev && !prev.classList.contains("brand")) prev.style.marginLeft = "auto";
      else btn.style.marginLeft = "auto";
    });
  }

  function bind() {
    injectToggles();
    document.querySelectorAll(".theme-toggle").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        toggle();
      });
    });
    updateIcons(resolve());
  }

  apply(resolve());

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  window.dabzTheme = { apply: apply, toggle: toggle, get: resolve };
})();
