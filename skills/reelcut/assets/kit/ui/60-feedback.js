/*
 * Feedback moments (apple-glass › micro-interactions › Selection, Confirmation, Numbers, Earned moments):
 *
 *   RC.checkDraw(tl, el, at, o)     the disc grows 0.4 → 1 on a snappy spring, the tick draws over 220 ms after 80 ms
 *   RC.saved(tl, el, at, o)         "Saved ✓" fades in beside a control and goes after 1.4 s (o.hold)
 *   RC.copied(tl, el, at, o)        the copy glyph turns into a check (cross-fade, 0.8 → 1), "Copied" shows; back after 1.2 s
 *   RC.asyncButton(tl, btn, at, o)  label → spinner (width kept) → check pops (0.5 → 1) → label again
 *   RC.ringDone(tl, ring, at, o)    a progress ring fills (spring.soft), then becomes a check
 *   RC.bump(tl, badge, at, o)       a count badge grows a touch and settles as its number rolls
 *   RC.delta(tl, el, at, o)         "+N" rises 18 pt and fades in green over 1.4 s
 *   RC.shine(tl, el, at, o)         the earned moment: the pane wobbles like a droplet (volume kept), light sweeps it,
 *                                   a soft bloom with a faint rainbow fringe breathes behind it
 *   RC.confetti(tl, root, at, o)    only for the biggest moment: seeded pieces under gravity, finite, from time alone
 */
