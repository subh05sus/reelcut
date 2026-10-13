import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The mascot pack: pixel poses of a Clawd (75 SVGs, provided by the owner and cleared for the repo), re-cast onto
 * Anthropic's minimal Clawd, which is the only Clawd reelcut draws (docs/design/clawd-decisions.md).
 *
 * Each SVG is one `<rect>` per pixel on a ~42.85 px grid, some flipped with a `rotate(-180)` that lands them where they
 * were. The pack's own Clawd is bigger than the minimal one (a 14 × 9 body, a mouth, 3 × 3 arms), so it is never drawn:
 * a pose keeps what Clawd is doing — its eyes, where it looks, where its hands are, how its legs stand, the small
 * Clawds around it — and everything that is not Clawd (the lightbulb, the laptop, the Z's, the confetti) as pixel layers
 * at the pack's own proportions, placed around the minimal body the way they sat around the pack's.
 */

export const CLAWD_ORANGE = "#d97757";
const EYE = "#2f2f38";
const WHITES = new Set(["#fff", "#ffffff"]);

export interface PackRect { x: number; y: number; fill: string }

/** Parse a pack SVG into its pixels' top-left corners and fills, with each rect's transform applied. */
export function parsePackSvg(svg: string): PackRect[] {
  const out: PackRect[] = [];
  for (const m of svg.matchAll(/<rect\b([^>]*)\/?>/g)) {
    const a: Record<string, string> = {};
    for (const kv of m[1]!.matchAll(/([\w-]+)="([^"]*)"/g)) a[kv[1]!] = kv[2]!;
    const x = Number(a.x ?? 0), y = Number(a.y ?? 0), w = Number(a.width ?? 0), h = Number(a.height ?? 0);
    const t = matrixOf(a.transform);
    const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([px, py]) => [t[0] * px! + t[2] * py! + t[4], t[1] * px! + t[3] * py! + t[5]]);
    out.push({ x: Math.min(...pts.map((p) => p[0]!)), y: Math.min(...pts.map((p) => p[1]!)), fill: normalise(a.fill ?? "") });
  }
  return out;
}

function normalise(fill: string): string {
  const f = fill.trim().toLowerCase();
  return /^#[0-9a-f]{3}$/.test(f) ? "#" + f.slice(1).split("").map((c) => c + c).join("") : f;
}

