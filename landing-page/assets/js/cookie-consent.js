/* =====================================================================
   DabzAudio — Cookie notice (landing page)
   Lightweight, dependency-free notice. DabzAudio only uses cookies that are
   strictly necessary for the site to function (sign-in/session + remembering
   you dismissed this notice). This banner just lets visitors know; it stores
   the dismissal in localStorage so it doesn't reappear.
   ===================================================================== */
(function () {
  "use strict";

  var KEY = "dabz_cookie_notice"; // stores that the notice was dismissed
  var VERSION = "1"; // bump to re-show everyone if the policy changes

  // Already dismissed for this policy version? Do nothing.
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved && saved.v === VERSION) {
      window.DabzCookieNotice = saved;
      return;
    }
  } catch (e) { /* ignore corrupt value */ }

  function save() {
    var val = { v: VERSION, at: new Date().toISOString() };
    try { localStorage.setItem(KEY, JSON.stringify(val)); } catch (e) {}
    window.DabzCookieNotice = val;
  }

  function injectStyles() {
    if (document.getElementById("dabz-cookie-style")) return;
    var css =
      ".dz-cookie{position:fixed;left:16px;right:16px;bottom:16px;z-index:9000;" +
      "max-width:720px;margin:0 auto;background:#141414;color:#eee;border:1px solid #2a2a2a;" +
      "border-radius:14px;padding:16px 18px;box-shadow:0 18px 50px rgba(0,0,0,.5);" +
      "font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;" +
      "display:flex;flex-wrap:wrap;align-items:center;gap:12px;" +
      "transform:translateY(140%);transition:transform .35s ease}" +
      ".dz-cookie.show{transform:none}" +
      ".dz-cookie p{margin:0;flex:1 1 260px;color:#cfcfcf}" +
      ".dz-cookie a{color:#ff7a00;text-decoration:none}" +
      ".dz-cookie a:hover{text-decoration:underline}" +
      ".dz-cookie-actions{display:flex;gap:8px;flex-wrap:wrap}" +
      ".dz-cookie button{border-radius:999px;padding:9px 16px;font-size:13px;font-weight:600;" +
      "cursor:pointer;border:1px solid #2a2a2a;background:#1e1e1e;color:#ddd}" +
      ".dz-cookie button:hover{border-color:#ff7a00;color:#fff}" +
      ".dz-cookie button.primary{background:#ff7a00;border-color:#ff7a00;color:#111}" +
      ".dz-cookie button.primary:hover{filter:brightness(1.05);color:#111}" +
      "@media(max-width:520px){.dz-cookie-actions{width:100%}.dz-cookie-actions button{flex:1}}";
    var s = document.createElement("style");
    s.id = "dabz-cookie-style";
    s.textContent = css;
    document.head.appendChild(s);
  }

  function build() {
    injectStyles();
    var bar = document.createElement("div");
    bar.className = "dz-cookie";
    bar.setAttribute("role", "note");
    bar.setAttribute("aria-label", "Cookie notice");
    bar.setAttribute("aria-live", "polite");
    bar.innerHTML =
      "<p>DabzAudio uses only the cookies needed for the site to work — to keep you " +
      "signed in and secure your session. No tracking or ads. " +
      "See our <a href=\"/privacy.html\">Privacy &amp; Cookie Policy</a>.</p>" +
      "<div class=\"dz-cookie-actions\">" +
      "<button type=\"button\" class=\"primary dz-ok\">Got it</button>" +
      "</div>";
    document.body.appendChild(bar);
    requestAnimationFrame(function () { bar.classList.add("show"); });

    bar.querySelector(".dz-ok").addEventListener("click", function () {
      save();
      bar.classList.remove("show");
      setTimeout(function () { bar.remove(); }, 350);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