(function () {
  var RC = window.RC, gsap = window.gsap;
  if (!RC || RC.checkDraw) return;
  var NS = "http://www.w3.org/2000/svg";
  function ptOf(el) { return parseFloat(getComputedStyle(el).getPropertyValue("--pt")) || 1.5; }

  function tick(el) {
    var path = el.querySelector("path");
    if (!path) {
      var svg = document.createElementNS(NS, "svg"); svg.setAttribute("viewBox", "0 0 24 24");
      path = document.createElementNS(NS, "path"); path.setAttribute("d", "M5 12.6l4.4 4.4L19 7.4");
      svg.appendChild(path); el.appendChild(svg);
    }
    return path;
  }

  function checkDraw(tl, target, at, o) {
    o = o || {};
    RC.q(target).forEach(function (el) {
      var path = tick(el), len = path.getTotalLength ? path.getTotalLength() : 22;
      path.style.strokeDasharray = len; path.style.strokeDashoffset = len;
      // Hidden until it happens (a check never shows before its moment), unless the beat says it is already done.
      if (!o.visible) gsap.set(el, { opacity: 0 });
      RC.emit("success", at);
      if (!el.classList.contains("rc-bare")) {
        var s = RC.spring(o.reward ? "reward" : "snappy", el);
        tl.fromTo(el, { scale: 0.4 }, { scale: 1, duration: s.duration, ease: s.ease, immediateRender: false }, at);
      }
      tl.to(el, { opacity: 1, duration: 0.12, ease: RC.ease("apple.out") }, at);
      tl.to(path, { strokeDashoffset: 0, duration: 0.22, ease: RC.ease("apple.out") }, at + 0.08);
    });
    return tl;
  }

  function saved(tl, target, at, o) {
    o = o || {};
    RC.q(target).forEach(function (el) {
      var c = el.querySelector(".rc-check-d");
      tl.fromTo(el, { x: -6 }, { x: 0, duration: RC.spring("default", el).duration, ease: RC.ease("default", el), immediateRender: false }, at);
      tl.to(el, { opacity: 1, duration: 0.2, ease: RC.ease("apple.out") }, at);
      if (c) checkDraw(tl, c, at + 0.05);
      if (o.hold !== false) tl.to(el, { opacity: 0, duration: 0.25, ease: RC.ease("apple.exit") }, at + (o.hold || 1.4));
    });
    return tl;
  }

  function copied(tl, target, at, o) {
    o = o || {};
    RC.q(target).forEach(function (el) {
      var a = el.querySelector(".rc-copy-a"), b = el.querySelector(".rc-copy-b"), tip = el.querySelector(".rc-tip");
      RC.press(tl, el, at, { scale: 0.9 });
      RC.emit("click", at);
      var s = RC.spring("snappy", el);
      if (a) tl.to(a, { opacity: 0, scale: 0.8, duration: 0.15, ease: RC.ease("apple.exit") }, at + 0.05);
      if (b) { tl.fromTo(b, { scale: 0.8 }, { scale: 1, duration: s.duration, ease: s.ease, immediateRender: false }, at + 0.08); tl.to(b, { opacity: 1, duration: 0.15, ease: RC.ease("apple.out") }, at + 0.08); }
      if (tip) { tl.fromTo(tip, { y: 4 }, { y: 0, duration: 0.2, ease: RC.ease("apple.out"), immediateRender: false }, at + 0.1); tl.to(tip, { opacity: 1, duration: 0.15, ease: RC.ease("apple.out") }, at + 0.1); }
      if (o.back !== false) {
        var t = at + (o.back || 1.2);
        if (tip) tl.to(tip, { opacity: 0, duration: 0.16, ease: RC.ease("apple.exit") }, t);
        if (b) tl.to(b, { opacity: 0, scale: 0.8, duration: 0.15, ease: RC.ease("apple.exit") }, t);
        if (a) { tl.to(a, { opacity: 1, duration: 0.15, ease: RC.ease("apple.out") }, t + 0.05); RC.to(tl, a, t + 0.05, { scale: 1 }, "snappy"); }
      }
    });
    return tl;
  }

  function asyncButton(tl, target, at, o) {
    o = o || {};
    RC.q(target).forEach(function (btn) {
      var lbl = btn.querySelector(".rc-lbl"), spin = btn.querySelector(".rc-spin"), chk = btn.querySelector(".rc-check-d");
      var work = o.work || 1.2, show = o.show || 1.0;
      RC.press(tl, btn, at, { scale: 0.97 });
      RC.emit("click", at);
      // The label goes; its box keeps the button's width. The spinner turns at a steady 1.1 turns a second.
      tl.to(lbl, { opacity: 0, duration: 0.12, ease: RC.ease("apple.exit") }, at + 0.06);
      tl.to(spin, { opacity: 1, duration: 0.15, ease: RC.ease("apple.out") }, at + 0.12);
      tl.fromTo(spin, { rotation: 0 }, { rotation: 396 * (work + 0.1), duration: work + 0.1, ease: "none", immediateRender: false }, at + 0.12);
      var done = at + 0.12 + work;
      tl.to(spin, { opacity: 0, duration: 0.12, ease: RC.ease("apple.exit") }, done);
      if (o.doneColor) tl.to(btn, { backgroundColor: o.doneColor, duration: 0.25, ease: RC.ease("apple.out") }, done);
      if (chk) {
        var s = RC.spring("snappy", chk);
        tl.fromTo(chk, { scale: 0.5 }, { scale: 1, duration: s.duration, ease: s.ease, immediateRender: false }, done + 0.04);
        checkDraw(tl, chk, done + 0.04);
      }
      if (o.reset !== false) {
        var back = done + show;
        if (chk) tl.to(chk, { opacity: 0, duration: 0.15, ease: RC.ease("apple.exit") }, back);
        if (o.doneColor) tl.to(btn, { backgroundColor: o.color || getComputedStyle(btn).backgroundColor, duration: 0.3, ease: RC.ease("apple.out") }, back);
        if (o.doneLabel) tl.set(lbl, { textContent: o.doneLabel }, back);
        tl.to(lbl, { opacity: 1, duration: 0.2, ease: RC.ease("apple.out") }, back + 0.08);
      }
    });
    return tl;
  }

  function ringDone(tl, target, at, o) {
    o = o || {};
    RC.q(target).forEach(function (ring) {
      var v = ring.querySelector("circle.v"), chk = ring.querySelector(".rc-check-d"), svg = ring.querySelector("svg");
      var r = Number(v.getAttribute("r")), len = 2 * Math.PI * r;
      // A ring the beat has already been filling keeps its state; otherwise it starts from o.from (0..1).
      if (!v.style.strokeDasharray) { v.style.strokeDasharray = len; v.style.strokeDashoffset = len * (1 - (o.from || 0)); }
      var d = o.duration || 1.2;
      tl.to(v, { strokeDashoffset: 0, duration: d, ease: RC.ease("spring.soft") }, at);
      var end = at + d * 0.8;
      tl.to(svg, { opacity: 0, scale: 0.9, duration: 0.2, ease: RC.ease("apple.exit") }, end);
      if (chk) checkDraw(tl, chk, end + 0.05, { reward: o.reward });
    });
    return tl;
  }

  function bump(tl, target, at, o) {
    o = o || {};
    RC.q(target).forEach(function (b) {
      tl.to(b, { scale: 1.2, duration: 0.1, ease: RC.ease("apple.out") }, at);
      RC.to(tl, b, at + 0.1, { scale: 1 }, "snappy");
      if (o.values) RC.numeric(tl, b, at, { values: o.values, each: o.each || 1 });
      RC.emit("pop", at);
    });
    return tl;
  }

  function delta(tl, target, at, o) {
    o = o || {};
    RC.q(target).forEach(function (el) {
      var rise = 18 * ptOf(el);
      tl.fromTo(el, { y: 0 }, { y: -rise, duration: o.duration || 1.4, ease: RC.ease("apple.out"), immediateRender: false }, at);
      tl.to(el, { opacity: 1, duration: 0.15, ease: RC.ease("apple.out") }, at);
      tl.to(el, { opacity: 0, duration: 0.4, ease: RC.ease("apple.exit") }, at + (o.duration || 1.4) - 0.4);
    });
    return tl;
  }

  function shine(tl, target, at, o) {
    o = o || {};
    RC.q(target).forEach(function (el) {
      el.classList.add("rc-shiny");
      var band = el.querySelector(":scope > .rc-shine-band");
      if (!band) { band = document.createElement("i"); band.className = "rc-shine-band"; el.appendChild(band); }
      var bloom = el.__rcBloom;
      if (!bloom && el.parentNode) {
        bloom = document.createElement("i"); bloom.className = "rc-shine-bloom";
        var pt = ptOf(el), pad = 14 * pt;
        bloom.style.left = el.offsetLeft - pad + "px"; bloom.style.top = el.offsetTop - pad + "px";
        bloom.style.width = el.offsetWidth + 2 * pad + "px"; bloom.style.height = el.offsetHeight + 2 * pad + "px"; bloom.style.right = "auto"; bloom.style.bottom = "auto";
        bloom.style.borderRadius = getComputedStyle(el).borderRadius;
        el.parentNode.insertBefore(bloom, el); el.__rcBloom = bloom;
      }
      RC.emit("success", at);
      // A droplet: wider and flatter, then taller, settling; scaleX × scaleY stays near 1, so the volume holds.
      var k = [[1.07, 0.935], [0.955, 1.045], [1.02, 0.98], [0.995, 1.005], [1, 1]];
      tl.to(el, { keyframes: k.map(function (s, i) { return { scaleX: s[0], scaleY: s[1], duration: i === 0 ? 0.12 : 0.14 + i * 0.03, ease: RC.ease("apple.glide") }; }) }, at);
      tl.fromTo(band, { xPercent: -160 }, { xPercent: 330, duration: 0.8, ease: RC.ease("apple.out"), immediateRender: false }, at + 0.06);
      if (bloom) tl.to(bloom, { keyframes: [{ opacity: o.bloom || 0.55, duration: 0.25, ease: RC.ease("apple.out") }, { opacity: 0, duration: 0.8, ease: RC.ease("apple.out") }] }, at + 0.04);
    });
    return tl;
  }

  function confetti(tl, rootT, at, o) {
    o = o || {};
    var root = RC.one(rootT); if (!root) return tl;
    var rnd = RC.rand(o.seed || 11), n = o.count || 60, dur = o.duration || 2.2, g = o.gravity || 1600;
    var colors = o.colors || ["var(--accent)", "var(--accent-2)", "var(--ui-green)", "var(--ui-yellow)", "var(--ui-pink)", "var(--ui-blue)"];
    var box = document.createElement("div"); box.className = "rc-confetti"; box.style.left = (o.x || 540) + "px"; box.style.top = (o.y || 540) + "px";
    root.appendChild(box);
    var parts = [];
    for (var i = 0; i < n; i++) {
      var p = document.createElement("i"), w = 8 + rnd() * 8, h = w * (0.4 + rnd() * 0.5);
      p.style.width = w + "px"; p.style.height = h + "px"; p.style.background = colors[i % colors.length]; p.style.opacity = "0";
      box.appendChild(p);
      var ang = -Math.PI / 2 + (rnd() - 0.5) * (o.spread || 1.6), sp = (o.speed || 1100) * (0.55 + rnd() * 0.6);
      parts.push({ el: p, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, rot: rnd() * 360, vr: (rnd() - 0.5) * 900, drag: 0.6 + rnd() * 0.5 });
    }
    var st = { t: 0 };
    var paint = function () {
      var t = st.t;
      parts.forEach(function (q) {
        // Air drag slows each piece (exponential), gravity pulls it down; position is closed-form in t.
        var k = q.drag, ex = (1 - Math.exp(-k * t)) / k;
        var x = q.vx * ex, y = q.vy * ex + (g / k) * (t - ex);
        var a = t <= 0 ? 0 : Math.min(1, t * 12) * Math.max(0, Math.min(1, (dur - t) / 0.5));
        q.el.style.transform = "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px) rotate(" + (q.rot + q.vr * t).toFixed(1) + "deg) rotateX(" + (t * 540 * q.drag).toFixed(0) + "deg)";
        q.el.style.opacity = a.toFixed(3);
      });
    };
    paint();
    RC.emit("success", at);
    tl.fromTo(st, { t: 0 }, { t: dur, duration: dur, ease: "none", onUpdate: paint, immediateRender: false }, at);
    return tl;
  }

  Object.assign(window.RC, {
    checkDraw: checkDraw, saved: saved, copied: copied, asyncButton: asyncButton, ringDone: ringDone, bump: bump, delta: delta,
    shine: shine, confetti: confetti,
  });
})();
