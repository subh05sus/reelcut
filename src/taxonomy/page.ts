import type { catalogJson } from "./examples.js";

/**
 * The studio's live techniques graph: the catalog drawn by the same graph engine the reels use (kit ui/90-graph),
 * in the Atlas style. Operations sit on the inner ring, then the domains each one works through, then the
 * techniques, then the examples at the rim (your rated beats and tagged library images; patterns as colour tiles).
 *
 * Click an operation, a domain or a technique and its branch lights, the path card rolls to it and the camera
 * flies in; a technique blooms its examples and tells the page around it (postMessage `techniquePick`). The page
 * can ask for a technique the same way (`{ focusTechnique: "operation/domain/technique" }`). Click empty space to
 * go back out. It plays in real time; nothing here is rendered.
 */
export function techniquesGraphPage(args: { catalog: ReturnType<typeof catalogJson>; kitCss: string; kitJs: string; gsapUrl: string; look: string }): string {
  const c = args.catalog;
  // The examples each technique shows at the rim: images first (rated beats, library), then its patterns as tiles.
  const leaves: Record<string, { src?: string; kind: string; label: string }[]> = {};
  for (const t of c.techniques) {
    const ex: { src?: string; kind: string; label: string }[] = [];
    for (const b of t.examples.beats.filter((x) => x.frame).slice(0, 2)) ex.push({ src: `/files/create-media?path=${encodeURIComponent(b.frame!)}`, kind: b.rating === "up" ? "works" : "beat", label: `${b.beat}` });
    for (const a of t.examples.assets.slice(0, 2)) ex.push({ src: `/files/thumb/${a.id}`, kind: "asset", label: a.name });
    for (const p of t.examples.patterns.slice(0, Math.max(0, 3 - ex.length))) ex.push({ kind: "pattern", label: p.id });
    leaves[t.id] = ex;
  }
  const data = {
    operations: c.operations.map((o) => ({ id: o.id, name: o.name })),
    domains: c.domains.map((d) => ({ id: d.id, name: d.name })),
    techniques: c.techniques.map((t) => ({ id: t.id, name: t.name, domain: t.domain, operations: t.operations, timing: t.timing })),
    leaves,
  };
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark">
<script src="${args.gsapUrl}"></script>
<style>${args.kitCss}</style>
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
  #root { position: absolute; left: 0; top: 0; width: 1080px; height: 1080px; transform-origin: 0 0; border-radius: 28px; overflow: hidden; cursor: grab; touch-action: none; user-select: none; }
  #root.dragging { cursor: grabbing; }
  #root .cam { position: absolute; inset: 0; }
  #root .rcg-node { cursor: pointer; }
  #root .rcg-hub:hover, #root .rcg-chip:hover { --on: .6; }
  #root .rcg-dot .rcg-t { font-size: 13px; opacity: 0; transition: opacity .2s; }
  /* From afar the ~45 domain chips are small marks; their names show once you go in, or point at one. */
  #root:not(.closer) .rcg-chip > .rcg-in { height: 16px; padding: 0 3px; gap: 0; }
  #root:not(.closer) .rcg-chip .rcg-t { display: none; }
  #root:not(.closer) .rcg-chip:hover .rcg-t { display: inline; margin-left: 5px; font-size: 14px; }
  #root:not(.closer) .rcg-chip:hover > .rcg-in { height: 26px; padding: 0 8px 0 5px; }
  #root .rcg-chip:hover { z-index: 3; }
  #root .rcg-dot:hover .rcg-t, #root.zoomed .rcg-dot.lit .rcg-t { opacity: 1; }
  /* Zoomed in, only the lit branch is named; the rest stay quiet marks, so labels never pile up. */
  #root .rcg-chip.lit { z-index: 4; }
  #root.closer .rcg-chip:not(.lit) > .rcg-in { height: 16px; padding: 0 3px; gap: 0; }
  #root.closer .rcg-chip:not(.lit) .rcg-t { display: none; }
  #root .card-layer { position: absolute; inset: 0; pointer-events: none; z-index: 6; }
  #root .card-layer .rcg-card { transform-origin: 0 0; }
  /* The controls: zoom in, out, fit; and back out of a choice. */
  #root .ctl { position: absolute; right: 30px; top: 30px; z-index: 7; display: flex; flex-direction: column; gap: 8px; }
  #root .ctl button { all: unset; cursor: pointer; width: 52px; height: 52px; border-radius: 16px; display: grid; place-items: center; font: 500 26px/1 var(--font-sans); color: var(--ink);
    background: color-mix(in oklab, var(--card, var(--ground)) 88%, transparent); box-shadow: 0 0 0 1px var(--line, rgba(0,0,0,.1)), 0 10px 24px -12px rgba(0,0,0,.5); }
  #root .ctl button:hover { background: var(--card, var(--ground)); }
  #root .ctl .fit { font-size: 15px; font-family: var(--font-mono); letter-spacing: .04em; }
  #root .hint { position: absolute; right: 36px; bottom: 30px; font: 500 15px/1 var(--font-mono); color: var(--muted); letter-spacing: .05em; text-transform: uppercase; }
