/**
 * gifts.js — "Gift Me" for the Lyric Book (Stripe Connect).
 *
 * Self-contained: reads the open lyric id from window.LBApp and talks to the
 * /api/gifts and /api/payouts routes. Does nothing if the user isn't signed in
 * or if gifting is disabled on the server (no Stripe key), so the rest of the
 * Lyric Book is completely unaffected.
 */
(function () {
  if (!window.LB || !window.LB.isAuthed()) return;

  const els = {
    giftsBtn: document.getElementById("giftsBtn"),
    giftBtn: document.getElementById("giftBtn"),
    // Gift modal
    giftModal: document.getElementById("giftModal"),
    giftClose: document.getElementById("giftClose"),
    giftForm: document.getElementById("giftForm"),
    giftRecipient: document.getElementById("giftRecipient"),
    giftAmount: document.getElementById("giftAmount"),
    giftPresets: document.getElementById("giftPresets"),
    giftMessage: document.getElementById("giftMessage"),
    giftCurrency: document.getElementById("giftCurrency"),
    giftMsg: document.getElementById("giftMsg"),
    // Gifts & payouts modal
    giftsModal: document.getElementById("giftsModal"),
    giftsClose: document.getElementById("giftsClose"),
    payoutStatus: document.getElementById("payoutStatus"),
    payoutActions: document.getElementById("payoutActions"),
    giftTotal: document.getElementById("giftTotal"),
    tabReceived: document.getElementById("tabReceived"),
    tabSent: document.getElementById("tabSent"),
    giftReceived: document.getElementById("giftReceived"),
    giftSent: document.getElementById("giftSent")
  };
  if (!els.giftsBtn || !els.giftBtn) return;

  let config = { enabled: false, currency: "usd", minAmount: 1, maxAmount: 1000, feeBps: 0 };
  let currentLyricId = null;

  init();

  async function init() {
    try {
      config = await window.LB.apiFetch("/api/gifts/config");
    } catch {
      return; // server too old / unreachable — leave the feature dormant
    }
    if (!config.enabled) return; // gifting not configured on the server

    els.giftsBtn.hidden = false;
    els.giftCurrency.textContent = config.currency.toUpperCase();
    els.giftAmount.min = config.minAmount;
    els.giftAmount.max = config.maxAmount;
    renderPresets();
    wire();
    handleReturnParams();
  }

  function wire() {
    els.giftsBtn.addEventListener("click", openGiftsModal);
    els.giftBtn.addEventListener("click", openGiftModal);
    els.giftClose.addEventListener("click", () => hide(els.giftModal));
    els.giftsClose.addEventListener("click", () => hide(els.giftsModal));
    els.giftForm.addEventListener("submit", submitGift);
    els.tabReceived.addEventListener("click", () => switchTab("received"));
    els.tabSent.addEventListener("click", () => switchTab("sent"));
    [els.giftModal, els.giftsModal].forEach((m) => {
      m.addEventListener("click", (e) => {
        if (e.target === m) hide(m);
      });
    });
    document.addEventListener("lb-lyric-open", (e) => {
      currentLyricId = (e.detail && e.detail.id) || null;
      els.giftBtn.hidden = !currentLyricId;
    });
  }

  /* ---------- Gift a collaborator ---------- */
  async function openGiftModal() {
    const lyricId = currentLyricId || (window.LBApp && window.LBApp.getCurrentLyricId());
    if (!lyricId) return;
    setMsg("");
    els.giftAmount.value = "";
    els.giftMessage.value = "";
    els.giftRecipient.innerHTML = "<option>Loading…</option>";
    els.giftModal.hidden = false;
    try {
      const data = await window.LB.apiFetch("/api/gifts/recipients?lyricId=" + lyricId);
      const recipients = data.recipients || [];
      if (!recipients.length) {
        els.giftRecipient.innerHTML = "<option value=''>No collaborators yet</option>";
        setMsg("Share this lyric with someone first — then you can gift them.", "err");
        return;
      }
      els.giftRecipient.innerHTML = "";
      recipients.forEach((r) => {
        const opt = document.createElement("option");
        opt.value = r.userId;
        opt.textContent = r.canReceive ? r.name : `${r.name} (hasn't set up payouts)`;
        opt.disabled = !r.canReceive;
        els.giftRecipient.appendChild(opt);
      });
      // Select the first enabled recipient if the first is disabled.
      const firstEnabled = recipients.find((r) => r.canReceive);
      if (firstEnabled) els.giftRecipient.value = String(firstEnabled.userId);
      if (!firstEnabled) setMsg("No collaborator here has set up payouts yet.", "err");
    } catch (err) {
      els.giftRecipient.innerHTML = "<option value=''>Could not load</option>";
      setMsg(err.message || "Could not load collaborators.", "err");
    }
  }

  async function submitGift(e) {
    e.preventDefault();
    const toUserId = Number(els.giftRecipient.value);
    const amount = Number(els.giftAmount.value);
    const message = els.giftMessage.value.trim();
    if (!toUserId) return setMsg("Pick who to gift.", "err");
    if (!(amount >= config.minAmount && amount <= config.maxAmount)) {
      return setMsg(`Enter an amount between ${config.minAmount} and ${config.maxAmount}.`, "err");
    }
    setMsg("Opening secure checkout…");
    els.giftForm.querySelector("button[type=submit]").disabled = true;
    try {
      const data = await window.LB.apiFetch("/api/gifts", {
        method: "POST",
        body: JSON.stringify({ toUserId, lyricId: currentLyricId, amount, message })
      });
      if (data.url) {
        window.location.href = data.url; // Stripe Checkout
      } else {
        setMsg("Could not start checkout.", "err");
      }
    } catch (err) {
      setMsg(err.message || "Could not start the gift.", "err");
    } finally {
      els.giftForm.querySelector("button[type=submit]").disabled = false;
    }
  }

  function renderPresets() {
    els.giftPresets.innerHTML = "";
    [5, 10, 20, 50].forEach((v) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "gift-preset";
      b.textContent = formatMajor(v);
      b.addEventListener("click", () => { els.giftAmount.value = v; });
      els.giftPresets.appendChild(b);
    });
  }

  /* ---------- Gifts & payouts ---------- */
  async function openGiftsModal() {
    els.giftsModal.hidden = false;
    els.payoutStatus.textContent = "Loading…";
    els.payoutActions.innerHTML = "";
    els.giftTotal.hidden = true;
    els.giftReceived.innerHTML = "";
    els.giftSent.innerHTML = "";
    switchTab("received");
    await Promise.all([loadPayoutStatus(), loadHistory()]);
  }

  async function loadPayoutStatus() {
    try {
      const s = await window.LB.apiFetch("/api/payouts/account");
      els.payoutActions.innerHTML = "";
      if (s.payoutsEnabled) {
        els.payoutStatus.innerHTML = "<span class='payout-ok'>✓ Payouts active</span> — gifts land in your bank via Stripe.";
        addAction("Open payout dashboard", "btn small", async (btn) => {
          btn.disabled = true;
          try {
            const d = await window.LB.apiFetch("/api/payouts/login-link", { method: "POST" });
            if (d.url) window.open(d.url, "_blank", "noopener");
          } catch (err) {
            alert(err.message || "Could not open dashboard.");
          } finally {
            btn.disabled = false;
          }
        });
      } else if (s.connected) {
        els.payoutStatus.textContent = "Your payout setup is incomplete. Finish it to receive gifts.";
        addAction("Finish payout setup", "btn small", startConnect);
      } else {
        els.payoutStatus.textContent = "Set up payouts to receive gifts from collaborators — Stripe handles ID checks and pays out to your bank.";
        addAction("Set up payouts", "btn small", startConnect);
      }
    } catch (err) {
      els.payoutStatus.textContent = err.message || "Could not load payout status.";
    }
  }

  async function startConnect(btn) {
    if (btn) btn.disabled = true;
    try {
      const d = await window.LB.apiFetch("/api/payouts/connect", { method: "POST" });
      if (d.url) window.location.href = d.url;
    } catch (err) {
      alert(err.message || "Could not start payout setup.");
      if (btn) btn.disabled = false;
    }
  }

  async function loadHistory() {
    try {
      const h = await window.LB.apiFetch("/api/gifts/history");
      if (h.totalReceivedNetCents > 0) {
        els.giftTotal.hidden = false;
        els.giftTotal.innerHTML = "Total received: <b>" + formatCents(h.totalReceivedNetCents) + "</b>";
      }
      renderHistory(els.giftReceived, h.received, "received");
      renderHistory(els.giftSent, h.sent, "sent");
    } catch (err) {
      els.giftReceived.innerHTML = `<li class="empty-note" style="padding:8px">${err.message || "Could not load."}</li>`;
    }
  }

  function renderHistory(ul, items, dir) {
    ul.innerHTML = "";
    if (!items || !items.length) {
      ul.innerHTML = `<li class="empty-note" style="padding:8px">No ${dir} gifts yet.</li>`;
      return;
    }
    items.forEach((g) => {
      const li = document.createElement("li");
      li.className = "gift-row";
      const left = document.createElement("div");
      left.className = "gift-row-main";
      const who = document.createElement("div");
      who.className = "n";
      who.textContent = (dir === "received" ? "From " : "To ") + g.name;
      const sub = document.createElement("div");
      sub.className = "e";
      const parts = [];
      if (g.lyricTitle) parts.push("“" + g.lyricTitle + "”");
      if (g.message) parts.push(g.message);
      sub.textContent = parts.join(" · ") || formatDate(g.createdAt);
      left.appendChild(who);
      left.appendChild(sub);

      const right = document.createElement("div");
      right.className = "gift-row-amt";
      const amt = document.createElement("div");
      amt.className = "amt";
      amt.textContent = formatCents(g.amountCents);
      const st = document.createElement("div");
      st.className = "gift-state " + (g.status === "paid" ? "ok" : g.status === "failed" ? "err" : "pend");
      st.textContent = g.status === "paid" ? "Paid" : g.status === "failed" ? "Failed" : "Pending";
      right.appendChild(amt);
      right.appendChild(st);

      li.appendChild(left);
      li.appendChild(right);
      ul.appendChild(li);
    });
  }

  function switchTab(which) {
    const rec = which === "received";
    els.tabReceived.classList.toggle("active", rec);
    els.tabSent.classList.toggle("active", !rec);
    els.giftReceived.hidden = !rec;
    els.giftSent.hidden = rec;
  }

  /* ---------- Return from Stripe (Checkout / onboarding) ---------- */
  function handleReturnParams() {
    const p = new URLSearchParams(location.search);
    const gift = p.get("gift");
    const payouts = p.get("payouts");
    if (!gift && !payouts) return;
    // Clean the URL so a refresh doesn't re-trigger.
    p.delete("gift");
    p.delete("payouts");
    const qs = p.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));

    if (gift === "success") {
      toast("Gift sent — thank you! 💛");
      openGiftsModal();
    } else if (gift === "cancel") {
      toast("Gift cancelled — no charge was made.");
    }
    if (payouts === "done" || payouts === "refresh") {
      openGiftsModal();
    }
  }

  /* ---------- helpers ---------- */
  function addAction(label, cls, handler) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = label;
    b.addEventListener("click", () => handler(b));
    els.payoutActions.appendChild(b);
  }
  function setMsg(text, kind) {
    els.giftMsg.className = "msg" + (kind ? " " + kind : "");
    els.giftMsg.textContent = text;
  }
  function hide(m) { m.hidden = true; }
  function formatCents(cents) { return formatMajor((cents || 0) / 100); }
  function formatMajor(v) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: config.currency.toUpperCase(),
        minimumFractionDigits: Number.isInteger(v) ? 0 : 2
      }).format(v);
    } catch {
      return config.currency.toUpperCase() + " " + v;
    }
  }
  function formatDate(iso) {
    try { return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" }); }
    catch { return ""; }
  }
  function toast(text) {
    const t = document.createElement("div");
    t.className = "lb-toast";
    t.textContent = text;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 3200);
  }
})();
