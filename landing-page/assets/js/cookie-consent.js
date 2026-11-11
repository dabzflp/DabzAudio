/* =====================================================================
   DabzAudio — Cookie consent
   Essential cookies/storage (sign-in, theme, this choice) need no consent.
   Google AdSense is optional: it is NOT loaded until the visitor clicks Accept.
   The choice is stored in localStorage; "Cookie settings" links (any element
   with [data-cookie-settings]) reopen the banner so it can be changed.
   ===================================================================== */
(function () {
  "use strict";

  var KEY = "dabz_cookie_consent";
  var VERSION = "3"; // bump to ask everyone again if the policy changes
  var ADS_SRC = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5406859319354472";

  function read() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || "null");
      return v && v.v === VERSION ? v : null;
    } catch (e) { return null; }
  }

  function save(ads) {
    var val = { v: VERSION, ads: !!ads, at: new Date().toISOString() };
    try { localStorage.setItem(KEY, JSON.stringify(val)); } catch (e) {}
    window.DabzCookieConsent = val;
    return val;
  }

  function loadAds() {
    if (document.getElementById("dabz-adsense")) return;
    var s = document.createElement("script");
    s.id = "dabz-adsense";
    s.async = true;
    s.crossOrigin = "anonymous";
    s.src = ADS_SRC;
    document.head.appendChild(s);
  }

  // Reject after a previous accept: drop AdSense's cookies we can reach and
  // reload so the ad script is no longer running on the page.
  function clearAdCookies() {
    var host = location.hostname.split(".");
    var domains = ["", location.hostname];
    for (var i = 1; i < host.length - 1; i++) domains.push("." + host.slice(i).join("."));
    document.cookie.split(";").forEach(function (c) {
      var name = c.split("=")[0].trim();
      if (!/^(__gads|__gpi|__eoi|_gcl_|IDE|test_cookie|DSID|FCNEC)/i.test(name)) return;
      domains.forEach(function (d) {
        document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/" + (d ? "; domain=" + d : "");
      });
    });
  }

  var saved = read();
  window.DabzCookieConsent = saved;
  if (saved && saved.ads) loadAds();

  function injectStyles() {
    if (document.getElementById("dabz-cookie-style")) return;
    var css =
      ".dz-cookie{position:fixed;left:16px;right:16px;bottom:16px;z-index:10001;" +
      "max-width:760px;margin:0 auto;background:#141414;color:#eee;border:1px solid #2a2a2a;" +
      "border-radius:16px;padding:16px 18px;box-shadow:0 18px 50px rgba(0,0,0,.5);" +
      "font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;" +
      "display:flex;flex-wrap:wrap;align-items:center;gap:12px;" +
      "transform:translateY(140%);transition:transform .35s ease}" +
      ".dz-cookie.show{transform:none}" +
      ".dz-cookie p{margin:0;flex:1 1 280px;color:#cfcfcf}" +
      ".dz-cookie a{color:#ff7a00;text-decoration:none}" +
      ".dz-cookie a:hover{text-decoration:underline}" +
      ".dz-cookie-actions{display:flex;gap:8px;flex-wrap:wrap}" +
      ".dz-cookie button{border-radius:999px;padding:9px 18px;font-size:13px;font-weight:600;" +
      "cursor:pointer;border:1px solid #3a3a3a;background:#1e1e1e;color:#eee}" +
      ".dz-cookie button:hover{border-color:#ff7a00;color:#fff}" +
      ".dz-cookie button:focus-visible{outline:2px solid #ff7a00;outline-offset:2px}" +
      ".dz-cookie button.primary{background:#ff7a00;border-color:#ff7a00;color:#111}" +
      ".dz-cookie button.primary:hover{filter:brightness(1.05);color:#111}" +
      "html[data-theme=light] .dz-cookie{background:#fff;color:#111;border-color:#ddd;box-shadow:0 18px 50px rgba(0,0,0,.15)}" +
      "html[data-theme=light] .dz-cookie p{color:#444}" +
      "html[data-theme=light] .dz-cookie a{color:#b04f00}" +
      "html[data-theme=light] .dz-cookie button{background:#f4f4f4;color:#111;border-color:#ccc}" +
      "html[data-theme=light] .dz-cookie button.primary{background:#d95f00;border-color:#d95f00;color:#fff}" +
      "@media(max-width:520px){.dz-cookie-actions{width:100%}.dz-cookie-actions button{flex:1}}";
    var s = document.createElement("style");
    s.id = "dabz-cookie-style";
    s.textContent = css;
    document.head.appendChild(s);
  }

  function build() {
    if (document.querySelector(".dz-cookie")) return;
    injectStyles();
    var bar = document.createElement("div");
    bar.className = "dz-cookie";
    bar.setAttribute("role", "dialog");
    bar.setAttribute("aria-label", "Cookie choices");
    bar.innerHTML =
      "<p>Essential cookies are always on: they keep you signed in and remember your theme and this choice. " +
      "With your permission we also load Google AdSense on our public pages, which may set advertising cookies. " +
      "See our <a href=\"/privacy.html\">Privacy &amp; Cookie Policy</a>.</p>" +
      "<div class=\"dz-cookie-actions\">" +
      "<button type=\"button\" class=\"dz-reject\">Reject non-essential</button>" +
      "<button type=\"button\" class=\"primary dz-accept\">Accept all</button>" +
      "</div>";
    document.body.appendChild(bar);
    requestAnimationFrame(function () { bar.classList.add("show"); });

    function close() {
      bar.classList.remove("show");
      setTimeout(function () { bar.remove(); }, 350);
    }
    bar.querySelector(".dz-accept").addEventListener("click", function () {
      save(true);
      loadAds();
      close();
    });
    bar.querySelector(".dz-reject").addEventListener("click", function () {
      var hadAds = !!document.getElementById("dabz-adsense");
      save(false);
      clearAdCookies();
      close();
      if (hadAds) location.reload();
    });
    bar.querySelector(".dz-reject").focus({ preventScroll: true });
  }

  function init() {
    if (!read()) build();
    document.querySelectorAll("[data-cookie-settings]").forEach(function (el) {
      el.addEventListener("click", function (e) { e.preventDefault(); build(); });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
