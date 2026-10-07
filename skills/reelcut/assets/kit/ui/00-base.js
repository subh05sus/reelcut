/*
 * Apple UI, the motion every family in ui/ shares. Loaded after kit.js, so the springs exist.
 *
 *   RC.to(tl, el, at, vars, "default")   a tl.to on one of Apple's springs, with the spring's own length
 *   RC.press(tl, el, at, o)              a press: down on the CSS curve in 80 ms, back up on a snappy spring
 *   RC.present(tl, el, at, o)            something appears: from a little smaller and lower, opacity first
 *   RC.dismiss(tl, el, at, o)            it leaves, faster than it came, accelerating away
 *   RC.stagger(i)                        Apple's list stagger: 40 ms an item, capped at 8 items
 *
 * These are the only motion words a family should need besides the springs themselves: if a component
 * wants a new feel, it picks a different spring, not a new curve.
 */
(function () {
  var RC = window.RC;
  if (!RC || RC.press) return;

  function to(tl, target, at, vars, name) {
    var els = RC.q(target); if (!els.length) return tl;
    var s = RC.spring(name || "default", els[0]);
    tl.to(els, Object.assign({ duration: s.duration, ease: s.ease }, vars), at);
    return tl;
  }

  function press(tl, target, at, o) {
    o = o || {};
    var els = RC.q(target); if (!els.length) return tl;
    var down = o.hold || 0.08;
    tl.to(els, { scale: o.scale || 0.97, duration: 0.08, ease: RC.ease("apple.out") }, at);
    if (o.release !== false) to(tl, els, at + down, { scale: 1 }, "snappy");
    return tl;
  }

  function present(tl, target, at, o) {
    o = o || {};
    var els = RC.q(target); if (!els.length) return tl;
    var name = o.spring || "default";
    els.forEach(function (el, i) {
      var t = at + (o.stagger == null ? 0 : Math.min(i, 8) * o.stagger);
      var s = RC.spring(name, el);
      var from = { scale: o.scale == null ? 0.96 : o.scale, y: o.y == null ? 0 : o.y, x: o.x || 0 };
      tl.fromTo(el, from, { scale: 1, y: 0, x: 0, duration: o.duration || s.duration, ease: s.ease, immediateRender: o.lead !== false }, t);
      // Opacity leads: full within a few frames, so a hard cut never shows an empty frame.
      tl.fromTo(el, { opacity: o.lead ? 0.6 : 0 }, { opacity: 1, duration: o.fade || 0.16, ease: RC.ease("apple.out") }, t);
    });
    return tl;
  }

  function dismiss(tl, target, at, o) {
    o = o || {};
    var els = RC.q(target); if (!els.length) return tl;
    tl.to(els, { opacity: 0, scale: o.scale == null ? 0.96 : o.scale, y: o.y || 0, x: o.x || 0, duration: o.duration || 0.2, ease: RC.ease("apple.exit") }, at);
    return tl;
  }

  function stagger(i, each) { return Math.min(i, 8) * (each == null ? 0.04 : each); }

  Object.assign(window.RC, {
    to: to, press: press, present: present, dismiss: dismiss, stagger: stagger,
  });
})();
