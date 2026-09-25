(function () {
  if (!window.LB.isAuthed()) {
    location.replace("login.html");
    return;
  }

  const els = {
    form: document.getElementById("contractForm"),
    signersBox: document.getElementById("signersBox"),
    addSigner: document.getElementById("addSigner"),
    formMsg: document.getElementById("formMsg"),
    previewBox: document.getElementById("previewBox"),
    sendBox: document.getElementById("sendBox"),
    sendBtn: document.getElementById("sendBtn"),
    sendStatus: document.getElementById("sendStatus"),
    sendLinks: document.getElementById("sendLinks"),
    linksList: document.getElementById("linksList"),
    savedContractsList: document.getElementById("savedContractsList")
  };

  let savedContractId = null;

  const signers = [];

  async function loadSavedContracts() {
    try {
      const contracts = await window.LB.apiFetch("/api/contracts");
      if (!contracts.length) {
        els.savedContractsList.innerHTML = '<li class="sub">No saved contracts yet.</li>';
        return;
      }
      els.savedContractsList.innerHTML = contracts.map((contract) => {
        const complete = !!contract.completed_at;
        const signerCount = (contract.signers || []).length;
        return `<li class="saved-contract-row"><span><b>${esc(contract.song_title || "Untitled contract")}</b><small>${complete ? "Completed" : "Awaiting signatures"} · ${signerCount} signer${signerCount === 1 ? "" : "s"}</small></span>${complete ? `<button class="btn small contract-download" type="button" data-id="${contract.id}">Download PDF</button>` : ""}</li>`;
      }).join("");
      els.savedContractsList.querySelectorAll(".contract-download").forEach((button) => {
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            const contract = await window.LB.apiFetch("/api/contracts/" + button.dataset.id);
            await window.LBContractPDF.download(contract, contract.signers || []);
          } catch (err) { setMsg(err.message || "Could not create PDF."); }
          finally { button.disabled = false; }
        });
      });
    } catch (err) {
      els.savedContractsList.innerHTML = `<li class="sub">${esc(err.message || "Could not load saved contracts.")}</li>`;
    }
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function addSigner() {
    const index = signers.length;
    const id = "signer-" + index;
    const div = document.createElement("div");
    div.className = "signer-card invoice-proof";
    div.id = id;
    div.innerHTML = `
      <div class="signer-head">
        <h4>Signer ${index + 1}</h4>
        ${index > 0 ? '<button class="btn danger small" type="button" data-remove="' + index + '">Remove</button>' : ""}
      </div>
      <div class="row three">
        <div class="field"><input type="text" class="s-name" placeholder="Full name" required /></div>
        <div class="field"><input type="email" class="s-email" placeholder="Email" required /></div>
        <div class="field">
          <select class="s-role">
            <option value="writer">Writer</option>
            <option value="producer">Producer</option>
            <option value="performer">Performer</option>
            <option value="engineer">Engineer</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>
      <div class="row three">
        <div class="field"><label>Master share (%)</label><input type="number" class="s-master" min="0" max="100" step="0.01" value="0" /></div>
        <div class="field"><label>Publishing share (%)</label><input type="number" class="s-publishing" min="0" max="100" step="0.01" value="0" /></div>
        <div></div>
      </div>
    `;
    els.signersBox.appendChild(div);
    signers.push({ index, el: div });
    if (index > 0) {
      div.querySelector("[data-remove]").addEventListener("click", () => removeSigner(index));
    }
  }

  function removeSigner(index) {
    const found = signers.find((s) => s.index === index);
    if (!found) return;
    found.el.remove();
    signers.splice(signers.indexOf(found), 1);
    renumber();
  }

  function renumber() {
    signers.forEach((s, i) => {
      s.index = i;
      s.el.querySelector("h4").textContent = "Signer " + (i + 1);
    });
  }

  function collect() {
    const nodes = els.signersBox.querySelectorAll(".signer-card");
    const out = [];
    nodes.forEach((node) => {
      out.push({
        name: node.querySelector(".s-name").value,
        email: node.querySelector(".s-email").value,
        role: node.querySelector(".s-role").value,
        masterShare: node.querySelector(".s-master").value,
        publishingShare: node.querySelector(".s-publishing").value
      });
    });
    return out;
  }

  function sum(list, key) {
    return list.reduce((acc, s) => acc + (Number(s[key]) || 0), 0);
  }

  function renderContract(data) {
    const c = data.contract;
    const signers = data.signers || [];
    const masterTotal = signers.reduce((a, s) => a + (s.master_share_percent || 0), 0);
    const pubTotal = signers.reduce((a, s) => a + (s.publishing_share_percent || 0), 0);
    const date = c.effective_date
      ? new Date(c.effective_date).toLocaleDateString("en-GB")
      : "(not specified)";

    let signerText = signers
      .map(
        (s, i) =>
          `${i + 1}. ${esc(s.name)} (${esc(s.email)}) – ${esc(s.role)}\n   Master share: ${s.master_share_percent}%\n   Publishing share: ${s.publishing_share_percent}%`
      )
      .join("\n");

    const text = `UK MUSIC RIGHTS AGREEMENT TEMPLATE

Song: ${esc(c.song_title)}
Primary artist: ${esc(c.artist_name)}

1. PARTIES AND CAPACITY
This agreement is entered into on ${date} between the undersigned parties in connection with the musical work described below.

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
    return `<h3 style="margin-top:0">Contract preview</h3><pre style="white-space:pre-wrap;word-break:break-word;font-family:inherit">${text.replace(/\n/g, "<br>")}</pre>`;
  }

  function setMsg(msg, ok) {
    els.formMsg.textContent = msg;
    els.formMsg.style.color = ok ? "#7ee787" : "#ff6b6b";
  }

  async function sendForSigning() {
    if (!savedContractId) return;
    els.sendBtn.disabled = true;
    els.sendStatus.textContent = "Sending…";
    try {
      const res = await window.LB.apiFetch(`/api/contracts/${savedContractId}/send`, {
        method: "POST"
      });
      els.sendStatus.textContent = `Sent ${res.sent} of ${res.total} signing emails.`;
      if (res.links && res.links.length) {
        els.linksList.innerHTML = res.links
          .map(
            (l) =>
              `<li><span>${esc(l.email)}</span><a href="${esc(l.signUrl)}" target="_blank" rel="noopener" style="color:#ff7a00">Open signing link</a></li>`
          )
          .join("");
        els.sendLinks.hidden = false;
      }
    } catch (err) {
      els.sendStatus.textContent = err.message || "Could not send.";
    } finally {
      els.sendBtn.disabled = false;
    }
  }

  els.addSigner.addEventListener("click", addSigner);
  els.sendBtn.addEventListener("click", sendForSigning);

  els.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setMsg("");
    const signersList = collect();
    if (signersList.length === 0) {
      setMsg("Add at least one signer.");
      return;
    }
    if (signersList.some((s) => !s.name.trim() || !s.email.trim())) {
      setMsg("Every signer needs a name and email.");
      return;
    }

    const totalMaster = sum(signersList, "masterShare");
    const totalPublishing = sum(signersList, "publishingShare");
    if (totalMaster > 100 || totalPublishing > 100) {
      setMsg(`Master or publishing shares cannot exceed 100% (master: ${totalMaster}%, publishing: ${totalPublishing}%).`);
      return;
    }

    const body = {
      songTitle: document.getElementById("songTitle").value,
      artistName: document.getElementById("artistName").value,
      description: document.getElementById("description").value,
      territory: document.getElementById("territory").value,
      governingLaw: document.getElementById("governingLaw").value,
      effectiveDate: document.getElementById("effectiveDate").value,
      signers: signersList
    };

    try {
      const data = await window.LB.apiFetch("/api/contracts", {
        method: "POST",
        body: JSON.stringify(body)
      });
      savedContractId = data.contract.id;
      setMsg("Contract saved.", true);
      els.previewBox.innerHTML = renderContract(data);
      els.previewBox.hidden = false;
      els.sendBox.hidden = false;
      loadSavedContracts();
    } catch (err) {
      setMsg(err.message || "Could not save contract.");
    }
  });

  addSigner();
  loadSavedContracts();
})();
