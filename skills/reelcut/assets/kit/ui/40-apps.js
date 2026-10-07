/*
 * App mockups in motion:
 *
 *   Messages  RC.threadSet(thread, n, bottom)          show the first n items, the last one's bottom at `bottom` (px in the thread's parent)
 *             RC.msgShow(tl, thread, item, at, o)      the next item arrives: the thread glides up (spring.default) and the
 *                                                     bubble rises in from below (sent) or grows from its tail corner (received)
 *             RC.msgTyping(tl, el, at, until)          the typing bubble pops in, its dots breathe in a wave, it goes at `until`
 *             RC.compose(tl, composer, at, o)          type into the composer; the send button scales in with the first letter;
 *                                                     o.send (a time) presses it and clears the field
 *   Calendar  RC.evDrag(tl, ev, at, { x, y, duration }) lift (1.04 and a shadow), carry like a hand, set down on the grid
 *   Maps      RC.mapDraw(el, o)                        a stylised neighbourhood in the look's colours (seeded), returns the svg
 *             RC.routePath(svg, pts, o)                a route along points (pt), drawn with RC.draw
 *             RC.pinDrop(tl, pin, at, o)               the pin falls and lands with a small give; its shadow grows
 *             RC.breathe(tl, el, at, seconds, o)       a calm, finite pulse on --halo (the location dot's accuracy ring)
 *   Music     RC.playPause(tl, np, at, playing)        the glyph cross-fades with a scale; the artwork grows (playing) or rests smaller
 *             RC.scrubTo(tl, scrub, at, seconds, from, to, o)  the playhead runs (linear) and the times count
 *   Home      RC.appOpen(tl, icon, view, at) / RC.appClose(tl, icon, view, at)   the app grows out of its icon on spring.page
 */
