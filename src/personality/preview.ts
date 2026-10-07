import { toOklch } from "./color.js";
import type { BeatKind, Cadence, Palette, StyleSpec, Texture } from "./styles.js";

/**
 * Preview beats for the Personality page: a 4-second, 1:1 composition of a style, built on the kit's style layer
 * (assets/kit/ui/70-styles.*), so a preview is made of exactly the pieces a reel in that style is made of.
 *
 *   sample    the same little script in every style (a headline, a number, three shapes, a confirmation), so the only
 *             difference between two previews is the style
 *   showcase  the style doing what it is best at: its first beat kind (a hook, a statement, data, a product, a quote,
 *             a call to action)
 *
 * The same generator makes the owner's mini beats, with their colours, type, motion, cadence and texture.
 */
export type PreviewKind = "sample" | "showcase";
export interface PreviewOptions {
  id: string;
  palette: Palette;
  pairing: string;
  energy?: "restrained" | "default" | "energetic";
  cadence?: Cadence;
  texture?: Texture;
  /** What the showcase shows; the style's best beat kind when left out. */
  beat?: BeatKind;
  seconds?: number;
}

/** How the three shapes are made in each style: the kit's .rc-shape in the style's material, or the style's own art. */
type ShapeKind = "shape" | "slab" | "blob" | "brush" | "none";
const SHAPES: Record<string, ShapeKind> = { isometric: "slab", liquid: "blob", "ink-paint": "brush", "kinetic-type": "none", cinematic: "none", "ui-product": "none" };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

interface Script { l1: string; l2: string; numFrom?: number; numTo?: number; numPre?: string; numSuf?: string; label?: string; card?: string; extra?: "bars" | "ui" | "button" }
function scriptFor(kind: PreviewKind, beat: BeatKind): Script {
  if (kind === "sample") return { l1: "Make it", l2: "yours.", numFrom: 0, numTo: 128, numPre: "+", numSuf: "%", label: "faster to publish", card: "Launch ready" };
  switch (beat) {
    case "hook": return { l1: "Ship it", l2: "today." };
    case "statement": return { l1: "Less noise.", l2: "More you.", card: "Saved" };
    case "data": return { l1: "Reach,", l2: "tripled.", numFrom: 1, numTo: 3.2, numSuf: "×", label: "views this month", extra: "bars" };
    case "product": return { l1: "One tap.", l2: "Done.", extra: "ui", card: "Published" };
    case "quote": return { l1: "“Design is how", l2: "it works.”", label: "— every good team" };
    case "cta": return { l1: "Try it", l2: "free.", extra: "button" };
  }
}

function surfaces(p: Palette): { card: string; muted: string; line: string } {
  const dark = toOklch(p.ground).l < 0.5;
  return { card: `color-mix(in oklab, ${p.ground} ${dark ? 86 : 70}%, #ffffff)`, muted: `color-mix(in oklab, ${p.ink} 62%, ${p.ground})`, line: `color-mix(in oklab, ${p.ink} 14%, transparent)` };
}

function shapesHtml(kind: ShapeKind): string {
  switch (kind) {
    case "none": return "";
    case "brush":
      return `<svg class="art" viewBox="0 0 1080 1080"><path class="br s1" d="M 600 520 C 700 430, 860 450, 930 540" filter="url(#rc-rough)"/><path class="br s2" d="M 640 700 C 720 650, 820 660, 900 720" filter="url(#rc-rough)"/><circle class="br-dot s3" cx="760" cy="860" r="56" filter="url(#rc-rough)"/></svg>`;
    case "slab": return `<div class="rc-iso iso"><i class="rc-shape s1"></i><i class="rc-shape rc-c2 s2"></i><i class="rc-shape rc-ink s3"></i></div>`;
    case "blob": return `<div class="rc-goo goo"><i class="rc-shape rc-circle s1"></i><i class="rc-shape rc-circle rc-c2 s2"></i><i class="rc-shape rc-circle s3"></i></div>`;
    default: return `<i class="rc-shape rc-circle s1"></i><i class="rc-shape rc-square rc-c2 s2"></i><i class="rc-shape rc-pill rc-ink s3 rc-taped"></i>`;
  }
}

