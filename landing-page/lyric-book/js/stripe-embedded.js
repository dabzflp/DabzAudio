/**
 * stripe-embedded.js — shared helpers to run Stripe *on-page* (embedded) so
 * users never leave DabzAudio for a Stripe-hosted page.
 *
 * Exposes window.LBStripe with:
 *   - mountEmbeddedCheckout(container, getClientSecret) → pay by card in a modal
 *   - mountConnectOnboarding(container, fetchClientSecret, { onExit }) → onboard in a modal
 *
 * Scripts are loaded lazily on first use and cached. Everything degrades
 * gracefully: callers should fall back to a hosted redirect if these throw.
 */
(function () {
  const CHECKOUT_JS = "https://js.stripe.com/v3/";
  const CONNECT_JS = "https://connect-js.stripe.com/v1.0/connect.js";
  const loaded = {};

  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src="' + src + '"]');
      if (existing) { existing.addEventListener("load", resolve); existing.addEventListener("error", reject); return; }
      const s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Failed to load " + src));
      document.head.appendChild(s);
    });
    return loaded[src];
  }

  let checkoutInstance = null;

  // getClientSecret: async () => "<client_secret>"
  async function mountEmbeddedCheckout(container, getClientSecret) {
    await loadScript(CHECKOUT_JS);
    const secret = await getClientSecret();
    if (!secret) throw new Error("No client secret");
    // Derive the publishable key from the caller (set on window.LBStripe.pk).
    const pk = window.LBStripe.pk;
    if (!pk) throw new Error("No publishable key");
    const stripe = window.Stripe(pk);
    if (checkoutInstance) { try { checkoutInstance.destroy(); } catch (e) {} checkoutInstance = null; }
    checkoutInstance = await stripe.initEmbeddedCheckout({ clientSecret: secret });
    container.innerHTML = "";
    checkoutInstance.mount(container);
    return checkoutInstance;
  }

  function unmountCheckout() {
    if (checkoutInstance) { try { checkoutInstance.destroy(); } catch (e) {} checkoutInstance = null; }
  }

  // fetchClientSecret: async () => "<account_session_client_secret>"
  async function mountConnectOnboarding(container, fetchClientSecret, opts) {
    opts = opts || {};
    await loadScript(CONNECT_JS);
    const pk = window.LBStripe.pk;
    if (!pk) throw new Error("No publishable key");

    let instance;
    const cfg = {
      publishableKey: pk,
      fetchClientSecret,
      appearance: { variables: { colorPrimary: "#ff7a00", colorBackground: "#161616", colorText: "#eaeaea" } }
    };
    if (typeof window.loadConnectAndInitialize === "function") {
      instance = window.loadConnectAndInitialize(cfg);
    } else if (window.StripeConnect && typeof window.StripeConnect.init === "function") {
      instance = window.StripeConnect.init(cfg);
    } else {
      throw new Error("Connect.js unavailable");
    }
    const el = instance.create("account-onboarding");
    if (opts.onExit && typeof el.setOnExit === "function") el.setOnExit(opts.onExit);
    container.innerHTML = "";
    container.appendChild(el);
    return instance;
  }

  window.LBStripe = {
    pk: "",
    mountEmbeddedCheckout,
    unmountCheckout,
    mountConnectOnboarding
  };
})();
