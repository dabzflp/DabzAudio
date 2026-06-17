// Tiny API helper shared across the Lyric Book pages.
(function () {
  const TOKEN_KEY = "lb_token";

  function base() {
    return (window.LB_API_BASE || "").replace(/\/$/, "");
  }
  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }
  function setToken(t) {
    if (t) localStorage.setItem(TOKEN_KEY, t);
  }
  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
  }

  async function apiFetch(path, opts = {}) {
    const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    const token = getToken();
    if (token) headers["Authorization"] = "Bearer " + token;

    const res = await fetch(base() + path, {
      ...opts,
      headers,
      credentials: "include"
    });

    let data = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text };
      }
    }
    if (!res.ok) {
      if (res.status === 401) clearToken();
      const message = (data && data.error) || `Request failed (${res.status})`;
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  window.LB = {
    apiFetch,
    getToken,
    setToken,
    clearToken,
    isAuthed: () => !!getToken()
  };
})();
