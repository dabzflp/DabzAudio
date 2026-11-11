(function () {
  const $ = (id) => document.getElementById(id);
  const fileInput = $("fileInput");
  const dropZone = $("dropZone");
  const fileList = $("fileList");
  const chips = $("chips");
  const recipientInput = $("recipientInput");
  const sendBtn = $("sendBtn");
  const sendMsg = $("sendMsg");
  const progress = $("progress");
  const bar = $("bar");
  const progressText = $("progressText");
  const transferList = $("transferList");
  const sendEmailBtn = $("sendEmailBtn");
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const MAX_BYTES = 10 * 1024 * 1024 * 1024;
  const PARALLEL = 3;
  const RETRIES = 4;
  let files = [];
  let recipients = [];
  let sending = false;
  let completedTransferId = null;

  function formatBytes(n) {
    if (n >= 1073741824) return (n / 1073741824).toFixed(2) + " GB";
    if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
    return Math.max(1, Math.round(n / 1024)) + " KB";
  }
  function setMsg(text, error) {
    sendMsg.textContent = text || "";
    sendMsg.className = "msg" + (error ? " err" : " ok");
  }
  function totalBytes() { return files.reduce((sum, f) => sum + f.size, 0); }

  function renderFiles() {
    fileList.innerHTML = "";
    files.forEach((file, index) => {
      const li = document.createElement("li");
      li.innerHTML = '<span class="tx-file-name"></span><small></small><button type="button" class="track-delete" aria-label="Remove file">&times;</button>';
      li.querySelector(".tx-file-name").textContent = pathOf(file);
      li.querySelector("small").textContent = formatBytes(file.size);
      li.querySelector("button").addEventListener("click", () => {
        if (sending) return;
        files.splice(index, 1);
        renderFiles();
      });
      fileList.appendChild(li);
    });
    const total = totalBytes();
    sendBtn.disabled = sending || !files.length;
    if (total > MAX_BYTES) { setMsg("Total size is " + formatBytes(total) + ". The limit is 10 GB.", true); sendBtn.disabled = true; }
    else if (files.length) setMsg(files.length + (files.length === 1 ? " file · " : " files · ") + formatBytes(total));
    else setMsg("");
  }

  // Folder structure is kept by sending each file's relative path as its name.
  const paths = new WeakMap();
  const MAX_FILES = 1000;
  const pathOf = (file) => paths.get(file) || file.webkitRelativePath || file.name;

  function addFiles(list, skipRender) {
    let skipped = 0;
    for (const file of list) {
      if (!file.size) { skipped += 1; continue; }
      if (files.length >= MAX_FILES) { setMsg("You can send up to " + MAX_FILES + " files at once.", true); break; }
      files.push(file);
    }
    if (!skipRender) renderFiles();
    if (skipped) setMsg(skipped + " empty file(s) were skipped.", true);
  }
  fileInput.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = ""; });
  const folderInput = $("folderInput");
  $("folderBtn").addEventListener("click", () => folderInput.click());
  folderInput.addEventListener("change", () => { addFiles(folderInput.files); folderInput.value = ""; });

  function readEntries(reader) {
    return new Promise((resolve, reject) => {
      const all = [];
      (function next() {
        reader.readEntries((batch) => {
          if (!batch.length) return resolve(all);
          all.push(...batch);
          next();
        }, reject);
      })();
    });
  }
  async function collectEntry(entry, prefix, out) {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      paths.set(file, prefix + entry.name);
      out.push(file);
    } else if (entry.isDirectory) {
      const children = await readEntries(entry.createReader());
      for (const child of children) await collectEntry(child, prefix + entry.name + "/", out);
    }
  }
  async function handleDrop(dt) {
    const items = Array.from(dt.items || []);
    const entries = items.map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null));
    if (!entries.length || entries.some((e) => !e)) { addFiles(dt.files); return; }
    const out = [];
    try {
      for (const entry of entries) await collectEntry(entry, "", out);
    } catch { setMsg("Could not read that folder.", true); return; }
    addFiles(out);
  }
  ["dragenter", "dragover"].forEach((name) => dropZone.addEventListener(name, (e) => { e.preventDefault(); dropZone.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach((name) => dropZone.addEventListener(name, (e) => { e.preventDefault(); dropZone.classList.remove("is-over"); }));
  dropZone.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.items.length) handleDrop(e.dataTransfer); });

  function renderChips() {
    chips.querySelectorAll(".tx-chip").forEach((el) => el.remove());
    recipients.forEach((email) => {
      const chip = document.createElement("span");
      chip.className = "tx-chip";
      chip.innerHTML = '<span></span><button type="button" aria-label="Remove">&times;</button>';
      chip.firstChild.textContent = email;
      chip.querySelector("button").addEventListener("click", () => {
        recipients = recipients.filter((e) => e !== email);
        renderChips();
      });
      chips.insertBefore(chip, recipientInput);
    });
  }
  function commitRecipient() {
    const value = recipientInput.value.trim().replace(/,$/, "").toLowerCase();
    if (!value) return true;
    if (!EMAIL_RE.test(value)) { setMsg('"' + value + '" is not a valid email.', true); return false; }
    if (!recipients.includes(value)) recipients.push(value);
    recipientInput.value = "";
    renderChips();
    return true;
  }
  recipientInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "," || e.key === " ") { e.preventDefault(); commitRecipient(); }
    else if (e.key === "Backspace" && !recipientInput.value && recipients.length) { recipients.pop(); renderChips(); }
  });
  recipientInput.addEventListener("blur", commitRecipient);
  chips.addEventListener("click", () => recipientInput.focus());

  function putPart(url, blob, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", (window.LB_API_BASE || "").replace(/\/$/, "") + url);
      xhr.withCredentials = true;
      const token = window.LB.getToken();
      if (token) xhr.setRequestHeader("Authorization", "Bearer " + token);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.upload.addEventListener("progress", (e) => { if (e.lengthComputable) onProgress(e.loaded); });
      xhr.addEventListener("error", () => reject(new Error("Network error")));
      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        let message = "Upload failed";
        try { message = JSON.parse(xhr.responseText).error || message; } catch { /* ignore */ }
        const err = new Error(message);
        err.status = xhr.status;
        reject(err);
      });
      xhr.send(blob);
    });
  }

  async function uploadAll(transferId, plan, partSize) {
    const total = totalBytes();
    const loadedByPart = new Map();
    const startedAt = Date.now();
    const jobs = [];
    plan.forEach((entry, i) => {
      for (let p = 0; p < entry.parts; p += 1) jobs.push({ fileIndex: i, fileId: entry.id, part: p });
    });
    function update() {
      let loaded = 0;
      loadedByPart.forEach((v) => { loaded += v; });
      const percent = Math.min(100, Math.round((loaded / total) * 100));
      bar.style.width = percent + "%";
      const rate = loaded / Math.max((Date.now() - startedAt) / 1000, 0.5);
      const left = rate ? Math.max(0, (total - loaded) / rate) : 0;
      progressText.textContent = percent + "% · " + formatBytes(loaded) + " of " + formatBytes(total) +
        (percent < 100 && loaded > 0 ? " · " + (left > 90 ? Math.ceil(left / 60) + " min" : Math.ceil(left) + " s") + " left" : "");
    }
    let next = 0;
    async function worker() {
      while (next < jobs.length) {
        const job = jobs[next++];
        const file = files[job.fileIndex];
        const blob = file.slice(job.part * partSize, Math.min(file.size, (job.part + 1) * partSize));
        const key = job.fileId + ":" + job.part;
        const url = "/api/transfers/" + transferId + "/files/" + job.fileId + "/parts/" + job.part;
        for (let attempt = 1; ; attempt += 1) {
          try {
            await putPart(url, blob, (loaded) => { loadedByPart.set(key, loaded); update(); });
            loadedByPart.set(key, blob.size);
            update();
            break;
          } catch (err) {
            loadedByPart.set(key, 0);
            if ((err.status && err.status >= 400 && err.status < 500 && err.status !== 400) || attempt >= RETRIES) throw err;
            await new Promise((r) => setTimeout(r, 800 * attempt));
          }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL, jobs.length) }, worker));
  }

  async function send() {
    if (sending || !files.length || !commitRecipient()) return;
    sending = true;
    sendBtn.disabled = true;
    progress.hidden = false;
    bar.style.width = "0%";
    progressText.textContent = "Starting...";
    setMsg("");
    let transferId = null;
    try {
      const created = await window.LB.apiFetch("/api/transfers", {
        method: "POST",
        body: JSON.stringify({
          message: $("messageInput").value,
          recipients,
          files: files.map((f) => ({ name: pathOf(f), size: f.size, type: f.type }))
        })
      });
      transferId = created.transfer.id;
      await uploadAll(transferId, created.files, created.partSize);
      progressText.textContent = "Finishing up...";
      const done = await window.LB.apiFetch("/api/transfers/" + transferId + "/complete", {
        method: "POST",
        body: JSON.stringify({ sendEmails: false })
      });
      showDone(done);
      loadTransfers();
    } catch (err) {
      if (err.status === 401) { location.replace("login.html"); return; }
      setMsg(err.message || "Transfer failed.", true);
      if (transferId) window.LB.apiFetch("/api/transfers/" + transferId, { method: "DELETE" }).catch(() => {});
      progress.hidden = true;
    } finally {
      sending = false;
      renderFiles();
    }
  }
  sendBtn.addEventListener("click", send);

  function showDone(done) {
    $("sendPanel").hidden = true;
    $("donePanel").hidden = false;
    completedTransferId = done.transfer.id;
    $("doneLink").value = done.transfer.link;
    const expires = new Date(done.transfer.expiresAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    const emailed = Number(done.emailed || 0);
    const recipientCount = Array.isArray(done.transfer.recipients) ? done.transfer.recipients.length : 0;
    const emailPending = Number(done.emailPending ?? Math.max(0, recipientCount - emailed));
    const emailFailed = Number(done.emailFailed || 0);
    $("doneTitle").textContent = emailed && !emailPending ? "Your files are on their way" : "Your transfer is ready to share";
    let text;
    if (!recipientCount) {
      text = "Upload complete. Copy the download link below to share it directly. It expires " + expires + ".";
    } else if (emailFailed) {
      text = emailed
        ? "Emailed to " + emailed + (emailed === 1 ? " person. " : " people. ") + emailFailed + " email(s) could not be sent. Retry or share the link below. It expires " + expires + "."
        : emailFailed + " email(s) could not be sent. Retry or share the link below. It expires " + expires + ".";
    } else if (emailPending) {
      text = "Upload complete. Send an email to " + emailPending + (emailPending === 1 ? " recipient" : " recipients") + " below, or copy the link to share it directly. It expires " + expires + ".";
    } else {
      text = "Emailed to " + emailed + (emailed === 1 ? " person. " : " people. ") + "The download link expires " + expires + ".";
    }
    $("doneText").textContent = text;
    sendEmailBtn.hidden = !emailPending;
    sendEmailBtn.disabled = false;
    sendEmailBtn.textContent = emailFailed ? "Retry email" : "Send email";
  }
  $("doneCopy").addEventListener("click", () => copy($("doneLink").value, $("doneCopy")));
  sendEmailBtn.addEventListener("click", async () => {
    sendEmailBtn.disabled = true;
    sendEmailBtn.textContent = "Sending...";
    try {
      const done = await window.LB.apiFetch("/api/transfers/" + encodeURIComponent(completedTransferId) + "/send", { method: "POST" });
      showDone(done);
      loadTransfers();
    } catch (err) {
      if (err.status === 401) { location.replace("login.html"); return; }
      $("doneText").textContent += " Email sending failed: " + (err.message || "Please try again.");
      sendEmailBtn.disabled = false;
      sendEmailBtn.textContent = "Retry email";
    }
  });
  $("againBtn").addEventListener("click", () => {
    files = []; recipients = [];
    $("messageInput").value = "";
    progress.hidden = true;
    renderChips(); renderFiles();
    $("donePanel").hidden = true;
    $("sendPanel").hidden = false;
  });

  async function copy(text, button) {
    try { await navigator.clipboard.writeText(text); } catch {
      const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove();
    }
    const old = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = old; }, 1500);
  }

  function expiryLabel(iso) {
    const ms = new Date(iso).getTime() - Date.now();
    const days = Math.floor(ms / 86400000);
    if (days >= 1) return "Expires in " + days + (days === 1 ? " day" : " days");
    const hours = Math.max(1, Math.floor(ms / 3600000));
    return "Expires in " + hours + (hours === 1 ? " hour" : " hours");
  }

  async function loadTransfers() {
    try {
      const data = await window.LB.apiFetch("/api/transfers");
      transferList.innerHTML = "";
      if (!data.transfers.length) {
        transferList.innerHTML = '<li class="tx-empty">No active transfers. Files you send show up here until they expire.</li>';
        return;
      }
      data.transfers.forEach((t) => {
        const li = document.createElement("li");
        li.className = "tx-item";
        li.innerHTML = '<div class="tx-item-main"><b></b><small></small></div><div class="tx-item-actions"><button class="btn ghost small tx-copy" type="button">Copy link</button><button class="track-delete" type="button" title="Delete transfer" aria-label="Delete transfer">&times;</button></div>';
        const first = t.files[0] ? t.files[0].name : "Transfer";
        li.querySelector("b").textContent = t.files.length > 1 ? first + " + " + (t.files.length - 1) + " more" : first;
        const parts = [formatBytes(t.totalBytes), t.status === "ready" ? expiryLabel(t.expiresAt) : "Uploading", t.downloadCount + (t.downloadCount === 1 ? " download" : " downloads")];
        if (t.recipients.length) parts.push("To " + t.recipients.join(", "));
        li.querySelector("small").textContent = parts.join(" · ");
        const copyBtn = li.querySelector(".tx-copy");
        if (t.status !== "ready") copyBtn.hidden = true;
        copyBtn.addEventListener("click", () => copy(t.link, copyBtn));
        li.querySelector(".track-delete").addEventListener("click", async () => {
          if (!(await dabzConfirm("The download link will stop working.", { title: "Delete transfer?", okText: "Delete" }))) return;
          try { await window.LB.apiFetch("/api/transfers/" + t.id, { method: "DELETE" }); loadTransfers(); }
          catch (err) { $("listMsg").textContent = err.message; $("listMsg").className = "msg err"; }
        });
        transferList.appendChild(li);
      });
    } catch (err) {
      if (err.status === 401) { location.replace("login.html"); return; }
      $("listMsg").textContent = err.message;
      $("listMsg").className = "msg err";
    }
  }

  window.addEventListener("beforeunload", (e) => { if (sending) { e.preventDefault(); e.returnValue = ""; } });
  if (!window.LB.isAuthed()) { location.replace("login.html"); return; }
  loadTransfers();
})();
