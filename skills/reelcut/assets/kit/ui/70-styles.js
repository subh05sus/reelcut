/*
 * The twenty personality styles: their world, their finish, their motion, their cadence. With data-style on the root:
 *
 *   RC.styleWorld(root, o)           the style's decorations and the filters its shapes use (call once, after layout);
 *                                    o.grid / o.hairlines / o.letterbox / o.sun / o.floor / o.osd / o.slices: false turns one off
 *   RC.styleFinish(root, o)          the textures on top (paper, grain, halftone, leaks, vignette, scanlines); o.texture overrides
 *   RC.styleWords(tl, el, at, o)     the headline's entrance in the style (slam, bounce, glitch, resolve)
 *   RC.styleEnter(tl, els, at, o)    objects arrive in the style (slide, bounce and squash, draw, stamp, rise, float, glitch)
 *   RC.styleGlitch(tl, root, at)     a burst: slices flash and the headline jumps (Glitch, Retro / VHS)
 *   RC.cadence(tl, root)             register what it returns as the beat's timeline. Smooth styles return tl as it is; Claymation, Paper Cutout, Hand-Drawn and Collage
 *                                    advance on held frames at 12 a second, Stop Motion at 8 with a seeded jitter per frame
 *
 * The numbers mirror src/personality/styles.ts (a test keeps them in step).
 */