</style></head><body>
<div id="root" data-look="${args.look}" data-style="atlas" data-width="1080" data-height="1080">
  <div class="rc-atlas-grid"></div>
  <div class="cam"></div>
  <div class="card-layer"></div>
  <div class="ctl"><button class="zin" title="Zoom in" aria-label="Zoom in">+</button><button class="zout" title="Zoom out" aria-label="Zoom out">−</button><button class="fit" title="See everything (Esc)" aria-label="See everything">FIT</button></div>
  <div class="hint">Click to choose · drag to move · scroll to zoom</div>
</div>
<script>window.__timelines = {};</script>
<script>${args.kitJs}</script>
<script>
(function () {
  gsap.defaults({ overwrite: "auto" });
  var D = ${JSON.stringify(data)};
  var root = document.getElementById("root");
  // The square world, scaled to the frame and centred in it.
  var S = 1, OX = 0, OY = 0;
  function fit() {
    S = Math.min(window.innerWidth, window.innerHeight) / 1080;
    OX = (window.innerWidth - 1080 * S) / 2; OY = (window.innerHeight - 1080 * S) / 2;
    root.style.transform = "translate(" + OX + "px," + OY + "px) scale(" + S + ")";
  }
  fit(); window.addEventListener("resize", fit);
  var toRoot = function (e) { return [(e.clientX - OX) / S, (e.clientY - OY) / S]; };
  var tiles = RC.graphTiles(600, 5), ti = 0, nodes = [];
  D.operations.forEach(function (o) {
    nodes.push({ id: o.id, label: o.name, kind: "hub", group: o.id });
    D.domains.forEach(function (d) {
      var ts = D.techniques.filter(function (t) { return t.domain === d.id && t.operations.indexOf(o.id) >= 0; });
      if (!ts.length) return;
      var did = o.id + "/" + d.id;
      nodes.push({ id: did, parent: o.id, label: d.name, kind: "chip", group: o.id });
      ts.forEach(function (t) {
        var tid = did + "/" + t.id;
        nodes.push({ id: tid, parent: did, label: t.name, kind: "dot", group: o.id });
        (D.leaves[t.id] || []).forEach(function (l, k) {
          nodes.push({ id: tid + "#" + k, parent: tid, kind: "tile", group: o.id, size: 26, image: l.src ? { src: l.src } : tiles[ti++ % tiles.length] });
        });
      });
    });
  });
  var g = RC.graph(root.querySelector(".cam"), { nodes: nodes }, { layout: "radial", radii: [150, 305, 420, 505], squash: 0.95, leafJitter: 18, ringJitter: { 1: 44 }, startAngle: -90, hub: 110 });
  var card = RC.pathCard(root.querySelector(".card-layer"), [
    { level: "01 Operation", value: "—" }, { level: "02 Domain", value: "—" }, { level: "03 Technique", value: "—", tone: "mono" }, { level: "04 Timing", value: "—", tone: "italic" }
  ], { left: 36, top: 36, width: 440 });
  var intro = gsap.timeline();
  RC.graphFrame(intro, g, 0, { zoom: 1.7 });
  RC.graphDraw(intro, g, 0.1, { levelGap: 0.3, duration: 0.5 });
  RC.graphCamera(intro, g, 1.0, { to: "all", zoom: 0.97, duration: 1.6 });
  gsap.set(card, { opacity: 0 });
  var shown = [null, null, null, null];
  function name(list, id) { var x = list.filter(function (y) { return y.id === id; })[0]; return x ? x.name : id; }
  function setCard(tl, parts) {
    var vals = [parts[0] && name(D.operations, parts[0]), parts[1] && name(D.domains, parts[1]), parts[2] && name(D.techniques, parts[2]), parts[2] && (D.techniques.filter(function (t) { return t.id === parts[2]; })[0] || {}).timing];
    tl.to(card, { opacity: 1, y: 0, duration: 0.4, ease: "spring.default" }, 0);
    vals.forEach(function (v, i) { if ((v || "—") !== shown[i]) { RC.pathCardSet(tl, card, 0.06 * i, i, v || "—", { tone: i === 2 ? "mono" : i === 3 ? "italic" : undefined }); shown[i] = v || "—"; } });
  }
  var cur;
  /** The node, everything above it and everything below it: the branch that is named while zoomed in. */
  function branchOf(id) {
    var keep = {};
    for (var p = g.nodes[id]; p; p = g.nodes[p.parent]) keep[p.id] = 1;
    (function down(x) { keep[x] = 1; g.nodes[x].kids.forEach(down); })(id);
    return keep;
  }
  /**
   * The lit labels, made readable: chips that sit at nearly the same angle would overlap, so a label that collides
   * with one already placed slides down just clear of it. Only the label moves; the mark and its link stay put.
   */
  function untangle(lit) {
    g.order.forEach(function (k) { var b = g.nodes[k].el.querySelector(".rcg-in"); if (b && g.nodes[k].kind === "chip") b.style.marginTop = "0px"; });
    var placed = [];
    Object.keys(lit).map(function (k) { return g.nodes[k]; }).filter(function (m) { return m.kind === "chip"; })
      .sort(function (a, b) { return a.y - b.y || a.x - b.x; })
      .forEach(function (m) {
        var box = m.el.querySelector(".rcg-in"), w = box.offsetWidth + 8, h = box.offsetHeight + 6, y = m.y;
        for (var guard = 0; guard < 20; guard++) {
          var hit = placed.filter(function (q) { return Math.abs(q.x - m.x) < (q.w + w) / 2 && Math.abs(q.y - y) < (q.h + h) / 2; })[0];
          if (!hit) break;
          y = hit.y + (hit.h + h) / 2;
        }
        placed.push({ x: m.x, y: y, w: w, h: h });
        box.style.transition = "margin-top .35s cubic-bezier(.2,0,0,1)";
        box.style.marginTop = (y - m.y) + "px";
      });
  }
  function pick(id) {
    var n = g.nodes[id]; if (!n) return;
    cur = id;
    var lit = branchOf(id);
    g.order.forEach(function (k) { g.nodes[k].el.classList.toggle("lit", !!lit[k]); });
    var tl = gsap.timeline(), parts = id.split("/");
    RC.graphFocus(tl, g, 0, id, { mode: "both", dim: 0.08 });
    // Frame the lit branch itself, clear of the path card in the top-left, at the zoom that fits it.
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    Object.keys(lit).forEach(function (k) { var m = g.nodes[k]; if (n.kind === "hub" && m.kind === "tile") return; x0 = Math.min(x0, m.x); y0 = Math.min(y0, m.y); x1 = Math.max(x1, m.x); y1 = Math.max(y1, m.y); });
    var w = Math.max(160, x1 - x0 + 120), h = Math.max(160, y1 - y0 + 120);
    var zoom = Math.max(0.9, Math.min(n.kind === "dot" ? 2.6 : 2.2, Math.min(860 / w, 640 / h)));
    RC.graphCamera(tl, g, 0, { to: [(x0 + x1) / 2, (y0 + y1) / 2], screen: [560, 650], zoom: zoom, duration: 1.1 });
    root.classList.toggle("zoomed", n.kind === "dot");
    root.classList.add("closer");
    untangle(lit); // measured now that the lit labels are showing
    if (n.kind === "dot") RC.graphBloom(tl, g, 0.2, id, { stagger: 0.04, duration: 0.7 });
    setCard(tl, parts);
    if (window.parent !== window) {
      if (n.kind === "dot") window.parent.postMessage({ techniquePick: { path: id, technique: parts[2] } }, location.origin);
      else window.parent.postMessage({ graphPick: { operation: parts[0], domain: parts[1] || "" } }, location.origin);
    }
  }
  function out() {
    cur = null;
    var tl = gsap.timeline();
    RC.graphClear(tl, g, 0);
    RC.graphCamera(tl, g, 0, { to: "all", zoom: 0.97, duration: 1.0 });
    tl.to(card, { opacity: 0, duration: 0.3 }, 0);
    root.classList.remove("zoomed", "closer");
    g.order.forEach(function (k) { g.nodes[k].el.classList.remove("lit"); var b = g.nodes[k].el.querySelector(".rcg-in"); if (b && g.nodes[k].kind === "chip") b.style.marginTop = "0px"; });
    if (window.parent !== window) window.parent.postMessage({ graphPick: { operation: "", domain: "" } }, location.origin);
  }
  // Moving around by hand: drag to pan, scroll or pinch to zoom about the pointer, the buttons, Escape to see it all.
  var cam = function () { return { x: gsap.getProperty(g.world, "x"), y: gsap.getProperty(g.world, "y"), z: gsap.getProperty(g.world, "scale") }; };
  function zoomAbout(px, py, factor, dur) {
    var c = cam(), z = Math.max(0.5, Math.min(4, c.z * factor)), wx = (px - c.x) / c.z, wy = (py - c.y) / c.z;
    gsap.to(g.world, { x: px - wx * z, y: py - wy * z, scale: z, duration: dur, ease: "apple.out", transformOrigin: "0 0" });
    root.classList.toggle("closer", z > 1.15 || !!cur);
  }
  root.addEventListener("wheel", function (e) {
    e.preventDefault();
    var p = toRoot(e);
    zoomAbout(p[0], p[1], Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), 0.25);
  }, { passive: false });
  var drag = null, moved = false;
  root.addEventListener("pointerdown", function (e) {
    if (e.target.closest(".ctl")) return;
    var c = cam(); drag = { p: toRoot(e), x: c.x, y: c.y }; moved = false;
  });
  window.addEventListener("pointermove", function (e) {
    if (!drag) return;
    var p = toRoot(e), dx = p[0] - drag.p[0], dy = p[1] - drag.p[1];
    if (!moved && Math.hypot(dx, dy) < 5) return;
    if (!moved) { moved = true; root.classList.add("dragging"); }
    gsap.killTweensOf(g.world, "x,y");
    gsap.set(g.world, { x: drag.x + dx, y: drag.y + dy });
  });
  window.addEventListener("pointerup", function () { drag = null; root.classList.remove("dragging"); });
  root.querySelector(".zin").addEventListener("click", function (e) { e.stopPropagation(); zoomAbout(540, 540, 1.4, 0.4); });
  root.querySelector(".zout").addEventListener("click", function (e) { e.stopPropagation(); zoomAbout(540, 540, 1 / 1.4, 0.4); });
  root.querySelector(".fit").addEventListener("click", function (e) { e.stopPropagation(); out(); });
  window.addEventListener("keydown", function (e) { if (e.key === "Escape") out(); });
  root.addEventListener("click", function (e) {
    if (moved) { moved = false; return; }
    if (e.target.closest(".ctl")) return;
    var el = e.target.closest(".rcg-node");
    if (!el) return out();
    var id = el.getAttribute("data-id");
    if (g.nodes[id] && g.nodes[id].kind === "tile") id = g.nodes[id].parent;
    pick(id);
  });
  window.addEventListener("message", function (e) {
    if (e.origin !== location.origin || !e.data) return;
    if (e.data.focusTechnique) {
      var p = String(e.data.focusTechnique).split("/");
      var id = p.slice(0, 3).join("/");
      if (!g.nodes[id]) { var t = D.techniques.filter(function (x) { return x.id === p[p.length - 1] || x.id === p[2]; })[0]; if (t) id = t.operations[0] + "/" + t.domain + "/" + t.id; }
      pick(id);
    }
    if (e.data.focusOut) out();
  });
})();
</script></body></html>`;
}
