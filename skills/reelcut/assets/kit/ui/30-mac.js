/*
 * macOS Tahoe motion:
 *
 *   RC.macSelect(tl, side, at, i)            the sidebar's selection glides to row i (spring.default); RC.macSelectSet for frame 0
 *   RC.macOpen(tl, win, at, { from })        a window opens out of a Dock icon (or any element) on spring.page
 *   RC.menuOpen(tl, menu, at, { title })     a menu appears under its title (fade + 0.98 → 1, 120 ms); the title fills
 *   RC.menuHover(tl, menu, at, i)            the highlight glides to row i (spring.snappy) and its label turns white
 *   RC.menuChoose(tl, menu, at, i)           the chosen row blinks once, the menu fades, faster than it came
 *   RC.dockSet(dock)                          lay the icons out (52 pt, 8 pt apart, 9 pt padding)
 *   RC.dockHover(tl, dock, cursor, at, pts)  the cursor runs along the Dock and the icons magnify around it
 *   RC.dockBounce(tl, icon, at, o)            the launch bounce: two hops, the second lower, then the running dot
 */
(function () {
  var RC = window.RC, gsap = window.gsap;
  if (!RC || RC.macSelect) return;
  function ptOf(el) { return parseFloat(getComputedStyle(el).getPropertyValue("--pt")) || 1.5; }
  /** Layout position in the frame (offsets up to the look root), so transforms above never enter the arithmetic. */
  function frameXY(el) {
    var x = 0, y = 0;
    for (var e = el; e && !(e.hasAttribute && e.hasAttribute("data-look")); e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; }
    return { x: x, y: y };
  }

  function rows(side) { return RC.q(side.querySelectorAll(".rc-mac-row")); }
  function macSelectSet(target, i) {
    RC.q(target).forEach(function (side) { var r = rows(side)[i], sel = side.querySelector(".rc-mac-sel"); if (r && sel) gsap.set(sel, { y: r.offsetTop }); });
  }
  function macSelect(tl, target, at, i) {
    RC.q(target).forEach(function (side) {
      var r = rows(side)[i], sel = side.querySelector(".rc-mac-sel"); if (!r || !sel) return;
      RC.emit("click", at);
      RC.to(tl, sel, at, { y: r.offsetTop }, "default");
    });
    return tl;
  }

  function macOpen(tl, target, at, o) {
    o = o || {};
    RC.q(target).forEach(function (win) {
      var from = o.from ? RC.one(o.from) : null, origin = "50% 100%";
      if (from) {
        var w = frameXY(win), f = frameXY(from);
        origin = (f.x + from.offsetWidth / 2 - w.x) + "px " + (f.y + from.offsetHeight / 2 - w.y) + "px";
      }
      gsap.set(win, { transformOrigin: origin });
      var s = RC.spring("page", win);
      tl.fromTo(win, { scale: 0.06 }, { scale: 1, duration: s.duration * 1.3, ease: s.ease, immediateRender: o.lead !== false }, at);
      tl.fromTo(win, { opacity: 0 }, { opacity: 1, duration: 0.16, ease: RC.ease("apple.out"), immediateRender: o.lead !== false }, at);
      RC.emit("whoosh", at);
    });
    return tl;
  }

  function menuOpen(tl, target, at, o) {
    o = o || {};
    RC.q(target).forEach(function (menu) {
      if (o.title) tl.to(RC.one(o.title), { backgroundColor: o.fill || "rgba(255,255,255,.22)", duration: 0.06, ease: RC.ease("apple.out") }, at);
      tl.fromTo(menu, { scale: 0.98 }, { scale: 1, duration: 0.12, ease: RC.ease("apple.out"), immediateRender: false }, at);
      tl.to(menu, { opacity: 1, duration: 0.12, ease: RC.ease("apple.out") }, at);
      RC.emit("click", at);
      menu.__rcTitle = o.title ? RC.one(o.title) : null;
    });
    return tl;
  }
  function mmRows(menu) { return RC.q(menu.querySelectorAll(".rc-mm-row")); }
  function menuHover(tl, target, at, i) {
    RC.q(target).forEach(function (menu) {
      var r = mmRows(menu)[i], hl = menu.querySelector(".rc-mm-hl"); if (!r || !hl) return;
      var white = "#ffffff", ink = getComputedStyle(menu).getPropertyValue("--ui-label").trim();
      if (menu.__rcHot != null && mmRows(menu)[menu.__rcHot]) tl.to(mmRows(menu)[menu.__rcHot], { color: ink, duration: 0.1, ease: RC.ease("apple.out") }, at);
      if (menu.__rcHot == null) { tl.set(hl, { y: r.offsetTop }, at); tl.to(hl, { opacity: 1, duration: 0.08, ease: RC.ease("apple.out") }, at); }
      else RC.to(tl, hl, at, { y: r.offsetTop }, "snappy");
      tl.to(r, { color: white, duration: 0.1, ease: RC.ease("apple.out") }, at + 0.04);
      menu.__rcHot = i;
    });
    return tl;
  }
  function menuChoose(tl, target, at, i) {
    RC.q(target).forEach(function (menu) {
      var hl = menu.querySelector(".rc-mm-hl");
      if (i != null && menu.__rcHot !== i) menuHover(tl, menu, at - 0.12, i);
      RC.emit("click", at);
      // The Mac's confirmation: the highlight blinks off and on once.
      if (hl) tl.set(hl, { opacity: 0 }, at).set(hl, { opacity: 1 }, at + 0.07);
      tl.to(menu, { opacity: 0, duration: 0.2, ease: RC.ease("apple.exit") }, at + 0.16);
      if (menu.__rcTitle) tl.to(menu.__rcTitle, { backgroundColor: "rgba(255,255,255,0)", duration: 0.2, ease: RC.ease("apple.out") }, at + 0.16);
    });
    return tl;
  }

  function dockSet(target) {
    RC.q(target).forEach(function (dock) {
      var pt = ptOf(dock), icons = RC.q(dock.querySelectorAll(".rc-dock-icon")), n = icons.length;
      var w = (n * 52 + (n - 1) * 8 + 18) * pt;
      dock.style.width = w + "px";
      icons.forEach(function (ic, i) { ic.style.left = (9 + i * 60) * pt + "px"; });
      dock.__rcDock = { pt: pt, icons: icons, w: w };
    });
  }

  function dockHover(tl, dockT, curT, at, points, o) {
    o = o || {};
    var dock = RC.one(dockT), cur = RC.one(curT); if (!dock) return tl;
    if (!dock.__rcDock) dockSet(dock);
    var D = dock.__rcDock, pt = D.pt, shelf = dock.querySelector(".rc-dock-shelf"), base = frameXY(dock);
    var centers = D.icons.map(function (ic, i) { return base.x + (9 + 26 + i * 60) * pt; });
    var mid = base.x + D.w / 2, M = o.mag || 1.55, sigma = (o.reach || 1.25) * 60 * pt;
    var st = { x: points[0][0], a: 0 };
    var paint = function () {
      var s = centers.map(function (c) { var d = (st.x - c) / sigma; return 1 + (M - 1) * st.a * Math.exp(-d * d); });
      var total = s.reduce(function (acc, k) { return acc + 52 * k * pt; }, 0) + (s.length - 1) * 8 * pt + 18 * pt;
      var left = mid - total / 2, run = left + 9 * pt;
      D.icons.forEach(function (ic, i) {
        var w = 52 * s[i] * pt, c = run + w / 2; run += w + 8 * pt;
        ic.style.transform = "translateX(" + (c - centers[i]).toFixed(2) + "px) scale(" + s[i].toFixed(4) + ")";
      });
      if (shelf) { shelf.style.left = (left - base.x).toFixed(2) + "px"; shelf.style.right = "auto"; shelf.style.width = total.toFixed(2) + "px"; }
    };
    paint();
    if (cur) RC.cursor(tl, cur, at, points);
    // The magnification follows the same hand-like path the cursor takes, so the two never part.
    var t = at;
    points.forEach(function (p, i) {
      if (i === 0 && !p[2]) { tl.set(st, { x: p[0], onComplete: paint }, t); return; }
      tl.to(st, { x: p[0], duration: p[2], ease: RC.ease("apple.glide"), onUpdate: paint }, t);
      t += p[2];
    });
    tl.to(st, { a: 1, duration: 0.22, ease: RC.ease("apple.out"), onUpdate: paint }, at + (o.enter || 0));
    if (o.leave != null) tl.to(st, { a: 0, duration: 0.3, ease: RC.ease("apple.out"), onUpdate: paint }, o.leave);
    return tl;
  }

  function dockBounce(tl, target, at, o) {
    o = o || {};
    RC.q(target).forEach(function (ic) {
      var h = (o.height || 30) * ptOf(ic);
      // Thrown up and falling back like a ball: decelerating up, accelerating down; the second hop lower.
      var inner = ic.querySelector("i") || ic;
      tl.to(inner, { keyframes: [
        { y: -h, duration: 0.3, ease: RC.ease("apple.out") }, { y: 0, duration: 0.26, ease: RC.ease("apple.exit") },
        { y: -h * 0.62, duration: 0.25, ease: RC.ease("apple.out") }, { y: 0, duration: 0.22, ease: RC.ease("apple.exit") },
      ] }, at);
      tl.set(ic, { "--dot": o.dot || "currentColor" }, at + 0.1);
      RC.emit("pop", at);
    });
    return tl;
  }

  Object.assign(window.RC, {
    macSelect: macSelect, macSelectSet: macSelectSet, macOpen: macOpen, menuOpen: menuOpen, menuHover: menuHover, menuChoose: menuChoose,
    dockSet: dockSet, dockHover: dockHover, dockBounce: dockBounce,
  });
})();
