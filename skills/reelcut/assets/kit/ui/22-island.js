/*
 * The Dynamic Island: the shape morphs on its own liquid spring, content cross-fades the way Live Activities do.
 *
 *   RC.islandSet(di, "compact")                         the state at frame 0, no motion
 *   RC.island(tl, di, at, "expanded", { h: 160 })      morph to a state; content for it fades in, the rest out
 *   RC.island(tl, di, at, "minimal")                   a second activity: the bubble splits off to the right
 *   RC.island(tl, di, at, { l, w, h, rad })            any shape (a wide alert pill, a Face ID square)
 *   RC.islandWave(tl, wave, at, seconds, { seed })      a live waveform: bar heights from a seeded, smooth signal
 *   RC.numeric(tl, el, at, { values, each })            SwiftUI's numeric content transition: only the digits
 *                                                       that change roll, down when the number falls, up when it grows
 *
 * The recipe (HIG › Live Activities, and how the island moves on device): the black shape leads on spring.island
 * (230/24, a 1.7% overshoot — the one shape Apple lets go past its mark, so it reads as liquid); content follows
 * 0.12 s later out of a little blur and from 0.88 scale, so it seems to be poured into the shape; when the island
 * shrinks, content leaves first (0.15 s, accelerating away) and the shape follows. Existing elements keep their
 * places across states. Every transition settles well inside Apple's two-second limit.
 */
