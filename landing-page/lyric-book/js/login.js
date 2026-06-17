(function () {
  if (window.LB.isAuthed()) {
    location.replace("app.html");
    return;
  }
  const form = document.getElementById("loginForm");
  const msg = document.getElementById("msg");
  const btn = document.getElementById("submitBtn");

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    msg.className = "msg";
    msg.textContent = "";
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    if (!email || !password) {
      msg.className = "msg err";
      msg.textContent = "Enter your email and password.";
      return;
    }
    btn.disabled = true;
    btn.textContent = "Signing in…";
    try {
      const data = await window.LB.apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      window.LB.setToken(data.token);
      location.replace("app.html");
    } catch (err) {
      msg.className = "msg err";
      msg.textContent = err.message || "Could not sign in.";
      btn.disabled = false;
      btn.textContent = "Sign in";
    }
  });
})();
