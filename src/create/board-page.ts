/**
 * The client's approval board: the stages the owner has sent, each item with what it is (in plain words), its clip,
 * and Approve or Ask for a change. Self-contained, dark, Apple-like, like the review page it sits beside.
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function boardPage(token: string, title: string): string {
  const base = `/r/${token}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex"><title>${esc(title)} · approval</title>
<style>
:root { color-scheme: dark; --bg: #000; --cell: #1c1c1e; --elev: #2c2c2e; --label: #fff; --label-2: rgb(235 235 245 / .6); --fill: rgb(118 118 128 / .24); --accent: #ff9230; --green: #30d158; --red: #ff453a; --sep: rgb(84 84 88 / .6); --ease: cubic-bezier(.2,0,0,1); }
* { box-sizing: border-box; } body { margin: 0; background: var(--bg); color: var(--label); font: 15px/20px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
main { max-width: 1040px; margin: 0 auto; padding: 24px 16px 80px; }
h1 { margin: 0; font-size: 28px; line-height: 34px; letter-spacing: -.01em; } .sub { color: var(--label-2); font-size: 13px; margin: 4px 0 20px; }
.who { display: flex; gap: 8px; align-items: center; margin-bottom: 20px; } .who input { max-width: 260px; }
.steps { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 20px; } .steps span { padding: 6px 12px; border-radius: 999px; background: var(--fill); font-size: 13px; color: var(--label-2); }
.steps span.on { background: var(--accent); color: #000; font-weight: 600; } .steps span.ok { background: rgb(48 209 88 / .2); color: var(--green); }
section { margin-bottom: 32px; } h2 { font-size: 20px; margin: 0 0 4px; } .when { color: var(--label-2); font-size: 13px; margin-bottom: 12px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; } .grid.one { grid-template-columns: minmax(0, 1fr); }
.it { background: var(--cell); border-radius: 16px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.it video { width: 100%; border-radius: 10px; background: #111; display: block; } .one .it video { max-height: 70vh; }
.it .t { font-weight: 600; } .it .p { font-size: 15px; } .it .w { font-size: 13px; color: var(--label-2); }
.it pre { white-space: pre-wrap; font: 14px/1.5 ui-monospace, Menlo, monospace; background: var(--elev); border-radius: 10px; padding: 12px; max-height: 60vh; overflow: auto; margin: 0; }
.acts { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; } .st { font-size: 13px; } .st.ok { color: var(--green); } .st.ch { color: var(--accent); }
button { font: inherit; border: 0; border-radius: 999px; height: 36px; padding: 0 16px; background: var(--fill); color: var(--label); cursor: pointer; transition: transform 150ms var(--ease); } button:active { transform: scale(.97); }
button.ok { background: var(--green); color: #000; font-weight: 600; } button:disabled { opacity: .4; }
input, textarea { font: inherit; font-size: 16px; width: 100%; color: var(--label); background: var(--elev); border: 1px solid transparent; border-radius: 10px; padding: 10px 12px; } textarea { min-height: 64px; resize: vertical; }
input:focus, textarea:focus { outline: none; border-color: var(--accent); }
.empty { color: var(--label-2); } .toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); background: var(--elev); padding: 10px 16px; border-radius: 999px; font-size: 14px; opacity: 0; transition: opacity .2s; } .toast.on { opacity: 1; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style></head><body><main>
<h1>${esc(title)}</h1><div class="sub">For your approval. Approve each part, or say what should change: the changes are made and sent back here.</div>
<div class="who"><input id="name" placeholder="Your name" maxlength="40" autocomplete="name"></div>
<div class="steps" id="steps"></div><div id="board"><p class="empty">Loading…</p></div></main><div class="toast" id="toast"></div>
<script>
(function () {
  var base = ${JSON.stringify(base)}, data = null;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  try { $("name").value = localStorage.getItem("rc-review-name") || ""; } catch (e) {}
  function toast(t) { var el = $("toast"); el.textContent = t; el.classList.add("on"); setTimeout(function () { el.classList.remove("on"); }, 2600); }
  function load() { fetch(base + "/board").then(function (r) { return r.json(); }).then(function (d) { data = d; paint(); }); }
  function stageState(s) { if (!s.published) return "wait"; var its = s.published.items; var ds = s.decisions; if (its.every(function (x) { return ds[x.id] && ds[x.id].status === "approved"; })) return "ok"; return "on"; }
  function paint() {
    $("steps").innerHTML = data.stages.map(function (s) { var st = stageState(s); return '<span class="' + (st === "ok" ? "ok" : st === "on" ? "on" : "") + '">' + esc(s.name) + (st === "ok" ? " ✓" : st === "wait" ? " · not yet" : "") + '</span>'; }).join("");
    var shown = data.stages.filter(function (s) { return s.published; }).reverse();
    $("board").innerHTML = shown.length ? shown.map(function (s) {
      var one = s.published.items.length === 1;
      return '<section><h2>' + esc(s.name) + '</h2><div class="when">Sent ' + new Date(s.published.at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) + '</div><div class="grid' + (one ? " one" : "") + '">' + s.published.items.map(function (it) {
        var d = s.decisions[it.id];
        var media = it.media ? '<video src="' + base + '/m/' + s.id + '/' + encodeURIComponent(it.id) + '" ' + (it.poster ? 'poster="' + base + '/m/' + s.id + '/' + encodeURIComponent(it.id) + '?poster=1" ' : "") + (one ? "controls " : "muted loop autoplay ") + 'playsinline preload="metadata"></video>' : "";
        return '<div class="it" data-s="' + s.id + '" data-i="' + esc(it.id) + '">' + media + '<div class="t">' + esc(it.title) + '</div>' + (it.plain ? '<div class="p">' + esc(it.plain) + '</div>' : "") + (it.why ? '<div class="w">' + esc(it.why) + '</div>' : "") + (it.text ? '<pre>' + esc(it.text) + '</pre>' : "")
          + '<div class="acts">' + (d ? '<span class="st ' + (d.status === "approved" ? "ok" : "ch") + '">' + (d.status === "approved" ? "Approved" : "Change asked: " + esc(d.note)) + ' · ' + esc(d.author) + '</span>' : "") + '<button class="ok" data-a="approved">' + (d && d.status === "approved" ? "Approved" : "Approve") + '</button><button data-a="changes">Ask for a change</button></div><div class="ask" hidden><textarea placeholder="What should change?" maxlength="1000"></textarea><div class="acts"><button data-a="send">Send</button></div></div></div>';
      }).join("") + '</div></section>';
    }).join("") : '<p class="empty">Nothing has been sent for approval yet. This page updates when it is.</p>';
    Array.prototype.forEach.call(document.querySelectorAll(".it"), function (el) {
      var send = function (status, note) {
        var name = $("name").value.trim(); if (!name) { toast("Add your name first"); $("name").focus(); return; }
        try { localStorage.setItem("rc-review-name", name); } catch (e) {}
        fetch(base + "/decide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: el.dataset.s, item: el.dataset.i, status: status, note: note, name: name }) })
          .then(function (r) { return r.ok ? null : r.text(); }).then(function (err) { if (err) return toast(err); toast(status === "approved" ? "Approved. Thank you." : "Sent. It will come back here changed."); load(); })
          .catch(function () { toast("Could not send; try again."); });
      };
      el.querySelector('[data-a="approved"]').onclick = function () { send("approved"); };
      el.querySelector('[data-a="changes"]').onclick = function () { var a = el.querySelector(".ask"); a.hidden = !a.hidden; if (!a.hidden) a.querySelector("textarea").focus(); };
      el.querySelector('[data-a="send"]').onclick = function () { var t = el.querySelector("textarea").value.trim(); if (!t) return toast("Say what should change"); send("changes", t); };
    });
  }
  load(); setInterval(function () { if (!document.querySelector(".ask:not([hidden]) textarea:focus")) load(); }, 20000);
})();
</script></body></html>`;
}