/** Decorations that belong to the preview's content, not to the style's world (which RC.styleWorld builds). */
function decoHtml(style: StyleSpec): string {
  switch (style.id) {
    case "swiss": return `<div class="redsq"><b>07</b><i></i></div>`;
    case "editorial": return `<div class="kicker">ISSUE 07 — THE PERSONALITY</div><div class="rule"></div>`;
    case "brutalist": return `<div class="brut">[01] PERSONALITY.EXE</div>`;
    case "hand-drawn": return `<svg class="art" viewBox="0 0 1080 1080"><path class="dd" d="M 90 400 C 260 420, 420 395, 560 410"/><path class="dd" d="M 520 300 C 600 250, 660 260, 700 300 M 690 270 L 702 302 L 668 306"/></svg>`;
    case "ink-paint": return `<svg class="art" viewBox="0 0 1080 1080"><path class="sweep" d="M 70 360 C 260 330, 460 380, 640 340" filter="url(#rc-rough)"/></svg>`;
    case "collage": return `<div class="sticker">NEW!</div>`;
    case "3d": return `<i class="rc-floor-shadow f1"></i><i class="rc-floor-shadow f2"></i>`;
    default: return "";
  }
}

function extraHtml(x: Script["extra"]): string {
  switch (x) {
    case "bars": return `<div class="barsx">${[0.32, 0.5, 0.44, 0.7, 1].map((h, i) => `<i class="${i === 4 ? "on" : ""}" style="--h:${h}"></i>`).join("")}</div>`;
    case "ui": return `<div class="uix"><div class="row"><b>Auto-publish</b><span class="sw"><i></i></span></div><div class="row"><b>Your personality</b><span class="pillx">On</span></div></div>`;
    case "button": return `<div class="btnx">Start now</div><div class="urlx">reelcut.app</div>`;
    default: return "";
  }
}

