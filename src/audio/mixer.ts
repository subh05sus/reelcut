import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * The sound of a reel, mixed here rather than by the renderer.
 *
 * HyperFrames can play an `<audio>` at a time and a volume. A mix that sounds designed needs more: a whoosh placed
 * so its **peak** lands on the move, a riser so its **end** lands on the cut, repeats with a touch of pitch and pan
 * so twelve keystrokes are not one sound twelve times, effects and music that **duck** under the voice, and a final
 * loudness every platform expects. So the picture renders silent and this mixes the audio from the cue sheet, the
 * music bed and the voiceover, sample by sample, then muxes it in. Nothing about the picture changes.
 *
 * Every number is fixed by the cue sheet: the same reel always mixes to the same file.
 */

export const SR = 48000;

export type Align = "onset" | "peak" | "end" | "raw";

export interface MixCue {
  file: string;
  /** Seconds on the mix's timeline where the cue's alignment point lands. */
  at: number;
  /** Linear level, 0..1+. */
  volume: number;
  /** -1 (left) .. 1 (right). */
  pan?: number;
  /** Playback rate: 1.1 is a touch faster and higher. */
  rate?: number;
  /** Which point of the sound sits on `at`: its transient, its loudest moment, its end, or its first sample. */
  align?: Align;
  /** Longest the sound may play, in seconds after its first sample; it fades out over the last 30 ms. */
  maxSeconds?: number;
}

export interface MixBed {
  file: string;
  /** Seconds into the track the bed starts from. */
  offset: number;
  /** Seconds on the mix's timeline it starts at. */
  at: number;
  length: number;
  volume: number;
  fadeIn?: number;
  fadeOut?: number;
}

export interface MixInput {
  /** Seconds. */
  length: number;
  cues: readonly MixCue[];
  bed?: MixBed;
  /** The voiceover, from the start of the timeline. */
  voice?: { file: string; volume?: number; offset?: number };
  /** How far effects dip while the voice speaks, in dB. */
  duckDb?: number;
  /** How far the music bed dips while the voice speaks, in dB. */
  bedDuckDb?: number;
}

const cache = new Map<string, Float32Array[]>();

