(function () {
  const form = document.getElementById("resetForm");
  const msg = document.getElementById("msg");
  const btn = document.getElementById("submitBtn");
  const token = new URLSearchParams(location.search).get("token") || "";

  if (!token) {
    msg.className = "msg err";
    msg.textContent = "This reset link is missing its token. Request a new one.";
    btn.disabled = true;
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    msg.className = "msg";
    msg.textContent = "";
    const password = document.getElementById("password").value;
    const password2 = document.getElementById("password2").value;

    if (password.length < 8) {
      msg.className = "msg err";
      msg.textContent = "Password must be at least 8 characters.";
      return;
    }
    if (password !== password2) {
      msg.className = "msg err";
      msg.textContent = "Passwords do not match.";
      return;
    }
    btn.disabled = true;
    btn.textContent = "Updating…";
    try {
      const data = await window.LB.apiFetch("/api/auth/reset", {
        method: "POST",
        body: JSON.stringify({ token, password })
      });
      msg.className = "msg ok";
      msg.textContent = (data.message || "Password updated.") + " Redirecting to sign in…";
      setTimeout(() => location.replace("login.html"), 1500);
    } catch (err) {
      msg.className = "msg err";
      msg.textContent = err.message || "Could not reset password.";
      btn.disabled = false;
      btn.textContent = "Update password";
    }
  });
})();
