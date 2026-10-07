import { toOklch } from "./color.js";
import type { BeatKind, Cadence, Palette, StyleSpec, Texture } from "./styles.js";

/**
 * Preview beats for the Personality page: a 4-second, 1:1 composition of a style.
 *
 *   sample    the same little script in every style (a headline, a number, three shapes, a confirmation), so the only
 *             difference between two previews is the style
 *   showcase  the style doing what it is best at: its first beat kind (a hook, a statement, data, a product, a quote,
 *             a call to action)
 *
 * Each style has a treatment: how its shapes are made (cut card, clay, outline, slab, blob, brush…), the decorations of
 * its world (a Swiss grid, a letterbox, a VHS sunset, tape), the textures on top, and its motion recipe. Styles that
 * animate on held frames (Claymation, Stop Motion, Paper Cutout, Hand-Drawn, Collage) step at 12 or 8 frames a second,
 * with Stop Motion's half-pixel jitter on every step. The same generator makes the owner's mini beats, with their own
 * colours, type and motion.
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

type Verb = "slide" | "bounce" | "draw" | "slam" | "rise" | "float" | "glitch";
const VERB: Record<string, Verb> = {
  "paper-cutout": "slide", claymation: "bounce", "stop-motion": "slide", "hand-drawn": "draw", "flat-vector": "slide", linear: "draw",
  "kinetic-type": "slam", editorial: "rise", collage: "slam", brutalist: "slam", swiss: "rise", minimal: "rise", "3d": "float",
  isometric: "float", liquid: "float", "ink-paint": "draw", "ui-product": "rise", "retro-vhs": "glitch", glitch: "glitch", cinematic: "rise",
};
/** How the three shapes are drawn in each style. */
type ShapeKind = "card" | "clay" | "outline" | "flat" | "slab" | "blob" | "sphere" | "brush" | "none" | "block";
const SHAPES: Record<string, ShapeKind> = {
  "paper-cutout": "card", claymation: "clay", "stop-motion": "card", "hand-drawn": "outline", "flat-vector": "flat", linear: "outline",
  "kinetic-type": "none", editorial: "block", collage: "card", brutalist: "block", swiss: "block", minimal: "flat", "3d": "sphere",
  isometric: "slab", liquid: "blob", "ink-paint": "brush", "ui-product": "flat", "retro-vhs": "flat", glitch: "block", cinematic: "none",
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

interface Script { l1: string; l2: string; num?: string; numFrom?: number; numTo?: number; numPre?: string; numSuf?: string; label?: string; card?: string; extra?: "bars" | "ui" | "quote" | "button" }
function scriptFor(kind: PreviewKind, beat: BeatKind): Script {
  if (kind === "sample") return { l1: "Make it", l2: "yours.", numFrom: 0, numTo: 128, numPre: "+", numSuf: "%", label: "faster to publish", card: "Launch ready" };
  switch (beat) {
    case "hook": return { l1: "Ship it", l2: "today." };
    case "statement": return { l1: "Less noise.", l2: "More you.", card: "Saved" };
    case "data": return { l1: "Reach,", l2: "tripled.", numFrom: 1, numTo: 3.2, numSuf: "×", label: "views this month", extra: "bars" };
    case "product": return { l1: "One tap.", l2: "Done.", extra: "ui", card: "Published" };
    case "quote": return { l1: "“Design is how", l2: "it works.”", label: "— every good team", extra: "quote" };
    case "cta": return { l1: "Try it", l2: "free.", extra: "button" };
  }
}

/** Card colours derived from the scheme: a raised surface in the ground's own family. */
function surfaces(p: Palette): { card: string; muted: string; line: string; dark: boolean } {
  const dark = toOklch(p.ground).l < 0.5;
  return {
    dark,
    card: `color-mix(in oklab, ${p.ground} ${dark ? 86 : 70}%, ${dark ? "#ffffff" : "#ffffff"})`,
    muted: `color-mix(in oklab, ${p.ink} 62%, ${p.ground})`,
    line: `color-mix(in oklab, ${p.ink} 14%, transparent)`,
  };
}

function textureLayers(t: Texture): string {
  const out: string[] = [];
  const noise = (op: number, blend: string) => `<div class="tx" style="opacity:${op.toFixed(2)};mix-blend-mode:${blend};background-image:url(&quot;data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' seed='4'/%3E%3CfeColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 1 0'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)'/%3E%3C/svg%3E&quot;)"></div>`;
  if (t.paper > 0) out.push(noise(t.paper * 0.35, "multiply"));
  if (t.grain > 0) out.push(noise(t.grain * 0.4, "overlay"));
  if (t.halftone > 0) out.push(`<div class="tx" style="opacity:${(t.halftone * 0.25).toFixed(2)};background:radial-gradient(circle, rgba(0,0,0,.6) 1.4px, transparent 1.6px) 0 0/9px 9px;mix-blend-mode:multiply"></div>`);
  if (t.leaks > 0) out.push(`<div class="tx leak" style="opacity:${(t.leaks * 0.9).toFixed(2)};background:radial-gradient(40% 50% at 92% 10%, rgba(255,150,60,.55), transparent 70%), radial-gradient(30% 40% at 5% 95%, rgba(255,60,90,.35), transparent 70%);mix-blend-mode:screen"></div>`);
  if (t.vignette > 0) out.push(`<div class="tx" style="background:radial-gradient(75% 75% at 50% 50%, transparent 55%, rgba(0,0,0,${(t.vignette * 0.75).toFixed(2)}))"></div>`);
  if (t.scanlines > 0) out.push(`<div class="tx" style="opacity:${(t.scanlines * 0.55).toFixed(2)};background:repeating-linear-gradient(transparent 0 3px, rgba(0,0,0,.45) 3px 5px)"></div>`);
  return out.join("");
}

function shapesHtml(kind: ShapeKind): string {
  switch (kind) {
    case "none": return "";
    case "outline":
      return `<svg class="shp-svg" viewBox="0 0 1080 1080"><path class="dr s1" d="M 760 470 m -105 0 a 105 105 0 1 0 210 0 a 105 105 0 1 0 -210 0" /><path class="dr s2" d="M 712 610 L 892 616 L 888 792 L 708 786 Z" /><path class="dr s3" d="M 610 850 C 690 830, 820 860, 900 845" /></svg>`;
    case "brush":
      return `<svg class="shp-svg" viewBox="0 0 1080 1080"><defs><filter id="rough"><feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="14"/></filter></defs>
        <path class="br s1" d="M 600 520 C 700 430, 860 450, 930 540" filter="url(#rough)"/><path class="br s2" d="M 640 700 C 720 650, 820 660, 900 720" filter="url(#rough)"/><circle class="br-dot s3" cx="760" cy="860" r="56" filter="url(#rough)"/></svg>`;
    case "slab":
      return `<div class="iso"><i class="slab s1"></i><i class="slab s2"></i><i class="slab s3"></i></div>`;
    case "blob":
      return `<div class="goo"><i class="blob s1"></i><i class="blob s2"></i><i class="blob s3"></i></div>`;
    default:
      return `<i class="shp s1 ${kind}"></i><i class="shp s2 ${kind}"></i><i class="shp s3 ${kind}"></i>`;
  }
}

function decoHtml(style: StyleSpec): string {
  switch (style.id) {
    case "swiss": return `<div class="grid12">${Array.from({ length: 11 }, (_, i) => `<i style="left:${84 + (i + 1) * 76}px"></i>`).join("")}</div><div class="redsq"><b>07</b><i></i></div>`;
    case "linear": return `<div class="hair">${Array.from({ length: 9 }, (_, i) => `<i style="top:${120 * (i + 1)}px"></i>`).join("")}</div>`;
    case "editorial": return `<div class="kicker">ISSUE 07 — THE PERSONALITY</div><div class="rule"></div>`;
    case "cinematic": return `<div class="bars"><i></i><i></i></div>`;
    case "retro-vhs": return `<div class="sun"></div><div class="floor"></div><div class="osd">PLAY ▶ 00:04</div>`;
    case "brutalist": return `<div class="brut">[01] PERSONALITY.EXE</div>`;
    case "hand-drawn": return `<svg class="doodle" viewBox="0 0 1080 1080"><path class="dr dd" d="M 90 400 C 260 420, 420 395, 560 410"/><path class="dr dd" d="M 520 300 C 600 250, 660 260, 700 300 M 690 270 L 702 302 L 668 306"/></svg>`;
    case "ink-paint": return `<svg class="doodle" viewBox="0 0 1080 1080"><defs><filter id="bleed"><feTurbulence type="fractalNoise" baseFrequency=".03" numOctaves="3" seed="9"/><feDisplacementMap in="SourceGraphic" scale="22"/></filter></defs><path class="sweep" d="M 70 360 C 260 330, 460 380, 640 340" filter="url(#bleed)"/></svg>`;
    case "collage": return `<i class="tape t1"></i><i class="tape t2"></i><div class="sticker">NEW!</div>`;
    case "glitch": return `<div class="slices"><i></i><i></i><i></i></div>`;
    case "3d": return `<i class="floorshadow f1"></i><i class="floorshadow f2"></i>`;
    default: return "";
  }
}

function extraHtml(x: Script["extra"]): string {
  switch (x) {
    case "bars": return `<div class="barsx">${[0.32, 0.5, 0.44, 0.7, 1].map((h, i) => `<i class="${i === 4 ? "on" : ""}" style="--h:${h}"></i>`).join("")}</div>`;
    case "ui": return `<div class="uix"><div class="row"><b>Auto-publish</b><span class="sw"><i></i></span></div><div class="row"><b>Your personality</b><span class="pillx">On</span></div></div>`;
    case "quote": return "";
    case "button": return `<div class="btnx">Start now</div><div class="urlx">reelcut.app</div>`;
    default: return "";
  }
}

const CSS = (style: StyleSpec, p: Palette) => {
  const s = surfaces(p);
  const shapeKind = SHAPES[style.id] ?? "flat";
  return `
  #root { --ground:${p.ground}; --ink:${p.ink}; --accent:${p.accent}; --accent-2:${p.accent2}; --card:${s.card}; --card-ink:${p.ink}; --muted:${s.muted}; --card-muted:${s.muted}; --line:${s.line}; background:${p.ground}; color:${p.ink}; }
  #root .cam { position:absolute; inset:0; transform-origin:540px 540px; }
  #root .tx { position:absolute; inset:0; pointer-events:none; z-index:20; }
  #root .hl { position:absolute; left:84px; top:110px; z-index:5; font-family:var(--font-display); font-weight:var(--display-weight); letter-spacing:var(--display-tracking); text-transform:var(--display-case); font-stretch:var(--display-stretch); font-size:118px; line-height:.98; }
  #root .hl .ln { display:block; }
  #root .hl em { font-family:var(--font-serif); font-style:italic; font-weight:400; color:var(--accent); text-transform:none; letter-spacing:-0.01em; }
  #root .num { position:absolute; left:84px; top:520px; z-index:5; font-family:var(--font-display); font-weight:var(--display-weight); font-size:150px; line-height:1; letter-spacing:-0.03em; color:var(--accent); font-variant-numeric:tabular-nums; }
  #root .lbl { position:absolute; left:88px; top:690px; z-index:5; font:500 30px/1.2 var(--font-sans); color:var(--muted); }
  #root .cardx { position:absolute; left:84px; top:820px; z-index:6; height:96px; padding:0 34px 0 26px; border-radius:48px; display:flex; align-items:center; gap:18px; background:var(--card); color:var(--ink); font:600 34px/1 var(--font-sans); box-shadow:0 18px 40px -18px rgba(0,0,0,.35); }
  #root .cardx .rc-check-d { --pt:2px; --cc:var(--accent); }
  #root .shp { position:absolute; z-index:3; display:block; background:var(--accent); }
  #root .shp.s1 { left:640px; top:360px; width:230px; height:230px; border-radius:50%; }
  #root .shp.s2 { left:740px; top:610px; width:190px; height:190px; border-radius:22px; background:var(--accent-2); transform:rotate(6deg); }
  #root .shp.s3 { left:560px; top:820px; width:330px; height:112px; border-radius:56px; background:var(--ink); }
  #root .shp.card { box-shadow:0 6px 0 rgba(0,0,0,.12), 0 22px 30px -8px rgba(0,0,0,.28); clip-path:polygon(0 3%, 6% 0, 18% 2%, 33% 0, 51% 2%, 70% 0, 86% 3%, 100% 1%, 98% 22%, 100% 47%, 98% 70%, 100% 96%, 82% 100%, 60% 98%, 41% 100%, 20% 98%, 3% 100%, 0 78%, 2% 52%, 0 26%); }
  #root .shp.s1.card { clip-path:none; }
  #root .shp.clay { box-shadow:inset -18px -22px 34px rgba(0,0,0,.22), inset 16px 16px 26px rgba(255,255,255,.45), 0 22px 26px -10px rgba(0,0,0,.35); }
  #root .shp.flat { box-shadow:none; }
  #root .shp.block { border-radius:0; box-shadow:none; }
  #root .shp.s1.block { border-radius:0; }
  ${style.id === "brutalist" ? `#root .shp.block { border:8px solid var(--ink); } #root .cardx { border-radius:0; border:6px solid var(--ink); box-shadow:12px 12px 0 var(--ink); font-family:var(--font-mono); }` : ""}
  ${style.id === "minimal" ? `#root .shp.s2, #root .shp.s3 { display:none; } #root .shp.s1 { left:860px; top:220px; width:90px; height:90px; } #root .hl { font-size:96px; top:300px; } #root .num { top:560px; font-size:96px; } #root .lbl { top:672px; } #root .cardx { top:860px; }` : ""}
  ${style.id === "swiss" ? `#root .hl { top:auto; bottom:160px; font-size:124px; } #root .num { top:110px; left:84px; } #root .lbl { top:270px; } #root .shp.s1 { display:none; } #root .cardx { top:auto; bottom:60px; left:auto; right:84px; border-radius:0; }` : ""}
  ${style.id === "kinetic-type" ? `#root .hl { font-size:210px; top:200px; line-height:.9; } #root .num, #root .lbl { display:none; } #root .cardx { top:860px; }` : ""}
  ${style.id === "editorial" ? `#root .hl { top:190px; font-size:112px; } #root .shp.s1 { border-radius:4px; left:620px; top:420px; width:330px; height:420px; background:linear-gradient(160deg, var(--accent-2), var(--accent)); } #root .shp.s2, #root .shp.s3 { display:none; }` : ""}
  ${style.id === "cinematic" ? `#root .hl { top:380px; font-size:120px; text-align:left; } #root .num, #root .lbl { display:none; } #root .cardx { display:none; }` : ""}
  ${style.id === "ui-product" ? `#root .shp { display:none; }` : ""}
  ${style.id === "retro-vhs" ? `#root .shp.s1 { display:none; } #root .num { font-size:130px; }` : ""}
  ${style.id === "liquid" ? `#root .goo { left:600px; } #root .num { font-size:130px; }` : ""}
  ${style.id === "glitch" || style.id === "retro-vhs" ? `#root .hl { text-shadow: 4px 0 rgba(255,0,60,.75), -4px 0 rgba(0,229,255,.75); }` : ""}
  #root .shp-svg, #root .doodle { position:absolute; inset:0; width:1080px; height:1080px; z-index:3; pointer-events:none; }
  #root .dr { fill:none; stroke:var(--accent); stroke-width:${style.id === "linear" ? 4 : 9}; stroke-linecap:round; stroke-linejoin:round; }
  #root .dr.s2 { stroke:var(--accent-2); } #root .dr.s3 { stroke:var(--ink); }
  #root .dd { stroke:var(--accent); stroke-width:8; }
  #root .br { fill:none; stroke:var(--accent); stroke-width:46; stroke-linecap:round; } #root .br.s2 { stroke:var(--accent-2); } #root .br-dot { fill:var(--ink); }
  #root .sweep { fill:none; stroke:var(--accent); stroke-width:120; stroke-linecap:round; opacity:.35; }
  #root .iso { position:absolute; left:600px; top:420px; width:380px; height:420px; z-index:3; }
  #root .slab { position:absolute; left:40px; width:280px; height:280px; transform:rotateX(60deg) rotateZ(45deg); background:var(--accent); box-shadow:10px 10px 0 color-mix(in oklab, var(--accent) 65%, #000); }
  #root .slab.s1 { top:0; background:var(--accent); } #root .slab.s2 { top:90px; background:var(--accent-2); box-shadow:10px 10px 0 color-mix(in oklab, var(--accent-2) 65%, #000); } #root .slab.s3 { top:180px; background:var(--card); box-shadow:10px 10px 0 color-mix(in oklab, var(--ink) 30%, var(--card)); }
  #root .goo { position:absolute; left:560px; top:330px; width:440px; height:560px; z-index:3; filter:url(#pvgoo); }
  #root .blob { position:absolute; display:block; border-radius:50%; background:var(--accent); }
  #root .blob.s1 { left:60px; top:40px; width:240px; height:240px; } #root .blob.s2 { left:180px; top:230px; width:200px; height:200px; background:var(--accent-2); } #root .blob.s3 { left:40px; top:330px; width:170px; height:170px; }
  #root .sphere { border-radius:50% !important; background:radial-gradient(circle at 32% 28%, color-mix(in oklab, var(--accent) 35%, #fff), var(--accent) 42%, color-mix(in oklab, var(--accent) 55%, #000) 100%) !important; }
  #root .s2.sphere { background:radial-gradient(circle at 32% 28%, color-mix(in oklab, var(--accent-2) 35%, #fff), var(--accent-2) 42%, color-mix(in oklab, var(--accent-2) 55%, #000) 100%) !important; transform:none !important; }
  #root .s3.sphere { width:130px !important; height:130px !important; left:640px !important; top:780px !important; background:radial-gradient(circle at 32% 28%, #fff, color-mix(in oklab, var(--ink) 40%, #fff) 50%, var(--ink) 100%) !important; }
  #root .floorshadow { position:absolute; z-index:2; height:40px; border-radius:50%; background:rgba(0,0,0,.28); filter:blur(14px); }
  #root .floorshadow.f1 { left:660px; top:610px; width:200px; } #root .floorshadow.f2 { left:750px; top:810px; width:170px; }
  #root:has(.barsx) .redsq, #root:has(.uix) .floorshadow, #root:has(.barsx) .floorshadow { display:none; }
  #root .grid12 i { position:absolute; top:0; bottom:0; width:1px; background:var(--line); }
  #root .redsq { position:absolute; right:84px; top:96px; width:300px; height:300px; background:var(--accent); z-index:2; }
  #root .redsq b { position:absolute; left:22px; bottom:6px; font:800 150px/1 var(--font-display); color:var(--ground); letter-spacing:-0.05em; }
  #root .redsq i { position:absolute; left:22px; right:22px; top:26px; height:6px; background:var(--ground); }
  #root .hair i { position:absolute; left:0; right:0; height:1px; background:var(--line); }
  #root .kicker { position:absolute; left:88px; top:100px; font:600 22px/1 var(--font-sans); letter-spacing:.18em; color:var(--muted); }
  #root .rule { position:absolute; left:84px; right:84px; top:140px; height:2px; background:var(--ink); }
  #root .bars i { position:absolute; left:0; right:0; height:120px; background:#000; z-index:19; } #root .bars i:first-child { top:0; } #root .bars i:last-child { bottom:0; }
  #root .sun { position:absolute; left:640px; top:250px; width:360px; height:360px; border-radius:50%; background:linear-gradient(var(--accent-2), var(--accent)); -webkit-mask:repeating-linear-gradient(#000 0 26px, transparent 26px 34px); mask:repeating-linear-gradient(#000 0 26px, transparent 26px 34px); }
  #root .floor { position:absolute; left:-200px; right:-200px; bottom:-60px; height:420px; transform:perspective(500px) rotateX(62deg); background:repeating-linear-gradient(90deg, color-mix(in oklab, var(--accent) 60%, transparent) 0 2px, transparent 2px 80px), repeating-linear-gradient(color-mix(in oklab, var(--accent) 60%, transparent) 0 2px, transparent 2px 60px); }
  #root .osd { position:absolute; right:84px; top:90px; font:700 34px/1 var(--font-mono); color:var(--ink); letter-spacing:.05em; z-index:6; }
  #root .brut { position:absolute; right:84px; top:96px; font:700 28px/1 var(--font-mono); background:var(--ink); color:var(--ground); padding:10px 14px; z-index:6; }
  #root .tape { position:absolute; z-index:7; width:150px; height:46px; background:color-mix(in oklab, #fff 70%, var(--ground)); opacity:.85; box-shadow:0 2px 6px rgba(0,0,0,.15); }
  #root .tape.t1 { left:610px; top:350px; transform:rotate(-24deg); } #root .tape.t2 { left:840px; top:600px; transform:rotate(18deg); }
  #root .sticker { position:absolute; right:96px; top:110px; width:150px; height:150px; border-radius:50%; background:var(--accent-2); color:var(--ink); display:grid; place-items:center; font:900 36px/1 var(--font-display); transform:rotate(-12deg); z-index:7; }
  #root .slices { position:absolute; inset:0; z-index:8; pointer-events:none; }
  #root .slices i { position:absolute; left:0; right:0; height:22px; background:color-mix(in oklab, var(--accent) 40%, transparent); mix-blend-mode:screen; opacity:0; }
  #root .barsx { position:absolute; left:560px; right:84px; top:400px; height:420px; display:flex; align-items:flex-end; gap:22px; z-index:4; }
  #root .barsx i { flex:1; height:calc(var(--h) * 100%); background:color-mix(in oklab, var(--ink) 18%, transparent); border-radius:${shapeKind === "block" ? 0 : 14}px ${shapeKind === "block" ? 0 : 14}px 4px 4px; transform-origin:50% 100%; }
  #root .barsx i.on { background:var(--accent); }
  #root .uix { position:absolute; left:560px; top:430px; width:436px; padding:18px 26px; border-radius:36px; background:var(--card); box-shadow:0 30px 60px -24px rgba(0,0,0,.4); z-index:4; }
  #root .uix .row { height:104px; display:flex; align-items:center; justify-content:space-between; font:600 30px/1.1 var(--font-sans); }
  #root .uix .row + .row { border-top:1px solid var(--line); }
  #root .uix .sw { width:104px; height:60px; border-radius:30px; background:color-mix(in oklab, var(--ink) 16%, transparent); position:relative; }
  #root .uix .sw i { position:absolute; left:6px; top:6px; width:48px; height:48px; border-radius:50%; background:#fff; box-shadow:0 3px 8px rgba(0,0,0,.25); }
  #root .uix .pillx { padding:10px 18px; border-radius:20px; background:color-mix(in oklab, var(--accent) 18%, transparent); color:var(--accent); font-size:24px; }
  #root .btnx { position:absolute; left:84px; top:560px; height:120px; padding:0 64px; border-radius:60px; background:var(--accent); color:var(--ground); display:flex; align-items:center; font:700 48px/1 var(--font-sans); z-index:5; }
  #root .urlx { position:absolute; left:88px; top:720px; font:500 32px/1 var(--font-mono); color:var(--muted); z-index:5; }
  `;
};

export function previewComposition(style: StyleSpec, kind: PreviewKind, o: PreviewOptions): string {
  const beat = o.beat ?? style.beats[0] ?? "statement";
  const sc = scriptFor(kind, beat);
  const verb = VERB[style.id] ?? "rise";
  const shapes = SHAPES[style.id] ?? "flat";
  const cadence = o.cadence ?? style.motion.cadence;
  const fps = cadence === "stepped-8" ? 8 : cadence === "stepped-12" ? 12 : 0;
  const tex = o.texture ?? style.texture;
  const D = o.seconds ?? 4;
  const showNum = sc.numTo != null;
  const cfg = JSON.stringify({ verb, shapes, fps, D, sc, jitter: style.id === "stop-motion", glitch: verb === "glitch", id: o.id });
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /></head><body>
<template>
<style>${CSS(style, o.palette)}</style>
<div id="root" class="pv st-${style.id}" data-look="${style.look}" data-type="${esc(o.pairing)}" data-motion="${o.energy ?? style.motion.energy}" data-composition-id="${esc(o.id)}" data-width="1080" data-height="1080">
  <svg width="0" height="0" style="position:absolute"><filter id="pvgoo"><feGaussianBlur in="SourceGraphic" stdDeviation="14"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 26 -11"/></filter></svg>
  <div class="cam">
    ${decoHtml(style)}
    ${sc.extra === "bars" || sc.extra === "ui" || style.id === "ui-product" ? "" : shapesHtml(shapes)}
    <div class="hl"><span class="ln">${esc(sc.l1)}</span><span class="ln"><em>${esc(sc.l2)}</em></span></div>
    ${showNum ? `<div class="num">${esc(sc.numPre ?? "")}${sc.numFrom}${esc(sc.numSuf ?? "")}</div>` : ""}
    ${sc.label ? `<div class="lbl">${esc(sc.label)}</div>` : ""}
    ${extraHtml(style.id === "ui-product" && !sc.extra ? "ui" : sc.extra)}
    ${sc.card ? `<div class="cardx"><span class="rc-check-d"></span>${esc(sc.card)}</div>` : ""}
  </div>
  ${textureLayers(tex)}
</div>
<script>
(function () {
  const C = ${cfg};
  const tl = gsap.timeline({ paused: true });
  const R = "#root ";
  const has = (s) => document.querySelector(R + s);
  // The headline: the style's own entrance.
  if (C.verb === "slam") {
    const ws = RC.split(R + ".hl", "words");
    ws.forEach((w, i) => { tl.fromTo(w, { scale: i ? 1.7 : 1.25, opacity: i ? 0 : 0.6 }, { scale: 1, opacity: 1, duration: 0.32, ease: "spring.snappy" }, 0.05 + i * 0.16); RC.emit("pop", 0.05 + i * 0.16); });
  } else if (C.verb === "glitch") {
    RC.words(tl, R + ".hl", 0, { lead: true, stagger: 0.07, blur: 6 });
    const hl = has(".hl");
    tl.to(hl, { keyframes: [6, -10, 4, -3, 0].map((x) => ({ x, duration: 0.06, ease: "none" })) }, 0.25);
    tl.to(hl, { keyframes: [-8, 5, 0].map((x) => ({ x, duration: 0.05, ease: "none" })) }, 2.2);
    document.querySelectorAll(R + ".slices i").forEach((s, i) => { const y = 260 + i * 210; tl.set(s, { y, opacity: 0.9 }, 0.24 + i * 0.05); tl.set(s, { opacity: 0 }, 0.34 + i * 0.05); tl.set(s, { y: y + 120, opacity: 0.8 }, 2.18 + i * 0.04); tl.set(s, { opacity: 0 }, 2.26 + i * 0.04); });
  } else if (C.verb === "bounce") {
    const ws = RC.split(R + ".hl", "words");
    ws.forEach((w, i) => { tl.fromTo(w, { y: i ? -160 : -40, opacity: i ? 0 : 0.6 }, { y: 0, opacity: 1, duration: 0.6, ease: "spring.reward" }, 0.05 + i * 0.12); });
  } else {
    RC.words(tl, R + ".hl", 0, { lead: true, stagger: C.verb === "rise" ? 0.08 : 0.06 });
  }
  // The shapes.
  const s = [".s1", ".s2", ".s3"].map((k) => document.querySelector(R + ".cam " + k)).filter(Boolean);
  if (C.shapes === "outline" || C.shapes === "brush") {
    RC.draw(tl, s, 0.35, { duration: 0.9, stagger: 0.25 });
    const dot = has(".br-dot"); if (dot) RC.pop(tl, dot, 1.1);
    RC.draw(tl, R + ".dd", 1.0, { duration: 0.7, stagger: 0.3 });
  } else if (C.shapes === "slab") {
    s.forEach((el, i) => tl.fromTo(el, { y: -140 - i * 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: "spring.default" }, 0.35 + (2 - i) * 0.14));
  } else if (C.shapes === "blob") {
    s.forEach((el, i) => { tl.fromTo(el, { scale: 0.2 }, { scale: 1, duration: 0.9, ease: "spring.reward" }, 0.3 + i * 0.15); tl.to(el, { x: [30, -40, 20][i], y: [20, -30, 25][i], duration: 2.4, ease: "sine.inOut" }, 1.2); });
  } else if (C.verb === "bounce") {
    s.forEach((el, i) => {
      tl.fromTo(el, { y: -700 }, { y: 0, duration: 0.55, ease: "apple.exit" }, 0.3 + i * 0.18);
      tl.to(el, { keyframes: [{ scaleX: 1.18, scaleY: 0.8, duration: 0.1 }, { scaleX: 0.94, scaleY: 1.07, duration: 0.14 }, { scaleX: 1, scaleY: 1, duration: 0.2 }], transformOrigin: "50% 100%" }, 0.85 + i * 0.18);
    });
  } else if (C.verb === "slam") {
    s.forEach((el, i) => tl.fromTo(el, { scale: 1.5, opacity: 0, rotation: [-14, 10, -6][i] }, { scale: 1, opacity: 1, rotation: [-4, 8, -2][i], duration: 0.3, ease: "spring.snappy" }, 0.55 + i * 0.14));
  } else if (C.verb === "slide") {
    s.forEach((el, i) => tl.fromTo(el, { x: [520, 600, -700][i], rotation: [-10, 22, -6][i] }, { x: 0, rotation: el.classList.contains("s2") ? 6 : 0, duration: 0.8, ease: "spring.default" }, 0.3 + i * 0.16));
  } else if (C.verb === "float") {
    RC.flyIn(tl, s, 0.25, { stagger: 0.12 });
    s.forEach((el, i) => tl.to(el, { y: [-18, 14, -10][i], duration: 2.6, ease: "sine.inOut" }, 1.2));
  } else {
    RC.rise(tl, s, 0.35, { stagger: 0.1 });
  }
  RC.rise(tl, R + ".grid12, " + R + ".hair, " + R + ".redsq", 0, { lead: true, y: 0 });
  const sticker = has(".sticker"); if (sticker) RC.pop(tl, sticker, 1.4, { reward: true });
  const tapes = document.querySelectorAll(R + ".tape"); if (tapes.length) tl.fromTo(tapes, { opacity: 0, scale: 1.3 }, { opacity: 0.85, scale: 1, duration: 0.2, stagger: 0.12, ease: "spring.snappy" }, 1.0);
  const sweep = has(".sweep"); if (sweep) RC.draw(tl, sweep, 0.1, { duration: 0.8 });
  // The number, the label, the extra, the confirmation.
  if (has(".num")) { RC.rise(tl, R + ".num", 0.9, { y: 30 }); RC.count(tl, R + ".num", 1.0, { from: C.sc.numFrom, to: C.sc.numTo, decimals: C.sc.numTo % 1 ? 1 : 0, prefix: C.sc.numPre || "", suffix: C.sc.numSuf || "", duration: 1.3 }); }
  if (has(".lbl")) RC.rise(tl, R + ".lbl", 1.15, { y: 16 });
  const bars = document.querySelectorAll(R + ".barsx i"); if (bars.length) tl.fromTo(bars, { scaleY: 0 }, { scaleY: 1, duration: 0.8, ease: "spring.default", stagger: 0.09 }, 0.6);
  if (has(".uix")) { RC.present(tl, R + ".uix", 0.4, { y: 40, spring: "gentle" }); tl.to(R + ".uix .sw", { backgroundColor: getComputedStyle(has(".uix")).getPropertyValue("--accent"), duration: 0.25 }, 1.6); tl.to(R + ".uix .sw i", { x: 44, duration: 0.45, ease: "spring.default" }, 1.55); RC.emit("toggle", 1.55); }
  if (has(".btnx")) { RC.present(tl, R + ".btnx", 0.6, { y: 30, spring: "gentle" }); RC.press(tl, R + ".btnx", 1.9, { scale: 0.96 }); RC.rise(tl, R + ".urlx", 1.0, { y: 14 }); }
  if (has(".cardx")) { RC.present(tl, R + ".cardx", 2.05, { y: 30, spring: "default" }); RC.checkDraw(tl, R + ".cardx .rc-check-d", 2.25); }
  RC.camera(tl, R + ".cam", 0, { duration: C.D, to: { scale: 1.03 } });
  RC.hold(tl, C.D);
  if (!C.fps) { window.__timelines["${esc(o.id)}"] = tl; return; }
  // Held frames: the beat advances in steps of 1/fps, the way hand-made animation does; Stop Motion adds a seeded
  // half-pixel jitter on every step, as a hand moving objects between frames would.
  const outer = gsap.timeline({ paused: true });
  const st = { t: 0 }, rnd = RC.rand(7), jit = Array.from({ length: Math.ceil(C.D * C.fps) + 2 }, () => [rnd() * 3 - 1.5, rnd() * 3 - 1.5]);
  const cam = has(".cam");
  const paint = () => {
    const k = Math.floor(st.t * C.fps + 1e-6);
    tl.seek(k / C.fps, false);
    if (C.jitter && cam) cam.style.translate = jit[k][0].toFixed(2) + "px " + jit[k][1].toFixed(2) + "px";
  };
  paint();
  outer.fromTo(st, { t: 0 }, { t: C.D, duration: C.D, ease: "none", onUpdate: paint, immediateRender: false }, 0);
  window.__rcEvents = (window.__rcEvents || []);
  window.__timelines["${esc(o.id)}"] = outer;
})();
</script>
</template>
</body></html>
`;
}