type Matrix = [number, number, number, number, number, number];
function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}
function matrixOf(transform: string | undefined): Matrix {
  let m: Matrix = [1, 0, 0, 1, 0, 0];
  for (const [, name, args] of (transform ?? "").matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const v = args!.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    let n: Matrix;
    if (name === "translate") n = [1, 0, 0, 1, v[0]!, v[1] ?? 0];
    else if (name === "scale") n = [v[0]!, 0, 0, v[1] ?? v[0]!, 0, 0];
    else if (name === "rotate") {
      const r = (v[0]! * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
      n = [c, s, -s, c, 0, 0];
      if (v.length === 3) n = multiply(multiply([1, 0, 0, 1, v[1]!, v[2]!], n), [1, 0, 0, 1, -v[1]!, -v[2]!]);
    } else if (name === "matrix") n = v as Matrix;
    else throw new Error(`unsupported transform ${name}`);
    m = multiply(m, n);
  }
  return m;
}

/** A pixel grid: column, row → colour. */
export interface PixelGrid { cols: number; rows: number; at: Map<string, string>; pitch: number }
const key = (c: number, r: number): string => `${c},${r}`;

/** Snap the pixels onto the grid that fits them best (the pack's pitch drifts between 42.4 and 43.2 per step). */
export function toGrid(rects: PackRect[]): PixelGrid {
  const x0 = Math.min(...rects.map((r) => r.x)), y0 = Math.min(...rects.map((r) => r.y));
  let best = { pitch: 42.84, err: Infinity };
  for (let p = 4200; p <= 4340; p++) {
    const pitch = p / 100;
    let err = 0;
    for (const r of rects) err = Math.max(err, Math.abs((r.x - x0) / pitch - Math.round((r.x - x0) / pitch)), Math.abs((r.y - y0) / pitch - Math.round((r.y - y0) / pitch)));
    if (err < best.err) best = { pitch, err };
  }
  const at = new Map<string, string>();
  let cols = 0, rows = 0;
  for (const r of rects) {
    const c = Math.round((r.x - x0) / best.pitch), w = Math.round((r.y - y0) / best.pitch);
    at.set(key(c, w), r.fill);
    cols = Math.max(cols, c + 1); rows = Math.max(rows, w + 1);
  }
  return { cols, rows, at, pitch: best.pitch };
}

/** Connected pixels (8-neighbours) among `cells`. */
function components(cells: Set<string>): string[][] {
  const seen = new Set<string>(), out: string[][] = [];
  for (const start of cells) {
    if (seen.has(start)) continue;
    const comp: string[] = [], stack = [start];
    seen.add(start);
    while (stack.length) {
      const k = stack.pop()!;
      comp.push(k);
      const [c, r] = k.split(",").map(Number) as [number, number];
      for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
        const n = key(c + dc, r + dr);
        if ((dc || dr) && cells.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
      }
    }
    out.push(comp);
  }
  return out;
}
function bounds(comp: string[]): { c0: number; c1: number; r0: number; r1: number } {
  const cs = comp.map((k) => Number(k.split(",")[0])), rs = comp.map((k) => Number(k.split(",")[1]));
  return { c0: Math.min(...cs), c1: Math.max(...cs), r0: Math.min(...rs), r1: Math.max(...rs) };
}

/** What the pack's Clawd is doing, read off its pixels. */
export interface PoseReading {
  body: { left: number; right: number; top: number; bottom: number };
  eyes: string[];                                   // the dark pixels inside the body
  mouth: string[];                                  // the white pixels inside the body
  arms: { l: string[] | null; r: string[] | null }; // the pixels of the hand nearest each side of the body
  legs: string[];
  minis: { c0: number; c1: number; r0: number; r1: number }[];
  rest: string[];                                   // everything else: props and effects
}

/**
 * Find the pack Clawd's body: of every rectangle 11–15 wide and 6–10 tall, the one most full of orange (its eyes and
 * mouth count as body), discounting empty pixels and sizes far from the pack's 14 × 9. Props that cross the body (a
 * bug on its edge, a leaf in front of a corner) only thin it, so it is still found.
 */
export function readPose(g: PixelGrid): PoseReading | null {
  const orange = new Set<string>();
  for (const [k, v] of g.at) if (v === CLAWD_ORANGE) orange.add(k);
  const W = g.cols + 1, P = new Int32Array(W * (g.rows + 1));
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const bodyish = orange.has(key(c, r)) || isFace(g, c, r, orange) ? 1 : 0;
    P[(r + 1) * W + c + 1] = bodyish + P[r * W + c + 1]! + P[(r + 1) * W + c]! - P[r * W + c]!;
  }
  const sum = (c0: number, r0: number, w: number, h: number): number => P[(r0 + h) * W + c0 + w]! - P[r0 * W + c0 + w]! - P[(r0 + h) * W + c0]! + P[r0 * W + c0]!;
  let best: { c: number; r: number; w: number; h: number; score: number } | null = null;
  for (let w = 11; w <= 15; w++) for (let h = 6; h <= 10; h++) for (let r = 0; r + h <= g.rows; r++) for (let c = 0; c + w <= g.cols; c++) {
    const n = sum(c, r, w, h), empty = w * h - n;
    if (n < w * h * 0.78) continue;
    const score = n - 1.5 * empty - 2 * (Math.abs(w - 14) + Math.abs(h - 9));
    if (!best || score > best.score) best = { c, r, w, h, score };
  }
  if (!best) return null;
  const left = best.c, right = best.c + best.w - 1, top = best.r, bottom = best.r + best.h - 1;
  const body = { left, right, top, bottom };
  const inBody = (c: number, r: number): boolean => c >= left && c <= right && r >= top && r <= bottom;
  const eyes: string[] = [], mouth: string[] = [];
  for (const [k, v] of g.at) {
    const [c, r] = k.split(",").map(Number) as [number, number];
    if (!inBody(c, r)) continue;
    if (v === EYE) eyes.push(k);
    else if (WHITES.has(v)) mouth.push(k);
  }
  // Legs: orange just under the body, within its width (and a column either side for a splay).
  const legs: string[] = [];
  for (let r = bottom + 1; r <= bottom + 3; r++) for (let c = left - 2; c <= right + 2; c++) if (orange.has(key(c, r))) legs.push(key(c, r));
  // The rest of the orange: arms beside the body or up in the air, small Clawds, and orange in props.
  const loose = new Set<string>();
  for (const k of orange) { const [c, r] = k.split(",").map(Number) as [number, number]; if (!inBody(c, r) && !legs.includes(k)) loose.add(k); }
  const minis: PoseReading["minis"] = [];
  const hands: { comp: string[]; side: "l" | "r"; dist: number }[] = [];
  const extra: string[] = [], dropped = new Set<string>();
  for (const comp of components(loose)) {
    const b = bounds(comp), w = b.c1 - b.c0 + 1, h = b.r1 - b.r0 + 1;
    // A small Clawd: a block at least 4 wide with eyes of its own.
    const hasEyes = [...g.at.entries()].some(([k, v]) => { if (v !== EYE) return false; const [c, r] = k.split(",").map(Number) as [number, number]; return c >= b.c0 && c <= b.c1 && r >= b.r0 && r <= b.r1; });
    if (w >= 4 && h >= 2 && hasEyes) { minis.push(b); continue; }
    const cx = (b.c0 + b.c1) / 2, cy = (b.r0 + b.r1) / 2;
    const side = cx < (left + right) / 2 ? "l" : "r";
    const dx = side === "l" ? Math.max(0, left - b.c1 - 1) : Math.max(0, b.c0 - right - 1), dy = cy < top ? top - cy : cy > bottom ? cy - bottom : 0;
    if (comp.length >= 3 && comp.length <= 12 && w <= 4 && h <= 4) { hands.push({ comp, side, dist: dx + dy }); continue; }
    // Orange close to the body that is not a hand is the pack's own Clawd too (a claw raised high, a motion copy of an
    // arm): the minimal Clawd has its own arms, so it is dropped. Orange further off is a prop drawn in that orange.
    if (dx + dy <= 6) { for (const k of comp) dropped.add(k); continue; }
    extra.push(...comp);
  }
  const arms: PoseReading["arms"] = { l: null, r: null };
  for (const side of ["l", "r"] as const) {
    const mine = hands.filter((h) => h.side === side).sort((a, b) => a.dist - b.dist);
    if (mine[0] && mine[0].dist <= 6) arms[side] = mine[0].comp;
    for (const other of mine.slice(arms[side] ? 1 : 0)) for (const k of other.comp) (other.dist <= 6 ? dropped.add(k) : extra.push(k));
  }
  const used = new Set([...eyes, ...mouth, ...legs, ...(arms.l ?? []), ...(arms.r ?? []), ...dropped]);
  for (const b of minis) for (let c = b.c0; c <= b.c1; c++) for (let r = b.r0; r <= b.r1; r++) used.add(key(c, r));
  const rest: string[] = [];
  for (const [k, v] of g.at) {
    const [c, r] = k.split(",").map(Number) as [number, number];
    if (used.has(k) || (v === CLAWD_ORANGE && !extra.includes(k)) || inBody(c, r) && (v === EYE || WHITES.has(v))) continue;
    if (inBody(c, r) && v === CLAWD_ORANGE) continue;
    rest.push(k);
  }
  return { body, eyes, mouth, arms, legs, minis, rest };
}
/** A face pixel sits inside the orange body: scanning past the face on both sides along its row reaches orange. */
function isFace(g: PixelGrid, c: number, r: number, orange: Set<string>): boolean {
  const face = (cc: number): boolean => { const v = g.at.get(key(cc, r)); return v === EYE || (v !== undefined && WHITES.has(v)); };
  if (!face(c)) return false;
  let a = c - 1, b = c + 1;
  while (a >= 0 && face(a)) a--;
  while (b < g.cols && face(b)) b++;
  return orange.has(key(a, r)) && orange.has(key(b, r)) && b - a <= 6;
}

