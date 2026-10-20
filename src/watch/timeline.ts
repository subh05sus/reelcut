import { existsSync, readFileSync } from "node:fs";
import { BIN, type Audio, type Segment, type Transcript, type Visual, type WatchVideo } from "./video.js";

/**
 * Readings over a range of a video: what is said, where it is speech or music or quiet, where it is fast or still,
 * and the segments the overview's timeline is made of (the reel's own beats, when it is one of ours).
 */

export type Span = [number, number];

export const speechIn = (tr: Transcript | undefined, a: number, b: number): Segment[] => (tr?.segments ?? []).filter((s) => s.b > a && s.a < b);

/** The words whose middle falls in [a, b), so a word on a boundary belongs to one segment only. */
export function wordsIn(tr: Transcript | undefined, a: number, b: number): string {
  return speechIn(tr, a, b).flatMap((s) => (s.words.length ? s.words.filter((w) => a <= (w.a + w.b) / 2 && (w.a + w.b) / 2 < b).map((w) => w.w) : [s.text])).join(" ");
}

/** Speech (from the transcript), sound without speech (music, effects), quiet (silencedetect). */
export function soundSpans(au: Audio | undefined, tr: Transcript | undefined): { speech: Span[]; sound: Span[]; quiet: Span[] } {
  if (!au) return { speech: [], sound: [], quiet: [] };
  const speech: Span[] = (tr?.segments ?? []).map((s) => [s.a, s.b]);
  const sound: Span[] = [];
  let cur: Span | undefined;
  au.lufs.forEach((l, i) => {
    const t = i * au.bin;
    if (l > -45 && !speech.some(([a, b]) => a - 0.2 <= t && t <= b + 0.2)) {
      if (cur && t - cur[1] <= au.bin + 1e-6) cur[1] = t + au.bin;
      else { cur = [t, t + au.bin]; sound.push(cur); }
    }
  });
  return { speech, sound: sound.filter(([a, b]) => b - a >= 1), quiet: au.silences };
}

export const overlap = (spans: readonly Span[], a: number, b: number): number => spans.reduce((s, [x, y]) => s + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);
export const clipSpans = (spans: readonly Span[], a: number, b: number): Span[] => spans.filter(([x, y]) => y > a && x < b).map(([x, y]) => [Math.max(a, x), Math.min(b, y)]);

/** Shots merged up to about 1/rows of the video, long shots broken at a pause: the overview's timeline rows. */
export function segmentsFor(duration: number, vis: Visual, au: Audio | undefined, rows = 30): Span[] {
  const bounds = [0, ...vis.cuts.filter((c) => c > 0 && c < duration), duration];
  const minlen = duration / rows;
  const merged: Span[] = [];
  for (let i = 1; i < bounds.length; i++) {
    const a = bounds[i - 1]!, b = bounds[i]!;
    if (merged.length && merged.at(-1)![1] - merged.at(-1)![0] < minlen) merged.at(-1)![1] = b;
    else merged.push([a, b]);
  }
  if (merged.length > 1 && merged.at(-1)![1] - merged.at(-1)![0] < minlen / 3) merged.at(-2)![1] = merged.pop()![1];
  const maxlen = Math.max(minlen * 2, Math.min(20, duration / 8));
  const out: Span[] = [];
  for (let [a, b] of merged) {
    while (b - a > maxlen) {
      // a long shot (a screen recording, a talking head) is broken at a pause near the ideal length
      const ideal = a + maxlen * 0.75;
      const pauses = (au?.silences ?? []).map(([x, y]) => (x + y) / 2).filter((p) => p > a + maxlen * 0.4 && p < a + maxlen);
      const cut = pauses.length ? pauses.reduce((best, p) => (Math.abs(p - ideal) < Math.abs(best - ideal) ? p : best)) : ideal;
      out.push([a, cut]); a = cut;
    }
    out.push([a, b]);
  }
  return out;
}

/** The reel's beats as segments, when the video is a reelcut master: `--beats out/reel.json`. */
export function beatSegments(reelJson: string): { id: string; kind?: string; span: Span; text?: string }[] {
  if (!existsSync(reelJson)) throw new Error(`no such reel.json: ${reelJson}`);
  const reel = JSON.parse(readFileSync(reelJson, "utf8")) as { beats?: { id: string; kind?: string; durationSeconds?: number; text?: string }[] };
  let t = 0;
  return (reel.beats ?? []).map((b) => { const a = t; t += b.durationSeconds ?? 0; return { id: b.id, kind: b.kind, span: [a, t] as Span, text: b.text }; });
}

export function fastSpans(duration: number, vis: Visual): Span[] {
  const out: Span[] = [];
  let cur: Span | undefined;
  vis.motion.forEach((x, i) => {
    const t = i * BIN;
    const dense = vis.cuts.filter((c) => Math.abs(c - t) < 1).length >= 2;
    if (x >= 0.06 || dense) {
      if (cur && t - cur[1] <= BIN) cur[1] = t + BIN;
      else { cur = [t, t + BIN]; out.push(cur); }
    }
  });
  return out.map(([a, b]): Span => [a, Math.min(b, duration)]).filter(([a, b]) => b - a >= 0.5);
}

export function stillSpans(duration: number, vis: Visual): Span[] {
  const out: Span[] = [];
  let cur: Span | undefined;
  vis.motion.forEach((x, i) => {
    const t = i * BIN;
    if (x < 0.004) {
      if (cur && t - cur[1] <= BIN) cur[1] = t + BIN;
      else { cur = [t, t + BIN]; out.push(cur); }
    } else cur = undefined;
  });
  return out.map(([a, b]): Span => [a, Math.min(b, duration)]).filter(([a, b]) => b - a >= 3);
}

/**
 * The middle of each segment; evenly spread when there are more segments than frames; topped up with evenly spaced
 * moments when there are fewer (one long shot still deserves a storyboard).
 */
export function storyboardTimes(segs: readonly Span[], duration: number, n: number): number[] {
  const picks = segs.length <= n ? segs : Array.from({ length: n }, (_, i) => segs[Math.round((i * (segs.length - 1)) / (n - 1))]!);
  const times = picks.map(([a, b]) => Math.round(((a + b) / 2) * 100) / 100);
  for (let i = 0; i < n && times.length < n; i++) {
    const t = Math.round(((i + 0.5) * duration * 100) / n) / 100;
    if (times.every((x) => Math.abs(t - x) > duration / (n * 2))) times.push(t);
  }
  return times.sort((a, b) => a - b);
}

export const shotsOf = (v: WatchVideo, vis: Visual): Span[] => {
  const b = [0, ...vis.cuts, v.duration];
  return b.slice(1).map((y, i): Span => [b[i]!, y]);
};
