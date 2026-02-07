/**
 * uploader.js
 * Handles uploading the selected file to the server (/upload) using fetch + FormData.
 *
 * Exports a helper function `uploadFile(file)` that returns a Promise resolving to { success, url }.
 *
 * NOTE: the server returns only the uploaded file URL for now. The analysis is done client-side afterward.
 */

async function uploadFile(file) {
  const form = new FormData();
  form.append('audiofile', file);

  // Use absolute URL to work with ngrok and different domains
  // Use production backend for uploads
  const uploadUrl = 'https://dabzaudio-production.up.railway.app/upload';

  const resp = await fetch(uploadUrl, {
    method: 'POST',
    body: form
  });

  if (!resp.ok) {
    throw new Error('Upload failed: ' + resp.statusText);
  }
  return resp.json(); // { success: true, url: "/uploads/xxxx-filename" }
}

// Expose for other modules (simple global export pattern)
window.uploader = { uploadFile };
