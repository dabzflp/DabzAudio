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
    giftAnyBtn: document.getElementById("giftAnyBtn"),
    giftBtn: document.getElementById("giftBtn"),
    // Gift modal
    giftModal: document.getElementById("giftModal"),
    giftClose: document.getElementById("giftClose"),
    giftForm: document.getElementById("giftForm"),
    giftRecipient: document.getElementById("giftRecipient"),
    giftRecipientSearch: document.getElementById("giftRecipientSearch"),
    giftRecipientResults: document.getElementById("giftRecipientResults"),
    giftSelected: document.getElementById("giftSelected"),
    giftAmount: document.getElementById("giftAmount"),
    giftPresets: document.getElementById("giftPresets"),
    giftMessage: document.getElementById("giftMessage"),
    giftCurrency: document.getElementById("giftCurrency"),
    giftMsg: document.getElementById("giftMsg"),
    // Gifts & payouts modal
    giftsModal: document.getElementById("giftsModal"),
    giftsClose: document.getElementById("giftsClose"),
    handleInput: document.getElementById("handleInput"),
    handleSaveBtn: document.getElementById("handleSaveBtn"),
    handleMsg: document.getElementById("handleMsg"),
    payoutStatus: document.getElementById("payoutStatus"),
    payoutActions: document.getElementById("payoutActions"),
    walletCard: document.getElementById("walletCard"),
    walletBalance: document.getElementById("walletBalance"),
    walletPending: document.getElementById("walletPending"),
    withdrawBtn: document.getElementById("withdrawBtn"),
    walletMsg: document.getElementById("walletMsg"),
    sendGiftBtn: document.getElementById("sendGiftBtn"),
    giftTotal: document.getElementById("giftTotal"),
    tabReceived: document.getElementById("tabReceived"),
    tabSent: document.getElementById("tabSent"),
    giftReceived: document.getElementById("giftReceived"),
    giftSent: document.getElementById("giftSent")
  };
  if (!els.giftsBtn || !els.giftBtn) return;

  let config = { enabled: false, currency: "usd", minAmount: 1, maxAmount: 1000, feeBps: 0 };
  let currentLyricId = null;
  // The lyric to attach to the gift — only set when the chosen recipient is a
  // collaborator on the open lyric (otherwise the gift is lyric-agnostic).
  let selectedLyricId = null;
  let searchTimer = null;

  init();

  async function init() {
    try {
      config = await window.LB.apiFetch("/api/gifts/config");
    } catch {
      return; // server too old / unreachable — leave the feature dormant
    }
    if (!config.enabled) return; // gifting not configured on the server

    els.giftsBtn.hidden = false;
    if (els.giftAnyBtn) els.giftAnyBtn.hidden = false;
    els.giftCurrency.textContent = config.currency.toUpperCase();
    els.giftAmount.min = config.minAmount;
    els.giftAmount.max = config.maxAmount;
    renderPresets();
    wire();
    handleReturnParams();
  }

  function wire() {
    els.giftsBtn.addEventListener("click", openGiftsModal);
    if (els.giftAnyBtn) els.giftAnyBtn.addEventListener("click", () => openGiftModal({ fromLyric: false }));
    els.giftBtn.addEventListener("click", () => openGiftModal({ fromLyric: true }));
    els.sendGiftBtn.addEventListener("click", () => { hide(els.giftsModal); openGiftModal({ fromLyric: false }); });
    els.giftClose.addEventListener("click", () => hide(els.giftModal));
    els.giftsClose.addEventListener("click", () => hide(els.giftsModal));
    els.giftForm.addEventListener("submit", submitGift);
    els.withdrawBtn.addEventListener("click", withdraw);
    if (els.handleSaveBtn) els.handleSaveBtn.addEventListener("click", saveHandle);
    els.giftRecipientSearch.addEventListener("input", onSearchInput);
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

  /* ---------- Gift any artist ---------- */
  async function openGiftModal(opts) {
    const fromLyric = !!(opts && opts.fromLyric);
    setMsg("");
    els.giftAmount.value = "";
    els.giftMessage.value = "";
    els.giftRecipientSearch.value = "";
    clearRecipient();
    els.giftRecipientResults.hidden = true;
    els.giftModal.hidden = false;

    // Quick-picks: collaborators on the open lyric first, else people I know.
    const lyricId = fromLyric ? (currentLyricId || (window.LBApp && window.LBApp.getCurrentLyricId())) : null;
    els.giftRecipientResults.hidden = false;
    els.giftRecipientResults.innerHTML = "<div class='gift-result-note'>Loading…</div>";
    try {
      let users, scopedLyricId = null;
      if (lyricId) {
        const data = await window.LB.apiFetch("/api/gifts/recipients?lyricId=" + lyricId);
        users = data.recipients || [];
        scopedLyricId = lyricId;
      } else {
        const data = await window.LB.apiFetch("/api/gifts/suggestions");
        users = data.users || [];
      }
      if (!users.length) {
        els.giftRecipientResults.innerHTML = "<div class='gift-result-note'>Search an artist by their @username above.</div>";
        return;
      }
      const label = lyricId ? "Collaborators on this lyric" : "People you've worked with — or search any @username above";
      renderResults(users, scopedLyricId, label);
    } catch (err) {
      els.giftRecipientResults.innerHTML = "<div class='gift-result-note'>Search an artist by their @username above.</div>";
    }
  }

  function onSearchInput() {
    const q = els.giftRecipientSearch.value.trim();
    clearTimeout(searchTimer);
    if (q.length < 1) { els.giftRecipientResults.hidden = true; return; }
    searchTimer = setTimeout(async () => {
      els.giftRecipientResults.hidden = false;
      els.giftRecipientResults.innerHTML = "<div class='gift-result-note'>Searching…</div>";
      try {
        const query = q.replace(/^@/, "");
        const data = await window.LB.apiFetch("/api/gifts/search-users?q=" + encodeURIComponent(query));
        const users = data.users || [];
        if (!users.length) {
          els.giftRecipientResults.innerHTML = "<div class='gift-result-note'>No artist with that username. Usernames are unique — check the exact @handle.</div>";
          return;
        }
        renderResults(users, null, "");
      } catch (err) {
        els.giftRecipientResults.innerHTML = "<div class='gift-result-note'>Could not search.</div>";
      }
    }, 220);
  }

  function renderResults(users, scopedLyricId, label) {
    els.giftRecipientResults.innerHTML = "";
    if (label) {
      const h = document.createElement("div");
      h.className = "gift-result-note";
      h.textContent = label;
      els.giftRecipientResults.appendChild(h);
    }
    users.forEach((u) => {
      // Rows are always clickable; if the artist can't receive yet we say so
      // on click rather than leaving a dead, unclickable option.
      const row = document.createElement("button");
      row.type = "button";
      row.className = "gift-result" + (u.canReceive ? "" : " muted");
      const av = document.createElement("span");
      av.className = "gift-result-av";
      if (u.avatarUrl) av.style.backgroundImage = `url(${u.avatarUrl})`;
      else av.textContent = (u.name || u.username || "?").slice(0, 1).toUpperCase();
      const nm = document.createElement("span");
      nm.className = "gift-result-name";
      const handle = u.username ? "@" + u.username : "";
      nm.innerHTML = `<b>${escapeHtml(u.name || handle)}</b>` +
        (handle ? ` <span class="gift-result-handle">${escapeHtml(handle)}</span>` : "") +
        (u.canReceive ? "" : ` <span class="gift-result-handle">· no payouts yet</span>`);
      row.appendChild(av);
      row.appendChild(nm);
      row.addEventListener("click", () => selectRecipient(u, scopedLyricId));
      els.giftRecipientResults.appendChild(row);
    });
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  function selectRecipient(u, scopedLyricId) {
    if (!u.canReceive) {
      const who = u.username ? "@" + u.username : u.name;
      setMsg(`${who} hasn't set up payouts yet, so they can't receive gifts.`, "err");
      return;
    }
    els.giftRecipient.value = String(u.userId);
    selectedLyricId = scopedLyricId || null;
    els.giftRecipientResults.hidden = true;
    els.giftRecipientSearch.value = "";
    els.giftSelected.hidden = false;
    els.giftSelected.innerHTML = "";
    const chip = document.createElement("span");
    chip.className = "gift-chip";
    chip.textContent = u.username ? "@" + u.username : u.name;
    const x = document.createElement("button");
    x.type = "button";
    x.className = "gift-chip-x";
    x.setAttribute("aria-label", "Change recipient");
    x.textContent = "×";
    x.addEventListener("click", () => { clearRecipient(); els.giftRecipientSearch.focus(); });
    chip.appendChild(x);
    els.giftSelected.appendChild(chip);
    setMsg("");
  }

  function clearRecipient() {
    els.giftRecipient.value = "";
    selectedLyricId = null;
    els.giftSelected.hidden = true;
    els.giftSelected.innerHTML = "";
  }

  async function submitGift(e) {
    e.preventDefault();
    const toUserId = Number(els.giftRecipient.value);
    const amount = Number(els.giftAmount.value);
    const message = els.giftMessage.value.trim();
    if (!toUserId) return setMsg("Pick an artist to gift.", "err");
    if (!(amount >= config.minAmount && amount <= config.maxAmount)) {
      return setMsg(`Enter an amount between ${config.minAmount} and ${config.maxAmount}.`, "err");
    }
    setMsg("Opening secure checkout…");
    els.giftForm.querySelector("button[type=submit]").disabled = true;
    try {
      const data = await window.LB.apiFetch("/api/gifts", {
        method: "POST",
        body: JSON.stringify({ toUserId, lyricId: selectedLyricId, amount, message })
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
    els.walletCard.hidden = true;
    els.walletMsg.textContent = "";
    els.giftTotal.hidden = true;
    els.giftReceived.innerHTML = "";
    els.giftSent.innerHTML = "";
    switchTab("received");
    if (els.handleMsg) els.handleMsg.textContent = "";
    await Promise.all([loadHandle(), loadPayoutStatus(), loadWallet(), loadHistory()]);
  }

  /* ---------- Gift handle (@username) ---------- */
  async function loadHandle() {
    if (!els.handleInput) return;
    try {
      const me = await window.LB.apiFetch("/api/auth/me");
      els.handleInput.value = (me.profile && me.profile.username) || "";
    } catch {
      /* leave blank */
    }
  }

  async function saveHandle() {
    if (!els.handleInput) return;
    const username = els.handleInput.value.trim().toLowerCase();
    els.handleInput.value = username;
    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      setHandleMsg("3–20 lowercase letters, numbers or underscores.", "err");
      return;
    }
    els.handleSaveBtn.disabled = true;
    setHandleMsg("Saving…");
    try {
      await window.LB.apiFetch("/api/profile", {
        method: "PUT",
        body: JSON.stringify({ username })
      });
      setHandleMsg("Saved — you're now @" + username, "ok");
    } catch (err) {
      setHandleMsg(err.message || "Could not save username.", "err");
    } finally {
      els.handleSaveBtn.disabled = false;
    }
  }

  function setHandleMsg(text, kind) {
    if (!els.handleMsg) return;
    els.handleMsg.textContent = text || "";
    els.handleMsg.className = "msg" + (kind ? " " + kind : "");
  }

  /* ---------- Wallet (balance + on-demand withdraw) ---------- */
  async function loadWallet() {
    try {
      const w = await window.LB.apiFetch("/api/wallet/balance");
      if (!w.enabled || !w.payoutsEnabled) { els.walletCard.hidden = true; return; }
      els.walletCard.hidden = false;
      els.walletBalance.textContent = formatCents(w.availableCents);
      if (w.pendingCents > 0) {
        els.walletPending.hidden = false;
        els.walletPending.textContent = formatCents(w.pendingCents) + " still settling";
      } else {
        els.walletPending.hidden = true;
        els.walletPending.textContent = "";
      }
      els.withdrawBtn.disabled = !(w.availableCents > 0);
      els.withdrawBtn.title = w.availableCents > 0 ? "" : "No settled funds to withdraw yet";
    } catch (err) {
      els.walletCard.hidden = true;
    }
  }

  async function withdraw() {
    els.walletMsg.className = "msg";
    els.walletMsg.textContent = "Sending to your bank…";
    els.withdrawBtn.disabled = true;
    try {
      const d = await window.LB.apiFetch("/api/wallet/withdraw", { method: "POST" });
      els.walletMsg.className = "msg ok";
      els.walletMsg.textContent = "Withdrew " + formatCents(d.amountCents) + " to your bank.";
      toast("Withdrawal on its way to your bank 🏦");
      await loadWallet();
    } catch (err) {
      els.walletMsg.className = "msg err";
      els.walletMsg.textContent = err.message || "Could not withdraw right now.";
      els.withdrawBtn.disabled = false;
    }
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
