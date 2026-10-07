import type { PersonalPattern } from "../patterns/mine.js";
import type { Reference } from "../references/schema.js";
import { checkPalette, checkFont } from "./check.js";
import { contrast, fromOklch, hueGap, reachContrast, toOklch } from "./color.js";
import { BEAT_KINDS } from "./schema.js";
import { STYLES, STYLE_TENSIONS, styleById, type BeatKind, type Palette, type StyleId, type StyleSpec } from "./styles.js";

/** Seeded PRNG (mulberry32), so a roll can be repeated. */
function rand(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export interface Roll {
  styles: { id: StyleId; weight: number }[];
  beatStyles: Partial<Record<BeatKind, StyleId>>;
  palettes: Partial<Record<StyleId, Palette>>;
  fonts: Partial<Record<StyleId, string>>;
}
export interface Locks { styles?: StyleId[]; palettes?: Partial<Record<StyleId, Palette>>; fonts?: Partial<Record<StyleId, string>>; count?: number }

/** Share the reel between styles: the first leads. 1 → 100; 2 → 65/35; 3 → 55/30/15. */
export function defaultWeights(n: number): number[] {
  return n <= 1 ? [100] : n === 2 ? [65, 35] : [55, 30, 15];
}

/** Each beat kind goes to the chosen style that lists it earliest in what it suits. */
export function assignBeats(ids: readonly StyleId[]): Partial<Record<BeatKind, StyleId>> {
  const out: Partial<Record<BeatKind, StyleId>> = {};
  for (const kind of BEAT_KINDS) {
    let best: StyleId | undefined, rank = 99;
    ids.forEach((id, order) => {
      const s = styleById(id)!; const r = s.beats.indexOf(kind);
      const score = (r < 0 ? 10 : r) + order * 0.5;
      if (score < rank) { rank = score; best = id; }
    });
    if (best) out[kind] = best;
  }
  return out;
}

/** Surprise me: a combination that passes every check; locked parts stay as they are. */
export function surprise(seed: number, locks: Locks = {}): Roll {
  const r = rand(seed);
  const count = locks.count ?? 1 + Math.floor(r() * 3);
  const ids: StyleId[] = [...(locks.styles ?? [])].slice(0, 3);
  for (let guard = 0; ids.length < count && guard < 200; guard++) {
    const cand = STYLES[Math.floor(r() * STYLES.length)]!.id;
    if (ids.includes(cand)) continue;
    if (STYLE_TENSIONS.some((t) => (t.a === cand && ids.includes(t.b)) || (t.b === cand && ids.includes(t.a)))) continue;
    ids.push(cand);
  }
  const weights = defaultWeights(ids.length);
  const palettes: Partial<Record<StyleId, Palette>> = {}, fonts: Partial<Record<StyleId, string>> = {};
  for (const id of ids) {
    const s = styleById(id)!;
    palettes[id] = locks.palettes?.[id] ?? s.palettes[Math.floor(r() * s.palettes.length)]!;
    fonts[id] = locks.fonts?.[id] ?? s.fonts.best[Math.floor(r() * Math.min(3, s.fonts.best.length))]!;
  }
  return { styles: ids.map((id, i) => ({ id, weight: weights[i]! })), beatStyles: assignBeats(ids), palettes, fonts };
}

/**
 * Adapt brand colours to a style: the brand's strongest colour becomes the accent (its hue kept, its strength moved
 * into the style's band), on the style's own ground and ink from the curated scheme nearest in hue.
 */
export function brandPalette(style: StyleSpec, brand: readonly string[]): Palette | undefined {
  // In the order given: the first is the brand's primary (Brand import puts the theme colour first).
  const cols = brand.map((h) => ({ h, o: toOklch(h) })).filter((c) => c.o.c > 0.04);
  const main = cols[0]; if (!main) return undefined;
  const base = [...style.palettes].sort((a, b) => hueGap(toOklch(a.accent).h, main.o.h) - hueGap(toOklch(b.accent).h, main.o.h))[0]!;
  const band = style.chroma === "muted" ? 0.08 : style.chroma === "soft" ? 0.13 : Math.max(0.15, main.o.c);
  const c = Math.min(main.o.c, band) || band;
  const accent = reachContrast(fromOklch({ ...main.o, c: style.neon ? main.o.c : Math.min(c, 0.17) }), base.ground, 3.3);
  const second = cols[1];
  const accent2 = second ? reachContrast(fromOklch({ ...second.o, c: Math.min(second.o.c, band) }), base.ground, 3) : base.accent2;
  const p: Palette = { id: "brand", name: "Your brand", ground: base.ground, ink: base.ink, accent, accent2 };
  return contrast(p.ink, p.ground) >= 4.5 ? p : { ...p, ink: reachContrast(p.ink, p.ground, 4.7) };
}

/** How many problems a roll has: zero means it passes. Used by the tests and by Surprise me's re-roll. */
export function rollProblems(roll: Roll): number {
  let n = 0;
  for (const s of roll.styles) {
    const spec = styleById(s.id)!;
    const pal = roll.palettes[s.id]; if (pal) n += checkPalette(spec, pal).length;
    const f = roll.fonts[s.id]; if (f) n += checkFont(spec, f).length;
  }
  return n;
}

const LOOK_STYLES: Record<string, StyleId[]> = {
  paper: ["editorial", "minimal", "hand-drawn", "paper-cutout"], ink: ["linear", "3d", "glitch"], flood: ["kinetic-type", "flat-vector"],
  sky: ["liquid", "3d"], cinema: ["cinematic", "retro-vhs"], poster: ["collage", "brutalist", "kinetic-type"], cool: ["ui-product", "isometric", "swiss"],
};

export interface TasteSuggestion { id: StyleId; score: number; because: string[] }

/** Learn from my taste: rank the styles by the films kept as references and the beats rated "Works". */
export function fromTaste(refs: readonly Reference[], patterns: readonly PersonalPattern[]): TasteSuggestion[] {
  const score = new Map<StyleId, { s: number; why: Set<string> }>();
  const add = (id: StyleId, v: number, why: string) => { const e = score.get(id) ?? { s: 0, why: new Set<string>() }; e.s += v; e.why.add(why); score.set(id, e); };
  for (const r of refs) {
    if (r.include === false) continue;
    const a = r.analysis, moves = r.annotation?.reviewed ? r.annotation.moves : [];
    for (const s of STYLES) {
      const hit = moves.filter((m: string) => s.moves.prefer.includes(m)).length - moves.filter((m: string) => s.moves.avoid.includes(m)).length;
      if (hit > 0) add(s.id, hit * 1.5, `the moves in "${r.name}"`);
      if (a) {
        if (a.ground === "dark" && s.ground === "dark") add(s.id, 1, `"${r.name}" sits on a dark ground`);
        if (a.ground === "light" && s.ground === "light") add(s.id, 1, `"${r.name}" sits on a light ground`);
        if (a.pacing === "fast" && s.motion.energy === "energetic") add(s.id, 1, `"${r.name}" cuts fast`);
        if (a.pacing === "slow" && s.motion.energy === "restrained") add(s.id, 1, `"${r.name}" takes its time`);
      }
    }
  }
  for (const p of patterns) {
    const net = p.likes - p.dislikes + (p.kept ? 1 : 0);
    if (net <= 0 || !p.look) continue;
    for (const id of LOOK_STYLES[p.look] ?? []) add(id, net, `you kept "${p.name}" (${p.look})`);
  }
  return [...score.entries()].map(([id, e]) => ({ id, score: Math.round(e.s * 10) / 10, because: [...e.why].slice(0, 3) }))
    .sort((a, b) => b.score - a.score).slice(0, 6);
}
