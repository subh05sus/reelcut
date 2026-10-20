import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { WatchError, fmt } from "./time.js";

const exec = promisify(execFile);

/**
 * Frames as raw RGB, enough to stamp a timestamp on each and tile them into a grid without an imaging library.
 *
 * ffmpeg's `drawtext` is missing from many builds (Homebrew's among them), so labels are drawn here from a 5x7 bitmap
 * font: ffmpeg hands back one PPM per frame, the grid is assembled in a Buffer, and ffmpeg writes the JPEG.
 */

const FONT: Record<string, string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

export class Img {
  readonly data: Buffer;
  constructor(readonly w: number, readonly h: number, data?: Buffer, fill: [number, number, number] = [18, 18, 20]) {
    this.data = data ?? Buffer.alloc(w * h * 3);
    if (!data) for (let i = 0; i < this.data.length; i += 3) { this.data[i] = fill[0]; this.data[i + 1] = fill[1]; this.data[i + 2] = fill[2]; }
  }

  static fromPpm(b: Buffer): Img {
    const tokens: string[] = [];
    let i = 0;
    while (tokens.length < 4) {
      while (i < b.length && /\s/.test(String.fromCharCode(b[i]!))) i++;
      if (b[i] === 0x23) { while (i < b.length && b[i] !== 0x0a) i++; continue; }
      let j = i;
      while (j < b.length && !/\s/.test(String.fromCharCode(b[j]!))) j++;
      tokens.push(b.subarray(i, j).toString("latin1"));
      i = j;
    }
    i++;
    if (tokens[0] !== "P6" || tokens[3] !== "255") throw new WatchError("unexpected frame format from ffmpeg");
    const w = Number(tokens[1]), h = Number(tokens[2]);
    return new Img(w, h, Buffer.from(b.subarray(i, i + w * h * 3)));
  }

  toPpm(): Buffer { return Buffer.concat([Buffer.from(`P6\n${this.w} ${this.h}\n255\n`), this.data]); }

  rect(x0: number, y0: number, w: number, h: number, rgb: [number, number, number]): void {
    const x1 = Math.min(this.w, x0 + w), y1 = Math.min(this.h, y0 + h);
    for (let y = Math.max(0, y0); y < y1; y++) {
      for (let x = Math.max(0, x0); x < x1; x++) { const o = (y * this.w + x) * 3; this.data[o] = rgb[0]; this.data[o + 1] = rgb[1]; this.data[o + 2] = rgb[2]; }
    }
  }

  paste(other: Img, x: number, y: number): void {
    for (let yy = 0; yy < other.h; yy++) {
      if (y + yy < 0 || y + yy >= this.h) continue;
      other.data.copy(this.data, ((y + yy) * this.w + x) * 3, yy * other.w * 3, (yy + 1) * other.w * 3);
    }
  }

  label(text: string, scale: number): void {
    const pad = scale * 2, cw = 6 * scale;
    this.rect(0, 0, text.length * cw + pad * 2 - scale, 7 * scale + pad * 2, [0, 0, 0]);
    [...text].forEach((ch, n) => (FONT[ch] ?? FONT[" "]!).forEach((row, gy) => [...row].forEach((bit, gx) => {
      if (bit === "1") this.rect(pad + n * cw + gx * scale, pad + gy * scale, scale, scale, [255, 255, 255]);
    })));
  }
}

/** The size that fits `longEdge`, even on both sides (encoders want that). */
export function fit(w: number, h: number, longEdge: number): [number, number] {
  let tw = w, th = h;
  if (Math.max(w, h) > longEdge) [tw, th] = w >= h ? [longEdge, Math.round((h * longEdge) / w)] : [Math.round((w * longEdge) / h), longEdge];
  return [Math.max(2, Math.floor(tw / 2) * 2), Math.max(2, Math.floor(th / 2) * 2)];
}

export async function grabFrame(file: string, t: number, duration: number, w: number, h: number, crop?: string): Promise<Img> {
  const at = Math.min(t, Math.max(0, duration - 0.05));
  const { stdout } = await exec("ffmpeg", ["-v", "error", "-ss", at.toFixed(3), "-i", file, "-frames:v", "1", "-an", "-sn",
    "-vf", `${crop ? `${crop},` : ""}scale=${w}:${h}:flags=lanczos`, "-f", "image2pipe", "-c:v", "ppm", "-"], { encoding: "buffer", maxBuffer: 256 << 20 });
  if (!stdout.length) throw new WatchError(`no frame at ${fmt(at)}`);
  return Img.fromPpm(stdout);
}

export function writeJpeg(img: Img, out: string, q = 3): string {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-c:v", "ppm", "-i", "-", "-q:v", String(q), out], { input: img.toPpm() });
  return out;
}

/** A few at a time: enough to keep ffmpeg busy, never a process per frame all at once. */
export async function pool<T, R>(items: readonly T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]!, i); }
  }));
  return out;
}

/** Two decimals when any time needs them (a 4 fps look lands on .25 and .75), one otherwise. */
export const labelPrec = (times: readonly number[]): number => (times.some((t) => Math.abs(t * 10 - Math.round(t * 10)) > 0.01) ? 2 : 1);

export function gridColumns(n: number, portrait: boolean): number {
  return n <= (portrait ? 5 : 3) ? n : portrait && n > 9 ? 5 : n > 9 ? 4 : 3;
}

export interface GridSource { file: string; duration: number; width: number; height: number; long: boolean }

/** Timestamped grids of the given moments, at most 16 to an image. Returns each image with the moments in it. */
export async function makeGrids(v: GridSource, times: readonly number[], outPath: (k: number, of: number) => string, cell?: number, cols?: number): Promise<{ path: string; times: number[]; cols: number }[]> {
  const per = times.length > 9 ? 16 : Math.max(times.length, 1);
  const portrait = v.height > v.width;
  let c0 = cell ?? (per <= 9 ? 480 : 400);
  if (portrait) c0 = Math.round(c0 * 1.2);
  const [cw, ch] = fit(v.width, v.height, c0);
  const scale = Math.max(2, Math.floor(Math.min(cw, ch) / 120));
  const prec = labelPrec(times);
  const chunks: number[][] = [];
  for (let i = 0; i < times.length; i += per) chunks.push(times.slice(i, i + per));
  const out: { path: string; times: number[]; cols: number }[] = [];
  for (const [k, chunk] of chunks.entries()) {
    const c = Math.max(1, Math.min(cols ?? gridColumns(chunk.length, portrait), chunk.length));
    const rows = Math.ceil(chunk.length / c), gap = 4;
    const grid = new Img(c * cw + (c - 1) * gap, rows * ch + (rows - 1) * gap);
    const frames = await pool(chunk, 8, (t) => grabFrame(v.file, t, v.duration, cw, ch));
    frames.forEach((img, i) => {
      img.label(fmt(chunk[i]!, v.long, prec), scale);
      grid.paste(img, (i % c) * (cw + gap), Math.floor(i / c) * (ch + gap));
    });
    out.push({ path: writeJpeg(grid, outPath(k, chunks.length)), times: chunk, cols: c });
  }
  return out;
}

export function legend(chunk: readonly number[], cols: number, long: boolean): string {
  const prec = labelPrec(chunk), rows: string[] = [];
  for (let r = 0; r < chunk.length; r += cols) rows.push(`   ${chunk.slice(r, r + cols).map((t) => fmt(t, long, prec)).join(" | ")}`);
  return rows.join("\n");
}