(function () {
  var RC = window.RC, gsap = window.gsap;
  if (!RC || RC.styleWorld) return;

  var T = function (o) { return Object.assign({ grain: 0, paper: 0, halftone: 0, leaks: 0, vignette: 0, glow: 0, chroma: 0, scanlines: 0 }, o); };
  var STYLE = {
    "paper-cutout": { verb: "slide", fps: 12, texture: T({ paper: 0.6, grain: 0.25, vignette: 0.15 }) },
    claymation: { verb: "bounce", fps: 12, texture: T({ grain: 0.35, vignette: 0.2 }) },
    "stop-motion": { verb: "slide", fps: 8, jitter: true, texture: T({ grain: 0.4, vignette: 0.25, leaks: 0.1 }) },
    "hand-drawn": { verb: "draw", fps: 12, texture: T({ paper: 0.45, grain: 0.2 }) },
    "flat-vector": { verb: "slide", fps: 0, texture: T({}) },
    linear: { verb: "draw", fps: 0, world: { hairlines: true }, texture: T({ grain: 0.1, glow: 0.15 }) },
    "kinetic-type": { verb: "slam", fps: 0, texture: T({ grain: 0.15 }) },
    editorial: { verb: "rise", fps: 0, texture: T({ paper: 0.25, grain: 0.15 }) },
    collage: { verb: "slam", fps: 12, texture: T({ paper: 0.5, halftone: 0.5, grain: 0.3 }) },
    brutalist: { verb: "slam", fps: 0, texture: T({}) },
    swiss: { verb: "rise", fps: 0, world: { grid: true }, texture: T({ grain: 0.08 }) },
    minimal: { verb: "rise", fps: 0, texture: T({ grain: 0.06 }) },
    "3d": { verb: "float", fps: 0, texture: T({ grain: 0.1, glow: 0.3, vignette: 0.2 }) },
    isometric: { verb: "float", fps: 0, texture: T({ grain: 0.08 }) },
    liquid: { verb: "float", fps: 0, texture: T({ grain: 0.12, glow: 0.4 }) },
    "ink-paint": { verb: "draw", fps: 0, texture: T({ paper: 0.6, grain: 0.2 }) },
    "ui-product": { verb: "rise", fps: 0, texture: T({ grain: 0.05 }) },
    "retro-vhs": { verb: "glitch", fps: 0, world: { sun: true, floor: true, osd: true }, texture: T({ scanlines: 0.6, chroma: 0.45, grain: 0.35, vignette: 0.35, glow: 0.3 }) },
    glitch: { verb: "glitch", fps: 0, world: { slices: true }, texture: T({ chroma: 0.7, scanlines: 0.3, grain: 0.3, glow: 0.2 }) },
    cinematic: { verb: "rise", fps: 0, world: { letterbox: true }, texture: T({ grain: 0.5, leaks: 0.35, vignette: 0.45 }) },
  };
  function rootOf(el) { var e = RC.one(el); return (e && e.closest && e.closest("[data-style]")) || document.querySelector("[data-look][data-style]"); }
  function spec(el) { var r = rootOf(el); return (r && STYLE[r.getAttribute("data-style")]) || { verb: "rise", fps: 0, texture: T({}) }; }

  var NOISE = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' seed='4'/%3E%3CfeColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 1 0'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)'/%3E%3C/svg%3E\")";

  function layer(root, cls, css) { var d = document.createElement("div"); d.className = cls; if (css) d.style.cssText = css; root.appendChild(d); return d; }

  function styleWorld(target, o) {
    o = o || {};
    var root = RC.one(target) || rootOf(); if (!root || root.__rcWorld) return root;
    root.__rcWorld = true;
    var id = root.getAttribute("data-style"), w = Object.assign({}, (STYLE[id] || {}).world || {}, o);
    // The filters the materials use: a pen's wobble, a brush's rough edge, liquid's goo.
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "0"); svg.setAttribute("height", "0"); svg.style.position = "absolute";
    svg.innerHTML = '<filter id="rc-wobble"><feTurbulence type="fractalNoise" baseFrequency=".03" numOctaves="2" seed="5"/><feDisplacementMap in="SourceGraphic" scale="7"/></filter>' +
      '<filter id="rc-rough"><feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="3" seed="9"/><feDisplacementMap in="SourceGraphic" scale="16"/></filter>' +
      '<filter id="rc-goo"><feGaussianBlur in="SourceGraphic" stdDeviation="14"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 26 -11"/></filter>';
    root.appendChild(svg);
    var world = document.createElement("div"); world.className = "rc-world";
    root.insertBefore(world, root.firstChild);
    var W = root.offsetWidth || 1080, H = root.offsetHeight || 1080;
    if (w.grid) { var g = layer(world, "rc-w-grid"); for (var i = 1; i < 12; i++) { var x = document.createElement("i"); x.style.left = (84 + i * (W - 168) / 12) + "px"; g.appendChild(x); } }
    if (w.hairlines) { var h = layer(world, "rc-w-hair"); for (var j = 1; j < 9; j++) { var y = document.createElement("i"); y.style.top = (j * H / 9) + "px"; h.appendChild(y); } }
    if (w.sun) layer(world, "rc-w-sun");
    if (w.floor) layer(world, "rc-w-floor");
    if (w.letterbox) { var b = layer(root, "rc-w-bars"); b.innerHTML = "<i></i><i></i>"; }
    if (w.osd) { var d = layer(root, "rc-w-osd"); d.textContent = typeof w.osd === "string" ? w.osd : "PLAY ▶"; }
    if (w.slices) { var sl = layer(root, "rc-w-slices"); sl.innerHTML = "<i></i><i></i><i></i>"; }
    return root;
  }

  function styleFinish(target, o) {
    o = o || {};
    var root = RC.one(target) || rootOf(); if (!root || root.__rcFinish) return root;
    root.__rcFinish = true;
    var t = Object.assign({}, spec(root).texture, o.texture || {});
    if (t.paper > 0) layer(root, "rc-tx", "opacity:" + (t.paper * 0.35).toFixed(2) + ";mix-blend-mode:multiply;background-image:" + NOISE);
    if (t.grain > 0) layer(root, "rc-tx", "opacity:" + (t.grain * 0.4).toFixed(2) + ";mix-blend-mode:overlay;background-image:" + NOISE);
    if (t.halftone > 0) layer(root, "rc-tx", "opacity:" + (t.halftone * 0.25).toFixed(2) + ";mix-blend-mode:multiply;background:radial-gradient(circle, rgba(0,0,0,.6) 1.4px, transparent 1.6px) 0 0/9px 9px");
    if (t.leaks > 0) layer(root, "rc-tx", "opacity:" + (t.leaks * 0.9).toFixed(2) + ";mix-blend-mode:screen;background:radial-gradient(40% 50% at 92% 10%, rgba(255,150,60,.55), transparent 70%), radial-gradient(30% 40% at 5% 95%, rgba(255,60,90,.35), transparent 70%)");
    if (t.vignette > 0) layer(root, "rc-tx", "background:radial-gradient(75% 75% at 50% 50%, transparent 55%, rgba(0,0,0," + (t.vignette * 0.75).toFixed(2) + "))");
    if (t.scanlines > 0) layer(root, "rc-tx", "opacity:" + (t.scanlines * 0.55).toFixed(2) + ";background:repeating-linear-gradient(transparent 0 3px, rgba(0,0,0,.45) 3px 5px)");
    return root;
  }

  function styleWords(tl, target, at, o) {
    o = o || {};
    var el = RC.one(target); if (!el) return tl;
    var v = o.verb || spec(el).verb;
    if (v === "slam") {
      RC.split(el, "words").forEach(function (w, i) {
        tl.fromTo(w, { scale: i ? 1.7 : 1.25, opacity: i ? 0 : 0.6 }, { scale: 1, opacity: 1, duration: 0.32, ease: RC.ease("snappy", w) }, at + i * (o.stagger || 0.16));
        RC.emit("pop", at + i * (o.stagger || 0.16));
      });
    } else if (v === "bounce") {
      RC.split(el, "words").forEach(function (w, i) {
        tl.fromTo(w, { y: i ? -160 : -40, opacity: i ? 0 : 0.6 }, { y: 0, opacity: 1, duration: 0.6, ease: RC.ease("reward", w) }, at + i * (o.stagger || 0.12));
      });
    } else if (v === "glitch") {
      RC.words(tl, el, at, { lead: true, stagger: 0.07, blur: 6 });
      tl.to(el, { keyframes: [6, -10, 4, -3, 0].map(function (x) { return { x: x, duration: 0.06, ease: "none" }; }) }, at + 0.25);
    } else {
      RC.words(tl, el, at, { lead: o.lead !== false, stagger: o.stagger || (v === "rise" ? 0.08 : 0.06) });
    }
    return tl;
  }

  /** The way Hand-Drawn, Linear and Ink / Paint objects arrive: the outline (or the brush) traces itself in. */
  function traceIn(tl, el, at, d) {
    tl.fromTo(el, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: d, ease: RC.ease("apple.glide"), immediateRender: true }, at);
  }

  function styleEnter(tl, targets, at, o) {
    o = o || {};
    var els = RC.q(targets); if (!els.length) return tl;
    var v = o.verb || spec(els[0]).verb, gap = o.stagger == null ? 0.16 : o.stagger;
    els.forEach(function (el, i) {
      var t = at + i * gap;
      if (v === "bounce") {
        tl.fromTo(el, { y: -700 }, { y: 0, duration: 0.55, ease: RC.ease("apple.exit"), immediateRender: true }, t);
        tl.to(el, { keyframes: [{ scaleX: 1.18, scaleY: 0.8, duration: 0.1 }, { scaleX: 0.94, scaleY: 1.07, duration: 0.14 }, { scaleX: 1, scaleY: 1, duration: 0.2 }], transformOrigin: "50% 100%" }, t + 0.55);
        RC.emit("pop", t + 0.55);
      } else if (v === "slam") {
        var r = [-14, 10, -6][i % 3];
        tl.fromTo(el, { scale: 1.5, opacity: 0, rotation: r }, { scale: 1, opacity: 1, rotation: r * 0.3, duration: 0.3, ease: RC.ease("snappy", el) }, t);
        RC.emit("pop", t);
      } else if (v === "slide") {
        var dx = [520, 600, -700][i % 3];
        tl.fromTo(el, { x: dx, rotation: [-10, 22, -6][i % 3] }, { x: 0, rotation: 0, duration: 0.8, ease: RC.ease("default", el) }, t);
      } else if (v === "draw") {
        traceIn(tl, el, t, o.duration || 0.8);
      } else if (v === "float") {
        RC.flyIn(tl, el, t, { stagger: 0 });
        if (o.drift !== false) tl.to(el, { y: [-18, 14, -10][i % 3], duration: 2.6, ease: "sine.inOut" }, t + 0.9);
      } else if (v === "glitch") {
        tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.01 }, t);
        tl.to(el, { keyframes: [14, -9, 5, 0].map(function (x) { return { x: x, duration: 0.05, ease: "none" }; }) }, t);
      } else {
        RC.rise(tl, el, t, { y: 30 });
      }
    });
    return tl;
  }

  function styleGlitch(tl, target, at) {
    var root = RC.one(target) || rootOf(); if (!root) return tl;
    var hl = root.querySelector(".rc-hl");
    if (hl) tl.to(hl, { keyframes: [-8, 5, 0].map(function (x) { return { x: x, duration: 0.05, ease: "none" }; }) }, at);
    RC.q(root.querySelectorAll(".rc-w-slices i")).forEach(function (s, i) {
      var y = (root.offsetHeight || 1080) * (0.24 + i * 0.2);
      tl.set(s, { y: y, opacity: 0.9 }, at + i * 0.04); tl.set(s, { opacity: 0 }, at + 0.08 + i * 0.04);
    });
    RC.emit("glitch", at);
    return tl;
  }

  /** Register what this returns. Smooth styles: the timeline itself. Stepped styles: a timeline that advances it on held frames. */
  function cadence(tl, target, o) {
    o = o || {};
    var root = RC.one(target) || rootOf(), s = spec(root);
    var fps = o.fps != null ? o.fps : s.fps;
    if (!fps) return tl;
    var D = tl.duration(), outer = gsap.timeline({ paused: true }), st = { t: 0 };
    var rnd = RC.rand(o.seed || 7), jitter = o.jitter != null ? o.jitter : !!s.jitter;
    var jit = []; for (var i = 0; i < Math.ceil(D * fps) + 2; i++) jit.push([rnd() * 3 - 1.5, rnd() * 3 - 1.5]);
    var cam = root && (root.querySelector(o.camera || ".cam") || root.firstElementChild);
    var paint = function () {
      var k = Math.floor(st.t * fps + 1e-6);
      tl.seek(k / fps, false);
      if (jitter && cam) cam.style.translate = jit[k][0].toFixed(2) + "px " + jit[k][1].toFixed(2) + "px";
    };
    paint();
    outer.fromTo(st, { t: 0 }, { t: D, duration: D, ease: "none", onUpdate: paint, immediateRender: false }, 0);
    return outer;
  }

  Object.assign(window.RC, {
    styleWorld: styleWorld, styleFinish: styleFinish, styleWords: styleWords, styleEnter: styleEnter, styleGlitch: styleGlitch, cadence: cadence, STYLES_KIT: STYLE,
  });
})();
