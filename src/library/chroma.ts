import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * Green-screen detection and removal.
 *
 * A recording on a flat green backdrop (a card or window shot on a green screen) is detected from a few
 * small frames, then keyed into a transparent WebM, once, and the original is never touched.
 *
 * ## The matte
 *
 * Every pixel at the edge of the subject is a blend of the subject and the backdrop: `p = a·C + (1−a)·K`,
 * with `K` the key colour. For a green backdrop the green a pixel has *over* its other channels,
 * `d = g − max(r, b)`, is `(1−a)·(Kg − max(Kr, Kb))`, so `a = 1 − d/g0` where `g0` is the backdrop's own
 * excess. That one number does four jobs:
 *
 *   - pure backdrop           d = g0   → a = 0
 *   - subject (white, black…) d ≈ 0    → a = 1
 *   - anti-aliased edge       d between → the right partial alpha, and the unmixed colour
 *     `C = (p − (1−a)·K)/a` has the green taken back out of it, which is the despill
 *   - a drop shadow           (0, k·g0, 0) → a = 1−k and C = black: a real soft shadow, kept as it is
 *
 * ## Where it applies
 *
 * Only to the backdrop reached from the frame's border, and a few pixels around it. Green *inside* the
 * subject (a lime button, a logo) is not connected to the border and is left exactly as recorded.
 */

/** Bumped when the algorithm changes, so every keyed file is made again. */
export const KEY_VERSION = 1;

export interface KeyParams {
  /** The backdrop, `#rrggbb`. */
  color: string;
  /** 0..0.5: how much of the backdrop's green excess may remain before a pixel counts as subject. Compression noise lives here. */
  tolerance: number;
  /** 0..1: 1 keeps the soft, anti-aliased edge; 0 cuts it hard. */
  softness: number;
  /** 0..1: how much green is taken out of the edge and the band around it. */
  despill: number;
  /** `keep` makes a drop shadow on the backdrop a soft black shadow; `drop` removes it. */
  shadows: "keep" | "drop";
  /** Pixels to eat into the matte, 0..3: for a stubborn halo. */
  choke: number;
}

export const DEFAULT_KEY: Omit<KeyParams, "color"> = { tolerance: 0.06, softness: 1, despill: 1, shadows: "keep", choke: 0 };

/** Pixels around the backdrop in which the matte may be soft and green is taken back out. */
const EDGE_BAND = 3;
/** A backdrop pixel needs at least this much green; below it a pixel is just dark. */
const MIN_GREEN = 24;
/** Alpha at or above which a pixel counts as part of the subject, for the crop. Shadows are faint, so a kept shadow uses a lower one. */
const SOLID = 128;
const FAINT = 12;

