(function () {
  const $ = (id) => document.getElementById(id);
  const els = {
    panel: $("proPanel"), upgrade: $("proUpgrade"), active: $("proActive"), currency: $("proCurrency"),
    monthly: $("proMonthly"), annual: $("proAnnual"), price: $("proPrice"), buy: $("proBuy"), note: $("proNote"),
    balance: $("proBalance"), launch: $("proLaunch"), packs: $("proPacks"), costNote: $("proCostNote"), msg: $("proMsg"),
    title: $("proTitle")
  };
  let sub = null;
  let credits = null;

  const period = () => document.querySelector('input[name="proPeriod"]:checked')?.value || "monthly";
  const money = (n, c) => {
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency: c, maximumFractionDigits: 2 }).format(n); }
    catch { return `${c.toUpperCase()} ${n}`; }
  };
  const say = (t, err) => { els.msg.textContent = t || ""; els.msg.className = "msg" + (err ? " err" : " ok"); };

  function currencies() {
    const out = [];
    if (sub.providers?.stripe) (sub.currencies?.stripe || ["usd"]).forEach((c) => out.push(c));
    if (sub.paymentProvider === "paystack") out.push("ngn");
    return out.filter((c) => sub.proPrices?.[c]);
  }

  function renderUpgrade() {
    const list = currencies();
    const prev = els.currency.value;
    els.currency.replaceChildren(...list.map((c) => {
      const o = document.createElement("option");
      o.value = c;
      o.textContent = c === "ngn" ? "Pay in Naira (₦)" : `Pay in ${c.toUpperCase()}`;
      return o;
    }));
    if (list.includes(prev)) els.currency.value = prev;
    updatePrice();
  }

  function updatePrice() {
    const c = els.currency.value;
    const p = sub.proPrices?.[c];
    if (!p) { els.buy.disabled = true; els.note.textContent = "Pro checkout is not available yet."; return; }
    els.monthly.textContent = `${money(p.monthly, c)} each month`;
    els.annual.textContent = `${money(p.annual, c)} each year · save ${money(p.monthly * 12 - p.annual, c)}`;
    const per = period();
    els.price.innerHTML = `${money(p[per], c)} <small>/ ${per === "annual" ? "year" : "month"}</small>`;
    const ready = c === "ngn" ? !!sub.providers?.paystackPro : !!sub.providers?.stripe;
    els.buy.disabled = !ready;
    if (!ready) { els.note.textContent = "Naira checkout for Pro is being set up. Prices above are final."; return; }
    if (sub.tier === "standard" && ["active", "past_due"].includes(sub.status)) {
      const standardPrice = sub.prices?.[c]?.[per];
      const difference = Number.isFinite(standardPrice) ? p[per] - standardPrice : null;
      const cadence = per === "annual" ? "year" : "month";
      const priceNote = difference !== null && difference >= 0
        ? `Compared with Standard on this billing schedule, Pro adds ${money(difference, c)} per ${cadence}. `
        : "";
      els.note.textContent = `${priceNote}Unused time on your current plan is credited towards your first Pro invoice. Includes ${credits?.allowance || 120} AI credits every month.`;
    } else {
      els.note.textContent = "Includes " + (credits?.allowance || 120) + " AI credits every month.";
    }
  }

  function renderActive() {
    const b = credits.balance;
    els.balance.textContent = `${b.total} credits available · ${b.monthly} monthly (resets next month) + ${b.purchased} top-up (never expire)`;
    const c = credits.costs;
    els.costNote.textContent = `A full campaign costs ${c.campaign_generate.standard} credits; a pitch or rewrite costs ${c.pitch_draft.standard}.`;
    els.packs.replaceChildren(...credits.packs.map((pack) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn subtle pro-pack";
      const ngn = sub.paymentProvider === "paystack";
      const price = ngn ? money(pack.ngn, "ngn") : money(pack.usd, "usd");
      btn.innerHTML = `<b>${pack.credits}</b> credits<small>${price}</small>`;
      btn.addEventListener("click", () => buyPack(pack.id, btn));
      return btn;
    }));
  }

  async function buyPack(id, btn) {
    btn.disabled = true;
    say("Opening secure checkout…");
    try {
      const r = await window.LB.apiFetch("/api/credits/checkout", { method: "POST", body: JSON.stringify({ pack: id, currency: "usd" }) });
      location.assign(r.url);
    } catch (err) { say(err.message || "Could not start checkout.", true); btn.disabled = false; }
  }

  async function load() {
    if (!window.LB?.isAuthed()) return;
    try {
      const q = new URLSearchParams(location.search);
      if (q.get("credits") === "paystack" && q.get("reference")) {
        say("Confirming payment…");
        await window.LB.apiFetch("/api/credits/paystack/verify", { method: "POST", body: JSON.stringify({ reference: q.get("reference") }) }).catch(() => {});
        history.replaceState(null, "", location.pathname);
      }
      sub = await window.LB.apiFetch("/api/subscription");
      credits = await window.LB.apiFetch("/api/credits");
      els.panel.hidden = false;
      const hasPro = !!sub.proActive;
      els.upgrade.hidden = hasPro;
      els.active.hidden = !hasPro;
      if (hasPro) {
        els.title.textContent = sub.billingExempt || sub.unlimitedAccess
          ? "Lyric Book Pro · included"
          : "Lyric Book Pro · active";
        renderActive();
      }
      if (!hasPro) renderUpgrade();
      if (q.get("choose") === "pro" && !hasPro) {
        say("You selected Pro during registration. Review the country-eligible price below and choose Get Pro to continue.");
        requestAnimationFrame(() => els.panel.scrollIntoView({ behavior: "smooth", block: "start" }));
      }
      if (q.get("credits") === "success") say("Payment received. Your credits will appear in a moment.");
    } catch { els.panel.hidden = true; }
  }

  els.currency.addEventListener("change", updatePrice);
  document.querySelectorAll('input[name="proPeriod"]').forEach((r) => r.addEventListener("change", updatePrice));
  els.buy.addEventListener("click", async () => {
    els.buy.disabled = true;
    say("Opening secure checkout…");
    try {
      const r = await window.LB.apiFetch("/api/subscription/checkout", {
        method: "POST",
        body: JSON.stringify({ plan: period(), currency: els.currency.value, tier: "pro" })
      });
      location.assign(r.url);
    } catch (err) { say(err.message || "Could not start checkout.", true); els.buy.disabled = false; }
  });
  els.launch.addEventListener("click", async () => {
    els.launch.disabled = true;
    try {
      const r = await window.LB.apiFetch("/api/droppilot/launch", { method: "POST", body: "{}" });
      const theme = window.dabzTheme ? window.dabzTheme.get() : "dark";
      location.assign(`${r.url}&theme=${encodeURIComponent(theme)}`);
    } catch (err) { say(err.message || "Could not open Drop Pilot.", true); els.launch.disabled = false; }
  });

  window.addEventListener("pageshow", () => { els.launch.disabled = false; });

  load();
})();