(function () {
  var RC = window.RC, gsap = window.gsap;
  if (!RC || RC.msgShow) return;
  function ptOf(el) { return parseFloat(getComputedStyle(el).getPropertyValue("--pt")) || 1.5; }
  function items(thread) { return RC.q(thread.children); }

  function threadSet(threadT, n, bottom) {
    var thread = RC.one(threadT); if (!thread) return;
    var its = items(thread), last = its[n - 1];
    gsap.set(thread, { y: last ? bottom - thread.offsetTop - (last.offsetTop + last.offsetHeight) : 0 });
    its.forEach(function (it, i) { if (i >= n) gsap.set(it, { opacity: 0 }); });
    thread.__rcBottom = bottom;
  }

  function msgShow(tl, threadT, itemT, at, o) {
    o = o || {};
    var thread = RC.one(threadT), it = RC.one(itemT); if (!thread || !it) return tl;
    var bottom = o.bottom != null ? o.bottom : thread.__rcBottom;
    RC.to(tl, thread, at, { y: bottom - thread.offsetTop - (it.offsetTop + it.offsetHeight) }, "default");
    var mine = it.classList.contains("rc-me"), s = RC.spring("default", it), pt = ptOf(it);
    // A run of bubbles keeps one tail, on its last: the one before loses its tail as this one lands.
    var prev = it.previousElementSibling;
    if (prev && prev.classList.contains("rc-msg") && prev.classList.contains("rc-me") === mine) tl.set(prev, { attr: { "data-tail": "0" } }, at + 0.05);
    if (it.classList.contains("rc-msg")) RC.emit(mine ? "whoosh" : "pop", at);
    if (mine) {
      gsap.set(it, { transformOrigin: "100% 100%" });
      tl.fromTo(it, { y: 28 * pt, scale: 0.94 }, { y: 0, scale: 1, duration: s.duration, ease: s.ease, immediateRender: false }, at);
    } else {
      gsap.set(it, { transformOrigin: "0% 100%" });
      tl.fromTo(it, { scale: 0.7 }, { scale: 1, duration: s.duration, ease: s.ease, immediateRender: false }, at);
    }
    tl.to(it, { opacity: 1, duration: 0.14, ease: RC.ease("apple.out") }, at);
    return tl;
  }

  function msgTyping(tl, target, at, until) {
    RC.q(target).forEach(function (el) {
      var dots = RC.q(el.querySelectorAll("i"));
      gsap.set(el, { opacity: 0 });
      var s = RC.spring("snappy", el);
      tl.fromTo(el, { scale: 0.6 }, { scale: 1, duration: s.duration, ease: s.ease, immediateRender: false }, at);
      tl.to(el, { opacity: 1, duration: 0.12, ease: RC.ease("apple.out") }, at);
      var st = { t: 0 }, span = (until || at + 2) - at;
      var paint = function () { dots.forEach(function (d, i) {
        var w = Math.max(0, Math.sin((st.t * 1.5 - i * 0.2) * Math.PI * 2));
        d.style.opacity = (0.35 + 0.65 * w).toFixed(3); d.style.transform = "translateY(" + (-w * 2 * ptOf(el)).toFixed(2) + "px)";
      }); };
      paint();
      tl.fromTo(st, { t: 0 }, { t: span, duration: span, ease: "none", onUpdate: paint, immediateRender: false }, at);
      if (until != null) tl.to(el, { opacity: 0, scale: 0.85, duration: 0.14, ease: RC.ease("apple.exit") }, until);
    });
    return tl;
  }

  function compose(tl, target, at, o) {
    o = o || {};
    var c = RC.one(target); if (!c) return tl;
    var txt = c.querySelector(".rc-ctext"), ph = c.querySelector(".rc-ph"), send = c.querySelector(".rc-send");
    var cps = o.cps || 14, text = o.text || "";
    RC.type(tl, txt, at, { text: text, cps: cps, caret: c.querySelector(".rc-caret") || false, blinkFrom: at - 0.6, blinkTo: o.send != null ? o.send : at + text.length / cps + 1 });
    if (ph) tl.set(ph, { opacity: 0 }, at + 0.5 / cps);
    if (send) RC.to(tl, send, at + 0.5 / cps, { scale: 1 }, "snappy");
    if (o.send != null) {
      if (send) RC.press(tl, send, o.send, { scale: 0.85 });
      RC.emit("click", o.send);
      tl.set(txt, { textContent: "" }, o.send + 0.06);
      if (c.querySelector(".rc-caret")) tl.set(c.querySelector(".rc-caret"), { opacity: 0 }, o.send + 0.06);
      if (ph) tl.set(ph, { opacity: 1 }, o.send + 0.1);
      if (send) tl.to(send, { scale: 0, duration: 0.18, ease: RC.ease("apple.exit") }, o.send + 0.12);
    }
    return tl;
  }

  function evDrag(tl, target, at, o) {
    o = o || {};
    RC.q(target).forEach(function (ev) {
      var d = o.duration || 0.7;
      RC.to(tl, ev, at, { scale: 1.04, boxShadow: "0 18px 36px -10px rgba(0,0,0,.35)", zIndex: 5 }, "snappy");
      tl.to(ev, { x: o.x || 0, y: o.y || 0, duration: d, ease: RC.ease("apple.glide") }, at + 0.12);
      RC.to(tl, ev, at + 0.12 + d, { scale: 1, boxShadow: "0 0px 0px 0px rgba(0,0,0,0)" }, "snappy");
      RC.emit("click", at + 0.12 + d);
    });
    return tl;
  }

  var MAP_LIGHT = { land: "#f2efe9", park: "#cdeac0", water: "#a8d4f6", minor: "#ffffff", major: "#ffe3a1", casing: "#efcd7b", label: "#6e6a64", block: "#e9e5dd" };
  var MAP_DARK = { land: "#1e1f22", park: "#203628", water: "#1a3550", minor: "#3a3b40", major: "#5b553f", casing: "#46412f", label: "#a3a2a8", block: "#25262a" };
  function mapDraw(target, o) {
    o = o || {};
    var host = RC.one(target); if (!host) return null;
    var look = host.closest("[data-look]"), dark = o.dark != null ? o.dark : /^(ink|cinema)$/.test(look && look.getAttribute("data-look") || "");
    var C = Object.assign({}, dark ? MAP_DARK : MAP_LIGHT, o.colors || {});
    var W = host.offsetWidth, H = host.offsetHeight, pt = ptOf(host), rnd = RC.rand(o.seed || 3);
    var map = document.createElement("div"); map.className = "rc-map";
    var p = [];
    p.push('<rect width="' + W + '" height="' + H + '" fill="' + C.land + '"/>');
    // City blocks: a soft grid of slightly darker rectangles between the streets.
    var gx = 92 * pt, gy = 78 * pt;
    for (var bx = -gx; bx < W + gx; bx += gx) for (var by = -gy; by < H + gy; by += gy) {
      var j = (rnd() - 0.5) * 10 * pt;
      p.push('<rect x="' + (bx + 9 * pt + j) + '" y="' + (by + 9 * pt) + '" width="' + (gx - 18 * pt) + '" height="' + (gy - 18 * pt) + '" rx="' + 6 * pt + '" fill="' + C.block + '"/>');
    }
    // Parks.
    for (var k = 0; k < 3; k++) {
      var px = rnd() * W, py = rnd() * H, pw = (80 + rnd() * 90) * pt, phh = (60 + rnd() * 70) * pt;
      p.push('<rect x="' + px + '" y="' + py + '" width="' + pw + '" height="' + phh + '" rx="' + 18 * pt + '" fill="' + C.park + '"/>');
    }
    // A river curving across.
    var ry = H * (0.62 + rnd() * 0.15);
    p.push('<path d="M ' + (-40 * pt) + ' ' + ry + ' C ' + W * 0.3 + ' ' + (ry - 90 * pt) + ', ' + W * 0.6 + ' ' + (ry + 110 * pt) + ', ' + (W + 40 * pt) + ' ' + (ry - 20 * pt) +
      '" fill="none" stroke="' + C.water + '" stroke-width="' + 46 * pt + '" stroke-linecap="round"/>');
    // Minor streets on the grid, two major roads crossing it.
    for (var sx = 0; sx < W + gx; sx += gx) p.push('<path d="M ' + sx + ' -10 L ' + (sx + 18 * pt) + ' ' + (H + 10) + '" stroke="' + C.minor + '" stroke-width="' + 7 * pt + '"/>');
    for (var sy = 0; sy < H + gy; sy += gy) p.push('<path d="M -10 ' + sy + ' L ' + (W + 10) + ' ' + (sy - 14 * pt) + '" stroke="' + C.minor + '" stroke-width="' + 7 * pt + '"/>');
    var maj = [['M -20 ' + H * 0.3 + ' C ' + W * 0.35 + ' ' + H * 0.22 + ', ' + W * 0.6 + ' ' + H * 0.42 + ', ' + (W + 20) + ' ' + H * 0.36],
               ['M ' + W * 0.62 + ' -20 C ' + W * 0.58 + ' ' + H * 0.4 + ', ' + W * 0.7 + ' ' + H * 0.6 + ', ' + W * 0.66 + ' ' + (H + 20)]];
    maj.forEach(function (d) {
      p.push('<path d="' + d[0] + '" fill="none" stroke="' + C.casing + '" stroke-width="' + 15 * pt + '" stroke-linecap="round"/>');
      p.push('<path d="' + d[0] + '" fill="none" stroke="' + C.major + '" stroke-width="' + 12 * pt + '" stroke-linecap="round"/>');
    });
    (o.labels || []).forEach(function (l) {
      p.push('<text x="' + l[1] * pt + '" y="' + l[2] * pt + '" fill="' + C.label + '" font-family="' + getComputedStyle(host).fontFamily.replace(/"/g, "'") +
        '" font-size="' + 12 * pt + '" font-weight="600" letter-spacing="0.02em"' + (l[3] ? ' transform="rotate(' + l[3] + ' ' + l[1] * pt + ' ' + l[2] * pt + ')"' : "") + '>' + l[0] + '</text>');
    });
    map.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">' + p.join("") + '<g class="rc-map-top"></g></svg>';
    host.insertBefore(map, host.firstChild);
    return map.querySelector("svg");
  }

  function routePath(svg, pts, o) {
    o = o || {};
    var pt = ptOf(svg.parentNode), top = svg.querySelector(".rc-map-top") || svg, NS = "http://www.w3.org/2000/svg";
    var d = "M " + pts[0][0] * pt + " " + pts[0][1] * pt;
    for (var i = 1; i < pts.length; i++) {
      // Rounded corners: a quadratic through each corner point, so the line turns like a road does.
      if (i < pts.length - 1) {
        var a = pts[i], b = pts[i + 1], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        d += " Q " + a[0] * pt + " " + a[1] * pt + " " + m[0] * pt + " " + m[1] * pt;
      } else d += " L " + pts[i][0] * pt + " " + pts[i][1] * pt;
    }
    var casing = document.createElementNS(NS, "path"), line = document.createElementNS(NS, "path");
    casing.setAttribute("d", d); line.setAttribute("d", d);
    casing.setAttribute("class", "rc-route rc-route-casing"); line.setAttribute("class", "rc-route");
    casing.style.stroke = o.casing || "rgba(0,60,160,.35)"; casing.style.strokeWidth = (o.width || 8) * pt + 4 * pt;
    line.style.strokeWidth = (o.width || 8) * pt;
    top.appendChild(casing); top.appendChild(line);
    return [casing, line];
  }

  var PIN = { stiffness: 420, damping: 30 };
  function pinDrop(tl, target, at, o) {
    o = o || {};
    RC.q(target).forEach(function (pin) {
      var sh = o.shadow ? RC.one(o.shadow) : null, pt = ptOf(pin), s = RC.spring(PIN);
      gsap.set(pin, { opacity: 0 });
      tl.fromTo(pin, { y: -(o.height || 90) * pt }, { y: 0, duration: s.duration, ease: s.ease, immediateRender: false }, at);
      tl.to(pin, { opacity: 1, duration: 0.1, ease: RC.ease("apple.out") }, at);
      if (sh) { gsap.set(sh, { opacity: 0, scale: 0.3 }); tl.to(sh, { opacity: 1, scale: 1, duration: s.duration, ease: s.ease }, at); }
      RC.emit("pop", at + s.duration * 0.3);
    });
    return tl;
  }

  function breathe(tl, target, at, seconds, o) {
    o = o || {};
    RC.q(target).forEach(function (el) {
      var st = { t: 0 }, lo = o.from || 0.85, hi = o.to || 1.15, per = o.period || 2.2;
      var paint = function () { el.style.setProperty("--halo", (lo + (hi - lo) * (0.5 - 0.5 * Math.cos(st.t / per * Math.PI * 2))).toFixed(4)); };
      paint();
      tl.fromTo(st, { t: 0 }, { t: seconds, duration: seconds, ease: "none", onUpdate: paint, immediateRender: false }, at);
    });
    return tl;
  }

  function playPause(tl, target, at, playing, o) {
    o = o || {};
    RC.q(target).forEach(function (np) {
      var play = np.querySelector(".rc-pp .rc-play"), pause = np.querySelector(".rc-pp .rc-pause"), art = np.querySelector(".rc-art");
      var show = playing ? pause : play, hide = playing ? play : pause;
      RC.press(tl, np.querySelector(".rc-pp"), at, { scale: 0.88 });
      RC.emit("click", at);
      if (hide) tl.to(hide, { opacity: 0, scale: 0.8, duration: 0.14, ease: RC.ease("apple.exit") }, at + 0.03);
      if (show) { tl.to(show, { opacity: 1, duration: 0.15, ease: RC.ease("apple.out") }, at + 0.06); tl.fromTo(show, { scale: 0.8 }, { scale: 1, duration: RC.spring("snappy").duration, ease: RC.ease("snappy"), immediateRender: false }, at + 0.06); }
      // Apple Music: the artwork rests smaller while paused, and grows back when it plays.
      if (art) RC.to(tl, art, at + 0.04, { scale: playing ? 1 : (o.rest || 0.84) }, "default");
    });
    return tl;
  }

  function fmtTime(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }
  function scrubTo(tl, target, at, seconds, from, to, o) {
    o = o || {};
    RC.q(target).forEach(function (sc) {
      var total = o.total || 214, el = RC.q(sc.querySelectorAll(".rc-sc-times > span"));
      var st = { p: from };
      var paint = function () { sc.style.setProperty("--p", st.p); if (el[0]) el[0].textContent = fmtTime(st.p * total); if (el[1]) el[1].textContent = "-" + fmtTime((1 - st.p) * total); };
      if (o.set !== false) paint();
      tl.fromTo(st, { p: from }, { p: to, duration: seconds, ease: o.ease ? RC.ease(o.ease) : "none", onUpdate: paint, immediateRender: false }, at);
    });
    return tl;
  }

  function rectIn(el, scr) {
    var x = 0, y = 0;
    for (var e = el; e && e !== scr; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; }
    return { x: x, y: y, w: el.offsetWidth, h: el.offsetHeight };
  }
  function appOpen(tl, iconT, viewT, at, o) {
    o = o || {};
    var icon = RC.one(iconT), view = RC.one(viewT); if (!icon || !view) return tl;
    var scr = view.offsetParent, r = rectIn(icon, scr), W = view.offsetWidth, H = view.offsetHeight, s = RC.spring("page", view);
    var home = o.home ? RC.one(o.home) : scr.querySelector(".rc-home");
    var sx = r.w / W, sy = r.h / H, rad = 15 * ptOf(icon);
    RC.press(tl, icon, at, { scale: 0.92 });
    RC.emit("whoosh", at + 0.1);
    var t = at + 0.1;
    tl.set(view, { visibility: "visible" }, t);
    tl.fromTo(view, { x: r.x, y: r.y, scaleX: sx, scaleY: sy, borderRadius: rad / Math.min(sx, sy) + "px" },
      { x: 0, y: 0, scaleX: 1, scaleY: 1, borderRadius: (o.radius || 0) + "px", duration: s.duration * 1.2, ease: s.ease, immediateRender: false }, t);
    var cover = view.querySelector(".rc-cover");
    if (cover) tl.to(cover, { opacity: 0, duration: 0.25, ease: RC.ease("apple.out") }, t + 0.12);
    tl.set(icon, { opacity: 0 }, t);
    if (home) { RC.to(tl, home, t, { scale: 1.12 }, "page"); tl.to(home, { opacity: 0.0, duration: 0.3, ease: RC.ease("apple.out") }, t + 0.05); }
    return tl;
  }
  function appClose(tl, iconT, viewT, at, o) {
    o = o || {};
    var icon = RC.one(iconT), view = RC.one(viewT); if (!icon || !view) return tl;
    var scr = view.offsetParent, r = rectIn(icon, scr), W = view.offsetWidth, H = view.offsetHeight, s = RC.spring("page", view);
    var home = o.home ? RC.one(o.home) : scr.querySelector(".rc-home"), sx = r.w / W, sy = r.h / H, rad = 15 * ptOf(icon);
    RC.emit("whoosh", at);
    var cover = view.querySelector(".rc-cover");
    if (cover) tl.to(cover, { opacity: 1, duration: 0.2, ease: RC.ease("apple.out") }, at);
    tl.to(view, { x: r.x, y: r.y, scaleX: sx, scaleY: sy, borderRadius: rad / Math.min(sx, sy) + "px", duration: s.duration * 1.1, ease: s.ease }, at);
    tl.set(icon, { opacity: 1 }, at + s.duration * 0.9);
    tl.set(view, { visibility: "hidden" }, at + s.duration * 0.95);
    if (home) { RC.to(tl, home, at, { scale: 1 }, "page"); tl.to(home, { opacity: 1, duration: 0.3, ease: RC.ease("apple.out") }, at); }
    return tl;
  }

  Object.assign(window.RC, {
    threadSet: threadSet, msgShow: msgShow, msgTyping: msgTyping, compose: compose, evDrag: evDrag,
    mapDraw: mapDraw, routePath: routePath, pinDrop: pinDrop, breathe: breathe, playPause: playPause, scrubTo: scrubTo,
    appOpen: appOpen, appClose: appClose,
  });
})();