/* ------------------------------------------------------------------ re-casting onto the minimal Clawd */

/** A pose for the minimal Clawd, in its units around the feet (x right, y up negative), as 82-clawd-pack.js holds it. */
export interface ClawdPose {
  id: string;
  name: string;
  tags: string[];
  expr: string;
  gaze: [number, number];
  /** Arm offsets from where each arm hangs, in units; omitted when the pack's arm is where an arm rests. */
  arms: { l?: [number, number]; r?: [number, number] };
  legs: "straight" | "splay" | "tucked";
  /** Small Clawds: centre x, feet y, width (units). */
  minis: [number, number, number][];
  layers: PoseLayer[];
}
export interface PoseLayer {
  /** Centre, in units around the feet. */
  x: number;
  y: number;
  /** Pixel rows, one character per pixel ("." is empty), indexes into `pal`. */
  rows: string[];
  pal: string[];
  kind: "spark" | "prop";
  motion: "twinkle" | "bob" | "spin" | "rise" | "flash" | "pulse" | "still";
  /** Drawn behind Clawd (its body hides what overlaps) or in front. */
  z: "back" | "front";
}

/** One pack pixel, in the minimal Clawd's units: the pack's 14-wide body is the minimal body's 8. */
export const PACK_PIXEL = 8 / 14;

