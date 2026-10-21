import type { BoardBrand } from "./board.js";

/**
 * The client's approval board: the stages the owner has sent, each item with what it is (in plain words), its clip,
 * and Approve or Ask for a change. Self-contained, dark, Apple-like, like the review page it sits beside.
 *
 * Asking for a change on a clip can mark the frame: pause it, tap a spot to pin it or drag to draw over it. An item
 * sent back after a change shows the version the client saw before beside the new one, with what they asked. The
 * owner's name, colour and logo head the page when they have set them.
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function boardPage(token: string, title: string, brand: BoardBrand = {}): string {
  const base = `/r/${token}`;
  const accent = brand.accent && /^#[0-9a-f]{6}$/i.test(brand.accent) ? brand.accent : "#ff9230";
  const head = brand.name || brand.logo
    ? `<div class="brand">${brand.logo ? `<img src="${base}/brand-logo" alt="">` : ""}${brand.name ? `<span>${esc(brand.name)}</span>` : ""}</div>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex"><title>${esc(title)} · approval</title>
<style>
:root { color-scheme: dark; --bg: #000; --cell: #1c1c1e; --elev: #2c2c2e; --label: #fff; --label-2: rgb(235 235 245 / .6); --fill: rgb(118 118 128 / .24); --accent: ${accent}; --green: #30d158; --red: #ff453a; --sep: rgb(84 84 88 / .6); --ease: cubic-bezier(.2,0,0,1); }
* { box-sizing: border-box; } body { margin: 0; background: var(--bg); color: var(--label); font: 15px/20px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
main { max-width: 1040px; margin: 0 auto; padding: 24px 16px 80px; }
.brand { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; font-weight: 600; font-size: 15px; } .brand img { height: 32px; max-width: 160px; object-fit: contain; }
h1 { margin: 0; font-size: 28px; line-height: 34px; letter-spacing: -.01em; } .sub { color: var(--label-2); font-size: 13px; margin: 4px 0 20px; }
.who { display: flex; gap: 8px; align-items: center; margin-bottom: 20px; } .who input { max-width: 260px; }
.steps { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 20px; } .steps span { padding: 6px 12px; border-radius: 999px; background: var(--fill); font-size: 13px; color: var(--label-2); }
.steps span.on { background: var(--accent); color: #000; font-weight: 600; } .steps span.ok { background: rgb(48 209 88 / .2); color: var(--green); }
section { margin-bottom: 32px; } h2 { font-size: 20px; margin: 0 0 4px; } .when { color: var(--label-2); font-size: 13px; margin-bottom: 12px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; } .grid.one { grid-template-columns: minmax(0, 1fr); }
.it { background: var(--cell); border-radius: 16px; padding: 12px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.vw { position: relative; } .vw video { width: 100%; border-radius: 10px; background: #111; display: block; } .one .vw video { max-height: 70vh; }
.vw canvas { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 10px; touch-action: none; cursor: crosshair; }
.vw canvas[hidden] { display: none; } .vw.marking video { outline: 2px solid var(--accent); outline-offset: 2px; }
.ba { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; } .ba .lab { font-size: 12px; color: var(--label-2); margin-bottom: 4px; }
.ba video { width: 100%; border-radius: 10px; background: #111; display: block; } .ba pre { max-height: 30vh; }
.was { font-size: 13px; color: var(--label-2); border-left: 2px solid var(--accent); padding-left: 8px; }
.it .t { font-weight: 600; } .it .p { font-size: 15px; } .it .w { font-size: 13px; color: var(--label-2); }
.it pre { white-space: pre-wrap; font: 14px/1.5 ui-monospace, Menlo, monospace; background: var(--elev); border-radius: 10px; padding: 12px; max-height: 60vh; overflow: auto; margin: 0; }
.acts { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; } .st { font-size: 13px; } .st.ok { color: var(--green); } .st.ch { color: var(--accent); }
.marks { font-size: 13px; color: var(--label-2); }
button { font: inherit; border: 0; border-radius: 999px; height: 36px; padding: 0 16px; background: var(--fill); color: var(--label); cursor: pointer; transition: transform 150ms var(--ease); } button:active { transform: scale(.97); }
button.ok { background: var(--green); color: #000; font-weight: 600; } button.on { background: var(--accent); color: #000; } button:disabled { opacity: .4; } button.link { background: none; padding: 0 4px; height: auto; color: var(--accent); }
input, textarea { font: inherit; font-size: 16px; width: 100%; color: var(--label); background: var(--elev); border: 1px solid transparent; border-radius: 10px; padding: 10px 12px; } textarea { min-height: 64px; resize: vertical; }
input:focus, textarea:focus { outline: none; border-color: var(--accent); }
.empty { color: var(--label-2); } .toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); background: var(--elev); padding: 10px 16px; border-radius: 999px; font-size: 14px; opacity: 0; transition: opacity .2s; } .toast.on { opacity: 1; }
@media (max-width: 560px) { .ba { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style></head><body><main>
${head}<h1>${esc(title)}</h1><div class="sub">For your approval. Approve each part, or say what should change: the changes are made and sent back here.</div>
<div class="who"><input id="name" placeholder="Your name" maxlength="40" autocomplete="name"></div>
<div class="steps" id="steps"></div><div id="board"><p class="empty">Loading…</p></div></main><div class="toast" id="toast"></div>
<script>
(function () {
  var base = ${JSON.stringify(base)}, data = null, marks = {}, marking = null;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  try { $("name").value = localStorage.getItem("rc-review-name") || ""; } catch (e) {}
  function toast(t) { var el = $("toast"); el.textContent = t; el.classList.add("on"); setTimeout(function () { el.classList.remove("on"); }, 2600); }
  function load() { fetch(base + "/board").then(function (r) { return r.json(); }).then(function (d) { data = d; paint(); }); }
  function stageState(s) { if (!s.published) return "wait"; var its = s.published.items; var ds = s.decisions; if (its.every(function (x) { return ds[x.id] && ds[x.id].status === "approved"; })) return "ok"; return "on"; }
  function src(s, it, q) { return base + "/m/" + s.id + "/" + encodeURIComponent(it.id) + (q ? "?" + q : ""); }
  function key(s, it) { return s.id + "/" + it.id; }
  function markLine(k) { var ms = marks[k] || []; return ms.length ? ms.length + " mark" + (ms.length > 1 ? "s" : "") + " on the frame (" + ms.map(function (m) { return m.t.toFixed(1) + " s"; }).join(", ") + ') <button class="link" data-a="clear">Clear</button>' : ""; }
  function paint() {
    $("steps").innerHTML = data.stages.map(function (s) { var st = stageState(s); return '<span class="' + (st === "ok" ? "ok" : st === "on" ? "on" : "") + '">' + esc(s.name) + (st === "ok" ? " ✓" : st === "wait" ? " · not yet" : "") + '</span>'; }).join("");
    var shown = data.stages.filter(function (s) { return s.published; }).reverse();
    $("board").innerHTML = shown.length ? shown.map(function (s) {
      var one = s.published.items.length === 1;
      return '<section><h2>' + esc(s.name) + '</h2><div class="when">Sent ' + new Date(s.published.at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) + (s.published.version > 1 ? " · version " + s.published.version : "") + '</div><div class="grid' + (one ? " one" : "") + '">' + s.published.items.map(function (it) {
        var d = s.decisions[it.id], b = it.before, k = key(s, it);
        var video = function (q, poster, attrs) { return '<video src="' + src(s, it, q) + '" ' + (poster ? 'poster="' + src(s, it, (q ? q + "&" : "") + "poster=1") + '" ' : "") + attrs + ' playsinline preload="metadata"></video>'; };
        var now = it.media ? '<div class="vw">' + video("", it.poster, one || b ? "controls" : "muted loop autoplay") + '<canvas hidden></canvas></div>' : "";
        var body = b ? '<div class="ba"><div><div class="lab">Before</div>' + (b.media ? video("before=1", b.poster, "controls") : b.text ? "<pre>" + esc(b.text) + "</pre>" : "") + '</div><div><div class="lab">Now</div>' + (now || (it.text ? "<pre>" + esc(it.text) + "</pre>" : "")) + '</div></div><div class="was">You asked: ' + esc(b.decision.note) + (b.decision.marks ? " (" + b.decision.marks.length + " mark" + (b.decision.marks.length > 1 ? "s" : "") + ")" : "") + ' · ' + esc(b.decision.author) + '</div>'
          : now + (it.text ? '<pre>' + esc(it.text) + '</pre>' : "");
        return '<div class="it" data-s="' + s.id + '" data-i="' + esc(it.id) + '">' + body + '<div class="t">' + esc(it.title) + '</div>' + (it.plain ? '<div class="p">' + esc(it.plain) + '</div>' : "") + (it.why ? '<div class="w">' + esc(it.why) + '</div>' : "")
          + '<div class="acts">' + (d ? '<span class="st ' + (d.status === "approved" ? "ok" : "ch") + '">' + (d.status === "approved" ? "Approved" : "Change asked: " + esc(d.note)) + ' · ' + esc(d.author) + '</span>' : "") + '<button class="ok" data-a="approved">' + (d && d.status === "approved" ? "Approved" : "Approve") + '</button><button data-a="changes">Ask for a change</button></div>'
          + '<div class="ask" hidden><textarea placeholder="What should change?" maxlength="1000"></textarea>' + (it.media ? '<div class="marks" data-m>' + markLine(k) + '</div>' : "") + '<div class="acts">' + (it.media ? '<button data-a="mark">Mark it on the frame</button>' : "") + '<button data-a="send">Send</button></div></div></div>';
      }).join("") + '</div></section>';
    }).join("") : '<p class="empty">Nothing has been sent for approval yet. This page updates when it is.</p>';
    Array.prototype.forEach.call(document.querySelectorAll(".it"), bind);
  }
  function bind(el) {
    var k = el.dataset.s + "/" + el.dataset.i;
    var send = function (status, note) {
      var name = $("name").value.trim(); if (!name) { toast("Add your name first"); $("name").focus(); return; }
      try { localStorage.setItem("rc-review-name", name); } catch (e) {}
      fetch(base + "/decide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: el.dataset.s, item: el.dataset.i, status: status, note: note, name: name, marks: status === "changes" ? marks[k] || [] : [] }) })
        .then(function (r) { return r.ok ? null : r.text(); }).then(function (err) { if (err) return toast(err); delete marks[k]; marking = null; toast(status === "approved" ? "Approved. Thank you." : "Sent. It will come back here changed."); load(); })
        .catch(function () { toast("Could not send; try again."); });
    };
    el.querySelector('[data-a="approved"]').onclick = function () { send("approved"); };
    el.querySelector('[data-a="changes"]').onclick = function () { var a = el.querySelector(".ask"); a.hidden = !a.hidden; if (!a.hidden) a.querySelector("textarea").focus(); };
    el.querySelector('[data-a="send"]').onclick = function () { var t = el.querySelector("textarea").value.trim(); if (!t) return toast("Say what should change"); send("changes", t); };
    var mb = el.querySelector('[data-a="mark"]'); if (!mb) return;
    var vw = el.querySelector(".vw"), v = vw.querySelector("video"), cv = vw.querySelector("canvas"), line = el.querySelector("[data-m]");
    var refresh = function () { line.innerHTML = markLine(k); var c = line.querySelector('[data-a="clear"]'); if (c) c.onclick = function () { delete marks[k]; draw(); refresh(); }; };
    var draw = function () {
      var r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; cv.width = r.width * dpr; cv.height = r.height * dpr;
      var g = cv.getContext("2d"); g.scale(dpr, dpr); g.clearRect(0, 0, r.width, r.height); g.strokeStyle = "#ff3b30"; g.lineWidth = 4; g.lineCap = "round"; g.lineJoin = "round";
      (marks[k] || []).filter(function (m) { return Math.abs(m.t - v.currentTime) < 0.3; }).forEach(function (m) {
        if (m.x != null) { g.beginPath(); g.arc(m.x * r.width, m.y * r.height, 18, 0, Math.PI * 2); g.stroke(); }
        (m.strokes || []).forEach(function (st) { g.beginPath(); for (var i = 0; i < st.length; i += 2) g[i ? "lineTo" : "moveTo"](st[i] * r.width, st[i + 1] * r.height); g.stroke(); });
      });
    };
    mb.onclick = function () {
      var on = !vw.classList.contains("marking");
      vw.classList.toggle("marking", on); cv.hidden = !on; mb.classList.toggle("on", on); mb.textContent = on ? "Done marking" : "Mark it on the frame";
      if (on) { v.pause(); v.controls = false; marking = k; draw(); toast("Tap a spot, or draw over the frame"); } else { v.controls = true; marking = null; }
    };
    var cur = null;
    var at = function (e) { var r = cv.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]; };
    cv.onpointerdown = function (e) { cv.setPointerCapture(e.pointerId); var p = at(e); cur = { t: Math.round(v.currentTime * 100) / 100, pts: [p[0], p[1]] }; };
    cv.onpointermove = function (e) { if (!cur) return; var p = at(e); var n = cur.pts.length; if (Math.hypot(p[0] - cur.pts[n - 2], p[1] - cur.pts[n - 1]) > 0.006) cur.pts.push(p[0], p[1]); var g = cv.getContext("2d"); var r = cv.getBoundingClientRect(); if (n >= 2) { g.beginPath(); g.moveTo(cur.pts[n - 2] * r.width, cur.pts[n - 1] * r.height); g.lineTo(p[0] * r.width, p[1] * r.height); g.stroke(); } };
    cv.onpointerup = function () {
      if (!cur) return; var list = marks[k] = marks[k] || [];
      if (list.length >= 6) { toast("Six marks at most"); cur = null; return; }
      var same = list.find(function (m) { return m.strokes && Math.abs(m.t - cur.t) < 0.01; });
      if (cur.pts.length <= 4) list.push({ t: cur.t, x: cur.pts[0], y: cur.pts[1] });
      else if (same) same.strokes.push(cur.pts.slice(0, 800)); else list.push({ t: cur.t, strokes: [cur.pts.slice(0, 800)] });
      cur = null; draw(); refresh();
    };
    v.addEventListener("seeked", function () { if (marking === k) draw(); });
    refresh();
  }
  load(); setInterval(function () { if (!document.querySelector(".ask:not([hidden]) textarea:focus") && !marking && !document.querySelector(".ask:not([hidden])")) load(); }, 20000);
})();
</script></body></html>`;
}
