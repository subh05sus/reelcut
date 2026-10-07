import { PAIRINGS } from "../fonts/catalog.js";
import { contrast, fromOklch, hueGap, reachContrast, toOklch } from "./color.js";
import type { Personality } from "./schema.js";
import { STYLE_TENSIONS, styleById, type Palette, type StyleSpec } from "./styles.js";

/**
 * Does a personality hold together? Every finding says why in plain words; most carry a one-click fix.
 *   error   blocks saving: text that cannot be read, a banned colour in use
 *   warn    allowed, but it fights the style: neon on clay, a second accent in Minimal, a hand font on Swiss
 *   info    worth knowing
 */
export interface Fix { label: string; patch: { palette?: { style: string; value: Palette }; font?: { style: string; value: string }; styles?: string[] } }
export interface Finding { level: "error" | "warn" | "info"; step: string; style?: string; code: string; message: string; fix?: Fix }

const NEON = (hex: string) => { const o = toOklch(hex); return o.c > 0.17 && o.l > 0.78; };
/** Accent chroma bands, in OKLCH chroma. */
const BAND = { muted: [0, 0.1], soft: [0, 0.17], vivid: [0.11, 1], any: [0, 1] } as const;

/** Keep the hue, move chroma into the style's band, then lightness until it reads on the ground. */
function retune(hex: string, ground: string, c: number, ratio: number): string {
  const o = toOklch(hex);
  return reachContrast(fromOklch({ ...o, c }), ground, ratio);
}

export function checkPalette(style: StyleSpec, p: Palette, minText = 4.5): Finding[] {
  const out: Finding[] = [];
  const at = { step: "colours", style: style.id };
  const ink = contrast(p.ink, p.ground), acc = contrast(p.accent, p.ground);
  if (ink < minText) {
    out.push({ ...at, level: "error", code: "contrast-ink", message: `Text on this ground is ${ink.toFixed(1)}:1; it needs ${minText}:1 to be read.`,
      fix: { label: "Darken or lighten the text until it reads", patch: { palette: { style: style.id, value: { ...p, ink: reachContrast(p.ink, p.ground, minText + 0.2) } } } } });
  }
  if (acc < 3) {
    out.push({ ...at, level: "error", code: "contrast-accent", message: `The accent is ${acc.toFixed(1)}:1 on the ground; key words in it need 3:1.`,
      fix: { label: "Keep the hue, make it readable", patch: { palette: { style: style.id, value: { ...p, accent: reachContrast(p.accent, p.ground, 3.3) } } } } });
  }
  const g = toOklch(p.ground), a = toOklch(p.accent);
  const groundIs = g.l > 0.62 ? "light" : g.l < 0.4 ? "dark" : "mid";
  if (style.ground === "light" && groundIs === "dark") out.push({ ...at, level: "warn", code: "ground", message: `${style.name} wants a light ground: ${style.why.ground ?? ""}`.trim(), fix: nearest(style, p, "Use a light scheme in your hue") });
  if (style.ground === "dark" && groundIs === "light") out.push({ ...at, level: "warn", code: "ground", message: `${style.name} wants a dark ground: ${style.why.ground ?? ""}`.trim(), fix: nearest(style, p, "Use a dark scheme in your hue") });
  const [lo, hi] = BAND[style.chroma];
  if (!style.neon && (NEON(p.accent) || NEON(p.accent2))) {
    out.push({ ...at, level: "warn", code: "neon", message: `Neon in ${style.name}: ${style.why.neon ?? "it does not suit the style"}.`,
      fix: { label: "Calm the glow, keep the hue", patch: { palette: { style: style.id, value: { ...p, accent: retune(p.accent, p.ground, Math.min(a.c, 0.14), 3.3), accent2: NEON(p.accent2) ? retune(p.accent2, p.ground, 0.12, 3) : p.accent2 } } } } });
  } else if (a.c > hi + 0.02) {
    out.push({ ...at, level: "warn", code: "chroma-high", message: `This accent is stronger than ${style.name} likes: ${style.why.chroma ?? "it overpowers the style"}.`,
      fix: { label: "Soften it, keep the hue", patch: { palette: { style: style.id, value: { ...p, accent: retune(p.accent, p.ground, hi - 0.03, 3.3) } } } } });
  } else if (a.c < lo - 0.02) {
    out.push({ ...at, level: "warn", code: "chroma-low", message: `This accent is greyer than ${style.name} likes: ${style.why.chroma ?? "it looks dull in this style"}.`,
      fix: { label: "Strengthen it, keep the hue", patch: { palette: { style: style.id, value: { ...p, accent: retune(p.accent, p.ground, lo + 0.06, 3.3) } } } } });
  }
  // Hues: the accent, a coloured second accent far from it, a coloured ground.
  const a2 = toOklch(p.accent2);
  let hues = a.c > 0.05 ? 1 : 0;
  if (a2.c > 0.06 && (a.c <= 0.05 || hueGap(a.h, a2.h) > 35)) hues++;
  if (g.c > 0.08 && hueGap(g.h, a.h) > 35) hues++;
  if (hues > style.hues) {
    out.push({ ...at, level: "warn", code: "hues", message: `${hues} colours in ${style.name}: ${style.why.hues ?? `it carries ${style.hues} well`}.`,
      fix: { label: "Make the second colour a neutral", patch: { palette: { style: style.id, value: { ...p, accent2: fromOklch({ l: toOklch(p.ink).l * 0.55 + g.l * 0.45, c: 0.012, h: a.h }) } } } } });
  }
  return out;
}

