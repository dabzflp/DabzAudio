/**
 * public/app.js
 * Blog is READ + COMMENT only.
 * - The "Create Forum Post" panel is hidden when you click Blog.
 * - Forum posting remains available in Forum tab.
 */

// Allow overriding API base from a global (e.g., set in browser console or config.js)
const API_BASE = typeof window !== "undefined" && window.API_BASE ? window.API_BASE : "";

const CATEGORIES = ["General","Mixing","Mastering","DAWs","Errors","Plugins","Hardware","Recording","Business"];

let currentTab = "forum";
const layoutEl = document.querySelector(".layout");
let currentCategory = "";
let searchTerm = "";
const limit = 10;
let offset = 0;
let adminToken = "";

const el = (id) => document.getElementById(id);

function fmt(ts){ return new Date(ts).toLocaleString(); }

function setActiveTab(tab){
  currentTab = tab;
  offset = 0;

  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  el("feedTitle").textContent = tab === "forum" ? "Forum" : "Blog";

  // Hide create panel for Blog (read/comment only)
  const panel = el("createPanel");
  panel.style.display = (tab === "forum") ? "block" : "none";

  // Expand feed to full width when sidebar is hidden (Blog)
  if (layoutEl) {
    layoutEl.classList.toggle("no-sidebar", tab === "blog");
  }

  loadPosts();
}

function renderCategories(){
  const chips = el("categoryChips");
  chips.innerHTML = "";

  const all = document.createElement("button");
  all.className = "chip" + (currentCategory === "" ? " active" : "");
  all.textContent = "All";
  all.onclick = () => { currentCategory = ""; offset = 0; renderCategories(); loadPosts(); };
  chips.appendChild(all);

  CATEGORIES.forEach(cat => {
    const b = document.createElement("button");
    b.className = "chip" + (currentCategory === cat ? " active" : "");
    b.textContent = cat;
    b.onclick = () => { currentCategory = cat; offset = 0; renderCategories(); loadPosts(); };
    chips.appendChild(b);
  });

  const select = el("postCategory");
  select.innerHTML = "";
  CATEGORIES.forEach(cat => {
    const o = document.createElement("option");
    o.value = cat;
    o.textContent = cat;
    select.appendChild(o);
  });
}

function renderAdminCategories(){
  const select = el("adminCategory");
  if(!select) return;
  select.innerHTML = "";
  CATEGORIES.forEach(cat => {
    const o = document.createElement("option");
    o.value = cat;
    o.textContent = cat;
    select.appendChild(o);
  });
}

async function createForumPost(){
  const type = "forum";
  const category = el("postCategory").value;
  const title = el("postTitle").value.trim();
  const content = el("postContent").value.trim();
  const author = (el("postAuthor").value.trim() || "Anonymous");

  if(!title || !content) return alert("Please add a title and content.");

  const res = await fetch(`${API_BASE}/api/posts`, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ type, category, title, content, author })
  });

  if(!res.ok) return alert("Could not publish. Check server logs.");

  el("postTitle").value = "";
  el("postContent").value = "";
  el("postAuthor").value = "";

  setActiveTab("forum");
}

async function addComment(postId, textarea){
  const content = textarea.value.trim();
  if(!content) return;

  const author = (prompt("Name (optional):") || "Anonymous").trim() || "Anonymous";

  const res = await fetch(`${API_BASE}/api/comments`, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ post_id: postId, content, author })
  });

  if(!res.ok) return alert("Could not reply. Check server logs.");

  textarea.value = "";
  await loadComments(postId);
}

async function loadComments(postId){
  const res = await fetch(`${API_BASE}/api/comments?post_id=${encodeURIComponent(postId)}`);
  const data = await res.json();

  const container = document.querySelector(`[data-comments="${postId}"]`);
  if(!container) return;

  container.innerHTML = "";
  data.forEach(c => {
    const div = document.createElement("div");
    div.className = "comment";
    div.innerHTML = `
      <div class="meta">
        <span class="badge violet">${escapeHtml(c.author)}</span>
        <span>${fmt(c.created_at)}</span>
      </div>
      <div>${escapeHtml(c.content).replace(/\n/g,"<br>")}</div>
    `;
    container.appendChild(div);
  });
}

async function loadPosts(){
  const params = new URLSearchParams();
  params.set("type", currentTab);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  if(currentCategory) params.set("category", currentCategory);

  const res = await fetch(`${API_BASE}/api/posts?${params.toString()}`);
  const posts = await res.json();

  const container = el("posts");
  container.innerHTML = "";

  const filtered = searchTerm
    ? posts.filter(p => (p.title || "").toLowerCase().includes(searchTerm.toLowerCase()))
    : posts;

  filtered.forEach(p => {
    const card = document.createElement("div");
    card.className = "post";

    card.innerHTML = `
      <div class="meta">
        <span class="badge">${p.type.toUpperCase()}</span>
        <span class="badge violet">${escapeHtml(p.category)}</span>
        <span class="badge pink">${escapeHtml(p.author)}</span>
        <span>${fmt(p.created_at)}</span>
      </div>
      <h3>${escapeHtml(p.title)}</h3>
      ${p.image_url ? `<div class="hero"><img src="${encodeURI(p.image_url)}" alt="" loading="lazy" /></div>` : ""}
      <p>${escapeHtml(p.content).replace(/\n/g,"<br>")}</p>

      <div class="replyBox">
        <textarea class="input" rows="2" placeholder="Reply… (timestamped)"></textarea>
        <button class="btn" data-reply="${p.id}">Reply</button>
      </div>

      <div class="comments" data-comments="${p.id}"></div>
    `;

    container.appendChild(card);

    const btn = card.querySelector(`[data-reply="${p.id}"]`);
    const ta = card.querySelector("textarea");
    btn.onclick = () => addComment(p.id, ta);

    loadComments(p.id);
  });

  el("pageInfo").textContent = `Showing ${offset + 1}–${offset + filtered.length}`;
}

