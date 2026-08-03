// Lyric Book frontend config.
// On Netlify the frontend is served cross-origin from the Railway API, so point
// at the Railway service URL. For same-origin local dev, set this to "".
window.LB_API_BASE =
  ["localhost:4000", "127.0.0.1:4000"].includes(window.location.host)
    ? ""
    : "https://dabzaudio-production-7fd4.up.railway.app";