/** Where things sit: the shared layout, then each style's own arrangement. Materials come from the kit. */
const CSS = (style: StyleSpec, p: Palette) => {
  const s = surfaces(p);
  const per: Record<string, string> = {
    brutalist: `#root .cardx { border-radius:0; border:6px solid var(--ink); box-shadow:12px 12px 0 var(--ink); font-family:var(--font-mono); }`,
    minimal: `#root .rc-shape.s2, #root .rc-shape.s3 { display:none; } #root .rc-shape.s1 { left:860px; top:220px; width:90px; height:90px; } #root .hl { font-size:96px; top:300px; } #root .num { top:560px; font-size:96px; } #root .lbl { top:672px; } #root .cardx { top:860px; }`,
    swiss: `#root .hl { top:auto; bottom:160px; font-size:124px; } #root .num { top:110px; } #root .lbl { top:270px; } #root .rc-shape.s1 { display:none; } #root .cardx { top:auto; bottom:60px; left:auto; right:84px; border-radius:0; }`,
    "kinetic-type": `#root .hl { font-size:210px; top:200px; line-height:.9; } #root .num, #root .lbl { display:none; } #root .cardx { top:860px; }`,
    editorial: `#root .hl { top:190px; font-size:112px; } #root .rc-shape.s1 { border-radius:4px; left:620px; top:420px; width:330px; height:420px; background:linear-gradient(160deg, var(--accent-2), var(--accent)); } #root .rc-shape.s2, #root .rc-shape.s3 { display:none; }`,
    cinematic: `#root .hl { top:380px; font-size:120px; } #root .num, #root .lbl, #root .cardx { display:none; }`,
    "retro-vhs": `#root .rc-shape.s1 { display:none; } #root .num { font-size:130px; }`,
    liquid: `#root .num { font-size:130px; }`,
  };
  return `
  #root { --ground:${p.ground}; --ink:${p.ink}; --accent:${p.accent}; --accent-2:${p.accent2}; --card:${s.card}; --card-ink:${p.ink}; --muted:${s.muted}; --card-muted:${s.muted}; --line:${s.line}; }
  #root .cam { position:absolute; inset:0; transform-origin:540px 540px; z-index:2; }
  #root .hl { position:absolute; left:84px; top:110px; z-index:5; font-size:118px; }
  #root .num { position:absolute; left:84px; top:520px; z-index:5; font-family:var(--font-display); font-weight:var(--display-weight); font-size:150px; line-height:1; letter-spacing:-0.03em; color:var(--accent); font-variant-numeric:tabular-nums; }
  #root .lbl { position:absolute; left:88px; top:690px; z-index:5; font:500 30px/1.2 var(--font-sans); color:var(--muted); }
  #root .cardx { position:absolute; left:84px; top:820px; z-index:6; height:96px; padding:0 34px 0 26px; border-radius:48px; display:flex; align-items:center; gap:18px; background:var(--card); color:var(--ink); font:600 34px/1 var(--font-sans); box-shadow:0 18px 40px -18px rgba(0,0,0,.35); }
  #root .cardx .rc-check-d { --pt:2px; --cc:var(--accent); }
  #root .rc-shape { z-index:3; }
  #root .rc-shape.s1 { left:640px; top:360px; width:230px; height:230px; }
  #root .rc-shape.s2 { left:740px; top:610px; width:190px; height:190px; rotate:6deg; }
  #root .rc-shape.s3 { left:560px; top:820px; width:330px; height:112px; }
  #root .iso { left:600px; top:420px; width:380px; height:420px; z-index:3; }
  #root .iso .rc-shape { left:40px; width:280px; height:280px; rotate:none; }
  #root .iso .s1 { top:0; } #root .iso .s2 { top:90px; } #root .iso .s3 { top:180px; }
  #root .goo { left:600px; top:330px; width:440px; height:560px; z-index:3; }
  #root .goo .s1 { left:60px; top:40px; width:240px; height:240px; } #root .goo .s2 { left:180px; top:230px; width:200px; height:200px; rotate:none; } #root .goo .s3 { left:40px; top:330px; width:170px; height:170px; }
  #root .art { position:absolute; inset:0; width:1080px; height:1080px; z-index:3; pointer-events:none; }
  #root .dd { fill:none; stroke:var(--accent); stroke-width:8; stroke-linecap:round; stroke-linejoin:round; filter:url(#rc-wobble); }
  #root .br { fill:none; stroke:var(--accent); stroke-width:46; stroke-linecap:round; } #root .br.s2 { stroke:var(--accent-2); } #root .br-dot { fill:var(--ink); }
  #root .sweep { fill:none; stroke:var(--accent); stroke-width:120; stroke-linecap:round; opacity:.35; }
  #root .rc-floor-shadow { z-index:2; } #root .rc-floor-shadow.f1 { left:660px; top:610px; width:200px; } #root .rc-floor-shadow.f2 { left:750px; top:810px; width:170px; }
  #root .redsq { position:absolute; right:84px; top:96px; width:300px; height:300px; background:var(--accent); z-index:2; }
  #root .redsq b { position:absolute; left:22px; bottom:6px; font:800 150px/1 var(--font-display); color:var(--ground); letter-spacing:-0.05em; }
  #root .redsq i { position:absolute; left:22px; right:22px; top:26px; height:6px; background:var(--ground); }
  #root:has(.barsx) .redsq, #root:has(.uix) .rc-floor-shadow, #root:has(.barsx) .rc-floor-shadow { display:none; }
  #root .kicker { position:absolute; left:88px; top:100px; font:600 22px/1 var(--font-sans); letter-spacing:.18em; color:var(--muted); }
  #root .rule { position:absolute; left:84px; right:84px; top:140px; height:2px; background:var(--ink); }
  #root .brut { position:absolute; right:84px; top:96px; font:700 28px/1 var(--font-mono); background:var(--ink); color:var(--ground); padding:10px 14px; z-index:6; }
  #root .sticker { position:absolute; right:96px; top:110px; width:150px; height:150px; border-radius:50%; background:var(--accent-2); color:var(--ink); display:grid; place-items:center; font:900 36px/1 var(--font-display); rotate:-12deg; z-index:7; }
  #root .barsx { position:absolute; left:560px; right:84px; top:400px; height:420px; display:flex; align-items:flex-end; gap:22px; z-index:4; }
  #root .barsx i { flex:1; height:calc(var(--h) * 100%); background:color-mix(in oklab, var(--ink) 18%, transparent); border-radius:14px 14px 4px 4px; transform-origin:50% 100%; }
  #root .barsx i.on { background:var(--accent); }
  #root .uix { position:absolute; left:560px; top:430px; width:436px; padding:18px 26px; border-radius:36px; background:var(--card); box-shadow:0 30px 60px -24px rgba(0,0,0,.4); z-index:4; }
  #root .uix .row { height:104px; display:flex; align-items:center; justify-content:space-between; font:600 30px/1.1 var(--font-sans); }
  #root .uix .row + .row { border-top:1px solid var(--line); }
  #root .uix .sw { width:104px; height:60px; border-radius:30px; background:color-mix(in oklab, var(--ink) 16%, transparent); position:relative; }
  #root .uix .sw i { position:absolute; left:6px; top:6px; width:48px; height:48px; border-radius:50%; background:#fff; box-shadow:0 3px 8px rgba(0,0,0,.25); }
  #root .uix .pillx { padding:10px 18px; border-radius:20px; background:color-mix(in oklab, var(--accent) 18%, transparent); color:var(--accent); font-size:24px; }
  #root .btnx { position:absolute; left:84px; top:560px; height:120px; padding:0 64px; border-radius:60px; background:var(--accent); color:var(--ground); display:flex; align-items:center; font:700 48px/1 var(--font-sans); z-index:5; }
  #root .urlx { position:absolute; left:88px; top:720px; font:500 32px/1 var(--font-mono); color:var(--muted); z-index:5; }
  ${per[style.id] ?? ""}
  `;
};

