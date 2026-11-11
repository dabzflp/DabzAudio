(function () {
  const form = document.getElementById("countryForm");
  const select = document.getElementById("countryCode");
  const note = document.getElementById("providerNote");
  const message = document.getElementById("countryMsg");
  const button = document.getElementById("continueBtn");
  const params = new URLSearchParams(location.search);

  function returnPath() {
    const requested = params.get("returnTo") || "app.html";
    const [page, query] = requested.split("?");
    if (!/^(app|subscription|playback|contract|invoice|signup|login)\.html$/i.test(page)) return "app.html";
    return page + (query ? `?${query}` : "");
  }

  function setMessage(text, isError = false) {
    message.textContent = text || "";
    message.className = "msg" + (isError ? " err" : "");
  }

  function updateProviderNote() {
    note.textContent = select.value === "NG"
      ? "Nigeria account payments use Paystack and Naira pricing."
      : select.value
        ? "Account payments use Stripe. Paystack and Naira pricing will not be shown."
        : "Nigeria uses Paystack. Other countries use Stripe.";
  }

  async function init() {
    if (!window.LB.isAuthed()) {
      location.replace("login.html");
      return;
    }
    try {
      const [me, catalog] = await Promise.all([
        window.LB.apiFetch("/api/auth/me"),
        window.LB.apiFetch("/api/countries")
      ]);
      if (me.user.countryCode) {
        location.replace(returnPath());
        return;
      }
      select.replaceChildren(new Option("Select your country…", ""));
      catalog.countries.forEach(({ code, name }) => select.add(new Option(name, code)));
      select.addEventListener("change", updateProviderNote);
    } catch (err) {
      setMessage(err.message || "Could not load countries. Refresh to try again.", true);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!select.value) return setMessage("Select your country to continue.", true);
    button.disabled = true;
    setMessage("Saving your country…");
    try {
      await window.LB.apiFetch("/api/profile/country", {
        method: "PUT",
        body: JSON.stringify({ countryCode: select.value })
      });
      location.replace(returnPath());
    } catch (err) {
      setMessage(err.message || "Could not save your country.", true);
      button.disabled = false;
    }
  });

  init();
})();
