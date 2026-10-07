/*
 * iOS controls, moving the way they do on device (apple-glass › micro-interactions):
 *
 *   RC.lensSet(el, i)                     select item i at frame 0 (tab bar or segmented control)
 *   RC.lensTo(tl, el, at, i, o)           the lens travels to item i on spring.default while its child swells
 *                                         (1.14 × 1.08 → 1 on a lively 520/24 spring); the tapped item presses to .92
 *   RC.tabbarMin(tl, bar, at, min)        the tab bar minimises on scroll (62 → 50 pt, labels fold away), or expands
 *   RC.toggle(tl, sw, at, on)             the knob widens under the finger (38 → 46 pt), travels on spring.default,
 *                                         the track fills; it narrows again as it lands
 *   RC.slide(tl, sl, at, o)               hold: the thumb swells into clear glass and the value bubble pops up;
 *                                         drag from o.from to o.to like a hand (apple.glide); release: it settles back
 *   RC.searchFocus(tl, field, at)         the focus ring fades in (150 ms)
 *   RC.keyboard(container, o)             build an iOS keyboard (letters, shift, delete, 123, space, return)
 *   RC.keyboardIn(tl, kb, at)             it rises with the iOS curve (apple.push)
 *   RC.keyType(tl, kb, field, at, o)      type o.text into the field; each key shows its callout while pressed
 */