export function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`"${hex}" is not a colour like #00f600`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: readonly number[]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v!))).toString(16).padStart(2, "0")).join("")}`;
}

/** Pixel rectangle; `x1` and `y1` are exclusive. */
export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Slide a `2r+1` window over every row (or column), setting `dst` where any `src` pixel in it is set. */
function dilate(src: Uint8Array, dst: Uint8Array, tmp: Uint8Array, w: number, h: number, r: number): void {
  if (r <= 0) {
    dst.set(src);
    return;
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let count = 0;
    for (let x = 0; x < Math.min(w, r); x++) count += src[row + x]!;
    for (let x = 0; x < w; x++) {
      if (x + r < w) count += src[row + x + r]!;
      if (x - r - 1 >= 0) count -= src[row + x - r - 1]!;
      tmp[row + x] = count > 0 ? 1 : 0;
    }
  }
  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = 0; y < Math.min(h, r); y++) count += tmp[y * w + x]!;
    for (let y = 0; y < h; y++) {
      if (y + r < h) count += tmp[(y + r) * w + x]!;
      if (y - r - 1 >= 0) count -= tmp[(y - r - 1) * w + x]!;
      dst[y * w + x] = count > 0 ? 1 : 0;
    }
  }
}

/** Shrink an 8-bit alpha channel by `r` pixels (a minimum filter, square window). */
function erode(alpha: Uint8Array, tmp: Uint8Array, w: number, h: number, r: number): void {
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let min = 255;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) if (alpha[row + k]! < min) min = alpha[row + k]!;
      tmp[row + x] = min;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let min = 255;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) if (tmp[k * w + x]! < min) min = tmp[k * w + x]!;
      alpha[y * w + x] = min;
    }
  }
}

export interface KeyedFrame {
  /** Where the subject (and, with shadows kept, its shadow) is in this frame; `null` when the frame is empty. */
  bounds: Bounds | null;
  /** Share of the frame that is backdrop, 0..1. */
  backdrop: number;
}

/** Keys frames of one size. Holds its scratch buffers so a long recording allocates nothing per frame. */
export class Keyer {
  private readonly key: [number, number, number];
  private readonly bg: Uint8Array;
  private readonly reached: Uint8Array;
  private readonly zone: Uint8Array;
  private readonly tmp: Uint8Array;
  private readonly alpha: Uint8Array;
  private readonly stack: Int32Array;

  constructor(readonly width: number, readonly height: number, readonly params: KeyParams) {
    this.key = parseHex(params.color);
    const n = width * height;
    this.bg = new Uint8Array(n);
    this.reached = new Uint8Array(n);
    this.zone = new Uint8Array(n);
    this.tmp = new Uint8Array(n);
    this.alpha = new Uint8Array(n);
    this.stack = new Int32Array(n);
  }

  /** `rgb` is `width·height·3` bytes in; `out` is `width·height·4` bytes of straight-alpha RGBA. */
  frame(rgb: Uint8Array, out: Uint8Array): KeyedFrame {
    const { width: w, height: h, params, bg, reached, zone, alpha, stack } = this;
    const n = w * h;
    const [kr, kg, kb] = this.key;
    const g0 = Math.max(1, kg - Math.max(kr, kb));
    const tol = params.tolerance;

    // Backdrop-like: green with little red or blue, in any brightness, so a shadow on it counts.
    for (let i = 0, p = 0; i < n; i++, p += 3) {
      const r = rgb[p]!, g = rgb[p + 1]!, b = rgb[p + 2]!;
      bg[i] = g >= MIN_GREEN && (r > b ? r : b) * 10 <= g + 80 ? 1 : 0;
    }

    // The backdrop is what is reached from the border through backdrop-like pixels.
    reached.fill(0);
    let sp = 0;
    const seed = (i: number): void => {
      if (bg[i] && !reached[i]) {
        reached[i] = 1;
        stack[sp++] = i;
      }
    };
    for (let x = 0; x < w; x++) {
      seed(x);
      seed((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      seed(y * w);
      seed(y * w + w - 1);
    }
    while (sp > 0) {
      const i = stack[--sp]!;
      const x = i % w;
      if (x > 0) seed(i - 1);
      if (x < w - 1) seed(i + 1);
      if (i >= w) seed(i - w);
      if (i < n - w) seed(i + w);
    }
    dilate(reached, zone, this.tmp, w, h, EDGE_BAND);

    const soft = params.softness;
    const spillAmount = params.despill;
    const dropShadows = params.shadows === "drop";
    let backdrop = 0;
    for (let i = 0, p = 0, q = 0; i < n; i++, p += 3, q += 4) {
      const r = rgb[p]!, g = rgb[p + 1]!, b = rgb[p + 2]!;
      if (!zone[i]) {
        out[q] = r; out[q + 1] = g; out[q + 2] = b; out[q + 3] = 255;
        alpha[i] = 255;
        continue;
      }
      const m = r > b ? r : b;
      let araw = 1 - (g - m) / g0;
      araw = araw < 0 ? 0 : araw > 1 ? 1 : araw;
      let a = 0;
      if (araw > tol) {
        const lin = (araw - tol) / (1 - tol);
        const hard = lin >= 0.5 ? 1 : 0;
        a = hard + (lin - hard) * soft;
      }
      let cr = 0, cg = 0, cb = 0;
      if (a > 0) {
        // Take the backdrop back out of the pixel: what is left is the subject's own colour.
        const back = 1 - araw;
        cr = (r - back * kr) / araw;
        cg = (g - back * kg) / araw;
        cb = (b - back * kb) / araw;
        cr = cr < 0 ? 0 : cr > 255 ? 255 : cr;
        cg = cg < 0 ? 0 : cg > 255 ? 255 : cg;
        cb = cb < 0 ? 0 : cb > 255 ? 255 : cb;
        const excess = cg - (cr > cb ? cr : cb);
        if (excess > 0) cg -= spillAmount * excess;
        if (dropShadows && bg[i] && cr < 48 && cg < 48 && cb < 48) a = 0;
      }
      if (a <= 0) {
        out[q] = 0; out[q + 1] = 0; out[q + 2] = 0; out[q + 3] = 0;
        alpha[i] = 0;
        backdrop++;
      } else {
        out[q] = cr; out[q + 1] = cg; out[q + 2] = cb;
        const byte = Math.round(a * 255);
        out[q + 3] = byte;
        alpha[i] = byte;
      }
    }

    if (params.choke > 0) {
      erode(alpha, this.tmp, w, h, params.choke);
      for (let i = 0, q = 3; i < n; i++, q += 4) {
        if (alpha[i]! < out[q]!) out[q] = alpha[i]!;
      }
    }

    const threshold = dropShadows ? SOLID : FAINT;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (out[(row + x) * 4 + 3]! >= threshold) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          y1 = y;
        }
      }
    }
    return { bounds: x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 }, backdrop: backdrop / n };
  }
}

// ---------------------------------------------------------------- detection

export interface SmallFrame {
  width: number;
  height: number;
  /** rgb24 */
  data: Uint8Array;
}

export interface GreenDetection {
  detected: boolean;
  /** The backdrop's colour, `#rrggbb`; meaningful when `detected`. */
  color: string;
  /** Share of the frame within reach of that colour (median over the frames sampled). */
  coverage: number;
  /** Share of the frame's border that is. */
  border: number;
}

