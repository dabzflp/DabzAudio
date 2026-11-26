// Tiny API helper shared across the Lyric Book pages.
(function () {
  const TOKEN_KEY = "lb_token";
  const CACHE_KEY = "lb_credits_notice_cache";
  const DISMISS_KEY = "lb_low_credit_dismissed";
  const CACHE_TTL_MS = 45 * 1000;

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
    try {
      sessionStorage.removeItem(CACHE_KEY);
      sessionStorage.removeItem(DISMISS_KEY);
    } catch { /* ignore */ }
  }

  function isWorkspacePage() {
    if (!document.querySelector(".site-header")) return false;
    return !/\/(login|signup|forgot|reset|country|sign|playback-share|transfer-share)\.html$/i.test(location.pathname);
  }

  function renderLowCreditBanner(balance) {
    if (!isWorkspacePage()) return;
    const existing = document.getElementById("lbLowCreditBanner");
    if (!balance || !balance.low) {
      if (existing) existing.remove();
      return;
    }

    const total = Number(balance.total || 0);
    let dismissedAt = null;
    try {
      const raw = sessionStorage.getItem(DISMISS_KEY);
      if (raw !== null) dismissedAt = Number(raw);
    } catch { /* ignore */ }
    // Re-show if credits dropped lower than when the user dismissed it.
    if (dismissedAt !== null && Number.isFinite(dismissedAt) && total >= dismissedAt) {
      if (existing) existing.remove();
      return;
    }

    const header = document.querySelector(".site-header");
    if (!header) return;
    const bar = existing || document.createElement("div");
    bar.id = "lbLowCreditBanner";
    bar.className = "lb-low-credit-banner" + (total <= 0 ? " is-empty" : "");
    bar.setAttribute("role", "status");
    bar.setAttribute("aria-live", "polite");

    const text = total <= 0
      ? "Out of AI credits (0 left across Lyric Book & Drop Pilot)."
      : `Low AI credits: ${total} credit${total === 1 ? "" : "s"} left across Lyric Book & Drop Pilot.`;

    const onSubPage = /\/subscription\.html$/i.test(location.pathname);
    bar.replaceChildren();

    const msgSpan = document.createElement("span");
    msgSpan.textContent = text;

    const actions = document.createElement("span");
    actions.className = "lb-low-credit-actions";

    const cta = document.createElement("a");
    cta.href = onSubPage ? "#proPanel" : "subscription.html#proPanel";
    cta.textContent = "Top up credits";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "lb-low-credit-dismiss";
    close.setAttribute("aria-label", "Dismiss low credit warning");
    close.textContent = "×";
    close.addEventListener("click", () => {
      try { sessionStorage.setItem(DISMISS_KEY, String(total)); } catch { /* ignore */ }
      bar.remove();
    });

    actions.append(cta, close);
    bar.append(msgSpan, actions);
    if (!existing) header.insertAdjacentElement("afterend", bar);
  }

  function cacheAndNotifyCredits(balance) {
    if (!balance || typeof balance !== "object" || balance.total === undefined) return;
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), balance }));
    } catch { /* ignore */ }
    renderLowCreditBanner(balance);
    document.dispatchEvent(new CustomEvent("lb-credits-updated", { detail: { balance } }));
  }

  async function checkGlobalCredits() {
    if (!getToken() || !isWorkspacePage()) return;
    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
      if (cached && cached.balance && Date.now() - cached.at < CACHE_TTL_MS) {
        renderLowCreditBanner(cached.balance);
        return;
      }
    } catch { /* ignore */ }
    try {
      const res = await fetch(base() + "/api/credits", {
        headers: { "Authorization": "Bearer " + getToken() },
        credentials: "include"
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.balance) cacheAndNotifyCredits(data.balance);
    } catch { /* silent: global banner is best-effort */ }
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
    if (data && data.balance) {
      cacheAndNotifyCredits(data.balance);
    }
    if (!res.ok) {
      if (res.status === 401) clearToken();
      if (res.status === 428 && data && data.code === "COUNTRY_REQUIRED" && !/country\.html$/i.test(location.pathname)) {
        const returnTo = location.pathname.split("/").pop() + location.search;
        location.assign("country.html?returnTo=" + encodeURIComponent(returnTo));
      }
      if (res.status === 402 && data && data.code === "SUBSCRIPTION_REQUIRED" && !/subscription\.html$/i.test(location.pathname)) {
        location.assign("subscription.html");
      }
      const message = (data && data.error) || `Request failed (${res.status})`;
      const err = new Error(message);
      err.status = res.status;
      err.code = (data && data.code) || null;
      err.data = data;
      throw err;
    }
    return data;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", checkGlobalCredits);
  } else {
    checkGlobalCredits();
  }

  window.LB = {
    apiFetch,
    getToken,
    setToken,
    clearToken,
    isAuthed: () => !!getToken()
  };
})();
