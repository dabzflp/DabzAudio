(function () {
  const btn = document.getElementById("dropPilotBtn");
  if (!btn) return;
  let pro = false;

  async function init() {
    if (!window.LB || !window.LB.isAuthed()) return;
    try {
      const sub = await window.LB.apiFetch("/api/subscription");
      pro = !!sub.proActive;
      btn.hidden = false;
    } catch { /* leave the button hidden if billing can't be read */ }
  }

  btn.addEventListener("click", async () => {
    if (!pro) { location.assign("subscription.html#proPanel"); return; }
    btn.disabled = true;
    try {
      const r = await window.LB.apiFetch("/api/droppilot/launch", { method: "POST", body: "{}" });
      const theme = window.dabzTheme ? window.dabzTheme.get() : "dark";
      location.assign(`${r.url}&theme=${encodeURIComponent(theme)}`);
    } catch (err) {
      if (window.dabzAlert) window.dabzAlert(err.message || "Could not open Drop Pilot.");
      btn.disabled = false;
    }
  });

  // Returning with the Back button restores the page from cache with the button still disabled.
  window.addEventListener("pageshow", () => { btn.disabled = false; });

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
