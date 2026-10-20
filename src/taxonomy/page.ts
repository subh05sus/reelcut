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
  html, body { margin: 0; background: transparent; overflow: hidden; }
  #root { position: absolute; left: 0; top: 0; width: 1080px; height: 1080px; transform-origin: 0 0; border-radius: 28px; overflow: hidden; cursor: default; }
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
  #root .rcg-dot:hover .rcg-t, #root .zoomed .rcg-dot .rcg-t { opacity: 1; }
  #root .card-layer .rcg-card { transform-origin: 0 0; }
  #root .hint { position: absolute; right: 36px; bottom: 30px; font: 500 15px/1 var(--font-mono); color: var(--muted); letter-spacing: .05em; text-transform: uppercase; }
</style></head><body>
<div id="root" data-look="${args.look}" data-style="atlas" data-width="1080" data-height="1080">
  <div class="rc-atlas-grid"></div>
  <div class="cam"></div>
  <div class="card-layer"></div>
  <div class="hint">Click an operation, a domain or a technique</div>
</div>
<script>window.__timelines = {};</script>
<script>${args.kitJs}</script>
<script>
(function () {
  gsap.defaults({ overwrite: "auto" });
  var D = ${JSON.stringify(data)};
  var root = document.getElementById("root");
  function fit() { var s = Math.min(window.innerWidth, window.innerHeight) / 1080; root.style.transform = "scale(" + s + ")"; }
  fit(); window.addEventListener("resize", fit);
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
  var g = RC.graph(root.querySelector(".cam"), { nodes: nodes }, { layout: "radial", radii: [150, 300, 410, 500], squash: 0.95, leafJitter: 18, startAngle: -90, hub: 110 });
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
  function pick(id) {
    var n = g.nodes[id]; if (!n) return;
    cur = id;
    var tl = gsap.timeline(), parts = id.split("/");
    RC.graphFocus(tl, g, 0, id, { mode: "both", dim: 0.08 });
    var zoom = n.kind === "hub" ? 1.25 : n.kind === "chip" ? 1.55 : 2.0;
    RC.graphCamera(tl, g, 0, { to: [n.x * 0.6 + 540 * 0.4, n.y * 0.6 + 540 * 0.4], zoom: zoom, duration: 1.1 });
    root.classList.toggle("zoomed", n.kind === "dot");
    root.classList.add("closer");
    if (n.kind === "dot") RC.graphBloom(tl, g, 0.2, id, { stagger: 0.04, duration: 0.7 });
    setCard(tl, parts);
    if (n.kind === "dot" && window.parent !== window) window.parent.postMessage({ techniquePick: { path: id, technique: parts[2] } }, location.origin);
  }
  function out() {
    cur = null;
    var tl = gsap.timeline();
    RC.graphClear(tl, g, 0);
    RC.graphCamera(tl, g, 0, { to: "all", zoom: 0.97, duration: 1.0 });
    tl.to(card, { opacity: 0, duration: 0.3 }, 0);
    root.classList.remove("zoomed", "closer");
  }
  root.addEventListener("click", function (e) {
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
