/**
 * Colour arithmetic for the personality checks: WCAG contrast, and OKLCH (perceptual lightness, chroma, hue), so a fix
 * can keep the owner's hue while it changes how strong or how light the colour is.
 */

export type RGB = [number, number, number];
export interface OKLCH { l: number; c: number; h: number }

export function parseHex(hex: string): RGB | undefined {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const s = m[1]!.length === 3 ? m[1]!.replace(/./g, (c) => c + c) : m[1]!;
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
export function toHex([r, g, b]: RGB): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
export const isHex = (s: string): boolean => parseHex(s) !== undefined;

const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const unlin = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** WCAG 2 relative luminance. */
export function luminance(hex: string): number {
  const rgb = parseHex(hex); if (!rgb) return 0;
  const [r, g, b] = rgb.map(lin) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG 2 contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function toOklch(hex: string): OKLCH {
  const rgb = parseHex(hex) ?? [0, 0, 0];
  const [r, g, b] = rgb.map(lin) as RGB;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.sqrt(A * A + B * B);
  const h = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}
function oklchToLinear({ l, c, h }: OKLCH): RGB {
  const A = c * Math.cos((h * Math.PI) / 180), B = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}
/** OKLCH to hex, reducing chroma until the colour fits in sRGB (so the hue and lightness hold). */
export function fromOklch(o: OKLCH): string {
  let c = o.c;
  for (let i = 0; i < 40; i++) {
    const rgb = oklchToLinear({ ...o, c });
    if (rgb.every((v) => v >= -0.0005 && v <= 1.0005)) return toHex(rgb.map((v) => unlin(Math.max(0, Math.min(1, v)))) as RGB);
    c *= 0.92;
  }
  return toHex(oklchToLinear({ ...o, c: 0 }).map((v) => unlin(Math.max(0, Math.min(1, v)))) as RGB);
}

/** Move a colour's lightness (keeping hue and chroma) until it reaches `ratio` against `bg`; the nearest solution. */
export function reachContrast(hex: string, bg: string, ratio: number): string {
  if (contrast(hex, bg) >= ratio) return hex;
  const o = toOklch(hex), bgDark = luminance(bg) < 0.18;
  let lo = bgDark ? o.l : 0, hi = bgDark ? 1 : o.l;
  // Darken against a light ground, lighten against a dark one, by bisection on lightness.
  let best = bgDark ? fromOklch({ ...o, l: 1 }) : fromOklch({ ...o, l: 0 });
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2, cand = fromOklch({ ...o, l: mid });
    if (contrast(cand, bg) >= ratio) { best = cand; if (bgDark) hi = mid; else lo = mid; }
    else if (bgDark) lo = mid; else hi = mid;
  }
  return best;
}

/** Shortest angle between two hues, in degrees. */
export function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
