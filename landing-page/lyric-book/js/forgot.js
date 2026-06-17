(function () {
  const form = document.getElementById("forgotForm");
  const msg = document.getElementById("msg");
  const btn = document.getElementById("submitBtn");

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    msg.className = "msg";
    msg.textContent = "";
    const email = document.getElementById("email").value.trim();
    if (!email) {
      msg.className = "msg err";
      msg.textContent = "Enter your email address.";
      return;
    }
    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
      const data = await window.LB.apiFetch("/api/auth/forgot", {
        method: "POST",
        body: JSON.stringify({ email })
      });
      msg.className = "msg ok";
      msg.textContent = data.message || "If that email is registered, a reset link is on its way.";
    } catch (err) {
      msg.className = "msg err";
      msg.textContent = err.message || "Something went wrong. Try again.";
    } finally {
      btn.disabled = false;
      btn.textContent = "Send reset link";
    }
  });
})();
