/*
 * iOS surfaces, moving as they do on device (apple-glass › micro-interactions › Surfaces, Lists, Navigation):
 *
 *   RC.notify(tl, note, at, o)              a banner drops from the top on spring.default; o.push = notes to slide down
 *   RC.sheet(tl, sheet, at, detent, o)      "medium" | "large" | "closed" | a top in pt; the scrim follows, and on
 *                                           large the page behind (o.behind) steps back like a card (0.93, rounded)
 *   RC.contextMenu(tl, item, menu, at, o)   touch and hold: the item sinks (0.97 over 0.3 s), lifts, the world blurs,
 *                                           the menu grows from the item's corner on spring.default
 *   RC.menuPick(tl, menu, at, i, o)         row i highlights, the menu leaves (faster than it came), the item settles
 *   RC.alertIn / RC.alertOut(tl, alert, at) fade and zoom 0.95 → 1 in 200 ms over the scrim; out faster
 *   RC.swipe(tl, row, at, o)                the row follows the finger left (rubber-banded), releases onto its actions
 *                                           on a spring; o.remove collapses the row (160 ms) and its neighbours glide up
 *   RC.navPush / RC.navPop(tl, from, to, at)  the iOS push: 380 ms on apple.push, the old page shifts −28% and dims
 */
(function () {
  var RC = window.RC, gsap = window.gsap;
  if (!RC || RC.notify) return;
  function out(el) { return RC.ease("apple.exit"); }

  function notify(tl, target, at, o) {
    o = o || {};
    RC.emit("notify", at);
    RC.q(target).forEach(function (n) {
      var s = RC.spring("default", n);
      tl.fromTo(n, { yPercent: -120, scale: 0.96 }, { yPercent: 0, scale: 1, duration: s.duration * 1.25, ease: s.ease, immediateRender: o.lead !== false }, at);
      tl.fromTo(n, { opacity: 0 }, { opacity: 1, duration: 0.18, ease: RC.ease("apple.out"), immediateRender: o.lead !== false }, at);
    });
    // The notes already there make room: each slides down by the new note's height plus the gap.
    if (o.push) RC.q(o.push).forEach(function (p) { RC.to(tl, p, at + 0.02, { y: "+=" + (o.by || 0) }, "default"); });
    return tl;
  }

  var DETENT = { closed: 874, medium: 437, large: 62 };
  function sheet(tl, target, at, detent, o) {
    o = o || {};
    RC.q(target).forEach(function (sh) {
      var top = typeof detent === "number" ? detent : DETENT[detent] != null ? DETENT[detent] : DETENT.medium;
      var closing = top >= 874;
      RC.emit("sheet", at);
      if (closing) tl.to(sh, { "--sy": top, duration: 0.3, ease: out() }, at);
      else RC.to(tl, sh, at, { "--sy": top }, "default");
      var scrim = o.scrim ? RC.one(o.scrim) : sh.parentNode.querySelector(".rc-scrim");
      if (scrim) tl.to(scrim, { opacity: closing ? 0 : top <= 120 ? 1 : 0.55, duration: closing ? 0.25 : 0.35, ease: RC.ease("apple.out") }, at);
      if (o.behind) {
        var large = top <= 120;
        RC.to(tl, o.behind, at, { scale: large ? 0.93 : 1, y: large ? (o.behindY || 0) : 0, borderRadius: large ? (o.radius || "24px") : "0px" }, "default");
      }
    });
    return tl;
  }

  function contextMenu(tl, itemT, menuT, at, o) {
    o = o || {};
    var item = RC.one(itemT), menu = RC.one(menuT); if (!item || !menu) return tl;
    var back = o.backdrop ? RC.one(o.backdrop) : null;
    // The hold: the item sinks slowly under the finger…
    tl.to(item, { scale: 0.97, duration: 0.3, ease: RC.ease("apple.out") }, at);
    // …then lifts out of the page while the world behind blurs.
    var lift = at + (o.hold || 0.32);
    RC.emit("pop", lift);
    RC.to(tl, item, lift, { scale: o.lift || 1.03, boxShadow: o.shadow || "0 30px 70px -20px rgba(0,0,0,.45)" }, "default");
    if (back) tl.to(back, { opacity: 1, duration: 0.25, ease: RC.ease("apple.out") }, lift);
    gsap.set(menu, { transformOrigin: o.origin || "0% 0%" });
    var s = RC.spring("default", menu);
    tl.fromTo(menu, { scale: 0.6 }, { scale: 1, duration: s.duration, ease: s.ease, immediateRender: false }, lift + 0.03);
    tl.to(menu, { opacity: 1, duration: 0.15, ease: RC.ease("apple.out") }, lift + 0.03);
    menu.__rcItem = item; menu.__rcBack = back;
    return tl;
  }

  function menuPick(tl, menuT, at, i, o) {
    o = o || {};
    var menu = RC.one(menuT); if (!menu) return tl;
    var row = RC.q(menu.querySelectorAll(".rc-cm-row"))[i];
    if (row) {
      var hl = row.querySelector(":scope > i") || row.appendChild(document.createElement("i"));
      tl.to(hl, { opacity: 1, duration: 0.08, ease: RC.ease("apple.out") }, at);
      RC.emit("click", at);
    }
    var leave = at + (o.hold || 0.22);
    tl.to(menu, { opacity: 0, scale: 0.9, duration: 0.2, ease: out() }, leave);
    if (menu.__rcBack) tl.to(menu.__rcBack, { opacity: 0, duration: 0.25, ease: RC.ease("apple.out") }, leave);
    if (menu.__rcItem) RC.to(tl, menu.__rcItem, leave, { scale: 1, boxShadow: "0 0px 0px 0px rgba(0,0,0,0)" }, "default");
    return tl;
  }

  function alertIn(tl, target, at, o) {
    o = o || {};
    RC.q(target).forEach(function (a) {
      RC.emit("pop", at);
      var scrim = o.scrim ? RC.one(o.scrim) : a.parentNode.querySelector(".rc-scrim");
      if (scrim) tl.to(scrim, { opacity: 1, duration: 0.25, ease: RC.ease("apple.out") }, at);
      tl.fromTo(a, { scale: 0.95 }, { scale: 1, duration: 0.2, ease: RC.ease("apple.out"), immediateRender: false }, at);
      tl.to(a, { opacity: 1, duration: 0.2, ease: RC.ease("apple.out") }, at);
    });
    return tl;
  }
  function alertOut(tl, target, at, o) {
    o = o || {};
    RC.q(target).forEach(function (a) {
      var scrim = o.scrim ? RC.one(o.scrim) : a.parentNode.querySelector(".rc-scrim");
      if (scrim) tl.to(scrim, { opacity: 0, duration: 0.2, ease: RC.ease("apple.out") }, at);
      tl.to(a, { opacity: 0, scale: 0.97, duration: 0.15, ease: out() }, at);
    });
    return tl;
  }

  function swipe(tl, target, at, o) {
    o = o || {};
    RC.q(target).forEach(function (row) {
      var cell = row.querySelector(".rc-cell"), acts = row.querySelector(".rc-acts");
      var pt = parseFloat(getComputedStyle(row).getPropertyValue("--pt")) || 1.5;
      var reveal = -(acts ? acts.offsetWidth : 152 * pt), drag = o.drag || 0.45;
      RC.emit("swipe", at);
      // The finger drags past the actions a little (the rubber band), then lets go and the row springs onto them.
      tl.to(cell, { x: reveal * 1.12, duration: drag, ease: RC.ease("apple.glide") }, at);
      RC.to(tl, cell, at + drag, { x: reveal }, "default");
      if (o.remove != null) {
        // Delete: the row slides away, then folds shut; the rows under it glide up because they are in its flow.
        tl.to(cell, { x: -row.offsetWidth, duration: 0.22, ease: out() }, o.remove);
        if (acts) tl.to(acts, { opacity: 0, duration: 0.16, ease: out() }, o.remove + 0.12);
        RC.to(tl, row, o.remove + 0.16, { height: 0 }, "default");
        RC.emit("whoosh", o.remove);
      }
    });
    return tl;
  }

  function push(tl, fromT, toT, at, o) {
    o = o || {};
    var from = RC.one(fromT), to = RC.one(toT); if (!from || !to) return tl;
    var d = o.duration || 0.38, e = RC.ease("apple.push");
    RC.emit("whoosh", at);
    tl.fromTo(to, { xPercent: 100 }, { xPercent: 0, duration: d, ease: e, immediateRender: false }, at);
    tl.set(to, { visibility: "visible" }, at);
    tl.to(from, { xPercent: -28, duration: d, ease: e }, at);
    var dim = from.querySelector(":scope > .rc-dimmer");
    if (dim) tl.to(dim, { opacity: 0.12, duration: d, ease: e }, at);
    // The new page casts a soft shadow on the old one as it slides over it.
    tl.fromTo(to, { boxShadow: "-20px 0 40px rgba(0,0,0,0)" }, { boxShadow: "-20px 0 40px rgba(0,0,0,.12)", duration: d, ease: e, immediateRender: false }, at);
    return tl;
  }
  function pop(tl, fromT, toT, at, o) {
    o = o || {};
    var from = RC.one(fromT), to = RC.one(toT); if (!from || !to) return tl;
    var d = o.duration || 0.34, e = RC.ease("apple.push");
    RC.emit("whoosh", at);
    tl.to(from, { xPercent: 100, duration: d, ease: e }, at);
    tl.to(to, { xPercent: 0, duration: d, ease: e }, at);
    var dim = to.querySelector(":scope > .rc-dimmer");
    if (dim) tl.to(dim, { opacity: 0, duration: d, ease: e }, at);
    return tl;
  }

  Object.assign(window.RC, {
    notify: notify, sheet: sheet, contextMenu: contextMenu, menuPick: menuPick, alertIn: alertIn, alertOut: alertOut,
    swipe: swipe, navPush: push, navPop: pop,
  });
})();
