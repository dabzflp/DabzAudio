(function () {
  const els = {
    title: document.getElementById("membershipTitle"),
    message: document.getElementById("membershipMessage"),
    status: document.getElementById("membershipStatus"),
    controls: document.getElementById("billingControls"),
    currency: document.getElementById("billingCurrency"),
    price: document.getElementById("billingPrice"),
    monthlyPlanDetails: document.getElementById("monthlyPlanDetails"),
    annualPlanDetails: document.getElementById("annualPlanDetails"),
    monthlyPlanPrice: document.getElementById("monthlyPlanPrice"),
    annualPlanPrice: document.getElementById("annualPlanPrice"),
    note: document.getElementById("billingNote"),
    subscribe: document.getElementById("subscribeBtn"),
    continue: document.getElementById("continueBtn"),
    cancel: document.getElementById("cancelBtn"),
    msg: document.getElementById("billingMsg"),
    logout: document.getElementById("logoutBtn")
  };
  let state = null;
  let checking = false;

  function selectedPlan() {
    return document.querySelector('input[name="billingPeriod"]:checked')?.value || "monthly";
  }

  function formatMoney(amount, currency) {
    try {
      const locale = currency === "ngn" ? "en-NG" : undefined;
      const maximumFractionDigits = currency === "ngn" ? 0 : 2;
      return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits }).format(amount);
    } catch {
      return `${currency.toUpperCase()} ${amount}`;
    }
  }

  function setMessage(text, isError = false) {
    els.msg.textContent = text || "";
    els.msg.className = "msg" + (isError ? " err" : " ok");
  }

  function daysLeft(date) {
    if (!date) return 0;
    return Math.max(0, Math.ceil((new Date(date).getTime() - Date.now()) / 86400000));
  }

  function render() {
    const { status, billingExempt, unlimitedAccess, trialEndsAt, currentPeriodEnd, cancelAtPeriodEnd, prices, providers, currencies } = state;
    const trialDays = daysLeft(trialEndsAt);
    populateCurrencies(currencies, providers);
    els.continue.hidden = true;
    els.cancel.hidden = true;
    els.controls.hidden = true;
    els.status.hidden = false;

    if (unlimitedAccess) {
      els.title.textContent = "Your unlimited access is active";
      els.message.textContent = "All current and future paid features are unlocked. AI use still uses credits; you can buy more when needed.";
      els.status.textContent = "Unlimited feature access · AI credits and safety limits still apply";
      els.continue.hidden = false;
      return;
    }
    if (billingExempt || status === "grandfathered") {
      els.title.textContent = "Your grandfathered access is active";
      els.message.textContent = "Your access includes Lyric Book Pro and Drop Pilot. Monthly AI credits are included; buy a credit top-up when they run out.";
      els.status.textContent = "Grandfathered access · Pro and Drop Pilot included";
      els.continue.hidden = false;
      return;
    }
    if (status === "trialing" && trialDays > 0) {
      els.title.textContent = "Your free trial is active";
      els.message.textContent = `You have ${trialDays} day${trialDays === 1 ? "" : "s"} left. Upgrade now to keep using every Lyric Book tool without interruption.`;
      els.status.textContent = `Your free access runs through ${new Date(trialEndsAt).toLocaleDateString()}. You will not be charged unless you choose a plan and complete checkout.`;
      els.continue.hidden = false;
      els.controls.hidden = false;
      els.subscribe.textContent = "Upgrade now";
      updatePrice(prices, providers);
      return;
    }
    if (status === "active" || status === "past_due") {
      els.title.textContent = status === "active" ? "Your subscription is active" : "Payment needs attention";
      const planName = state.plan === "annual" ? "Annual" : "Monthly";
      const isNigerianAccount = String(state.countryCode || "").toUpperCase() === "NG";
      const storedCurrency = String(state.currency || "").toLowerCase();
      const planCurrency = isNigerianAccount ? "ngn" : storedCurrency;
      const prices = state.tier === "pro" ? state.proPrices : state.prices;
      const planPrice = prices?.[planCurrency]?.[state.plan];
      els.message.textContent = Number.isFinite(planPrice)
        ? `${planName} plan · ${formatMoney(planPrice, planCurrency)} / ${state.plan === "annual" ? "year" : "month"}`
        : `${planName} plan · ${planCurrency.toUpperCase()}`;
      const billingStatus = cancelAtPeriodEnd
        ? `Renewal is cancelled. Your access continues through ${currentPeriodEnd ? new Date(currentPeriodEnd).toLocaleDateString() : "the current period"}.`
        : `Next renewal: ${currentPeriodEnd ? new Date(currentPeriodEnd).toLocaleDateString() : "provider confirmation pending"}.`;
      const currencyNotice = isNigerianAccount && storedCurrency !== "ngn"
        ? "Nigerian plan pricing is shown; your existing payment setup has not been switched to Naira. "
        : "";
      els.status.textContent = currencyNotice + billingStatus;
      els.continue.hidden = false;
      els.cancel.hidden = status !== "active" || cancelAtPeriodEnd;
      return;
    }

    els.title.textContent = "Choose your Lyric Book plan";
    els.message.textContent = status === "pending"
      ? "We’re confirming your payment. Refresh this page in a moment."
      : "Your 30-day free trial has ended. Subscribe to restore access to all Lyric Book tools.";
    els.status.textContent = "Your trial did not require a payment method. You’ll be charged only after you choose a plan and complete checkout.";
    els.controls.hidden = false;
    els.subscribe.textContent = "Choose plan and upgrade";
    updatePrice(prices, providers);
  }

  function populateCurrencies(currencies, providers) {
    const selected = els.currency.value;
    const options = [];
    if (providers?.stripe) {
      (currencies?.stripe || ["usd"]).forEach((code) => options.push([code, `Pay in ${code.toUpperCase()}`]));
    }
    if (currencies?.paystack?.includes("ngn")) {
      options.push(["ngn", providers?.paystack ? "Pay in Naira (₦)" : "Pay in Naira (₦) · setup required"]);
    }
    els.currency.replaceChildren(...options.map(([code, label]) => {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = label;
      return option;
    }));
    els.currency.value = options.some(([code]) => code === selected) ? selected : options[0]?.[0] || "usd";
  }

  function updatePrice(prices = state?.prices, providers = state?.providers) {
    if (!prices) return;
    const currency = els.currency.value;
    const plan = selectedPlan();
    if (!prices[currency]) return;
    const amount = prices[currency][plan];
    const annualSavings = prices[currency].monthly * 12 - prices[currency].annual;
    els.monthlyPlanDetails.textContent = `${formatMoney(prices[currency].monthly, currency)} each month · renews monthly`;
    els.annualPlanDetails.textContent = `${formatMoney(prices[currency].annual, currency)} each year · save ${formatMoney(annualSavings, currency)}`;
    els.monthlyPlanPrice.textContent = "Flexible monthly billing";
    els.annualPlanPrice.textContent = "Best value · one month free";
    els.price.innerHTML = `${formatMoney(amount, currency)} <small>/ ${plan === "annual" ? "year" : "month"}</small>`;
    const available = currency === "ngn" ? providers.paystack : providers.stripe;
    els.subscribe.disabled = !available;
    const fxNotice = !state.fxAvailable && currency !== "ngn"
      ? "Foreign-currency prices are temporarily unavailable; GBP checkout remains available. "
      : state.fxAvailable && currency !== "gbp" && currency !== "ngn" && state.fxRateDate
        ? `Converted from GBP using rates dated ${state.fxRateDate}. `
        : "";
    els.note.textContent = fxNotice + (!available
      ? currency === "ngn"
        ? "Paystack Naira subscriptions are not ready yet. Monthly and annual plans must be set up first."
        : "Card subscriptions are not configured yet."
      : state.status === "trialing" && daysLeft(state.trialEndsAt) > 0
        ? `Upgrade now and billing starts at checkout. Your trial will not automatically charge you. ${plan === "annual" ? "Annual plan renews yearly." : "Monthly plan renews monthly."}`
      : plan === "annual"
        ? `Billed annually. One month free: ${formatMoney(amount, currency)} instead of ${formatMoney(prices[currency].monthly * 12, currency)}.`
        : "Billed monthly. Cancel renewal any time.");
  }

  async function load() {
    if (!window.LB.isAuthed()) { location.replace("login.html"); return; }
    try {
      const checkout = new URLSearchParams(location.search);
      if (checkout.get("checkout") === "paystack" && checkout.get("reference")) {
        setMessage("Confirming Paystack payment…");
        await window.LB.apiFetch("/api/subscription/paystack/verify", {
          method: "POST",
          body: JSON.stringify({ reference: checkout.get("reference") })
        }).catch(() => {});
        history.replaceState(null, "", location.pathname);
      }
      state = await window.LB.apiFetch("/api/subscription");
      render();
      if (checkout.get("checkout") === "success" && state.status === "pending") {
        setMessage("Checkout completed. Waiting for Stripe confirmation…");
        if (!checking) {
          checking = true;
          let attempts = 0;
          const poll = async () => {
            if (attempts++ >= 8) { checking = false; setMessage("Still confirming. Refresh shortly to check access."); return; }
            await new Promise((resolve) => setTimeout(resolve, 1800));
            try {
              state = await window.LB.apiFetch("/api/subscription");
              render();
              if (state.status === "active") { setMessage("Subscription active. Your Lyric Book access is restored."); checking = false; return; }
            } catch { /* display the current billing page if one poll fails */ }
            poll();
          };
          poll();
        }
      }
    } catch (err) {
      els.title.textContent = "Could not load membership";
      els.message.textContent = err.message || "Please reload this page.";
    }
  }

  els.currency.addEventListener("change", () => updatePrice());
  document.querySelectorAll('input[name="billingPeriod"]').forEach((radio) => radio.addEventListener("change", () => updatePrice()));
  els.subscribe.addEventListener("click", async () => {
    els.subscribe.disabled = true;
    setMessage("Opening secure checkout…");
    try {
      const result = await window.LB.apiFetch("/api/subscription/checkout", {
        method: "POST",
        body: JSON.stringify({ plan: selectedPlan(), currency: els.currency.value })
      });
      location.assign(result.url);
    } catch (err) {
      setMessage(err.message || "Could not start checkout.", true);
      updatePrice();
    } finally {
      els.subscribe.disabled = false;
    }
  });
  els.cancel.addEventListener("click", async () => {
    if (!(await dabzConfirm("You will keep access until the current paid period ends.", { title: "Cancel renewal?", okText: "Cancel renewal", cancelText: "Keep plan" }))) return;
    els.cancel.disabled = true;
    try {
      await window.LB.apiFetch("/api/subscription/cancel", { method: "POST", body: "{}" });
      state = await window.LB.apiFetch("/api/subscription");
      render();
      setMessage("Renewal cancelled.");
    } catch (err) { setMessage(err.message || "Could not cancel the subscription.", true); }
    finally { els.cancel.disabled = false; }
  });
  els.logout.addEventListener("click", async () => {
    try { await window.LB.apiFetch("/api/auth/logout", { method: "POST", body: "{}" }); } catch { /* clear local session either way */ }
    window.LB.clearToken();
    location.replace("login.html");
  });

  load();
})();
