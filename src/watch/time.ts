/**
 * Times and the small text pictures the watch tool prints: `1:23.5`, sparklines, motion words.
 */

export class WatchError extends Error {
  constructor(message: string, readonly code = 1) { super(message); }
}

/** `83.5`, `83.5s`, `1:23.5`, `1:02:03`, `end`, or `-5` (five seconds before the end). */
export function parseTime(s: string | number | undefined, duration?: number): number | undefined {
  if (s === undefined) return undefined;
  if (typeof s === "number") return s;
  const t = s.trim().toLowerCase().replace(/s$/, "");
  if (t === "end") {
    if (duration === undefined) throw new WatchError("`end` needs a known duration");
    return duration;
  }
  if (t.startsWith("-") && duration !== undefined) return Math.max(0, duration - parseTime(t.slice(1))!);
  const nums = t.split(":").map(Number);
  if (nums.some((n) => !Number.isFinite(n))) throw new WatchError(`cannot read time \`${s}\`: use 83.5, 1:23.5 or 1:02:03`);
  return nums.reduce((a, n) => a * 60 + n, 0);
}

export function fmt(t: number, long = false, prec = 1): string {
  const r = Math.max(0, Math.round(t * 10 ** prec) / 10 ** prec);
  const h = Math.floor(r / 3600), m = Math.floor((r % 3600) / 60), sec = r % 60;
  const s = sec.toFixed(prec).padStart(3 + prec, "0");
  return long || h >= 1 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export const span = (a: number, b: number, long = false): string => `${fmt(a, long)}–${fmt(b, long)}`;

/** Lowercase, accents gone, punctuation to spaces: "Größe!" and "grosse" are close enough to search. */
export function norm(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[^\p{L}\p{N}$%€£.]+/gu, " ").trim();
}

const SPARK = "▁▂▃▄▅▆▇█";

export function sparkline(values: readonly number[], lo: number, hi: number): string {
  return values.map((v0) => {
    const v = Number.isFinite(v0) ? v0 : lo;
    const x = hi <= lo ? 0 : (v - lo) / (hi - lo);
    return SPARK[Math.min(SPARK.length - 1, Math.max(0, Math.floor(x * SPARK.length)))];
  }).join("");
}

/** At most `n` values, each the largest of the ones it stands for, so a spike is never averaged away. */
export function resample(values: readonly number[], n: number): number[] {
  if (values.length <= n) return [...values];
  return Array.from({ length: n }, (_, i) => {
    const a = Math.floor((i * values.length) / n), b = Math.floor(((i + 1) * values.length) / n);
    return Math.max(...values.slice(a, Math.max(b, a + 1)));
  });
}

export type MotionLevel = "still" | "low" | "medium" | "high";
export const motionLevel = (v: number): MotionLevel => (v < 0.004 ? "still" : v < 0.02 ? "low" : v < 0.06 ? "medium" : "high");

/** On a log scale, so a slow pan and a whip pan both read. */
export const motionSpark = (values: readonly number[], n = 8): string =>
  sparkline(resample(values, n).map((v) => Math.log10(Math.max(v, 1e-4))), -3, -0.7);

export const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export function median(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
