import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { watchStateOf } from "./state.js";
import { fmt, motionLevel, parseTime, span } from "./time.js";
import { resolveVideo } from "./video.js";

/**
 * The watch path as one self-contained HTML page: the answer, each video with clickable timestamps, a timeline of
 * what is in it and where Claude looked (shaded by fps), and every step with its why, what it saw and the evidence.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function mdToHtml(md: string, duration: number): string {
  const out: string[] = [];
  let list = false;
  for (const line of md.split("\n")) {
    let e = esc(line).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>");
    // Only times inside the video become links: "posts at 17:00" stays text.
    e = e.replace(/(?<![\d:])((?:\d+:)?\d{1,2}:\d{2}(?:\.\d+)?)(?!\d)/g, (m) => (parseTime(m)! <= duration + 0.5 ? `<a class="ts" href="#" data-t="${m}">${m}</a>` : m));
    if (/^\s*[-*] /.test(line)) { if (!list) { out.push("<ul>"); list = true; } out.push(`<li>${e.replace(/^\s*[-*] /, "")}</li>`); continue; }
    if (list) { out.push("</ul>"); list = false; }
    const h = /^(#{1,4}) (.*)/.exec(e);
    if (h) out.push(`<h${h[1]!.length + 1}>${h[2]}</h${h[1]!.length + 1}>`);
    else if (e.trim()) out.push(`<p>${e}</p>`);
  }
  if (list) out.push("</ul>");
  return out.join("\n");
}

const HEAD: Record<string, string> = { frames: "look", storyboard: "storyboard", zoom: "zoom", ocr: "read text", transcript: "listen (transcript)", audio: "listen (audio)", motion: "motion map", scenes: "cut list", search: "search", note: "note", observe: "observed", clip: "clip" };

export function writeReport(srcs: string[], o: { answer?: string; out?: string }): string {
  const answer = o.answer ? readFileSync(o.answer, "utf8") : "";
  let embedded = 0;
  const sections: string[] = [];
  let maxDur = 0;
  let question: string | undefined;
  for (const [vi, src] of srcs.entries()) {
    const v = resolveVideo(src), st = watchStateOf(v), d = v.duration, W = 1000;
    maxDur = Math.max(maxDur, d); question ??= st.session.question;
    const x = (t: number) => Math.round((t / Math.max(d, 1e-6)) * W * 100) / 100;
    const lanes: string[] = [];
    st.motion.forEach((val, i) => { const l = motionLevel(val); if (l !== "still") lanes.push(`<rect x="${x(i * st.bin)}" y="0" width="${Math.max(0.6, x(st.bin))}" height="14" class="mot" opacity="${{ low: 0.25, medium: 0.55, high: 0.95 }[l]}"/>`); });
    for (const c of st.cuts) lanes.push(`<rect x="${x(c)}" y="18" width="1" height="12" class="cut"/>`);
    for (const [a, b] of st.speech) lanes.push(`<rect x="${x(a)}" y="34" width="${Math.max(0.6, x(b) - x(a))}" height="10" class="sp"/>`);
    for (const [a, b] of st.sound) lanes.push(`<rect x="${x(a)}" y="34" width="${Math.max(0.6, x(b) - x(a))}" height="10" class="mu"/>`);
    let y = 52;
    const looks = st.looks.filter((l) => ["frames", "zoom", "ocr", "storyboard", "transcript", "audio", "motion"].includes(l.kind));
    looks.forEach((l, n) => {
      const a = l.frm ?? 0, b = l.to ?? d, cls = ({ frames: "lk", storyboard: "sb", zoom: "zm", ocr: "oc" } as Record<string, string>)[l.kind] ?? "ot";
      const op = l.kind === "frames" ? Math.min(1, 0.35 + (l.fps ?? 1) / 12) : 0.8;
      lanes.push(`<g class="step" data-t="${a}"><rect x="${x(a)}" y="${y}" width="${Math.max(3, x(b) - x(a))}" height="8" rx="2" class="${cls}" opacity="${op.toFixed(2)}"/><title>step ${n + 1}: ${l.kind} ${span(a, b, v.long)}${l.fps ? ` @ ${l.fps} fps` : ""}${l.why ? ` — ${esc(l.why)}` : ""}</title></g>`);
      y += 11;
    });
    const ticks = Array.from({ length: 6 }, (_, k) => (d * k) / 6).map((t) => `<text x="${x(t)}" y="${y + 16}" class="tick">${fmt(t, v.long)}</text>`).join("");
    const steps = st.looks.map((l, n) => {
      const when = l.frm !== undefined ? `<a class="ts" href="#" data-v="${vi}" data-t="${fmt(l.frm, v.long)}">${fmt(l.frm, v.long)}</a>${l.to !== undefined && l.to !== l.frm ? `–${fmt(l.to, v.long)}` : ""}` : "";
      const detail = [l.fps && `${l.fps} fps`, l.frames && `${l.frames} frames`, l.region, l.query && `“${l.query.map(esc).join("”, “")}”`].filter(Boolean).join(" · ");
      const imgs = (l.files ?? []).filter((f) => existsSync(f) && f.endsWith(".jpg")).map((f) => {
        const mb = statSync(f).size / 1e6;
        if (embedded + mb > 14) return `<div class="muted">(image left out to keep the page small: ${esc(f)})</div>`;
        embedded += mb;
        return `<img loading="lazy" src="data:image/jpeg;base64,${readFileSync(f).toString("base64")}" alt="${HEAD[l.kind] ?? l.kind}"/>`;
      }).join("");
      return `<li><div class="h"><span class="n">${n + 1}</span> <b>${HEAD[l.kind] ?? l.kind}</b> ${when} <span class="muted">${detail}</span></div>${l.why ? `<div class="why">think: ${esc(l.why)}</div>` : ""}${l.text ? `<div class="obs">${esc(l.text)}</div>` : ""}${imgs}</li>`;
    }).join("");
    const notes = st.notes.map((nt) => `<li>${nt.t !== undefined ? `<a class="ts" href="#" data-v="${vi}" data-t="${fmt(nt.t, v.long)}">${fmt(nt.t, v.long)}</a> ` : ""}${esc(nt.text)}</li>`).join("");
    sections.push(`<section><h2>${esc(v.meta.title ?? v.meta.name)}</h2>
  <p class="muted">${fmt(d, v.long)} · ${v.meta.width}×${v.meta.height} · depth ${st.session.depth} · ${st.session.used}/${st.session.budget} frames looked at · ${looks.length} looks</p>
  <video id="v${vi}" src="${pathToFileURL(v.path).href}" controls preload="metadata"></video>
  <div class="legend"><i class="mot"></i>motion <i class="cut"></i>cuts <i class="sp"></i>speech <i class="mu"></i>music/sound <i class="sb"></i>storyboard <i class="lk"></i>look (darker = higher fps) <i class="zm"></i>zoom <i class="oc"></i>read text <i class="ot"></i>listen</div>
  <svg viewBox="0 0 ${W} ${y + 20}" class="tl" data-v="${vi}">${lanes.join("")}${ticks}</svg>
  <h3>Watch path</h3><ol class="steps">${steps || "<li>no steps logged</li>"}</ol>
  ${notes ? `<h3>Notes kept on this video</h3><ul>${notes}</ul>` : ""}</section>`);
  }
  const first = resolveVideo(srcs[0]!);
  const out = o.out ? path.resolve(process.env.INIT_CWD ?? process.cwd(), o.out) : path.join(first.dir, "report.html");
  writeFileSync(out, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Watch Path</title>
<style>
:root{--bg:#fbfaf7;--fg:#1d1d1f;--muted:#6e6e73;--card:#fff;--line:#e5e5ea;--mot:#ff9f0a;--cut:#1d1d1f;--sp:#0a84ff;--mu:#bf5af2;--lk:#30d158;--sb:#8e8e93;--zm:#ff375f;--oc:#64d2ff;--ot:#ffd60a}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#000;--fg:#f5f5f7;--muted:#98989d;--card:#1c1c1e;--line:#38383a;--cut:#f5f5f7}}
:root[data-theme="dark"]{--bg:#000;--fg:#f5f5f7;--muted:#98989d;--card:#1c1c1e;--line:#38383a;--cut:#f5f5f7}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif}
main{max-width:1040px;margin:0 auto;padding:32px 16px 80px}h1{font-size:28px;margin:0 0 4px}h2{margin:40px 0 4px}h3{margin:28px 0 8px}
.muted{color:var(--muted)}.answer{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:4px 20px;margin:20px 0}
video{width:100%;max-height:420px;background:#000;border-radius:12px;margin:12px 0}
.tl{width:100%;height:auto;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px;overflow:visible}
.mot{fill:var(--mot)}.cut{fill:var(--cut)}.sp{fill:var(--sp)}.mu{fill:var(--mu)}.lk{fill:var(--lk)}.sb{fill:var(--sb)}.zm{fill:var(--zm)}.oc{fill:var(--oc)}.ot{fill:var(--ot)}
.step{cursor:pointer}.tick{font-size:10px;fill:var(--muted)}
.legend{font-size:12px;color:var(--muted);margin:4px 0 8px;display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.legend i.mot{background:var(--mot)}.legend i.cut{background:var(--cut)}.legend i.sp{background:var(--sp)}.legend i.mu{background:var(--mu)}.legend i.lk{background:var(--lk)}.legend i.sb{background:var(--sb)}.legend i.zm{background:var(--zm)}.legend i.oc{background:var(--oc)}.legend i.ot{background:var(--ot)}
.steps{list-style:none;padding:0;margin:0}.steps li{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:8px 0}
.steps .n{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:11px;background:var(--line);font-size:12px}
.steps img{max-width:100%;border-radius:8px;margin-top:8px;display:block}.why{color:var(--muted);margin-top:4px}.obs{margin-top:4px}
a.ts{color:var(--sp);text-decoration:none;font-variant-numeric:tabular-nums}code{font:13px ui-monospace,SFMono-Regular,monospace}
</style></head><body><main><h1>Watch path</h1>
<p class="muted">${esc(question ?? "How the video was watched")} · made by reelcut on ${new Date().toISOString().slice(0, 16).replace("T", " ")}</p>
${answer ? `<div class="answer">${mdToHtml(answer, maxDur)}</div>` : ""}
${sections.join("")}</main>
<script>
function secs(s){return s.split(':').reduce((a,b)=>a*60+parseFloat(b),0)}
document.addEventListener('click',e=>{const a=e.target.closest('a.ts,.step');if(!a)return;e.preventDefault();
 const vi=a.dataset.v??a.closest('svg')?.dataset.v??'0';const v=document.getElementById('v'+vi);if(!v)return;
 const t=a.dataset.t;v.currentTime=t.includes(':')?secs(t):parseFloat(t);v.scrollIntoView({behavior:'smooth',block:'center'});v.play().catch(()=>{})});
</script></body></html>`);
  return out;
}
