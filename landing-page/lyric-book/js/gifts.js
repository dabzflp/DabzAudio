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
    giftBreakdown: document.getElementById("giftBreakdown"),
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
    walletExtra: document.getElementById("walletExtra"),
    withdrawBtn: document.getElementById("withdrawBtn"),
    walletMsg: document.getElementById("walletMsg"),
    sendGiftBtn: document.getElementById("sendGiftBtn"),
    giftTotal: document.getElementById("giftTotal"),
    tabReceived: document.getElementById("tabReceived"),
    tabSent: document.getElementById("tabSent"),
    giftReceived: document.getElementById("giftReceived"),
    giftSent: document.getElementById("giftSent"),
    // Embedded (on-page) Stripe modals
    embedCheckoutModal: document.getElementById("embedCheckoutModal"),
    embedCheckoutClose: document.getElementById("embedCheckoutClose"),
    embedCheckoutContainer: document.getElementById("embedCheckoutContainer"),
    embedOnboardModal: document.getElementById("embedOnboardModal"),
    embedOnboardClose: document.getElementById("embedOnboardClose"),
    embedOnboardContainer: document.getElementById("embedOnboardContainer"),
    // Naira (Paystack)
    ngnPayoutCard: document.getElementById("ngnPayoutCard"),
    ngnPayoutStatus: document.getElementById("ngnPayoutStatus"),
    ngnPayoutActions: document.getElementById("ngnPayoutActions"),
    ngnWalletCard: document.getElementById("ngnWalletCard"),
    ngnWalletTotal: document.getElementById("ngnWalletTotal"),
    ngnWalletPending: document.getElementById("ngnWalletPending"),
    ngnWalletSettle: document.getElementById("ngnWalletSettle"),
    ngnModal: document.getElementById("ngnModal"),
    ngnClose: document.getElementById("ngnClose"),
    ngnBank: document.getElementById("ngnBank"),
    ngnAccountNumber: document.getElementById("ngnAccountNumber"),
    ngnResolved: document.getElementById("ngnResolved"),
    ngnSaveBtn: document.getElementById("ngnSaveBtn"),
    ngnMsg: document.getElementById("ngnMsg"),
    giftCurrencyRow: document.getElementById("giftCurrencyRow"),
    giftCurrencySelect: document.getElementById("giftCurrencySelect")
  };
  if (!els.giftsBtn || !els.giftBtn) return;

  let config = { enabled: false, currency: "usd", minAmount: 1, maxAmount: 1000, minWithdrawalCents: 500, feeBps: 0 };
  let paystackConfig = { enabled: false, publicKey: "", currency: "ngn", feeBps: 0, minAmount: 100, maxAmount: 5000000 };
  let stripeGifting = false;
  let selectedRecipient = null;
  let activeCurrency = "usd";      // gift-modal currency: config.currency (Stripe) or "ngn" (Paystack)
  let resolveTimer = null;
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
      config = { enabled: false, currency: "usd", minAmount: 1, maxAmount: 1000, minWithdrawalCents: 500, feeBps: 0 };
    }
    stripeGifting = !!config.enabled;

    // Second rail: Naira (Paystack). Optional — dormant unless configured.
    try {
      paystackConfig = await window.LB.apiFetch("/api/paystack/config");
    } catch {
      paystackConfig = { enabled: false };
    }

    // Nothing configured at all → leave the whole feature dormant.
    if (!stripeGifting && !paystackConfig.enabled) return;

    // Enable on-page (embedded) Stripe when the server provides a publishable key.
    if (config.embedded && config.publishableKey && window.LBStripe) {
      window.LBStripe.pk = config.publishableKey;
    }

    activeCurrency = config.currency;
    els.giftsBtn.hidden = false;
    if (els.giftAnyBtn) els.giftAnyBtn.hidden = false;
    els.giftCurrency.textContent = giftCurrencyCode().toUpperCase();
    els.giftAmount.min = activeMin();
    els.giftAmount.max = activeMax();
    renderPresets();
    wire();
    renderBreakdown();
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
    els.giftAmount.addEventListener("input", renderBreakdown);
    els.withdrawBtn.addEventListener("click", withdraw);
    if (els.handleSaveBtn) els.handleSaveBtn.addEventListener("click", saveHandle);
    els.giftRecipientSearch.addEventListener("input", onSearchInput);
    els.tabReceived.addEventListener("click", () => switchTab("received"));
    els.tabSent.addEventListener("click", () => switchTab("sent"));
    if (els.embedCheckoutClose) els.embedCheckoutClose.addEventListener("click", closeCheckout);
    if (els.embedOnboardClose) els.embedOnboardClose.addEventListener("click", () => hide(els.embedOnboardModal));
    if (els.giftCurrencySelect) els.giftCurrencySelect.addEventListener("change", onCurrencyChange);
    if (els.ngnClose) els.ngnClose.addEventListener("click", () => hide(els.ngnModal));
    if (els.ngnSaveBtn) els.ngnSaveBtn.addEventListener("click", saveNgn);
    if (els.ngnBank) els.ngnBank.addEventListener("change", tryResolveNgn);
    if (els.ngnAccountNumber) els.ngnAccountNumber.addEventListener("input", () => { clearTimeout(resolveTimer); resolveTimer = setTimeout(tryResolveNgn, 350); });
    if (els.ngnModal) els.ngnModal.addEventListener("click", (e) => { if (e.target === els.ngnModal) hide(els.ngnModal); });
    [els.giftModal, els.giftsModal, els.embedCheckoutModal, els.embedOnboardModal].forEach((m) => {
      if (!m) return;
      m.addEventListener("click", (e) => {
        if (e.target === m) { if (m === els.embedCheckoutModal) closeCheckout(); else hide(m); }
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
    renderBreakdown();
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
      const canGet = !!(u.canReceive || u.canReceiveNgn);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "gift-result" + (canGet ? "" : " muted");
      const av = document.createElement("span");
      av.className = "gift-result-av";
      if (u.avatarUrl) av.style.backgroundImage = `url(${u.avatarUrl})`;
      else av.textContent = (u.name || u.username || "?").slice(0, 1).toUpperCase();
      const nm = document.createElement("span");
      nm.className = "gift-result-name";
      const handle = u.username ? "@" + u.username : "";
      const methods = [];
      if (u.canReceive) methods.push("card");
      if (u.canReceiveNgn) methods.push("\u20a6");
      nm.innerHTML = `<b>${escapeHtml(u.name || handle)}</b>` +
        (handle ? ` <span class="gift-result-handle">${escapeHtml(handle)}</span>` : "") +
        (canGet
          ? (methods.length ? ` <span class="gift-result-handle">· ${methods.join(" / ")}</span>` : "")
          : ` <span class="gift-result-handle">· no payouts yet</span>`);
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
    if (!u.canReceive && !u.canReceiveNgn) {
      const who = u.username ? "@" + u.username : u.name;
      setMsg(`${who} hasn't set up payouts yet, so they can't receive gifts.`, "err");
      return;
    }
    selectedRecipient = u;
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
    setupCurrencyForRecipient(u);
    setMsg("");
  }

  function clearRecipient() {
    els.giftRecipient.value = "";
    selectedLyricId = null;
    selectedRecipient = null;
    els.giftSelected.hidden = true;
    els.giftSelected.innerHTML = "";
    if (els.giftCurrencyRow) els.giftCurrencyRow.hidden = true;
    activeCurrency = config.currency;
    els.giftCurrency.textContent = giftCurrencyCode().toUpperCase();
    els.giftAmount.min = activeMin();
    els.giftAmount.max = activeMax();
    renderPresets();
    renderBreakdown();
  }

  async function submitGift(e) {
    e.preventDefault();
    const toUserId = Number(els.giftRecipient.value);
    const amount = Number(els.giftAmount.value);
    const message = els.giftMessage.value.trim();
    if (!toUserId) return setMsg("Pick an artist to gift.", "err");
    if (!(amount >= activeMin() && amount <= activeMax())) {
      return setMsg(`Enter an amount between ${activeMin()} and ${activeMax()}.`, "err");
    }
    if (activeCurrency === "ngn") return submitGiftPaystack(toUserId, amount, message);

    const wantEmbedded = !!(config.embedded && window.LBStripe && window.LBStripe.pk);
    setMsg("Opening secure checkout…");
    els.giftForm.querySelector("button[type=submit]").disabled = true;
    try {
      const data = await window.LB.apiFetch("/api/gifts", {
        method: "POST",
        body: JSON.stringify({ toUserId, lyricId: selectedLyricId, amount, message, currency: giftCurrencyCode(), embedded: wantEmbedded })
      });
      if (data.clientSecret) {
        // Pay on-page — no redirect to a Stripe-hosted page.
        hide(els.giftModal);
        await openCheckout(data.clientSecret);
      } else if (data.url) {
        window.location.href = data.url; // hosted Checkout fallback
      } else {
        setMsg("Could not start checkout.", "err");
      }
    } catch (err) {
      setMsg(err.message || "Could not start the gift.", "err");
    } finally {
      els.giftForm.querySelector("button[type=submit]").disabled = false;
    }
  }

  // Naira gift → Paystack inline popup (no redirect), then verify.
  async function submitGiftPaystack(toUserId, amount, message) {
    const btn = els.giftForm.querySelector("button[type=submit]");
    setMsg("Opening secure checkout…");
    btn.disabled = true;
    let data;
    try {
      data = await window.LB.apiFetch("/api/gifts/paystack", {
        method: "POST",
        body: JSON.stringify({ toUserId, lyricId: selectedLyricId, amount, message })
      });
    } catch (err) {
      setMsg(err.message || "Could not start the gift.", "err");
      btn.disabled = false;
      return;
    }
    hide(els.giftModal);
    try {
      await window.LBPaystack.payWithAccessCode(data.accessCode);
      // Instant UI update; the webhook remains the source of truth.
      try {
        await window.LB.apiFetch("/api/gifts/paystack/verify", {
          method: "POST",
          body: JSON.stringify({ reference: data.reference })
        });
      } catch (e) { /* webhook will reconcile */ }
      toast("Gift sent — thank you! 💛");
      openGiftsModal();
    } catch (err) {
      if (err && err.message === "cancelled") {
        toast("Gift cancelled — no charge was made.");
      } else if (data && data.authorizationUrl) {
        window.location.href = data.authorizationUrl; // hosted fallback
      } else {
        toast("Could not open checkout. Please try again.");
      }
    } finally {
      btn.disabled = false;
    }
  }

  async function openCheckout(clientSecret) {
    if (!els.embedCheckoutModal) return;
    els.embedCheckoutModal.hidden = false;
    els.embedCheckoutContainer.innerHTML = "<p class='sub'>Loading secure checkout…</p>";
    try {
      await window.LBStripe.mountEmbeddedCheckout(els.embedCheckoutContainer, async () => clientSecret);
    } catch (err) {
      els.embedCheckoutContainer.innerHTML = "<p class='sub'>Could not load checkout. Please try again.</p>";
    }
  }

  function closeCheckout() {
    if (window.LBStripe && window.LBStripe.unmountCheckout) window.LBStripe.unmountCheckout();
    if (els.embedCheckoutContainer) els.embedCheckoutContainer.innerHTML = "";
    hide(els.embedCheckoutModal);
  }

  function renderPresets() {
    els.giftPresets.innerHTML = "";
    presetValues().forEach((v) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "gift-preset";
      b.textContent = formatMajor(v, giftCurrencyCode());
      b.addEventListener("click", () => { els.giftAmount.value = v; renderBreakdown(); });
      els.giftPresets.appendChild(b);
    });
  }

  // Show exactly how a gift splits: what the artist receives vs the DabzAudio fee.
  function renderBreakdown() {
    if (!els.giftBreakdown) return;
    const bps = activeFeeBps();
    const feePct = bps / 100;
    const cur = giftCurrencyCode();
    const amount = Number(els.giftAmount.value);
    if (!(amount > 0)) {
      if (feePct > 0) {
        els.giftBreakdown.hidden = false;
        els.giftBreakdown.innerHTML =
          `<span class="gift-breakdown-note">Artist keeps ${(100 - feePct).toLocaleString()}% \u00b7 DabzAudio fee ${feePct.toLocaleString()}%</span>`;
      } else {
        els.giftBreakdown.hidden = true;
      }
      return;
    }
    const fee = Math.round(amount * bps) / 10000;
    const net = amount - fee;
    els.giftBreakdown.hidden = false;
    els.giftBreakdown.innerHTML =
      `<span class="gift-breakdown-row"><span>Artist receives</span><b>${formatMajor(net, cur)}</b></span>` +
      (feePct > 0
        ? `<span class="gift-breakdown-row muted"><span>DabzAudio fee (${feePct.toLocaleString()}%)</span><span>${formatMajor(fee, cur)}</span></span>`
        : `<span class="gift-breakdown-row muted"><span>DabzAudio fee</span><span>Free</span></span>`);
  }

  /* ---------- Gifts & payouts ---------- */
  async function openGiftsModal() {
    els.giftsModal.hidden = false;
    els.payoutStatus.textContent = "Loading…";
    els.payoutActions.innerHTML = "";
    els.walletCard.hidden = true;
    els.walletMsg.textContent = "";
    if (els.ngnWalletCard) els.ngnWalletCard.hidden = true;
    els.giftTotal.hidden = true;
    els.giftReceived.innerHTML = "";
    els.giftSent.innerHTML = "";
    switchTab("received");
    if (els.handleMsg) els.handleMsg.textContent = "";
    await Promise.all([loadHandle(), loadPayoutStatus(), loadNgnPayoutStatus(), loadWallet(), loadNgnWallet(), loadHistory()]);
  }

  /* ---------- Gift handle (@username) ---------- */
  const USERNAME_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

  async function loadHandle() {
    if (!els.handleInput) return;
    try {
      const me = await window.LB.apiFetch("/api/auth/me");
      const prof = me.profile || {};
      els.handleInput.value = prof.username || "";
      const last = prof.usernameUpdatedAt ? new Date(prof.usernameUpdatedAt).getTime() : 0;
      const nextAllowed = last + USERNAME_COOLDOWN_MS;
      if (last && Date.now() < nextAllowed) {
        const d = new Date(nextAllowed).toLocaleDateString(undefined, {
          day: "numeric", month: "short", year: "numeric"
        });
        setHandleMsg("You can change your @username again on " + d + ".", "");
      } else {
        setHandleMsg("You can change your @username once every 30 days.", "");
      }
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
      setHandleMsg("Saved — you're now @" + username + ". You can change it again in 30 days.", "ok");
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
      els.walletBalance.textContent = formatCents(w.availableCents, w.currency);
      if (w.pendingCents > 0) {
        els.walletPending.hidden = false;
        els.walletPending.textContent = formatCents(w.pendingCents, w.currency) + " still settling";
      } else {
        els.walletPending.hidden = true;
        els.walletPending.textContent = "";
      }
      // Gifts can now arrive in other currencies (USD/EUR/…). Show those too.
      const extras = (w.balances || []).filter(
        (b) => b.currency !== w.currency && (b.availableCents > 0 || b.pendingCents > 0)
      );
      if (els.walletExtra) {
        if (extras.length) {
          els.walletExtra.hidden = false;
          els.walletExtra.textContent = "Also: " + extras.map((b) => {
            const p = b.pendingCents > 0 ? " (+" + formatCents(b.pendingCents, b.currency) + " settling)" : "";
            return formatCents(b.availableCents, b.currency) + p;
          }).join(" · ");
        } else {
          els.walletExtra.hidden = true;
          els.walletExtra.textContent = "";
        }
      }
      // Total available across all currencies decides whether withdraw is offered
      // (the backend cashes out each currency it can).
      const totalAvailable = (w.balances && w.balances.length)
        ? w.balances.reduce((s, b) => s + (b.availableCents || 0), 0)
        : w.availableCents;
      const minCents = config.minWithdrawalCents || 0;
      const canWithdraw = totalAvailable >= minCents && totalAvailable > 0;
      els.withdrawBtn.disabled = !canWithdraw;
      if (els.walletMsg) { els.walletMsg.className = "msg"; els.walletMsg.textContent = ""; }
      if (canWithdraw) {
        els.withdrawBtn.title = "";
      } else if (totalAvailable > 0 && minCents > 0) {
        els.withdrawBtn.title = "Minimum withdrawal is " + formatCents(minCents, w.currency);
        if (els.walletMsg) els.walletMsg.textContent = "Minimum withdrawal is " + formatCents(minCents, w.currency) + " — a little more to go.";
      } else {
        els.withdrawBtn.title = "No settled funds to withdraw yet";
      }
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
      const summary = (d.payouts && d.payouts.length)
        ? d.payouts.map((p) => formatCents(p.amountCents, p.currency)).join(" + ")
        : formatCents(d.amountCents, d.currency);
      els.walletMsg.className = "msg ok";
      els.walletMsg.textContent = "Withdrew " + summary + " to your bank.";
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
    // Prefer on-page (embedded) onboarding; fall back to hosted redirect.
    if (config.embedded && window.LBStripe && window.LBStripe.pk && els.embedOnboardModal) {
      try {
        await openOnboarding();
        if (btn) btn.disabled = false;
        return;
      } catch (err) {
        // fall through to hosted redirect below
      }
    }
    try {
      const d = await window.LB.apiFetch("/api/payouts/connect", { method: "POST" });
      if (d.url) window.location.href = d.url;
    } catch (err) {
      alert(err.message || "Could not start payout setup.");
      if (btn) btn.disabled = false;
    }
  }

  async function openOnboarding() {
    els.embedOnboardModal.hidden = false;
    els.embedOnboardContainer.innerHTML = "<p class='sub'>Loading secure onboarding…</p>";
    await window.LBStripe.mountConnectOnboarding(
      els.embedOnboardContainer,
      async () => {
        const d = await window.LB.apiFetch("/api/payouts/account-session", { method: "POST" });
        if (!d.clientSecret) throw new Error("No client secret");
        return d.clientSecret;
      },
      {
        onExit: () => {
          hide(els.embedOnboardModal);
          // Refresh payout status + wallet after they finish/exit onboarding.
          loadPayoutStatus();
          loadWallet();
        }
      }
    );
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
      amt.textContent = formatCents(g.amountCents, g.currency);
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
    const giftId = p.get("giftId");
    const payouts = p.get("payouts");
    if (!gift && !payouts) return;
    // Clean the URL so a refresh doesn't re-trigger.
    p.delete("gift");
    p.delete("giftId");
    p.delete("payouts");
    const qs = p.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));

    if (gift === "success" || gift === "return") {
      // "return" is the embedded-checkout completion redirect.
      toast("Gift sent — thank you! 💛");
      openGiftsModal();
    } else if (gift === "cancel") {
      toast("Gift cancelled — no charge was made.");
      // Flip the abandoned gift from Pending → Failed right away.
      if (giftId) {
        window.LB.apiFetch("/api/gifts/" + encodeURIComponent(giftId) + "/cancel", {
          method: "POST"
        }).catch(() => {});
      }
    }
    if (payouts === "done" || payouts === "refresh") {
      openGiftsModal();
    }
  }

  /* ---------- currency / provider selection ---------- */
  function giftCurrencyCode() { return activeCurrency || config.currency || "usd"; }
  function activeMin() {
    return activeCurrency === "ngn" ? (paystackConfig.minAmount || 1) : (config.minAmount || 1);
  }
  function activeMax() {
    return activeCurrency === "ngn" ? (paystackConfig.maxAmount || 5000000) : (config.maxAmount || 1000);
  }
  function activeFeeBps() {
    return activeCurrency === "ngn" ? (paystackConfig.feeBps || 0) : (config.feeBps || 0);
  }
  function presetValues() {
    return activeCurrency === "ngn" ? [1000, 2000, 5000, 10000] : [5, 10, 20, 50];
  }

  function stripeCurrencies() {
    // Prefer the server-provided list; fall back to the single primary currency
    // (so this still works against an older backend that hasn't deployed yet).
    const list = Array.isArray(config.currencies) && config.currencies.length
      ? config.currencies
      : [config.currency];
    return list.filter(Boolean);
  }

  function setupCurrencyForRecipient(u) {
    if (!els.giftCurrencySelect) { activeCurrency = config.currency; return; }
    const opts = [];
    if (u.canReceive && stripeGifting) {
      stripeCurrencies().forEach((code) => {
        opts.push({ code, label: "Pay in " + String(code).toUpperCase() });
      });
    }
    if (u.canReceiveNgn && paystackConfig.enabled) {
      opts.push({ code: "ngn", label: "Pay in Naira (\u20a6)" });
    }
    els.giftCurrencySelect.innerHTML = "";
    opts.forEach((o) => {
      const opt = document.createElement("option");
      opt.value = o.code;
      opt.textContent = o.label;
      els.giftCurrencySelect.appendChild(opt);
    });
    els.giftCurrencyRow.hidden = opts.length < 2;
    els.giftCurrencySelect.value = opts.length ? opts[0].code : config.currency;
    onCurrencyChange();
  }

  function onCurrencyChange() {
    if (els.giftCurrencySelect && els.giftCurrencySelect.value) {
      activeCurrency = els.giftCurrencySelect.value;
    }
    els.giftCurrency.textContent = giftCurrencyCode().toUpperCase();
    els.giftAmount.min = activeMin();
    els.giftAmount.max = activeMax();
    renderPresets();
    renderBreakdown();
  }

  /* ---------- Naira (Paystack) payouts ---------- */
  let banksLoaded = false;

  async function loadNgnPayoutStatus() {
    if (!els.ngnPayoutCard) return;
    if (!paystackConfig.enabled) { els.ngnPayoutCard.hidden = true; return; }
    els.ngnPayoutCard.hidden = false;
    els.ngnPayoutActions.innerHTML = "";
    try {
      const s = await window.LB.apiFetch("/api/paystack/account");
      if (!s.enabled) { els.ngnPayoutCard.hidden = true; return; }
      if (s.active) {
        els.ngnPayoutStatus.innerHTML = "<span class='payout-ok'>\u2713 Naira payouts active</span> \u2014 " +
          escapeHtml(s.accountName) + " \u00b7 " + escapeHtml(s.bankName) + " " + escapeHtml(s.accountNumberMasked);
        addNgnAction("Update bank account", openNgnModal);
      } else {
        els.ngnPayoutStatus.textContent = "Set up Naira (\u20a6) payouts to receive gifts and invoices from fans in Nigeria.";
        addNgnAction("Set up Naira payouts", openNgnModal);
      }
    } catch (err) {
      els.ngnPayoutStatus.textContent = err.message || "Could not load Naira payout status.";
    }
  }

  // Naira earnings — Paystack settles a subaccount's share straight to the
  // linked bank, so there's no held balance to withdraw. We surface what has
  // been received (net of the DabzAudio fee) and where it settles.
  async function loadNgnWallet() {
    if (!els.ngnWalletCard) return;
    if (!paystackConfig.enabled) { els.ngnWalletCard.hidden = true; return; }
    try {
      const w = await window.LB.apiFetch("/api/paystack/wallet");
      if (!w.enabled || !w.active) { els.ngnWalletCard.hidden = true; return; }
      els.ngnWalletCard.hidden = false;
      els.ngnWalletTotal.textContent = formatCents(w.receivedNetKobo, "ngn");
      if (w.pendingNetKobo > 0) {
        els.ngnWalletPending.hidden = false;
        els.ngnWalletPending.textContent = formatCents(w.pendingNetKobo, "ngn") + " still settling";
      } else {
        els.ngnWalletPending.hidden = true;
        els.ngnWalletPending.textContent = "";
      }
      const dest = [w.accountName, w.bankName, w.accountNumberMasked].filter(Boolean).join(" \u00b7 ");
      els.ngnWalletSettle.textContent = dest
        ? "Paystack settles your share straight to " + dest + " automatically \u2014 DabzAudio never holds your Naira."
        : "Paystack settles your share straight to your linked bank automatically \u2014 DabzAudio never holds your Naira.";
    } catch (err) {
      els.ngnWalletCard.hidden = true;
    }
  }

  function addNgnAction(label, handler) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn small";
    b.textContent = label;
    b.addEventListener("click", () => handler(b));
    els.ngnPayoutActions.appendChild(b);
  }

  async function openNgnModal() {
    if (!els.ngnModal) return;
    els.ngnModal.hidden = false;
    setNgnMsg("");
    els.ngnResolved.className = "msg";
    els.ngnResolved.textContent = "";
    els.ngnAccountNumber.value = "";
    if (!banksLoaded) await loadBanks();
  }

  async function loadBanks() {
    try {
      const d = await window.LB.apiFetch("/api/paystack/banks");
      els.ngnBank.innerHTML = "<option value=''>Choose your bank\u2026</option>";
      (d.banks || []).forEach((b) => {
        const o = document.createElement("option");
        o.value = b.code;
        o.textContent = b.name;
        els.ngnBank.appendChild(o);
      });
      banksLoaded = true;
    } catch (err) {
      els.ngnBank.innerHTML = "<option value=''>Could not load banks</option>";
    }
  }

  async function tryResolveNgn() {
    const bankCode = els.ngnBank.value;
    const accountNumber = els.ngnAccountNumber.value.trim();
    els.ngnResolved.className = "msg";
    if (!bankCode || !/^\d{10}$/.test(accountNumber)) { els.ngnResolved.textContent = ""; return; }
    els.ngnResolved.textContent = "Checking account\u2026";
    try {
      const d = await window.LB.apiFetch("/api/paystack/resolve", {
        method: "POST",
        body: JSON.stringify({ bankCode, accountNumber })
      });
      els.ngnResolved.className = "msg ok";
      els.ngnResolved.textContent = "\u2713 " + d.accountName;
    } catch (err) {
      els.ngnResolved.className = "msg err";
      els.ngnResolved.textContent = err.message || "Could not verify that account.";
    }
  }

  async function saveNgn() {
    const bankCode = els.ngnBank.value;
    const accountNumber = els.ngnAccountNumber.value.trim();
    if (!bankCode) return setNgnMsg("Choose your bank.", "err");
    if (!/^\d{10}$/.test(accountNumber)) return setNgnMsg("Enter a valid 10-digit account number.", "err");
    els.ngnSaveBtn.disabled = true;
    setNgnMsg("Verifying & saving\u2026");
    try {
      const d = await window.LB.apiFetch("/api/paystack/subaccount", {
        method: "POST",
        body: JSON.stringify({ bankCode, accountNumber })
      });
      setNgnMsg("Saved \u2014 Naira payouts active for " + d.accountName + " (" + d.bankName + ").", "ok");
      await loadNgnPayoutStatus();
      setTimeout(() => hide(els.ngnModal), 1400);
    } catch (err) {
      setNgnMsg(err.message || "Could not set up Naira payouts.", "err");
    } finally {
      els.ngnSaveBtn.disabled = false;
    }
  }

  function setNgnMsg(text, kind) {
    if (!els.ngnMsg) return;
    els.ngnMsg.className = "msg" + (kind ? " " + kind : "");
    els.ngnMsg.textContent = text || "";
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
  function formatCents(cents, cur) { return formatMajor((cents || 0) / 100, cur); }
  function formatMajor(v, cur) {
    const code = String(cur || config.currency || "usd").toUpperCase();
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: code,
        minimumFractionDigits: Number.isInteger(v) ? 0 : 2
      }).format(v);
    } catch {
      return code + " " + v;
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