function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function setAdminStatus(msg){
  const status = el("adminStatus");
  if(status) status.textContent = msg;
}

function openAdmin(){
  const token = prompt("Enter admin token to continue:", "");
  if(!token) return;
  adminToken = token.trim();

  const overlay = el("adminOverlay");
  if(!overlay) return;
  overlay.classList.remove("hidden");

  const tokenInput = el("adminToken");
  if(tokenInput) tokenInput.value = adminToken;
}

function closeAdmin(){
  const overlay = el("adminOverlay");
  if(overlay) overlay.classList.add("hidden");
  setAdminStatus("");
}

async function publishBlog(){
  try{
    const token = (el("adminToken").value || "").trim();
    const remember = el("rememberAdmin").checked;
    const category = el("adminCategory").value;
    const title = (el("adminTitle").value || "").trim();
    const content = (el("adminContent").value || "").trim();
    const author = (el("adminAuthor").value || "Dabz Audio").trim() || "Dabz Audio";
    const image_url = (el("adminImage").value || "").trim() || null;

    if(!token) return setAdminStatus("Missing admin token.");
    if(!title || !content) return setAdminStatus("Add title + content.");

    adminToken = token;
    try{
      if(remember) localStorage.setItem("dabz_admin_token", token);
      else localStorage.removeItem("dabz_admin_token");
    }catch(e){ /* ignore storage errors */ }

    const res = await fetch(`${API_BASE}/api/posts`, {
      method: "POST",
      headers: {
        "Content-Type":"application/json",
        "x-admin-token": token
      },
      body: JSON.stringify({ type:"blog", category, title, content, author, image_url })
    });

    const data = await res.json();
    if(!res.ok) return setAdminStatus(`Error: ${data.error || res.status}`);

    setAdminStatus("✅ Published!");
    el("adminTitle").value = "";
    el("adminContent").value = "";
  }catch(err){
    console.error(err);
    setAdminStatus("Failed to publish.");
  }
}

async function uploadBlogImage(){
  try{
    const token = (el("adminToken").value || "").trim();
    if(!token) return setAdminStatus("Missing admin token.");

    const file = el("adminImageFile").files[0];
    if(!file) return setAdminStatus("Pick an image file.");
    if(file.size > 5 * 1024 * 1024) return setAdminStatus("Image too large (max 5MB).");

    const base64 = await toBase64(file);

    const res = await fetch(`${API_BASE}/api/upload`, {
      method: "POST",
      headers: {
        "Content-Type":"application/json",
        "x-admin-token": token
      },
      body: JSON.stringify({ image_base64: base64 })
    });

    const data = await res.json();
    if(!res.ok) return setAdminStatus(`Upload failed: ${data.error || res.status}`);

    el("adminImage").value = data.url || "";
    setAdminStatus("✅ Image uploaded. URL set.");
  }catch(err){
    console.error(err);
    setAdminStatus("Upload failed.");
  }
}

// wire UI
document.querySelectorAll(".tab").forEach(b => b.onclick = () => setActiveTab(b.dataset.tab));
el("publishBtn").onclick = createForumPost;
el("refreshBtn").onclick = loadPosts;

el("search").addEventListener("input", (e) => {
  searchTerm = e.target.value;
  loadPosts();
});

el("prevBtn").onclick = () => { offset = Math.max(0, offset - limit); loadPosts(); };
el("nextBtn").onclick = () => { offset += limit; loadPosts(); };

renderCategories();
setActiveTab("forum");

try{
  adminToken = localStorage.getItem("dabz_admin_token") || "";
  if(adminToken && el("rememberAdmin")) el("rememberAdmin").checked = true;
}catch(e){ adminToken = ""; }

renderAdminCategories();

const adminButton = el("adminOpen");
if(adminButton) adminButton.onclick = openAdmin;

const adminClose = el("adminClose");
if(adminClose) adminClose.onclick = closeAdmin;

const adminPublishBtn = el("adminPublish");
if(adminPublishBtn) adminPublishBtn.onclick = publishBlog;

const adminUploadBtn = el("adminUpload");
if(adminUploadBtn) adminUploadBtn.onclick = uploadBlogImage;

const adminOverlay = document.getElementById("adminOverlay");
if(adminOverlay){
  adminOverlay.addEventListener("click", (e) => {
    if(e.target && e.target.dataset && e.target.dataset.closeAdmin !== undefined){
      closeAdmin();
    }
  });
}

function toBase64(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(file);
  });
}
