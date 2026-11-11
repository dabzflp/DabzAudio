/* Adds a show/hide button to every password field. */
(function () {
  var EYE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.9 17.9A10.9 10.9 0 0 1 12 19c-6.4 0-10-7-10-7a18.5 18.5 0 0 1 5.1-5.9M9.9 5.2A10 10 0 0 1 12 5c6.4 0 10 7 10 7a18.6 18.6 0 0 1-2.2 3.2M1 1l22 22"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/></svg>';

  var css = document.createElement('style');
  css.textContent =
    '.pw-wrap{position:relative;display:block;width:100%}' +
    '.pw-wrap>input{width:100%;padding-right:44px!important}' +
    '.pw-eye{position:absolute;top:50%;right:6px;transform:translateY(-50%);width:34px;height:34px;padding:0!important;display:grid;place-items:center;border:0!important;border-radius:50%!important;background:transparent!important;color:#8a8a93!important;cursor:pointer;box-shadow:none!important}' +
    '.pw-eye:hover{color:#ff7a00!important;background:rgba(255,122,0,.12)!important;transform:translateY(-50%)!important}' +
    '.pw-eye:focus-visible{outline:2px solid #ff7a00;outline-offset:1px}';
  document.head.appendChild(css);

  function wrap(input) {
    if (input.dataset.pwToggle) return;
    input.dataset.pwToggle = '1';
    var box = document.createElement('div');
    box.className = 'pw-wrap';
    input.parentNode.insertBefore(box, input);
    box.appendChild(input);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-eye';
    btn.setAttribute('aria-label', 'Show password');
    btn.innerHTML = EYE;
    btn.addEventListener('click', function () {
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? EYE_OFF : EYE;
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
      input.focus();
    });
    box.appendChild(btn);
  }

  function init() {
    document.querySelectorAll('input[type="password"]').forEach(wrap);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
