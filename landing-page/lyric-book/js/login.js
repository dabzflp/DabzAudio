(function () {
  if (window.LB.isAuthed()) {
    location.replace("app.html");
    return;
  }
  const form = document.getElementById("loginForm");
  const mfaForm = document.getElementById("mfaForm");
  const msg = document.getElementById("msg");
  const btn = document.getElementById("submitBtn");
  const mfaMsg = document.getElementById("mfaMsg");
  const mfaSubmitBtn = document.getElementById("mfaSubmitBtn");
  let challengeToken = "";

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
      if (data.mfaRequired) {
        challengeToken = data.challengeToken;
        form.hidden = true;
        mfaForm.hidden = false;
        document.getElementById("mfaCode").focus();
        return;
      }
      window.LB.setToken(data.token);
      location.replace("app.html");
    } catch (err) {
      msg.className = "msg err";
      msg.textContent = err.message || "Could not sign in.";
      btn.disabled = false;
      btn.textContent = "Sign in";
    }
  });

  mfaForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    mfaMsg.className = "msg";
    mfaMsg.textContent = "";
    mfaSubmitBtn.disabled = true;
    mfaSubmitBtn.textContent = "Verifying…";
    try {
      const data = await window.LB.apiFetch("/api/auth/mfa/verify", {
        method: "POST",
        body: JSON.stringify({
          challengeToken,
          code: document.getElementById("mfaCode").value.trim()
        })
      });
      window.LB.setToken(data.token);
      location.replace("app.html");
    } catch (err) {
      mfaMsg.className = "msg err";
      mfaMsg.textContent = err.message || "Could not verify the code.";
      mfaSubmitBtn.disabled = false;
      mfaSubmitBtn.textContent = "Verify and sign in";
    }
  });

  document.getElementById("mfaBackBtn").addEventListener("click", () => {
    challengeToken = "";
    mfaForm.reset();
    mfaMsg.textContent = "";
    mfaForm.hidden = true;
    form.hidden = false;
    btn.disabled = false;
    btn.textContent = "Sign in";
  });
})();