const NEAR = 45;
const MIN_COVERAGE = 0.15;
const MIN_BORDER = 0.25;
/** How much of everything strongly green has to be the one flat colour. Gradients and real green UI are not a screen. */
const MIN_FLAT = 0.7;

const median = (values: number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

/**
 * Is there a flat green backdrop? Looks for one dominant, strongly green colour that fills a good part of
 * the frame, touches its border, and is flat: a recording of a green website or a photo of grass is not a screen.
 */
export function detectGreen(frames: readonly SmallFrame[]): GreenDetection {
  const none: GreenDetection = { detected: false, color: "#00ff00", coverage: 0, border: 0 };
  if (frames.length === 0) return none;

  // The dominant strongly-green colour, found on a coarse grid so compression noise does not split it.
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  let greenish = 0;
  for (const f of frames) {
    for (let p = 0; p < f.width * f.height * 3; p += 3) {
      const r = f.data[p]!, g = f.data[p + 1]!, b = f.data[p + 2]!;
      if (g < 100 || g - Math.max(r, b) < 90) continue;
      greenish++;
      const bin = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const e = bins.get(bin) ?? { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += r; e.g += g; e.b += b;
      bins.set(bin, e);
    }
  }
  if (greenish === 0) return none;
  const top = [...bins.values()].sort((a, b) => b.n - a.n)[0]!;
  const key: [number, number, number] = [top.r / top.n, top.g / top.n, top.b / top.n];
  const near = (r: number, g: number, b: number): boolean => (r - key[0]) ** 2 + (g - key[1]) ** 2 + (b - key[2]) ** 2 <= NEAR * NEAR;

  const coverage: number[] = [];
  const border: number[] = [];
  let nearGreen = 0;
  let allGreen = 0;
  for (const f of frames) {
    let inside = 0;
    let edge = 0;
    let edgeNear = 0;
    for (let y = 0; y < f.height; y++) {
      for (let x = 0; x < f.width; x++) {
        const p = (y * f.width + x) * 3;
        const r = f.data[p]!, g = f.data[p + 1]!, b = f.data[p + 2]!;
        const isNear = near(r, g, b);
        if (isNear) inside++;
        if (g - Math.max(r, b) >= 60) {
          allGreen++;
          if (isNear) nearGreen++;
        }
        if (x === 0 || y === 0 || x === f.width - 1 || y === f.height - 1) {
          edge++;
          if (isNear) edgeNear++;
        }
      }
    }
    coverage.push(inside / (f.width * f.height));
    border.push(edgeNear / edge);
  }
  const cov = median(coverage);
  const bor = median(border);
  const flat = allGreen > 0 ? nearGreen / allGreen : 0;
  const strong = key[1] - Math.max(key[0], key[2]) >= 90;
  return { detected: strong && cov >= MIN_COVERAGE && bor >= MIN_BORDER && flat >= MIN_FLAT, color: toHex(key), coverage: Math.round(cov * 1000) / 1000, border: Math.round(bor * 1000) / 1000 };
}

/** A few small frames spread across a video, as raw RGB, for `detectGreen`. */
export function sampleSmallFrames(file: string, dims: { width: number; height: number; durationSeconds: number }, count = 6, longEdge = 120): SmallFrame[] {
  const scale = longEdge / Math.max(dims.width, dims.height);
  const width = Math.max(2, Math.round((dims.width * scale) / 2) * 2);
  const height = Math.max(2, Math.round((dims.height * scale) / 2) * 2);
  const rate = Math.max(0.5, count / Math.max(0.3, dims.durationSeconds));
  const buffer = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-an", "-vf", `fps=${rate.toFixed(4)},scale=${width}:${height}`, "-frames:v", String(count), "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], { maxBuffer: 256 * 1024 * 1024 });
  const size = width * height * 3;
  const frames: SmallFrame[] = [];
  for (let i = 0; i + size <= buffer.length; i += size) frames.push({ width, height, data: new Uint8Array(buffer.subarray(i, i + size)) });
  return frames;
}

// ---------------------------------------------------------------- keying a video

export interface KeyVideoInfo {
  width: number;
  height: number;
  fps: number;
}

export interface KeyVideoResult {
  frames: number;
  /** One entry per frame: where the subject is, or `null` for an empty frame. */
  bounds: (Bounds | null)[];
  /** Threshold the bounds were taken at (alpha out of 255). */
  alphaThreshold: number;
}

