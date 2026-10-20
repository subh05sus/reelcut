/*
 * The graph engine: a world of nodes and links you can lay out, draw, light up, fly through and fill with images.
 * Data comes from the script (Claude writes it as JSON in the composition); up to ~500 nodes stay fast because the
 * camera moves one world layer, links are paths in one SVG, and image tiles share one sprite sheet (an atlas made
 * with `npm run graph -- atlas`). Every move is a tween on the beat's timeline, so any frame is a pure function of time.
 *
 *   var g = RC.graph(layer, data, { layout: "radial" | "tree" | "cluster", width: 1080, height: 1080, ... })
 *     data = { nodes: [{ id, label?, kind: "hub" | "chip" | "dot" | "tile" | "label", parent?, group?, sub?, image? }],
 *              links?: [{ from, to }] }            links default to parent → child
 *     image = { src } or { atlas: "assets/graph/<sha>.jpg", x, y, w, h, aw, ah } (a cell of an atlas)
 *   RC.graphDraw(tl, g, at, o)       links draw out and nodes arrive, level by level (o.levels, o.levelGap, o.duration,
 *                                    o.spread: seconds a whole level takes, o.opacity: the strength it lands at)
 *   RC.graphFocus(tl, g, at, id, o)  light one node's branch (o.mode "branch" | "path" | "both"), dim the rest to o.dim
 *   RC.graphClear(tl, g, at, o)      everything back to full strength
 *   RC.graphCamera(tl, g, at, o)     fly: o.to (a node id, [x, y] or "all") lands on o.screen ([x, y]; the frame's centre), o.zoom, o.duration, o.ease
 *   RC.graphDrift(tl, g, at, dur, o) slow ambient turn and pan of the whole world
 *   RC.graphBloom(tl, g, at, id, o)  a node's children burst out of it along their links and settle
 *   RC.graphPulse(tl, g, at, o)      a ripple: a wave travels out from a node (o.from), and every node and link it reaches
 *                                    lights up in the wave's colour, pops and settles; a soft ring of light rides the front
 *                                    (o.duration, o.color, o.dim: dim first to this, else draw the world dim; o.reach: how far it
 *                                    travels in px, o.ring, o.pop);
 *                                    a touched link keeps the wave's colour
 *   RC.graphWall(layer, items, o)    a grid of tiles; RC.graphWallIn(tl, wall, at, o) fills it (o.from "start" | "centre")
 *   RC.pathCard(layer, rows, o)      a breadcrumb card: rows [{ level: "01 Operation", value: "Differentiate", tone? }]
 *   RC.pathCardIn(tl, card, at, o)   its rows stack in, one after another
 *   RC.pathCardSet(tl, card, at, i, value)   row i's value rolls to a new one (adding the row if it is new)
 *   RC.graphTiles(n, seed)           n abstract image tiles (seeded colour fields) for a beat with no images
 */