/** Map a pack position to units around the minimal Clawd's feet, edge by edge, so a hat sits on the head and a laptop at the side. */
function place(b: PoseReading["body"], cx: number, cy: number): [number, number] {
  const w = b.right - b.left + 1, h = b.bottom - b.top + 1, k = PACK_PIXEL;
  const x = cx < b.left ? -4 - (b.left - cx) * k : cx > b.right + 1 ? 4 + (cx - (b.right + 1)) * k : -4 + ((cx - b.left) * 8) / w;
  const y = cy < b.top ? -8 - (b.top - cy) * k : cy > b.bottom + 1 ? -2 + (cy - (b.bottom + 1)) * k : -8 + ((cy - b.top) * 6) / h;
  return [round(x), round(y)];
}
const round = (v: number): number => Math.round(v * 100) / 100;

/** The eyes' shape → the minimal Clawd's expression; their offset from the body's middle → where it looks. */
export function readEyes(eyes: string[], mouth: string[], body: PoseReading["body"], name: string): { expr: string; gaze: [number, number] } {
  const cells = eyes.map((k) => k.split(",").map(Number) as [number, number]);
  if (!cells.length) return { expr: /sleep|zen|om\b/.test(name) ? "content" : "open", gaze: [0, 0] };
  const mid = (body.left + body.right) / 2;
  const sides = [cells.filter(([c]) => c < mid), cells.filter(([c]) => c >= mid)];
  const shape = (cs: [number, number][]): string => {
    if (!cs.length) return "none";
    const c0 = Math.min(...cs.map((p) => p[0])), r0 = Math.min(...cs.map((p) => p[1]));
    const w = Math.max(...cs.map((p) => p[0])) - c0 + 1, h = Math.max(...cs.map((p) => p[1])) - r0 + 1;
    const has = (dc: number, dr: number): boolean => cs.some(([c, r]) => c === c0 + dc && r === r0 + dr);
    if (cs.length === 1) return "dot";
    if (h === 1) return "bar";
    if (w === 3 && h === 3 && cs.length === 5 && has(1, 1) && has(0, 0) && has(2, 2)) return "x";
    if (w === 3 && h === 2 && has(0, 0) && has(2, 0) && has(1, 1)) return "v";
    if (w === 3 && h === 2 && has(1, 0) && has(0, 1) && has(2, 1)) return "caret";
    if (w === 2 && h === 2 && cs.length === 2) return "slant";
    return "dot";
  };
  const a = shape(sides[0]!), b = shape(sides[1]!);
  const pick = a === "none" ? b : a;
  // The mouth, which the minimal Clawd has not got, still says which way a mood goes: ∩ is a frown.
  const ms = mouth.map((k) => k.split(",").map(Number) as [number, number]);
  const mTop = ms.length ? Math.min(...ms.map((p) => p[1])) : 0;
  const topRow = ms.filter((p) => p[1] === mTop).length, lowRow = ms.filter((p) => p[1] === mTop + 1).length;
  const frown = ms.length >= 3 && topRow < lowRow && topRow > 0;
  const sad = /sad|cry|broken|fail|error|critical|disconnected/.test(name) || frown;
  const expr = pick === "x" ? "x" : pick === "bar" ? "happy" : pick === "caret" ? "happy" : pick === "v" ? (sad ? "sad" : /sleep|zen/.test(name) ? "content" : "content")
    : pick === "slant" ? (/angry|lightning/.test(name) ? "angry" : "squint") : /angry/.test(name) ? "angry" : sad && frown ? "sad" : "open";
  // Gaze: how far the pair sits off the body's middle (a turned Clawd looks the way its eyes went).
  const ex = (Math.min(...cells.map((p) => p[0])) + Math.max(...cells.map((p) => p[0]))) / 2;
  const ey = (Math.min(...cells.map((p) => p[1])) + Math.max(...cells.map((p) => p[1]))) / 2;
  const gx = Math.max(-0.5, Math.min(0.5, (ex - mid) * 0.22)), gy = Math.max(-0.4, Math.min(0.4, (ey - (body.top + 3.6)) * 0.2));
  return { expr, gaze: [round(Math.abs(gx) < 0.12 ? 0 : gx), round(Math.abs(gy) < 0.15 ? 0 : gy)] };
}

