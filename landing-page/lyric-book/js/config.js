// Lyric Book frontend config.
// - Local dev on localhost:4000 uses the same-origin backend.
// - In production the Lyric Book is served under /lyric-book on the main domain,
//   so all API calls use that path prefix and the Netlify _redirects proxy.
window.LB_API_BASE =
  ["localhost", "127.0.0.1"].includes(location.hostname)
    ? ""
    : "/lyric-book";