/** The curated scheme of this style whose accent hue is nearest, with the owner's accent carried over. */
function nearest(style: StyleSpec, p: Palette, label: string): Fix | undefined {
  const h = toOklch(p.accent).h;
  const best = [...style.palettes].sort((x, y) => hueGap(toOklch(x.accent).h, h) - hueGap(toOklch(y.accent).h, h))[0];
  if (!best) return undefined;
  const accent = reachContrast(fromOklch({ ...toOklch(best.accent), h }), best.ground, 3.3);
  return { label, patch: { palette: { style: style.id, value: { ...best, id: `${best.id}+hue`, name: `${best.name}, your hue`, accent } } } };
}

export function checkFont(style: StyleSpec, pairingId: string): Finding[] {
  const pairing = PAIRINGS.find((p) => p.id === pairingId);
  if (!pairing) return [{ level: "error", step: "fonts", style: style.id, code: "font-unknown", message: `No type pairing called "${pairingId}".` }];
  if (style.fonts.avoid.includes(pairingId)) {
    const better = style.fonts.best[0]!;
    return [{ level: "warn", step: "fonts", style: style.id, code: "font-fights", message: `${pairing.name} with ${style.name}: ${style.fonts.why}.`,
      fix: { label: `Use ${PAIRINGS.find((p) => p.id === better)?.name ?? better}`, patch: { font: { style: style.id, value: better } } } }];
  }
  return [];
}

/** Everything about a personality, ordered as the wizard's steps are. */
export function checkPersonality(p: Personality): Finding[] {
  const out: Finding[] = [];
  const chosen = p.styles.map((s) => styleById(s.id)).filter((s): s is StyleSpec => !!s);
  if (!chosen.length) out.push({ level: "info", step: "styles", code: "no-style", message: "Choose at least one style." });
  for (const t of STYLE_TENSIONS) {
    if (chosen.some((s) => s.id === t.a) && chosen.some((s) => s.id === t.b)) {
      out.push({ level: "warn", step: "styles", code: "tension", message: t.why, fix: { label: `Drop ${styleById(t.b)!.name}`, patch: { styles: p.styles.map((s) => s.id).filter((id) => id !== t.b) } } });
    }
  }
  const total = p.styles.reduce((a, s) => a + s.weight, 0);
  if (chosen.length > 1 && Math.abs(total - 100) > 1) out.push({ level: "info", step: "mixer", code: "weights", message: `The shares add up to ${total}%, not 100%; they are read as proportions.` });
  for (const s of chosen) {
    const pal = p.palettes[s.id];
    if (pal) out.push(...checkPalette(s, pal, p.guardrails.contrast));
    else out.push({ level: "info", step: "colours", style: s.id, code: "no-palette", message: `${s.name} uses its first curated scheme until you choose one.` });
    const font = p.fonts[s.id];
    if (font) out.push(...checkFont(s, font));
  }
  // Guardrails: a banned colour in use, more fonts than allowed.
  for (const s of chosen) {
    const pal = p.palettes[s.id]; if (!pal) continue;
    for (const banned of p.guardrails.bannedColors) {
      for (const k of ["ground", "ink", "accent", "accent2"] as const) {
        const a = toOklch(pal[k]), b = toOklch(banned);
        if (Math.abs(a.l - b.l) < 0.06 && Math.abs(a.c - b.c) < 0.05 && (a.c < 0.03 || hueGap(a.h, b.h) < 12)) {
          out.push({ level: "error", step: "guardrails", style: s.id, code: "banned-colour", message: `${s.name}'s ${k} (${pal[k]}) is a colour you banned (${banned}).` });
        }
      }
    }
  }
  const families = new Set<string>();
  for (const s of chosen) { const pr = PAIRINGS.find((x) => x.id === (p.fonts[s.id] ?? s.fonts.best[0])); if (pr) [pr.head, pr.body, pr.accent].forEach((f) => families.add(f)); }
  if (families.size > p.guardrails.maxFonts + 1) out.push({ level: "warn", step: "guardrails", code: "too-many-fonts", message: `${families.size} type families across your styles; your limit is ${p.guardrails.maxFonts} (plus mono). Use the same pairing for two styles to bring it down.` });
  for (const s of chosen) {
    const id = p.fonts[s.id];
    const pr = id ? PAIRINGS.find((x) => x.id === id) : undefined;
    if (pr && p.guardrails.bannedFonts.some((f) => [pr.head, pr.body, pr.accent].includes(f))) out.push({ level: "error", step: "guardrails", style: s.id, code: "banned-font", message: `${s.name} uses ${pr.name}, which sets a family you banned.` });
  }
  return out;
}
