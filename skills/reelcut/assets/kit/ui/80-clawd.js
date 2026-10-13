/*
 * Clawd, the Claude mascot, as a character a beat directs.
 *
 * Drawn by the kit from one fixed spec, Anthropic's minimal Clawd: an 8×6 body, two square eyes, a 1×2 arm on each side
 * at mid-height, four 1×2 legs, no mouth, #d97757. A beat poses, animates, dresses and lights Clawd; it never redraws,
 * recolours or reshapes it (docs/design/clawd-decisions.md). Expressions, props and effects sit on a half-unit grid.
 *
 *   var c = RC.clawd("#root .cam", { x: 760, y: 900, size: 260 });  // x, y: where its feet stand (px); size: its width
 *   RC.clawd.enter(tl, c, 0, { from: "right" });                    // walks in from off the frame
 *   RC.clawd.look(tl, c, 1.1, { at: "#root .phone" });              // eyes and a lean toward the phone
 *   RC.clawd.hop(tl, c, 1.6, { to: 520 });                          // crouch, a gravity arc, a landing
 *   RC.clawd.wave(tl, c, 2.4);
 *   RC.clawd.life(tl, c, 0, 4.4);                                   // breathing, blinks, glances in the gaps: last
 *
 * It moves the way Anthropic's own Clawd clips do (owner's decision, 2026-10-13): a quick crouch before a hop, a real
 * gravity arc, legs that step, poses that hold. Only Clawd does: everything around it stays on Apple's springs. Its
 * material follows the beat's style (data-style): clay in Claymation, a cut card in Paper Cutout, an outline in Linear,
 * a voxel in 3D. Its orange and its shape never change.
 *
 * Schedule one rig's actions in time order, like a score: each starts from where the last one left Clawd, and
 * `c.free` is when it is free again. `c.marks` says when the moment of an act landed (c.marks.plug, .tap, .drop,
 * .hatch, .land), so the UI around Clawd can answer on that frame. Every frame is a pure function of time (blinks and glances are seeded), so a seek
 * lands on the same picture every time. Moves record clawd-* events, so `sfx suggest` gives Clawd its 8-bit blips.
 */
