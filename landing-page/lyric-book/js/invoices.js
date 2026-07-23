/**
 * invoices.js — Invoicing for the Lyric Book.
 *
 * Lets a signed-in user bill anyone by email (the recipient needs no account),
 * with flexible tax (none / VAT-exclusive / VAT-inclusive), and track invoices
 * grouped as Drafts / Sent / Awaiting confirmation / Honored. Self-contained and
 * dormant if the user isn't signed in, so the rest of the app is unaffected.
 */
(function () {
  if (!window.LB || !window.LB.isAuthed()) return;

  const $ = (id) => document.getElementById(id);
  const els = {
    btn: $("invoicesBtn"),
    badge: $("invoicesBadge"),
    modal: $("invoicesModal"),
    close: $("invoicesClose"),
    newBtn: $("newInvoiceBtn"),
    list: $("invoiceList"),
    msg: $("invoicesMsg"),
    cnt: { drafts: $("cntDrafts"), sent: $("cntSent"), awaiting: $("cntAwaiting"), honored: $("cntHonored") },
    // form
    formModal: $("invoiceFormModal"),
    formTitle: $("invoiceFormTitle"),
    formClose: $("invoiceFormClose"),
    form: $("invoiceForm"),
    toEmail: $("invToEmail"),
    toName: $("invToName"),
    currency: $("invCurrency"),
    dueDate: $("invDueDate"),
    itemsEditor: $("invItemsEditor"),
    addItem: $("addItemBtn"),
    taxMode: $("invTaxMode"),
    taxRateWrap: $("invTaxRateWrap"),
    taxRate: $("invTaxRate"),
    taxLabelWrap: $("invTaxLabelWrap"),
    taxLabel: $("invTaxLabel"),
    note: $("invNoteInput"),
    preview: $("invPreview"),
    saveDraft: $("invSaveDraft"),
    formMsg: $("invoiceFormMsg"),
    // detail
    viewModal: $("invoiceViewModal"),
    viewTitle: $("invoiceViewTitle"),
    viewClose: $("invoiceViewClose"),
    viewBody: $("invoiceViewBody"),
    viewMsg: $("invoiceViewMsg")
  };
  if (!els.btn || !els.modal || !els.form) return;

  let meta = { onlinePayEnabled: false, payoutsEnabled: false, feeBps: 0, defaultCurrency: "gbp", currencies: ["gbp", "usd", "eur"] };
  let editingId = null;
  let currentGroup = "drafts";
  let cache = [];

  init();

  async function init() {
    try {
      meta = await window.LB.apiFetch("/api/invoices/meta");
    } catch {
      return; // server too old / unreachable — stay dormant
    }
    els.btn.hidden = false;
    els.currency.innerHTML = meta.currencies.map((c) => `<option value="${c}">${c.toUpperCase()}</option>`).join("");
    els.currency.value = meta.defaultCurrency;

    els.btn.addEventListener("click", openList);
    els.close.addEventListener("click", () => hide(els.modal));
    els.newBtn.addEventListener("click", () => openForm());
    els.formClose.addEventListener("click", () => hide(els.formModal));
    els.viewClose.addEventListener("click", () => hide(els.viewModal));
    els.addItem.addEventListener("click", () => addItemRow());
    els.taxMode.addEventListener("change", onTaxModeChange);
    [els.taxRate].forEach((e) => e.addEventListener("input", renderPreview));
    els.itemsEditor.addEventListener("input", renderPreview);
    els.saveDraft.addEventListener("click", () => submitForm(false));
    els.form.addEventListener("submit", (e) => { e.preventDefault(); submitForm(true); });

    els.modal.querySelectorAll(".inv-tab").forEach((t) =>
      t.addEventListener("click", () => setGroup(t.dataset.group))
    );

    [els.modal, els.formModal, els.viewModal].forEach((m) =>
      m.addEventListener("click", (e) => { if (e.target === m) hide(m); })
    );

    refreshBadge();
    // Deep link: /app.html?invoices=1 opens the panel (used by proof emails).
    if (new URLSearchParams(location.search).get("invoices") === "1") openList();
  }

  function show(m) { m.hidden = false; }
  function hide(m) { m.hidden = true; }
  function setMsg(el, text, kind) { el.className = "msg" + (kind ? " " + kind : ""); el.textContent = text || ""; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function money(cents, cur) {
    const c = (cur || meta.defaultCurrency).toUpperCase();
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency: c }).format((cents || 0) / 100); }
    catch { return c + " " + ((cents || 0) / 100).toFixed(2); }
  }

  async function refreshBadge() {
    try {
      const data = await window.LB.apiFetch("/api/invoices");
      cache = data.invoices || [];
      applyCounts(data);
    } catch { /* ignore */ }
  }

  function applyCounts(data) {
    const c = data.counts || {};
    els.cnt.drafts.textContent = c.drafts || 0;
    els.cnt.sent.textContent = c.sent || 0;
    els.cnt.awaiting.textContent = c.awaiting || 0;
    els.cnt.honored.textContent = c.honored || 0;
    const badge = data.badge || 0;
    els.badge.hidden = badge <= 0;
    els.badge.textContent = badge;
  }

  async function openList() {
    show(els.modal);
    setMsg(els.msg, "Loading…");
    try {
      const data = await window.LB.apiFetch("/api/invoices");
      cache = data.invoices || [];
      applyCounts(data);
      setMsg(els.msg, "");
      renderList();
      // Clear the "honored" part of the badge now they've looked.
      window.LB.apiFetch("/api/invoices/mark-seen", { method: "POST" }).then(refreshBadge).catch(() => {});
    } catch (err) {
      setMsg(els.msg, err.message || "Could not load invoices.", "err");
    }
  }

  function setGroup(g) {
    currentGroup = g;
    els.modal.querySelectorAll(".inv-tab").forEach((t) => t.classList.toggle("active", t.dataset.group === g));
    renderList();
  }

  function inGroup(inv, g) {
    if (g === "drafts") return inv.status === "draft";
    if (g === "sent") return inv.status === "sent" || inv.status === "viewed";
    if (g === "awaiting") return inv.status === "awaiting_confirmation";
    if (g === "honored") return inv.status === "honored";
    return false;
  }

  function statusPill(inv) {
    const map = {
      draft: ["Draft", "pend"], sent: ["Sent", "pend"], viewed: ["Viewed", "pend"],
      awaiting_confirmation: ["Awaiting confirmation", "pend"], honored: ["Honored", "ok"], cancelled: ["Cancelled", "err"]
    };
    const m = map[inv.status] || ["", ""];
    return `<span class="inv-state ${m[1]}">${m[0]}</span>`;
  }

  function renderList() {
    const rows = cache.filter((inv) => inGroup(inv, currentGroup));
    els.list.innerHTML = "";
    if (!rows.length) {
      els.list.innerHTML = `<li class="inv-empty">No ${currentGroup} invoices.</li>`;
      return;
    }
    rows.forEach((inv) => {
      const li = document.createElement("li");
      li.className = "inv-row";
      li.innerHTML =
        `<div class="inv-row-main">
           <div class="n">${esc(inv.number)} · ${esc(inv.toName || inv.toEmail)}</div>
           <div class="e">${money(inv.totalCents, inv.currency)}${inv.dueDate ? " · due " + esc(inv.dueDate) : ""}</div>
         </div>
         ${statusPill(inv)}`;
      li.addEventListener("click", () => openView(inv.id));
      els.list.appendChild(li);
    });
  }

  /* ----------------------------- form ----------------------------- */

  function openForm(inv) {
    editingId = inv ? inv.id : null;
    els.formTitle.textContent = inv ? "Edit draft " + inv.number : "New invoice";
    els.toEmail.value = inv ? inv.toEmail : "";
    els.toName.value = inv ? inv.toName || "" : "";
    els.currency.value = (inv && inv.currency) || meta.defaultCurrency;
    els.dueDate.value = (inv && inv.dueDate) || "";
    els.taxMode.value = (inv && inv.taxMode) || "none";
    els.taxRate.value = inv && inv.taxRateBps ? inv.taxRateBps / 100 : "";
    els.taxLabel.value = (inv && inv.taxLabel) || "VAT";
    els.note.value = (inv && inv.note) || "";
    els.itemsEditor.innerHTML = "";
    const items = (inv && inv.items && inv.items.length) ? inv.items : [{ description: "", quantity: 1, unitCents: 0 }];
    items.forEach((it) => addItemRow(it));
    onTaxModeChange();
    setMsg(els.formMsg, "");
    renderPreview();
    hide(els.viewModal);
    show(els.formModal);
  }

  function addItemRow(it) {
    const row = document.createElement("div");
    row.className = "inv-item-row";
    row.innerHTML =
      `<input class="it-desc" type="text" placeholder="Description" maxlength="300" />
       <input class="it-qty" type="number" min="0" step="1" placeholder="Qty" />
       <input class="it-unit" type="number" min="0" step="0.01" placeholder="Unit" />
       <button class="it-del" type="button" title="Remove">&times;</button>`;
    row.querySelector(".it-desc").value = (it && it.description) || "";
    row.querySelector(".it-qty").value = it && it.quantity != null ? it.quantity : 1;
    row.querySelector(".it-unit").value = it && it.unitCents != null ? (it.unitCents / 100) : "";
    row.querySelector(".it-del").addEventListener("click", () => { row.remove(); renderPreview(); });
    els.itemsEditor.appendChild(row);
    renderPreview();
  }

  function onTaxModeChange() {
    const on = els.taxMode.value !== "none";
    els.taxRateWrap.hidden = !on;
    els.taxLabelWrap.hidden = !on;
    renderPreview();
  }

  function readItems() {
    const items = [];
    els.itemsEditor.querySelectorAll(".inv-item-row").forEach((row) => {
      const description = row.querySelector(".it-desc").value.trim();
      const quantity = Number(row.querySelector(".it-qty").value);
      const unitAmount = Number(row.querySelector(".it-unit").value);
      if (!description) return;
      if (!(quantity > 0)) return;
      if (!(unitAmount >= 0)) return;
      items.push({ description, quantity, unitAmount, unitCents: Math.round(unitAmount * 100) });
    });
    return items;
  }

  function computeTotals(items) {
    const mode = els.taxMode.value;
    const rateBps = Math.round(Number(els.taxRate.value || 0) * 100);
    const subtotal = items.reduce((s, it) => s + Math.round(it.quantity * it.unitCents), 0);
    let tax = 0, total = subtotal;
    if (mode === "exclusive" && rateBps > 0) { tax = Math.round((subtotal * rateBps) / 10000); total = subtotal + tax; }
    else if (mode === "inclusive" && rateBps > 0) { total = subtotal; tax = subtotal - Math.round((subtotal * 10000) / (10000 + rateBps)); }
    return { subtotal, tax, total, rateBps, mode };
  }

  function renderPreview() {
    const cur = els.currency.value;
    const items = readItems();
    const t = computeTotals(items);
    const label = els.taxLabel.value.trim() || "VAT";
    let html = `<div class="gift-breakdown-row"><span>Subtotal</span><span>${money(t.subtotal, cur)}</span></div>`;
    if (t.mode === "exclusive" && t.rateBps > 0)
      html += `<div class="gift-breakdown-row muted"><span>${esc(label)} (${t.rateBps / 100}%)</span><span>${money(t.tax, cur)}</span></div>`;
    else if (t.mode === "inclusive" && t.rateBps > 0)
      html += `<div class="gift-breakdown-row muted"><span>Includes ${esc(label)} (${t.rateBps / 100}%)</span><span>${money(t.tax, cur)}</span></div>`;
    html += `<div class="gift-breakdown-row"><span>Total due</span><b>${money(t.total, cur)}</b></div>`;
    if (meta.onlinePayEnabled && meta.feeBps > 0)
      html += `<div class="gift-breakdown-note">If paid online, DabzAudio fee ${(meta.feeBps / 100)}% (${money(Math.floor(t.total * meta.feeBps / 10000), cur)}) applies.</div>`;
    els.preview.hidden = false;
    els.preview.innerHTML = html;
  }

  function buildPayload() {
    return {
      toEmail: els.toEmail.value.trim(),
      toName: els.toName.value.trim(),
      currency: els.currency.value,
      dueDate: els.dueDate.value || null,
      taxMode: els.taxMode.value,
      taxRateBps: Math.round(Number(els.taxRate.value || 0) * 100),
      taxLabel: els.taxLabel.value.trim() || "VAT",
      note: els.note.value.trim(),
      items: readItems()
    };
  }

  async function submitForm(send) {
    const payload = buildPayload();
    if (!payload.toEmail) { setMsg(els.formMsg, "Enter the recipient's email.", "err"); return; }
    if (!payload.items.length) { setMsg(els.formMsg, "Add at least one line item.", "err"); return; }
    setMsg(els.formMsg, send ? "Sending…" : "Saving…");
    els.saveDraft.disabled = true;
    try {
      if (editingId) {
        await window.LB.apiFetch("/api/invoices/" + editingId, { method: "PUT", body: JSON.stringify(payload) });
        if (send) await window.LB.apiFetch("/api/invoices/" + editingId + "/send", { method: "POST" });
      } else {
        await window.LB.apiFetch("/api/invoices", { method: "POST", body: JSON.stringify(Object.assign({ send }, payload)) });
      }
      hide(els.formModal);
      if (send) setGroupSafe("sent"); else setGroupSafe("drafts");
      await openList();
    } catch (err) {
      setMsg(els.formMsg, err.message || "Could not save the invoice.", "err");
    } finally {
      els.saveDraft.disabled = false;
    }
  }

  function setGroupSafe(g) { currentGroup = g; els.modal.querySelectorAll(".inv-tab").forEach((t) => t.classList.toggle("active", t.dataset.group === g)); }

  /* ---------------------------- detail ---------------------------- */

  async function openView(id) {
    show(els.viewModal);
    setMsg(els.viewMsg, "");
    els.viewBody.innerHTML = "<p class='sub'>Loading…</p>";
    try {
      const data = await window.LB.apiFetch("/api/invoices/" + id);
      renderView(data.invoice);
    } catch (err) {
      els.viewBody.innerHTML = "<p class='sub'>" + esc(err.message || "Could not load invoice.") + "</p>";
    }
  }

  function renderView(inv) {
    els.viewTitle.textContent = inv.number;
    const cur = inv.currency;
    let itemsHtml = (inv.items || []).map((it) =>
      `<div class="inv-total-line"><span>${esc(it.description)} × ${it.quantity}</span><span>${money(Math.round(it.quantity * it.unitCents), cur)}</span></div>`
    ).join("");
    let totals = `<div class="inv-total-line"><span>Subtotal</span><span>${money(inv.subtotalCents, cur)}</span></div>`;
    if (inv.taxMode === "exclusive" && inv.taxRateBps > 0)
      totals += `<div class="inv-total-line muted"><span>${esc(inv.taxLabel)} (${inv.taxRateBps / 100}%)</span><span>${money(inv.taxCents, cur)}</span></div>`;
    else if (inv.taxMode === "inclusive" && inv.taxRateBps > 0)
      totals += `<div class="inv-total-line muted"><span>Includes ${esc(inv.taxLabel)} (${inv.taxRateBps / 100}%)</span><span>${money(inv.taxCents, cur)}</span></div>`;
    totals += `<div class="inv-total-line grand"><span>Total</span><span>${money(inv.totalCents, cur)}</span></div>`;

    let proofs = "";
    if (inv.proofs && inv.proofs.length) {
      proofs = `<div class="inv-proofs"><div class="inv-sub">Proof of payment</div>` +
        inv.proofs.map((p) =>
          `<a class="inv-proof" href="${esc(p.fileUrl)}" target="_blank" rel="noopener">
             <img src="${esc(p.fileUrl)}" alt="proof" />
             <span>${p.note ? esc(p.note) : "View receipt"}</span>
           </a>`
        ).join("") + `</div>`;
    }

    els.viewBody.innerHTML =
      `<div class="inv-view-head">
         <div><div class="inv-sub">Billed to</div><div>${esc(inv.toName || "")} ${esc(inv.toEmail)}</div></div>
         ${statusPill(inv)}
       </div>
       <div class="inv-view-items">${itemsHtml}</div>
       <div class="inv-view-totals">${totals}</div>
       ${inv.note ? `<div class="inv-view-note">${esc(inv.note)}</div>` : ""}
       ${proofs}
       <div class="inv-view-actions" id="invViewActions"></div>`;

    const wrap = document.getElementById("invViewActions");
    const addBtn = (label, cls, fn) => {
      const b = document.createElement("button");
      b.className = "btn " + cls; b.type = "button"; b.textContent = label;
      b.addEventListener("click", fn);
      wrap.appendChild(b);
    };

    if (inv.status === "draft") {
      addBtn("Edit", "subtle", () => openForm(inv));
      addBtn("Send", "", () => act("/api/invoices/" + inv.id + "/send", "Invoice sent."));
      addBtn("Delete", "danger", () => del(inv.id));
    } else if (inv.status === "sent" || inv.status === "viewed") {
      addBtn("Copy pay link", "subtle", () => copyLink(inv));
      addBtn("Resend", "subtle", () => act("/api/invoices/" + inv.id + "/send", "Invoice resent."));
      addBtn("Mark as honored", "", () => act("/api/invoices/" + inv.id + "/mark-honored", "Marked as honored."));
      addBtn("Cancel", "danger", () => act("/api/invoices/" + inv.id + "/cancel", "Invoice cancelled."));
    } else if (inv.status === "awaiting_confirmation") {
      addBtn("Confirm payment", "", () => act("/api/invoices/" + inv.id + "/confirm", "Invoice confirmed & honored."));
      addBtn("Mark as honored", "subtle", () => act("/api/invoices/" + inv.id + "/mark-honored", "Marked as honored."));
      addBtn("Cancel", "danger", () => act("/api/invoices/" + inv.id + "/cancel", "Invoice cancelled."));
    } else if (inv.status === "honored") {
      const tag = inv.honoredMethod === "online" ? "paid online" : inv.honoredMethod === "proof" ? "confirmed from proof" : "marked paid";
      wrap.innerHTML = `<div class="inv-sub" style="align-self:center">Honored (${tag})${inv.honoredAt ? " · " + new Date(inv.honoredAt).toLocaleDateString() : ""}</div>`;
    }

    addBtn(inv.status === "honored" ? "Download receipt (PDF)" : "Download invoice (PDF)", "subtle", () => downloadInvoicePdf(inv));
  }

  function downloadInvoicePdf(inv) {
    if (!window.LBInvoicePDF) { setMsg(els.viewMsg, "PDF tool unavailable.", "err"); return; }
    window.LBInvoicePDF.download(inv).catch((e) => setMsg(els.viewMsg, e && e.message ? e.message : "Could not generate the PDF.", "err"));
  }

  function copyLink(inv) {
    if (!inv.publicToken) { setMsg(els.viewMsg, "Send the invoice first to generate its pay link.", "err"); return; }
    const site = location.origin + location.pathname.replace(/app\.html.*$/, "");
    const url = site + "invoice.html?token=" + inv.publicToken;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url)
        .then(() => setMsg(els.viewMsg, "Secure pay link copied to clipboard.", "ok"))
        .catch(() => setMsg(els.viewMsg, url, "ok"));
    } else {
      setMsg(els.viewMsg, url, "ok");
    }
  }

  async function act(path, okText) {
    setMsg(els.viewMsg, "Working…");
    try {
      await window.LB.apiFetch(path, { method: "POST" });
      setMsg(els.viewMsg, okText, "ok");
      await refreshAfterAction();
    } catch (err) {
      setMsg(els.viewMsg, err.message || "Action failed.", "err");
    }
  }

  async function del(id) {
    setMsg(els.viewMsg, "Deleting…");
    try {
      await window.LB.apiFetch("/api/invoices/" + id, { method: "DELETE" });
      hide(els.viewModal);
      await refreshAfterAction();
    } catch (err) {
      setMsg(els.viewMsg, err.message || "Could not delete.", "err");
    }
  }

  async function refreshAfterAction() {
    try {
      const data = await window.LB.apiFetch("/api/invoices");
      cache = data.invoices || [];
      applyCounts(data);
      renderList();
    } catch { /* ignore */ }
  }
})();
