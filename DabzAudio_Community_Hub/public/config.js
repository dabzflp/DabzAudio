// Community Hub API base.
// - Locally the server runs at the root, so use same-origin ("").
// - In production the hub is served under /community-hub, so all API calls
//   must be prefixed with that path so the Netlify _redirects proxy applies.
window.API_BASE =
  ["localhost", "127.0.0.1"].includes(location.hostname)
    ? ""
    : "/community-hub";
