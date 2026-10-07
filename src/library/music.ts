import { execFileSync } from "node:child_process";

/**
 * A music bed: where a track's beats are, and how to lay it under a reel.
 *
 * ## Finding the beat
 *
 * The classic recipe, small enough to own (Ellis 2007, "Beat tracking by dynamic programming"):
 *
 * 1. **Onsets.** A short-time spectrum every ~23 ms, log-compressed; the onset strength of a frame is how much
 *    energy rose across all bands since the last one (spectral flux), with its local average taken off.
 * 2. **Tempo.** The autocorrelation of that envelope over the lags of 60–200 BPM, weighted toward ~120 BPM (a
 *    track at 70 also "is" 140; people tap the faster one), the best lag refined between frames.
 * 3. **Beats.** Dynamic programming: each frame's score is its onset strength plus the best earlier beat about
 *    one period back, penalised by how far that gap is from the period. Backtracking from the end gives a beat
 *    grid that follows the music where the tempo breathes.
 * 4. **Bars and phrases.** The downbeat is the phase (of four) whose beats carry the most low-end energy;
 *    phrases start on the bar lines every four bars where the energy changes most.
 *
 * ## Laying it under a reel
 *
 * Two ways, chosen per reel. **fit**: the cut stays exactly as timed; the track's start is chosen so its beats
 * (downbeats most) land on as many cuts as possible and the reel ends on a bar. **snap**: the same start, then each
 * cut moves to the nearest beat within 0.15 s, so every cut lands on the music.
 */

export interface MusicAnalysis {
  bpm: number;
  /** 0..1: how clearly the envelope repeats at that tempo. Below ~0.25 the grid is a guess (ambient, rubato). */
  confidence: number;
  /** Seconds, rounded to milliseconds. */
  beats: number[];
  /** Indices into `beats` that start a bar. */
  downbeats: number[];
  /** Seconds where a phrase starts (a bar line where the energy changes most). */
  phrases: number[];
  durationSeconds: number;
  /** Words for finding it again: slow, mid, upbeat, fast; calm, driving; dark, bright; sparse, busy. */
  mood: string[];
}

const SR = 22050;
const FRAME = 1024;
const HOP = 512;
const FPS = SR / HOP;

/** Decode to mono 22.05 kHz float samples. */
export function decodeMono(file: string, maxSeconds = 600): Float32Array {
  const buf = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-t", String(maxSeconds), "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1024 * 1024 * 1024 });
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
}

/** In-place radix-2 FFT on (re, im). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci, ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr; im[b] = im[a]! - ti; re[a] = re[a]! + tr; im[a] = im[a]! + ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

interface Features {
  onset: Float64Array;
  /** Energy below ~200 Hz per frame: where the kick is. */
  low: Float64Array;
  rms: Float64Array;
  centroid: number;
}

function features(samples: Float32Array): Features {
  const frames = Math.max(0, Math.floor((samples.length - FRAME) / HOP) + 1);
  const bins = FRAME / 2;
  const window = new Float64Array(FRAME).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));
  const onset = new Float64Array(frames), low = new Float64Array(frames), rms = new Float64Array(frames);
  let prev = new Float64Array(bins);
  const lowBin = Math.round((200 / SR) * FRAME);
  let centroidSum = 0, centroidWeight = 0;
  const re = new Float64Array(FRAME), im = new Float64Array(FRAME);
  for (let f = 0; f < frames; f++) {
    let energy = 0;
    for (let i = 0; i < FRAME; i++) { const s = samples[f * HOP + i]!; re[i] = s * window[i]!; im[i] = 0; energy += s * s; }
    rms[f] = Math.sqrt(energy / FRAME);
    fft(re, im);
    const cur = new Float64Array(bins);
    let flux = 0, lowE = 0;
    for (let k = 1; k < bins; k++) {
      const mag = Math.hypot(re[k]!, im[k]!);
      cur[k] = Math.log1p(100 * mag);
      const d = cur[k]! - prev[k]!;
      if (d > 0) flux += d;
      if (k <= lowBin) lowE += mag;
      centroidSum += k * mag; centroidWeight += mag;
    }
    onset[f] = flux; low[f] = lowE; prev = cur;
  }
  // Take the local average off, keep what rises above it, and scale to unit spread.
  const win = Math.round(FPS * 0.5), out = new Float64Array(frames);
  let sum = 0;
  for (let f = 0; f < frames; f++) {
    sum += onset[f]!; if (f - win >= 0) sum -= onset[f - win]!;
    out[f] = Math.max(0, onset[f]! - sum / Math.min(f + 1, win));
  }
  const mean = out.reduce((a, b) => a + b, 0) / Math.max(1, frames);
  const sd = Math.sqrt(out.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, frames)) || 1;
  for (let f = 0; f < frames; f++) out[f] = out[f]! / sd;
  return { onset: out, low, rms, centroid: centroidWeight ? ((centroidSum / centroidWeight) * SR) / FRAME : 0 };
}

