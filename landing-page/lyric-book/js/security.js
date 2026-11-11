(function () {
  if (!window.LB.isAuthed()) {
    location.replace("login.html");
    return;
  }

  const $ = (id) => document.getElementById(id);
  const status = $("mfaStatus");
  const setupOpenBtn = $("setupOpenBtn");
  const setupForm = $("setupForm");
  const setupPanel = $("setupPanel");
  const enableForm = $("enableForm");
  const recoveryPanel = $("recoveryPanel");
  const disableForm = $("disableForm");
  const message = $("securityMsg");

  function showMessage(text, error) {
    message.textContent = text || "";
    message.className = "msg" + (error ? " err" : " ok");
  }

  async function loadStatus() {
    try {
      const data = await window.LB.apiFetch("/api/auth/mfa/status");
      if (!data.available && data.enabled) {
        status.textContent = "Authenticator MFA is enabled, but server encryption is unavailable. Contact support before signing out.";
        setupOpenBtn.hidden = true;
        setupForm.hidden = true;
        setupPanel.hidden = true;
        disableForm.hidden = true;
        return;
      }
      if (!data.available && !data.enabled) {
        status.textContent = "Authenticator MFA is not configured on this server yet.";
        setupOpenBtn.hidden = true;
        setupForm.hidden = true;
        setupPanel.hidden = true;
        disableForm.hidden = true;
        return;
      }
      if (data.enabled) {
        status.textContent = "Authenticator MFA is enabled. " + data.recoveryCodesRemaining + " recovery code(s) remain.";
        setupOpenBtn.hidden = true;
        setupForm.hidden = true;
        setupPanel.hidden = true;
        disableForm.hidden = false;
      } else {
        status.textContent = data.pending
          ? "Authenticator setup is not complete. Continue setup to replace the pending key."
          : "Authenticator MFA is currently off.";
        setupOpenBtn.hidden = false;
        setupOpenBtn.textContent = data.pending ? "Restart authenticator setup" : "Set up authenticator";
        disableForm.hidden = true;
      }
    } catch (err) {
      status.textContent = err.message || "Could not load security settings.";
      status.className = "msg err";
    }
  }

  setupOpenBtn.addEventListener("click", () => {
    setupForm.hidden = !setupForm.hidden;
    if (!setupForm.hidden) $("setupPassword").focus();
  });

  setupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("setupBtn");
    button.disabled = true;
    showMessage("Preparing authenticator setup…");
    try {
      const data = await window.LB.apiFetch("/api/auth/mfa/setup", {
        method: "POST",
        body: JSON.stringify({ password: $("setupPassword").value })
      });
      $("setupPassword").value = "";
      $("mfaSecret").textContent = data.secret;
      $("authenticatorLink").href = data.otpauthUri;
      setupForm.hidden = true;
      setupOpenBtn.hidden = true;
      setupPanel.hidden = false;
      showMessage("Add this account in your authenticator app, then verify a code.");
      $("enableCode").focus();
    } catch (err) {
      showMessage(err.message || "Could not start authenticator setup.", true);
    } finally {
      button.disabled = false;
    }
  });

  enableForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("enableBtn");
    button.disabled = true;
    showMessage("Verifying authenticator…");
    try {
      const data = await window.LB.apiFetch("/api/auth/mfa/enable", {
        method: "POST",
        body: JSON.stringify({ code: $("enableCode").value.trim() })
      });
      $("mfaSecret").textContent = "";
      $("enableCode").value = "";
      $("recoveryCodes").textContent = data.recoveryCodes.join("\n");
      setupPanel.hidden = true;
      recoveryPanel.hidden = false;
      status.textContent = "Authenticator MFA is enabled.";
      showMessage("MFA is on. Save the recovery codes before leaving this page.");
    } catch (err) {
      showMessage(err.message || "Could not enable authenticator MFA.", true);
    } finally {
      button.disabled = false;
    }
  });

  $("recoveryDoneBtn").addEventListener("click", () => {
    recoveryPanel.hidden = true;
    $("recoveryCodes").textContent = "";
    disableForm.hidden = false;
    loadStatus();
  });

  disableForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("disableBtn");
    button.disabled = true;
    showMessage("Disabling authenticator MFA…");
    try {
      await window.LB.apiFetch("/api/auth/mfa/disable", {
        method: "POST",
        body: JSON.stringify({
          password: $("disablePassword").value,
          code: $("disableCode").value.trim()
        })
      });
      disableForm.reset();
      showMessage("Authenticator MFA is disabled.");
      await loadStatus();
    } catch (err) {
      showMessage(err.message || "Could not disable authenticator MFA.", true);
    } finally {
      button.disabled = false;
    }
  });

  loadStatus();
})();