(function () {
  var RC = window.RC, gsap = window.gsap;
  if (!RC || RC.graph) return;
  var NS = "http://www.w3.org/2000/svg";

  function el(tag, cls, parent) { var e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; }

  /** Children, depth and order from the data: a parent field, or links when there is none. */
  function structure(data) {
    var byId = {}, order = [], kids = {}, parentOf = {};
    (data.nodes || []).forEach(function (n, i) { byId[n.id] = { data: n, i: i, kids: [], depth: 0 }; order.push(n.id); });
    (data.nodes || []).forEach(function (n) { if (n.parent && byId[n.parent]) parentOf[n.id] = n.parent; });
    var links = data.links && data.links.length ? data.links.slice() : order.filter(function (id) { return parentOf[id]; }).map(function (id) { return { from: parentOf[id], to: id }; });
    links.forEach(function (l) { if (!parentOf[l.to] && byId[l.from] && byId[l.to] && l.from !== l.to) parentOf[l.to] = l.from; });
    order.forEach(function (id) { var p = parentOf[id]; if (p && byId[p]) byId[p].kids.push(id); });
    var roots = order.filter(function (id) { return !parentOf[id] || !byId[parentOf[id]]; });
    var seen = {};
    (function walk(ids, d) { ids.forEach(function (id) { if (seen[id]) return; seen[id] = 1; byId[id].depth = d; walk(byId[id].kids, d + 1); }); })(roots, 0);
    return { byId: byId, order: order, roots: roots, links: links.filter(function (l) { return byId[l.from] && byId[l.to]; }), parentOf: parentOf };
  }

  /** Leaves in depth-first order: the sequence that keeps a branch together around a ring or along a row. */
  function leafOrder(s) {
    var out = [];
    (function walk(ids) { ids.forEach(function (id) { var k = s.byId[id].kids; if (!k.length) out.push(id); else walk(k); }); })(s.roots);
    return out;
  }

  function layoutTree(s, o) {
    var leaves = leafOrder(s), maxD = 0, pos = {};
    s.order.forEach(function (id) { if (s.byId[id].depth > maxD) maxD = s.byId[id].depth; });
    var x0 = o.margin, x1 = o.width - o.margin, gap = leaves.length > 1 ? (x1 - x0) / (leaves.length - 1) : 0;
    var top = o.top != null ? o.top : o.margin + 40, step = o.levelGap || Math.max(80, (o.height - top - o.margin) / Math.max(1, maxD));
    leaves.forEach(function (id, i) { pos[id] = [leaves.length > 1 ? x0 + i * gap : o.width / 2, top + s.byId[id].depth * step]; });
    (function place(ids) {
      ids.forEach(function (id) {
        var k = s.byId[id].kids;
        if (!k.length) return;
        place(k);
        var xs = k.map(function (c) { return pos[c][0]; });
        pos[id] = [(Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2, top + s.byId[id].depth * step];
      });
    })(s.roots);
    // Roots side by side when there are several (the operations along the top).
    if (s.roots.length > 1 && o.spreadRoots !== false) s.roots.forEach(function (id, i) { pos[id] = [x0 + (x1 - x0) * (i + 0.5) / s.roots.length, top]; });
    return pos;
  }

  function layoutRadial(s, o) {
    var leaves = leafOrder(s), pos = {}, ang = {}, cx = o.center[0], cy = o.center[1];
    var radii = o.radii || [0, 170, 300, 440, 560];
    leaves.forEach(function (id, i) { ang[id] = (o.startAngle || -90) + 360 * i / Math.max(1, leaves.length); });
    (function place(ids) {
      ids.forEach(function (id) {
        var k = s.byId[id].kids;
        if (!k.length) return;
        place(k);
        var a = k.map(function (c) { return ang[c]; });
        ang[id] = a.reduce(function (x, y) { return x + y; }, 0) / a.length;
      });
    })(s.roots);
    var ry = o.squash || 1, ringIndex = {}, byDepth = {};
    // Each node's place along its own ring, in angle order (for ringJitter).
    s.order.slice().sort(function (a, b) { return (ang[a] || 0) - (ang[b] || 0); }).forEach(function (id) { var d = s.byId[id].depth; byDepth[d] = (byDepth[d] || 0); ringIndex[id] = byDepth[d]++; });
    s.order.forEach(function (id) {
      var d = s.byId[id].depth, r = radii[Math.min(d, radii.length - 1)] + (d >= radii.length ? (d - radii.length + 1) * 110 : 0);
      if (d === 0 && s.roots.length > 1) r = radii[0] || 110;
      // Leaves on two or three staggered rings read as a cloud rather than a single bead necklace.
      if (o.leafJitter && !s.byId[id].kids.length && d > 0) r += ((leaves.indexOf(id) % 3) - 1) * o.leafJitter;
      // o.ringJitter { depth: px }: a crowded ring of labels steps in, middle, out, so neighbours never collide.
      if (o.ringJitter && o.ringJitter[d] && s.byId[id].kids.length) r += ((ringIndex[id] % 3) - 1) * o.ringJitter[d];
      var a = (d === 0 && s.roots.length > 1 ? (o.startAngle || -90) + 360 * s.roots.indexOf(id) / s.roots.length : ang[id]) * Math.PI / 180;
      pos[id] = [cx + Math.cos(a) * r, cy + Math.sin(a) * r * ry];
    });
    return pos;
  }

  /** Children on a sunflower spiral around their parent: the shape a bloom settles into. */
  function layoutCluster(s, o) {
    var pos = {}, golden = Math.PI * (3 - Math.sqrt(5));
    s.roots.forEach(function (id, i) { pos[id] = s.roots.length > 1 ? [o.width * (i + 0.5) / s.roots.length, o.center[1]] : o.center.slice(); });
    (function place(ids) {
      ids.forEach(function (id) {
        var k = s.byId[id].kids, p = pos[id];
        // o.start pushes the first ring out, so the spiral clears the node it blooms from.
        k.forEach(function (c, j) { var r = (o.spacing || 64) * Math.sqrt(j + (o.start || 1.4)), a = j * golden; pos[c] = [p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r]; });
        place(k);
      });
    })(s.roots);
    return pos;
  }

  function curve(a, b, layout, center) {
    if (layout === "tree") { var my = (a[1] + b[1]) / 2; return "M" + a[0] + " " + a[1] + " C" + a[0] + " " + my + " " + b[0] + " " + my + " " + b[0] + " " + b[1]; }
    // Bowed towards the centre, so links on a ring read as one sweeping system.
    var mx = (a[0] + b[0]) / 2, mmy = (a[1] + b[1]) / 2, k = 0.18;
    var qx = mx + (center[0] - mx) * k, qy = mmy + (center[1] - mmy) * k;
    return "M" + a[0] + " " + a[1] + " Q" + qx + " " + qy + " " + b[0] + " " + b[1];
  }

  /** A tile's background: an atlas cell scaled to the tile's width, a file, or a colour field. */
  function tileStyle(img, width) {
    if (!img) return "";
    if (img.atlas) {
      var k = img.w ? width / img.w : 1;
      return "background-image:url(" + img.atlas + ");background-size:" + (img.aw * k) + "px " + (img.ah * k) + "px;background-position:-" + (img.x * k) + "px -" + (img.y * k) + "px;";
    }
    if (img.src) return "background-image:url(" + img.src + ");background-size:cover;background-position:center;";
    if (img.fill) return "background:" + img.fill + ";";
    return "";
  }

  function graph(layer, data, o) {
    o = Object.assign({ layout: "radial", width: 1080, height: 1080, margin: 84, center: null, tile: 54, chipH: 34 }, o || {});
    if (!o.center) o.center = [o.width / 2, o.height / 2];
    var host = RC.one(layer);
    var s = structure(data);
    var pos = o.layout === "tree" ? layoutTree(s, o) : o.layout === "cluster" ? layoutCluster(s, o) : layoutRadial(s, o);
    if (o.positions) Object.keys(o.positions).forEach(function (id) { if (pos[id]) pos[id] = o.positions[id]; });
    // The camera moves the world; drift turns the layer inside it, so the two never fight over one transform.
    var world = el("div", "rcg-world", host);
    world.style.width = o.width + "px"; world.style.height = o.height + "px";
    var spin = el("div", "rcg-spin", world);
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "rcg-links"); svg.setAttribute("width", o.width); svg.setAttribute("height", o.height);
    svg.setAttribute("viewBox", "0 0 " + o.width + " " + o.height);
    spin.appendChild(svg);
    var nodesLayer = el("div", "rcg-nodes", spin);
    var groups = [], groupOf = {};
    s.order.forEach(function (id) {
      var n = s.byId[id].data, g = n.group;
      if (g == null) { var r = id; while (s.parentOf[r]) r = s.parentOf[r]; g = r; }
      groupOf[id] = g;
      if (groups.indexOf(g) < 0) groups.push(g);
    });
    var nodes = {};
    s.order.forEach(function (id) {
      var n = s.byId[id].data, kind = n.kind || (s.byId[id].kids.length ? (s.byId[id].depth === 0 ? "hub" : "chip") : n.image ? "tile" : "dot");
      // The node is an anchor at its point (moved by the engine); what is seen is its inner box, centred on it.
      var e = el("div", "rcg-node rcg-" + kind, nodesLayer), inner;
      var gi = groups.indexOf(groupOf[id]) % 6 + 1;
      e.style.setProperty("--c", (o.colors && o.colors[groupOf[id]]) || "var(--rcg-" + gi + ")");
      e.setAttribute("data-id", id);
      var p = pos[id] || o.center;
      e.style.left = p[0] + "px"; e.style.top = p[1] + "px";
      inner = el("div", "rcg-in", e);
      if (kind === "tile") { var sz = n.size || o.tile; inner.style.width = sz + "px"; inner.style.height = Math.round(sz * (n.ratio || (n.image && n.image.w ? n.image.h / n.image.w : 1.25))) + "px"; inner.style.cssText += tileStyle(n.image, sz); }
      if (kind === "hub" && o.hub) e.style.setProperty("--hub", o.hub + "px");
      if (kind === "hub") inner.innerHTML = (n.icon ? '<i class="rcg-ico">' + n.icon + "</i>" : "") + '<span class="rcg-t">' + (n.label || "") + "</span>";
      else if (kind === "chip") inner.innerHTML = (n.icon ? '<i class="rcg-ico">' + n.icon + "</i>" : '<i class="rcg-sw"></i>') + '<span class="rcg-t">' + (n.label || "") + "</span>";
      else if (kind === "label") inner.innerHTML = '<span class="rcg-t">' + (n.label || "") + "</span>" + (n.sub ? '<span class="rcg-sub">' + n.sub + "</span>" : "");
      else if (kind !== "tile") inner.innerHTML = n.label ? '<span class="rcg-t">' + n.label + "</span>" : "";
      nodes[id] = { id: id, data: n, kind: kind, x: p[0], y: p[1], el: e, depth: s.byId[id].depth, kids: s.byId[id].kids, parent: s.parentOf[id], group: groupOf[id] };
    });
    var links = s.links.map(function (l) {
      var a = nodes[l.from], b = nodes[l.to];
      var path = document.createElementNS(NS, "path");
      path.setAttribute("d", curve([a.x, a.y], [b.x, b.y], o.layout, o.center));
      path.setAttribute("class", "rcg-link");
      path.style.setProperty("--c", b.el.style.getPropertyValue("--c"));
      svg.appendChild(path);
      var len = path.getTotalLength ? path.getTotalLength() : Math.hypot(b.x - a.x, b.y - a.y);
      path.style.strokeDasharray = len + " " + len;
      return { from: l.from, to: l.to, el: path, len: len, depth: b.depth };
    });
    var maxDepth = 0; Object.keys(nodes).forEach(function (k) { if (nodes[k].depth > maxDepth) maxDepth = nodes[k].depth; });
    return { world: world, spin: spin, svg: svg, nodes: nodes, links: links, order: s.order, maxDepth: maxDepth, o: o };
  }

  function nodeEls(g, filter) { return g.order.filter(function (id) { return !filter || filter(g.nodes[id]); }).map(function (id) { return g.nodes[id].el; }); }

  /**
   * Level by level, outward. A level's links draw out from their parents first and its nodes arrive at the links'
   * ends; a whole level lands within o.spread seconds, so a big ring never sweeps round. o.opacity is the strength
   * it lands at (draw a world dim when a pulse is to light it).
   */
  function graphDraw(tl, g, at, o) {
    o = Object.assign({ stagger: 0.012, levelGap: 0.35, duration: 0.55, spread: 0.25, opacity: 1 }, o || {});
    var levels = o.levels != null ? o.levels : g.maxDepth;
    for (var d = 0; d <= levels; d++) {
      var t = at + d * o.levelGap;
      var ls = g.links.filter(function (l) { return l.depth === d; });
      var each = function (n) { return Math.min(o.stagger, o.spread / Math.max(1, n)); };
      if (ls.length) tl.fromTo(ls.map(function (l) { return l.el; }), { strokeDashoffset: function (i) { return ls[i].len; }, opacity: o.opacity }, { strokeDashoffset: 0, duration: o.duration * 0.8, ease: "apple.out", stagger: each(ls.length) }, t);
      var ns = nodeEls(g, function (n) { return n.depth === d; });
      if (ns.length) tl.fromTo(ns, { opacity: 0, scale: 0.6 }, { opacity: o.opacity, scale: 1, duration: o.duration, ease: "spring.gentle", stagger: each(ns.length) }, t + (d ? o.duration * 0.35 : 0));
    }
    return tl;
  }

  /** Ids on the way from a node up to its root, and everything below it. */
  function branch(g, id, mode) {
    var keep = {}, n = g.nodes[id];
    if (!n) return keep;
    if (mode !== "branch") for (var p = n; p; p = g.nodes[p.parent]) keep[p.id] = 1;
    if (mode !== "path") (function down(x) { keep[x] = 1; g.nodes[x].kids.forEach(down); })(id);
    return keep;
  }

  function graphFocus(tl, g, at, ids, o) {
    o = Object.assign({ mode: "both", dim: 0.1, duration: 0.6 }, o || {});
    var keep = {};
    [].concat(ids).forEach(function (id) { var b = branch(g, id, o.mode); Object.keys(b).forEach(function (k) { keep[k] = 1; }); });
    var on = nodeEls(g, function (n) { return keep[n.id]; }), off = nodeEls(g, function (n) { return !keep[n.id]; });
    if (off.length) tl.to(off, { opacity: o.dim, duration: o.duration, ease: "apple.out" }, at);
    if (on.length) tl.to(on, { opacity: 1, duration: o.duration, ease: "apple.out" }, at);
    var lOn = g.links.filter(function (l) { return keep[l.from] && keep[l.to]; }).map(function (l) { return l.el; });
    var lOff = g.links.filter(function (l) { return !(keep[l.from] && keep[l.to]); }).map(function (l) { return l.el; });
    if (lOff.length) tl.to(lOff, { opacity: o.dim * 0.8, strokeWidth: 1, duration: o.duration, ease: "apple.out" }, at);
    if (lOn.length) tl.to(lOn, { opacity: 1, strokeWidth: o.width || 2.6, duration: o.duration, ease: "apple.out" }, at);
    var sel = [].concat(ids).map(function (id) { return g.nodes[id] && g.nodes[id].el; }).filter(Boolean);
    if (sel.length) tl.to(sel, { "--on": 1, duration: o.duration, ease: "spring.default" }, at);
    return tl;
  }

  function graphClear(tl, g, at, o) {
    o = Object.assign({ duration: 0.6 }, o || {});
    tl.to(nodeEls(g), { opacity: 1, "--on": 0, duration: o.duration, ease: "apple.out" }, at);
    tl.to(g.links.map(function (l) { return l.el; }), { opacity: 1, strokeWidth: 1.4, duration: o.duration, ease: "apple.out" }, at);
    return tl;
  }

  /** Where the world must sit so a point lands on a spot of the frame (its centre unless `screen` says) at a zoom. */
  function framing(g, to, zoom, screen) {
    var cx = screen ? screen[0] : g.o.width / 2, cy = screen ? screen[1] : g.o.height / 2, px, py;
    if (to === "all" || to == null) { px = g.o.width / 2; py = g.o.height / 2; }
    else if (typeof to === "string") { var n = g.nodes[to]; px = n ? n.x : cx; py = n ? n.y : cy; }
    else { px = to[0]; py = to[1]; }
    return { x: cx - px * zoom, y: cy - py * zoom, scale: zoom };
  }

  function graphCamera(tl, g, at, o) {
    o = Object.assign({ to: "all", zoom: 1, duration: 1.4, ease: "spring.soft" }, o || {});
    var f = framing(g, o.to, o.zoom, o.screen);
    if (o.from) { var s = framing(g, o.from.to, o.from.zoom || 1, o.from.screen || o.screen); tl.fromTo(g.world, { x: s.x, y: s.y, scale: s.scale, transformOrigin: "0 0" }, { x: f.x, y: f.y, scale: f.scale, duration: o.duration, ease: o.ease }, at); }
    else tl.to(g.world, { x: f.x, y: f.y, scale: f.scale, transformOrigin: "0 0", duration: o.duration, ease: o.ease }, at);
    return tl;
  }

  /** Put the camera somewhere at once (the opening framing), at a time. */
  function graphFrame(tl, g, at, o) { var f = framing(g, o && o.to, (o && o.zoom) || 1, o && o.screen); tl.set(g.world, { x: f.x, y: f.y, scale: f.scale, transformOrigin: "0 0" }, at); return tl; }

  function graphDrift(tl, g, at, dur, o) {
    o = Object.assign({ rotate: 4, x: 0, y: 0 }, o || {});
    tl.fromTo(g.spin, { rotation: -o.rotate / 2, x: -o.x / 2, y: -o.y / 2 }, { rotation: o.rotate / 2, x: o.x / 2, y: o.y / 2, duration: dur, ease: "sine.inOut", transformOrigin: g.o.center[0] + "px " + g.o.center[1] + "px" }, at);
    return tl;
  }

  function graphBloom(tl, g, at, id, o) {
    o = Object.assign({ stagger: 0.025, duration: 0.8, deep: false }, o || {});
    var p = g.nodes[id];
    if (!p) return tl;
    var ids = [];
    (function down(x) { g.nodes[x].kids.forEach(function (k) { ids.push(k); if (o.deep) down(k); }); })(id);
    ids.forEach(function (k, i) {
      var n = g.nodes[k];
      tl.fromTo(n.el, { x: p.x - n.x, y: p.y - n.y, scale: 0.2, opacity: 0 }, { x: 0, y: 0, scale: 1, opacity: 1, duration: o.duration, ease: "spring.gentle" }, at + i * Math.min(o.stagger, 1.2 / ids.length));
    });
    var ls = g.links.filter(function (l) { return ids.indexOf(l.to) >= 0; });
    if (ls.length) tl.fromTo(ls.map(function (l) { return l.el; }), { strokeDashoffset: function (i) { return ls[i].len; } }, { strokeDashoffset: 0, duration: o.duration, ease: "apple.out", stagger: Math.min(o.stagger, 1.2 / ls.length) }, at);
    return tl;
  }

  function graphPulse(tl, g, at, o) {
    o = Object.assign({ from: null, duration: 1.4, dim: false, ring: true, pop: 1.14, width: 2.6 }, o || {});
    var src = typeof o.from === "string" && g.nodes[o.from] ? [g.nodes[o.from].x, g.nodes[o.from].y] : o.from || g.o.center;
    var dist = function (x, y) { return Math.hypot(x - src[0], y - src[1]); };
    var far = 1;
    g.order.forEach(function (id) { var n = g.nodes[id]; far = Math.max(far, dist(n.x, n.y)); });
    // o.reach (px) keeps a wave local: it only touches, and only dims, what lies within it.
    if (o.reach) far = Math.min(far, o.reach);
    var inReach = function (n) { return dist(n.x, n.y) <= far + 1; };
    var ids = g.order.filter(function (id) { return inReach(g.nodes[id]); });
    var links = g.links.filter(function (l) { return inReach(g.nodes[l.to]); });
    var colour = o.color || (typeof o.from === "string" && g.nodes[o.from] ? g.nodes[o.from].el.style.getPropertyValue("--c") : "var(--accent)");
    // The colour as a value, resolved once: each pulse tweens the links to its own colour, so two waves never share one.
    var probe = el("i", "", g.world); probe.style.color = colour;
    var solid = (window.getComputedStyle && getComputedStyle(probe).color) || colour;
    probe.remove();
    var when = function (d) { return at + (d / far) * o.duration; };
    // A world the wave should light is best drawn dim (graphDraw's opacity). o.dim dims it just before instead,
    // eased; only once everything has finished arriving, or the two fight over the same opacity.
    if (o.dim !== false) {
      var lead = Math.min(0.4, Math.max(0.001, at));
      tl.to(ids.map(function (id) { return g.nodes[id].el; }), { opacity: o.dim, duration: lead, ease: "apple.out" }, at - lead);
      if (links.length) tl.to(links.map(function (l) { return l.el; }), { opacity: o.dim * 0.7, duration: lead, ease: "apple.out" }, at - lead);
    }
    ids.forEach(function (id) {
      var n = g.nodes[id], t = when(dist(n.x, n.y));
      tl.to(n.el, { opacity: 1, duration: 0.3, ease: "apple.out" }, t);
      tl.to(n.el, { "--on": 1, scale: o.pop, duration: 0.16, ease: "spring.snappy" }, t);
      tl.to(n.el, { "--on": 0, scale: 1, duration: 0.5, ease: "spring.default" }, t + 0.16);
    });
    links.forEach(function (l) {
      var b = g.nodes[l.to], t = when(dist(b.x, b.y)) - 0.12;
      // A touched link keeps the wave's colour: that is what says where it went.
      tl.to(l.el, { opacity: 1, stroke: solid, strokeWidth: o.width, duration: 0.22, ease: "apple.out" }, t);
      tl.to(l.el, { strokeWidth: 1.7, duration: 0.8, ease: "apple.out" }, t + 0.25);
    });
    if (o.ring) {
      // Behind the links and the nodes: the light passes under them, never over a label.
      var ring = el("div", "rcg-aura");
      g.spin.insertBefore(ring, g.svg);
      ring.style.left = src[0] + "px"; ring.style.top = src[1] + "px";
      ring.style.width = ring.style.height = far * 2 + "px";
      ring.style.setProperty("--pulse", colour);
      tl.fromTo(ring, { scale: 0.02, opacity: 0 }, { scale: 1, duration: o.duration, ease: "none" }, at);
      tl.fromTo(ring, { opacity: 0 }, { opacity: 1, duration: 0.15, ease: "apple.out" }, at);
      tl.to(ring, { opacity: 0, duration: o.duration * 0.45, ease: "apple.out" }, at + o.duration * 0.55);
    }
    return tl;
  }

  function graphWall(layer, items, o) {
    o = Object.assign({ cols: 8, tile: 104, gap: 10, ratio: 1.25, left: 84, top: 120 }, o || {});
    var wall = el("div", "rcg-wall", RC.one(layer));
    wall.style.left = o.left + "px"; wall.style.top = o.top + "px";
    var h = Math.round(o.tile * o.ratio);
    var tiles = items.map(function (img, i) {
      var t = el("div", "rcg-node rcg-tile", wall), inner = el("div", "rcg-in", t);
      t.style.left = ((i % o.cols) * (o.tile + o.gap) + o.tile / 2) + "px"; t.style.top = (Math.floor(i / o.cols) * (h + o.gap) + h / 2) + "px";
      inner.style.width = o.tile + "px"; inner.style.height = h + "px";
      inner.style.cssText += tileStyle(img, o.tile);
      return t;
    });
    return { el: wall, tiles: tiles, o: o };
  }

  function graphWallIn(tl, wall, at, o) {
    o = Object.assign({ from: "start", stagger: 0.018, duration: 0.5 }, o || {});
    var t = wall.tiles, cols = wall.o.cols, rows = Math.ceil(t.length / cols);
    var order = t.map(function (x, i) { return i; });
    if (o.from === "centre") { var cr = (rows - 1) / 2, cc = (cols - 1) / 2; order.sort(function (a, b) { return Math.hypot(Math.floor(a / cols) - cr, a % cols - cc) - Math.hypot(Math.floor(b / cols) - cr, b % cols - cc); }); }
    var each = Math.min(o.stagger, 1.6 / Math.max(1, t.length));
    order.forEach(function (idx, k) { tl.fromTo(t[idx], { opacity: 0, scale: 0.7, y: 14 }, { opacity: 1, scale: 1, y: 0, duration: o.duration, ease: "spring.gentle" }, at + k * each); });
    return tl;
  }

  function pathCard(layer, rows, o) {
    o = Object.assign({ left: 84, top: 96, width: 520 }, o || {});
    var card = el("div", "rcg-card", RC.one(layer));
    card.style.left = o.left + "px"; card.style.top = o.top + "px"; card.style.width = o.width + "px";
    card.__rows = [];
    rows.forEach(function (r) { addRow(card, r); });
    return card;
  }
  function addRow(card, r) {
    var row = el("div", "rcg-row", card);
    row.innerHTML = '<i class="rcg-rico">' + (r.icon ? '<i class="rcg-ricon">' + r.icon + "</i>" : "") + '</i><div class="rcg-rtx"><span class="rcg-lv">' + (r.level || "") + '</span><span class="rcg-vw"><span class="rcg-v' + (r.tone ? " rcg-" + r.tone : "") + '">' + (r.value || "") + "</span></span></div>";
    card.__rows.push(row);
    return row;
  }

  function pathCardIn(tl, card, at, o) {
    o = Object.assign({ stagger: 0.32, count: null }, o || {});
    tl.fromTo(card, { opacity: 0, y: 16, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: "spring.default" }, at);
    var rows = card.__rows.slice(0, o.count == null ? card.__rows.length : o.count);
    rows.forEach(function (r, i) {
      tl.fromTo(r, { opacity: 0, height: 0, y: -8 }, { opacity: 1, height: "auto", y: 0, duration: 0.5, ease: "spring.default" }, at + 0.15 + i * o.stagger);
    });
    card.__rows.slice(rows.length).forEach(function (r) { tl.set(r, { opacity: 0, height: 0 }, at); });
    return tl;
  }

  /** Roll row i to a new value (the old one rises out, the new one rises in); a row past the end arrives. */
  function pathCardSet(tl, card, at, i, value, o) {
    o = o || {};
    var row = card.__rows[i];
    if (!row) { row = addRow(card, { level: o.level || "", value: value, icon: o.icon, tone: o.tone }); tl.fromTo(row, { opacity: 0, height: 0, y: -8 }, { opacity: 1, height: "auto", y: 0, duration: 0.5, ease: "spring.default" }, at); return tl; }
    tl.to(row, { opacity: 1, height: "auto", y: 0, duration: 0.5, ease: "spring.default" }, at);
    var wrap = row.querySelector(".rcg-vw"), old = wrap.lastElementChild;
    var nu = el("span", "rcg-v" + (o.tone ? " rcg-" + o.tone : ""), wrap);
    nu.textContent = value;
    tl.fromTo(old, { yPercent: 0, opacity: 1 }, { yPercent: -100, opacity: 0, duration: 0.42, ease: "spring.default" }, at);
    tl.fromTo(nu, { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.42, ease: "spring.default" }, at);
    if (o.icon) {
      // Both icons stay in the row and cross-fade, so seeking backwards shows the old one again.
      var box = row.querySelector(".rcg-rico"), was = box.lastElementChild || box, ni = el("i", "rcg-ricon", box);
      ni.innerHTML = o.icon;
      tl.fromTo(ni, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.42, ease: "spring.default" }, at);
      if (was !== box) tl.to(was, { opacity: 0, duration: 0.3, ease: "apple.out" }, at);
    }
    return tl;
  }

  /** n abstract image tiles: seeded colour fields, two or three bands, so a graph reads full without any real images. */
  function graphTiles(n, seed) {
    var r = RC.rand(seed || 7), out = [];
    var hues = [12, 28, 45, 160, 200, 220, 265, 330, 0, 90];
    for (var i = 0; i < n; i++) {
      var h = hues[Math.floor(r() * hues.length)], h2 = (h + 40 + Math.floor(r() * 140)) % 360, l = 30 + Math.floor(r() * 45), sp = 30 + Math.floor(r() * 45);
      // Two kinds of field: a split of two colours at an angle, or a disc on a ground. Both read as "an image".
      var fill = r() < 0.5 ? "linear-gradient(" + Math.floor(r() * 180) + "deg, hsl(" + h + " 60% " + l + "%) 0 " + sp + "%, hsl(" + h2 + " 55% " + (90 - l / 2) + "%) " + sp + "% 100%)"
        : "radial-gradient(circle at " + (20 + Math.floor(r() * 60)) + "% " + (20 + Math.floor(r() * 60)) + "%, hsl(" + h2 + " 70% 60%) 0 18%, hsl(" + h + " 40% " + l + "%) 19%)";
      out.push({ fill: fill });
    }
    return out;
  }

  Object.assign(window.RC, {
    graph: graph, graphDraw: graphDraw, graphFocus: graphFocus, graphClear: graphClear, graphCamera: graphCamera, graphFrame: graphFrame,
    graphDrift: graphDrift, graphBloom: graphBloom, graphPulse: graphPulse, graphWall: graphWall, graphWallIn: graphWallIn, pathCard: pathCard, pathCardIn: pathCardIn,
    pathCardSet: pathCardSet, graphTiles: graphTiles,
  });
})();