/** How a layer moves, from what it is and the pose's own words. */
function motionOf(kind: PoseLayer["kind"], words: string, above: boolean): PoseLayer["motion"] {
  if (kind === "spark") return "twinkle";
  if (/loop|sync|refresh|spiral|confusion/.test(words)) return "spin";
  if (/sleep|steam|pie|coffee|love/.test(words) && above) return "rise";
  if (/error|alert|critical|lightning|malware|bug/.test(words)) return "flash";
  if (/idea|lightbulb|aura|glow|success|checkmark|achievement|trophy|medal|heart/.test(words)) return "pulse";
  return above ? "bob" : "still";
}

/** The names the pack's unnamed artboards get, from what each shows. */
export const ARTBOARD_NAMES: Record<string, string> = {
  "artboard-24cla": "zen-om", "artboard-24cla2": "shy-hiding", "artboard-24cla3": "shield-protect", "artboard-25cla": "with-minis",
  "artboard-25cla2": "message-error", "artboard-25cla3": "cleaning-up", "artboard-2cla": "planning-list", "artboard-2cla2": "no-entry",
  "artboard-2cla3": "wizard", "artboard-3cla": "hello-languages", "artboard-3cla2": "excited", "artboard-3cla3": "sparkle-magic",
  "artboard-4cla": "medal", "artboard-4cla2": "bugs-attack", "artboard-4cla3": "hourglass-stress",
};
const DROP = new Set(["pixel", "with", "in", "the", "a", "of"]);

