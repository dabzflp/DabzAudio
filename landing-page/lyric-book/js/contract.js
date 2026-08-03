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
    sendStatus: document.getElementById("sendStatus")
  };

  let savedContractId = null;

  const signers = [];

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

    const text = `MUSIC RIGHTS AGREEMENT

Song: ${esc(c.song_title)}
Primary artist: ${esc(c.artist_name)}

1. PARTIES
This agreement is entered into on ${date} between the undersigned parties in connection with the musical work described below.

2. DESCRIPTION OF THE MUSICAL WORK
${esc(c.description)}

3. TERRITORY AND LAW
Territory: ${esc(c.territory)}
Governing law / jurisdiction: ${esc(c.governing_law)}

4. OWNERSHIP AND REVENUE SPLITS
The parties agree the following ownership of master sound-recording rights and music-publishing/writer-share rights:

${signerText}

Master shares total: ${masterTotal.toFixed(2)}%
Publishing shares total: ${pubTotal.toFixed(2)}%

5. GRANT OF RIGHTS
Each party grants the non-exclusive or exclusive rights (as separately agreed) necessary to exploit the master recordings and the underlying composition within the Territory, subject to the splits above.

6. SIGNING
This agreement becomes binding on the parties once all listed signers have signed an electronic or physical counterpart. A fully signed copy will be distributed to all parties after the last signer has signed.

7. GENERAL
This agreement constitutes the entire understanding between the parties concerning the Musical Work. Amendments must be in writing and signed by all parties.

This is an agreement record generated by DabzAudio. It is not legal advice and should be reviewed by a qualified music-business attorney before use.
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
    } catch (err) {
      setMsg(err.message || "Could not save contract.");
    }
  });

  addSigner();
})();
