/**
 * paystack-inline.js — run Paystack *on-page* (inline popup) so Naira payers
 * never leave DabzAudio for a Paystack-hosted page.
 *
 * The backend initializes the transaction (split to the artist's subaccount,
 * DabzAudio fee kept as a flat transaction_charge) and returns an access_code.
 * We resume that transaction in a popup here. Everything degrades gracefully:
 * callers should fall back to the returned authorizationUrl if this throws.
 *
 * Exposes window.LBPaystack with:
 *   - load() → Promise, lazily loads Paystack Inline v2
 *   - payWithAccessCode(accessCode) → Promise<transaction>, rejects on cancel/error
 */
(function () {
  const INLINE_JS = "https://js.paystack.co/v2/inline.js";
  let loading = null;

  function load() {
    if (window.PaystackPop) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src="' + INLINE_JS + '"]');
      if (existing) {
        existing.addEventListener("load", resolve);
        existing.addEventListener("error", reject);
        return;
      }
      const s = document.createElement("script");
      s.src = INLINE_JS;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => { loading = null; reject(new Error("Failed to load Paystack")); };
      document.head.appendChild(s);
    });
    return loading;
  }

  // Resume an already-initialized transaction using its access code. Resolves
  // with the Paystack transaction object on success; rejects with Error("cancelled")
  // when the payer closes the popup, or a message on error.
  async function payWithAccessCode(accessCode) {
    await load();
    if (!window.PaystackPop) throw new Error("Paystack unavailable");
    if (!accessCode) throw new Error("Missing access code");
    return new Promise((resolve, reject) => {
      try {
        const popup = new window.PaystackPop();
        popup.resumeTransaction(accessCode, {
          onSuccess: (tx) => resolve(tx || {}),
          onCancel: () => reject(new Error("cancelled")),
          onError: (err) => reject(new Error((err && err.message) || "Payment error"))
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Could not open Paystack"));
      }
    });
  }

  window.LBPaystack = { load, payWithAccessCode };
})();
