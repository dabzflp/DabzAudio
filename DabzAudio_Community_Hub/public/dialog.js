/* Dabz dialogs: styled replacements for the browser's alert / confirm / prompt.
   window.dabzConfirm(message, opts) -> Promise<boolean>
   window.dabzPrompt(message, defaultValue, opts) -> Promise<string|null>
   window.dabzAlert(message, opts) -> Promise<void>
   window.alert is overridden so any remaining alert() call is styled too. */
(function () {
  "use strict";
  if (window.dabzConfirm) return;

  var css =
    ".dd-overlay{position:fixed;inset:0;z-index:10050;display:flex;align-items:center;justify-content:center;padding:20px;" +
    "background:rgba(4,4,8,.62);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);opacity:0;transition:opacity .18s ease}" +
    ".dd-overlay.show{opacity:1}" +
    ".dd-box{width:min(420px,100%);padding:26px 24px 20px;border-radius:22px;color:#f5f5f7;font-family:Inter,system-ui,-apple-system,sans-serif;" +
    "background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.03)),#101014;border:1px solid rgba(255,255,255,.12);" +
    "box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 60px rgba(255,122,0,.08);transform:translateY(10px) scale(.97);transition:transform .2s cubic-bezier(.22,1,.36,1)}" +
    ".dd-overlay.show .dd-box{transform:none}" +
    ".dd-title{margin:0 0 8px;font-size:1.05rem;font-weight:650;letter-spacing:-.01em}" +
    ".dd-msg{margin:0 0 16px;font-size:.92rem;line-height:1.5;color:rgba(245,245,247,.72);white-space:pre-line;word-break:break-word}" +
    ".dd-input{width:100%;box-sizing:border-box;margin:0 0 18px;padding:11px 14px;border-radius:12px;font:inherit;font-size:.95rem;" +
    "color:#f5f5f7;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.16);outline:none}" +
    ".dd-input:focus{border-color:#ff7a00;box-shadow:0 0 0 3px rgba(255,122,0,.22)}" +
    ".dd-msg:empty{display:none}" +
    ".dd-actions{display:flex;justify-content:flex-end;gap:10px}" +
    ".dd-btn{border-radius:999px;padding:9px 20px;font:inherit;font-size:.9rem;font-weight:600;cursor:pointer;color:#f5f5f7;" +
    "background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);transition:background .15s,transform .15s}" +
    ".dd-btn:hover{background:rgba(255,255,255,.14)}" +
    ".dd-btn:focus-visible{outline:2px solid #ff7a00;outline-offset:2px}" +
    ".dd-btn.primary{color:#1a1207;background:#ff7a00;border-color:#ff7a00}" +
    ".dd-btn.primary:hover{background:#ff8f26}" +
    ".dd-btn.danger{color:#fff;background:#e5484d;border-color:#e5484d}" +
    ".dd-btn.danger:hover{background:#ec5b60}" +
    "html[data-theme='light'] .dd-overlay{background:rgba(20,20,30,.35)}" +
    "html[data-theme='light'] .dd-box{color:#14141a;background:#fff;border-color:rgba(0,0,0,.1);box-shadow:0 30px 80px rgba(0,0,0,.2)}" +
    "html[data-theme='light'] .dd-msg{color:rgba(20,20,26,.7)}" +
    "html[data-theme='light'] .dd-input{color:#14141a;background:#f4f4f6;border-color:rgba(0,0,0,.18)}" +
    "html[data-theme='light'] .dd-btn{color:#14141a;background:rgba(0,0,0,.05);border-color:rgba(0,0,0,.14)}" +
    "html[data-theme='light'] .dd-btn:hover{background:rgba(0,0,0,.09)}" +
    "html[data-theme='light'] .dd-btn.primary{color:#1a1207;background:#ff7a00;border-color:#ff7a00}" +
    "html[data-theme='light'] .dd-btn.danger{color:#fff;background:#e5484d;border-color:#e5484d}" +
    "@media(prefers-reduced-motion:reduce){.dd-overlay,.dd-box{transition:none}}";

  var styleEl = document.createElement("style");
  styleEl.textContent = css;
  (document.head || document.documentElement).appendChild(styleEl);

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function open(o) {
    return new Promise(function (resolve) {
      var previous = document.activeElement;
      var overlay = el("div", "dd-overlay");
      var box = el("div", "dd-box");
      box.setAttribute("role", o.input ? "dialog" : "alertdialog");
      box.setAttribute("aria-modal", "true");
      box.setAttribute("aria-label", o.title);
      box.appendChild(el("h3", "dd-title", o.title));
      box.appendChild(el("p", "dd-msg", o.message));

      var input = null;
      if (o.input) {
        input = el("input", "dd-input");
        input.type = "text";
        input.value = o.value || "";
        box.appendChild(input);
      }

      var actions = el("div", "dd-actions");
      var cancel = null;
      if (o.cancelText) {
        cancel = el("button", "dd-btn", o.cancelText);
        cancel.type = "button";
        actions.appendChild(cancel);
      }
      var ok = el("button", "dd-btn " + (o.danger ? "danger" : "primary"), o.okText);
      ok.type = "button";
      actions.appendChild(ok);
      box.appendChild(actions);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      requestAnimationFrame(function () { overlay.classList.add("show"); });

      var done = false;
      function close(result) {
        if (done) return;
        done = true;
        document.removeEventListener("keydown", onKey, true);
        overlay.classList.remove("show");
        setTimeout(function () { overlay.remove(); }, 180);
        if (previous && previous.focus) { try { previous.focus(); } catch (e) { /* ignore */ } }
        resolve(result);
      }
      var cancelResult = o.input ? null : false;
      function accept() { close(o.input ? input.value : true); }
      function onKey(e) {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(cancel ? cancelResult : (o.input ? null : true)); }
        else if (e.key === "Enter" && (input || document.activeElement === ok || !cancel)) { e.preventDefault(); e.stopPropagation(); accept(); }
        else if (e.key === "Tab") {
          var items = [input, cancel, ok].filter(Boolean);
          var i = items.indexOf(document.activeElement);
          e.preventDefault();
          items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
        }
      }
      document.addEventListener("keydown", onKey, true);
      ok.addEventListener("click", accept);
      if (cancel) cancel.addEventListener("click", function () { close(cancelResult); });
      overlay.addEventListener("mousedown", function (e) { if (e.target === overlay && cancel) close(cancelResult); });

      if (input) { input.focus(); input.select(); } else { ok.focus(); }
    });
  }

  window.dabzConfirm = function (message, opts) {
    opts = opts || {};
    return open({
      title: opts.title || "Are you sure?",
      message: String(message),
      okText: opts.okText || "Confirm",
      cancelText: opts.cancelText || "Cancel",
      danger: opts.danger !== false
    });
  };

  window.dabzPrompt = function (message, value, opts) {
    opts = opts || {};
    return open({
      title: opts.title || String(message),
      message: opts.title ? String(message) : "",
      input: true,
      value: value,
      okText: opts.okText || "Save",
      cancelText: opts.cancelText || "Cancel"
    });
  };

  window.dabzAlert = function (message, opts) {
    opts = opts || {};
    return open({
      title: opts.title || "Heads up",
      message: String(message),
      okText: opts.okText || "OK"
    }).then(function () {});
  };

  window.alert = function (message) { window.dabzAlert(message == null ? "" : message); };
})();
