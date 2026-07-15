/* =====================================================================
   DabzAudio — Cookie consent banner
   Lightweight, dependency-free GDPR/PECR-style consent. Injects its own
   styles + DOM, remembers the choice in localStorage, and never blocks the
   page. Essential cookies (sign-in/session) always run; analytics/marketing
   only after the visitor accepts.
   ===================================================================== */
(function () {
  "use strict";

  var KEY = "dabz_cookie_consent"; // stores "all" | "necessary"
  var VERSION = "1"; // bump to re-ask everyone if the policy changes

  // Already answered for this policy version? Do nothing.
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved && saved.v === VERSION) {
      window.DabzConsent = saved;
      return;
    }
  } catch (e) { /* ignore corrupt value */ }

  function save(choice) {
    var val = { v: VERSION, choice: choice, at: new Date().toISOString() };
    try { localStorage.setItem(KEY, JSON.stringify(val)); } catch (e) {}
    window.DabzConsent = val;
    document.dispatchEvent(new CustomEvent("dabz-consent", { detail: val }));
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
    bar.setAttribute("role", "dialog");
    bar.setAttribute("aria-label", "Cookie consent");
    bar.setAttribute("aria-live", "polite");
    bar.innerHTML =
      "<p>We use cookies to keep you signed in and to understand how DabzAudio is used, " +
      "in line with best-practice privacy standards. Essential cookies are always on. " +
      "See our <a href=\"/privacy.html\">Privacy &amp; Cookie Policy</a>.</p>" +
      "<div class=\"dz-cookie-actions\">" +
      "<button type=\"button\" class=\"dz-necessary\">Necessary only</button>" +
      "<button type=\"button\" class=\"primary dz-accept\">Accept all</button>" +
      "</div>";
    document.body.appendChild(bar);
    requestAnimationFrame(function () { bar.classList.add("show"); });

    function done(choice) {
      save(choice);
      bar.classList.remove("show");
      setTimeout(function () { bar.remove(); }, 350);
    }
    bar.querySelector(".dz-accept").addEventListener("click", function () { done("all"); });
    bar.querySelector(".dz-necessary").addEventListener("click", function () { done("necessary"); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