(function () {
  var RC = window.RC, gsap = window.gsap;
  if (!RC || RC.clawd) return;
  var NS = "http://www.w3.org/2000/svg";
  var ORANGE = "#d97757", EYE = "#141413";
  var uid = 0;

  /* ------------------------------------------------------------------ drawing */

  function node(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function grp(cls, parent, attrs) { var a = attrs || {}; a["class"] = cls; return node("g", a, parent); }
  function r2(v) { return Math.round(v * 1000) / 1000; }
  /** Cells [[x, y, w, h], …] in units as one path: one shape, so its pixels never show a seam. */
  function cellsPath(cells, ox, oy) {
    ox = ox || 0; oy = oy || 0;
    return cells.map(function (c) { return "M" + r2(c[0] + ox) + " " + r2(c[1] + oy) + "h" + r2(c[2]) + "v" + r2(c[3]) + "h" + r2(-c[2]) + "z"; }).join("");
  }
  /**
   * A pixel bitmap: rows of characters, one per cell, each character a colour in `colors` ("." is empty), drawn at
   * `cell` units a pixel with its top-left at (ox, oy). Runs on a row merge into one rect. Props, hats, effects and the
   * pack's poses are all drawn this way, so they share Clawd's pixel.
   */
  function bitmap(parent, rows, colors, cell, ox, oy, cls) {
    var byColor = {};
    rows.forEach(function (row, y) {
      var x = 0;
      while (x < row.length) {
        var ch = row[x];
        if (ch === "." || ch === " " || !colors[ch]) { x++; continue; }
        var s = x; while (x < row.length && row[x] === ch) x++;
        (byColor[ch] = byColor[ch] || []).push([s * cell, y * cell, (x - s) * cell, cell]);
      }
    });
    var g = grp(cls || "cw-bmp", parent);
    Object.keys(byColor).forEach(function (ch) { node("path", { d: cellsPath(byColor[ch], ox, oy), fill: colors[ch] }, g); });
    return g;
  }

  /**
   * Lines of text centred on (x, y), `fu` units tall, in the beat's sans (or mono): plain SVG text, which the layout and
   * contrast audits read as text (HTML in a foreignObject inside a scaled SVG reads to them as overflowing).
   */
  function label(parent, lines, x, y, fu, o) {
    o = o || {};
    var t = node("text", { x: x, y: y - (lines.length - 1) * fu * 0.55, "font-size": fu, "text-anchor": "middle", "dominant-baseline": "central", fill: o.fill || EYE,
      style: "font-family: " + (o.mono ? "var(--font-mono), ui-monospace, monospace" : "var(--font-sans), system-ui, sans-serif") + "; font-weight: " + (o.weight || (o.mono ? 600 : 650)) + "; letter-spacing: " + (o.mono ? "0" : "-0.02em") }, parent);
    lines.forEach(function (l, i) { var s = node("tspan", { x: x, dy: i ? fu * 1.1 : 0 }, t); s.textContent = l; });
    return t;
  }

  /* ------------------------------------------------------------------ the spec */

  // Anthropic's minimal Clawd on its own grid, in units: 10 wide with the arms, 8 tall with the legs, feet on y = 8.
  var BODY = [1, 0, 8, 6];
  var ARM = { l: [0, 2, 1, 2], r: [9, 2, 1, 2] };
  var LEGS = [1, 3, 6, 8];                       // each leg is 1 wide, from under the body (5.5) to the ground (8)
  var EYES = { l: [2.5, 1.5], r: [7.5, 1.5] };   // the centres of the 1×1 eyes

  function sym(cells, color) { return { l: cells, r: cells, color: color }; }
  /** The eyes, as half-unit cells around each eye's centre. Anthropic's Clawd has no mouth: the eyes carry the mood. */
  var EXPR = {
    open: sym([[-0.5, -0.5, 1, 1]]),
    happy: sym([[-0.5, -0.5, 1, 0.5], [-1, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5]]),          // ^ ^
    content: sym([[-1, -0.5, 0.5, 0.5], [0.5, -0.5, 0.5, 0.5], [-0.5, 0, 1, 0.5]]),     // ◡ ◡  asleep, blissful
    closed: sym([[-0.5, 0.1, 1, 0.4]]),                                                  // — —
    squint: sym([[-0.5, -0.15, 1, 0.55]]),                                               // focused
    wide: sym([[-0.5, -0.9, 1, 1.6]]),                                                   // surprised
    small: sym([[-0.25, -0.25, 0.5, 0.5]]),                                              // tired, far away
    x: sym([[-0.75, -0.75, 0.5, 0.5], [0.25, -0.75, 0.5, 0.5], [-0.25, -0.25, 0.5, 0.5], [-0.75, 0.25, 0.5, 0.5], [0.25, 0.25, 0.5, 0.5]]),
    angry: { l: [[-0.5, 0, 1, 0.5], [-0.5, -0.5, 0.5, 0.5]], r: [[-0.5, 0, 1, 0.5], [0, -0.5, 0.5, 0.5]] },   // \ /
    sad: { l: [[-0.5, 0, 1, 0.5], [0, -0.5, 0.5, 0.5]], r: [[-0.5, 0, 1, 0.5], [-0.5, -0.5, 0.5, 0.5]] },     // / \
    heart: sym([[-0.75, -0.75, 0.5, 0.5], [0.25, -0.75, 0.5, 0.5], [-0.75, -0.25, 1.5, 0.5], [-0.25, 0.25, 0.5, 0.5]], "#e5484d"),
  };
  // A blink reads on these; on the others (^, —, X, ♥) it would only look like a glitch.
  var BLINKS = { open: 1, wide: 1, small: 1, squint: 1, angry: 1, sad: 1 };

  /* ------------------------------------------------------------------ materials: one per style */

  // Which material each personality style draws Clawd in. Any other style, and no style, is flat.
  var MATERIAL_OF = {
    claymation: "clay", "stop-motion": "clay", "paper-cutout": "paper", collage: "collage", "hand-drawn": "sketch",
    linear: "line", "ink-paint": "ink", brutalist: "brutal", "3d": "voxel", isometric: "iso", liquid: "liquid",
    "retro-vhs": "vhs", glitch: "glitch", cinematic: "cine", editorial: "print",
  };
  /*
   * Each material: a filter on the skin (body, arms, legs and what Clawd holds, as one silhouette, so a bevel or an
   * outline follows their union), an optional filter on the whole figure (a chroma split), the corner radius of the
   * parts, whether edges stay pixel-crisp, and the shadow under the feet. Lengths are in Clawd's units, so a material
   * looks the same at any size. INK and GROUND are the beat's own tokens, read when the rig is built.
   */
  var NOISE = function (f, seed, out) { return '<feTurbulence type="fractalNoise" baseFrequency="' + f + '" numOctaves="2" seed="' + seed + '" result="' + out + 'n"/><feColorMatrix in="' + out + 'n" type="saturate" values="0" result="' + out + '"/>'; };
  var RING = function (r, color, out) { return '<feMorphology in="SourceAlpha" operator="dilate" radius="' + r + '" result="' + out + 'd"/><feComposite in="' + out + 'd" in2="SourceAlpha" operator="out" result="' + out + 'r"/><feFlood flood-color="' + color + '"/><feComposite in2="' + out + 'r" operator="in" result="' + out + '"/>'; };
  var EXTRUDE = function (dx, dy, steps, color) {
    var s = "", m = "";
    for (var i = 1; i <= steps; i++) { s += '<feOffset in="SourceAlpha" dx="' + r2(dx * i / steps) + '" dy="' + r2(dy * i / steps) + '" result="x' + i + '"/>'; m += '<feMergeNode in="x' + i + '"/>'; }
    return s + "<feMerge result=\"xa\">" + m + '</feMerge><feFlood flood-color="' + color + '"/><feComposite in2="xa" operator="in" result="side"/>';
  };
  /*
   * Light from one side, the way clay and a lit object look: the alpha is blurred into a height field, lit by a distant
   * light, and the colour is scaled by it around an ambient floor, normalised so a flat face keeps its own orange and
   * only the edges turn toward or away from the light. Never black: a shaded edge keeps `amb` of its colour.
   */
  var LIGHT = function (blur, scale, az, el, amb, spec) {
    var flat = Math.sin(el * Math.PI / 180), k1 = r2((1 - amb) / flat);
    return '<feGaussianBlur in="SourceAlpha" stdDeviation="' + blur + '" result="lb"/>' +
      '<feDiffuseLighting in="lb" surfaceScale="' + scale + '" diffuseConstant="1" lighting-color="#fff" result="ld"><feDistantLight azimuth="' + az + '" elevation="' + el + '"/></feDiffuseLighting>' +
      '<feComposite in="SourceGraphic" in2="ld" operator="arithmetic" k1="' + k1 + '" k2="' + amb + '" result="lit"/>' +
      (spec ? '<feSpecularLighting in="lb" surfaceScale="' + scale + '" specularConstant="' + spec + '" specularExponent="30" lighting-color="#fff" result="ls"><feDistantLight azimuth="' + az + '" elevation="' + el + '"/></feSpecularLighting>' +
        '<feComposite in="ls" in2="SourceAlpha" operator="in" result="lsi"/><feComposite in="lit" in2="lsi" operator="arithmetic" k2="1" k3=".6" result="lit2"/>' : '<feMerge result="lit2"><feMergeNode in="lit"/></feMerge>') +
      '<feComposite in="lit2" in2="SourceAlpha" operator="in" result="lit3"/>';
  };
  var MATERIALS = {
    flat: { crisp: true, shadow: "soft" },
    print: { crisp: true, shadow: "soft", skin: NOISE(3.2, 4, "pt") + '<feComposite in="SourceGraphic" in2="pt" operator="arithmetic" k1=".14" k2=".93"/><feComposite in2="SourceAlpha" operator="in"/>' },
    clay: {
      rx: 0.34, shadow: "clay",
      skin: LIGHT(0.42, 2.2, 235, 52, 0.5, 0.35) + NOISE(2.4, 11, "ct") + '<feComposite in="lit3" in2="ct" operator="arithmetic" k1=".16" k2=".92" result="tx"/><feComposite in="tx" in2="SourceAlpha" operator="in"/>',
    },
    paper: {
      shadow: "contact",
      skin: '<feOffset in="SourceAlpha" dx=".05" dy=".16" result="po"/><feGaussianBlur in="po" stdDeviation=".1" result="pb"/><feFlood flood-color="INK" flood-opacity=".34"/><feComposite in2="pb" operator="in" result="sh"/>' +
        '<feMorphology in="SourceAlpha" operator="erode" radius=".07" result="pe"/><feComposite in="SourceAlpha" in2="pe" operator="out" result="prim"/><feFlood flood-color="#fff" flood-opacity=".3"/><feComposite in2="prim" operator="in" result="edge"/>' +
        NOISE(3.5, 4, "pn") + '<feComposite in="SourceGraphic" in2="pn" operator="arithmetic" k1=".14" k2=".93" result="pt"/><feComposite in="pt" in2="SourceAlpha" operator="in" result="fill"/>' +
        '<feMerge><feMergeNode in="sh"/><feMergeNode in="fill"/><feMergeNode in="edge"/></feMerge>',
    },
    sketch: {
      shadow: "scribble",
      skin: RING(0.11, "INK", "sk") + '<feComponentTransfer in="SourceGraphic" result="sf"><feFuncA type="linear" slope=".9"/></feComponentTransfer><feMerge result="sm"><feMergeNode in="sf"/><feMergeNode in="sk"/></feMerge>' +
        '<feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="5" result="sw"/><feDisplacementMap in="sm" in2="sw" scale=".24" xChannelSelector="R" yChannelSelector="G"/>',
      face: '<feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="5" result="sw"/><feDisplacementMap in="SourceGraphic" in2="sw" scale=".2" xChannelSelector="R" yChannelSelector="G"/>',
    },
    line: {
      shadow: "line", eyes: "ink",
      skin: RING(0.075, ORANGE, "ln") + '<feFlood flood-color="' + ORANGE + '" flood-opacity=".1"/><feComposite in2="SourceAlpha" operator="in" result="lt"/><feMerge><feMergeNode in="lt"/><feMergeNode in="ln"/></feMerge>',
    },
    ink: {
      shadow: "blot",
      skin: '<feTurbulence type="fractalNoise" baseFrequency=".55" numOctaves="3" seed="9" result="it"/><feDisplacementMap in="SourceGraphic" in2="it" scale=".34" xChannelSelector="R" yChannelSelector="G" result="id"/>' +
        NOISE(2.6, 2, "in") + '<feComposite in="id" in2="in" operator="arithmetic" k1=".4" k2=".78" result="ix"/><feComposite in="ix" in2="id" operator="in"/>',
    },
    brutal: {
      crisp: true, shadow: "none",
      skin: '<feMorphology in="SourceAlpha" operator="dilate" radius=".17" result="bd"/><feFlood flood-color="INK"/><feComposite in2="bd" operator="in" result="bl"/><feOffset in="bl" dx=".34" dy=".34" result="bh"/>' +
        '<feMerge><feMergeNode in="bh"/><feMergeNode in="bl"/><feMergeNode in="SourceGraphic"/></feMerge>',
    },
    voxel: {
      rx: 0.06, shadow: "clay",
      skin: EXTRUDE(0.62, 0.5, 9, "#9a4e35") + LIGHT(0.16, 1.4, 225, 60, 0.62, 0.22) + '<feMerge><feMergeNode in="side"/><feMergeNode in="lit3"/></feMerge>',
    },
    iso: {
      shadow: "iso",
      skin: EXTRUDE(0.7, -0.42, 9, "#a9573c") + '<feMerge><feMergeNode in="side"/><feMergeNode in="SourceGraphic"/></feMerge>',
    },
    liquid: {
      shadow: "glow",
      skin: '<feGaussianBlur in="SourceGraphic" stdDeviation=".34" result="gb"/><feColorMatrix in="gb" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -10" result="goo"/>' +
        '<feGaussianBlur in="goo" stdDeviation=".28" result="gg"/><feSpecularLighting in="gg" surfaceScale="4" specularConstant=".7" specularExponent="44" lighting-color="#fff" result="gs"><feDistantLight azimuth="235" elevation="55"/></feSpecularLighting>' +
        '<feComposite in="gs" in2="goo" operator="in" result="gsi"/><feComposite in="goo" in2="gsi" operator="arithmetic" k2="1" k3=".5"/>',
    },
    vhs: {
      crisp: true, shadow: "glow",
      fig: '<feColorMatrix in="SourceGraphic" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="vr"/><feOffset in="vr" dx="-.13" result="vro"/>' +
        '<feColorMatrix in="SourceGraphic" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="vg"/><feOffset in="vg" dx=".13" result="vgo"/><feBlend in="vro" in2="vgo" mode="screen" result="vs"/>' +
        '<feGaussianBlur in="vs" stdDeviation=".32" result="vb"/><feMerge><feMergeNode in="vb"/><feMergeNode in="vs"/></feMerge>',
    },
    glitch: {
      crisp: true, shadow: "soft",
      fig: '<feColorMatrix in="SourceGraphic" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="gr"/><feOffset in="gr" dx="-.18" dy=".04" result="gro"/>' +
        '<feColorMatrix in="SourceGraphic" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="gc"/><feOffset in="gc" dx=".18" result="gco"/><feBlend in="gro" in2="gco" mode="screen"/>',
    },
    cine: {
      shadow: "cine",
      skin: LIGHT(0.5, 2.6, 215, 32, 0.42, 0.3),
    },
    collage: {
      shadow: "contact", tilt: -3, tape: true,
      skin: '<feOffset in="SourceAlpha" dx=".08" dy=".14" result="co"/><feGaussianBlur in="co" stdDeviation=".06" result="cb"/><feFlood flood-color="INK" flood-opacity=".38"/><feComposite in2="cb" operator="in" result="sh"/>' +
        NOISE(3.5, 6, "cn") + '<feComposite in="SourceGraphic" in2="cn" operator="arithmetic" k1=".18" k2=".9" result="ct"/><feComposite in="ct" in2="SourceAlpha" operator="in" result="fill"/>' +
        '<feMerge><feMergeNode in="sh"/><feMergeNode in="fill"/></feMerge>',
    },
  };

  /** The beat's ink and ground, for outlines, shadows and the low-contrast check. */
  function tokens(el) {
    var root = (el.closest && el.closest("[data-look]")) || document.querySelector("[data-look]") || document.body;
    var cs = getComputedStyle(root);
    return { root: root, ink: (cs.getPropertyValue("--ink") || "").trim() || "#141413", ground: (cs.getPropertyValue("--ground") || "").trim() || "#ffffff",
      style: root.getAttribute("data-style") || "" };
  }
  function lum(hex) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || "");
    if (!m) { var s = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex || ""); if (!s) return 1; m = [0, s[1] + s[1], s[2] + s[2], s[3] + s[3]]; }
    var c = [m[1], m[2], m[3]].map(function (h) { var v = parseInt(h, 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

  /* ------------------------------------------------------------------ the rig */

  /**
   * Build Clawd in `target` (a layer of the beat, usually the camera layer) and return the rig the moves take.
   *
   *   x, y      where its feet stand, in the layer's px (default: the layer's centre, 82% down)
   *   size      its width in px, arms included (default 240). Its height is 0.8 × that
   *   material  "flat", "clay", "paper"… (default: the one the beat's data-style calls for)
   *   expr      the eyes it starts with (default "open")
   *   seed      for its blinks and glances (default: its order on the page)
   *   before    an element to sit behind (default: on top of the layer)
   *   hidden    start invisible (an entrance shows it)
   *   outline   true / false: an ink outline. Default: only when the ground is too close to Clawd's orange
   */
  function clawd(target, o) {
    o = o || {};
    var layer = RC.one(target); if (!layer) throw new Error("RC.clawd: no layer " + target);
    var W = layer.offsetWidth || 1080, H = layer.offsetHeight || 1080;
    var id = "cw" + (++uid);
    var tk = tokens(layer);
    var size = o.size || 240, u = size / 10;
    var matName = o.material || MATERIAL_OF[tk.style] || "flat";
    var mat = MATERIALS[matName] || MATERIALS.flat;

    var svg = node("svg", { "class": "rc-clawd" + (mat.crisp ? " rc-cw-crisp" : ""), width: W, height: H, viewBox: "0 0 " + W + " " + H, "data-clawd": id });
    if (o.z != null) svg.style.zIndex = o.z;
    var before = o.before && RC.one(o.before);
    if (before && before.parentNode === layer) layer.insertBefore(svg, before); else layer.appendChild(svg);
    var defs = node("defs", {}, svg);

    var c = {
      id: id, el: svg, layer: layer, W: W, H: H, size: size, u: u, material: matName, tokens: tk,
      seed: o.seed != null ? o.seed : uid * 7919, free: 0, n: 0, busy: [], exprs: [[0, o.expr || "open"]], marks: {},
      s: { x: o.x != null ? o.x : W / 2, y: o.y != null ? o.y : H * 0.82, hy: 0, sx: 1, sy: 1, tx: 0, ty: 0, tr: 0, gx: 0, gy: 0, op: o.hidden ? 0 : 1,
        arms: { l: { x: 0, y: 0, r: 0 }, r: { x: 0, y: 0, r: 0 } }, legs: [0, 1, 2, 3].map(function () { return { r: 0, sy: 1, y: 0 }; }), shadow: 1, expr: o.expr || "open" },
      p: {},
    };

    // Filters, in the rig's units (primitiveUnits follow the user space of the group they sit on).
    var ink = tk.ink, outline = o.outline != null ? o.outline : contrast(ORANGE, tk.ground) < 1.7 && matName === "flat";
    function filter(fid, body) {
      if (!body) return null;
      node("filter", { id: fid, filterUnits: "userSpaceOnUse", x: -30, y: -40, width: 60, height: 52, "color-interpolation-filters": "sRGB" }, defs).innerHTML = body.replace(/INK/g, ink);
      return "url(#" + fid + ")";
    }
    var skinBody = mat.skin || (outline ? RING(0.09, "INK", "ol") + '<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="ol"/></feMerge>' : null);
    var skinF = filter(id + "-skin", skinBody), faceF = filter(id + "-face", mat.face), figF = filter(id + "-fig", mat.fig);

    // The tree. `cw` is where Clawd stands (px); `cw-u` turns px into units around the feet; `cw-fig` jumps and squashes.
    var cw = grp("cw", svg);
    var units = grp("cw-u", cw, { transform: "scale(" + u + ")" });
    var shadowG = grp("cw-shadow", units);
    var tilt = grp("cw-tilt", units, mat.tilt ? { transform: "rotate(" + mat.tilt + " 0 -4)" } : {});
    var fig = grp("cw-fig", tilt, { filter: figF });
    var breath = grp("cw-breath", fig);
    var props = grp("cw-props", breath);                                    // a pose's scenery (the pack): behind Clawd
    // The skin: legs, then the torso (arms behind the body). One filter over all of it, so a bevel follows the union.
    var skin = grp("cw-skin", breath, { filter: skinF });
    var skinOff = grp("cw-off", skin, { transform: "translate(-5 -8)" });
    var clip = node("clipPath", { id: id + "-ground" }, defs);
    node("rect", { x: -30, y: -40, width: 70, height: 48 }, clip);       // nothing below the feet: a stretched leg stops at the ground
    var legsG = grp("cw-legs", skinOff, { "clip-path": "url(#" + id + "-ground)" });
    var rx = mat.rx || 0;
    c.p.legs = LEGS.map(function (x, i) {
      var lg = grp("cw-leg cw-leg-" + i, legsG);
      node("rect", { x: x, y: 5.5, width: 1, height: 2.5, rx: rx * 0.7, fill: ORANGE }, lg);
      return lg;
    });
    var torsoS = grp("cw-torso", skinOff);
    var armS = {};
    ["l", "r"].forEach(function (side) {
      var a = ARM[side], ag = grp("cw-arm cw-arm-" + side, torsoS);
      node("rect", { x: a[0], y: a[1], width: a[2], height: a[3], rx: rx * 0.7, fill: ORANGE }, ag);
      armS[side] = ag;
    });
    node("rect", { "class": "cw-body", x: BODY[0], y: BODY[1], width: BODY[2], height: BODY[3], rx: rx, fill: ORANGE }, torsoS);
    // The face tree mirrors the torso's moves but sits outside the skin's filter, so the eyes stay crisp on clay or goo.
    var faceTree = grp("cw-facetree", breath, { filter: faceF });
    var faceOff = grp("cw-off", faceTree, { transform: "translate(-5 -8)" });
    var torsoF = grp("cw-torso", faceOff);
    var gazeG = grp("cw-gaze", torsoF), glanceG = grp("cw-glance", gazeG);
    c.p.eye = {}; c.p.variants = {};
    ["l", "r"].forEach(function (side) {
      var e = EYES[side], eg = grp("cw-eye cw-eye-" + side, glanceG);
      c.p.eye[side] = eg;
      Object.keys(EXPR).forEach(function (name) {
        var ex = EXPR[name];
        var v = node("path", { d: cellsPath(ex[side], e[0], e[1]), fill: ex.color || (mat.eyes === "ink" ? ink : EYE), opacity: name === c.s.expr ? 1 : 0, "class": "cw-x-" + name }, eg);
        (c.p.variants[name] = c.p.variants[name] || []).push(v);
      });
    });
    c.p.cheeks = grp("cw-cheeks", glanceG);
    c.p.top = grp("cw-top", torsoF, skinF ? { filter: skinF } : {});      // hats: on the body's top edge (y = 0)
    c.p.front = grp("cw-front", torsoF, skinF ? { filter: skinF } : {});  // worn in front: a badge, a bandana
    // Each arm moves twice over: its rect in the skin, and a hand in front of the body, so what it holds is never
    // hidden behind Clawd and takes the material's filter of its own.
    c.p.arm = {}; c.p.hand = {}; c.skinFilter = skinF;
    ["l", "r"].forEach(function (side) {
      var a = ARM[side], front = grp("cw-arm-front cw-arm-front-" + side, torsoF);
      c.p.arm[side] = [armS[side], front];
      c.p.hand[side] = grp("cw-hand cw-hand-" + side, front, { transform: "translate(" + (a[0] + 0.5) + " " + (a[1] + 1) + ")" });
    });
    var fx = grp("cw-fx", units);                                         // effects, in units around the feet; never squashed
    c.p.fx = fx; c.p.props = props;

    c.p.cw = cw; c.p.fig = fig; c.p.breath = breath; c.p.torso = [torsoS, torsoF]; c.p.gaze = gazeG; c.p.glance = glanceG; c.p.tilt = tilt;
    c.p.skin = skin; c.p.faceTree = faceTree;

    shadow(c, mat.shadow, lum(tk.ground) < 0.22 ? "#000" : ink);
    if (mat.tape) bitmap(c.p.top, ["tttttt", "tttttt"], { t: "rgba(240,228,196,.82)" }, 0.5, 2.2, -0.5, "cw-tape").setAttribute("transform", "rotate(-8 3.7 0)");

    // Where everything starts. Pivots: the feet for the figure, the hips for the legs, the arms' middles, the eyes' centres.
    gsap.set(cw, { x: c.s.x, y: c.s.y, opacity: c.s.op });
    gsap.set(fig, { svgOrigin: "0 0" });
    gsap.set(breath, { svgOrigin: "0 0" });
    gsap.set(c.p.torso, { svgOrigin: "5 6" });
    c.p.legs.forEach(function (lg, i) { gsap.set(lg, { svgOrigin: (LEGS[i] + 0.5) + " 6" }); });
    gsap.set(c.p.arm.l, { svgOrigin: "0.5 3" }); gsap.set(c.p.arm.r, { svgOrigin: "9.5 3" });   // both halves of each arm
    gsap.set(c.p.eye.l, { svgOrigin: EYES.l.join(" ") }); gsap.set(c.p.eye.r, { svgOrigin: EYES.r.join(" ") });
    c.rigs = [c];
    return c;
  }

  /** The shadow under the feet, in the material's manner. */
  function shadow(c, kind, ink) {
    var g = c.p.shadowG = c.el.querySelector(".cw-shadow");
    var e;
    if (kind === "none") return;
    if (kind === "line") e = node("rect", { x: -5.5, y: -0.04, width: 11, height: 0.08, fill: ORANGE, opacity: 0.6 }, g);
    else if (kind === "scribble") e = node("path", { d: "M-4.6 .05 C-2.5 -.18 -1 .2 .4 0 S3 -.2 4.6 .08", stroke: ink, "stroke-width": 0.12, fill: "none", "stroke-linecap": "round", opacity: 0.7 }, g);
    else if (kind === "iso") e = node("path", { d: "M-4.6 0 L0 -1.1 L4.6 0 L0 1.1 Z", fill: ink, opacity: 0.14 }, g);
    else {
      var spec = { soft: [4.3, 0.42, 0.14, 0], contact: [4.1, 0.34, 0.2, 0.08], clay: [4.8, 0.62, 0.24, 0.22], cine: [5.2, 0.7, 0.3, 0.3], glow: [4.8, 0.6, 0.22, 0.3], blot: [4.4, 0.5, 0.3, 0.05] }[kind] || [4.3, 0.42, 0.14, 0];
      var fid = c.id + "-sh";
      if (spec[3]) node("filter", { id: fid, x: "-50%", y: "-200%", width: "200%", height: "500%" }, c.el.querySelector("defs")).innerHTML = '<feGaussianBlur stdDeviation="' + spec[3] + '"/>';
      e = node("ellipse", { cx: 0, cy: 0, rx: spec[0], ry: spec[1], fill: kind === "glow" ? ORANGE : ink, opacity: spec[2], filter: spec[3] ? "url(#" + fid + ")" : null }, g);
    }
    gsap.set(g, { svgOrigin: "0 0" });
  }

  /* ------------------------------------------------------------------ scheduling */

  var EASE = "power2.out";
  /** One property change: always fromTo with the state it starts from, never rendered early, so any seek is exact. */
  function tw(tl, target, from, to, at, dur, ease) {
    to.duration = Math.max(0.001, dur); to.ease = ease || EASE; to.immediateRender = false;
    tl.fromTo(target, from, to, at);
  }
  function set(tl, target, vals, at) { tl.set(target, vals, at); }
  /** { l: v } or { r: v }, plus options. */
  function keyed(k, v, rest) { var o = Object.assign({}, rest || {}); o[k] = v; return o; }
  function busy(c, kind, from, to) { c.busy.push([kind, from, to]); c.free = Math.max(c.free, to); c.n++; }
  function isBusy(c, kinds, t, pad) {
    pad = pad || 0;
    for (var i = 0; i < c.busy.length; i++) { var b = c.busy[i]; if (kinds.indexOf(b[0]) >= 0 && t > b[1] - pad && t < b[2] + pad) return true; }
    return false;
  }
  function exprAt(c, t) { var e = c.exprs[0][1]; for (var i = 0; i < c.exprs.length; i++) if (c.exprs[i][0] <= t + 1e-6) e = c.exprs[i][1]; return e; }
  function emit(type, at, c) { RC.emit("clawd-" + type, at, c ? { rig: c.id } : null); }

  /** Where an element (or a point, or a side word) is, in the rig's layer px. */
  function pointOf(c, at) {
    if (at == null) return null;
    if (Array.isArray(at)) return { x: at[0], y: at[1] };
    if (typeof at === "object" && at.x != null && !at.nodeType) return at;
    var e = RC.one(at); if (!e) return null;
    var lb = c.layer.getBoundingClientRect(), b = e.getBoundingClientRect();
    var k = c.layer.offsetWidth ? lb.width / c.layer.offsetWidth : 1;   // a camera push scales the layer; undo it
    return { x: (b.left + b.width / 2 - lb.left) / k, y: (b.top + b.height / 2 - lb.top) / k, w: b.width / k, h: b.height / k, left: (b.left - lb.left) / k, top: (b.top - lb.top) / k };
  }
  /** The rig's head (between the eyes), in layer px, where it stands now. */
  function headOf(c) { return { x: c.s.x, y: c.s.y + (c.s.hy - 6.5) * c.u }; }

  /** Put Clawd somewhere at once: before anything is scheduled it is where it starts; later, a cut in the action. */
  function place(tl, c, at, o) {
    o = o || {};
    var v = {};
    if (o.x != null) { v.x = o.x; c.s.x = o.x; }
    if (o.y != null) { v.y = o.y; c.s.y = o.y; }
    if (o.visible != null) { v.opacity = o.visible ? 1 : 0; c.s.op = v.opacity; }
    if (!c.n || at == null) gsap.set(c.p.cw, v); else set(tl, c.p.cw, v, at);
    return tl;
  }

  /* ------------------------------------------------------------------ the face */

  /** Change the eyes: "open", "happy" (^ ^), "content" (◡ ◡), "closed", "squint", "wide", "small", "x", "angry", "sad", "heart". */
  function face(tl, c, at, name) {
    if (!EXPR[name]) throw new Error("RC.clawd.face: no expression " + name + " (" + Object.keys(EXPR).join(", ") + ")");
    Object.keys(c.p.variants).forEach(function (n) { set(tl, c.p.variants[n], { opacity: n === name ? 1 : 0 }, at); });
    c.exprs.push([at, name]); c.exprs.sort(function (a, b) { return a[0] - b[0]; });
    c.s.expr = name;
    return tl;
  }
  /** One blink: the eyes shut for a few frames, as a held pose. */
  function blink(tl, c, at, o) {
    var shut = (o && o.hold) || 0.11;
    set(tl, [c.p.eye.l, c.p.eye.r], { scaleY: 0.14 }, at);
    set(tl, [c.p.eye.l, c.p.eye.r], { scaleY: 1 }, at + shut);
    busy(c, "blink", at, at + shut);
    return tl;
  }
  /** Where the eyes point, in units within the face (x ±0.5 reaches its edge, y ±0.4). */
  function gaze(tl, c, at, gx, gy, dur) {
    tw(tl, c.p.gaze, { x: c.s.gx, y: c.s.gy }, { x: gx, y: gy }, at, dur == null ? 0.14 : dur, "power2.out");
    c.s.gx = gx; c.s.gy = gy;
    busy(c, "gaze", at, at + (dur == null ? 0.14 : dur));
    return tl;
  }

  /* ------------------------------------------------------------------ the body */

  /** Move the torso (units, degrees) and the legs with it. */
  function torso(tl, c, at, to, dur, ease) {
    tw(tl, c.p.torso, { x: c.s.tx, y: c.s.ty, rotation: c.s.tr }, { x: to.x != null ? to.x : c.s.tx, y: to.y != null ? to.y : c.s.ty, rotation: to.r != null ? to.r : c.s.tr }, at, dur, ease);
    if (to.x != null) c.s.tx = to.x; if (to.y != null) c.s.ty = to.y; if (to.r != null) c.s.tr = to.r;
  }
  function legs(tl, c, at, to, dur, ease, which) {
    (which || [0, 1, 2, 3]).forEach(function (i) {
      var s = c.s.legs[i], t = to[i] || to;
      var nx = { r: t.r != null ? t.r : s.r, sy: t.sy != null ? t.sy : s.sy, y: t.y != null ? t.y : s.y };
      tw(tl, c.p.legs[i], { rotation: s.r, scaleY: s.sy, y: s.y }, { rotation: nx.r, scaleY: nx.sy, y: nx.y }, at, dur, ease);
      c.s.legs[i] = nx;
    });
  }
  /** Named arm poses, as offsets from where the arm hangs (units). */
  var ARMS = {
    down: { x: 0, y: 0, r: 0 }, up: { x: 0, y: -3.4, r: 0 }, cheer: { x: -0.35, y: -3.7, r: -8 }, out: { x: -1.1, y: -0.5, r: 0 },
    hold: { x: 0.2, y: -1.1, r: 0 }, high: { x: 0.4, y: -4.4, r: 0 }, low: { x: 0, y: 0.7, r: 0 }, front: { x: 1.3, y: -0.6, r: 0 },
  };
  function armPose(side, p) {
    if (typeof p !== "string") return p;
    var a = ARMS[p] || ARMS.down, m = side === "l" ? 1 : -1;   // poses are written for the left arm; the right mirrors
    return { x: a.x * m, y: a.y, r: a.r * m };
  }
  /** Move one or both arms: { l: "up", r: { x, y, r } }, over `dur` (default .16 s). */
  function arms(tl, c, at, o) {
    o = o || {};
    ["l", "r"].forEach(function (side) {
      if (o[side] == null) return;
      var p = armPose(side, o[side]), s = c.s.arms[side];
      var nx = { x: p.x != null ? p.x : s.x, y: p.y != null ? p.y : s.y, r: p.r != null ? p.r : s.r };
      tw(tl, c.p.arm[side], { x: s.x, y: s.y, rotation: s.r }, { x: nx.x, y: nx.y, rotation: nx.r }, at, o.dur == null ? 0.16 : o.dur, o.ease || "power2.out");
      c.s.arms[side] = nx;
    });
    busy(c, "arms", at, at + (o.dur == null ? 0.16 : o.dur));
    return tl;
  }
  function fig(tl, c, at, to, dur, ease) {
    tw(tl, c.p.fig, { y: c.s.hy, scaleX: c.s.sx, scaleY: c.s.sy }, { y: to.y != null ? to.y : c.s.hy, scaleX: to.sx != null ? to.sx : c.s.sx, scaleY: to.sy != null ? to.sy : c.s.sy }, at, dur, ease);
    if (to.y != null) c.s.hy = to.y; if (to.sx != null) c.s.sx = to.sx; if (to.sy != null) c.s.sy = to.sy;
  }
  function shadowTo(tl, c, at, k, dur, ease) {
    if (!c.p.shadowG) return;
    tw(tl, c.p.shadowG, { scaleX: c.s.shadow, scaleY: c.s.shadow, opacity: 0.45 + 0.55 * c.s.shadow }, { scaleX: k, scaleY: k, opacity: 0.45 + 0.55 * k }, at, dur, ease);
    c.s.shadow = k;
  }

  /* ------------------------------------------------------------------ moving */

  /**
   * Walk to `to` (px): steps of .15 s, legs swinging from the hips in pairs, the body bobbing, the eyes leading.
   * `speed` in Clawd-widths a second (default 1.1), `look: false` keeps the eyes where they are.
   */
  function walk(tl, c, at, o) {
    o = o || {};
    var x0 = c.s.x, x1 = o.to != null ? o.to : x0 + (o.by || 0), dist = Math.abs(x1 - x0);
    if (dist < 1) return tl;
    var dir = x1 > x0 ? 1 : -1, step = o.step || 0.15, speed = (o.speed || 1.1) * c.size;
    var n = Math.max(2, Math.round(dist / speed / step)); if (n % 2) n++;
    var dur = n * step, A = 15;
    tw(tl, c.p.cw, { x: x0 }, { x: x1 }, at, dur, o.ease || "none");
    c.s.x = x1;
    if (o.look !== false) gaze(tl, c, at, 0.5 * dir, c.s.gy, 0.1);
    var ty = c.s.ty;
    for (var k = 0; k < n; k++) {
      var t = at + k * step, swing = k % 2 ? [1, 3] : [0, 2], plant = k % 2 ? [0, 2] : [1, 3];
      tw(tl, c.p.torso, { y: ty }, { y: ty - 0.3 }, t, step / 2, "sine.out");
      tw(tl, c.p.torso, { y: ty - 0.3 }, { y: ty }, t + step / 2, step / 2, "sine.in");
      // The swinging pair lifts and travels ahead; the planted pair pushes back. Positive rotation moves a foot left.
      swing.forEach(function (i) {
        var s = c.s.legs[i];
        tw(tl, c.p.legs[i], { rotation: s.r, y: 0 }, { rotation: -A * dir, y: -0.45 }, t, step / 2, "sine.out");
        tw(tl, c.p.legs[i], { rotation: -A * dir, y: -0.45 }, { rotation: -A * dir * 0.6, y: 0 }, t + step / 2, step / 2, "sine.in");
        c.s.legs[i] = { r: -A * dir * 0.6, sy: s.sy, y: 0 };
      });
      plant.forEach(function (i) {
        var s = c.s.legs[i];
        tw(tl, c.p.legs[i], { rotation: s.r }, { rotation: A * dir * 0.6 }, t, step, "none");
        c.s.legs[i] = { r: A * dir * 0.6, sy: s.sy, y: 0 };
      });
      emit("step", t, c);
    }
    legs(tl, c, at + dur, { r: 0, y: 0 }, 0.09, "power2.out");
    if (o.look !== false && o.keepGaze !== true) gaze(tl, c, at + dur + 0.05, 0, c.s.gy, 0.16);
    busy(c, "move", at, at + dur + 0.1);
    return tl;
  }

  /**
   * Hop: a 0.1 s crouch, a parabolic arc (up on sine.out, down on power3.in, sideways on power1.inOut), and a landing
   * the hands overshoot. `to` (px) to travel, `y` (px) to land somewhere higher or lower, `height` in units (3.2),
   * `air` in seconds. `cheer: true` throws the arms up and the eyes to ^ ^ while airborne.
   */
  function hop(tl, c, at, o) {
    o = o || {};
    var x0 = c.s.x, x1 = o.to != null ? o.to : x0, y0 = c.s.y, y1 = o.y != null ? o.y : y0;
    var travel = Math.abs(x1 - x0) / c.u;
    var air = o.air || Math.min(0.8, 0.46 + travel * 0.025), h = o.height == null ? 3.2 + Math.max(0, (y0 - y1) / c.u) : o.height;
    var t0 = at, t1 = at + 0.1, tL = t1 + air;
    // Gather: the body dips and the hands drop with it, quickly.
    var ty = c.s.ty;
    torso(tl, c, t0, { y: ty + 0.8 }, 0.1, "power3.in");
    var al = c.s.arms.l, ar = c.s.arms.r;
    tw(tl, c.p.arm.l, { y: al.y }, { y: al.y + 0.9 }, t0, 0.1, "power3.in");
    tw(tl, c.p.arm.r, { y: ar.y }, { y: ar.y + 0.9 }, t0, 0.1, "power3.in");
    // Launch: stretch, travel, rise and fall.
    torso(tl, c, t1, { y: ty }, 0.12, "power2.out");
    tw(tl, c.p.arm.l, { y: al.y + 0.9 }, { y: al.y - 0.5 }, t1, 0.16, "power2.out");
    tw(tl, c.p.arm.r, { y: ar.y + 0.9 }, { y: ar.y - 0.5 }, t1, 0.16, "power2.out");
    fig(tl, c, t1, { sx: 0.92, sy: 1.1 }, 0.12, "power2.out");
    fig(tl, c, t1 + 0.12, { sx: 1, sy: 1 }, 0.2, "power2.inOut");
    if (x1 !== x0 || y1 !== y0) tw(tl, c.p.cw, { x: x0, y: y0 }, { x: x1, y: y1 }, t1, air, "power1.inOut");
    c.s.x = x1; c.s.y = y1;
    var hy = c.s.hy;
    tw(tl, c.p.fig, { y: hy }, { y: hy - h }, t1, air * 0.5, "sine.out");
    tw(tl, c.p.fig, { y: hy - h }, { y: hy }, t1 + air * 0.62, air * 0.38, "power3.in");
    shadowTo(tl, c, t1, 0.55, air * 0.5, "sine.out");
    shadowTo(tl, c, t1 + air * 0.62, 1, air * 0.38, "power3.in");
    // In the air the legs splay; they come back under it as it lands.
    legs(tl, c, t1, [{ r: 14 }, { r: 8 }, { r: -8 }, { r: -14 }], 0.12, "power2.out");
    legs(tl, c, tL - 0.08, { r: 0 }, 0.08, "power2.in");
    if (o.cheer) {
      var was = c.s.expr;
      emit("cheer", t1, c);
      face(tl, c, t1, "happy");
      arms(tl, c, t1, { l: "cheer", r: "cheer", dur: 0.14 });
      arms(tl, c, tL - 0.04, { l: "down", r: "down", dur: 0.12 });
      face(tl, c, tL + 0.3, was === "happy" ? "open" : was);
    }
    // Land: squash, the hands overshoot down for a moment, then settle.
    fig(tl, c, tL, { sx: 1.12, sy: 0.85 }, 0.06, "power2.out");
    fig(tl, c, tL + 0.06, { sx: 1, sy: 1 }, 0.18, "power2.out");
    var al2 = c.s.arms.l.y, ar2 = c.s.arms.r.y;
    tw(tl, c.p.arm.l, { y: o.cheer ? al2 : al.y - 0.5 }, { y: al2 + 0.6 }, tL, 0.05, "power2.out");
    tw(tl, c.p.arm.r, { y: o.cheer ? ar2 : ar.y - 0.5 }, { y: ar2 + 0.6 }, tL, 0.05, "power2.out");
    tw(tl, c.p.arm.l, { y: al2 + 0.6 }, { y: al2 }, tL + 0.05, 0.12, "power2.out");
    tw(tl, c.p.arm.r, { y: ar2 + 0.6 }, { y: ar2 }, tL + 0.05, 0.12, "power2.out");
    if (o.dust !== false) dust(tl, c, tL);
    emit("hop", t1, c); emit("land", tL, c);
    c.marks.land = tL;
    busy(c, "move", t0, tL + 0.24);
    return tl;
  }
  /** A hop on the spot. `cheer: true` for joy. */
  function jump(tl, c, at, o) { return hop(tl, c, at, Object.assign({ height: 2.6 }, o || {}, { to: c.s.x })); }

  /**
   * Look somewhere: "left", "right", "up", "down", "center", or an element or [x, y]. A look to the side leans the
   * body into it, the legs stretching to keep their feet on the ground (Anthropic's look-around). `back` (s) returns.
   */
  function look(tl, c, at, o) {
    o = typeof o === "string" ? { at: o } : (o || {});
    var to = o.at, gx = 0, gy = 0;
    if (to === "left") gx = -0.5; else if (to === "right") gx = 0.5; else if (to === "up") gy = -0.4; else if (to === "down") gy = 0.35;
    else if (to === "up-left") { gx = -0.45; gy = -0.35; } else if (to === "up-right") { gx = 0.45; gy = -0.35; }
    else if (to !== "center" && to !== "camera" && to != null) {
      var p = pointOf(c, to), hd = headOf(c);
      if (p) { var dx = p.x - hd.x, dy = p.y - hd.y, len = Math.max(1, Math.sqrt(dx * dx + dy * dy)); gx = 0.5 * dx / len; gy = 0.4 * dy / len; if (Math.abs(dx) < c.size * 0.3) gx *= 0.6; }
    }
    var dur = o.dur || 0.4;
    gaze(tl, c, at, gx, gy, Math.min(0.2, dur));
    var lean = o.lean !== false && Math.abs(gx) > 0.3;
    if (lean) {
      var d = gx < 0 ? -1 : 1;
      torso(tl, c, at, { x: 0.28 * d, y: -0.47, r: 3 * d }, dur, "power2.out");
      var rots = d < 0 ? [-7, -8, -8, -9] : [9, 8, 8, 7], sys = d < 0 ? [1.35, 1.3, 1.2, 1.15] : [1.15, 1.2, 1.3, 1.35];
      legs(tl, c, at, [0, 1, 2, 3].map(function (i) { return { r: rots[i], sy: sys[i] }; }), dur, "power2.out");
    } else if (c.s.tr || c.s.tx || c.s.ty) {
      torso(tl, c, at, { x: 0, y: 0, r: 0 }, dur * 0.8, "power2.inOut");
      legs(tl, c, at, { r: 0, sy: 1 }, dur * 0.8, "power2.inOut");
    }
    busy(c, "gaze", at, at + dur);
    if (o.back) look(tl, c, at + dur + o.back, { at: "center" });
    return tl;
  }

  /** Wave one arm (default the right): raised, side to side `times` times, lowered. Happy eyes unless `happy: false`. */
  function wave(tl, c, at, o) {
    o = o || {};
    var side = o.arm || "r", m = side === "l" ? -1 : 1, times = o.times || 3, beat = o.beat || 0.13;
    var was = c.s.expr, start = Object.assign({}, c.s.arms[side]);
    if (o.happy !== false) face(tl, c, at, "happy");
    arms(tl, c, at, keyed(side, { x: 0.35 * m, y: -2.7, r: 0 }, { dur: 0.16 }));
    emit("wave", at + 0.16, c);
    var t = at + 0.16;
    for (var i = 0; i < times * 2; i++) {
      var a = c.s.arms[side], nx = i % 2 ? 0.35 * m : 1.0 * m, nr = i % 2 ? -6 * m : 12 * m;
      tw(tl, c.p.arm[side], { x: a.x, rotation: a.r }, { x: nx, rotation: nr }, t, beat, "sine.inOut");
      c.s.arms[side] = { x: nx, y: a.y, r: nr };
      t += beat;
    }
    arms(tl, c, t, keyed(side, start, { dur: 0.2, ease: "power2.inOut" }));
    if (o.happy !== false) face(tl, c, t + 0.1, was === "happy" ? "open" : was);
    busy(c, "arms", at, t + 0.2);
    return tl;
  }

  /** Point at something with the arm nearest it: out, at its height, held for `hold` s (default .9), then back. */
  function point(tl, c, at, o) {
    o = o || {};
    var p = pointOf(c, o.at), side = o.arm || (p && p.x < c.s.x ? "l" : "r"), m = side === "l" ? -1 : 1;
    var dy = p ? Math.max(-2.6, Math.min(1.2, (p.y - (c.s.y - 5 * c.u)) / c.u)) : -0.8;
    var start = Object.assign({}, c.s.arms[side]);
    arms(tl, c, at, keyed(side, { x: 1.3 * m, y: dy, r: 0 }, { dur: 0.14 }));
    if (o.look !== false) look(tl, c, at, { at: o.at || (side === "l" ? "left" : "right"), lean: false, dur: 0.2 });
    if (o.hold !== false) arms(tl, c, at + 0.14 + (o.hold || 0.9), keyed(side, start, { dur: 0.18, ease: "power2.inOut" }));
    return tl;
  }

  /** Crouch (units, default .8) and stand. */
  function crouch(tl, c, at, o) {
    o = o || {};
    torso(tl, c, at, { y: o.depth == null ? 0.8 : o.depth }, o.dur || 0.12, "power3.in");
    if (o.hold !== false) torso(tl, c, at + (o.dur || 0.12) + (o.hold || 0.25), { y: 0 }, 0.16, "power2.out");
    return tl;
  }

  /**
   * Enter from "left" / "right" (walking in from off the frame), "top" (falls in and lands), "pop" (appears in three
   * held frames). `to` (px) is where it ends; by default where it was placed.
   */
  function enter(tl, c, at, o) {
    o = o || {};
    var to = o.to != null ? o.to : c.s.x, from = o.from || (to > c.W / 2 ? "right" : "left");
    if (from === "left" || from === "right") {
      place(tl, c, c.n ? at : null, { x: from === "left" ? -c.size * 0.65 : c.W + c.size * 0.65, visible: true });
      return o.hop ? hop(tl, c, at, { to: to }) : walk(tl, c, at, { to: to, speed: o.speed });
    }
    if (from === "top") {
      var hFall = (c.s.y + c.size) / c.u;
      place(tl, c, c.n ? at : null, { x: to, visible: true });
      gsap.set(c.p.fig, { y: -hFall }); c.s.hy = -hFall;
      if (c.n) set(tl, c.p.fig, { y: -hFall }, at);
      legs(tl, c, at, [{ r: 14 }, { r: 8 }, { r: -8 }, { r: -14 }], 0.1);
      tw(tl, c.p.fig, { y: -hFall }, { y: 0 }, at, o.dur || 0.42, "power2.in");
      c.s.hy = 0;
      var tL = at + (o.dur || 0.42);
      legs(tl, c, tL - 0.06, { r: 0 }, 0.06, "power2.in");
      fig(tl, c, tL, { sx: 1.16, sy: 0.8 }, 0.06, "power2.out");
      fig(tl, c, tL + 0.06, { sx: 1, sy: 1 }, 0.2, "power2.out");
      dust(tl, c, tL);
      emit("land", tL, c);
      busy(c, "move", at, tL + 0.26);
      return tl;
    }
    // pop: three held frames, the way a sprite appears.
    place(tl, c, c.n ? at : null, { x: to, visible: true });
    gsap.set(c.p.fig, { scaleX: 0, scaleY: 0 });
    [[0.45, 0.45], [1.12, 1.12], [1, 1]].forEach(function (s, i) { set(tl, c.p.fig, { scaleX: s[0], scaleY: s[1] }, at + i * 0.05); });
    c.s.sx = 1; c.s.sy = 1;
    emit("pop", at, c);
    busy(c, "move", at, at + 0.15);
    return tl;
  }
  /** Leave: walk off "left" / "right", jump off the "top", or "poof" (three held frames down to nothing). */
  function exit(tl, c, at, o) {
    o = o || {};
    var to = o.to || (c.s.x > c.W / 2 ? "right" : "left");
    if (to === "left" || to === "right") return walk(tl, c, at, { to: to === "left" ? -c.size * 0.7 : c.W + c.size * 0.7, speed: o.speed || 0.9 });
    if (to === "top") {
      hop(tl, c, at, { height: (c.s.y + c.size) / c.u + 2, air: 0.5 });
      return tl;
    }
    [[1.12, 1.12], [0.45, 0.45], [0, 0]].forEach(function (s, i) { set(tl, c.p.fig, { scaleX: s[0], scaleY: s[1] }, at + i * 0.05); });
    c.s.sx = 0; c.s.sy = 0;
    sparkles(tl, c, at + 0.05, { n: 4, radius: 3.2 });
    emit("pop", at, c);
    busy(c, "move", at, at + 0.15);
    return tl;
  }

  /* ------------------------------------------------------------------ effects (on the half-unit grid) */

  var SPARK = [".y.", "yWy", ".y."], SPARK_BIG = ["..y..", "..y..", "yyWyy", "..y..", "..y.."];
  var HEART = [".rr.rr.", "rrrrrrr", "rrrrrrr", ".rrrrr.", "..rrr..", "...r..."];
  var ZED = ["zzzz", "..z.", ".z..", "zzzz"];
  var DROP = [".b.", "bbb", "bWb", ".b."];
  var MARKS = { "!": [".k.", ".k.", ".k.", "...", ".k."], "?": ["kkk", "..k", ".kk", "...", ".k."] };

  /** A small sprite in the fx layer at (x, y) units from the feet, its pivot at its centre. */
  function sprite(c, rows, colors, x, y, cell) {
    cell = cell || 0.5;
    var w = rows[0].length * cell, h = rows.length * cell;
    var g = grp("cw-sprite", c.p.fx);
    bitmap(g, rows, colors, cell, -w / 2, -h / 2);
    gsap.set(g, { x: x, y: y, scale: 0, svgOrigin: "0 0", transformOrigin: "50% 50%" });
    return g;
  }
  /** Sparkles that twinkle around Clawd in held frames. `n`, `radius` (units), `color`, `seed`. */
  function sparkles(tl, c, at, o) {
    o = o || {};
    var rnd = RC.rand(o.seed || c.seed + 31), n = o.n || 5, rad = o.radius || 6.2;
    for (var i = 0; i < n; i++) {
      // Around the upper half of the body, on an arc from the left shoulder over the head to the right one.
      var a = Math.PI * (1.12 + 0.76 * (n > 1 ? i / (n - 1) : 0.5)) + (rnd() - 0.5) * 0.3, rr = rad * (0.9 + rnd() * 0.3);
      var big = rnd() > 0.55, g = sprite(c, big ? SPARK_BIG : SPARK, { y: o.color || "#ffd23f", W: "#fff7d6" }, Math.cos(a) * rr * 1.15, -5.2 + Math.sin(a) * rr * 0.9);
      var t = at + i * 0.07 + rnd() * 0.05;
      [0.6, 1, 0.7, 1, 0.4, 0].forEach(function (s, k) { set(tl, g, { scale: s }, t + k * 0.06); });
    }
    emit("sparkle", at, c);
    return tl;
  }
  /** Hearts rising from above the head. */
  function hearts(tl, c, at, o) {
    o = o || {};
    var rnd = RC.rand(o.seed || c.seed + 47), n = o.n || 3;
    for (var i = 0; i < n; i++) {
      var x0 = (rnd() - 0.5) * 5, g = sprite(c, HEART, { r: o.color || "#e5484d" }, x0, -8.5), t = at + i * 0.22;
      set(tl, g, { scale: 1 }, t);
      tw(tl, g, { y: -8.5, x: x0, opacity: 1 }, { y: -13.5 - rnd() * 1.5, x: x0 + (rnd() - 0.5) * 2, opacity: 0 }, t, 1.2, "power1.out");
    }
    emit("pop", at, c);
    return tl;
  }
  /** A sweat drop that slides down the side of the body. */
  function sweat(tl, c, at, o) {
    o = o || {};
    var side = o.side === "l" ? -1 : 1, g = sprite(c, DROP, { b: "#6aa8ff", W: "#e6f1ff" }, 3.4 * side, -6.6);
    set(tl, g, { scale: 1 }, at);
    tw(tl, g, { y: -6.6, opacity: 1 }, { y: -4.2, opacity: 0 }, at + 0.15, o.dur || 0.9, "power1.in");
    return tl;
  }
  /** Z's drifting up from a sleeping Clawd, one every .8 s, from `at` to `until`. */
  function zzz(tl, c, at, until, o) {
    o = o || {};
    for (var t = at, i = 0; t < until - 0.4; t += 0.8, i++) {
      var g = sprite(c, ZED, { z: o.color || "#6d5bd0" }, 3.2, -8.2, 0.42 + (i % 2) * 0.12);
      set(tl, g, { scale: 1 }, t);
      tw(tl, g, { x: 3.2, y: -8.2, opacity: 1 }, { x: 5.4, y: -12.6, opacity: 0 }, t, 1.6, "sine.out");
    }
    emit("zz", at, c);
    return tl;
  }
  /** "!" or "?" over the head, popped on, held, popped off. */
  function mark(tl, c, at, o) {
    o = typeof o === "string" ? { kind: o } : (o || {});
    var g = sprite(c, MARKS[o.kind || "!"], { k: o.color || c.tokens.ink }, 0, -10.4, 0.55);
    [0.5, 1.2, 1].forEach(function (s, k) { set(tl, g, { scale: s }, at + k * 0.05); });
    set(tl, g, { scale: 0 }, at + (o.dur || 1.1));
    emit("pop", at, c);
    return tl;
  }
  /** Dust where the feet land. */
  function dust(tl, c, at) {
    [-1, 1].forEach(function (side) {
      for (var i = 0; i < 3; i++) {
        var g = sprite(c, ["dd", "dd"], { d: c.tokens.ink }, side * (4.6 + i * 0.6), -0.4 - i * 0.25, 0.3 - i * 0.06);
        gsap.set(g, { opacity: 0.22 });
        set(tl, g, { scale: 1 }, at);
        tw(tl, g, { x: side * (4.6 + i * 0.6), y: -0.4 - i * 0.25, opacity: 0.22 }, { x: side * (6.4 + i * 1.1), y: -1.2 - i * 0.5, opacity: 0 }, at, 0.36, "power2.out");
      }
    });
    return tl;
  }

  /* ------------------------------------------------------------------ words: a bubble, thinking */

  /** Seconds a line needs settled on screen: ~.8 s for up to three words, else .3 s a word and never under 1.2 s. */
  function readingFloor(text) { var n = String(text).trim().split(/\s+/).filter(Boolean).length; return n <= 3 ? 0.8 : Math.max(1.2, 0.3 * n); }

  /**
   * A speech bubble over Clawd with `text`, popped on in held frames. It stays at least the reading floor (plus its
   * entrance); `dur` makes it longer. `side`: "l" / "r" puts it beside the head. `px`: its type size (default 1.5 units,
   * at least 34 px).
   */
  function say(tl, c, at, o) {
    o = typeof o === "string" ? { text: o } : (o || {});
    var text = String(o.text || ""), px = o.px || Math.max(34, Math.round(c.u * 1.5)), fu = px / c.u;
    var lines = text.split("\n"), longest = Math.max.apply(null, lines.map(function (l) { return l.length; }));
    var w = Math.max(3.5, longest * fu * 0.6 + 2 * fu), h = lines.length * fu * 1.1 + 1.3 * fu;
    var side = o.side === "l" ? -1 : o.side === "r" ? 1 : 0, bx = side * (w / 2 + 1.2), by = -8.9 - h / 2 - (side ? 0 : 0.5);
    var g = grp("cw-bubble", c.p.fx);
    var x0 = bx - w / 2, y0 = by - h / 2, k = 0.5;      // corners notched by one half-unit pixel
    var ink = c.tokens.ink;
    var path = "M" + (x0 + k) + " " + y0 + "H" + (x0 + w - k) + "V" + (y0 + k) + "H" + (x0 + w) + "V" + (y0 + h - k) + "H" + (x0 + w - k) + "V" + (y0 + h) +
      "H" + (x0 + k) + "V" + (y0 + h - k) + "H" + x0 + "V" + (y0 + k) + "H" + (x0 + k) + "Z";
    node("path", { d: path, fill: "#fff", stroke: ink, "stroke-width": 0.16 }, g);
    var tx = side ? bx - side * (w / 2 - 0.6) : bx - 0.25, ty = y0 + h;
    node("path", { d: "M" + (tx - 0.5) + " " + (ty - 0.1) + "h1v0.5h-0.5v0.5h-0.5z", fill: "#fff", stroke: ink, "stroke-width": 0.16, "stroke-linejoin": "miter" }, g);
    node("rect", { x: tx - 0.42, y: ty - 0.3, width: 0.84, height: 0.36, fill: "#fff" }, g);
    label(g, lines, bx, y0 + h / 2, fu, { mono: o.mono, fill: EYE });      // dark on the white bubble, on any look
    gsap.set(g, { scale: 0, svgOrigin: tx + " " + ty });
    var hold = Math.max(o.dur || 0, readingFloor(text) + 0.15);
    [0.5, 1.08, 1].forEach(function (s, i) { set(tl, g, { scale: s }, at + i * 0.05); });
    [1.06, 0.5, 0].forEach(function (s, i) { set(tl, g, { scale: s }, at + hold + i * 0.05); });
    emit("pop", at, c);
    busy(c, "say", at, at + hold + 0.15);
    return tl;
  }

  /**
   * Thinking: Claude Code's spinner glyph turning over Clawd's head (· ✢ ✳ ✶ ✻ ✽), with an optional label
   * ("Thinking…"), eyes up, for `dur` seconds (default 1.6).
   */
  var SPIN = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
  function think(tl, c, at, o) {
    o = o || {};
    var dur = o.dur || 1.6, g = grp("cw-think", c.p.fx), size = 2.2;
    var glyphs = SPIN.map(function (ch, i) {
      var t = node("text", { x: 0, y: 0, "font-size": size, "text-anchor": "middle", "dominant-baseline": "central", fill: ORANGE, opacity: 0,
        style: "font-family: var(--font-mono), ui-monospace, monospace" }, g);
      t.textContent = ch; return t;
    });
    var lx = o.label ? 1.4 : 0;
    gsap.set(g, { x: (o.side === "l" ? -3 : 3) - lx, y: -10.2 });
    if (o.label) {
      var lab = node("text", { x: 1.4, y: 0.05, "font-size": 1.15, "dominant-baseline": "central", fill: ORANGE, opacity: 0, style: "font-family: var(--font-mono), ui-monospace, monospace" }, g);
      lab.textContent = o.label;
      set(tl, lab, { opacity: 1 }, at); set(tl, lab, { opacity: 0 }, at + dur);
    }
    var frame = 0.12, n = Math.floor(dur / frame);
    for (var i = 0; i < n; i++) {
      var cur = glyphs[i % glyphs.length], prev = glyphs[(i + glyphs.length - 1) % glyphs.length];
      if (i) set(tl, prev, { opacity: 0 }, at + i * frame);
      set(tl, cur, { opacity: 1 }, at + i * frame);
    }
    set(tl, glyphs[(n - 1) % glyphs.length], { opacity: 0 }, at + n * frame);
    if (o.look !== false) { gaze(tl, c, at, o.side === "l" ? -0.35 : 0.35, -0.35, 0.16); gaze(tl, c, at + dur, 0, 0, 0.16); }
    busy(c, "say", at, at + dur);
    return tl;
  }

  /* ------------------------------------------------------------------ life */

  /**
   * Life in the gaps, from `from` to `to`: a slow breath, seeded blinks every 2–5 s, and now and then a glance, never
   * on top of a move, a look or another blink. Schedule it after the moves, so it can see them.
   */
  function life(tl, c, from, to, o) {
    o = o || {};
    var rnd = RC.rand(o.seed || c.seed);
    // Breath: 2.6 s a cycle on the figure's height, so tiny it reads as alive rather than as motion.
    for (var t = from, up = true; t < to - 0.05; t += 1.3, up = !up) {
      var d = Math.min(1.3, to - t);
      tw(tl, c.p.breath, { scaleY: up ? 1 : 1.022, scaleX: up ? 1 : 0.992 }, { scaleY: up ? 1.022 : 1, scaleX: up ? 0.992 : 1 }, t, d, "sine.inOut");
    }
    if (o.blinks !== false) {
      for (var b = from + 0.5 + rnd() * 1.1; b < to - 0.25; b += 2.2 + rnd() * 2.6) {
        if (isBusy(c, ["blink", "gaze", "move"], b, 0.12) || !BLINKS[exprAt(c, b)]) { b -= 1.6; b += 0.4 + rnd() * 0.4; continue; }
        blink(tl, c, b);
        if (rnd() < 0.18 && b + 0.32 < to) blink(tl, c, b + 0.24);   // now and then a double blink
      }
    }
    if (o.glance !== false) {
      for (var g = from + 1.4 + rnd() * 1.4; g < to - 1.1; g += 2.6 + rnd() * 2.2) {
        if (isBusy(c, ["gaze", "move", "say"], g, 0.4) || isBusy(c, ["gaze", "move", "say"], g + 0.9, 0.2)) continue;
        var gx = (rnd() < 0.5 ? -1 : 1) * (0.32 + rnd() * 0.15), gy = (rnd() - 0.6) * 0.3;
        tw(tl, c.p.glance, { x: 0, y: 0 }, { x: gx, y: gy }, g, 0.12, "power2.out");
        tw(tl, c.p.glance, { x: gx, y: gy }, { x: 0, y: 0 }, g + 0.75, 0.14, "power2.inOut");
      }
    }
    return tl;
  }

  /* ------------------------------------------------------------------ export */

  Object.assign(clawd, {
    place: place, face: face, blink: blink, gaze: gaze, arms: arms, walk: walk, hop: hop, jump: jump, look: look, wave: wave, point: point,
    crouch: crouch, enter: enter, exit: exit, sparkles: sparkles, hearts: hearts, sweat: sweat, zzz: zzz, mark: mark, dust: dust,
    say: say, think: think, life: life, readingFloor: readingFloor,
    // For the rest of the Clawd kit (acts, props, the pack): its drawing, its spec and its scheduling.
    _: { keyed: keyed, node: node, grp: grp, bitmap: bitmap, cellsPath: cellsPath, sprite: sprite, tw: tw, set: set, busy: busy, isBusy: isBusy, emit: emit, pointOf: pointOf,
      headOf: headOf, torso: torso, legs: legs, fig: fig, shadowTo: shadowTo, armPose: armPose, exprAt: exprAt, tokens: tokens,
      label: label, BODY: BODY, ARM: ARM, LEGS: LEGS, EYES: EYES, EXPR: EXPR, ARMS: ARMS, MATERIALS: MATERIALS, MATERIAL_OF: MATERIAL_OF, ORANGE: ORANGE, EYE: EYE },
  });
  Object.assign(window.RC, { clawd: clawd });
})();