/** Tempo in frames per beat, and how clearly the envelope repeats at it. */
function tempo(onset: Float64Array): { period: number; confidence: number } {
  const minLag = Math.floor((60 / 200) * FPS), maxLag = Math.ceil((60 / 60) * FPS);
  const n = onset.length;
  const ac = new Float64Array(maxLag + 2);
  for (let lag = 0; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += onset[i]! * onset[i + lag]!;
    ac[lag] = s / Math.max(1, n - lag);
  }
  let best = minLag, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * FPS) / lag;
    const weight = Math.exp(-0.5 * (Math.log2(bpm / 120) / 1) ** 2);
    const score = ac[lag]! * weight;
    if (score > bestScore) { bestScore = score; best = lag; }
  }
  // Between frames: a parabola through the peak and its neighbours.
  const a = ac[best - 1]!, b = ac[best]!, c = ac[best + 1]!;
  const shift = a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  const period = best + Math.max(-0.5, Math.min(0.5, shift));
  return { period, confidence: ac[0] ? Math.max(0, Math.min(1, b / ac[0]!)) : 0 };
}

/** Ellis's dynamic-programming beat tracker. Returns frame indices. */
function track(onset: Float64Array, period: number, tightness = 100): number[] {
  const n = onset.length;
  const score = new Float64Array(n), back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2), hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let best = 0, from = -1;
    for (let tau = t - hi; tau <= t - lo; tau++) {
      if (tau < 0) continue;
      const s = score[tau]! - tightness * Math.log((t - tau) / period) ** 2;
      if (from < 0 || s > best) { best = s; from = tau; }
    }
    score[t] = onset[t]! + (from >= 0 ? best : 0);
    back[t] = from;
  }
  // End on the best-scoring frame in the last period.
  let t = n - 1;
  for (let i = Math.max(0, n - Math.round(period)); i < n; i++) if (score[i]! > score[t]!) t = i;
  const beats: number[] = [];
  while (t >= 0) { beats.push(t); t = back[t]!; }
  return beats.reverse();
}

/**
 * The tracker works in 23 ms frames; a cut needs better. Each beat is moved to the sharpest rise in a ~3 ms energy
 * envelope within 50 ms of the frame's centre: the transient itself.
 */
function refine(samples: Float32Array, frames: readonly number[]): number[] {
  const win = 128, hop = 64, n = Math.floor((samples.length - win) / hop) + 1;
  const env = new Float64Array(Math.max(0, n));
  for (let i = 0; i < n; i++) { let e = 0; for (let k = 0; k < win; k++) { const v = samples[i * hop + k]!; e += v * v; } env[i] = Math.log1p(1000 * e / win); }
  return frames.map((fr) => {
    const centre = (fr * HOP + FRAME / 2) / SR;
    const a = Math.max(0, Math.floor(((centre - 0.05) * SR) / hop)), b = Math.min(n - 1, Math.ceil(((centre + 0.05) * SR) / hop));
    let best = -1, at = centre;
    // Before the first sample is silence, so a track that starts on a beat has its rise at 0.
    for (let i = a; i <= b; i++) { const rise = env[i]! - (i > 0 ? env[i - 1]! : 0); if (rise > best) { best = rise; at = i === 0 ? 0 : (i * hop + win / 2) / SR; } }
    return Math.round(at * 1000) / 1000;
  });
}