(function () {
  var RC = window.RC, gsap = window.gsap;
  if (!RC || RC.island) return;
  var uid = 0;

  var GEO = {
    idle: { l: 138, w: 126, h: 37, rad: 18.5 },
    compact: { l: 86, w: 230, h: 37, rad: 18.5 },
    minimal: { l: 93, w: 171, h: 37, rad: 18.5 },
    expanded: { l: 15.5, w: 371, h: 160, rad: 44 },
  };
  var BUBBLE_IN = 227, BUBBLE_OUT = 272;

  function geo(state, o) {
    var g = typeof state === "string" ? Object.assign({}, GEO[state] || GEO.idle) : Object.assign({}, GEO.idle, state);
    if (state === "expanded" && o && o.h) g.h = o.h;
    if (g.rad == null) g.rad = Math.min(44, g.h / 2);
    return g;
  }
  function vars(g) { return { "--l": g.l, "--w": g.w, "--h": g.h, "--rad": g.rad }; }
  function name(state) { return typeof state === "string" ? state : state.name || "custom"; }
  function parts(di) {
    return {
      shape: di.querySelector(".rc-di-shape"), body: di.querySelector(".rc-di-body"), bubble: di.querySelector(".rc-di-bubble"),
      slots: RC.q(di.querySelectorAll("[data-di]")),
    };
  }
  function shows(el, state) { return (el.getAttribute("data-di") || "").split(/\s+/).indexOf(state) >= 0; }

  /** The goo: blur the black shapes together and threshold the alpha, so the bubble necks and splits off like liquid. */
  function goo(di) {
    if (di.__rcGoo) return di.__rcGoo;
    var pt = parseFloat(getComputedStyle(di).getPropertyValue("--pt")) || 1.5;
    var id = "rc-di-goo-" + (++uid);
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "0"); svg.setAttribute("height", "0"); svg.style.position = "absolute";
    svg.innerHTML = '<filter id="' + id + '" x="-20%" y="-50%" width="140%" height="200%" color-interpolation-filters="sRGB">' +
      '<feGaussianBlur in="SourceGraphic" stdDeviation="' + (5 * pt).toFixed(2) + '"/>' +
      '<feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10"/></filter>';
    di.appendChild(svg);
    di.style.setProperty("--goo", "url(#" + id + ")");
    return (di.__rcGoo = id);
  }

  function islandSet(target, state, o) {
    RC.q(target).forEach(function (di) {
      var p = parts(di), g = geo(state, o), s = name(state);
      gsap.set(di, vars(g));
      if (p.bubble) { gsap.set(di, { "--bl": s === "minimal" ? BUBBLE_OUT : BUBBLE_IN }); gsap.set(p.bubble, { opacity: s === "minimal" ? 1 : 0 }); }
      p.slots.forEach(function (el) { gsap.set(el, { opacity: shows(el, s) ? 1 : 0, scale: 1, filter: "blur(0px)" }); });
      di.__rcState = s;
    });
  }

  function island(tl, target, at, state, o) {
    o = o || {};
    RC.q(target).forEach(function (di) {
      var p = parts(di), g = geo(state, o), s = name(state), from = di.__rcState || "idle";
      var grows = g.w * g.h >= (geo(from, o).w * geo(from, o).h);
      var shapeAt = grows ? at : at + 0.05;
      var spr = RC.spring(o.spring || "island", di);
      RC.emit("island", at);

      // Content that is leaving goes first, quickly, accelerating away.
      p.slots.forEach(function (el) {
        if (shows(el, from) && !shows(el, s)) tl.to(el, { opacity: 0, scale: 0.92, filter: "blur(4px)", duration: 0.15, ease: RC.ease("apple.exit") }, at);
      });

      // The black shape, on the island's spring.
      tl.to(di, Object.assign({ duration: o.duration || spr.duration, ease: spr.ease }, vars(g)), shapeAt);

      // The bubble: out to the right for minimal, back under the island when leaving it, through the goo.
      if (p.bubble && (s === "minimal") !== (from === "minimal")) {
        goo(di);
        var out = s === "minimal";
        tl.set(di, { attr: { "data-goo": "1" } }, shapeAt);
        if (out) tl.set(p.bubble, { opacity: 1 }, shapeAt);
        tl.to(di, { "--bl": out ? BUBBLE_OUT : BUBBLE_IN, duration: spr.duration * 1.15, ease: spr.ease }, shapeAt + (out ? 0.06 : 0));
        if (!out) tl.set(p.bubble, { opacity: 0 }, shapeAt + spr.duration * 1.15);
        // The detached circle sits over the cellular bars, which the system hides while it is there.
        var scr = di.closest(".rc-scr");
        if (scr) tl.set(scr, { "--sig": out ? "transparent" : "currentColor" }, shapeAt + (out ? 0 : spr.duration * 0.9));
        tl.set(di, { attr: { "data-goo": "0" } }, shapeAt + spr.duration * 1.2);
      }

      // The status bar's clock and indicators give way when the island grows over them, and come back when it shrinks.
      var scrn = di.closest(".rc-scr"), st = scrn && scrn.querySelector(".rc-status");
      if (st) {
        var clock = st.querySelector(":scope > b"), sys = st.querySelector(":scope > .rc-sys");
        if (clock) tl.to(clock, { opacity: g.l < 60 ? 0 : 1, duration: 0.15, ease: RC.ease(g.l < 60 ? "apple.exit" : "apple.out") }, g.l < 60 ? at : shapeAt + 0.15);
        if (sys) tl.to(sys, { opacity: g.l + g.w > 350 ? 0 : 1, duration: 0.15, ease: RC.ease(g.l + g.w > 350 ? "apple.exit" : "apple.out") }, g.l + g.w > 350 ? at : shapeAt + 0.15);
      }

      // Content for the new state is poured in once the shape has mostly arrived.
      var inAt = shapeAt + (o.contentDelay == null ? (grows ? 0.12 : 0.14) : o.contentDelay);
      p.slots.forEach(function (el) {
        if (!shows(el, s) || shows(el, from)) return;
        tl.set(el, { scale: 0.88, filter: "blur(6px)" }, inAt);
        tl.to(el, { opacity: 1, duration: 0.2, ease: RC.ease("apple.out") }, inAt);
        tl.to(el, { scale: 1, duration: RC.spring("default", el).duration, ease: RC.ease("default", el) }, inAt);
        tl.to(el, { filter: "blur(0px)", duration: 0.3, ease: RC.ease("apple.out") }, inAt);
      });
      di.__rcState = s;
    });
    return tl;
  }

  /** A seeded, smooth level for bar i at time t: a sum of slow sines with random phases, 0.25..1. */
  function level(seed, i, t) {
    var r = RC.rand(seed * 97 + i * 13 + 1), a = r() * 6.28, b = r() * 6.28, f1 = 2.2 + r() * 2.4, f2 = 5 + r() * 3.5;
    var v = 0.5 + 0.32 * Math.sin(t * f1 + a) + 0.18 * Math.sin(t * f2 + b);
    return 0.25 + 0.75 * Math.max(0, Math.min(1, v));
  }
  function islandWave(tl, target, at, seconds, o) {
    o = o || {};
    RC.q(target).forEach(function (wave) {
      var bars = RC.q(wave.children), st = { t: 0 }, seed = o.seed || 7;
      var paint = function () { bars.forEach(function (b, i) { b.style.transform = "scaleY(" + level(seed, i, st.t).toFixed(3) + ")"; }); };
      st.t = 0; paint();
      tl.fromTo(st, { t: 0 }, { t: seconds, duration: seconds, ease: "none", onUpdate: paint, immediateRender: false }, at);
    });
    return tl;
  }

  /**
   * Numeric content transition. `values` are the strings shown in turn ("5:00", "4:59", …), `each` seconds apart,
   * the first at `at`. Only characters that change move: the old one leaves, the new one arrives on a spring.
   * Falling numbers roll down (the new digit comes from above), rising ones roll up. `dir` forces "up" or "down".
   */
  function numeric(tl, target, at, o) {
    var el = RC.one(target); if (!el || !o || !o.values || !o.values.length) return tl;
    var values = o.values.map(String), n = Math.max.apply(null, values.map(function (v) { return v.length; }));
    var pad = function (v) { return new Array(n - v.length + 1).join(" ") + v; };
    var num = function (v) { return parseFloat(v.replace(/[^\d.-]/g, "")) || 0; };
    var each = o.each || 1;
    el.classList.add("rc-numeric"); el.textContent = "";
    // Each character's own width, in this element's font, so a column is exactly as wide as what it shows and
    // glides to the next character's width on the same spring (a 1 is narrower than a 4 in most faces).
    var probe = document.createElement("span"); probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
    el.appendChild(probe);
    // Layout widths, unscaled: a box of 100 layout px tells how much any transform above us is scaling the screen.
    var ruler = document.createElement("span"); ruler.style.cssText = "position:absolute;visibility:hidden;width:100px;height:1px";
    el.appendChild(ruler);
    var scale = ruler.getBoundingClientRect().width / 100 || 1;
    el.removeChild(ruler);
    var widths = {};
    var wOf = function (c) { if (widths[c] == null) { probe.textContent = c === " " ? "" : c; widths[c] = probe.getBoundingClientRect().width / scale; } return widths[c]; };
    values.forEach(function (v) { Array.prototype.forEach.call(pad(v), wOf); });
    el.removeChild(probe);
    var mk = function (c) { var b = document.createElement("b"); b.textContent = c === " " ? "" : c; return b; };
    var cols = [], cur = [];
    var first = pad(values[0]);
    for (var i = 0; i < n; i++) {
      var col = document.createElement("span"), b = mk(first[i]);
      col.style.width = wOf(first[i]) + "px";
      col.appendChild(document.createTextNode("\u200b"));   // gives the column a baseline and a line's height
      col.appendChild(b); el.appendChild(col); cols.push(col); cur.push(b);
    }
    for (var k = 1; k < values.length; k++) {
      var prev = pad(values[k - 1]), next = pad(values[k]), t = at + (k - 1) * each + (o.offset || 0);
      var down = o.dir ? o.dir === "down" : num(values[k]) < num(values[k - 1]);
      var changed = 0;
      for (var j = n - 1; j >= 0; j--) {
        if (prev[j] === next[j]) continue;
        var nb = mk(next[j]);
        nb.style.opacity = "0";
        cols[j].appendChild(nb);
        // Digits settle right to left, 20 ms apart, as SwiftUI staggers them.
        var tj = t + changed * 0.02; changed++;
        var s = RC.spring("default", el);
        tl.to(cur[j], { yPercent: down ? 70 : -70, opacity: 0, filter: "blur(3px)", duration: 0.2, ease: RC.ease("apple.exit") }, tj);
        tl.fromTo(nb, { yPercent: down ? -70 : 70, opacity: 0 }, { yPercent: 0, opacity: 1, duration: s.duration, ease: s.ease, immediateRender: false }, tj);
        tl.fromTo(nb, { filter: "blur(3px)" }, { filter: "blur(0px)", duration: 0.25, ease: RC.ease("apple.out"), immediateRender: false }, tj);
        if (wOf(prev[j]) !== wOf(next[j])) tl.to(cols[j], { width: wOf(next[j]), duration: s.duration, ease: s.ease }, tj);
        cur[j] = nb;
      }
      if (changed) RC.emit("tick", t);
    }
    return tl;
  }

  Object.assign(window.RC, {
    island: island, islandSet: islandSet, islandWave: islandWave, numeric: numeric,
  });
})();
