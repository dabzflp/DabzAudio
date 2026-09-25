(function () {
  const params = new URLSearchParams(location.search);
  const token = params.get("token");

  const els = {
    loading: document.getElementById("loading"),
    docBox: document.getElementById("docBox"),
    docTitle: document.getElementById("docTitle"),
    docText: document.getElementById("docText"),
    statusList: document.getElementById("statusList"),
    signBox: document.getElementById("signBox"),
    signerName: document.getElementById("signerName"),
    signBtn: document.getElementById("signBtn"),
    signMsg: document.getElementById("signMsg"),
    doneBox: document.getElementById("doneBox"),
    doneMsg: document.getElementById("doneMsg"),
    downloadContractBtn: document.getElementById("downloadContractBtn"),
    errorBox: document.getElementById("errorBox"),
    sigCanvas: document.getElementById("sigCanvas"),
    clearSig: document.getElementById("clearSig")
  };

  let ctx = null;
  let drawing = false;
  let hasDrawn = false;
  let completedContract = null;
  let completedSigners = [];
  let currentContract = null;

  function enableDownload(contract, signers) {
    completedContract = contract;
    completedSigners = signers || [];
    els.downloadContractBtn.hidden = false;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(d) {
    if (!d) return "(not specified)";
    try {
      return new Date(d).toLocaleDateString("en-GB");
    } catch {
      return String(d);
    }
  }

  function getPoint(e) {
    const rect = els.sigCanvas.getBoundingClientRect();
    const scaleX = els.sigCanvas.width / rect.width;
    const scaleY = els.sigCanvas.height / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }

  function startDraw(e) {
    e.preventDefault();
    drawing = true;
    hasDrawn = true;
    const p = getPoint(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }

  function moveDraw(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = getPoint(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function endDraw() {
    drawing = false;
    ctx.beginPath();
  }

  function clearCanvas() {
    if (!ctx) return;
    ctx.clearRect(0, 0, els.sigCanvas.width, els.sigCanvas.height);
    hasDrawn = false;
  }

  function setupCanvas() {
    if (!els.sigCanvas) return;
    ctx = els.sigCanvas.getContext("2d");
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#ff7a00";

    els.sigCanvas.addEventListener("mousedown", startDraw);
    els.sigCanvas.addEventListener("mousemove", moveDraw);
    window.addEventListener("mouseup", endDraw);
    els.sigCanvas.addEventListener("touchstart", startDraw, { passive: false });
    els.sigCanvas.addEventListener("touchmove", moveDraw, { passive: false });
    window.addEventListener("touchend", endDraw);
    els.clearSig.addEventListener("click", clearCanvas);
  }

  function renderContract(c, signers) {
    const masterTotal = signers.reduce((a, s) => a + (Number(s.master_share_percent) || 0), 0);
    const pubTotal = signers.reduce((a, s) => a + (Number(s.publishing_share_percent) || 0), 0);
    const signerText = signers
      .map(
        (s, i) =>
          `${i + 1}. ${esc(s.name)} (${esc(s.email)}) – ${esc(s.role)}\n   Master share: ${s.master_share_percent}%\n   Publishing share: ${s.publishing_share_percent}%`
      )
      .join("\n");

    const text = `UK MUSIC RIGHTS AGREEMENT TEMPLATE

Song: ${esc(c.song_title)}
Primary artist: ${esc(c.artist_name)}

1. PARTIES AND CAPACITY
This agreement is entered into on ${formatDate(c.effective_date)} between the undersigned parties in connection with the musical work described below.

2. DESCRIPTION OF THE MUSICAL WORK
${esc(c.description)}

3. TERRITORY AND LAW
Territory: ${esc(c.territory)}
Governing law / jurisdiction: ${esc(c.governing_law)}

4. OWNERSHIP AND REVENUE SPLITS
The parties agree the following ownership of the master sound recording and the underlying musical composition, subject to rights that cannot legally be assigned:

${signerText}

Master shares total: ${masterTotal.toFixed(2)}%
Publishing shares total: ${pubTotal.toFixed(2)}%

5. GRANT OF RIGHTS AND USE
Each party grants the rights reasonably required to create, reproduce, distribute, communicate to the public, perform, synchronise, promote and exploit the work and recordings within the Territory, subject to the splits above. Any exclusive grant, deal, advance, fee, royalty or recoupment term must be agreed in writing.

6. CREDITS AND MORAL RIGHTS
The parties will use reasonable endeavours to provide accurate songwriter, producer, performer and production credits. To the extent permitted by the Copyright, Designs and Patents Act 1988, each party consents to reasonable editing, adaptation and exploitation and waives or agrees not to assert moral rights only to the extent permitted by law.

7. ACCOUNTING AND PAYMENT
Unless a written schedule states otherwise, this agreement records ownership percentages only and does not create a promise to pay an advance, fee or royalty. Each party is responsible for registering and collecting its own income and keeping accurate records.

8. WARRANTIES AND INDEMNITY
Each party warrants that, to the best of its knowledge, it has authority to enter this agreement and its contribution does not knowingly infringe another person’s rights. A party that breaches this warranty is responsible for losses directly caused by that breach, subject to applicable law.

9. CONFIDENTIALITY
The parties will keep non-public commercial terms and unreleased materials confidential, except where disclosure is required by law or to a professional adviser, collection society, insurer, funder or distributor bound to keep the information confidential.

10. TERM AND TERMINATION
This agreement starts on the effective date and continues for the life of the rights granted unless the parties agree otherwise in writing. A material breach not remedied within a reasonable written notice period may be grounds for termination, without affecting accrued rights and obligations.

11. GOVERNING LAW AND DISPUTES
This agreement is governed by the jurisdiction stated above. The parties will first try in good faith to resolve disputes through discussion or mediation before court proceedings, unless an urgent legal remedy is required.

12. SIGNING AND COUNTERPARTS
This agreement becomes binding on the parties once all listed signers have signed an electronic or physical counterpart. A fully signed copy will be distributed to all parties after the last signer has signed.

13. GENERAL
This agreement and written schedules contain the parties’ understanding concerning the musical work. Amendments must be in writing and signed by all affected parties. If a provision is unenforceable, the remaining provisions continue to apply.

14. SIGNATURES AND PARTY DETAILS
Each signer’s full name, email, role, ownership shares, signature status and signing date form part of this agreement.

This is a UK-oriented contract template generated by DabzAudio, not legal advice. The parties should obtain advice from a qualified UK music solicitor before signing or relying on it.
`;
    return text.replace(/\n/g, "<br>");
  }

  function renderStatus(signers, meId) {
    els.statusList.innerHTML = signers
      .map((s) => {
        const isMe = s.id === meId;
        const status = s.signed_at ? "signed" : "pending";
        return `<li>
          <span>${esc(s.name)}${isMe ? " (you)" : ""} — ${esc(s.role)}</span>
          <span class="${status}">${s.signed_at ? "Signed" : "Pending"}</span>
        </li>`;
      })
      .join("");
  }

  function setMsg(msg, ok) {
    els.signMsg.textContent = msg;
    els.signMsg.style.color = ok ? "#7ee787" : "#ff6b6b";
  }

  async function load() {
    if (!token) {
      els.loading.hidden = true;
      els.errorBox.hidden = false;
      return;
    }
    try {
      const data = await window.LB.apiFetch("/api/contract-sign?token=" + encodeURIComponent(token));
      const c = data.contract;
      currentContract = c;
      const me = data.me;
      const signers = data.signers || [];

      els.loading.hidden = true;
      els.docBox.hidden = false;
      els.docTitle.textContent = esc(c.song_title);
      els.docText.innerHTML = "<pre>" + renderContract(c, signers) + "</pre>";
      renderStatus(signers, me.id);
      if (signers.length && signers.every((signer) => signer.signed_at)) {
        enableDownload(c, signers);
        if (params.get("download") === "1") setTimeout(() => els.downloadContractBtn.click(), 250);
      }
      setupCanvas();

      if (me.signedAt) {
        els.signBox.hidden = true;
        els.doneBox.hidden = false;
        els.doneMsg.textContent = "You have already signed this contract.";
      } else {
        els.signBox.hidden = false;
        els.signerName.value = me.name || "";
      }
    } catch (err) {
      els.loading.hidden = true;
      els.errorBox.hidden = false;
      console.error(err);
    }
  }

  async function sign() {
    setMsg("");
    const name = els.signerName.value.trim();
    if (!name) {
      setMsg("Enter your full name to sign.");
      return;
    }
    if (!hasDrawn) {
      setMsg("Please draw your signature.");
      return;
    }

    const signature = els.sigCanvas.toDataURL("image/png");
    els.signBtn.disabled = true;

    try {
      const data = await window.LB.apiFetch("/api/contract-sign", {
        method: "POST",
        body: JSON.stringify({ token, name, signature })
      });
      els.signBox.hidden = true;
      els.doneBox.hidden = false;
      if (data.completed) {
        els.doneMsg.textContent = "You signed. All signers have now signed and a completed copy will be emailed to everyone.";
        enableDownload(currentContract, data.signers);
      } else {
        els.doneMsg.textContent = "You signed. A completed copy will be emailed once all signers have signed.";
      }
      renderStatus(data.signers, data.me.id);
    } catch (err) {
      setMsg(err.message || "Could not sign.");
    } finally {
      els.signBtn.disabled = false;
    }
  }

  els.signBtn.addEventListener("click", sign);
  els.downloadContractBtn.addEventListener("click", async () => {
    if (!completedContract) return;
    els.downloadContractBtn.disabled = true;
    try { await window.LBContractPDF.download(completedContract, completedSigners); }
    catch (err) { els.doneMsg.textContent = err.message || "Could not create the PDF."; }
    finally { els.downloadContractBtn.disabled = false; }
  });
  load();
})();