export function analyzeSamples(samples: Float32Array): MusicAnalysis {
  const durationSeconds = samples.length / SR;
  const f = features(samples);
  const { period, confidence } = tempo(f.onset);
  const frames = f.onset.length ? track(f.onset, period) : [];
  const beats = refine(samples, frames);
  const bpm = Math.round(((60 * FPS) / period) * 10) / 10;

  // Downbeat phase: the one of four whose beats carry the most low end.
  let phase = 0, phaseBest = -1;
  for (let p = 0; p < 4; p++) {
    let s = 0;
    for (let i = p; i < frames.length; i += 4) s += f.low[frames[i]!]!;
    if (s > phaseBest) { phaseBest = s; phase = p; }
  }
  const downbeats: number[] = [];
  for (let i = phase; i < beats.length; i += 4) downbeats.push(i);

  // Phrases: bar lines every four bars, the ones where the energy changes most.
  const rmsAt = (sec: number, span: number) => {
    const a = Math.max(0, Math.floor(sec * FPS)), b = Math.min(f.rms.length, Math.floor((sec + span) * FPS));
    let s = 0; for (let i = a; i < b; i++) s += f.rms[i]!; return b > a ? s / (b - a) : 0;
  };
  const barSeconds = (60 / Math.max(1, bpm)) * 4;
  const candidates = downbeats.filter((_, i) => i % 4 === 0).map((i) => beats[i]!).filter((t) => t > barSeconds && t < durationSeconds - barSeconds);
  const change = candidates.map((t) => ({ t, d: Math.abs(rmsAt(t, barSeconds * 2) - rmsAt(t - barSeconds * 2, barSeconds * 2)) }));
  const meanChange = change.reduce((a, c) => a + c.d, 0) / Math.max(1, change.length);
  const phrases = [beats[downbeats[0] ?? 0] ?? 0, ...change.filter((c) => c.d > meanChange).map((c) => c.t)].map((t) => Math.round(t * 1000) / 1000);

  const meanRms = f.rms.reduce((a, b) => a + b, 0) / Math.max(1, f.rms.length);
  const db = 20 * Math.log10(meanRms + 1e-9);
  const onsetRate = f.onset.filter((v) => v > 1.5).length / Math.max(1, durationSeconds);
  const mood = [
    bpm < 90 ? "slow" : bpm < 115 ? "mid" : bpm < 140 ? "upbeat" : "fast",
    db > -16 ? "driving" : "calm",
    f.centroid > 2200 ? "bright" : "dark",
    onsetRate > 3 ? "busy" : "sparse",
  ];
  return { bpm, confidence: Math.round(confidence * 100) / 100, beats, downbeats, phrases, durationSeconds: Math.round(durationSeconds * 1000) / 1000, mood };
}

export function analyzeMusic(file: string): MusicAnalysis {
  return analyzeSamples(decodeMono(file));
}

// ---------------------------------------------------------------- laying it under a reel

export type MusicSync = "fit" | "snap";

export interface MusicPlan {
  /** Seconds into the track the reel starts at. */
  offset: number;
  /** Cut times in the reel, after snapping (the same as given when `fit`). */
  cuts: number[];
  /** How many cuts land within 50 ms of a beat. */
  onBeat: number;
  /** How far each snapped cut moved, in seconds. */
  moved: number[];
  /** The reel ends this close to a bar line. */
  endToBar: number;
  /** The track is shorter than the reel: it fades out where it ends. */
  short: boolean;
}

