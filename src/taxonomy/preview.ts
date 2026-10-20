import { toOklch } from "../personality/color.js";
import type { Cadence, Palette, StyleSpec, Texture } from "../personality/styles.js";
import { PLAIN } from "./plain.js";

/**
 * A preview clip per technique: 3.4 seconds, 1:1, the technique's mechanism shown on simple marks (squares, dots,
 * cards, lines, a face) with its sample line, in a personality's style, colours, type and motion. Built on the same
 * style layer as the Personality page's previews, so a technique looks the way it would in the owner's reels.
 *
 * Each scene is HTML (absolute, on the 1080 square), its CSS and its timeline. Scenes keep the headline band
 * (top 96–300) clear and live in 340–1000, or (typographic scenes) are the line themselves.
 */
export const PREVIEW_SECONDS = 3.4;

export interface TechniquePreviewOptions {
  id: string;
  palette: Palette;
  pairing: string;
  energy?: "restrained" | "default" | "energetic";
  cadence?: Cadence;
  texture?: Texture;
}

interface Scene { html: string; css?: string; js: string; headline?: boolean }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const box = (x: number, y: number, w: number, h: number) => `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
/** Top-left corners of a cols × rows grid of size-px cells, centred on (cx, cy). */
function grid(cols: number, rows: number, size: number, gap: number, cx = 540, cy = 660): { x: number; y: number }[] {
  const w = cols * size + (cols - 1) * gap, h = rows * size + (rows - 1) * gap, out: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: Math.round(cx - w / 2 + c * (size + gap)), y: Math.round(cy - h / 2 + r * (size + gap)) });
  return out;
}
/** A seeded 0..1 sequence, so a scene is the same every render. */
function seq(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
/** A mark: a square or a circle, muted, with an accent layer that can be lit (`.on`). */
const mark = (x: number, y: number, size: number, cls = "", round = false, extra = "") =>
  `<div class="x ${round ? "rd" : ""} ${cls}" style="${box(x, y, size, size)};${extra}"><i class="on"></i></div>`;
const svg = (body: string) => `<svg class="art" viewBox="0 0 1080 1080">${body}</svg>`;
const icon = {
  check: `<path d="M -26 2 L -8 20 L 28 -18"/>`,
  cross: `<path d="M -22 -22 L 22 22 M 22 -22 L -22 22"/>`,
  bolt: `<path d="M 6 -34 L -18 6 L 2 6 L -6 34 L 20 -6 L 0 -6 Z"/>`,
  shield: `<path d="M 0 -32 L 26 -22 L 26 2 C 26 18 14 28 0 34 C -14 28 -26 18 -26 2 L -26 -22 Z"/>`,
};

// ── The scenes, by the family of moves they share ───────────────────────────────────────────────────────────

/** A 3×3 field of marks where one is set apart: colour, shape, light, focus, texture. */
function field(mode: "colour" | "odd" | "drain" | "light" | "focus" | "texture"): Scene {
  const cells = grid(3, 3, 150, 40);
  const k = 4;
  const html = cells.map((p, i) => {
    if (mode === "odd" && i === 5) return mark(p.x, p.y, 150, "sq");
    if (mode === "drain") return mark(p.x, p.y, 150, i === k ? "k" : "", false, `background:${["var(--accent)", "var(--accent-2)", "color-mix(in oklab, var(--accent) 50%, var(--accent-2))"][i % 3]}`);
    if (mode === "texture" && i === k) return `<div class="x k tex" style="${box(p.x - 10, p.y - 10, 170, 170)}"></div>`;
    return mark(p.x, p.y, 150, i === k ? "k" : "", mode === "odd");
  }).join("") + (mode === "light" ? `<div class="dark"></div>` : "");
  const js = {
    colour: `RC.styleEnter(tl, qa(".x"), 0.25); tl.to(q(".k .on"), { opacity: 1, duration: 0.35 }, 1.15); RC.pop(tl, q(".k"), 1.1, { reward: true });`,
    odd: `RC.styleEnter(tl, qa(".x"), 0.25); tl.fromTo(q(".sq"), { rotation: 0 }, { rotation: 45, duration: 0.6, ease: "spring.default" }, 1.1); tl.to(q(".sq .on"), { opacity: 1, duration: 0.3 }, 1.1);`,
    drain: `RC.styleEnter(tl, qa(".x"), 0.2); tl.to(qa(".x:not(.k)"), { filter: "grayscale(1)", opacity: 0.32, duration: 0.8, ease: "power2.inOut", stagger: 0.04 }, 1.05); tl.to(q(".k"), { scale: 1.1, duration: 0.6, ease: "spring.default" }, 1.3);`,
    light: `RC.styleEnter(tl, qa(".x"), 0.2); tl.fromTo(q(".dark"), { opacity: 0 }, { opacity: 1, duration: 0.8, ease: "power2.inOut" }, 1.0); tl.to(q(".k .on"), { opacity: 1, duration: 0.4 }, 1.2);`,
    focus: `RC.styleEnter(tl, qa(".x"), 0.2); tl.to(qa(".x:not(.k)"), { filter: "blur(10px)", opacity: 0.55, duration: 0.7, ease: "power2.inOut" }, 1.0); tl.to(q(".k .on"), { opacity: 1, duration: 0.35 }, 1.1); RC.pop(tl, q(".k"), 1.05);`,
    texture: `RC.styleEnter(tl, qa(".x:not(.k)"), 0.2); RC.pop(tl, q(".k"), 1.0, { reward: true });`,
  }[mode];
  return { html, js };
}

function crowd(): Scene {
  const cells = grid(6, 3, 110, 34, 540, 660);
  return {
    html: cells.map((p, i) => `<div class="fig ${i === 8 ? "k" : ""}" style="${box(p.x, p.y, 110, 110)}"><b></b><u></u></div>`).join(""),
    js: `tl.fromTo(qa(".fig"), { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.5, ease: "spring.gentle", stagger: { each: 0.03, from: "random" } }, 0.2); tl.to(qa(".fig.k b, .fig.k u"), { backgroundColor: getComputedStyle(q(".fig")).getPropertyValue("--accent").trim() || "#f60", duration: 0.3 }, 1.2); tl.to(q(".fig.k"), { y: -28, scale: 1.18, duration: 0.6, ease: "spring.default" }, 1.2); tl.to(qa(".fig:not(.k)"), { opacity: 0.4, duration: 0.5 }, 1.25);`,
  };
}

function wall(): Scene {
  const cells = grid(9, 6, 88, 10, 540, 670), r = seq(7);
  return {
    html: cells.map((p) => `<div class="x tile" style="${box(p.x, p.y, 88, 88)};background:color-mix(in oklab, var(--accent) ${Math.round(r() * 100)}%, var(--accent-2))"></div>`).join(""),
    js: `tl.fromTo(qa(".tile"), { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: "spring.default", stagger: { amount: 1.3, from: "center", grid: [6, 9] } }, 0.3);`,
  };
}

function scale(mode: "disparity" | "exaggerate" | "perspective" | "crop" | "centre" | "void"): Scene {
  switch (mode) {
    case "disparity": return {
      html: [[150, 820], [270, 860], [180, 940]].map(([x, y]) => mark(x!, y!, 70, "", true)).join("") + mark(470, 420, 440, "k", true),
      js: `RC.styleEnter(tl, qa(".x:not(.k)"), 0.2); tl.fromTo(q(".k"), { scale: 0.16 }, { scale: 1, duration: 0.9, ease: "spring.reward" }, 0.9); tl.set(q(".k .on"), { opacity: 1 }, 0.9);`,
    };
    case "exaggerate": return {
      html: `<div class="track" style="${box(84, 640, 700, 70)}"></div><div class="bar" style="${box(84, 640, 700, 70)}"></div><div class="tick" style="${box(780, 600, 4, 150)}"></div>`,
      js: `RC.rise(tl, qa(".track, .tick"), 0.2, { y: 0 }); tl.fromTo(q(".bar"), { scaleX: 0 }, { scaleX: 0.9, duration: 0.7, ease: "power2.out" }, 0.5); tl.to(q(".bar"), { scaleX: 1.9, duration: 0.8, ease: "spring.reward" }, 1.3);`,
    };
    case "perspective": return {
      html: svg(`<path class="lk" d="M 0 1080 L 540 520 L 1080 1080 M 180 1080 L 540 520 M 900 1080 L 540 520 M 0 520 L 1080 520"/>`) + `<div class="x far" style="${box(520, 430, 40, 90)}"></div>` + mark(150, 690, 300, "k"),
      js: `RC.draw(tl, R + ".lk", 0.2, { duration: 0.8 }); RC.rise(tl, q(".far"), 0.7, { y: 10 }); tl.fromTo(q(".k"), { scale: 0.1, y: -200 }, { scale: 1, y: 0, duration: 0.9, ease: "spring.default" }, 1.1); tl.set(q(".k .on"), { opacity: 1 }, 1.1);`,
    };
    case "crop": return {
      html: mark(140, 760, 90, "", true) + mark(480, 430, 1000, "k", true),
      js: `RC.pop(tl, q(".x:not(.k)"), 0.3); tl.set(q(".k .on"), { opacity: 1 }, 0); tl.fromTo(q(".k"), { x: 700, y: 500 }, { x: 0, y: 0, duration: 1.0, ease: "spring.default" }, 0.8);`,
    };
    case "centre": return {
      html: svg(`<path class="lk" d="M 540 360 L 540 960 M 240 660 L 840 660"/><circle class="lk" cx="540" cy="660" r="170"/>`) + mark(465, 585, 150, "k"),
      js: `RC.draw(tl, R + ".lk", 0.2, { duration: 0.8, stagger: 0.12 }); tl.set(q(".k .on"), { opacity: 1 }, 0); RC.pop(tl, q(".k"), 1.1, { reward: true });`,
    };
    case "void": return {
      html: `<div class="void" style="${box(0, 340, 1080, 680)}">${mark(510, 290, 60, "k", true)}</div>`,
      js: `tl.set(q(".k .on"), { opacity: 1 }, 0); tl.fromTo(q(".void"), { scale: 5 }, { scale: 1, duration: 2.2, ease: "power3.inOut", transformOrigin: "540px 320px" }, 0.3);`,
    };
  }
}

function group(mode: "proximity" | "similar" | "enclose" | "connect" | "hub" | "converge"): Scene {
  const r = seq(11);
  switch (mode) {
    case "proximity": {
      const dots = Array.from({ length: 12 }, (_, i) => ({ x: 140 + Math.round(r() * 760), y: 380 + Math.round(r() * 540), g: i % 3 }));
      const centres = [[260, 660], [540, 660], [820, 660]];
      return {
        html: dots.map((d) => mark(d.x, d.y, 64, `g${d.g}`, true)).join(""),
        js: `RC.styleEnter(tl, qa(".x"), 0.2); ${dots.map((d, i) => { const [cx, cy] = centres[d.g]!; const k = Math.floor(i / 3); return `tl.to(qa(".x")[${i}], { x: ${cx! - 70 + (k % 2) * 76 - d.x}, y: ${cy! - 70 + Math.floor(k / 2) * 76 - d.y}, duration: 0.9, ease: "spring.default" }, ${1.0 + (i % 4) * 0.03});`; }).join(" ")} tl.to(qa(".x .on"), { opacity: 1, duration: 0.3, stagger: { each: 0.03, from: "random" } }, 1.75);`,
      };
    }
    case "similar": {
      const cells = grid(6, 2, 110, 40, 540, 660);
      return {
        html: cells.map((p, i) => mark(p.x, p.y, 110, i % 3 === 0 ? "k" : "", i % 3 === 0)).join(""),
        js: `RC.styleEnter(tl, qa(".x"), 0.2); tl.to(qa(".x.k .on"), { opacity: 1, duration: 0.3, stagger: 0.06 }, 1.1); tl.to(qa(".x.k"), { y: -30, duration: 0.6, ease: "spring.default", stagger: 0.06 }, 1.1); tl.to(qa(".x:not(.k)"), { opacity: 0.35, duration: 0.5 }, 1.2);`,
      };
    }
    case "enclose": {
      const cells = grid(5, 1, 120, 40, 540, 660);
      return {
        html: cells.map((p, i) => mark(p.x, p.y, 120, i >= 1 && i <= 3 ? "k" : "", true)).join("") + svg(`<rect class="lk acc" x="${cells[1]!.x - 30}" y="${cells[1]!.y - 30}" width="${3 * 120 + 2 * 40 + 60}" height="180" rx="44"/>`),
        js: `RC.styleEnter(tl, qa(".x"), 0.2); RC.draw(tl, R + ".lk", 1.0, { duration: 0.8 }); tl.to(qa(".x.k .on"), { opacity: 1, duration: 0.3, stagger: 0.08 }, 1.5);`,
      };
    }
    case "connect": {
      const n = [[230, 470], [520, 400], [820, 520], [330, 800], [690, 840], [540, 640]];
      const links = [[0, 5], [1, 5], [2, 5], [3, 5], [4, 5], [0, 3], [2, 4]];
      return {
        html: svg(links.map(([a, b]) => `<path class="lk acc" d="M ${n[a!]![0]} ${n[a!]![1]} L ${n[b!]![0]} ${n[b!]![1]}"/>`).join("")) + n.map(([x, y], i) => mark(x! - 40, y! - 40, 80, i === 5 ? "k" : "", true)).join(""),
        js: `RC.styleEnter(tl, qa(".x"), 0.2); RC.draw(tl, R + ".lk", 0.9, { duration: 0.5, stagger: 0.12 }); tl.set(q(".k .on"), { opacity: 1 }, 0.9);`,
      };
    }
    case "hub": {
      const around = Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2 - Math.PI / 2; return [540 + Math.cos(a) * 250, 660 + Math.sin(a) * 250]; });
      return {
        html: svg(around.map(([x, y]) => `<path class="lk acc" d="M 540 660 L ${Math.round(x!)} ${Math.round(y!)}"/>`).join("")) + around.map(([x, y]) => mark(Math.round(x! - 36), Math.round(y! - 36), 72, "", true)).join("") + mark(460, 580, 160, "k", true),
        js: `tl.set(q(".k .on"), { opacity: 1 }, 0); RC.pop(tl, q(".k"), 0.3, { reward: true }); RC.draw(tl, R + ".lk", 0.8, { duration: 0.45, stagger: 0.07 }); tl.fromTo(qa(".x:not(.k)"), { scale: 0 }, { scale: 1, duration: 0.5, ease: "spring.default", stagger: 0.07 }, 1.0);`,
      };
    }
    case "converge": {
      const from = Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * Math.PI * 2; return [540 + Math.cos(a) * 520, 660 + Math.sin(a) * 420]; });
      return {
        html: from.map(([x, y]) => mark(Math.round(x! - 30), Math.round(y! - 30), 60, "bit", true)).join("") + mark(440, 560, 200, "k", true),
        js: `tl.set(q(".k .on"), { opacity: 1 }, 0); tl.set(q(".k"), { scale: 0 }, 0); RC.styleEnter(tl, qa(".bit"), 0.15); ${from.map(([x, y], i) => `tl.to(qa(".bit")[${i}], { x: ${Math.round(540 - x!)}, y: ${Math.round(660 - y!)}, duration: 0.9, ease: "power3.in" }, ${(0.7 + i * 0.04).toFixed(2)});`).join(" ")} tl.to(qa(".bit"), { opacity: 0, duration: 0.15 }, 1.55); tl.to(q(".k"), { scale: 1, duration: 0.8, ease: "spring.reward" }, 1.6);`,
      };
    }
  }
}

/** A small tree; `light` draws one branch in the accent, `bloom` bursts members out of one node, `ripple` sends a wave. */
function tree(mode: "tree" | "branch"): Scene {
  const root = [540, 420], kids = [[260, 630], [540, 630], [820, 630]];
  const leaves = kids.flatMap(([x]) => [[x! - 80, 850], [x! + 80, 850]]);
  const curve = (a: number[], b: number[]) => `M ${a[0]} ${a[1]} C ${a[0]} ${(a[1]! + b[1]!) / 2}, ${b[0]} ${(a[1]! + b[1]!) / 2}, ${b[0]} ${b[1]}`;
  const links = [...kids.map((k) => curve(root, k)), ...leaves.map((l, i) => curve(kids[Math.floor(i / 2)]!, l))];
  const lit = mode === "branch" ? `<path class="lk acc lit" d="${curve(root, kids[2]!)}"/><path class="lk acc lit" d="${curve(kids[2]!, leaves[5]!)}"/>` : "";
  return {
    html: svg(links.map((d, i) => `<path class="lk l${i < 3 ? 1 : 2}" d="${d}"/>`).join("") + lit) + mark(root[0]! - 50, root[1]! - 50, 100, "k", true)
      + kids.map(([x, y], i) => mark(x! - 36, y! - 36, 72, mode === "branch" && i === 2 ? "kb" : "", true)).join("") + leaves.map(([x, y], i) => mark(x! - 26, y! - 26, 52, mode === "branch" && i === 5 ? "kb" : "", true)).join(""),
    js: `tl.set(q(".k .on"), { opacity: 1 }, 0); RC.pop(tl, q(".k"), 0.2); RC.draw(tl, R + ".l1", 0.5, { duration: 0.4, stagger: 0.08 }); tl.fromTo(qa(".x").slice(1, 4), { scale: 0 }, { scale: 1, duration: 0.45, ease: "spring.default", stagger: 0.08 }, 0.75); RC.draw(tl, R + ".l2", 0.95, { duration: 0.35, stagger: 0.05 }); tl.fromTo(qa(".x").slice(4), { scale: 0 }, { scale: 1, duration: 0.4, ease: "spring.default", stagger: 0.05 }, 1.15);${mode === "branch" ? ` tl.to(qa(".lk:not(.lit)"), { opacity: 0.3, duration: 0.4 }, 1.7); RC.draw(tl, R + ".lit", 1.75, { duration: 0.4, stagger: 0.3 }); tl.to(qa(".kb .on"), { opacity: 1, duration: 0.25, stagger: 0.3 }, 1.95);` : ""}`,
  };
}

function bloom(): Scene {
  const pts = Array.from({ length: 16 }, (_, i) => { const a = i * 2.4, rr = 110 + i * 15; return [Math.round(540 + Math.cos(a) * rr), Math.round(660 + Math.sin(a) * rr * 0.85)]; });
  return {
    html: svg(pts.map(([x, y]) => `<path class="lk acc" d="M 540 660 L ${x} ${y}"/>`).join("")) + pts.map(([x, y]) => mark(x! - 26, y! - 26, 52, "m", true)).join("") + mark(470, 590, 140, "k", true),
    js: `tl.set(q(".k .on"), { opacity: 1 }, 0); RC.pop(tl, q(".k"), 0.2); RC.draw(tl, R + ".lk", 0.8, { duration: 0.5, stagger: 0.04 }); ${pts.map(([x, y], i) => `tl.fromTo(qa(".m")[${i}], { x: ${540 - x!}, y: ${660 - y!}, scale: 0.2, opacity: 0 }, { x: 0, y: 0, scale: 1, opacity: 1, duration: 0.7, ease: "spring.default" }, ${(0.8 + i * 0.04).toFixed(2)});`).join(" ")}`,
  };
}

function ripple(): Scene {
  const cells = grid(9, 6, 50, 46, 540, 660);
  return {
    html: `<div class="ring" style="${box(440, 560, 200, 200)}"></div>` + cells.map((p) => mark(p.x, p.y, 50, "", true)).join(""),
    js: `tl.fromTo(qa(".x"), { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: "spring.default", stagger: { amount: 0.5, grid: [6, 9], from: "start" } }, 0.15); tl.fromTo(q(".ring"), { scale: 0.1, opacity: 0.9 }, { scale: 6, opacity: 0, duration: 1.6, ease: "power2.out" }, 1.0); ${cells.map((p, i) => { const d = Math.hypot(p.x + 25 - 540, p.y + 25 - 660); return `tl.to(qa(".x .on")[${i}], { opacity: 1, duration: 0.25 }, ${(1.0 + d / 360).toFixed(2)});`; }).join(" ")}`,
  };
}

function depth(mode: "stack" | "fly" | "push" | "pull" | "tilt" | "frame"): Scene {
  const card = (x: number, y: number, w: number, h: number, cls = "") => `<div class="card ${cls}" style="${box(x, y, w, h)}"><i class="dot"></i><i class="sk s1"></i><i class="sk s2"></i>${h >= 280 ? `<i class="sk s3"></i><i class="r3"><b></b><b></b><b></b></i>` : ""}</div>`;
  switch (mode) {
    case "stack": return {
      html: [4, 3, 2, 1, 0].map((i) => card(300 + i * 26, 480 - i * 36, 480, 300, i === 0 ? "front" : "")).join(""),
      js: `tl.fromTo(qa(".card"), { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: 0.6, ease: "spring.default", stagger: 0.14 }, 0.2); RC.pop(tl, q(".front .dot"), 1.2, { reward: true });`,
    };
    case "fly": return {
      html: card(260, 440, 560, 360, "front"),
      js: `RC.flyIn(tl, q(".card"), 0.5, { from: 0.25, blur: 22 }); tl.fromTo(q(".card"), { y: -120 }, { y: 0, duration: 1.0, ease: "spring.default" }, 0.5);`,
    };
    case "push": case "pull": {
      const cells = grid(3, 2, 250, 30, 540, 660).map((p, i) => card(p.x, p.y, 250, 170, i === 4 ? "front" : "")).join("");
      const to = mode === "push" ? `{ scale: 1.7, duration: 1.6, ease: "power3.inOut" }` : `{ scale: 1, duration: 1.8, ease: "power3.inOut" }`;
      return {
        html: `<div class="layer" style="${box(0, 340, 1080, 680)};overflow:hidden">${cells.replace(/top:(\d+)px/g, (_, y) => `top:${Number(y) - 340}px`)}</div>`,
        js: `gsap.set(q(".layer"), { transformOrigin: "540px 420px" }); ${mode === "push" ? `RC.styleEnter(tl, qa(".card"), 0.2); tl.to(q(".layer"), ${to}, 1.0);` : `tl.set(q(".layer"), { scale: 1.9 }, 0); tl.to(q(".layer"), ${to}, 0.6);`}`,
      };
    }
    case "tilt": return {
      html: `<div class="persp" style="${box(190, 400, 700, 460)}">${card(0, 0, 700, 460, "front")}</div>`,
      js: `RC.rise(tl, q(".card"), 0.2, { y: 30 }); tl.fromTo(q(".card"), { rotationX: 0, rotationZ: 0, scale: 1 }, { rotationX: 52, rotationZ: -22, scale: 0.9, duration: 1.2, ease: "spring.default" }, 1.0);`,
    };
    case "frame": return {
      html: `<div class="phone" style="${box(390, 370, 300, 580)}"><i class="sk" style="left:28px;top:40px;width:60%"></i><i class="sk" style="left:28px;top:84px;width:40%"></i><i class="sk" style="left:28px;top:470px;width:70%"></i><div class="pic"><i></i></div></div>`,
      js: `RC.rise(tl, q(".phone"), 0.1, { y: 40 }); tl.fromTo(q(".pic"), { yPercent: 55 }, { yPercent: 0, duration: 0.9, ease: "spring.default" }, 0.1); tl.fromTo(q(".pic i"), { scale: 0 }, { scale: 1, duration: 0.7, ease: "spring.reward" }, 1.4);`,
    };
  }
}

function leading(): Scene {
  return {
    html: svg(`<path class="lk acc" d="M 0 1080 L 540 640 M 1080 1080 L 540 640 M 0 400 L 540 640 M 1080 400 L 540 640 M 540 1080 L 540 640"/>`) + mark(490, 590, 100, "k", true),
    js: `RC.draw(tl, R + ".lk", 0.2, { duration: 0.9, stagger: 0.1 }); tl.set(q(".k .on"), { opacity: 1 }, 0); RC.pop(tl, q(".k"), 1.3, { reward: true });`,
  };
}

const face = (x: number, y: number, size: number, cls = "") =>
  `<div class="face ${cls}" style="${box(x, y, size, size)}"><i class="eye e1"><b></b></i><i class="eye e2"><b></b></i><svg viewBox="0 0 100 100"><path class="smile" d="M 32 64 Q 50 78 68 64"/></svg></div>`;

function social(mode: "gaze" | "face" | "point" | "host" | "anthro"): Scene {
  switch (mode) {
    case "gaze": return {
      html: face(130, 520, 260) + svg(`<path class="lk acc dash" d="M 420 640 C 560 600, 680 600, 760 650"/>`) + mark(780, 580, 150, "k"),
      js: `RC.pop(tl, q(".face"), 0.2); tl.to(qa(".eye b"), { x: 14, duration: 0.4, ease: "power2.out" }, 0.9); RC.draw(tl, R + ".lk", 1.1, { duration: 0.6 }); tl.set(q(".k .on"), { opacity: 1 }, 0); RC.pop(tl, q(".k"), 1.6, { reward: true });`,
    };
    case "face": return {
      html: face(310, 400, 460),
      js: `RC.pop(tl, q(".face"), 0.15, { reward: true }); RC.draw(tl, R + ".smile", 0.9, { duration: 0.5 }); tl.to(qa(".eye"), { scaleY: 0.1, duration: 0.08, yoyo: true, repeat: 1 }, 1.9);`,
    };
    case "point": return {
      html: mark(700, 560, 180, "k") + svg(`<path class="arrow" d="M 120 650 L 560 650 M 500 600 L 570 650 L 500 700"/>`),
      js: `RC.styleEnter(tl, q(".k"), 0.2); RC.draw(tl, R + ".arrow", 0.7, { duration: 0.7 }); tl.fromTo(q(".art"), { x: -40 }, { x: 0, duration: 0.7, ease: "power2.out" }, 0.7); tl.to(q(".k .on"), { opacity: 1, duration: 0.3 }, 1.35); RC.pop(tl, q(".k"), 1.3);`,
    };
    case "host": return {
      html: `<div class="blob" style="${box(170, 560, 240, 280)}">${face(30, 40, 180, "small")}</div>` + `<div class="card front" style="${box(520, 480, 420, 300)}"><i class="dot"></i><i class="sk s1"></i><i class="sk s2"></i></div>`,
      js: `tl.fromTo(q(".blob"), { y: 400 }, { y: 0, duration: 0.7, ease: "spring.reward" }, 0.2); tl.to(q(".blob"), { y: -40, duration: 0.25, ease: "power2.out", yoyo: true, repeat: 1 }, 1.0); RC.present(tl, q(".card"), 1.3, { y: 40, spring: "default" });`,
    };
    case "anthro": return {
      html: `<div class="card doc" style="${box(330, 400, 420, 540)}"><i class="sk s1"></i><i class="sk s2"></i><i class="sk" style="left:34px;top:420px;width:70%"></i><i class="sk" style="left:34px;top:464px;width:50%"></i>${face(110, 170, 200, "small")}</div>`,
      js: `RC.rise(tl, q(".doc"), 0.2, { y: 40 }); tl.fromTo(qa(".doc .eye"), { scale: 0 }, { scale: 1, duration: 0.4, ease: "spring.reward", stagger: 0.08 }, 0.7); RC.draw(tl, R + ".smile", 1.3, { duration: 0.4 }); tl.to(qa(".doc .eye"), { scaleY: 0.1, duration: 0.08, yoyo: true, repeat: 1 }, 2.2);`,
    };
  }
}

function semantic(mode: "contrast" | "metaphor" | "juxta" | "double" | "symbols" | "beforeafter" | "cause" | "famous" | "format"): Scene {
  switch (mode) {
    case "contrast": return {
      html: `<div class="half yes" style="${box(84, 400, 440, 520)}">${svg(`<g transform="translate(220 260) scale(2.6)">${icon.check}</g>`).replace('viewBox="0 0 1080 1080"', 'viewBox="0 0 440 520"')}</div><div class="half no" style="${box(556, 400, 440, 520)}">${svg(`<g transform="translate(220 260) scale(2.6)">${icon.cross}</g>`).replace('viewBox="0 0 1080 1080"', 'viewBox="0 0 440 520"')}</div>`,
      js: `tl.fromTo(q(".yes"), { x: -500 }, { x: 0, duration: 0.7, ease: "spring.default" }, 0.3); tl.fromTo(q(".no"), { x: 500 }, { x: 0, duration: 0.7, ease: "spring.default" }, 0.45); RC.draw(tl, R + ".half path", 0.45, { duration: 0.5, stagger: 0.2 });`,
    };
    case "metaphor": return {
      html: svg(`<path class="lk dash" d="M 120 900 C 360 860, 520 620, 900 440"/><g class="plane"><path class="pl" d="M -70 -10 L 70 -40 L -20 40 L -10 0 Z"/></g>`),
      js: `RC.draw(tl, R + ".lk", 0.5, { duration: 1.6, ease: "power1.inOut" }); tl.fromTo(q(".plane"), { x: 120, y: 900, rotation: -10 }, { x: 900, y: 440, rotation: -24, duration: 1.6, ease: "power1.inOut" }, 0.5);`,
    };
    case "juxta": return {
      html: mark(240, 520, 300, "sun", true) + mark(560, 600, 300, "k"),
      js: `tl.set(q(".k .on"), { opacity: 1 }, 0); tl.fromTo(q(".sun"), { x: -500 }, { x: 160, duration: 0.9, ease: "spring.default" }, 0.3); tl.fromTo(q(".k"), { x: 500 }, { x: -60, duration: 0.9, ease: "spring.default" }, 0.45);`,
    };
    case "double": return {
      html: svg(`<path class="blk" fill-rule="evenodd" d="M 190 450 H 890 V 870 H 190 Z M 330 610 H 640 V 540 L 780 660 L 640 780 V 710 H 330 Z"/><path class="arr" d="M 330 610 H 640 V 540 L 780 660 L 640 780 V 710 H 330 Z"/>`),
      js: `RC.rise(tl, q(".blk"), 0.2, { y: 30 }); tl.fromTo(q(".arr"), { opacity: 0 }, { opacity: 1, duration: 0.5 }, 1.4); tl.fromTo(q(".arr"), { x: 0 }, { x: 24, duration: 0.3, yoyo: true, repeat: 1, ease: "power2.inOut" }, 1.9);`,
    };
    case "symbols": return {
      html: [["bolt", "Fast"], ["shield", "Safe"], ["check", "Simple"]].map(([ic, t], i) => `<div class="sym" style="${box(120 + i * 300, 480, 240, 330)}"><div class="tileic">${svg(`<g transform="translate(120 120) scale(2.3)">${icon[ic as keyof typeof icon]}</g>`).replace('viewBox="0 0 1080 1080"', 'viewBox="0 0 240 240"')}</div><span>${t}</span></div>`).join(""),
      js: `tl.fromTo(qa(".sym"), { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.6, ease: "spring.default", stagger: 0.25 }, 0.5); RC.draw(tl, R + ".sym path", 0.5, { duration: 0.5, stagger: 0.25 });`,
    };
    case "beforeafter": return {
      html: `<div class="ba" style="${box(140, 400, 800, 520)}"><div class="bf">${[0, 1, 2, 3].map((i) => `<i style="left:${60 + (i * 37) % 90}px;top:${70 + i * 105}px;width:${300 + ((i * 131) % 260)}px;rotate:${[-6, 4, -3, 7][i]}deg"></i>`).join("")}</div><div class="af">${[0, 1, 2, 3].map((i) => `<i style="left:60px;top:${70 + i * 105}px;width:${[560, 420, 500, 300][i]}px"></i>`).join("")}</div><b class="div"></b></div>`,
      js: `RC.rise(tl, q(".ba"), 0.2, { y: 30 }); tl.fromTo(q(".af"), { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 1.2, ease: "power2.inOut" }, 1.0); tl.fromTo(q(".div"), { x: 0 }, { x: 796, duration: 1.2, ease: "power2.inOut" }, 1.0); tl.to(q(".div"), { opacity: 0, duration: 0.2 }, 2.2);`,
    };
    case "cause": return {
      html: `<div class="btn" style="${box(120, 600, 320, 120)}">Send</div><div class="card res" style="${box(600, 520, 360, 280)}"><span class="rc-check-d"></span></div>`,
      js: `RC.present(tl, q(".btn"), 0.2, { y: 30, spring: "gentle" }); var cur = RC.cursorEl(q(".cam")); RC.cursor(tl, cur, 0.4, [[300, 960, 0], [290, 670, 0.6]]); RC.click(tl, cur, 1.1, { target: q(".btn") }); RC.present(tl, q(".res"), 1.35, { y: 30, spring: "default" }); RC.checkDraw(tl, q(".res .rc-check-d"), 1.55);`,
    };
    case "famous": return {
      html: `<div class="frame" style="${box(330, 390, 420, 540)}"><div class="canvas">${face(110, 120, 200, "small")}</div></div><div class="spot"></div>`,
      js: `tl.fromTo(q(".spot"), { opacity: 0 }, { opacity: 1, duration: 0.9 }, 0.2); RC.rise(tl, q(".frame"), 0.4, { y: 30 }); RC.draw(tl, R + ".smile", 1.3, { duration: 0.6 });`,
    };
    case "format": return {
      html: [1, 2, 3].map((n) => `<div class="rank" style="${box(140, 380 + (n - 1) * 190, 800, 160)}"><b>${n}</b><i class="sk" style="width:${[460, 380, 300][n - 1]}px"></i></div>`).join(""),
      js: `tl.fromTo(qa(".rank").reverse(), { x: 900, opacity: 0 }, { x: 0, opacity: 1, duration: 0.6, ease: "spring.default", stagger: 0.32 }, 0.5);`,
    };
  }
}

/** The line is the picture: these scenes have no separate headline. */
function type(id: string, sample: string): Scene {
  const big = (inner: string, size = 150, extra = "") => `<div class="type" style="font-size:${size}px;${extra}">${inner}</div>`;
  switch (id) {
    case "word-by-word": return { headline: false, html: big(`<span class="w">${esc(sample)}</span>`, 120), js: `RC.words(tl, q(".w"), 0.2, { lead: true, stagger: 0.28 });` };
    case "serif-accent": {
      const [a, b] = [sample.split(" ").slice(0, -1).join(" "), sample.split(" ").pop()!];
      return { headline: false, html: big(`<span class="w">${esc(a)}</span> <em class="ser">${esc(b)}</em>`, 150), js: `RC.words(tl, q(".w"), 0.2, { lead: true }); tl.fromTo(q(".ser"), { opacity: 0, scale: 0.7, y: 30 }, { opacity: 1, scale: 1, y: 0, duration: 0.8, ease: "spring.reward" }, 1.1);` };
    }
    case "highlighter": return { headline: false, html: big(`Remember <span class="rc-hl">this part<span class="rc-mark"></span></span>`, 120), js: `RC.words(tl, q(".type"), 0.2, { lead: true }); RC.mark(tl, q(".rc-hl"), 1.2, { duration: 0.6 });` };
    case "strike-replace": return { headline: false, html: big(`<span class="rc-strike">Hard<span class="rc-rule"></span></span> <span class="nw">easy</span>`, 170), js: `RC.rise(tl, q(".rc-strike"), 0.2, { y: 20 }); RC.mark(tl, q(".rc-strike"), 1.0, { duration: 0.45 }); tl.to(q(".rc-strike"), { opacity: 0.4, duration: 0.3 }, 1.4); tl.fromTo(q(".nw"), { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.6, ease: "spring.reward" }, 1.5);` };
    case "kinetic-slam": return { headline: false, html: big(sample.split(" ").map((w) => `<span class="sl">${esc(w)}</span>`).join("<br>"), 170, "line-height:1.02"), js: `qa(".sl").forEach(function (el, i) { tl.fromTo(el, { scale: 2.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.32, ease: "power4.out" }, 0.25 + i * 0.5); });` };
    case "rolling-values": return { headline: false, html: big(`For <span class="rv">writers,</span>`, 140), js: `RC.rise(tl, q(".type"), 0.2, { y: 20 }); RC.roll(tl, q(".rv"), 0.9, { values: ["writers,", "coders,", "creators"], each: 0.8 });` };
    case "big-number": return { headline: false, html: big(`<span class="num">0</span><span class="cap">followers</span>`, 230), js: `RC.rise(tl, q(".num"), 0.2, { y: 20 }); RC.count(tl, q(".num"), 0.3, { from: 0, to: 71000, duration: 1.8 }); RC.rise(tl, q(".cap"), 1.4, { y: 16 });` };
    case "type-as-image": return { headline: false, html: big(["T", "Y", "P", "E"].map((c, i) => `<span class="ch c${i % 2}">${c}</span>`).join(""), 300, "letter-spacing:0;top:360px"), js: `qa(".ch").forEach(function (el, i) { tl.fromTo(el, { scale: 0.3, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.7, ease: "spring.reward" }, 0.25 + i * 0.16); }); tl.to(q(".type"), { scale: 1.04, duration: 2.4, ease: "none" }, 0.9);` };
    case "genre-quotation": return { headline: false, html: `<div class="cine"><div class="ti">COMING SOON</div><div class="st">A REELCUT PICTURE</div></div>`, js: `tl.fromTo(q(".cine"), { opacity: 0 }, { opacity: 1, duration: 0.5 }, 0); tl.fromTo(q(".ti"), { opacity: 0, scale: 1.12 }, { opacity: 1, scale: 1, duration: 1.6, ease: "power2.out" }, 0.4); RC.rise(tl, q(".st"), 1.5, { y: 10 });` };
    case "brand-code": return { headline: false, html: `<div class="flood"></div><div class="brand"><i class="logo"></i><span>${esc(sample)}</span></div>`, js: `tl.fromTo(q(".flood"), { clipPath: "circle(0% at 50% 50%)" }, { clipPath: "circle(75% at 50% 50%)", duration: 0.8, ease: "power3.inOut" }, 0.2); RC.pop(tl, q(".logo"), 0.9, { reward: true }); RC.rise(tl, q(".brand span"), 1.2, { y: 20 });` };
    case "hit-on-cut": return { headline: false, html: wave(40, "lo") + big(`<span class="boom">${esc(sample)}</span>`, 260, "top:300px") + `<div class="flash"></div>`, js: `RC.rise(tl, qa(".wv i"), 0.1, { y: 0 }); tl.set(q(".spike"), { scaleY: 6 }, 1.2); tl.fromTo(q(".boom"), { opacity: 0, scale: 1.4 }, { opacity: 1, scale: 1, duration: 0.4, ease: "power4.out" }, 1.2); tl.fromTo(q(".flash"), { opacity: 0.9 }, { opacity: 0, duration: 0.35, immediateRender: false }, 1.2);` };
    case "keystroke-texture": return { headline: false, html: big(`<span class="ty"></span>`, 120, "top:340px") + `<div class="keys">${["T", "Y", "P", "E", "D"].map((k) => `<span class="rc-kbd kk">${k}</span>`).join("")}</div>` + wave(30, "ks"), js: `RC.type(tl, q(".ty"), 0.3, { text: ${JSON.stringify(sample)}, cps: 7 }); qa(".kk").forEach(function (el, i) { tl.to(el, { y: 8, duration: 0.06, yoyo: true, repeat: 1 }, 0.35 + i * 0.3); tl.to(qa(".wv i")[i * 6], { scaleY: 4, duration: 0.06, yoyo: true, repeat: 1 }, 0.35 + i * 0.3); });` };
    default: return { headline: false, html: big(esc(sample)), js: `RC.words(tl, q(".type"), 0.2);` };
  }
}

function wave(n: number, cls: string): string {
  return `<div class="wv ${cls}">${Array.from({ length: n }, (_, i) => `<i class="${i === Math.floor(n / 2) ? "spike" : ""}" style="height:${12 + ((i * 37) % 23)}px"></i>`).join("")}</div>`;
}

function iface(mode: "ui" | "cursor" | "prompt" | "notify" | "toggle" | "code" | "pathcard"): Scene {
  switch (mode) {
    case "ui": return {
      html: `<div class="win" style="${box(160, 380, 760, 560)}"><div class="bar"><i></i><i></i><i></i></div>${[0, 1, 2].map((i) => `<div class="row" style="top:${100 + i * 110}px"><i class="dot"></i><i class="sk" style="width:${[380, 300, 340][i]}px"></i></div>`).join("")}<div class="row new" style="top:430px"><span class="rc-check-d"></span><i class="sk acc" style="width:320px"></i></div></div>`,
      js: `RC.present(tl, q(".win"), 0.2, { y: 40, spring: "gentle" }); RC.present(tl, q(".new"), 1.2, { y: 30, spring: "default" }); RC.checkDraw(tl, q(".new .rc-check-d"), 1.4);`,
    };
    case "cursor": return {
      html: `<div class="btn" style="${box(560, 560, 380, 150)}">Go</div>`,
      js: `RC.present(tl, q(".btn"), 0.2, { y: 30, spring: "gentle" }); var cur = RC.cursorEl(q(".cam")); RC.cursor(tl, cur, 0.3, [[140, 940, 0], [420, 820, 0.5], [760, 640, 0.6]]); RC.click(tl, cur, 1.55, { target: q(".btn") });`,
    };
    case "prompt": return {
      html: `<div class="prompt" style="${box(120, 400, 840, 120)}"><span class="ty"></span><i class="send"></i></div><div class="card ans" style="${box(120, 570, 640, 300)}"><i class="dot"></i><i class="sk s1"></i><i class="sk s2"></i><i class="sk s3"></i></div>`,
      js: `RC.present(tl, q(".prompt"), 0.1, { y: 30, spring: "gentle" }); RC.type(tl, q(".ty"), 0.4, { text: "Make me a reel", cps: 18 }); RC.press(tl, q(".send"), 1.3); RC.present(tl, q(".ans"), 1.55, { y: 40, spring: "default" }); tl.fromTo(qa(".ans .sk"), { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "power2.out", stagger: 0.12, transformOrigin: "0 50%" }, 1.75);`,
    };
    case "notify": return {
      html: [0, 1, 2].map((i) => `<div class="note" style="${box(180, 380 + i * 150, 720, 124)}"><i class="app"></i><i class="sk s1"></i><i class="sk s2"></i></div>`).join(""),
      js: `qa(".note").forEach(function (el, i) { tl.fromTo(el, { y: -160, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, duration: 0.6, ease: "spring.default" }, 0.4 + i * 0.45); });`,
    };
    case "toggle": return {
      html: `<div class="panel" style="${box(140, 400, 800, 520)}"><i class="on"></i><div class="sw"><i></i></div></div>`,
      js: `RC.rise(tl, q(".panel"), 0.2, { y: 30 }); tl.to(q(".sw i"), { x: 140, duration: 0.45, ease: "spring.default" }, 1.2); tl.to(q(".panel .on"), { opacity: 1, duration: 0.5 }, 1.25); RC.emit("toggle", 1.2);`,
    };
    case "code": return {
      html: `<div class="code" style="${box(120, 400, 840, 470)}">${["<b>const</b> reel = <s>await</s> make({", "  script: <u>\"hook.md\"</u>,", "  look: <u>\"atlas\"</u>,", "  technique: <u>\"reveal\"</u>,", "});"].map((l, i) => `<div class="cl ${i === 3 ? "hot" : ""}">${i === 3 ? `<i class="hb"></i>` : ""}${l}</div>`).join("")}</div>`,
      js: `RC.rise(tl, q(".code"), 0.12, { y: 30 }); tl.fromTo(qa(".cl"), { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.22, ease: "none", stagger: 0.1 }, 0.12); tl.fromTo(q(".hb"), { opacity: 0 }, { opacity: 1, duration: 0.4 }, 1.9);`,
    };
    case "pathcard": return {
      html: `<div class="pcard" style="${box(170, 360, 740, 600)}">${[["01", "Reveal"], ["02", "Space"], ["03", "From depth"], ["04", "Build"]].map(([n, t]) => `<div class="pr"><i></i><small>${n}</small><span>${t}</span></div>`).join("")}</div>`,
      js: `RC.rise(tl, q(".pcard"), 0, { y: 30 }); tl.fromTo(qa(".pr"), { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.4, ease: "spring.default", stagger: 0.1 }, 0.05); tl.fromTo(qa(".pr i"), { scale: 0 }, { scale: 1, duration: 0.4, ease: "spring.reward", stagger: 0.1 }, 0.15);`,
    };
  }
}

function sound(mode: "silence" | "beat"): Scene {
  if (mode === "silence") return {
    html: wave(40, "sil") + mark(440, 460, 200, "k", true),
    js: `tl.set(q(".k .on"), { opacity: 1 }, 0); tl.set(q(".k"), { scale: 0 }, 0); qa(".wv i").forEach(function (el, i) { tl.fromTo(el, { scaleY: 1 }, { scaleY: 1 + ((i * 7) % 5), duration: 0.2, yoyo: true, repeat: 3, ease: "sine.inOut" }, 0.1 + (i % 4) * 0.05); }); tl.to(qa(".wv i"), { scaleY: 0.12, duration: 0.3 }, 1.1); RC.pop(tl, q(".k"), 2.0, { reward: true }); tl.to(qa(".wv i"), { scaleY: 3, duration: 0.15, yoyo: true, repeat: 1 }, 2.0);`,
  };
  return {
    html: `<div class="cut" style="${box(190, 380, 700, 420)}"><i class="cc"></i><i class="cc c2"></i></div><div class="ticks">${Array.from({ length: 8 }, () => "<i></i>").join("")}</div>`,
    js: `RC.rise(tl, q(".cut"), 0.1, { y: 0 }); var cs = ["--accent", "--accent-2", "--ink", "--accent"].map(function (v) { return getComputedStyle(q(".cut")).getPropertyValue(v).trim(); }); [0.6, 1.1, 1.6, 2.1].forEach(function (t, i) { tl.set(q(".cut"), { backgroundColor: cs[i], scale: i % 2 ? 0.92 : 1 }, t); tl.set(qa(".cut .cc"), { x: i % 2 ? 60 : 0, rotation: i * 45 }, t); tl.fromTo(qa(".ticks i")[i * 2], { scaleY: 1 }, { scaleY: 2.4, duration: 0.12, yoyo: true, repeat: 1 }, t); });`,
  };
}

/** The scene for each technique. */
function sceneFor(id: string, sample: string): Scene {
  switch (id) {
    case "colour-isolation": return field("colour");
    case "odd-one-out": return field("odd");
    case "saturation-drop": return field("drain");
    case "value-contrast": return field("light");
    case "selective-focus": return field("focus");
    case "texture-against-flat": return field("texture");
    case "complementary-pairing": return { html: `<div class="half pa" style="${box(84, 420, 456, 480)}"><i class="dotb"></i></div><div class="half pb" style="${box(540, 420, 456, 480)}"><i class="dotb"></i></div>`, js: `tl.fromTo(q(".pa"), { x: -560 }, { x: 0, duration: 0.8, ease: "spring.default" }, 0.3); tl.fromTo(q(".pb"), { x: 560 }, { x: 0, duration: 0.8, ease: "spring.default" }, 0.45); RC.pop(tl, qa(".dotb"), 0.55, { stagger: 0.15 });` };
    case "silhouette": return { html: svg(`<circle class="disc" cx="540" cy="660" r="270"/><g class="sil"><circle cx="540" cy="560" r="80"/><path d="M 400 860 C 400 700, 680 700, 680 860 Z"/></g>`), js: `RC.pop(tl, q(".disc"), 0.2); RC.draw(tl, R + ".sil > *", 0.6, { duration: 0.8, stagger: 0.1 }); tl.fromTo(q(".sil"), { fillOpacity: 0 }, { fillOpacity: 1, duration: 0.5 }, 1.5);` };
    case "crowd-and-one": return crowd();
    case "abundance-wall": return wall();
    case "scale-disparity": return scale("disparity");
    case "exaggeration": return scale("exaggerate");
    case "forced-perspective": return scale("perspective");
    case "crop-at-edge": return scale("crop");
    case "centre-placement": return scale("centre");
    case "isolation-in-void": return scale("void");
    case "proximity-cluster": return group("proximity");
    case "similarity-set": return group("similar");
    case "enclosure": return group("enclose");
    case "connection-lines": return group("connect");
    case "hub-and-spokes": return group("hub");
    case "convergence": return group("converge");
    case "hierarchy-tree": return tree("tree");
    case "branch-highlight": return tree("branch");
    case "bloom": return bloom();
    case "ripple": return ripple();
    case "depth-stack": return depth("stack");
    case "from-depth": return depth("fly");
    case "camera-push": return depth("push");
    case "pull-back": return depth("pull");
    case "tilt-into-space": return depth("tilt");
    case "frame-within-frame": return depth("frame");
    case "leading-lines": return leading();
    case "gaze-cue": return social("gaze");
    case "face-first": return social("face");
    case "pointing-gesture": return social("point");
    case "character-host": return social("host");
    case "anthropomorphism": return social("anthro");
    case "semantic-contrast": return semantic("contrast");
    case "visual-metaphor": return semantic("metaphor");
    case "juxtaposition": return semantic("juxta");
    case "form-substitution": return { headline: true, html: `<div class="type sub" style="font-size:280px;top:430px">L<span class="o"><span class="ol">O</span><i class="ring"><b></b></i></span><span class="o"><span class="ol">O</span><i class="ring"><b></b></i></span>K</div>`, js: `RC.rise(tl, q(".sub"), 0.3, { y: 30 }); tl.to(qa(".ol"), { opacity: 0, duration: 0.3 }, 1.2); tl.fromTo(qa(".ring"), { scale: 0 }, { scale: 1, duration: 0.6, ease: "spring.reward", stagger: 0.1 }, 1.25); tl.to(qa(".ring b"), { x: 18, duration: 0.4 }, 2.0);` };
    case "double-reading": return semantic("double");
    case "symbol-shortcut": return semantic("symbols");
    case "before-after": return semantic("beforeafter");
    case "cause-effect": return semantic("cause");
    case "famous-image": return semantic("famous");
    case "familiar-format": return semantic("format");
    case "real-ui-demo": return iface("ui");
    case "cursor-path": return iface("cursor");
    case "prompt-answer": return iface("prompt");
    case "notification-arrival": return iface("notify");
    case "state-toggle": return iface("toggle");
    case "code-reveal": return iface("code");
    case "path-card": return iface("pathcard");
    case "silence-before": return sound("silence");
    case "cut-on-beat": return sound("beat");
    default: return type(id, sample);
  }
}

const CSS = (p: Palette) => {
  const dark = toOklch(p.ground).l < 0.5;
  const onAccent = toOklch(p.accent).l > 0.62 ? "#111111" : "#ffffff";
  const card = `color-mix(in oklab, ${p.ground} ${dark ? 86 : 70}%, #ffffff)`;
  return `
  #root { --ground:${p.ground}; --ink:${p.ink}; --accent:${p.accent}; --accent-2:${p.accent2}; --card:${card}; --card-ink:${p.ink}; --muted:color-mix(in oklab, ${p.ink} 62%, ${p.ground}); --card-muted:color-mix(in oklab, ${p.ink} 62%, ${p.ground}); --line:color-mix(in oklab, ${p.ink} 14%, transparent); --soft:color-mix(in oklab, ${p.ink} 16%, ${p.ground}); --on-accent:${onAccent}; --hot:color-mix(in oklab, ${p.accent} 32%, #14161a); }
  #root .cam { position:absolute; inset:0; z-index:2; }
  #root .hl { position:absolute; left:84px; top:96px; width:912px; z-index:6; font-size:84px; }
  #root .x { position:absolute; border-radius:24px; background:var(--soft); z-index:3; }
  #root .x.rd { border-radius:50%; } #root .x .on { position:absolute; inset:0; border-radius:inherit; background:radial-gradient(circle at 32% 28%, color-mix(in oklab, var(--accent) 55%, #ffffff), var(--accent) 46%, color-mix(in oklab, var(--accent) 70%, #000000)); opacity:0; }
  #root .x { background:radial-gradient(circle at 32% 28%, color-mix(in oklab, var(--soft) 70%, #ffffff), var(--soft) 60%); }
  #root .x.tex { background:repeating-linear-gradient(45deg, var(--accent) 0 14px, var(--accent-2) 14px 28px); box-shadow:0 24px 40px -18px rgba(0,0,0,.5); }
  #root .dark { position:absolute; left:0; right:0; top:330px; bottom:0; z-index:4; background:radial-gradient(circle at 540px 330px, transparent 110px, rgba(0,0,0,.78) 220px); -webkit-mask-image:linear-gradient(to bottom, transparent, #000 140px); mask-image:linear-gradient(to bottom, transparent, #000 140px); }
  #root .art { position:absolute; inset:0; width:1080px; height:1080px; z-index:2; overflow:visible; }
  #root .lk { fill:none; stroke:var(--soft); stroke-width:6; stroke-linecap:round; } #root .lk.acc { stroke:var(--accent); } #root .lk.dash { stroke-dasharray:4 18; stroke:var(--accent); }
  #root .fig b { position:absolute; left:33px; top:0; width:44px; height:44px; border-radius:50%; background:var(--soft); } #root .fig u { position:absolute; left:15px; top:52px; width:80px; height:58px; border-radius:40px 40px 14px 14px; background:var(--soft); }
  #root .fig { position:absolute; z-index:3; }
  #root .track { position:absolute; border-radius:35px; background:var(--soft); z-index:3; } #root .bar { position:absolute; border-radius:35px; background:var(--accent); transform-origin:0 50%; z-index:4; } #root .tick { position:absolute; background:var(--ink); z-index:5; border-radius:2px; }
  #root .far { background:var(--soft); border-radius:6px; }
  #root .void { position:absolute; z-index:3; }
  #root .ring { position:absolute; border-radius:50%; border:10px solid var(--accent); z-index:2; }
  #root .card { position:absolute; z-index:3; border-radius:32px; background:var(--card); box-shadow:0 30px 60px -28px rgba(0,0,0,.45), 0 0 0 1px var(--line); }
  #root .card .dot { position:absolute; left:34px; top:34px; width:64px; height:64px; border-radius:50%; background:var(--accent); }
  #root .card.front .dot { background:var(--accent); } #root .card:not(.front) .dot { background:var(--soft); }
  #root .sk { position:absolute; height:22px; border-radius:11px; background:var(--soft); } #root .sk.acc { background:var(--accent); }
  #root .card .s1 { left:34px; top:130px; width:58%; } #root .card .s2 { left:34px; top:174px; width:38%; } #root .card .s3 { left:34px; top:218px; width:48%; }
  #root .card .r3 { position:absolute; left:34px; right:34px; bottom:34px; height:30%; display:flex; gap:18px; } #root .card .r3 b { flex:1; border-radius:18px; background:linear-gradient(160deg, color-mix(in oklab, var(--accent) 35%, var(--card)), var(--soft)); }
  #root .layer { position:absolute; z-index:3; }
  #root .persp { position:absolute; perspective:1200px; z-index:3; } #root .persp .card { transform-style:preserve-3d; }
  #root .phone { position:absolute; z-index:3; border-radius:48px; border:14px solid var(--ink); overflow:hidden; background:var(--soft); }
  #root .phone .pic { position:absolute; inset:0; background:linear-gradient(160deg, var(--accent-2), var(--accent)); } #root .phone .pic i { position:absolute; left:76px; top:150px; width:120px; height:120px; border-radius:50%; background:var(--ground); }
  #root .face { position:absolute; z-index:3; border-radius:50%; background:var(--accent-2); } #root .face svg { position:absolute; inset:0; width:100%; height:100%; }
  #root .face .eye { position:absolute; top:34%; width:18%; height:18%; border-radius:50%; background:var(--ground); } #root .face .e1 { left:24%; } #root .face .e2 { right:24%; }
  #root .face .eye b { position:absolute; left:30%; top:30%; width:44%; height:44%; border-radius:50%; background:var(--ink); }
  #root .smile { fill:none; stroke:var(--ink); stroke-width:5; stroke-linecap:round; }
  #root .arrow { fill:none; stroke:var(--accent); stroke-width:22; stroke-linecap:round; stroke-linejoin:round; }
  #root .blob { position:absolute; z-index:3; border-radius:120px 120px 60px 60px; background:var(--accent); } #root .blob .face { background:transparent; }
  #root .doc .face { background:transparent; }
  #root .half { position:absolute; z-index:3; border-radius:36px; overflow:hidden; } #root .half .art { width:100%; height:100%; }
  #root .half path { fill:none; stroke-width:12; stroke-linecap:round; stroke-linejoin:round; }
  #root .yes { background:var(--accent); } #root .yes path { stroke:var(--on-accent); } #root .no { background:var(--soft); } #root .no path { stroke:var(--ink); }
  #root .pa { background:var(--accent); border-radius:36px 0 0 36px; } #root .pb { background:var(--accent-2); border-radius:0 36px 36px 0; }
  #root .dotb { position:absolute; left:168px; top:180px; width:120px; height:120px; border-radius:50%; } #root .pa .dotb { background:var(--accent-2); } #root .pb .dotb { background:var(--accent); }
  #root .disc { fill:var(--soft); } #root .sil > * { fill:var(--ink); stroke:var(--ink); stroke-width:6; }
  #root .pl { fill:var(--accent); } #root .plane { transform-box:fill-box; }
  #root .x.sun .on { background:var(--accent-2); opacity:1; }
  #root .blk { fill:var(--ink); } #root .arr { fill:var(--accent); }
  #root .sym { position:absolute; z-index:3; display:flex; flex-direction:column; align-items:center; gap:24px; }
  #root .sym .tileic { width:240px; height:240px; border-radius:48px; background:var(--accent); } #root .sym .art { position:static; width:240px; height:240px; }
  #root .sym path { fill:none; stroke:var(--on-accent); stroke-width:5; stroke-linejoin:round; stroke-linecap:round; }
  #root .sym span { font:600 46px/1 var(--font-sans); color:var(--ink); }
  #root .ba { position:absolute; z-index:3; border-radius:36px; overflow:hidden; background:var(--card); box-shadow:0 0 0 1px var(--line); }
  #root .ba .bf, #root .ba .af { position:absolute; inset:0; } #root .ba .af { background:var(--card); }
  #root .ba i { position:absolute; height:40px; border-radius:20px; background:var(--soft); } #root .ba .af i { background:var(--accent); }
  #root .ba .div { position:absolute; left:0; top:0; bottom:0; width:6px; background:var(--ink); }
  #root .btn { position:absolute; z-index:3; border-radius:60px; background:var(--accent); color:var(--on-accent); display:grid; place-items:center; font:700 52px/1 var(--font-sans); }
  #root .res .rc-check-d { position:absolute; left:120px; top:80px; width:120px; height:120px; --pt:3px; --cc:var(--accent); }
  #root .frame { position:absolute; z-index:3; border:26px solid color-mix(in oklab, var(--accent-2) 70%, #8a6a1e); background:var(--soft); box-shadow:0 40px 60px -30px rgba(0,0,0,.6); }
  #root .frame .canvas { position:absolute; inset:0; background:linear-gradient(170deg, color-mix(in oklab, var(--accent) 40%, var(--ground)), var(--soft)); }
  #root .spot { position:absolute; inset:0; z-index:2; background:radial-gradient(ellipse at 540px 640px, color-mix(in oklab, var(--accent-2) 22%, transparent) 0, transparent 430px); }
  #root .rank { position:absolute; z-index:3; border-radius:30px; background:var(--card); box-shadow:0 0 0 1px var(--line); }
  #root .rank b { position:absolute; left:40px; top:28px; font:800 104px/1 var(--font-display); color:var(--accent); } #root .rank .sk { left:170px; top:66px; height:28px; border-radius:14px; }
  #root .type { position:absolute; left:84px; right:84px; top:380px; z-index:6; font-family:var(--font-display); font-weight:var(--display-weight); line-height:1.05; letter-spacing:-0.025em; color:var(--ink); text-align:center; }
  #root .type .ser { font-family:var(--font-serif); font-style:italic; font-weight:400; color:var(--accent); display:inline-block; }
  #root .type .nw, #root .type .rv, #root .type .num { color:var(--accent); } #root .type .nw { display:inline-block; }
  #root .type .num { display:block; font-variant-numeric:tabular-nums; } #root .type .cap { display:block; font:500 44px/1.2 var(--font-sans); letter-spacing:0; color:var(--muted); margin-top:20px; }
  #root .type .sl { display:inline-block; } #root .type .ch { display:inline-block; } #root .type .c0 { color:var(--accent); } #root .type .c1 { color:var(--ink); }
  #root .type.sub { top:430px; } #root .type .o { position:relative; display:inline-block; } #root .type .o .ring { position:absolute; left:6%; top:18%; width:88%; height:70%; border-radius:50%; border:none; background:var(--ink); } #root .type .o .ring b { position:absolute; left:30%; top:30%; width:40%; height:40%; border-radius:50%; background:var(--ground); }
  #root .cine { position:absolute; inset:0; z-index:5; background:#0b0b0d; } #root .cine .ti { position:absolute; left:0; right:0; top:440px; text-align:center; font:400 96px/1 var(--font-serif); color:#f2efe8; letter-spacing:.2em; } #root .cine .st { position:absolute; left:0; right:0; top:590px; text-align:center; font:500 26px/1 var(--font-sans); letter-spacing:.32em; color:#b9b3a7; }
  #root .flood { position:absolute; inset:0; z-index:4; background:var(--accent); } #root .brand { position:absolute; left:84px; right:84px; top:380px; z-index:5; display:flex; flex-direction:column; align-items:center; gap:48px; }
  #root .brand .logo { width:200px; height:200px; border-radius:50%; border:28px solid var(--on-accent); box-sizing:border-box; } #root .brand span { font-family:var(--font-display); font-weight:var(--display-weight); font-size:120px; line-height:1.05; color:var(--on-accent); text-align:center; }
  #root .wv { position:absolute; left:140px; right:140px; top:860px; height:80px; z-index:3; display:flex; align-items:center; justify-content:space-between; }
  #root .wv i { display:block; width:8px; border-radius:4px; background:var(--muted); } #root .wv .spike { background:var(--accent); }
  #root .wv.sil { top:640px; }
  #root .boom { display:inline-block; color:var(--accent); }
  #root .flash { position:absolute; inset:0; z-index:7; background:#ffffff; opacity:0; pointer-events:none; }
  #root .keys { position:absolute; left:0; right:0; top:620px; z-index:4; display:flex; justify-content:center; gap:22px; } #root .keys .rc-kbd { font:600 44px/96px var(--font-mono); width:96px; height:96px; padding:0; text-align:center; border-radius:20px; }
  #root .win { position:absolute; z-index:3; border-radius:30px; background:var(--card); box-shadow:0 30px 60px -28px rgba(0,0,0,.45), 0 0 0 1px var(--line); overflow:hidden; }
  #root .win .bar { height:60px; border-bottom:1px solid var(--line); display:flex; align-items:center; gap:12px; padding-left:26px; } #root .win .bar i { width:16px; height:16px; border-radius:50%; background:var(--soft); }
  #root .win .row { position:absolute; left:40px; right:40px; height:80px; } #root .win .row .dot { position:absolute; left:0; top:12px; width:56px; height:56px; border-radius:16px; background:var(--soft); } #root .win .row .sk { left:84px; top:30px; }
  #root .win .new .rc-check-d { position:absolute; left:0; top:8px; width:64px; height:64px; --pt:2px; --cc:var(--accent); }
  #root .prompt { position:absolute; z-index:3; border-radius:60px; background:var(--card); box-shadow:0 0 0 2px var(--line), 0 24px 40px -24px rgba(0,0,0,.4); display:flex; align-items:center; padding:0 40px; font:500 46px/1 var(--font-sans); color:var(--ink); box-sizing:border-box; }
  #root .prompt .send { position:absolute; right:20px; top:20px; width:80px; height:80px; border-radius:50%; background:var(--accent); }
  #root .note { position:absolute; z-index:3; border-radius:30px; background:var(--card); box-shadow:0 20px 40px -24px rgba(0,0,0,.45), 0 0 0 1px var(--line); }
  #root .note .app { position:absolute; left:26px; top:26px; width:72px; height:72px; border-radius:20px; background:var(--accent); } #root .note .s1 { left:124px; top:34px; width:360px; } #root .note .s2 { left:124px; top:70px; width:240px; }
  #root .panel { position:absolute; z-index:3; border-radius:40px; background:var(--soft); overflow:hidden; } #root .panel .on { position:absolute; inset:0; background:var(--accent); opacity:0; }
  #root .panel .sw { position:absolute; left:260px; top:190px; width:280px; height:140px; border-radius:70px; background:var(--card); box-shadow:inset 0 0 0 2px var(--line); } #root .panel .sw i { position:absolute; left:10px; top:10px; width:120px; height:120px; border-radius:50%; background:var(--ink); }
  #root .code { position:absolute; z-index:3; border-radius:30px; background:#14161a; padding:40px 0; box-sizing:border-box; font:500 38px/2.05 var(--font-mono); color:#e8e6e1; }
  #root .code .cl { position:relative; padding:0 48px; white-space:pre; } #root .code .hb { position:absolute; inset:0; background:var(--hot); z-index:-1; } #root .code .cl.hot { isolation:isolate; } #root .code b { color:#ff8f70; font-weight:500; } #root .code s { text-decoration:none; color:#c3a6ff; } #root .code u { text-decoration:none; color:#9bd88f; }
  #root .pcard { position:absolute; z-index:3; border-radius:36px; background:var(--card); box-shadow:0 30px 60px -28px rgba(0,0,0,.45), 0 0 0 1px var(--line); padding:44px 48px; box-sizing:border-box; display:flex; flex-direction:column; gap:34px; }
  #root .pr { position:relative; height:96px; padding-left:130px; } #root .pr i { position:absolute; left:0; top:4px; width:84px; height:84px; border-radius:50%; border:4px solid var(--accent); box-sizing:border-box; }
  #root .pr small { display:block; font:600 22px/1 var(--font-mono); letter-spacing:.14em; color:var(--muted); } #root .pr span { display:block; margin-top:14px; font:400 54px/1 var(--font-serif); color:var(--ink); }
  #root .cut { position:absolute; z-index:3; border-radius:36px; background:var(--soft); overflow:hidden; } #root .cut .cc { position:absolute; left:120px; top:90px; width:240px; height:240px; border-radius:50%; background:var(--ground); opacity:.85; } #root .cut .c2 { left:400px; top:150px; width:180px; height:180px; border-radius:30px; }
  #root .ticks { position:absolute; left:190px; right:190px; top:870px; z-index:3; display:flex; justify-content:space-between; } #root .ticks i { width:10px; height:40px; border-radius:5px; background:var(--muted); }
  `;
};

