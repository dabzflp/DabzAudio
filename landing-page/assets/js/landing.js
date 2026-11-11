/* DabzAudio landing page: animated waveform hero, scroll reveals, glow cards. */
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Scroll reveal
  var items = document.querySelectorAll(".lp-reveal");
  if ("IntersectionObserver" in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add("in"); });
  }

  // Cursor glow + per-card spotlight
  var glow = document.querySelector(".lp-cursor");
  if (glow && !reduce && window.matchMedia("(hover: hover)").matches) {
    window.addEventListener("pointermove", function (e) {
      glow.style.transform = "translate(" + e.clientX + "px," + e.clientY + "px)";
    }, { passive: true });
  } else if (glow) {
    glow.style.display = "none";
  }
  document.querySelectorAll(".lp-card").forEach(function (card) {
    card.addEventListener("pointermove", function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty("--mx", e.clientX - r.left + "px");
      card.style.setProperty("--my", e.clientY - r.top + "px");
    });
  });

  // Showcase video scales up as it enters the viewport
  var frame = document.querySelector(".lp-frame");
  if (frame && !reduce) {
    var onScroll = function () {
      var r = frame.getBoundingClientRect();
      var vh = window.innerHeight;
      var p = Math.min(1, Math.max(0, (vh - r.top) / (vh * 0.9)));
      frame.style.setProperty("--s", (0.9 + 0.1 * p).toFixed(3));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  // Hero: layered sine waves that react to the pointer
  var canvas = document.getElementById("lpWave");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");
  var w, h, dpr, mouseX = 0.5, mouseY = 0.5, running = true, t = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", function (e) {
    mouseX = e.clientX / window.innerWidth;
    mouseY = e.clientY / window.innerHeight;
  }, { passive: true });

  var LINES = 46;
  function draw() {
    var light = document.documentElement.getAttribute("data-theme") === "light";
    ctx.clearRect(0, 0, w, h);
    var cy = h * 0.5;
    var amp = h * (0.07 + 0.07 * (1 - Math.abs(mouseY - 0.5) * 2));
    for (var i = 0; i < LINES; i++) {
      var k = i / (LINES - 1);
      ctx.beginPath();
      for (var x = 0; x <= w; x += 6) {
        var nx = x / w;
        var env = Math.sin(nx * Math.PI);
        var y = cy +
          Math.sin(nx * 7 + t * 0.9 + k * 3.2) * amp * env * (0.5 + k) +
          Math.sin(nx * 15 - t * 1.4 + k * 5) * amp * 0.35 * env * (1 - k) +
          Math.sin((nx - mouseX) * 9 + t * 2) * amp * 0.25 * env * Math.exp(-Math.pow((nx - mouseX) * 3, 2)) +
          (k - 0.5) * h * 0.22;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      var a = 0.05 + 0.4 * Math.pow(1 - Math.abs(k - 0.5) * 2, 2);
      ctx.strokeStyle = light
        ? "rgba(224,100,0," + (a * 0.7).toFixed(3) + ")"
        : "rgba(255," + Math.round(110 + 70 * k) + "," + Math.round(20 + 60 * k) + "," + a.toFixed(3) + ")";
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
    if (!reduce) t += 0.012;
  }
  function loop() {
    if (running) draw();
    if (!reduce) requestAnimationFrame(loop);
  }
  // Pause when the hero is off-screen
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (en) { running = en[0].isIntersecting; }).observe(canvas);
  }
  draw();
  if (!reduce) requestAnimationFrame(loop);
})();