/**
 * Key a whole video into a transparent WebM (VP9 with alpha), frame by frame.
 *
 * Decoded to raw RGB, keyed here, and encoded again as it streams, so a long recording is never held
 * in memory. Written to a temporary name and moved into place when it is complete.
 */
export async function keyVideo(input: string, output: string, params: KeyParams, info: KeyVideoInfo, onProgress?: (frames: number) => void): Promise<KeyVideoResult> {
  mkdirSync(path.dirname(output), { recursive: true });
  const partial = `${output}.part.webm`;
  rmSync(partial, { force: true });
  const { width, height } = info;
  const fps = info.fps > 0 ? info.fps : 30;
  const keyer = new Keyer(width, height, params);
  const inSize = width * height * 3;
  const frame = new Uint8Array(inSize);
  const rgba = new Uint8Array(width * height * 4);

  const decoder = spawn("ffmpeg", ["-v", "error", "-i", input, "-an", "-vf", `fps=${fps}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { stdio: ["ignore", "pipe", "pipe"] });
  const encoder = spawn(
    "ffmpeg",
    ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`, "-r", String(fps), "-i", "-", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "26", "-auto-alt-ref", "0", "-row-mt", "1", "-cpu-used", "4", "-deadline", "good", partial],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let decoderErr = "";
  let encoderErr = "";
  decoder.stderr.on("data", (c: Buffer) => (decoderErr += c.toString()));
  encoder.stderr.on("data", (c: Buffer) => (encoderErr += c.toString()));
  const exited = (child: ReturnType<typeof spawn>): Promise<number | null> => new Promise((resolve) => child.once("close", resolve));
  const decoderDone = exited(decoder);
  const encoderDone = exited(encoder);
  encoder.stdin!.on("error", () => undefined);

  const bounds: (Bounds | null)[] = [];
  let filled = 0;
  const flush = async (): Promise<void> => {
    bounds.push(keyer.frame(frame, rgba).bounds);
    filled = 0;
    if (!encoder.stdin!.write(rgba)) await new Promise<void>((resolve) => encoder.stdin!.once("drain", resolve));
    if (onProgress && bounds.length % 15 === 0) onProgress(bounds.length);
  };
  try {
    for await (const chunk of decoder.stdout as AsyncIterable<Buffer>) {
      let at = 0;
      while (at < chunk.length) {
        const take = Math.min(inSize - filled, chunk.length - at);
        frame.set(chunk.subarray(at, at + take), filled);
        filled += take;
        at += take;
        if (filled === inSize) await flush();
      }
    }
    encoder.stdin!.end();
    const [decoderCode, encoderCode] = await Promise.all([decoderDone, encoderDone]);
    if (decoderCode !== 0) throw new Error(`could not read ${path.basename(input)}: ${decoderErr.trim().split("\n").slice(-2).join(" | ")}`);
    if (encoderCode !== 0) throw new Error(`could not write the keyed video (needs ffmpeg with libvpx-vp9): ${encoderErr.trim().split("\n").slice(-2).join(" | ")}`);
    if (bounds.length === 0) throw new Error("the recording has no frames");
    rmSync(output, { force: true });
    renameSync(partial, output);
  } catch (error) {
    decoder.kill();
    encoder.kill();
    rmSync(partial, { force: true });
    throw error;
  }
  return { frames: bounds.length, bounds, alphaThreshold: params.shadows === "drop" ? SOLID : FAINT };
}

/**
 * Where the subject is during a stretch of a keyed video: the union of every frame's bounds in `[from, to]`,
 * with a little room for the soft edge. `undefined` when it is empty or covers the whole frame (nothing to crop).
 */
export function unionBounds(bounds: readonly (Bounds | null)[], fps: number, from: number, to: number, size: { width: number; height: number }, pad = 6): Bounds | undefined {
  if (bounds.length === 0) return undefined;
  const first = Math.max(0, Math.floor(from * fps));
  const last = Math.min(bounds.length - 1, Math.max(first, Math.ceil(to * fps)));
  let x0 = size.width, y0 = size.height, x1 = 0, y1 = 0;
  let any = false;
  for (let i = first; i <= last; i++) {
    const b = bounds[i];
    if (!b) continue;
    any = true;
    if (b.x0 < x0) x0 = b.x0;
    if (b.y0 < y0) y0 = b.y0;
    if (b.x1 > x1) x1 = b.x1;
    if (b.y1 > y1) y1 = b.y1;
  }
  if (!any) return undefined;
  const out = { x0: Math.max(0, x0 - pad), y0: Math.max(0, y0 - pad), x1: Math.min(size.width, x1 + pad), y1: Math.min(size.height, y1 + pad) };
  return out.x1 - out.x0 >= size.width && out.y1 - out.y0 >= size.height ? undefined : out;
}