/** Re-cast one pack pose (its SVG text and file stem) onto the minimal Clawd. Null when no Clawd body can be found in it. */
export function convertPose(svg: string, stem: string): ClawdPose | null {
  const g = toGrid(parsePackSvg(svg));
  const reading = readPose(g);
  if (!reading) return null;
  const id = ARTBOARD_NAMES[stem] ?? stem.replace(/-pixel$/, "");
  const words = id.replace(/-/g, " ");
  const { body } = reading;
  const { expr, gaze } = readEyes(reading.eyes, reading.mouth, body, words);
  // Arms: a hand in the pack's resting place (low on the side, touching the body) stays where the minimal arm hangs.
  const arms: ClawdPose["arms"] = {};
  for (const side of ["l", "r"] as const) {
    const comp = reading.arms[side];
    if (!comp) continue;
    const b = bounds(comp), cx = (b.c0 + b.c1 + 1) / 2, cy = (b.r0 + b.r1 + 1) / 2;
    const resting = b.r0 >= body.top + 5 && b.r1 <= body.bottom + 1 && (side === "l" ? b.c1 >= body.left - 1 : b.c0 <= body.right + 1);
    if (resting) continue;
    const [x, y] = place(body, cx, cy), home: [number, number] = side === "l" ? [-4.5, -5] : [4.5, -5];
    arms[side] = [round(Math.max(-2.5, Math.min(2.5, x - home[0]))), round(Math.max(-5.5, Math.min(3, y - home[1])))];
  }
  // Legs: splayed when the lower row of leg pixels spreads wider than the upper.
  const legCells = reading.legs.map((k) => k.split(",").map(Number) as [number, number]);
  const rowsOf = [...new Set(legCells.map((p) => p[1]))].sort((a, b) => a - b);
  const span = (r: number): number => { const cs = legCells.filter((p) => p[1] === r).map((p) => p[0]); return cs.length ? Math.max(...cs) - Math.min(...cs) : 0; };
  const legs: ClawdPose["legs"] = !legCells.length ? "tucked" : rowsOf.length >= 2 && span(rowsOf[1]!) > span(rowsOf[0]!) + 1 ? "splay" : "straight";
  const minis = reading.minis.map((b): [number, number, number] => {
    const [x] = place(body, (b.c0 + b.c1 + 1) / 2, 0), [, y] = place(body, 0, b.r1 + 1);
    return [x, y, round((b.c1 - b.c0 + 1) * PACK_PIXEL * 1.15)];
  });
  // Layers: every connected group of the rest, as its own bitmap with its own palette.
  const layers: PoseLayer[] = [];
  for (const comp of components(new Set(reading.rest))) {
    const b = bounds(comp), w = b.c1 - b.c0 + 1, h = b.r1 - b.r0 + 1;
    const pal: string[] = [], rows: string[] = [];
    for (let r = b.r0; r <= b.r1; r++) {
      let row = "";
      for (let c = b.c0; c <= b.c1; c++) {
        const v = comp.includes(key(c, r)) ? g.at.get(key(c, r))! : null;
        if (!v) { row += "."; continue; }
        let i = pal.indexOf(v);
        if (i < 0) { pal.push(v); i = pal.length - 1; }
        row += String.fromCharCode(97 + i);
      }
      rows.push(row);
    }
    const kind: PoseLayer["kind"] = comp.length <= 6 && w <= 3 && h <= 3 ? "spark" : "prop";
    const [x, y] = place(body, b.c0 + w / 2, b.r0 + h / 2);
    const above = b.r1 < body.top;
    // In front when it overlaps the body (a laptop, a shield, a blanket); behind when it only touches an edge.
    const overlap = b.c1 >= body.left + 2 && b.c0 <= body.right - 2 && b.r1 >= body.top + 2 && b.r0 <= body.bottom;
    layers.push({ x, y, rows, pal, kind, motion: motionOf(kind, words, above), z: overlap || kind === "spark" ? "front" : "back" });
  }
  const tags = [...new Set(id.split("-").filter((w) => !DROP.has(w) && !/^\d/.test(w)))];
  return { id, name: words, tags, expr, gaze, arms, legs, minis, layers };
}

/** Convert every pose in a folder of pack SVGs, in name order, and say which could not be read. */
export function convertPack(dir: string): { poses: ClawdPose[]; skipped: string[] } {
  const poses: ClawdPose[] = [], skipped: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".svg")).sort()) {
    const pose = convertPose(readFileSync(path.join(dir, file), "utf8"), path.basename(file, ".svg"));
    if (pose) poses.push(pose); else skipped.push(file);
  }
  poses.sort((a, b) => a.id.localeCompare(b.id));
  return { poses, skipped };
}

/** The kit file the poses ship in: `RC.clawd.POSES`, read by RC.clawd.pose. */
export function packModule(poses: ClawdPose[], source: string): string {
  const body = poses.map((p) => `    ${JSON.stringify(p.id)}: ${JSON.stringify(p)}`).join(",\n");
  return `/*
 * The mascot pack's poses, re-cast onto Anthropic's minimal Clawd: ${poses.length} of them. Generated by
 * \`npm run clawd -- import ${source}\` from src/clawd/pack.ts; do not edit by hand (re-run the import instead).
 * Each pose: Clawd's eyes, gaze, arms and legs, its small Clawds, and the pack's props and effects as pixel layers in
 * Clawd's units around its feet. RC.clawd.pose(tl, c, at, id) plays one.
 */
(function () {
  var RC = window.RC;
  if (!RC || !RC.clawd || RC.clawd.POSES) return;
  RC.clawd.POSES = {
${body}
  };
})();
`;
}
