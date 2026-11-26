(function () {
  function showOverlay() {
    let overlay = document.getElementById("dpLaunchOverlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "dpLaunchOverlay";
      overlay.className = "dp-launch-overlay";
      overlay.setAttribute("role", "status");
      overlay.setAttribute("aria-live", "polite");
      overlay.innerHTML =
        '<div class="dp-launch-card">' +
          '<div class="dp-launch-brand"><span class="dp-launch-mark" aria-hidden="true">D&Lambda;</span><span>Drop Pilot</span></div>' +
          '<div class="ai-orb is-thinking dp-launch-orb" aria-hidden="true"><span></span><span></span><span></span></div>' +
          '<h3 class="dp-launch-title">Opening Drop Pilot…</h3>' +
          '<p class="dp-launch-sub" id="dpLaunchStatus">Verifying your Pro session…</p>' +
          '<div class="dp-launch-track" aria-hidden="true"><div class="dp-launch-bar"></div></div>' +
        "</div>";
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add("is-visible"));
    }
    return overlay;
  }

  function setStatus(text) {
    const el = document.getElementById("dpLaunchStatus");
    if (el) el.textContent = text;
  }

  function hideOverlay() {
    const overlay = document.getElementById("dpLaunchOverlay");
    if (overlay) overlay.remove();
  }

  async function launchDropPilot({ triggerBtn, onError } = {}) {
    if (triggerBtn) triggerBtn.disabled = true;
    showOverlay();
    setStatus("Verifying your Pro session…");
    try {
      const r = await window.LB.apiFetch("/api/droppilot/launch", { method: "POST", body: "{}" });
      setStatus("Connecting to Drop Pilot studio…");
      const theme = window.dabzTheme ? window.dabzTheme.get() : "dark";
      location.assign(`${r.url}&theme=${encodeURIComponent(theme)}`);
    } catch (err) {
      hideOverlay();
      if (triggerBtn) triggerBtn.disabled = false;
      if (typeof onError === "function") onError(err);
      else if (window.dabzAlert) window.dabzAlert(err.message || "Could not open Drop Pilot.");
    }
  }

  window.launchDropPilot = launchDropPilot;

  const btn = document.getElementById("dropPilotBtn");
  let pro = false;

  async function init() {
    if (!btn || !window.LB || !window.LB.isAuthed()) return;
    try {
      const sub = await window.LB.apiFetch("/api/subscription");
      pro = !!sub.proActive;
      btn.hidden = false;
    } catch { /* leave the button hidden if billing can't be read */ }
  }

  if (btn) {
    btn.addEventListener("click", () => {
      if (!pro) { location.assign("subscription.html#proPanel"); return; }
      launchDropPilot({ triggerBtn: btn });
    });
  }

  // Returning with the Back button restores the page from cache with the overlay/button state intact.
  window.addEventListener("pageshow", () => {
    hideOverlay();
    if (btn) btn.disabled = false;
  });

  // Deep links from Drop Pilot's sidebar, e.g. app.html?open=invoices
  const open = new URLSearchParams(location.search).get("open");
  const targets = { invoices: "invoicesBtn", gifts: "giftsBtn", gift: "giftAnyBtn" };
  if (targets[open]) {
    let tries = 0;
    const timer = setInterval(() => {
      const target = document.getElementById(targets[open]);
      if (target && !target.hidden) { clearInterval(timer); history.replaceState(null, "", location.pathname); target.click(); }
      else if (++tries > 40) clearInterval(timer);
    }, 250);
  }

  init();
})();
