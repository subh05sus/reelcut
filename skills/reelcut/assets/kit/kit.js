/*
 * reelcut kit — motion helpers. Injected with kit.css into any composition whose root has `data-look`.
 *
 * Every helper takes the beat's paused timeline and an absolute time, adds tweens, and returns the
 * timeline, so a beat reads as a score:
 *
 *   RC.words(tl, "#root .h", 0.1, { lead: true });
 *   RC.type(tl, "#root .prompt .rc-text", 0.9, { text: "Buy four bottles of wine" });
 *   RC.click(tl, "#root .rc-cursor", 2.4, { target: "#root .rc-send" });
 *
 * Determinism is the contract: no clocks, no Math.random, no infinite repeats. Anything that looks
 * random is seeded (`RC.rand(seed)`). Every frame is a pure function of time, so HyperFrames can
 * seek to any frame in any order.
 *
 * Selectors are passed through untouched, never built here, so however the runtime scopes `#root`
 * inside a composition's own script, the strings arriving here are already scoped.
 */
(function () {
  if (window.RC) return;
  var gsap = window.gsap;
  var uid = 0;
  /**
   * What the beat does that a sound could go with, recorded as the helpers schedule it: a click, a typing
   * run, a number counting, a reveal. Nothing reads the clock, so it is the same list on every load.
   * `npm run sfx -- suggest` reads it to propose cues from the sound library.
   */
  var events = (window.__rcEvents = window.__rcEvents || []);
  function emit(type, at, extra) {
    var e = { type: type, at: Math.round(at * 1000) / 1000 };
    if (extra) for (var k in extra) e[k] = extra[k];
    events.push(e);
  }
  var NS = "http://www.w3.org/2000/svg";

  function q(t) {
    if (!t) return [];
    if (typeof t === "string") return Array.prototype.slice.call(document.querySelectorAll(t));
    if (t.length !== undefined && !t.nodeType) return Array.prototype.slice.call(t);
    return [t];
  }
  function one(t) { return q(t)[0]; }
  function lookRoot(el) { return (el && el.closest && el.closest("[data-look]")) || document.body; }

  /** Seeded PRNG (mulberry32). Same seed, same sequence, every render. */
  function rand(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /*
   * Motion: Apple's springs, computed.
   *
   * What makes Apple's motion read as calm is the curve, not the duration. A spring released from rest
   * starts gently (zero velocity, finite acceleration), reaches its speed in the first tenth, then settles
   * on a long, even deceleration and never bounces. `expo.out` starts at full speed (a jolt on frame one),
   * `expo.inOut` crawls, rushes and crawls, and `back.out` bounces. So the kit solves the real damped
   * spring, x'' = -k(x - 1) - c x', analytically and registers each as a GSAP ease. It is a pure
   * function of progress: no clocks, the same on every seek.
   *
   *   ease: "spring.snappy"   presses, toggles, small state changes   (520 / 40, ~0.35 s to rest)
   *   ease: "spring.default"  panels, sheets, cards, a thumb sliding   (380 / 38)
   *   ease: "spring.page"     a full-screen push, a big move           (300 / 34)
   *   ease: "spring.gentle"   words and objects entering a film frame  (200 / 28)
   *   ease: "spring.soft"     large or far things, arrivals from depth (120 / 22)
   *   ease: "spring.reward"   the one earned moment: a visible overshoot (320 / 22, ζ≈.6)
   *   ease: "spring.island"   the Dynamic Island growing and shrinking (230 / 24, a 1.7% overshoot)
   *   ease: "apple.out"       cubic-bezier(.2, 0, 0, 1): fades and colour paired with a spring
   *   ease: "apple.push"      cubic-bezier(.32, .72, 0, 1): the iOS push and pop
   *   ease: "apple.exit"      cubic-bezier(.4, 0, 1, 1): leaving, faster than arriving
   *   ease: "apple.glide"     minimum-jerk: a hand moving a cursor, a pen drawing, a playhead
   *
   * Give a tween its spring's own length with RC.spring("default").duration, or any duration: a spring
   * stretched in time is a softer spring of the same damping, so the feel holds. `data-motion` on the
   * root ("restrained" | "default" | "energetic") retunes every helper's springs: restrained is slower
   * and fully damped, energetic is quicker and lets presses and pops overshoot a little.
   */
  var SPRINGS = {
    snappy: [520, 40], default: [380, 38], page: [300, 34], gentle: [200, 28], soft: [120, 22], reward: [320, 22],
    // The Dynamic Island's morph: the one shape Apple lets overshoot a touch (ζ≈.79, ~1.7%), so it reads as liquid.
    island: [230, 24],
  };
  /** How each energy retunes a spring: stiffness × k, and the damping ratio it is held to (null = as given). */
  var ENERGY = { restrained: { k: 0.55, zeta: 1 }, default: { k: 1, zeta: null }, energetic: { k: 1.7, zeta: 0.78 } };
  var springCache = {};
  /** The unit step response of a damped spring from rest, and the time it takes to stay within `eps` of 1. */
  function solveSpring(k, c, m) {
    m = m || 1;
    var w0 = Math.sqrt(k / m), z = c / (2 * Math.sqrt(k * m)), x;
    if (z < 0.999) {
      var wd = w0 * Math.sqrt(1 - z * z);
      x = function (t) { return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t)); };
    } else if (z <= 1.001) {
      x = function (t) { return 1 - Math.exp(-w0 * t) * (1 + w0 * t); };
    } else {
      var s = Math.sqrt(z * z - 1), r1 = -w0 * (z - s), r2 = -w0 * (z + s);
      x = function (t) { return 1 + (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r1 - r2); };
    }
    // At rest when it stays within 0.1% of the travel: under a pixel on a 600px move.
    var T = 0.05;
    for (var t = 0; t < 6; t += 0.002) if (Math.abs(1 - x(t)) > 0.001) T = t + 0.002;
    var end = x(T);
    // Normalised so progress 1 lands exactly on 1, whatever the last 0.1% was doing.
    var ease = function (p) { return p <= 0 ? 0 : p >= 1 ? 1 : x(p * T) + (1 - end) * p; };
    return { ease: ease, duration: Math.round(T * 1000) / 1000, zeta: z, stiffness: k, damping: c };
  }
  function energyOf(el) {
    var r = el && el.closest ? el.closest("[data-motion]") : (document.querySelector ? document.querySelector("[data-look][data-motion]") : null);
    var e = r && r.getAttribute("data-motion");
    return ENERGY[e] ? e : "default";
  }
  /**
   * RC.spring("default") → { ease, duration } for that preset under the beat's motion energy;
   * RC.spring({ stiffness, damping, mass }) for one of your own. `el` picks the root whose data-motion applies.
   */
  function spring(name, el) {
    var energy = typeof el === "string" ? el : energyOf(one(el));
    if (name && typeof name === "object") {
      var key0 = [name.stiffness, name.damping, name.mass || 1].join("/");
      return springCache[key0] || (springCache[key0] = solveSpring(name.stiffness, name.damping, name.mass));
    }
    var preset = SPRINGS[name] ? name : "default", key = preset + ":" + energy;
    if (springCache[key]) return springCache[key];
    var kc = SPRINGS[preset], en = ENERGY[energy], k = kc[0] * en.k;
    var zeta = kc[1] / (2 * Math.sqrt(kc[0]));                     // the preset's own damping ratio
    if (preset === "reward") zeta = energy === "restrained" ? 0.8 : zeta;   // the earned moment keeps its overshoot
    else if (preset === "island") zeta = energy === "restrained" ? 0.9 : zeta; // so does the island's liquid morph
    else if (en.zeta != null) zeta = preset === "soft" || preset === "gentle" ? Math.max(en.zeta, 0.95) : en.zeta;
    return (springCache[key] = solveSpring(k, zeta * 2 * Math.sqrt(k)));
  }
  /** cubic-bezier(x1, y1, x2, y2) as an ease, solved by Newton's method then bisection, as CSS does. */
  function bezier(x1, y1, x2, y2) {
    function a(p1, p2) { return 1 - 3 * p2 + 3 * p1; }
    function b(p1, p2) { return 3 * p2 - 6 * p1; }
    function c(p1) { return 3 * p1; }
    function at(t, p1, p2) { return ((a(p1, p2) * t + b(p1, p2)) * t + c(p1)) * t; }
    function slope(t, p1, p2) { return 3 * a(p1, p2) * t * t + 2 * b(p1, p2) * t + c(p1); }
    return function (p) {
      if (p <= 0) return 0; if (p >= 1) return 1;
      var t = p;
      for (var i = 0; i < 8; i++) { var s = slope(t, x1, x2); if (Math.abs(s) < 1e-6) break; var d = at(t, x1, x2) - p; if (Math.abs(d) < 1e-7) return at(t, y1, y2); t -= d / s; }
      var lo = 0, hi = 1; t = p;
      for (var j = 0; j < 30; j++) { var v = at(t, x1, x2); if (Math.abs(v - p) < 1e-7) break; if (v < p) lo = t; else hi = t; t = (lo + hi) / 2; }
      return at(t, y1, y2);
    };
  }
  var EASES = {
    "apple.out": bezier(0.2, 0, 0, 1),
    "apple.push": bezier(0.32, 0.72, 0, 1),
    "apple.exit": bezier(0.4, 0, 1, 1),
    // Minimum jerk (10p³ − 15p⁴ + 6p⁵): how a hand moves from one point to another.
    "apple.glide": function (p) { return p <= 0 ? 0 : p >= 1 ? 1 : p * p * p * (10 + p * (-15 + 6 * p)); },
  };
  /** The ease a helper uses: a preset name ("default") or any GSAP ease string, under this element's motion energy. */
  function E(name, el) {
    if (typeof name === "function") return name;
    if (SPRINGS[name]) return spring(name, el).ease;
    var m = /^spring\.(\w+)$/.exec(name || "");
    if (m && SPRINGS[m[1]] && el) return spring(m[1], el).ease;
    return name;
  }
  /** A preset's natural length under this element's energy, or `given` when the beat asked for one. */
  function D(name, el, given) { return given != null ? given : spring(name, el).duration; }
  /** True when an ease can overshoot 1: blur and other filters must never ride on one. */
  function overshoots(ease, el) {
    if (typeof ease === "function") return true;              // unknown: assume it might
    if (typeof ease !== "string") return false;
    if (/back|elastic/.test(ease)) return true;
    var m = /^(?:spring\.)?(\w+)$/.exec(ease);
    return !!(m && SPRINGS[m[1]] && spring(m[1], el).zeta < 0.999);
  }
  // A beat's own tweens name these too ("spring.gentle"), so the registered ease follows the beat's
  // data-motion. It is read on the first frame (the root does not exist yet when the kit loads), once.
  var docEnergy = null;
  function registered(n) {
    return function (p) {
      if (!docEnergy) docEnergy = energyOf(null);
      return spring(n, docEnergy).ease(p);
    };
  }
  if (gsap && gsap.registerEase) {
    Object.keys(SPRINGS).forEach(function (n) { gsap.registerEase("spring." + n, registered(n)); });
    Object.keys(EASES).forEach(function (n) { gsap.registerEase(n, EASES[n]); });
    // A tween that names no ease gets Apple's CSS curve rather than GSAP's power1.out, which starts at speed.
    if (gsap.defaults) gsap.defaults({ ease: "apple.out" });
  }

  /**
   * Split text into spans, keeping nested markup (an <em>, a .rc-accent) intact.
   * by: "words" -> .rc-w, "chars" -> .rc-c (grouped inside word spans so lines never break mid-word).
   * Idempotent: an element split once is not split again.
   */
  function split(target, by) {
    by = by || "words";
    var out = [];
    q(target).forEach(function (el) {
      if (el.__rcSplit === by) { out.push.apply(out, q(el.querySelectorAll(by === "chars" ? ".rc-c" : ".rc-w"))); return; }
      el.__rcSplit = by;
      walk(el);
    });
    function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (child) {
        if (child.nodeType === 3) {
          var parts = child.textContent.split(/(\s+)/);
          var frag = document.createDocumentFragment();
          parts.forEach(function (p) {
            if (!p) return;
            if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); return; }
            var w = document.createElement("span");
            w.className = "rc-w";
            if (by === "chars") {
              Array.prototype.forEach.call(p, function (ch) {
                var c = document.createElement("span"); c.className = "rc-c"; c.textContent = ch; w.appendChild(c); out.push(c);
              });
            } else { w.textContent = p; out.push(w); }
            frag.appendChild(w);
          });
          node.replaceChild(frag, child);
        } else if (child.nodeType === 1 && !/^(BR|SVG|IMG)$/i.test(child.tagName)) {
          // An element with no text is decoration riding on the line — an underline, a strike rule, a
          // marker. It is not a word: treated as one it would be blurred in with the text and then
          // drawn again by its own tween.
          if (!child.textContent.trim()) return;
          // A styled inline element whose text is one word stays one unit: the accent moves as a word.
          if (by === "words" && child.children.length === 0 && !/\s/.test(child.textContent.trim())) {
            child.classList.add("rc-w"); out.push(child);
          } else { walk(child); }
        }
      });
    }
    return out;
  }

  /** Make the timeline at least `seconds` long. Every beat ends with this. */
  function hold(tl, seconds) { tl.to({}, { duration: seconds }, 0); return tl; }

  /**
   * Blur-in: each unit arrives from soft focus and a small rise. The signature entrance of the
   * reference films — words resolve rather than slide.
   * lead: the first unit starts at opacity .55 and light blur, so frame 0 of a hard cut is legible.
   */
  function blurIn(tl, target, at, o) {
    o = o || {};
    var els = q(target); if (!els.length) return tl;
    var blur = o.blur == null ? 12 : o.blur, y = o.y == null ? 18 : o.y, x = o.x || 0;
    var dur = D("gentle", els[0], o.duration), stagger = o.stagger == null ? 0.06 : o.stagger, ease = E(o.ease || "gentle", els[0]);
    // Filter blur must never overshoot: an ease past 1 drives blur below zero, which is invalid CSS,
    // and the element flickers sharp-then-soft. Any overshooting ease goes to transform only.
    var blurEase = overshoots(o.ease, els[0]) ? E("gentle", els[0]) : ease;
    els.forEach(function (el, i) {
      var lead = o.lead && i === 0;
      var from = { opacity: lead ? 0.55 : 0, y: lead ? y * 0.4 : y, x: x };
      var to = { opacity: 1, y: 0, x: 0, duration: dur, ease: blurEase };
      // Only touch scale when asked: `scale` also sets scaleX, and would clobber a rule drawn with it.
      if (o.scale != null) { from.scale = o.scale; to.scale = 1; }
      tl.fromTo(el, from, to, at + i * stagger);
      tl.fromTo(el, { filter: "blur(" + (lead ? blur * 0.35 : blur) + "px)" }, { filter: "blur(0px)", duration: dur, ease: blurEase }, at + i * stagger);
    });
    return tl;
  }
  function blurOut(tl, target, at, o) {
    o = o || {};
    var els = q(target);
    // Leaving is quicker than arriving, and accelerates away: Apple's exit curve.
    tl.to(els, { opacity: 0, filter: "blur(" + (o.blur == null ? 10 : o.blur) + "px)", y: o.y == null ? -12 : o.y, duration: o.duration || 0.32,
      ease: E(o.ease || "apple.exit", els[0]), stagger: o.stagger == null ? 0.03 : o.stagger }, at);
    return tl;
  }
  function words(tl, target, at, o) { return blurIn(tl, split(target, "words"), at, o); }
  function chars(tl, target, at, o) {
    o = Object.assign({ stagger: 0.022, blur: 8, y: 14 }, o || {});
    return blurIn(tl, split(target, "chars"), at, o);
  }

  /** Line mask: each .rc-line > .rc-in rises out of its own clip. Editorial, heavy type. */
  function lines(tl, target, at, o) {
    o = o || {};
    var ins = [];
    q(target).forEach(function (el) { ins.push.apply(ins, q(el.querySelectorAll(".rc-line > .rc-in"))); });
    ins.forEach(function (el, i) {
      var lead = o.lead && i === 0;
      tl.fromTo(el, { yPercent: lead ? 40 : 108, opacity: lead ? 0.6 : 1 }, { yPercent: 0, opacity: 1, duration: D("gentle", el, o.duration), ease: E(o.ease || "gentle", el) },
        at + i * (o.stagger == null ? 0.09 : o.stagger));
    });
    return tl;
  }

  /** Rise: plain opacity + y, for UI objects rather than type. */
  function rise(tl, target, at, o) {
    o = o || {};
    q(target).forEach(function (el, i) {
      var lead = o.lead && i === 0;
      var y = o.y == null ? 32 : o.y;
      tl.fromTo(el, { opacity: lead ? 0.6 : 0, y: lead ? y * 0.3 : y, scale: o.scale || 1 },
        { opacity: 1, y: 0, scale: 1, duration: D("gentle", el, o.duration), ease: E(o.ease || "gentle", el) }, at + i * (o.stagger || 0.06));
    });
    return tl;
  }

  /** Arrive from depth: small, blurred, far — to sharp and present. Cards, tiles, photos. */
  function flyIn(tl, target, at, o) {
    o = o || {};
    q(target).forEach(function (el, i) {
      // From depth: a far, soft object settling on the long, even deceleration of a soft spring.
      var ease = E(o.ease || "soft", el), dur = D("soft", el, o.duration);
      tl.fromTo(el, { opacity: 0, scale: o.from == null ? 0.82 : o.from, y: o.y == null ? 48 : o.y, rotation: o.rotation || 0 },
        { opacity: 1, scale: 1, y: 0, rotation: 0, duration: dur, ease: ease }, at + i * (o.stagger == null ? 0.06 : o.stagger));
      tl.fromTo(el, { filter: "blur(" + (o.blur == null ? 16 : o.blur) + "px)" }, { filter: "blur(0px)", duration: dur, ease: overshoots(o.ease, el) ? E("soft", el) : ease }, at + i * (o.stagger == null ? 0.06 : o.stagger));
    });
    return tl;
  }

  /**
   * Pop: an icon, a badge, the send button appears. Apple grows it from 0.4 on a snappy spring, so it
   * lands without a wobble; `reward: true` gives the one earned moment of a reel its overshoot.
   */
  function pop(tl, target, at, o) {
    o = o || {};
    emit("pop", at);
    var els = q(target); if (!els.length) return tl;
    var name = o.reward ? "reward" : "snappy";
    tl.fromTo(els, { scale: o.from == null ? 0.4 : o.from }, { scale: 1, duration: D(name, els[0], o.duration), ease: E(o.ease || name, els[0]), stagger: o.stagger || 0.04 }, at);
    tl.fromTo(els, { opacity: 0 }, { opacity: 1, duration: 0.16, ease: E("apple.out"), stagger: o.stagger || 0.04 }, at);
    return tl;
  }

  /**
   * Type text into an element, with a caret that blinks while idle.
   * The element's text is replaced; put a .rc-caret after it (or pass caret: selector).
   */
  function type(tl, target, at, o) {
    o = o || {};
    var el = one(target); if (!el) return tl;
    var text = o.text != null ? o.text : el.textContent;
    var cps = o.cps || 24;
    var dur = o.duration || text.length / cps;
    emit("type", at, { duration: Math.round(dur * 1000) / 1000, text: text });
    var state = { n: 0 };
    el.textContent = o.keep ? text : "";
    tl.fromTo(state, { n: 0 }, { n: text.length, duration: dur, ease: o.ease || "none",
      onUpdate: function () { el.textContent = text.slice(0, Math.round(state.n)); } }, at);
    var caret = o.caret === false ? null : one(o.caret || el.parentNode.querySelector(".rc-caret"));
    if (caret) {
      // Solid while typing, blinking at 1Hz either side. Finite, computed, seekable.
      var blink = function (a, b) {
        for (var t = a; t + 0.5 < b; t += 1.0) { tl.set(caret, { opacity: 0 }, t + 0.5); tl.set(caret, { opacity: 1 }, Math.min(t + 1.0, b)); }
      };
      blink(o.blinkFrom == null ? Math.max(0, at - 2) : o.blinkFrom, at);
      tl.set(caret, { opacity: 1 }, at);
      blink(at + dur, o.blinkTo == null ? at + dur + 3 : o.blinkTo);
    }
    return tl;
  }

  /** Count a number up (or down), formatted, with tabular figures so nothing jitters. */
  function count(tl, target, at, o) {
    o = o || {};
    var el = one(target); if (!el) return tl;
    el.style.fontVariantNumeric = "tabular-nums";
    var from = o.from || 0, to = o.to == null ? Number(el.textContent.replace(/[^\d.-]/g, "")) : o.to;
    var dec = o.decimals || 0, pre = o.prefix || "", suf = o.suffix || "", loc = o.locale || "en-US";
    emit("count", at, { duration: o.duration || 1.4 });
    var st = { v: from };
    var fmt = function (v) { return pre + v.toLocaleString(loc, { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suf; };
    el.textContent = fmt(from);
    tl.fromTo(st, { v: from }, { v: to, duration: o.duration || 1.4, ease: E(o.ease || "soft", el), onUpdate: function () { el.textContent = fmt(st.v); } }, at);
    return tl;
  }

  /**
   * Roll: cycle an element through values like a slot reel. `values[0]` shows first.
   * Each change rolls the old value up and out and the new one up and in.
   */
  function roll(tl, target, at, o) {
    var el = one(target); if (!el) return tl;
    var values = o.values, each = o.each || 0.5, d = D("default", el, o.duration);
    el.style.display = "inline-grid"; el.style.overflow = "hidden"; el.style.verticalAlign = "bottom";
    el.textContent = "";
    var spans = values.map(function (v, i) {
      var s = document.createElement("span"); s.textContent = v; s.style.gridArea = "1 / 1"; s.style.whiteSpace = "nowrap";
      if (i > 0) { s.style.opacity = "0"; }
      el.appendChild(s); return s;
    });
    for (var i = 1; i < spans.length; i++) {
      var t = at + (i - 1) * each;
      emit("roll", t);
      // The outgoing value already has its own entrance tween; a second fromTo would stamp its
      // start state over frame 0. So it leaves with a plain to().
      // An odometer: the old value leaves up on the exit curve, the new one rises in on a spring.
      tl.to(spans[i - 1], { yPercent: -100, opacity: 0, filter: "blur(4px)", duration: d * 0.7, ease: E("apple.exit") }, t);
      tl.fromTo(spans[i], { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1, duration: d, ease: E("default", el) }, t);
      tl.fromTo(spans[i], { filter: "blur(4px)" }, { filter: "blur(0px)", duration: d, ease: E("apple.out") }, t);
    }
    return tl;
  }

  /**
   * Wheel: a vertical list of values with the current one sharp and its neighbours faded above and
   * below, turning one step per value — "Feel haptics with [Games / Music / Fitness]".
   * The element should sit inline in a line of type; the list overflows it visibly on purpose.
   */
  function wheel(tl, target, at, o) {
    var el = one(target); if (!el) return tl;
    var values = o.values, each = o.each || 0.6, d = D("page", el, o.duration), n = values.length;
    el.style.display = "inline-block"; el.style.position = "relative"; el.style.verticalAlign = "top"; el.style.height = "1.15em";
    el.textContent = "";
    var col = document.createElement("span");
    col.style.position = "absolute"; col.style.left = "0"; col.style.top = "0"; col.style.whiteSpace = "nowrap";
    var items = values.map(function (v, i) {
      var s = document.createElement("span"); s.textContent = v; s.style.display = "block"; s.style.height = "1.15em";
      col.appendChild(s); return s;
    });
    // A sizer keeps the line's width equal to the widest value.
    var sizer = document.createElement("span"); sizer.style.visibility = "hidden"; sizer.style.display = "inline-grid";
    values.forEach(function (v) { var s = document.createElement("span"); s.textContent = v; s.style.gridArea = "1 / 1"; sizer.appendChild(s); });
    el.appendChild(sizer); el.appendChild(col);
    var state = function (active) {
      return items.map(function (_, i) { var dist = Math.abs(i - active); return { opacity: dist === 0 ? 1 : dist === 1 ? 0.28 : 0, blur: dist === 0 ? 0 : 3 }; });
    };
    var s0 = state(0);
    items.forEach(function (it, i) { gsap.set(it, { opacity: s0[i].opacity, filter: "blur(" + s0[i].blur + "px)" }); });
    for (var k = 1; k < n; k++) {
      var t = at + (k - 1) * each, sk = state(k);
      tl.to(col, { y: -k * 1.15 + "em", duration: d, ease: E("page", el) }, t);
      items.forEach(function (it, i) { tl.to(it, { opacity: sk[i].opacity, filter: "blur(" + sk[i].blur + "px)", duration: d, ease: E("apple.out") }, t); });
    }
    return tl;
  }

  /** Draw a marker (.rc-mark) or a strike rule (.rc-rule) in from the left. */
  function mark(tl, target, at, o) {
    o = o || {};
    var els = [];
    q(target).forEach(function (el) {
      var m = el.matches && (el.matches(".rc-mark") || el.matches(".rc-rule")) ? el : el.querySelector(".rc-mark, .rc-rule");
      if (m) els.push(m);
    });
    // A pen stroke: it moves like a hand, minimum jerk from rest to rest.
    tl.fromTo(els, { scaleX: 0 }, { scaleX: 1, duration: o.duration || 0.5, ease: E(o.ease || "apple.glide"), stagger: o.stagger || 0.1 }, at);
    return tl;
  }

  /**
   * Move the cursor through points, each [x, y, seconds]. The x and y tweens use different eases,
   * so the path curves like a hand instead of running a ruler line.
   */
  function cursor(tl, target, at, points) {
    var el = one(target); if (!el) return tl;
    var t = at;
    el.__rcPath = el.__rcPath || [];
    points.forEach(function (p, i) {
      if (i === 0 && !p[2]) { tl.set(el, { x: p[0], y: p[1] }, t); el.__rcPath.push({ t: t, x: p[0], y: p[1] }); return; }
      var d = p[2] || 0.8;
      // A hand reaching for something: minimum jerk on x, a slightly earlier settle on y, so the path curves.
      tl.to(el, { x: p[0], duration: d, ease: E("apple.glide") }, t);
      tl.to(el, { y: p[1], duration: d * 0.92, ease: E("apple.glide") }, t);
      t += d;
      el.__rcPath.push({ t: t, x: p[0], y: p[1] });
    });
    return tl;
  }
  /** Where the cursor rests at time `at`, from the path already scheduled. */
  function restAt(el, at) {
    var pos = null;
    (el.__rcPath || []).forEach(function (p) { if (p.t <= at + 1e-6) pos = p; });
    return pos;
  }

  /**
   * Click: the cursor presses, a ripple rings out from its hotspot, and the target depresses.
   * Make the click CAUSE the next thing — schedule the consequence at `at + 0.12`.
   */
  function click(tl, target, at, o) {
    o = o || {};
    emit("click", at);
    var cur = one(target);
    // Apple's press: down quickly on the CSS curve, back up on a snappy spring. No bounce.
    if (cur) tl.to(cur, { scale: 0.86, duration: 0.08, ease: E("apple.out"), transformOrigin: "0 0" }, at)
             .to(cur, { scale: 1, duration: D("snappy", cur), ease: E("snappy", cur) }, at + 0.08);
    var tgt = one(o.target);
    if (tgt) tl.to(tgt, { scale: o.press || 0.97, duration: 0.08, ease: E("apple.out") }, at).to(tgt, { scale: 1, duration: D("default", tgt), ease: E("default", tgt) }, at + 0.08);
    var root = lookRoot(cur || tgt);
    if (cur && o.ripple !== false) {
      // The ripple sits where the cursor rests at click time, computed from the scheduled path —
      // never read from the DOM, which holds whatever frame was rendered last.
      var pos = o.x != null ? { x: o.x, y: o.y } : restAt(cur, at);
      if (pos) {
        var r = document.createElement("div"); r.className = "rc-ripple"; root.appendChild(r);
        gsap.set(r, { x: pos.x + 4, y: pos.y + 4 });
        tl.fromTo(r, { scale: 0.4, opacity: 0 }, { scale: 0.4, opacity: 0.7, duration: 0.01 }, at)
          .to(r, { scale: 1.4, opacity: 0, duration: 0.5, ease: E("apple.out") }, at + 0.02);
      }
    }
    return tl;
  }

  /** A slow camera move on a layer: push in, tilt, drift. Nothing in a good frame is quite still. */
  function camera(tl, target, at, o) {
    o = o || {};
    tl.fromTo(q(target), Object.assign({ scale: 1, x: 0, y: 0, rotationX: 0, rotationY: 0, rotation: 0 }, o.from || {}),
      Object.assign({ duration: o.duration || 4, ease: o.ease || "sine.inOut" }, o.to || { scale: 1.06 }), at);
    return tl;
  }

  /** Iris: a circle opens from a point to cover the frame. An in-beat transition that is not a fade. */
  function iris(tl, target, at, o) {
    o = o || {};
    emit("reveal", at);
    var at0 = o.from || "50% 50%";
    tl.fromTo(q(target), { clipPath: "circle(0% at " + at0 + ")" }, { clipPath: "circle(" + (o.to || 150) + "% at " + at0 + ")", duration: D("soft", one(target), o.duration), ease: E(o.ease || "soft", one(target)) }, at);
    return tl;
  }

  /** Wipe: reveal along the reading direction. dir: "right" | "left" | "up" | "down". */
  function wipe(tl, target, at, o) {
    o = o || {};
    emit("reveal", at);
    var from = { right: "inset(0 100% 0 0)", left: "inset(0 0 0 100%)", up: "inset(100% 0 0 0)", down: "inset(0 0 100% 0)" }[o.dir || "right"];
    tl.fromTo(q(target), { clipPath: from }, { clipPath: "inset(0 0% 0 0)", duration: D("page", one(target), o.duration), ease: E(o.ease || "page", one(target)) }, at);
    return tl;
  }

  /**
   * Smear: directional motion blur while something moves fast, gone when it lands.
   * Uses an SVG filter per element; the blur peaks mid-move.
   */
  function smear(tl, target, at, o) {
    o = o || {};
    emit("whoosh", at);
    q(target).forEach(function (el) {
      var id = "rc-smear-" + (++uid);
      var root = lookRoot(el);
      var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "0"); svg.setAttribute("height", "0"); svg.style.position = "absolute";
      svg.innerHTML = '<filter id="' + id + '" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="0 0"/></filter>';
      root.appendChild(svg);
      var blur = svg.querySelector("feGaussianBlur");
      el.style.filter = "url(#" + id + ")";
      var amt = o.amount || 18, d = o.duration || 0.5, axis = o.axis || "x";
      var st = { v: 0 };
      var apply = function () { blur.setAttribute("stdDeviation", axis === "x" ? st.v + " 0" : "0 " + st.v); };
      tl.fromTo(st, { v: 0 }, { v: amt, duration: d * 0.45, ease: "power2.in", onUpdate: apply }, at)
        .to(st, { v: 0, duration: d * 0.55, ease: "power2.out", onUpdate: apply }, at + d * 0.45);
    });
    return tl;
  }

  /** Draw an SVG stroke (path, line, circle) from nothing. */
  function draw(tl, target, at, o) {
    o = o || {};
    q(target).forEach(function (el, i) {
      var len = el.getTotalLength ? el.getTotalLength() : 1000;
      el.style.strokeDasharray = len; el.style.strokeDashoffset = len;
      tl.to(el, { strokeDashoffset: 0, duration: o.duration || 0.9, ease: E(o.ease || "apple.glide") }, at + i * (o.stagger || 0));
    });
    return tl;
  }

  /** Gentle continuous drift for a background layer, so a held frame still breathes. */
  function drift(tl, target, at, o) {
    o = o || {};
    tl.fromTo(q(target), { x: o.x0 || 0, y: o.y0 || 0, scale: o.s0 || 1, rotation: o.r0 || 0 },
      { x: o.x || 30, y: o.y || -20, scale: o.scale || 1.04, rotation: o.rotation || 0, duration: o.duration || 6, ease: "sine.inOut" }, at);
    return tl;
  }

  /** Build HUD corners into a root: RC.hud(root, { tl: "REELCUT · 01", br: "00:00:04" }). */
  function hud(target, labels) {
    var root = one(target); if (!root) return null;
    var h = document.createElement("div"); h.className = "rc-hud";
    h.innerHTML = "<i></i><i></i><i></i><i></i>";
    Object.keys(labels || {}).forEach(function (k) { var s = document.createElement("span"); s.className = k; s.textContent = labels[k]; h.appendChild(s); });
    root.appendChild(h);
    return h;
  }

  /** The cursor's SVG. Insert with RC.cursorEl(root). */
  function cursorEl(target, o) {
    var root = one(target); if (!root) return null;
    var c = document.createElement("div"); c.className = "rc-cursor";
    c.innerHTML = '<svg viewBox="0 0 32 32" width="40" height="40"><path d="M5 3 L5 26 L11 20 L15.5 29 L19.5 27 L15 18.5 L23 18.5 Z" fill="' + ((o && o.fill) || "#111") + '" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
    root.appendChild(c);
    return c;
  }


  /**
   * The lens. Builds the two images a glass element needs from its own size and corner radius:
   * a displacement map (R and G carry the horizontal and vertical push, 128 is "leave it alone")
   * and a specular rim. The push comes from a real surface: a convex squircle bezel, a ray falling
   * straight down, Snell's law at the top face (glass, index 1.5), and the lateral shift that ray
   * has made by the time it reaches the background. Nothing in here is random, so a frame depends
   * only on the element, never on when it was rendered.
   */
  function lensMaps(w, h, r, bezel, depth, ior, theta, rim) {
    var N = 160, prof = new Float32Array(N + 1), maxD = 1e-6, i;
    var Hf = function (t) { return Math.pow(1 - Math.pow(1 - t, 4), 0.25); };
    for (i = 0; i <= N; i++) {
      var t = i / N, e = 1 / N / 2, t1 = Math.max(0, t - e), t2 = Math.min(1, t + e);
      var slope = (depth / bezel) * (Hf(t2) - Hf(t1)) / (t2 - t1);
      var a1 = Math.atan(slope), a2 = Math.asin(Math.sin(a1) / ior);
      var d = depth * Hf(t) * Math.tan(a1 - a2);
      prof[i] = d; if (d > maxD) maxD = d;
    }
    var mc = document.createElement("canvas"), sc = document.createElement("canvas");
    mc.width = sc.width = w; mc.height = sc.height = h;
    var mi = mc.getContext("2d").createImageData(w, h), si = sc.getContext("2d").createImageData(w, h), md = mi.data, sd = si.data;
    var cx = w / 2, cy = h / 2, ix = w / 2 - r, iy = h / 2 - r;
    var lx = -Math.cos(theta), ly = -Math.sin(theta);      // toward the light
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var k = (y * w + x) * 4;
        var px = x + 0.5 - cx, py = y + 0.5 - cy, sx = px < 0 ? -1 : 1, sy = py < 0 ? -1 : 1;
        var qx = Math.abs(px) - ix, qy = Math.abs(py) - iy;
        var mx = qx > 0 ? qx : 0, my = qy > 0 ? qy : 0, len = Math.sqrt(mx * mx + my * my);
        var dist, nx, ny;                                   // distance in from the edge; outward normal
        if (len > 0) { dist = r - len; nx = sx * mx / len; ny = sy * my / len; }
        else if (qx > qy) { dist = r - qx; nx = sx; ny = 0; }
        else { dist = r - qy; nx = 0; ny = sy; }
        md[k] = 128; md[k + 1] = 128; md[k + 2] = 128; md[k + 3] = 255;
        if (dist < 0) continue;
        if (dist < bezel) {
          var f = dist / bezel * N, j = Math.floor(f), u = f - j;
          var mag = prof[j] * (1 - u) + prof[Math.min(N, j + 1)] * u, sgn = mag / maxD * 127.5;
          md[k] = 128 - nx * sgn; md[k + 1] = 128 - ny * sgn;   // sample from further in: the rim gathers the middle
        }
        var lit = nx * lx + ny * ly;
        var line = Math.exp(-dist * dist / (rim * rim));        // a thin bright line on the very edge
        var spec = line * (Math.pow(Math.max(0, lit), 1.6) + 0.42 * Math.pow(Math.max(0, -lit), 1.6));
        var glow = dist < bezel ? Math.pow(1 - dist / bezel, 2) * (0.1 + 0.16 * Math.max(0, lit)) : 0;
        sd[k] = sd[k + 1] = sd[k + 2] = 255; sd[k + 3] = Math.round(Math.min(1, spec * 0.95 + glow) * 255);
      }
    }
    mc.getContext("2d").putImageData(mi, 0, 0); sc.getContext("2d").putImageData(si, 0, 0);
    return { map: mc.toDataURL("image/png"), spec: sc.toDataURL("image/png"), max: maxD };
  }

  /**
   * Glass: Apple's Liquid Glass, after Aave's way of building it for the web. A lens, not a frosted
   * pane: what is behind is blurred a little, then pushed through the displacement map so it bends
   * along the rim like light through curved glass, with a faint chromatic fringe on the bend and a
   * specular rim and soft inner glow on top. Runs as an SVG filter used as a backdrop-filter, which
   * is what the Chromium that renders the film supports. Without this call `.rc-glass` is still a
   * good frosted pane (CSS only); with it, a lens.
   *
   *   RC.glass();                                   // every .rc-glass in the beat
   *   RC.glass("#root .thumb", { bezel: 14 });      // one element, tuned
   *
   * Options: bezel (px of curved rim), strength (how hard it bends; .45 for a small control up to .85 for a panel), blur, chroma (.035), light
   * (degrees, 45 = from the top left), ior (1.5). Tokens on the element: --glass-blur, --glass-sat,
   * --glass-bright. Call once, after layout; size and radius are read from the element.
   *
   * Apple's rules, which this follows: glass is the functional layer — a palette, a control, a
   * tooltip, a pill — floating over content; it is not the content; and glass never sits on glass.
   * Regular (default) for anything with words; `.rc-clear` for small controls over rich backgrounds.
   */
  function glass(target, o) {
    o = o || {};
    var els = target == null ? q(".rc-glass") : q(target);
    els.forEach(function (el) {
      if (el.__rcGlass) return;
      var w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
      if (w < 8 || h < 8) return;
      el.__rcGlass = true;
      var cs = getComputedStyle(el), tok = function (n, d) { var v = parseFloat(cs.getPropertyValue(n)); return isNaN(v) ? d : v; };
      if (cs.position === "static") el.style.position = "relative";
      var r = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, w / 2, h / 2), clear = el.classList.contains("rc-clear");
      var bezel = o.bezel || Math.max(6, Math.min(30, Math.min(w, h) * 0.3));
      // Small controls bend gently, big panels more: the fill under a thumb has to stay readable.
      var small = Math.min(1, Math.max(0, (Math.min(w, h) - 60) / 200));
      var depth = bezel * 2 * (o.strength == null ? 0.45 + 0.4 * small : o.strength);
      var blur = Math.max(0.01, o.blur == null ? tok("--glass-blur", clear ? 0 : 10) : o.blur);
      var sat = tok("--glass-sat", clear ? 1.25 : 1.5), bright = tok("--glass-bright", 1.04);
      var chroma = o.chroma == null ? 0.035 : o.chroma;
      var rim = o.rim || Math.max(1.6, Math.min(3, Math.min(w, h) / 40));
      var m = lensMaps(w, h, r, bezel, depth, o.ior || 1.5, (o.light == null ? 45 : o.light) * Math.PI / 180, rim);
      var S = 2 * m.max, id = "rc-lg-" + (++uid);
      var only = function (c) {   // keep one colour channel, drop the others
        var z = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]; z[c * 5 + c] = 1; return z.join(" ");
      };
      var svg = document.createElementNS(NS, "svg");
      svg.setAttribute("width", "0"); svg.setAttribute("height", "0"); svg.style.position = "absolute"; svg.style.pointerEvents = "none";
      svg.innerHTML =
        '<filter id="' + id + '" filterUnits="userSpaceOnUse" x="0" y="0" width="' + w + '" height="' + h + '" color-interpolation-filters="sRGB">' +
        '<feGaussianBlur in="SourceGraphic" stdDeviation="' + blur + '" result="b"/>' +
        '<feImage href="' + m.map + '" x="0" y="0" width="' + w + '" height="' + h + '" preserveAspectRatio="none" result="m"/>' +
        '<feDisplacementMap in="b" in2="m" scale="' + (S * (1 + chroma)).toFixed(2) + '" xChannelSelector="R" yChannelSelector="G" result="dr"/>' +
        '<feDisplacementMap in="b" in2="m" scale="' + S.toFixed(2) + '" xChannelSelector="R" yChannelSelector="G" result="dg"/>' +
        '<feDisplacementMap in="b" in2="m" scale="' + (S * (1 - chroma)).toFixed(2) + '" xChannelSelector="R" yChannelSelector="G" result="db"/>' +
        '<feColorMatrix in="dr" type="matrix" values="' + only(0) + '" result="cr"/>' +
        '<feColorMatrix in="dg" type="matrix" values="' + only(1) + '" result="cg"/>' +
        '<feColorMatrix in="db" type="matrix" values="' + only(2) + '" result="cb"/>' +
        '<feBlend in="cr" in2="cg" mode="screen" result="rg"/><feBlend in="rg" in2="cb" mode="screen" result="rgb"/>' +
        '<feColorMatrix in="rgb" type="saturate" values="' + sat + '" result="sat"/>' +
        '<feComponentTransfer in="sat"><feFuncR type="linear" slope="' + bright + '"/><feFuncG type="linear" slope="' + bright + '"/><feFuncB type="linear" slope="' + bright + '"/></feComponentTransfer>' +
        '</filter>';
      lookRoot(el).appendChild(svg);
      el.style.webkitBackdropFilter = el.style.backdropFilter = "url(#" + id + ")";
      el.style.setProperty("--lg-spec", "url(" + m.spec + ")");
    });
    return null;
  }

  /**
   * Scramble: text resolves from noise, left to right, like a decode. The noise is precomputed from
   * a seed, frame by frame, so any seek shows the same characters. Best in a mono face, where the
   * width never changes; `glyphs` is the noise alphabet, `tail` how far ahead of the resolved text
   * the noise runs, `hide: false` to show noise on the whole line instead of nothing past the tail.
   */
  function scramble(tl, target, at, o) {
    o = o || {};
    var el = one(target); if (!el) return tl;
    var text = o.text != null ? o.text : el.textContent, n = text.length;
    var dur = o.duration || Math.max(0.6, n * 0.045), tail = o.tail == null ? 4 : o.tail;
    var glyphs = o.glyphs || "#%&*+=?/<>01~", rnd = rand(o.seed || 11), frames = Math.max(2, Math.round(dur * 30)), table = [], f, i;
    for (f = 0; f < frames; f++) { var row = []; for (i = 0; i < n; i++) row.push(glyphs.charAt(Math.floor(rnd() * glyphs.length))); table.push(row); }
    el.style.whiteSpace = "pre";
    var st = { p: 0 };
    var paint = function () {
      var fr = Math.min(frames - 1, Math.floor(st.p * frames)), front = st.p * (n + tail), out = "";
      for (var k = 0; k < n; k++) {
        var c = text.charAt(k);
        out += /\s/.test(c) ? c : k < front ? c : (o.hide === false || k < front + tail) ? table[fr][k] : " ";
      }
      el.textContent = out;
    };
    paint();
    tl.fromTo(st, { p: 0 }, { p: 1, duration: dur, ease: o.ease || "none", onUpdate: paint, immediateRender: false }, at);
    return tl;
  }

  /**
   * Zoom a recorded-footage box into a region of the recording, e.g. the Download button. `region` is
   * [x, y, w, h] as fractions of the recording, or "focus" (the default) for the region saved on the
   * moment for this reel's format, which the render writes to the box as data-focus.
   *
   * The recording moves inside its box; the box does not. The region is fitted, never stretched, centred,
   * and the window is kept inside the recording. Give it a region with the recording's own proportions
   * (width and height as the same fraction) and the window is the region exactly; a different shape shows
   * more of what is around it. Done in percentages of the layer's own size, so it needs no layout and is the same on every load.
   */
  function zoomTo(tl, target, at, o) {
    o = o || {};
    q(target).forEach(function (box) {
      var inner = box.querySelector(".rc-fv");
      var r = o.region;
      if (r === undefined || r === "focus") { var f = (box.getAttribute("data-focus") || "").split(","); r = f.length === 4 ? f.map(Number) : null; }
      if (!inner || !r || r.some(isNaN)) return;
      var s = Math.min(1 / r[2], 1 / r[3]);
      // The window is 1/s of the recording each way, centred on the region and kept inside the recording.
      var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
      var wx = clamp(r[0] + r[2] / 2 - 0.5 / s, 0, 1 - 1 / s), wy = clamp(r[1] + r[3] / 2 - 0.5 / s, 0, 1 - 1 / s);
      tl.fromTo(inner, { scale: 1, xPercent: 0, yPercent: 0 },
        { scale: s, xPercent: -wx * s * 100, yPercent: -wy * s * 100, duration: o.duration || 1.1, ease: E(o.ease || "soft", box), immediateRender: false }, at);
    });
    return tl;
  }

  /**
   * Let a cut-out drift: one slow, finite move (up and a touch of tilt) over `duration`, never a loop. For a
   * keyed recording (data-frame="cutout") that has landed and would otherwise sit dead still. `y` and `rotate`
   * are where it ends up, relative to where it is.
   */
  function float(tl, target, at, o) {
    o = o || {};
    q(target).forEach(function (el) {
      tl.fromTo(el, { y: 0, rotation: 0 }, { y: o.y != null ? o.y : -14, rotation: o.rotate != null ? o.rotate : -0.8, duration: o.duration || 2.4, ease: o.ease || "sine.inOut", immediateRender: false }, at);
    });
    return tl;
  }

  /** Bring a ring (.rc-spot, inside the recording's .rc-fv) onto the part it points at; `out` takes it away. */
  function spot(tl, target, at, o) {
    o = o || {};
    q(target).forEach(function (el) {
      tl.fromTo(el, { opacity: 0, scale: 1.08 }, { opacity: 1, scale: 1, duration: D("default", el, o.duration), ease: E(o.ease || "default", el), immediateRender: false }, at);
      if (o.out != null) tl.to(el, { opacity: 0, duration: 0.24, ease: E("apple.exit") }, o.out);
    });
    return tl;
  }

  /**
   * The voiceover, when the reel has one: this beat's own words and the voice's loudness, in the beat's time
   * (0 = its first frame), written in by the render. Without a voiceover each helper returns its fallback, so a beat
   * renders the same with or without one.
   *
   *   RC.word("Claude")          when "Claude" is said (its first occurrence), or 0
   *   RC.word("Claude", 1, 2.4)  its second occurrence, or 2.4 when there is no voiceover
   *   RC.wordEnd("Claude")       when it has been said
   *   RC.voice(t)                the voice's loudness at t, 0..1
   *   RC.voiceDrive(tl, ".orb", 0, 4, { scale: [1, 1.08] })   move with the speaker for 4 s
   */
  // Read when asked, not when the kit loads: the composition's voice data arrives after the kit.
  function V() { return window.__rcVoice || null; }
  function normWord(s) { return String(s).toLowerCase().replace(/ß/g, "ss").replace(/[^a-z0-9äöüàâçéèêëîïôûùüÿñæœ]+/g, ""); }
  function findWord(q, nth) {
    var VOICE = V();
    if (!VOICE) return null;
    var n = normWord(q), hits = VOICE.words.filter(function (w) { return normWord(w.w) === n; });
    return hits[nth || 0] || null;
  }
  function word(q, nth, fallback) { var w = findWord(q, nth); return w ? Math.max(0, w.start) : (fallback != null ? fallback : 0); }
  function wordEnd(q, nth, fallback) { var w = findWord(q, nth); return w ? Math.max(0, w.end) : (fallback != null ? fallback : 0); }
  function voice(t) {
    var VOICE = V();
    if (!VOICE || !VOICE.rms.length) return 0;
    var f = t * VOICE.fps, i = Math.floor(f), k = f - i;
    var a = VOICE.rms[Math.max(0, Math.min(VOICE.rms.length - 1, i))], b = VOICE.rms[Math.max(0, Math.min(VOICE.rms.length - 1, i + 1))];
    return a + (b - a) * k;
  }
  /** Drive properties from the voice's loudness: { prop: [quiet, loud] }, sampled 30 times a second. */
  function voiceDrive(tl, target, at, duration, props) {
    var step = 1 / 30, n = Math.max(1, Math.round(duration / step));
    q(target).forEach(function (el) {
      var frames = [];
      for (var i = 0; i <= n; i++) {
        var v = voice(at + i * step), kf = { duration: step, ease: "none" };
        for (var p in props) kf[p] = props[p][0] + (props[p][1] - props[p][0]) * v;
        frames.push(kf);
      }
      tl.to(el, { keyframes: frames, immediateRender: false }, at);
    });
    return tl;
  }

  window.RC = {
    word: word, wordEnd: wordEnd, voice: voice, voiceDrive: voiceDrive,
    spring: spring, ease: E, SPRINGS: SPRINGS, emit: emit,
    q: q, one: one, rand: rand, split: split, hold: hold,
    blurIn: blurIn, blurOut: blurOut, words: words, chars: chars, lines: lines, rise: rise, flyIn: flyIn, pop: pop,
    type: type, count: count, roll: roll, wheel: wheel, mark: mark,
    cursor: cursor, click: click, cursorEl: cursorEl,
    camera: camera, iris: iris, wipe: wipe, smear: smear, draw: draw, drift: drift, hud: hud, glass: glass, scramble: scramble, zoomTo: zoomTo, spot: spot, float: float,
  };
})();
