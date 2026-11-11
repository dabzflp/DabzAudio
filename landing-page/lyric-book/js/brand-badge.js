// Fills the header badge on signed-in Lyric Book pages with the user's initials
// (or profile photo), so every product shows the same personalised mark.
(function () {
  const CACHE_KEY = "lb_badge";

  function initials(name) {
    let s = String(name || "").trim();
    if (!s) return "DA";
    if (s.includes("@")) s = s.split("@")[0].replace(/[._-]+/g, " ").trim() || s;
    const parts = s.split(/\s+/);
    // First letter of the first name and first letter of the last name.
    const first = Array.from(parts[0])[0] || "";
    const last = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] : "";
    return (first + last).toUpperCase() || "DA";
  }

  function paint(badge, data) {
    badge.textContent = data.initials;
    badge.style.backgroundImage = data.avatarUrl ? 'url("' + data.avatarUrl + '")' : "";
    if (data.avatarUrl) badge.textContent = "";
  }

  function run() {
    const badges = document.querySelectorAll("[data-user-badge]");
    if (!badges.length || !window.LB || !window.LB.isAuthed()) return;
    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
      if (cached) badges.forEach((b) => paint(b, cached));
    } catch { /* ignore bad cache */ }
    window.LB.apiFetch("/api/auth/me").then((me) => {
      const name = (me.profile && (me.profile.artistName || me.profile.displayName)) || me.user.email;
      const data = { initials: initials(name), avatarUrl: (me.profile && me.profile.avatarUrl) || "" };
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* storage full */ }
      badges.forEach((b) => paint(b, data));
    }).catch(() => {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
