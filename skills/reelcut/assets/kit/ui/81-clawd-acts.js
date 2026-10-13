/*
 * Clawd's acts: what it holds and wears, what it does to the UI, how it answers the voice, its big moments, its minis
 * (subagents) and its egg. Built on 80-clawd.js; everything here is a method of RC.clawd and takes (tl, c, at, o).
 *
 *   RC.clawd.hold(tl, c, at, { prop: "phone" })                 a prop in a hand (props: RC.clawd.PROPS)
 *   RC.clawd.wear(c, "party-hat")  /  RC.clawd.dress(tl, c, at, "crown")   a hat or accessory (RC.clawd.WEARS)
 *   RC.clawd.tap(tl, c, at, { at: "#root .send" })              walks over (or jumps) and presses it
 *   RC.clawd.plug(tl, c, at, { from: "#root .composio", to: "#root .socket" })   carries a cable over and plugs it in
 *   RC.clawd.carry(tl, c, at, { prop: "file", label: "SKILL.md", to: "#root .chat" })   carries it there and drops it in
 *   RC.clawd.type(tl, c, at, { dur: 1.6 })                       types on a laptop
 *   RC.clawd.onWord(tl, c, "Claude", "jump")                    an act on a spoken word; RC.clawd.talk(tl, c, 0, 4) bobs with the voice
 *   RC.clawd.confetti / flag / workout / sign / sleep / wake / react      the big moments
 *   RC.clawd.minis(tl, c, at, { n: 5 })                          subagents: small Clawds run off, work and come back
 *   RC.clawd.hatch(tl, c, at)                                    Clawd hatches out of a pixel egg
 *
 * Props, hats and effects are pixel bitmaps on Clawd's half-unit grid, so they share its pixel and take its material.
 */