/** Decode to 48 kHz float, stereo or mono. Cached per run. */
export function decode(file: string, channels: 1 | 2): Float32Array[] {
  const key = `${channels}\0${file}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const buf = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ac", String(channels), "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 2 * 1024 * 1024 * 1024 });
  const all = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
  const n = Math.floor(all.length / channels);
  const out = Array.from({ length: channels }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) out[c]![i] = all[i * channels + c]!;
  cache.set(key, out);
  return out;
}

/** The main transient: the first sample above half the peak, less 8 ms of attack. */
export function onsetIndex(x: Float32Array): number {
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]!) > 0.5 * peak) return Math.max(0, i - Math.round(0.008 * SR));
  return 0;
}

/** The loudest 20 ms of the sound. */
export function peakIndex(x: Float32Array): number {
  const w = Math.round(0.02 * SR);
  let sum = 0, best = 0, at = 0;
  for (let i = 0; i < x.length; i++) {
    sum += Math.abs(x[i]!);
    if (i >= w) sum -= Math.abs(x[i - w]!);
    if (sum > best) { best = sum; at = i - Math.floor(w / 2); }
  }
  return Math.max(0, at);
}

/** Linear-interpolation resample: rate 1.1 plays 10% faster (and higher). */
function resample(x: Float32Array, rate: number): Float32Array {
  if (Math.abs(rate - 1) < 1e-4) return x;
  const n = Math.floor(x.length / rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * rate, j = Math.floor(p), f = p - j;
    out[i] = (x[j] ?? 0) * (1 - f) + (x[j + 1] ?? 0) * f;
  }
  return out;
}

/** The voice's loudness, 10 ms frames, 0..1 (1 at its 99th percentile). */
export function envelope(voice: Float32Array, hop = SR / 100): Float32Array {
  const n = Math.ceil(voice.length / hop);
  const env = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0, c = 0;
    for (let i = f * hop; i < Math.min(voice.length, (f + 1) * hop); i++) { s += voice[i]! * voice[i]!; c++; }
    env[f] = Math.sqrt(s / Math.max(1, c));
  }
  const sorted = [...env].sort((a, b) => a - b);
  const p99 = sorted[Math.floor(sorted.length * 0.99)] || 1;
  for (let f = 0; f < n; f++) env[f] = Math.min(1, env[f]! / p99);
  return env;
}

/** A gain curve per sample that dips by `db` while the voice speaks: 10 ms attack, 180 ms release. */
function duckCurve(env: Float32Array, length: number, db: number): Float32Array {
  const out = new Float32Array(length).fill(1);
  if (db <= 0) return out;
  const hop = SR / 100;
  const atk = 1 - Math.exp(-1 / 1), rel = 1 - Math.exp(-1 / 18); // per 10 ms frame: ~10 ms attack, ~180 ms release
  let level = 0;
  const frames = new Float32Array(Math.ceil(length / hop));
  for (let f = 0; f < frames.length; f++) {
    const target = Math.min(1, (env[f] ?? 0) * 1.6);
    level += (target - level) * (target > level ? atk : rel);
    frames[f] = level;
  }
  for (let i = 0; i < length; i++) {
    const f = i / hop, a = Math.floor(f), t = f - a;
    const v = (frames[a] ?? 0) * (1 - t) + (frames[a + 1] ?? frames[a] ?? 0) * t;
    out[i] = Math.pow(10, (-db * v) / 20);
  }
  return out;
}

export interface MixResult {
  left: Float32Array;
  right: Float32Array;
  /** Each part as it sits in the mix (ducked), for stems. */
  parts: { fx: [Float32Array, Float32Array]; voice?: Float32Array; bed?: [Float32Array, Float32Array] };
  /** How many cues were placed (a cue entirely outside the timeline is dropped). */
  placed: number;
}

export function mix(input: MixInput): MixResult {
  const n = Math.ceil(input.length * SR);
  const fxL = new Float32Array(n), fxR = new Float32Array(n);
  let placed = 0;
  for (const cue of input.cues) {
    const [mono] = decode(cue.file, 1);
    let x = resample(mono!, cue.rate ?? 1);
    if (cue.maxSeconds !== undefined) x = x.subarray(0, Math.max(1, Math.round(cue.maxSeconds * SR)));
    const align = cue.align ?? "onset";
    const point = align === "onset" ? onsetIndex(x) : align === "peak" ? peakIndex(x) : align === "end" ? x.length : 0;
    const start = Math.round(cue.at * SR) - point;
    const pan = Math.max(-1, Math.min(1, cue.pan ?? 0));
    // Constant power: the sound is as loud panned as it is centred.
    const gl = cue.volume * Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2, gr = cue.volume * Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
    const fade = Math.round(0.03 * SR);
    let any = false;
    for (let i = 0; i < x.length; i++) {
      const j = start + i;
      if (j < 0) continue;
      if (j >= n) break;
      const tail = cue.maxSeconds !== undefined && i > x.length - fade ? (x.length - i) / fade : 1;
      const v = x[i]! * tail;
      fxL[j] = fxL[j]! + v * gl;
      fxR[j] = fxR[j]! + v * gr;
      any = true;
    }
    if (any) placed++;
  }

  const outL = new Float32Array(n), outR = new Float32Array(n);
  let voiceEnv: Float32Array | undefined;
  if (input.voice) {
    const [v] = decode(input.voice.file, 1);
    const off = Math.round((input.voice.offset ?? 0) * SR);
    const vol = input.voice.volume ?? 1;
    const vv = new Float32Array(n);
    for (let i = 0; i < n; i++) { const k = i - off; if (k >= 0 && k < v!.length) vv[i] = v![k]! * vol; }
    voiceEnv = envelope(vv);
    for (let i = 0; i < n; i++) { outL[i] = vv[i]!; outR[i] = vv[i]!; }
  }
  const voiceOnly = voiceEnv ? Float32Array.from(outL) : undefined;
  const fxDuck = voiceEnv ? duckCurve(voiceEnv, n, input.duckDb ?? 7) : undefined;
  for (let i = 0; i < n; i++) {
    const d = fxDuck ? fxDuck[i]! : 1;
    fxL[i] = fxL[i]! * d;
    fxR[i] = fxR[i]! * d;
    outL[i] = outL[i]! + fxL[i]!;
    outR[i] = outR[i]! + fxR[i]!;
  }
  let bedParts: [Float32Array, Float32Array] | undefined;
  if (input.bed) {
    const b = input.bed;
    const [bl, br] = decode(b.file, 2);
    const bedDuck = voiceEnv ? duckCurve(voiceEnv, n, input.bedDuckDb ?? 9) : undefined;
    const start = Math.round(b.at * SR), from = Math.round(b.offset * SR), len = Math.min(Math.round(b.length * SR), bl!.length - from);
    const fi = Math.round((b.fadeIn ?? 0) * SR), fo = Math.round((b.fadeOut ?? 1.5) * SR);
    bedParts = [new Float32Array(n), new Float32Array(n)];
    for (let i = 0; i < len; i++) {
      const j = start + i;
      if (j < 0 || j >= n) continue;
      const g = b.volume * (fi && i < fi ? i / fi : 1) * (fo && i > len - fo ? Math.max(0, (len - i) / fo) : 1) * (bedDuck ? bedDuck[j]! : 1);
      bedParts[0][j] = bl![from + i]! * g;
      bedParts[1][j] = br![from + i]! * g;
      outL[j] = outL[j]! + bedParts[0][j]!;
      outR[j] = outR[j]! + bedParts[1][j]!;
    }
  }
  return { left: outL, right: outR, placed, parts: { fx: [fxL, fxR], ...(voiceOnly ? { voice: voiceOnly } : {}), ...(bedParts ? { bed: bedParts } : {}) } };
}

/** Write a 48 kHz stereo 32-bit float WAV. */
export function writeWav(file: string, left: Float32Array, right: Float32Array): void {
  const n = left.length;
  const data = Buffer.alloc(n * 8);
  for (let i = 0; i < n; i++) { data.writeFloatLE(left[i]!, i * 8); data.writeFloatLE(right[i]!, i * 8 + 4); }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(3, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 8, 28); h.writeUInt16LE(8, 32); h.writeUInt16LE(32, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, Buffer.concat([h, data]));
}

/**
 * Two-pass loudness normalisation (EBU R128): integrated -14 LUFS, true peak -1.5 dBTP, the level the platforms play
 * at. Returns the measured input loudness.
 */
export function normalize(input: string, output: string, lufs = -14, tp = -1.5): number {
  const meas = spawnSync("ffmpeg", ["-hide_banner", "-i", input, "-af", `loudnorm=I=${lufs}:TP=${tp}:LRA=11:print_format=json`, "-f", "null", "-"], { encoding: "utf8" });
  const j = JSON.parse(/\{[\s\S]*?\}/.exec(meas.stderr.slice(meas.stderr.lastIndexOf("[Parsed_loudnorm")))?.[0] ?? "{}") as Record<string, string>;
  const af = j.input_i && Number.isFinite(Number(j.input_i))
    ? `loudnorm=I=${lufs}:TP=${tp}:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`
    : `loudnorm=I=${lufs}:TP=${tp}:LRA=11`;
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", input, "-af", `${af},aresample=${SR}`, output]);
  return Number(j.input_i);
}

/** Replace a video's audio with `audio` (the picture is stream-copied). */
export function muxAudio(video: string, audio: string, out: string): void {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-i", audio, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", out]);
}

/** A small, stable variation for the n-th repeat of a sound: rate within ±a, never random. */
export function jitter(i: number, a = 0.05): number {
  return 1 + a * ((((i * 7919) % 101) / 50) - 1);
}

/** The default way to place a sound, from what it is: whooshes peak on the moment, risers end on it. */
export function alignFor(tags: readonly string[]): Align {
  if (tags.some((t) => ["riser", "swell", "reverse", "build"].includes(t))) return "end";
  if (tags.some((t) => ["whoosh", "swoosh", "swish", "swipe", "slide"].includes(t))) return "peak";
  return "onset";
}