/** The preview composition of a technique, in a style and a personality's palette, type and motion. */
export function techniquePreviewComposition(techniqueId: string, style: StyleSpec, o: TechniquePreviewOptions): string {
  const plain = PLAIN[techniqueId];
  const sample = plain?.sample ?? techniqueId;
  const sc = sceneFor(techniqueId, sample);
  const cadence = o.cadence ?? style.motion.cadence;
  const fps = cadence === "stepped-8" ? 8 : cadence === "stepped-12" ? 12 : 0;
  const headline = sc.headline !== false;
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /></head><body>
<template>
<style>${CSS(o.palette)}${sc.css ?? ""}</style>
<div id="root" data-look="${style.look}" data-style="${style.id}" data-type="${esc(o.pairing)}" data-motion="${o.energy ?? style.motion.energy}" data-composition-id="${esc(o.id)}" data-width="1080" data-height="1080">
  <div class="cam">
    ${sc.html}
    ${headline ? `<div class="rc-hl hl"><span class="ln">${esc(sample)}</span></div>` : ""}
  </div>
</div>
<script>
(function () {
  var tl = gsap.timeline({ paused: true }), R = "#root ";
  var q = function (s) { return typeof s === "string" ? document.querySelector(R + s) : s; };
  var qa = function (s) { return Array.from(document.querySelectorAll(R + s)); };
  RC.styleWorld("#root");
  RC.styleFinish("#root", ${o.texture ? JSON.stringify({ texture: o.texture }) : "{}"});
  ${headline ? `RC.styleWords(tl, R + ".hl", 0);` : ""}
  ${sc.js}
  RC.hold(tl, ${PREVIEW_SECONDS});
  window.__timelines["${esc(o.id)}"] = RC.cadence(tl, "#root", { fps: ${fps} });
})();
</script>
</template>
</body></html>
`;
}
