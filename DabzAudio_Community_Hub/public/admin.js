/**
 * public/admin.js
 * Admin blog publisher page.
 *
 * Steps:
 * 1) You set ADMIN_TOKEN in Railway Variables
 * 2) You open /admin.html
 * 3) Paste your ADMIN_TOKEN into the input
 * 4) Publish blog posts (server checks token)
 */

const CATEGORIES = ["General","Mixing","Mastering","DAWs","Errors","Plugins","Hardware","Recording","Business"];
const el = (id) => document.getElementById(id);
const API_BASE = typeof window !== "undefined" && window.API_BASE ? window.API_BASE : "";

function fillCategories(){
  const s = el("category");
  CATEGORIES.forEach(c => {
    const o = document.createElement("option");
    o.value = c;
    o.textContent = c;
    s.appendChild(o);
  });
}

// Allow overriding API base via window.API_BASE (set in config.js)
async function publish(){
  const token = el("token").value.trim();
  const category = el("category").value;
  const title = el("title").value.trim();
  const content = el("content").value.trim();
  const author = (el("author").value.trim() || "Dabz Audio");
  const image_url = el("imageUrl").value.trim() || null;

  if(!token) return setStatus("Missing admin token.");
  if(!title || !content) return setStatus("Add title + content.");

  const res = await fetch(`${API_BASE}/api/posts`, {
    method: "POST",
    headers: {
      "Content-Type":"application/json",
      "x-admin-token": token
    },
    body: JSON.stringify({ type:"blog", category, title, content, author, image_url })
  });

  const data = await res.json();
  if(!res.ok) return setStatus(`Error: ${data.error || "Failed"}`);

  setStatus("✅ Published! Go to / (main page) and click Blog.");
  el("title").value = "";
  el("content").value = "";
}

function setStatus(msg){
  el("status").textContent = msg;
}

el("publish").onclick = publish;
el("upload").onclick = uploadImage;
fillCategories();

async function uploadImage(){
  try {
    const token = el("token").value.trim();
    if(!token) return setStatus("Missing admin token.");

    const file = el("imageFile").files[0];
    if(!file) return setStatus("Pick an image file.");
    if(file.size > 5 * 1024 * 1024) return setStatus("Image too large (max 5MB).");

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
    if(!res.ok) return setStatus(`Upload failed: ${data.error || res.status}`);

    el("imageUrl").value = data.url || "";
    setStatus("✅ Image uploaded. URL set.");
  } catch(err){
    console.error(err);
    setStatus("Upload failed.");
  }
}

function toBase64(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(file);
  });
}
