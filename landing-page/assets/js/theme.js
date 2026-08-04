(function () {
  "use strict";

  var STORAGE_KEY = "dabz-theme";

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
    var isLight = theme === "light";
    document.documentElement.setAttribute("data-theme", theme);
    setMetaColor(!isLight);
    document.documentElement.classList.toggle("is-light", isLight);
    document.documentElement.classList.toggle("is-dark", !isLight);
    localStorage.setItem(STORAGE_KEY, theme);
    updateIcons(theme);
  }

  function updateIcons(theme) {
    var toggles = document.querySelectorAll(".theme-toggle");
    var sun = '<i class="bi bi-sun" aria-hidden="true"></i>';
    var moon = '<i class="bi bi-moon" aria-hidden="true"></i>';
    toggles.forEach(function (btn) {
      btn.innerHTML = theme === "light" ? moon : sun;
      btn.setAttribute("aria-label", theme === "light" ? "Switch to dark mode" : "Switch to light mode");
    });
  }

  function toggle() {
    var next = resolve() === "dark" ? "light" : "dark";
    apply(next);
  }

  function bind() {
    document.querySelectorAll(".theme-toggle").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        toggle();
      });
    });
    apply(resolve());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  window.dabzTheme = { apply: apply, toggle: toggle, get: resolve };
})();