const nearest = (sorted: readonly number[], t: number): number => {
  let lo = 0, hi = sorted.length - 1;
  if (hi < 0) return Infinity;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (sorted[mid]! < t) lo = mid; else hi = mid; }
  return Math.abs(sorted[lo]! - t) <= Math.abs(sorted[hi]! - t) ? sorted[lo]! : sorted[hi]!;
};

/**
 * Where to start the track so the cuts land on its beats, and (for `snap`) the cuts moved onto them.
 * `cuts` are the reel's internal cut times in seconds (not 0, not the end); `length` is the reel's length.
 */
export function planMusic(music: MusicAnalysis, cuts: readonly number[], length: number, sync: MusicSync, options: { maxMove?: number; start?: number } = {}): MusicPlan {
  const maxMove = options.maxMove ?? 0.15;
  const bars = music.downbeats.map((i) => music.beats[i]!).filter((t) => t !== undefined);
  const short = music.durationSeconds < length;
  const fits = (o: number) => o + length <= music.durationSeconds + 0.01;
  // Where the track could start: on a beat, or wherever puts one of the cuts on a beat (a short fade covers a
  // start between beats). A start on a bar line still scores best when it does as well.
  let candidates: number[];
  if (options.start !== undefined) candidates = [options.start];
  else {
    const seen = new Set<number>();
    candidates = [];
    for (const b of music.beats) for (const c of [0, ...cuts]) {
      const o = Math.round((b - c) * 100) / 100;
      if (o >= 0 && fits(o) && !seen.has(o)) { seen.add(o); candidates.push(o); }
    }
  }
  if (candidates.length === 0) candidates = [music.beats[0] ?? 0];
  const sigma = sync === "snap" ? 0.08 : 0.04;
  let best = candidates[0]!, bestScore = -Infinity;
  for (const o of candidates) {
    let s = 0;
    for (const c of cuts) {
      const t = c + o;
      const db = Math.abs(nearest(music.beats, t) - t), dd = Math.abs(nearest(bars, t) - t);
      s += Math.exp(-(db * db) / (2 * sigma * sigma)) + 0.6 * Math.exp(-(dd * dd) / (2 * sigma * sigma));
    }
    if (bars.length && Math.abs(nearest(bars, o) - o) < 0.02) s += 1; // starting on a bar line
    const end = o + length;
    if (bars.length && Math.abs(nearest(bars, end) - end) < 0.12) s += 0.8; // ending on one
    if (music.phrases.some((p) => Math.abs(p - o) < 0.02)) s += 0.5; // starting a phrase
    if (s > bestScore + 1e-9) { bestScore = s; best = o; }
  }
  const moved: number[] = [];
  const out = cuts.map((c) => {
    if (sync !== "snap") { moved.push(0); return c; }
    const t = c + best, target = nearest(music.beats, t) - best;
    const d = target - c;
    if (Math.abs(d) > maxMove) { moved.push(0); return c; }
    moved.push(Math.round(d * 1000) / 1000);
    return Math.round(target * 1000) / 1000;
  });
  // Snapping can never reorder cuts or squeeze a beat to nothing.
  for (let i = 1; i < out.length; i++) if (out[i]! <= out[i - 1]! + 0.2) { out[i] = cuts[i]!; moved[i] = 0; }
  const onBeat = out.filter((c) => Math.abs(nearest(music.beats, c + best) - (c + best)) <= 0.05).length;
  const end = best + length;
  return { offset: Math.round(best * 1000) / 1000, cuts: out, onBeat, moved, endToBar: bars.length ? Math.round(Math.abs(nearest(bars, end) - end) * 1000) / 1000 : Infinity, short };
}

/** A beat's durations after its cuts moved: the gaps between consecutive cuts, the first from 0, the last to the end. */
export function durationsFromCuts(cuts: readonly number[], length: number): number[] {
  const edges = [0, ...cuts, length];
  return edges.slice(1).map((t, i) => Math.round((t - edges[i]!) * 1e6) / 1e6);
}
