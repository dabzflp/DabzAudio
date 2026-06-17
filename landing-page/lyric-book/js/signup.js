(function () {
  if (window.LB.isAuthed()) {
    location.replace("app.html");
    return;
  }
  const form = document.getElementById("signupForm");
  const msg = document.getElementById("msg");
  const btn = document.getElementById("submitBtn");

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    msg.className = "msg";
    msg.textContent = "";

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const password2 = document.getElementById("password2").value;

    if (!email) return fail("Enter a valid email address.");
    if (password.length < 8) return fail("Password must be at least 8 characters.");
    if (password !== password2) return fail("Passwords do not match.");

    const payload = {
      email,
      password,
      displayName: document.getElementById("displayName").value.trim(),
      artistName: document.getElementById("artistName").value.trim(),
      genre: document.getElementById("genre").value,
      influences: document.getElementById("influences").value.trim(),
      experience: document.getElementById("experience").value
    };

    btn.disabled = true;
    btn.textContent = "Creating account…";
    try {
      const data = await window.LB.apiFetch("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      window.LB.setToken(data.token);
      location.replace("app.html");
    } catch (err) {
      fail(err.message || "Could not create account.");
      btn.disabled = false;
      btn.textContent = "Create account";
    }
  });

  function fail(text) {
    msg.className = "msg err";
    msg.textContent = text;
  }
})();
