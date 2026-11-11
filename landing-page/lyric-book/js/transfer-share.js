(async function () {
  const root = document.getElementById("shareRoot");
  const token = new URLSearchParams(location.search).get("t");
  const base = (window.LB_API_BASE || "").replace(/\/$/, "");

  function formatBytes(n) {
    if (n >= 1073741824) return (n / 1073741824).toFixed(2) + " GB";
    if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
    return Math.max(1, Math.round(n / 1024)) + " KB";
  }
  function empty(text) {
    root.innerHTML = '<div class="playback-empty"><div class="empty-note"></div></div>';
    root.querySelector(".empty-note").textContent = text;
  }
  if (!token) return empty("This transfer link is incomplete.");

  try {
    const data = await window.LB.apiFetch("/api/transfers/public/" + encodeURIComponent(token));
    document.title = data.senderName + " sent you files | DabzAudio";
    root.innerHTML = '<section class="tx-card tx-receive"><p class="playback-kicker">TRANSFER A FILE</p><h1></h1><p class="sub tx-meta"></p><blockquote class="tx-note" hidden></blockquote><ul class="tx-files"></ul><div class="playback-form-actions"><a class="btn tx-all" hidden>Download all</a></div></section>';
    root.querySelector("h1").textContent = data.senderName + " sent you " + (data.files.length === 1 ? "a file" : data.files.length + " files");
    const expires = new Date(data.expiresAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    root.querySelector(".tx-meta").textContent = formatBytes(data.totalBytes) + " · available until " + expires;
    if (data.message) {
      const note = root.querySelector(".tx-note");
      note.hidden = false;
      note.textContent = data.message;
    }
    const list = root.querySelector(".tx-files");
    const urls = [];
    data.files.forEach((file) => {
      const url = base + "/api/transfers/public/" + encodeURIComponent(token) + "/files/" + file.id;
      urls.push(url);
      const li = document.createElement("li");
      li.innerHTML = '<span class="tx-file-name"></span><small></small><a class="btn small" download>Download</a>';
      li.querySelector(".tx-file-name").textContent = file.name;
      li.querySelector("small").textContent = formatBytes(file.size);
      li.querySelector("a").href = url;
      li.querySelector("a").download = file.name.split("/").pop();
      list.appendChild(li);
    });
    if (urls.length > 1) {
      const all = root.querySelector(".tx-all");
      all.hidden = false;
      all.textContent = "Download all as .zip";
      all.href = base + "/api/transfers/public/" + encodeURIComponent(token) + "/zip";
    }
  } catch (err) {
    empty(err.message || "This transfer has expired or was removed.");
  }
})();