(function () {
  var RC = window.RC, gsap = window.gsap;
  if (!RC || RC.lensTo) return;

  function items(el) { return RC.q(el.children).filter(function (c) { return !c.classList.contains("rc-lens"); }); }
  function box(el, i) { var it = items(el)[i]; return it ? { x: it.offsetLeft, w: it.offsetWidth } : null; }

  function lensSet(target, i) {
    RC.q(target).forEach(function (el) {
      var lens = el.querySelector(".rc-lens"), b = box(el, i); if (!lens || !b) return;
      gsap.set(lens, { x: b.x, width: b.w });
      items(el).forEach(function (it, k) { it.classList.toggle("rc-on", k === i); });
      el.__rcLens = i;
    });
  }

  var SWELL = { stiffness: 520, damping: 24 };
  function lensTo(tl, target, at, i, o) {
    o = o || {};
    RC.q(target).forEach(function (el) {
      var lens = el.querySelector(".rc-lens"), b = box(el, i), its = items(el), prev = el.__rcLens;
      if (!lens || !b) return;
      RC.emit("click", at);
      if (o.press !== false) RC.press(tl, its[i], at, { scale: 0.92 });
      RC.to(tl, lens, at + 0.04, { x: b.x, width: b.w }, "default");
      var sw = RC.spring(SWELL);
      tl.fromTo(lens.firstElementChild, { scaleX: 1.14, scaleY: 1.08 }, { scaleX: 1, scaleY: 1, duration: sw.duration, ease: sw.ease, immediateRender: false }, at + 0.04);
      // The selected label takes the tint as the lens arrives; the old one lets it go.
      var tint = getComputedStyle(el).getPropertyValue("--ui-tint").trim(), ink = getComputedStyle(el).getPropertyValue("--ui-label").trim();
      if (el.classList.contains("rc-tabbar")) {
        if (prev != null && its[prev]) tl.to(its[prev], { color: ink, duration: 0.2, ease: RC.ease("apple.out") }, at + 0.04);
        tl.to(its[i], { color: tint, duration: 0.2, ease: RC.ease("apple.out") }, at + 0.1);
      }
      el.__rcLens = i;
    });
    return tl;
  }

  function tabbarMin(tl, target, at, min) {
    RC.q(target).forEach(function (bar) {
      RC.to(tl, bar, at, { "--tbh": min ? 50 : 62, "--tbl": min ? 0 : 13, "--tblo": min ? 0 : 1 }, "default");
    });
    return tl;
  }

  function toggle(tl, target, at, on, o) {
    o = o || {};
    RC.q(target).forEach(function (sw) {
      var knob = sw.querySelector(".rc-sw-knob"), fill = sw.querySelector(".rc-sw-fill");
      RC.emit("toggle", at);
      // Under the finger the knob widens toward where it is going.
      tl.to(knob, { "--kw": 46, "--kx": on ? 0 : 16, duration: 0.12, ease: RC.ease("apple.out") }, at);
      RC.to(tl, knob, at + (o.hold || 0.12), { "--kw": 38, "--kx": on ? 22 : 0 }, "default");
      tl.to(fill, { opacity: on ? 1 : 0, duration: 0.25, ease: RC.ease("apple.out") }, at + 0.08);
    });
    return tl;
  }

  function slide(tl, target, at, o) {
    o = o || {};
    RC.q(target).forEach(function (sl) {
      var thumb = sl.querySelector(".rc-sl-thumb"), bubble = sl.querySelector(".rc-sl-bubble");
      var from = o.from == null ? 0.5 : o.from, to = o.to == null ? 0.8 : o.to, dur = o.duration || 1, hold = o.hold || 0.25;
      var fmt = o.format || function (v) { return Math.round(v * 100) + "%"; };
      gsap.set(sl, { "--v": from });
      if (bubble) bubble.textContent = fmt(from);
      // Hold: the thumb swells into clear glass; the bubble pops above it.
      RC.to(tl, thumb, at, { scale: 1.32 }, "snappy");
      tl.to(thumb, { "--solid": 0.12, duration: 0.2, ease: RC.ease("apple.out") }, at);
      if (bubble) {
        var sp = RC.spring({ stiffness: 520, damping: 30 });
        tl.fromTo(bubble, { scale: 0.6, y: 8 }, { scale: 1, y: 0, duration: sp.duration, ease: sp.ease, immediateRender: false }, at + 0.05);
        tl.to(bubble, { opacity: 1, duration: 0.14, ease: RC.ease("apple.out") }, at + 0.05);
      }
      // Drag, like a hand; the value follows.
      var st = { v: from };
      tl.to(st, { v: to, duration: dur, ease: RC.ease("apple.glide"), onUpdate: function () {
        sl.style.setProperty("--v", st.v); if (bubble) bubble.textContent = fmt(st.v);
      } }, at + hold);
      // Release: back to a solid thumb; the bubble leaves, faster than it came.
      var rel = at + hold + dur + (o.rest || 0.15);
      RC.to(tl, thumb, rel, { scale: 1 }, "default");
      tl.to(thumb, { "--solid": 1, duration: 0.25, ease: RC.ease("apple.out") }, rel);
      if (bubble) tl.to(bubble, { opacity: 0, scale: 0.8, duration: 0.16, ease: RC.ease("apple.exit") }, rel);
    });
    return tl;
  }

  function searchFocus(tl, target, at) {
    RC.q(target).forEach(function (f) { tl.to(f, { "--ring": 1, duration: 0.15, ease: RC.ease("apple.out") }, at); });
    return tl;
  }

  var ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
  function keyboard(target, o) {
    o = o || {};
    var host = RC.one(target); if (!host) return null;
    var kb = document.createElement("div"); kb.className = "rc-kb";
    var key = function (label, cls, k) {
      var d = document.createElement("div"); d.className = "rc-key" + (cls ? " " + cls : ""); d.textContent = label;
      if (k != null) { d.setAttribute("data-k", k); if (k.length === 1 && k !== " ") { var p = document.createElement("span"); p.className = "rc-kpop"; p.textContent = label; d.appendChild(p); } }
      return d;
    };
    ROWS.forEach(function (r, ri) {
      var row = document.createElement("div"); row.className = "rc-kb-row";
      if (ri === 2) row.appendChild(key("⇧", "rc-fn rc-wide"));
      Array.prototype.forEach.call(r, function (c) { row.appendChild(key(c, "", c)); });
      if (ri === 2) row.appendChild(key("⌫", "rc-fn rc-wide"));
      kb.appendChild(row);
    });
    var last = document.createElement("div"); last.className = "rc-kb-row";
    last.appendChild(key("123", "rc-fn rc-wide"));
    last.appendChild(key("space", "rc-space", " "));
    last.appendChild(key(o.go || "search", "rc-go"));
    kb.appendChild(last);
    host.appendChild(kb);
    return kb;
  }

  function keyboardIn(tl, target, at) {
    RC.q(target).forEach(function (kb) { tl.fromTo(kb, { yPercent: 100 }, { yPercent: 0, duration: 0.42, ease: RC.ease("apple.push"), immediateRender: true }, at); });
    return tl;
  }

  function keyType(tl, kbT, fieldT, at, o) {
    o = o || {};
    var kb = RC.one(kbT), field = RC.one(fieldT); if (!field) return tl;
    var q = field.querySelector(".rc-q") || field, text = o.text || "", cps = o.cps || 9;
    RC.type(tl, q, at, { text: text, cps: cps, caret: field.querySelector(".rc-caret") || false, blinkFrom: o.blinkFrom, blinkTo: o.blinkTo });
    var ph = field.querySelector(".rc-ph"), x = field.querySelector(".rc-x");
    if (ph) tl.set(ph, { opacity: 0 }, at + 0.5 / cps);
    if (x) { tl.to(x, { opacity: 1, duration: 0.12, ease: RC.ease("apple.out") }, at + 0.5 / cps); RC.to(tl, x, at + 0.5 / cps, { scale: 1 }, "snappy"); }
    if (!kb) return tl;
    Array.prototype.forEach.call(text.toLowerCase(), function (c, i) {
      // RC.type shows character i once its progress rounds past i + .5: the key goes down just before.
      var t = at + (i + 0.5) / cps - 0.03;
      var k = kb.querySelector('[data-k="' + (c === '"' ? '\\"' : c) + '"]'); if (!k) return;
      var pop = k.querySelector(".rc-kpop");
      if (pop) { tl.set(pop, { opacity: 1 }, t); tl.set(pop, { opacity: 0 }, t + 0.1); }
      else { tl.set(k, { filter: "brightness(.8)" }, t); tl.set(k, { filter: "brightness(1)" }, t + 0.1); }
    });
    return tl;
  }

  Object.assign(window.RC, {
    lensSet: lensSet, lensTo: lensTo, tabbarMin: tabbarMin, toggle: toggle, slide: slide,
    searchFocus: searchFocus, keyboard: keyboard, keyboardIn: keyboardIn, keyType: keyType,
  });
})();