export function previewComposition(style: StyleSpec, kind: PreviewKind, o: PreviewOptions): string {
  const beat = o.beat ?? style.beats[0] ?? "statement";
  const sc = scriptFor(kind, beat);
  const shapes = SHAPES[style.id] ?? "shape";
  const cadence = o.cadence ?? style.motion.cadence;
  const fps = cadence === "stepped-8" ? 8 : cadence === "stepped-12" ? 12 : 0;
  const D = o.seconds ?? 4;
  const showNum = sc.numTo != null;
  const cfg = JSON.stringify({ shapes, fps, D, sc, glitch: style.id === "glitch" || style.id === "retro-vhs", texture: o.texture ?? null });
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /></head><body>
<template>
<style>${CSS(style, o.palette)}</style>
<div id="root" data-look="${style.look}" data-style="${style.id}" data-type="${esc(o.pairing)}" data-motion="${o.energy ?? style.motion.energy}" data-composition-id="${esc(o.id)}" data-width="1080" data-height="1080">
  <div class="cam">
    ${decoHtml(style)}
    ${sc.extra === "bars" || sc.extra === "ui" ? "" : shapesHtml(shapes)}
    <div class="rc-hl hl"><span class="ln">${esc(sc.l1)}</span><span class="ln"><em>${esc(sc.l2)}</em></span></div>
    ${showNum ? `<div class="num">${esc(sc.numPre ?? "")}${sc.numFrom}${esc(sc.numSuf ?? "")}</div>` : ""}
    ${sc.label ? `<div class="lbl">${esc(sc.label)}</div>` : ""}
    ${extraHtml(style.id === "ui-product" && !sc.extra ? "ui" : sc.extra)}
    ${sc.card ? `<div class="cardx"><span class="rc-check-d"></span>${esc(sc.card)}</div>` : ""}
  </div>
</div>
<script>
(function () {
  const C = ${cfg};
  const tl = gsap.timeline({ paused: true });
  const R = "#root ", has = (s) => document.querySelector(R + s);
  RC.styleWorld("#root");
  RC.styleFinish("#root", C.texture ? { texture: C.texture } : {});
  RC.styleWords(tl, R + ".hl", 0);
  if (C.glitch) { RC.styleGlitch(tl, "#root", 0.24); RC.styleGlitch(tl, "#root", 2.2); }
  // The shapes: the style's entrance, or its own art drawing in.
  const s = Array.from(document.querySelectorAll(R + ".cam .rc-shape"));
  if (C.shapes === "brush") { RC.draw(tl, R + ".br", 0.35, { duration: 0.9, stagger: 0.25 }); RC.pop(tl, R + ".br-dot", 1.1); }
  else if (C.shapes === "slab") s.forEach((el, i) => tl.fromTo(el, { y: -140 - i * 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: "spring.default" }, 0.35 + (2 - i) * 0.14));
  else if (C.shapes === "blob") s.forEach((el, i) => { tl.fromTo(el, { scale: 0.2 }, { scale: 1, duration: 0.9, ease: "spring.reward" }, 0.3 + i * 0.15); tl.to(el, { x: [30, -40, 20][i], y: [20, -30, 25][i], duration: 2.4, ease: "sine.inOut" }, 1.2); });
  else if (s.length) RC.styleEnter(tl, s, 0.3);
  if (has(".dd")) RC.draw(tl, R + ".dd", 1.0, { duration: 0.7, stagger: 0.3 });
  if (has(".sweep")) RC.draw(tl, R + ".sweep", 0.1, { duration: 0.8 });
  if (has(".sticker")) RC.pop(tl, R + ".sticker", 1.4, { reward: true });
  if (has(".redsq")) RC.rise(tl, R + ".redsq", 0, { lead: true, y: 0 });
  // The number, the label, the extra, the confirmation.
  if (has(".num")) { RC.rise(tl, R + ".num", 0.9, { y: 30 }); RC.count(tl, R + ".num", 1.0, { from: C.sc.numFrom, to: C.sc.numTo, decimals: C.sc.numTo % 1 ? 1 : 0, prefix: C.sc.numPre || "", suffix: C.sc.numSuf || "", duration: 1.3 }); }
  if (has(".lbl")) RC.rise(tl, R + ".lbl", 1.15, { y: 16 });
  const bars = document.querySelectorAll(R + ".barsx i"); if (bars.length) tl.fromTo(bars, { scaleY: 0 }, { scaleY: 1, duration: 0.8, ease: "spring.default", stagger: 0.09 }, 0.6);
  if (has(".uix")) { RC.present(tl, R + ".uix", 0.4, { y: 40, spring: "gentle" }); tl.to(R + ".uix .sw", { backgroundColor: getComputedStyle(has(".uix")).getPropertyValue("--accent"), duration: 0.25 }, 1.6); tl.to(R + ".uix .sw i", { x: 44, duration: 0.45, ease: "spring.default" }, 1.55); RC.emit("toggle", 1.55); }
  if (has(".btnx")) { RC.present(tl, R + ".btnx", 0.6, { y: 30, spring: "gentle" }); RC.press(tl, R + ".btnx", 1.9, { scale: 0.96 }); RC.rise(tl, R + ".urlx", 1.0, { y: 14 }); }
  if (has(".cardx")) { RC.present(tl, R + ".cardx", 2.05, { y: 30, spring: "default" }); RC.checkDraw(tl, R + ".cardx .rc-check-d", 2.25); }
  RC.camera(tl, R + ".cam", 0, { duration: C.D, to: { scale: 1.03 } });
  RC.hold(tl, C.D);
  window.__timelines["${esc(o.id)}"] = RC.cadence(tl, "#root", { fps: C.fps });
})();
</script>
</template>
</body></html>
`;
}