(function () {
  var RC = window.RC, gsap = window.gsap;
  if (!RC || !RC.clawd || RC.clawd.hold) return;
  var K = RC.clawd, _ = K._, ORANGE = _.ORANGE;
  var tw = _.tw, set = _.set, busy = _.busy, emit = _.emit, node = _.node, grp = _.grp, bitmap = _.bitmap, keyed = _.keyed;

  /* ------------------------------------------------------------------ props: pixel bitmaps, half a unit a pixel */

  var INK = "#1d1d1f", METAL = "#a1a1a6", WHITE = "#fbfbfd", LINE = "#b4b4ba", RED = "#e5484d", YEL = "#ffd23f", BLUE = "#4c6ef5", GREEN = "#2fb565";
  /*
   * Each prop: its rows, its colours (A and B are the beat's accents, O is Clawd's orange), and `grip`, the pixel the
   * hand closes on (column, row). Props are drawn upright, as if held up to the camera.
   */
  var PROPS = {
    phone: { grip: [4, 9], rows: [".kkkkkk.", "kssssssk", "ksOOOOsk", "kssssssk", "ksllllsk", "kssssssk", "ksllsskk", "kssssssk", "ksllllsk", "kssssssk", "kssssssk", "kkkwwkkk", ".kkkkkk."],
      colors: { k: INK, s: WHITE, O: ORANGE, l: LINE, w: "#6e6e73" } },
    laptop: { grip: [9, 12], rows: ["gggggggggggggggggg", "gddddddddddddddddg", "gdOddddddddddddddg", "gdOOdlllllllddddddg".slice(0, 17) + "g", "gdOddddddddddddddg", "gddddllllllddddddg", "gddddddddddddddddg", "gddlllllllllldddddg".slice(0, 17) + "g", "gddddddddddddddddg", "gggggggggggggggggg", "ssssssssssssssssss", ".ssssssssssssssss."],
      colors: { g: "#3a3a3c", d: "#1c1c1e", O: ORANGE, l: "#8e8e93", s: "#c7c7cc" } },
    plug: { grip: [2.5, 6], rows: [".m..m.", ".m..m.", "pppppp", "pqqqqp", "pppppp", ".pppp.", "..cc..", "..cc.."],
      colors: { m: METAL, p: "#ececf0", q: "#d6d6dc", c: "#2a2a2e" } },
    file: { grip: [4, 12], rows: ["kkkkkk..", "kwwwwkk.", "kwwwwkwk", "kwwwwkkk", "kwOOOOwk", "kwwwwwwk", "kwllllwk", "kwwwwwwk", "kwllllwk", "kwwwwwwk", "kwlllwwk", "kwwwwwwk", "kkkkkkkk"],
      colors: { k: "#3a3a3c", w: WHITE, O: ORANGE, l: LINE } },
    scroll: { grip: [4, 10], rows: [".bbbbbbbb.", "bppppppppb", ".pppppppp.", ".pllllllp.", ".pppppppp.", ".plllllpp.", ".pppppppp.", ".pllllllp.", ".pppppppp.", "bppppppppb", ".bbbbbbbb."],
      colors: { b: "#c9a24a", p: "#f6e7b8", l: "#c4b07a" } },
    calendar: { grip: [4, 10], rows: [".k....k.", "rrrrrrrr", "rrrrrrrr", "wwwwwwww", "wkwkwkww", "wwwwwwww", "wkwkwkwk", "wwwwwwww", "wkwkwOww", "wwwwwwww"],
      colors: { k: INK, r: RED, w: WHITE, O: ORANGE } },
    clock: { grip: [4, 8], rows: ["..kkkk..", ".kwwwwk.", "kwwkwwwk", "kwwkwwwk", "kwwkkkwk", "kwwwwwwk", ".kwwwwk.", "..kkkk.."],
      colors: { k: INK, w: WHITE } },
    coffee: { grip: [3, 8], rows: [".s.s...", "..s.s..", ".s.s...", "wwwww..", "wbbbwww", "wbbbw.w", "wbbbwww", "wbbbw..", ".www..."],
      colors: { s: "#cfcfd4", w: WHITE, b: "#6f4b3e" } },
    dumbbell: { grip: [6, 2], rows: ["pp........pp", "pp........pp", "pppbbbbbbppp", "pp........pp", "pp........pp"],
      colors: { p: "#3d4a8c", b: "#9aa0a6" } },
    puzzle: { grip: [4.5, 10], rows: ["....ppp....", "...ppppp...", "ppppppppp..", "ppppppppp..", "pppppppppp.", "ppppppppppp", "ppppppppppp", "pppppppppp.", "ppppppppp..", "ppppppppp.."],
      colors: { p: "A" } },
    terminal: { grip: [5, 9], rows: ["gggggggggg", "grgygGgggg", "dddddddddd", "dOdddddddd", "ddOddddddd", "dOddwwwddd", "dddddddddd", "dddddddddd", "gggggggggg"],
      colors: { g: "#3a3a3c", r: RED, y: YEL, G: GREEN, d: "#1c1c1e", O: ORANGE, w: "#e5e5ea" } },
    key: { grip: [2, 2], rows: [".yyy......", "y...y.....", "y...yyyyyy", "y...y..y.y", ".yyy......"], colors: { y: YEL } },
    gear: { grip: [4, 4], rows: ["...kk...", ".k.kk.k.", "..kkkk..", "kkk..kkk", "kkk..kkk", "..kkkk..", ".k.kk.k.", "...kk..."], colors: { k: "#8e8e93" } },
    lightbulb: { grip: [3, 9], rows: [".yyyy.", "yyyyyy", "yyWyyy", "yyyyyy", ".yyyy.", "..yy..", ".gggg.", ".gggg.", "..gg.."], colors: { y: YEL, W: "#fffbe6", g: "#8e8e93" } },
    rocket: { grip: [3, 10], rows: ["..rr..", ".rwwr.", ".wwww.", ".wbbw.", ".wbbw.", ".wwww.", "rwwwwr", "rrwwrr", "r.oo.r", "..yy..", "...y.."],
      colors: { r: RED, w: WHITE, b: BLUE, o: "#ff8a3d", y: YEL } },
    trophy: { grip: [4, 9], rows: ["yyyyyyyy", "yyyyyyyy", "yyyyyyyy", ".yyyyyy.", "..yyyy..", "...yy...", "...yy...", "..bbbb..", ".bbbbbb."], colors: { y: YEL, b: "#8a6d3b" } },
    envelope: { grip: [4.5, 7], rows: ["kkkkkkkkk", "kwkwwwkwk", "kwwkwkwwk", "kwwwkwwwk", "kwwwwwwwk", "kwwwwwwwk", "kkkkkkkkk"], colors: { k: INK, w: WHITE } },
    star: { grip: [3.5, 6], rows: ["...y...", "...y...", "..yyy..", "yyyyyyy", ".yyyyy.", "..y.y..", ".y...y."], colors: { y: YEL } },
    check: { grip: [3.5, 7], rows: [".gggggg.", "gggggggg", "ggggggwg", "gggggwgg", "gwgwwggg", "ggwwgggg", "gggggggg", ".gggggg."], colors: { g: GREEN, w: WHITE } },
    heart: { grip: [3.5, 6], rows: [".rr.rr.", "rrrrrrr", "rrrrrrr", ".rrrrr.", "..rrr..", "...r..."], colors: { r: RED } },
    gift: { grip: [4, 9], rows: ["..y..y..", "...yy...", "rrryyrrr", "rrryyrrr", "rrryyrrr", "rrryyrrr", "rrryyrrr", "rrryyrrr"], colors: { r: RED, y: YEL } },
    magnifier: { grip: [7, 8], rows: [".kkkk...", "kwwwwk..", "kwwwwk..", "kwwwwk..", ".kkkk...", ".....b..", "......b.", ".......b"], colors: { k: INK, w: "#d7ecff", b: "#8a6d3b" } },
    wrench: { grip: [2, 7], rows: ["mm.mm", "mm.mm", "mmmmm", ".mmm.", "..m..", "..m..", "..m..", "..m..", ".mmm."], colors: { m: "#8e8e93" } },
    pencil: { grip: [1.5, 8], rows: [".pp", ".pp", ".mm", ".yy", ".yy", ".yy", ".yy", ".yy", ".ww", "..k"], colors: { k: INK, y: YEL, w: "#e8c39e", p: "#ff8fa3", m: METAL } },
    box: { grip: [4, 8], rows: ["bbbbbbbb", "bbbttbbb", "bbbttbbb", "dddddddd", "bbbbbbbb", "bbbbbbbb", "bbbbbbbb", "bbbbbbbb"], colors: { b: "#c99a63", d: "#a87b4a", t: "#efe2c2" } },
    folder: { grip: [4.5, 7], rows: ["yyyy.....", "yyyyyyyyy", "ybbbbbbby", "ybbbbbbby", "ybbbbbbby", "ybbbbbbby", "yyyyyyyyy"], colors: { y: "#f2b83b", b: "#ffd36b" } },
    bolt: { grip: [3, 6], rows: ["...yy", "..yy.", ".yyy.", "yyyyy", "..yy.", ".yy..", "yy..."], colors: { y: YEL } },
    megaphone: { grip: [2, 5], rows: ["......w", ".....ww", "kk.wwww", "kkwwwww", "kk.wwww", ".....ww", "......w"], colors: { k: INK, w: "A" } },
  };
  // Which props are held up in front (both hands, at the chest) rather than in one hand at the side.
  var TWO_HANDED = { laptop: 1, dumbbell: 1, box: 1, gift: 1 };

  function colorsFor(c, colors) {
    var cs = getComputedStyle(c.tokens.root), out = {};
    var acc = (cs.getPropertyValue("--accent") || "").trim() || ORANGE, acc2 = (cs.getPropertyValue("--accent-2") || "").trim() || BLUE;
    for (var k in colors) out[k] = colors[k] === "A" ? acc : colors[k] === "B" ? acc2 : colors[k];
    out.O = ORANGE;
    return out;
  }
  /** Draw a prop into `parent` with its grip at (0, 0); returns its group. `scale` multiplies the half-unit pixel. */
  function drawProp(c, parent, name, o) {
    var P = PROPS[name]; if (!P) throw new Error("RC.clawd: no prop " + name + " (" + Object.keys(PROPS).join(", ") + ")");
    o = o || {};
    var cell = 0.5 * (o.scale || 1), g = grp("cw-prop cw-prop-" + name, parent);
    var inner = bitmap(g, P.rows, colorsFor(c, P.colors), cell, -P.grip[0] * cell, -P.grip[1] * cell);
    if (o.label) _.label(g, [String(o.label)], (P.rows[0].length / 2 - P.grip[0]) * cell, (P.rows.length - P.grip[1]) * cell + 0.9, 1.05, { mono: true, fill: c.tokens.ink });
    return g;
  }

  /* ------------------------------------------------------------------ wearing: hats and accessories */

  // Hats sit on the body's top edge (y = 0), centred on x = 5 unless they say otherwise; `at` is their top-left in units.
  var WEARS = {
    "party-hat": { at: [5.6, -5], tilt: 10, rows: ["....y....", "...yyy...", "....a....", "...aaa...", "...bbb...", "..aaaaa..", "..bbbbb..", ".aaaaaaa.", ".bbbbbbb.", "aaaaaaaaa"], colors: { y: YEL, a: "A", b: "B" } },
    santa: { at: [2.4, -3.5], tilt: 0, rows: ["...........ww", "........rrrww", ".....rrrrrr..", "...rrrrrrrr..", "..rrrrrrrrr..", "wwwwwwwwwwwww", "wwwwwwwwwwwww"], colors: { r: RED, w: "#fff" } },
    crown: { at: [2.75, -2.5], rows: ["y...y...y", "yy.yyy.yy", "yyyyyyyyy", "yryybyyry", "yyyyyyyyy"], colors: { y: YEL, r: RED, b: BLUE } },
    cap: { at: [2.5, -2.5], rows: ["...aaaaa......", "..aaaaaaa.....", ".aaaaaaaaa....", ".aaaaaaaaaaaaa", ".kkkkkkkkk...."], colors: { a: "A", k: "#00000033" } },
    beanie: { at: [2.25, -3], rows: ["....yyy....", "..aaaaaaa..", ".aaaaaaaaa.", "aaaaaaaaaaa", "bbbbbbbbbbb", "bbbbbbbbbbb"], colors: { y: "#fff", a: "A", b: "B" } },
    wizard: { at: [2.5, -6.5], tilt: -6, rows: [".....p.....", "....ppp....", "....ppp....", "...ppypp...", "...ppppp...", "..ppppppp..", "..pppyppp..", ".ppppppppp.", ".ppppppppp.", "ppppppppppp", "kkkkkkkkkkk", ".kkkkkkkkk."], colors: { p: "#6d4bd8", y: YEL, k: "#3b2a7a" } },
    chef: { at: [2.5, -5], rows: ["..www.www..", ".wwwwwwwww.", "wwwwwwwwwww", "wwwwwwwwwww", ".wwwwwwwww.", "..wwwwwww..", "..wwwwwww..", "..lllllll..", "..wwwwwww.."], colors: { w: "#fff", l: "#e5e5ea" } },
    "grad-cap": { at: [1.75, -3], rows: [".....kkkkk.....", "kkkkkkkkkkkkkkk", "..kkkkkkkkkkk.y", "....kkkkkkk...y", "....kkkkkkk...y"], colors: { k: "#1d1d1f", y: YEL } },
    "hard-hat": { at: [2.25, -3], rows: ["....yyy....", "..yyyyyyy..", ".yyyyyyyyy.", ".yyyyyyyyy.", "yyyyyyyyyyy", "ddddddddddd"], colors: { y: "#ffc83d", d: "#e0a92a" } },
    headset: { at: [0.25, -1.5], rows: ["...kkkkkkkkkkkk...", "..k............k..", ".k..............k.", "kk..............kk", "kk..............kk", "kk..............kk", "kk..............kk", ".k..............k.", ".k..............k.", "..kkk............."], colors: { k: "#2a2a2e" } },
    shades: { at: [1.5, 0.75], face: true, rows: ["kkkkkkkkkkkkkk", "kkkkkk..kkkkkk", "kwkkkk..kwkkkk", ".kkkk....kkkk."], colors: { k: "#111", w: "#666" } },
    bow: { at: [3.6, -1.5], rows: ["pp...pp", "pppkppp", "pppkppp", "pp...pp"], colors: { p: "#ff69b4", k: "#ff1493" } },
    bandana: { at: [1, 4.5], front: true, rows: ["bbbbbbbbbbbbbbbb", ".bbbbbbbbbbbbbb.", "...bbbbbbbbbb...", ".....bbbbbb.....", ".......bb......."], colors: { b: "#2e86ab" } },
    badge: { at: [6.5, 3], front: true, rows: [".rr.", "rRRr", "rRRr", ".rr."], colors: { r: "#e63946", R: "#ff6b6b" } },
    star: { at: [6.4, 2.6], front: true, rows: ["..y..", ".yyy.", "yyyyy", ".y.y."], colors: { y: "#ffd700" } },
    flower: { at: [6.5, -2], rows: [".p.", "pyp", ".p.", ".g.", ".g."], colors: { p: "#ff69b4", y: "#ffd700", g: "#2a9d8f" } },
    leaf: { at: [4.5, -2.5], rows: ["..gg", ".ggg", "ggg.", ".d..", ".d.."], colors: { g: "#2a9d8f", d: "#1d6b5f" } },
    heart: { at: [6.5, 3], front: true, rows: ["r.r", "rrr", ".r."], colors: { r: "#e63946" } },
    ribbon: { at: [4, -1.5], rows: ["pp..pp", ".pppp.", "pp..pp"], colors: { p: "#9b5de5" } },
    blush: { at: [1.5, 2.5], face: true, rows: ["pp..........pp"], colors: { p: "#ffb4b4" }, opacity: 0.8 },
    antenna: { at: [4.5, -2.5], rows: ["..y", "..o", ".o.", ".o.", "o.."], colors: { y: "#ffd700", o: ORANGE } },
  };
  function drawWear(c, name) {
    var W = WEARS[name]; if (!W) throw new Error("RC.clawd: nothing to wear called " + name + " (" + Object.keys(WEARS).join(", ") + ")");
    var parent = W.face ? c.p.glance : W.front ? c.p.front : c.p.top;
    var g = bitmap(parent, W.rows, colorsFor(c, W.colors), 0.5, W.at[0], W.at[1], "cw-wear cw-wear-" + name);
    if (W.tilt) g.setAttribute("transform", "rotate(" + W.tilt + " " + (W.at[0] + W.rows[0].length * 0.25) + " " + (W.at[1] + W.rows.length * 0.5) + ")");
    if (W.opacity) g.setAttribute("opacity", W.opacity);
    (c.worn = c.worn || {})[name] = g;
    return g;
  }
  /** Wear something from the start. */
  function wear(c, name) { drawWear(c, name); return c; }
  /** Put something on at `at`: it drops on in three held frames. */
  function dress(tl, c, at, name) {
    var g = drawWear(c, name), W = WEARS[name];
    var cx = W.at[0] + W.rows[0].length * 0.25, cy = W.at[1] + W.rows.length * 0.5;
    gsap.set(g, { opacity: 0, svgOrigin: cx + " " + cy });
    set(tl, g, { opacity: W.opacity || 1, y: -1.2, scale: 1.15 }, at);
    set(tl, g, { y: 0.2, scale: 0.95 }, at + 0.05);
    set(tl, g, { y: 0, scale: 1 }, at + 0.1);
    emit("pop", at, c);
    return tl;
  }
  function undress(tl, c, at, name) {
    var g = c.worn && c.worn[name]; if (!g) return tl;
    set(tl, g, { opacity: 0 }, at);
    return tl;
  }

  /* ------------------------------------------------------------------ holding */

  /** Where a hand is, in the layer's px, at the moment the timeline is at `t` (the timeline is probed, then rewound). */
  function handAt(tl, c, side, t) {
    var was = tl.time();
    tl.time(t, true);
    var m = c.p.hand[side].getCTM(), p = { x: m.e, y: m.f };
    tl.time(was, true);
    return p;
  }
  /**
   * Put a prop in a hand. `prop` (a name in RC.clawd.PROPS), `hand` "l" / "r" (default: the right; both for a laptop or a
   * dumbbell), `pose` for the arm ("hold", "up", "high", "front"…), `label` (text under it, e.g. "SKILL.md"), `scale`.
   */
  function hold(tl, c, at, o) {
    o = typeof o === "string" ? { prop: o } : (o || {});
    var side = o.hand || "r", two = TWO_HANDED[o.prop];
    // A two-handed prop is held low in front, smaller, so the eyes stay clear above it.
    var g = drawProp(c, c.p.hand[side], o.prop, Object.assign({ scale: two ? (o.prop === "laptop" ? 0.58 : 0.75) : 1 }, o));
    if (c.skinFilter) g.setAttribute("filter", c.skinFilter);
    gsap.set(g, { svgOrigin: "0 0", opacity: 0, y: two ? 0 : -0.9, x: two ? (side === "r" ? -3.9 : 3.9) : 0 });
    set(tl, g, { opacity: 1 }, at);
    if (o.pose !== false) {
      if (two) K.arms(tl, c, at, { l: { x: 0.6, y: 3.2, r: 0 }, r: { x: -0.6, y: 3.2, r: 0 }, dur: 0.14 });
      else K.arms(tl, c, at, keyed(side, o.pose || "hold", { dur: 0.14 }));
    }
    (c.held = c.held || {})[side] = { el: g, prop: o.prop };
    emit("pop", at, c);
    return g;
  }
  /** Let go: the prop just goes (`to` an element: it flies there in an arc and shrinks into it). */
  function drop(tl, c, at, o) {
    o = o || {};
    var side = o.hand || (c.held && c.held.r ? "r" : "l"), h = c.held && c.held[side];
    if (!h) return tl;
    var target = o.to && _.pointOf(c, o.to);
    set(tl, h.el, { opacity: 0 }, at);
    if (target) {
      var from = handAt(tl, c, side, at), fly = grp("cw-fly", c.el);
      drawProp(c, grp("", fly, { transform: "scale(" + c.u + ")" }), h.prop, { label: o.label });
      gsap.set(fly, { svgOrigin: "0 0", x: from.x, y: from.y, opacity: 0 });
      // The arc peaks above both ends, but never higher than the content region's top (336 on the kit's grid), so a
      // thrown prop never crosses the headline.
      var dur = o.dur || 0.42, peak = Math.max(Math.min(336 + c.u, Math.min(from.y, target.y)), Math.min(from.y, target.y) - c.u * 3);
      set(tl, fly, { opacity: 1 }, at);
      tw(tl, fly, { x: from.x }, { x: target.x }, at, dur, "power1.inOut");
      tw(tl, fly, { y: from.y }, { y: peak }, at, dur * 0.45, "sine.out");
      tw(tl, fly, { y: peak }, { y: target.y }, at + dur * 0.45, dur * 0.55, "power2.in");
      tw(tl, fly, { scale: 1, rotation: 0 }, { scale: 0.35, rotation: 90 }, at + dur * 0.3, dur * 0.7, "power2.in");
      set(tl, fly, { opacity: 0 }, at + dur);
      var tg = RC.one(o.to);
      if (tg && o.pulse !== false) { tw(tl, tg, { scale: 1 }, { scale: 1.035 }, at + dur, 0.08, "power2.out"); tw(tl, tg, { scale: 1.035 }, { scale: 1 }, at + dur + 0.08, 0.3, "power2.out"); }
      emit("drop", at + dur, c);
      c.marks.drop = at + dur;
    }
    if (o.pose !== false) K.arms(tl, c, at, keyed(side, "down", { dur: 0.18, ease: "power2.inOut" }));
    if (TWO_HANDED[h.prop]) K.arms(tl, c, at, { l: "down", r: "down", dur: 0.18 });
    c.held[side] = null;
    return tl;
  }
  /** Carry a prop to a target and drop it in: picks it up, walks (or hops) beside it, and tosses it in. */
  function carry(tl, c, at, o) {
    o = o || {};
    var side = o.hand || "r";
    hold(tl, c, at, { prop: o.prop || "file", hand: side, pose: "high", label: o.label });
    var p = _.pointOf(c, o.to), t = at + 0.2;
    if (p) {
      var stand = p.x + (p.x < c.s.x ? 1 : -1) * (o.gap || c.size * 0.95);
      stand = Math.max(c.size * 0.55, Math.min(c.W - c.size * 0.55, stand));
      if (Math.abs(stand - c.s.x) > 4) { K.walk(tl, c, t, { to: stand }); t = c.free; }
      K.look(tl, c, t, { at: o.to, lean: false, dur: 0.2 });
    }
    drop(tl, c, t + 0.12, { hand: side, to: o.to, label: o.label });
    busy(c, "move", at, t + 0.6);
    return tl;
  }

  /* ------------------------------------------------------------------ acting on the UI */

  /** Press an element: `tl.to` its scale down and back, Apple's press. */
  function press(tl, el, at) {
    tw(tl, el, { scale: 1 }, { scale: 0.95 }, at, 0.08, "power2.out");
    tw(tl, el, { scale: 0.95 }, { scale: 1 }, at + 0.08, RC.spring("snappy", el).duration, RC.ease("snappy", el));
  }
  /**
   * Tap an element: walks beside it, reaches with the near hand and presses it. Out of reach above, it jumps and taps at
   * the top of the jump (like a block in a platformer). `walk: false` to tap from where it stands. `then`: an act after.
   */
  function tap(tl, c, at, o) {
    o = o || {};
    var p = _.pointOf(c, o.at); if (!p) return tl;
    var side = p.x < c.s.x ? "l" : "r", m = side === "l" ? -1 : 1, t = at;
    if (o.walk !== false) {
      var stand = p.x - m * (c.u * 5.6 + (p.w || 0) * 0.15);
      stand = Math.max(c.size * 0.5, Math.min(c.W - c.size * 0.5, stand));
      if (Math.abs(stand - c.s.x) > c.u * 0.8) { K.walk(tl, c, t, { to: stand }); t = c.free; }
    }
    var reachY = (p.y - (c.s.y - 5 * c.u)) / c.u;          // arm offset that puts the hand at the target's height
    var tgt = RC.one(o.at);
    if (reachY < -3.4) {
      // Out of reach: jump so the raised hand meets it at the top of the arc.
      var h = Math.min(14, -reachY - 3.4 + 0.4);
      K.arms(tl, c, t, keyed(side, { x: 0.5 * m, y: -3.4, r: 0 }, { dur: 0.1 }));
      K.hop(tl, c, t + 0.02, { height: h, air: 0.38 + h * 0.025 });
      var apex = t + 0.12 + (0.38 + h * 0.025) * 0.5;
      if (tgt) press(tl, tgt, apex);
      emit("tap", apex, c);
      c.marks.tap = apex;
      K.arms(tl, c, c.free - 0.2, keyed(side, "down", { dur: 0.16 }));
    } else {
      var dy = Math.max(-3.4, Math.min(1, reachY));
      K.look(tl, c, t, { at: o.at, lean: false, dur: 0.16 });
      K.arms(tl, c, t, keyed(side, { x: 1.1 * m, y: dy, r: 0 }, { dur: 0.14 }));
      K.arms(tl, c, t + 0.16, keyed(side, { x: 1.5 * m, y: dy, r: 0 }, { dur: 0.07, ease: "power2.in" }));
      if (tgt) press(tl, tgt, t + 0.23);
      emit("tap", t + 0.23, c);
      c.marks.tap = t + 0.23;
      K.arms(tl, c, t + 0.31, keyed(side, { x: 1.1 * m, y: dy, r: 0 }, { dur: 0.1 }));
      K.arms(tl, c, t + 0.55, keyed(side, "down", { dur: 0.18, ease: "power2.inOut" }));
      busy(c, "arms", t, t + 0.75);
    }
    if (o.then) K[o.then](tl, c, c.free + 0.05, o.thenOptions || {});
    return tl;
  }

  /**
   * Plug a connector in: Clawd holds a plug on a cable that runs from `from` (an element or [x, y]: the service being
   * connected), walks to `to` (the socket: the app), and pushes it in. A spark, the target pulses, and the cable stays.
   */
  function plug(tl, c, at, o) {
    o = o || {};
    // The cable leaves the service from its lower edge, so it never crosses its name.
    var A = _.pointOf(c, o.from) || { x: c.s.x - c.size, y: c.s.y - c.u * 2 }, B = _.pointOf(c, o.to);
    if (A.h) A = { x: A.x, y: A.top + A.h };
    var side = B && B.x < c.s.x ? "l" : "r", m = side === "l" ? -1 : 1;
    var cable = node("path", { "class": "cw-cable", fill: "none", stroke: o.color || "#2a2a2e", "stroke-width": c.u * 0.32, "stroke-linecap": "round", opacity: 0 }, c.el);
    c.el.insertBefore(cable, c.el.firstChild.nextSibling);
    var g = hold(tl, c, at, { prop: "plug", hand: side, pose: "hold" });
    gsap.set(g, { rotation: 90 * m, y: -0.4 });
    set(tl, cable, { opacity: 1 }, at);
    var t = at + 0.18;
    if (B) {
      var stand = B.x - m * c.u * 6.4;
      stand = Math.max(c.size * 0.5, Math.min(c.W - c.size * 0.5, stand));
      if (Math.abs(stand - c.s.x) > 4) { K.walk(tl, c, t, { to: stand }); t = c.free; }
      var reachY = Math.max(-3, Math.min(1, (B.y - (c.s.y - 5 * c.u)) / c.u));
      K.look(tl, c, t, { at: o.to, lean: false, dur: 0.16 });
      K.arms(tl, c, t, keyed(side, { x: 1.2 * m, y: reachY, r: 0 }, { dur: 0.16 }));
      K.arms(tl, c, t + 0.2, keyed(side, { x: 1.9 * m, y: reachY, r: 0 }, { dur: 0.08, ease: "power2.in" }));
    }
    var tIn = t + 0.28;
    // The cable: a sagging curve from A to the plug, recomputed every frame from where the hand is (seek-safe: a pure
    // function of the timeline's state), then fixed at the socket once the plug is in.
    var end = B ? handAt(tl, c, side, tIn) : null;
    var proxy = { k: 0 };
    var draw = function () {
      var h = proxy.k >= 1 && end ? end : (function () { var mm = c.p.hand[side].getCTM(); return { x: mm.e, y: mm.f }; })();
      var sag = Math.min(c.u * 4, Math.abs(h.x - A.x) * 0.25 + c.u);
      cable.setAttribute("d", "M" + A.x + " " + A.y + " C" + A.x + " " + (A.y + sag) + " " + h.x + " " + (h.y + sag) + " " + h.x + " " + h.y);
    };
    tl.fromTo(proxy, { k: 0 }, { k: 1, duration: Math.max(0.01, tIn - at), ease: "none", immediateRender: false, onUpdate: draw, onComplete: draw, onReverseComplete: draw }, at);
    if (B) {
      var tgt = RC.one(o.to);
      if (tgt) press(tl, tgt, tIn);
      K.sparkles(tl, c, tIn, { n: 4, radius: 3 });
      emit("plug", tIn, c);
      c.marks.plug = tIn;
      // Let go: the plug stays in the socket; Clawd steps back happy.
      var stay = grp("cw-plugged", c.el);
      drawProp(c, grp("", stay, { transform: "scale(" + c.u + ")" }), "plug");
      gsap.set(stay, { svgOrigin: "0 0", x: end.x, y: end.y - 0.4 * c.u, rotation: 90 * m, opacity: 0 });
      set(tl, stay, { opacity: 1 }, tIn + 0.2);
      set(tl, g, { opacity: 0 }, tIn + 0.2);
      c.held[side] = null;
      K.arms(tl, c, tIn + 0.2, keyed(side, "down", { dur: 0.18 }));
      K.face(tl, c, tIn + 0.2, "happy");
      K.face(tl, c, tIn + 1.0, "open");
      busy(c, "move", at, tIn + 0.4);
    }
    return tl;
  }

  /**
   * Work on a laptop held low in front: eyes down and focused, the hands tapping in turn (a keystroke every .09 s),
   * for `dur` seconds (default 1.6). `after`: the eyes it ends with.
   */
  function type(tl, c, at, o) {
    o = o || {};
    var dur = o.dur || 1.6;
    if (!(c.held && (c.held.r || c.held.l))) hold(tl, c, at, { prop: "laptop", hand: "r" });
    K.face(tl, c, at, "squint");
    K.gaze(tl, c, at, 0, 0.35, 0.12);
    var t = at + 0.16, i = 0;
    for (; t < at + dur; t += 0.09, i++) {
      var side = i % 2 ? "l" : "r";
      tw(tl, c.p.arm[side], { y: 3.2 }, { y: 3.55 }, t, 0.045, "power2.in");
      tw(tl, c.p.arm[side], { y: 3.55 }, { y: 3.2 }, t + 0.045, 0.045, "power2.out");
      if (i % 2 === 0) emit("key", t, c);
    }
    K.face(tl, c, at + dur, o.after || "open");
    K.gaze(tl, c, at + dur, 0, 0, 0.12);
    busy(c, "arms", at, at + dur);
    return tl;
  }

  /* ------------------------------------------------------------------ the voice */

  /** Do an act when the voiceover says `word` (fallback: `o.fallback` s when there is no voiceover). */
  function onWord(tl, c, word, act, o) {
    o = o || {};
    var at = RC.word(word, o.nth, o.fallback != null ? o.fallback : c.free);
    if (!K[act]) throw new Error("RC.clawd.onWord: no act " + act);
    return act === "face" ? K.face(tl, c, at, o.expr || "happy") : K[act](tl, c, at, o);
  }
  /** Bob with the voice from `from` to `to`: the body lifts on loud syllables and a hand gestures on the peaks. */
  function talk(tl, c, from, to, o) {
    o = o || {};
    var step = 1 / 30, n = Math.max(1, Math.round((to - from) / step)), frames = [], peaks = 0, lastPeak = -1;
    for (var i = 0; i <= n; i++) {
      var v = RC.voice(from + i * step);
      frames.push({ y: -(o.amount || 0.35) * v, duration: step, ease: "none" });
      if (v > 0.62 && from + i * step - lastPeak > 0.7 && peaks < 6) { lastPeak = from + i * step; peaks++; K.arms(tl, c, lastPeak, keyed(peaks % 2 ? "r" : "l", { x: (peaks % 2 ? 0.4 : -0.4), y: -1.2, r: 0 }, { dur: 0.12 })); K.arms(tl, c, lastPeak + 0.32, keyed(peaks % 2 ? "r" : "l", "down", { dur: 0.16 })); }
    }
    tl.to(c.p.breath, { keyframes: frames, immediateRender: false }, from);
    return tl;
  }
  /** Eyes follow a cursor path given as RC.cursor's points: [[x, y, seconds], …] from `at`. */
  function follow(tl, c, at, points) {
    var t = at;
    points.forEach(function (p, i) {
      t += p[2] || 0;
      var hd = _.headOf(c), dx = p[0] - hd.x, dy = p[1] - hd.y, len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      K.gaze(tl, c, i ? t - (p[2] || 0) * 0.5 : t, 0.5 * dx / len, 0.4 * dy / len, Math.max(0.1, (p[2] || 0.2) * 0.5));
    });
    return tl;
  }
  /** A nod (yes) or two. */
  function nod(tl, c, at, o) {
    var n = (o && o.times) || 2, t = at;
    for (var i = 0; i < n; i++) { _.torso(tl, c, t, { y: 0.45 }, 0.09, "power2.out"); _.torso(tl, c, t + 0.09, { y: 0 }, 0.13, "power2.inOut"); t += 0.24; }
    K.gaze(tl, c, at, c.s.gx, 0.25, 0.08); K.gaze(tl, c, t, c.s.gx, 0, 0.12);
    return tl;
  }
  /** A shake (no). */
  function shake(tl, c, at, o) {
    var n = (o && o.times) || 2, t = at;
    for (var i = 0; i < n; i++) { K.gaze(tl, c, t, -0.45, 0, 0.08); K.gaze(tl, c, t + 0.12, 0.45, 0, 0.1); t += 0.24; }
    K.gaze(tl, c, t, 0, 0, 0.1);
    return tl;
  }

  /* ------------------------------------------------------------------ big moments */

  var CONFETTI_COLORS = ["#d97757", "#ffd23f", "#4c6ef5", "#2fb565", "#e5484d", "#b46bff", "#20c5d6"];
  /** A burst of pixel confetti from (x, y) units around the feet, rising and falling, flipping in held frames. */
  function burst(tl, c, at, x, y, o) {
    o = o || {};
    var rnd = RC.rand(o.seed || c.seed + 101), n = o.n || 22, dir = o.dir || 0;
    var cs = getComputedStyle(c.tokens.root), palette = (o.colors || CONFETTI_COLORS).concat([(cs.getPropertyValue("--accent") || "").trim() || ORANGE]);
    for (var i = 0; i < n; i++) {
      var col = palette[Math.floor(rnd() * palette.length)], sz = rnd() > 0.7 ? 0.5 : 0.36;
      var g = _.sprite(c, rnd() > 0.5 ? ["c"] : ["cc"], { c: col }, x, y, sz);
      var vx = (rnd() - 0.5) * 9 + dir * 3, up = 4 + rnd() * 6, life = 0.9 + rnd() * 0.6, t = at + rnd() * 0.08;
      set(tl, g, { scale: 1 }, t);
      tw(tl, g, { x: x }, { x: x + vx }, t, life, "power1.out");
      tw(tl, g, { y: y }, { y: y - up }, t, life * 0.4, "power2.out");
      tw(tl, g, { y: y - up }, { y: y - up + 9 + rnd() * 4 }, t + life * 0.4, life * 0.6, "power2.in");
      for (var f = 0; f < life / 0.12; f++) set(tl, g, { rotation: (f % 4) * 90, scaleY: f % 2 ? 0.5 : 1 }, t + f * 0.12);
      tw(tl, g, { opacity: 1 }, { opacity: 0 }, t + life * 0.75, life * 0.25, "none");
    }
    emit("confetti", at, c);
    return tl;
  }
  /**
   * The confetti stomp (Anthropic's "Confetti Claude"): eight held poses, .125 s each, tilting left and right with a
   * hand thrown up, and a burst of confetti from the raised hand on the first and the sixth. `cycles` (default 2).
   */
  function confetti(tl, c, at, o) {
    o = o || {};
    var F = o.frame || 0.125, cycles = o.cycles || 2, was = c.s.expr;
    var poses = [
      { r: -6, l: "high", rr: "down", lg: [-0.5, 0, 0, 0] }, { r: -3, l: "cheer", rr: "cheer", lg: [0, 0, 0, 0] },
      { r: 0, l: "down", rr: "down", lg: [0, 0, 0, 0] }, { r: 3, l: "cheer", rr: "cheer", lg: [0, 0, 0, 0] },
      { r: 6, l: "down", rr: "high", lg: [0, 0, 0, -0.5] }, { r: 3, l: "cheer", rr: "cheer", lg: [0, 0, 0, 0] },
      { r: 0, l: "down", rr: "down", lg: [0, 0, 0, 0] }, { r: -3, l: "cheer", rr: "cheer", lg: [0, 0, 0, 0] },
    ];
    K.face(tl, c, at, "happy");
    for (var cy = 0; cy < cycles; cy++) {
      poses.forEach(function (p, i) {
        var t = at + (cy * 8 + i) * F;
        set(tl, c.p.torso, { rotation: p.r, y: Math.abs(p.r) > 4 ? 0.3 : 0 }, t);
        var al = _.armPose("l", p.l), ar = _.armPose("r", p.rr);
        set(tl, c.p.arm.l, { x: al.x, y: al.y, rotation: al.r }, t);
        set(tl, c.p.arm.r, { x: ar.x, y: ar.y, rotation: ar.r }, t);
        p.lg.forEach(function (y, k) { set(tl, c.p.legs[k], { y: y }, t); });
        if (i === 0 || i === 4) emit("stomp", t, c);
      });
      if (o.burst !== false) {
        burst(tl, c, at + (cy * 8 + 1) * F, -4.6, -9, { dir: -0.6, seed: c.seed + cy * 17 });
        burst(tl, c, at + (cy * 8 + 5) * F, 4.6, -9, { dir: 0.6, seed: c.seed + cy * 17 + 9 });
      }
    }
    var end = at + cycles * 8 * F;
    set(tl, c.p.torso, { rotation: 0, y: 0 }, end);
    set(tl, [c.p.arm.l, c.p.arm.r], { x: 0, y: 0, rotation: 0 }, end);
    set(tl, c.p.legs, { y: 0 }, end);
    c.s.tr = 0; c.s.ty = 0; c.s.arms = { l: { x: 0, y: 0, r: 0 }, r: { x: 0, y: 0, r: 0 } };
    c.s.legs = c.s.legs.map(function (l) { return { r: l.r, sy: l.sy, y: 0 }; });
    K.face(tl, c, end + 0.4, was === "happy" ? "open" : was);
    busy(c, "move", at, end);
    return tl;
  }

  /**
   * Wave a flag (Anthropic's "Flag Waver"): the flag rises in three frames, then its cloth waves in held frames while
   * the body sways against it. `text` on the cloth (a word), `color`, `dur` (default 2 s).
   */
  function flag(tl, c, at, o) {
    o = o || {};
    var dur = o.dur || 2, cols = 10, rows = 6, cell = 0.5, F = 0.1;
    var col = o.color || (getComputedStyle(c.tokens.root).getPropertyValue("--accent") || "").trim() || ORANGE;
    var hand = c.p.hand.r, g = grp("cw-flag", hand);
    node("rect", { x: -0.2, y: -7.5, width: 0.4, height: 8.5, fill: "#5b4636" }, g);
    var strips = [];
    for (var i = 0; i < cols; i++) strips.push(node("rect", { x: 0.2 + i * cell, y: -7.4, width: cell + 0.02, height: rows * cell, fill: col }, g));
    if (o.text) {
      var label = node("text", { x: 0.2 + cols * cell / 2, y: -7.4 + rows * cell / 2, "font-size": 1.15, "text-anchor": "middle", "dominant-baseline": "central", fill: "#fff",
        style: "font-family: var(--font-sans); font-weight: 750; letter-spacing: -0.02em" }, g);
      label.textContent = o.text;
    }
    gsap.set(g, { opacity: 0 });
    set(tl, g, { opacity: 1 }, at);
    K.arms(tl, c, at, { r: { x: -0.2, y: -2.2, r: 0 }, dur: 0.12 });
    // The cloth: each strip rides a travelling wave, more toward the free end; held frames, like a sprite.
    var n = Math.floor(dur / F);
    for (var f = 0; f < n; f++) {
      var t = at + 0.12 + f * F, rise = Math.min(1, (f + 1) / 3);
      strips.forEach(function (s, i) {
        var a = (i / cols) * 0.9 * rise, y = Math.round(Math.sin(f * 0.9 - i * 0.75) * 2 * a) * 0.25;
        set(tl, s, { y: y + (1 - rise) * (i * 0.25) }, t);
      });
      var sway = [0, 0, -0.25, -0.25, 0, 0.2, 0.2, 0.2, 0, 0, -0.25, -0.25][f % 12];
      set(tl, c.p.torso, { x: sway }, t);
    }
    set(tl, c.p.torso, { x: 0 }, at + 0.12 + n * F);
    if (!o.keep) { set(tl, g, { opacity: 0 }, at + 0.12 + n * F); K.arms(tl, c, at + 0.12 + n * F, { r: "down", dur: 0.16 }); }
    busy(c, "arms", at, at + 0.3 + n * F);
    return tl;
  }

  /** A sign held up overhead with a word or two, for at least the reading floor (or `dur`). */
  function sign(tl, c, at, o) {
    o = typeof o === "string" ? { text: o } : (o || {});
    var text = String(o.text || ""), px = o.px || Math.max(36, Math.round(c.u * 1.7)), fu = px / c.u;
    // A board held up by its lower corners: the raised hands (at ±3.6, 9.6 above the feet) grip its bottom edge.
    var w = Math.max(8.6, text.length * fu * 0.62 + 1.6), h = fu * 1.3 + 1.1, base = -9.5;
    var g = grp("cw-sign", c.p.fx), ink = c.tokens.ink;
    node("rect", { x: -w / 2, y: base - h, width: w, height: h, fill: o.fill || "#fff", stroke: ink, "stroke-width": 0.18 }, g);
    _.label(g, [text], 0, base - h / 2, fu, { fill: o.ink || (o.fill ? ink : _.EYE), weight: 750 });   // dark on the white board, on any look
    gsap.set(g, { scale: 0, svgOrigin: "0 " + base });
    var hold = Math.max(o.dur || 0, K.readingFloor(text) + 0.2);
    K.arms(tl, c, at, { l: { x: 0.9, y: -4.6, r: 0 }, r: { x: -0.9, y: -4.6, r: 0 }, dur: 0.12 });
    [0.6, 1.08, 1].forEach(function (s, i) { set(tl, g, { scale: s }, at + 0.06 + i * 0.05); });
    K.face(tl, c, at, o.expr || "happy");
    [0.6, 0].forEach(function (s, i) { set(tl, g, { scale: s }, at + hold + i * 0.05); });
    K.arms(tl, c, at + hold, { l: "down", r: "down", dur: 0.16 });
    K.face(tl, c, at + hold + 0.1, "open");
    emit("pop", at, c);
    busy(c, "say", at, at + hold + 0.2);
    return tl;
  }

  /**
   * A workout (Anthropic's "Gym Claude"): picks up a dumbbell, presses it overhead `reps` times with held frames —
   * the effort at the top, a pause between reps, a sweat drop on the last — then a flex with sparkles.
   */
  function workout(tl, c, at, o) {
    o = o || {};
    var reps = o.reps || 2, t = at;
    // The bar is as wide as the arms are apart, so the hands close on its plates.
    var bell = drawProp(c, c.p.fx, "dumbbell", { scale: 1.45 });
    if (c.skinFilter) bell.setAttribute("filter", c.skinFilter);
    gsap.set(bell, { x: 0, y: -0.9, opacity: 0 });
    set(tl, bell, { opacity: 1 }, at);
    K.crouch(tl, c, t, { depth: 1, hold: false });
    K.arms(tl, c, t, { l: { x: 0, y: 1.6, r: 0 }, r: { x: 0, y: 1.6, r: 0 }, dur: 0.1 });
    K.face(tl, c, t, "squint");
    t += 0.27;
    var heights = [-2.2, -5.2, -9.8];
    _.torso(tl, c, t, { y: 0 }, 0.12, "power2.out");
    for (var r = 0; r < reps; r++) {
      [[0, 0.085], [1, 0.085], [2, 0.27]].forEach(function (step) {
        var y = heights[step[0]], ay = step[0] === 2 ? -3.9 : step[0] === 1 ? -1.6 : 0.2;
        set(tl, bell, { y: y }, t);
        set(tl, [c.p.arm.l, c.p.arm.r], { y: ay }, t);
        if (step[0] === 2) { K.face(tl, c, t, "angry"); emit("lift", t, c); }
        t += step[1];
      });
      if (r === reps - 1) K.sweat(tl, c, t - 0.2);
      set(tl, bell, { y: heights[1] }, t); set(tl, [c.p.arm.l, c.p.arm.r], { y: -1.6 }, t); t += 0.085;
      set(tl, bell, { y: heights[0] }, t); set(tl, [c.p.arm.l, c.p.arm.r], { y: 0.2 }, t); K.face(tl, c, t, "squint"); t += 0.4;
    }
    set(tl, bell, { y: -0.9 }, t);
    set(tl, [c.p.arm.l, c.p.arm.r], { y: 0 }, t);
    c.s.arms = { l: { x: 0, y: 0, r: 0 }, r: { x: 0, y: 0, r: 0 } };
    K.arms(tl, c, t + 0.1, { l: "cheer", r: "cheer", dur: 0.12 });
    K.face(tl, c, t + 0.1, "happy");
    set(tl, bell, { opacity: 0 }, t + 0.1);
    K.sparkles(tl, c, t + 0.15);
    K.arms(tl, c, t + 1.0, { l: "down", r: "down", dur: 0.18 });
    K.face(tl, c, t + 1.1, "open");
    busy(c, "move", at, t + 1.2);
    return tl;
  }

  /** Asleep from `at` to `until`: eyes ◡ ◡, sunk a little, breathing deep, Z's rising. */
  function sleep(tl, c, at, until, o) {
    K.face(tl, c, at, "content");
    _.torso(tl, c, at, { y: 0.45 }, 0.3, "power2.inOut");
    for (var t = at + 0.3, up = true; t < until - 0.1; t += 1.1, up = !up) {
      _.torso(tl, c, t, { y: up ? 0.15 : 0.45 }, Math.min(1.1, until - t), "sine.inOut");
    }
    K.zzz(tl, c, at + 0.2, until, o);
    busy(c, "blink", at, until);
    return tl;
  }
  /** Wakes with a start: "!", eyes wide, a little jump, then open eyes. */
  function wake(tl, c, at) {
    K.mark(tl, c, at, { kind: "!", dur: 0.9 });
    K.face(tl, c, at, "wide");
    _.torso(tl, c, at, { y: 0 }, 0.08, "power2.out");
    K.jump(tl, c, at + 0.1, { height: 1.8 });
    K.face(tl, c, at + 0.9, "open");
    return tl;
  }

  /** Quick reactions: "yay", "wow", "oops", "hmm", "love", "no", "yes", "angry", "sad", "dizzy". */
  function react(tl, c, at, kind) {
    var was = c.s.expr === "open" ? "open" : c.s.expr;
    switch (kind) {
      case "yay": K.jump(tl, c, at, { cheer: true }); K.sparkles(tl, c, at + 0.25); break;
      case "wow": K.face(tl, c, at, "wide"); K.mark(tl, c, at, "!"); _.torso(tl, c, at, { y: -0.3 }, 0.1); _.torso(tl, c, at + 0.5, { y: 0 }, 0.2); K.face(tl, c, at + 1, was); break;
      case "oops": K.face(tl, c, at, "x"); K.sweat(tl, c, at + 0.1); shake(tl, c, at + 0.1); K.face(tl, c, at + 1.1, was); break;
      case "hmm": K.look(tl, c, at, { at: "up-left", lean: false }); K.mark(tl, c, at, "?"); K.look(tl, c, at + 1.1, "center"); break;
      case "love": K.face(tl, c, at, "heart"); K.hearts(tl, c, at + 0.1); K.face(tl, c, at + 1.4, was); break;
      case "no": shake(tl, c, at); break;
      case "yes": nod(tl, c, at); break;
      case "angry": K.face(tl, c, at, "angry"); _.torso(tl, c, at, { y: 0.3 }, 0.08); _.torso(tl, c, at + 0.6, { y: 0 }, 0.2); K.face(tl, c, at + 1.2, was); break;
      case "sad": K.face(tl, c, at, "sad"); _.torso(tl, c, at, { y: 0.5 }, 0.3, "power2.inOut"); _.torso(tl, c, at + 1.2, { y: 0 }, 0.3, "power2.inOut"); K.face(tl, c, at + 1.4, was); break;
      case "dizzy": K.face(tl, c, at, "x"); for (var i = 0; i < 4; i++) _.torso(tl, c, at + i * 0.15, { r: i % 2 ? 4 : -4 }, 0.15, "sine.inOut"); _.torso(tl, c, at + 0.6, { r: 0 }, 0.15); K.face(tl, c, at + 1, was); break;
      default: throw new Error("RC.clawd.react: no reaction " + kind);
    }
    busy(c, "move", at, at + 1);
    return tl;
  }

  /* ------------------------------------------------------------------ minis: subagents */

  /**
   * Subagents: `n` small Clawds pop out of this one, hop out to a fan of spots, work (a spinner over each, or a prop:
   * `props`), and hop back in. Returns the minis, so a beat can do more with them (a check over each when done).
   * `spread` (px, default 1.6 × size), `size` (default .42 × the parent), `work` (s, default 1.1), `back: false` to keep them out.
   */
  function minis(tl, c, at, o) {
    o = o || {};
    var n = o.n || 3, size = (o.size || 0.42) * c.size, spread = o.spread || c.size * 1.6, work = o.work || 1.1;
    var out = [];
    K.face(tl, c, at, "happy");
    K.arms(tl, c, at, { l: "out", r: "out", dur: 0.14 });
    for (var i = 0; i < n; i++) {
      var k = n === 1 ? 0 : i / (n - 1) - 0.5, x = c.s.x + k * spread * 2, y = c.s.y + (Math.abs(k) < 0.26 ? c.u * 1.2 : 0) - (o.rise || 0);
      x = Math.max(size * 0.6, Math.min(c.W - size * 0.6, x));
      var m = K(c.layer, { x: c.s.x, y: c.s.y - c.u * 3, size: size, material: c.material, hidden: true, seed: c.seed + 13 * (i + 1), before: c.el });
      var t = at + 0.1 + i * 0.09;
      K.enter(tl, m, t, { from: "pop", to: c.s.x });
      K.hop(tl, m, t + 0.16, { to: x, y: y, height: 3.4 });
      var tw0 = m.free + 0.05;
      if (o.props && o.props[i % o.props.length]) hold(tl, m, tw0, { prop: o.props[i % o.props.length], pose: "hold" });
      else K.think(tl, m, tw0, { dur: work, look: true });
      m.marks.worked = tw0 + work;                   // when its work is done: a beat times a check (RC.clawd.done) on it
      out.push(m);
    }
    K.arms(tl, c, at + 0.2 + n * 0.12, { l: "down", r: "down", dur: 0.16 });
    var end = out.length ? out[out.length - 1].free : at;
    if (o.back !== false) {
      out.forEach(function (m, i) {
        var t = Math.max(end, m.free) + 0.1 + i * 0.1;
        if (m.held && m.held.r) drop(tl, m, t - 0.05, { hand: "r" });
        K.hop(tl, m, t, { to: c.s.x, y: c.s.y - c.u * 3, height: 3 });
        K.exit(tl, m, m.free - 0.18, { to: "poof" });
      });
      K.face(tl, c, end + 0.5 + n * 0.1, "happy");
    }
    busy(c, "move", at, end + 0.4);
    return out;
  }
  /** A green check pops over a Clawd (a mini that finished) and goes again after `dur` (default .9 s; 0 keeps it). */
  function done(tl, c, at, o) {
    var dur = o && o.dur != null ? o.dur : 0.9;
    var g = _.sprite(c, PROPS.check.rows, colorsFor(c, PROPS.check.colors), 0, -10.2, 0.5);
    [0.5, 1.15, 1].forEach(function (s, i) { set(tl, g, { scale: s }, at + i * 0.05); });
    if (dur) [0.6, 0].forEach(function (s, i) { set(tl, g, { scale: s }, at + dur + i * 0.05); });
    emit("done", at, c);
    return tl;
  }

  /* ------------------------------------------------------------------ the egg */

  var EGG = ["....oooo....", "..oooooooo..", ".oooooooooo.", ".ooowoooooo.", "oooooooooooo", "ooowoooooooo", "oooooooooooo", "oooooooowooo", "oooooooooooo", ".oooooooooo.", ".oooooooooo.", "..oooooooo..", "....oooo...."];
  /**
   * Clawd hatches: a Claude-orange pixel egg wobbles harder and cracks three times, the shell splits and flies off, and
   * Clawd pops up with sparkles. Clawd is hidden until then. `color` for the shell, `wobble` (s before the first crack).
   */
  function hatch(tl, c, at, o) {
    o = o || {};
    var cell = 0.75, w = EGG[0].length * cell, h = EGG.length * cell;
    var egg = grp("cw-egg", c.p.fx), top = grp("cw-egg-top", egg), bottom = grp("cw-egg-bot", egg);
    var colors = { o: o.color || "#f0d9c4", w: "#e3c3a6" };
    bitmap(top, EGG.slice(0, 7), colors, cell, -w / 2, -h);
    bitmap(bottom, EGG.slice(7), colors, cell, -w / 2, -h + 7 * cell);
    var cracks = [
      ["M-1.4 " + (-h * 0.55) + "l.6 .6l-.6 .6l.7 .7"], ["M1.2 " + (-h * 0.62) + "l-.6 .6l.7 .6l-.6 .7"], ["M-3.2 " + (-h * 0.47) + "l.75 -.45l.75 .45l.75 -.45l.75 .45l.75 -.45l.75 .45l.75 -.45l.75 .45"],
    ].map(function (d) { return node("path", { d: d[0], stroke: "#5b4636", "stroke-width": 0.32, fill: "none", opacity: 0 }, top); });
    gsap.set(egg, { svgOrigin: "0 0" });
    gsap.set(c.p.fig, { opacity: 0 });
    if (!c.n) gsap.set(c.p.cw, { opacity: 1 });
    var t = at + (o.wobble || 0.4);
    [3, -3, 0].forEach(function (r, i) { set(tl, egg, { rotation: r }, at + 0.1 + i * 0.1); });
    for (var k = 0; k < 3; k++) {
      var amp = 4 + k * 4;
      [amp, -amp, amp * 0.6, -amp * 0.6, 0].forEach(function (r, i) { set(tl, egg, { rotation: r }, t + i * 0.07); });
      set(tl, cracks[k], { opacity: 1 }, t + 0.1);
      emit("crack", t + 0.1, c);
      t += 0.55 - k * 0.08;
    }
    // Split: the top flies up and away, the bottom drops, and there is Clawd.
    tw(tl, top, { x: 0, y: 0, rotation: 0 }, { x: 5, y: -9, rotation: 50 }, t, 0.24, "power2.out");
    tw(tl, top, { opacity: 1 }, { opacity: 0 }, t + 0.14, 0.12, "none");
    tw(tl, bottom, { y: 0, opacity: 1 }, { y: 1.2, opacity: 0 }, t + 0.05, 0.3, "power2.in");
    set(tl, c.p.fig, { opacity: 1, scaleX: 0.4, scaleY: 0.4 }, t + 0.06);
    set(tl, c.p.fig, { scaleX: 1.12, scaleY: 1.12 }, t + 0.11);
    set(tl, c.p.fig, { scaleX: 1, scaleY: 1 }, t + 0.16);
    K.face(tl, c, t, "wide");
    K.sparkles(tl, c, t + 0.05, { n: 6 });
    emit("hatch", t, c);
    c.marks.hatch = t;
    K.jump(tl, c, t + 0.35, { cheer: true, height: 2.2 });
    K.face(tl, c, c.free + 0.1, "open");
    busy(c, "move", at, c.free);
    return tl;
  }

  /* ------------------------------------------------------------------ the pack's poses */

  var PACK_PIXEL = 8 / 14;
  /**
   * Play one of the mascot pack's poses (RC.clawd.POSES; list them with RC.clawd.poseIds("tag") or
   * `npm run clawd -- poses`): Clawd switches to the pose in a held frame — its eyes, gaze, arms and legs — and the
   * pose's props and effects pop in around it and move the way each does (sparkles twinkle, Z's rise, a loop spins, an
   * alert flashes, a lightbulb pulses, a bubble bobs). `dur` (default 2.2 s); `keep: true` leaves it all in place.
   */
  function pose(tl, c, at, id, o) {
    o = o || {};
    var P = K.POSES && K.POSES[id];
    if (!P) throw new Error("RC.clawd.pose: no pose " + id + (K.POSES ? " (" + Object.keys(K.POSES).length + " poses: npm run clawd -- poses)" : " (the pack is not loaded)"));
    var dur = o.dur || 2.2, end = at + dur, rnd = RC.rand(c.seed + id.length * 31), was = c.s.expr;
    K.face(tl, c, at, P.expr);
    K.gaze(tl, c, at, P.gaze[0], P.gaze[1], 0.08);
    ["l", "r"].forEach(function (side) { var a = P.arms[side] || [0, 0]; K.arms(tl, c, at, keyed(side, { x: a[0], y: a[1], r: 0 }, { dur: 0.1 })); });
    if (P.legs === "splay") _.legs(tl, c, at, [{ r: 12 }, { r: 6 }, { r: -6 }, { r: -12 }], 0.1);
    else if (P.legs === "tucked") _.legs(tl, c, at, { sy: 0.35 }, 0.1);
    // Front layers ride with Clawd in front of its face; back layers behind its body.
    if (!c.p.propsFront) { c.p.propsFront = grp("cw-props-front", c.p.breath); if (c.skinFilter) c.p.propsFront.setAttribute("filter", c.skinFilter); }
    if (c.skinFilter && !c.p.props.getAttribute("filter")) c.p.props.setAttribute("filter", c.skinFilter);
    var groups = P.layers.map(function (L, i) {
      var colors = {}; L.pal.forEach(function (col, k) { colors[String.fromCharCode(97 + k)] = col; });
      var w = L.rows[0].length * PACK_PIXEL, h = L.rows.length * PACK_PIXEL;
      var g = grp("cw-layer cw-" + L.kind, L.z === "back" ? c.p.props : c.p.propsFront);
      bitmap(g, L.rows, colors, PACK_PIXEL, -w / 2, -h / 2);
      gsap.set(g, { x: L.x, y: L.y, scale: 0, svgOrigin: "0 0", transformOrigin: "50% 50%" });
      var t0 = at + 0.04 + (L.kind === "spark" ? 0.12 + rnd() * 0.2 : i * 0.03);
      [0.5, 1.12, 1].forEach(function (s, k) { set(tl, g, { scale: s }, t0 + k * 0.05); });
      life(L, g, t0 + 0.15);
      if (!o.keep) [0.6, 0].forEach(function (s, k) { set(tl, g, { scale: s, opacity: 1 }, end + k * 0.05); });
      return g;
    });
    function life(L, g, from) {
      var phase = rnd(), t;
      if (L.motion === "twinkle") for (t = from + phase * 0.3; t < end - 0.1; t += 0.36) { set(tl, g, { scale: 0.55 }, t); set(tl, g, { scale: 1 }, t + 0.12); }
      else if (L.motion === "bob") for (t = from, k = 0; t < end - 0.1; t += 0.4, k++) set(tl, g, { y: L.y - (k % 2 ? 0.25 : 0) }, t);
      else if (L.motion === "spin") for (t = from, k = 1; t < end - 0.05; t += 0.12, k++) set(tl, g, { rotation: (k * 45) % 360 }, t);
      else if (L.motion === "rise") for (t = from + phase * 0.4; t < end - 0.3; t += 1.2) { tw(tl, g, { y: L.y, opacity: 1 }, { y: L.y - 1.6, opacity: 0 }, t, 1.0, "sine.out"); set(tl, g, { y: L.y, opacity: 1 }, t + 1.1); }
      else if (L.motion === "flash") for (t = from, k = 0; t < end - 0.1; t += 0.18, k++) set(tl, g, { opacity: k % 2 ? 0.35 : 1 }, t);
      else if (L.motion === "pulse") for (t = from, k = 0; t < end - 0.1; t += 0.25, k++) set(tl, g, { scale: k % 2 ? 1 : 1.08 }, t);
    }
    var k;
    // The pose's small Clawds pop up beside it, sized as the pack drew them.
    var minis = (P.minis || []).map(function (m, i) {
      var r = K(c.layer, { x: c.s.x + m[0] * c.u, y: c.s.y + m[1] * c.u, size: Math.max(20, m[2] * c.u), material: c.material, hidden: true, seed: c.seed + 7 * (i + 1), before: c.el });
      K.enter(tl, r, at + 0.1 + i * 0.07, { from: "pop" });
      K.life(tl, r, at, end);
      if (!o.keep) K.exit(tl, r, end, { to: "poof" });
      return r;
    });
    if (!o.keep) {
      K.face(tl, c, end + 0.05, was === P.expr ? "open" : was);
      K.gaze(tl, c, end + 0.05, 0, 0, 0.1);
      K.arms(tl, c, end + 0.05, { l: "down", r: "down", dur: 0.14 });
      if (P.legs !== "straight") _.legs(tl, c, end + 0.05, { r: 0, sy: 1 }, 0.1);
    }
    emit("pop", at, c);
    busy(c, "move", at, end + 0.2);
    c.lastPose = { layers: groups, minis: minis };
    return tl;
  }
  /** The ids of the poses tagged with a word (or all of them). */
  function poseIds(tag) {
    var all = K.POSES ? Object.keys(K.POSES) : [];
    return tag ? all.filter(function (id) { return K.POSES[id].tags.indexOf(tag) >= 0 || id.indexOf(tag) >= 0; }) : all;
  }

  Object.assign(K, {
    PROPS: PROPS, WEARS: WEARS, hold: hold, drop: drop, carry: carry, wear: wear, dress: dress, undress: undress, tap: tap, plug: plug, type: type,
    onWord: onWord, talk: talk, follow: follow, nod: nod, shake: shake, burst: burst, confetti: confetti, flag: flag, sign: sign, workout: workout,
    sleep: sleep, wake: wake, react: react, minis: minis, done: done, hatch: hatch, drawProp: drawProp, pose: pose, poseIds: poseIds,
  });
})();
