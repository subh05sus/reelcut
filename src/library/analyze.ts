import { execFile, execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import path from "node:path";
import { normaliseTags, type Analysis, type MediaType } from "./schema.js";

/**
 * The deterministic pass: what a file is and what can be measured about it, without understanding it.
 *
 * Nothing here is a model. It reads the file's own bytes (never trusting the extension), asks
 * `ffprobe` for the size or duration, makes a small preview with `ffmpeg`, takes the dominant
 * colours from that preview, measures a sound's level and shape, and turns the file and folder
 * names into words. Every tag it produces is marked `auto` by the caller, and an asset with only
 * `auto` tags is never applied without a person approving it — so a wrong guess here costs a
 * click in the Review tab, never a wrong logo in a reel.
 *
 * Anything that needs to *look* at an image (is this the real Claude mark, or a screenshot of it)
 * is left for the queue Claude works through, which is why this does not try.
 */

export interface Sniffed {
  mediaType: MediaType;
  /** The extension the bytes call for, which is what the blob is stored under. */
  ext: string;
  mime: string;
}

const ascii = (b: Buffer, from: number, to: number): string => b.subarray(from, to).toString("latin1");

/** Decide what a file is from its first bytes. `undefined` means "not something reelcut uses". */
export function sniffBytes(head: Buffer): Sniffed | undefined {
  if (head.length >= 8 && head[0] === 0x89 && ascii(head, 1, 4) === "PNG") return { mediaType: "image", ext: "png", mime: "image/png" };
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { mediaType: "image", ext: "jpg", mime: "image/jpeg" };
  if (ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a") return { mediaType: "image", ext: "gif", mime: "image/gif" };
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return { mediaType: "image", ext: "webp", mime: "image/webp" };
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WAVE") return { mediaType: "audio", ext: "wav", mime: "audio/wav" };
  if (ascii(head, 4, 8) === "ftyp") {
    const brand = ascii(head, 8, 12);
    if (brand === "avif" || brand === "avis") return { mediaType: "image", ext: "avif", mime: "image/avif" };
    if (brand === "M4A ") return { mediaType: "audio", ext: "m4a", mime: "audio/mp4" };
    if (brand === "qt  ") return { mediaType: "video", ext: "mov", mime: "video/quicktime" };
    return { mediaType: "video", ext: "mp4", mime: "video/mp4" };
  }
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return { mediaType: "video", ext: "webm", mime: "video/webm" };
  if (ascii(head, 0, 4) === "%PDF") return { mediaType: "document", ext: "pdf", mime: "application/pdf" };
  if (ascii(head, 0, 4) === "OggS") return { mediaType: "audio", ext: "ogg", mime: "audio/ogg" };
  if (ascii(head, 0, 4) === "fLaC") return { mediaType: "audio", ext: "flac", mime: "audio/flac" };
  if (ascii(head, 0, 4) === "FORM" && ascii(head, 8, 12) === "AIFF") return { mediaType: "audio", ext: "aiff", mime: "audio/aiff" };
  if (ascii(head, 0, 3) === "ID3" || (head.length >= 2 && head[0] === 0xff && (head[1]! & 0xe0) === 0xe0 && (head[1]! & 0x06) !== 0)) {
    return { mediaType: "audio", ext: "mp3", mime: "audio/mpeg" };
  }
  // SVG is text: a prolog or comment, then an <svg element near the top.
  const text = head.toString("utf8").replace(/^﻿/, "").trimStart();
  if (/^(<\?xml|<!--|<!doctype svg|<svg)/i.test(text) && /<svg[\s>]/i.test(text)) return { mediaType: "vector", ext: "svg", mime: "image/svg+xml" };
  return undefined;
}

/** Read the start of a file; enough to sniff, and for an SVG enough to find the root element. */
export function sniffFile(file: string): Sniffed | undefined {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(4096);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return sniffBytes(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
}

/** Width and height of a PNG, GIF or JPEG from its header — a fallback when ffprobe is not there. */
export function imageSize(file: string): { width: number; height: number } | undefined {
  const buf = readFileSync(file);
  if (buf.length > 24 && buf[0] === 0x89 && ascii(buf, 1, 4) === "PNG") return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length > 10 && ascii(buf, 0, 3) === "GIF") return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return undefined;
      const marker = buf[i + 1]!;
      const length = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + length;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------- words

const STOP = new Set([
  "final", "copy", "new", "old", "untitled", "img", "image", "images", "screenshot", "screen", "shot", "export", "exported", "file", "files", "asset", "assets",
  "the", "and", "for", "with", "from", "version", "draft", "edit", "edited", "output", "download", "downloads", "desktop", "documents", "pictures", "tmp", "temp",
  "dsc", "mov", "mp4", "png", "jpg", "jpeg", "svg", "gif", "webp", "wav", "mp3", "ogg", "pdf", "web", "app", "scaled", "resized", "small", "large", "medium",
]);

/** The words in a file or folder name: camelCase split, numbers and filler dropped. */
export function wordsFrom(name: string, limit = 6): string[] {
  const spaced = name
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .toLowerCase();
  const out: string[] = [];
  for (const word of spaced.split(" ")) {
    if (word.length < 2 || word.length > 24) continue;
    if (/^\d+$/.test(word) || /^v\d+$/.test(word) || /^\d+x\d+$/.test(word)) continue;
    if (!/[a-z]/.test(word) || STOP.has(word)) continue;
    if (!out.includes(word)) out.push(word);
    if (out.length >= limit) break;
  }
  return out;
}

/** A readable name from a file name: `claude-logo_v2.svg` becomes `claude logo v2`. */
export function nameFromFile(file: string): string {
  return path.basename(file, path.extname(file)).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "untitled";
}

// ---------------------------------------------------------------- colour

export function colourName(r: number, g: number, b: number): string {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2, d = max - min;
  if (l < 0.12) return "black";
  if (l > 0.92) return "white";
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.14) return "grey";
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  if (h < 15 || h >= 345) return "red";
  if (h < 40) return l < 0.36 ? "brown" : "orange";
  if (h < 65) return l < 0.34 ? "brown" : "yellow";
  if (h < 165) return "green";
  if (h < 195) return "teal";
  if (h < 255) return "blue";
  if (h < 290) return "purple";
  return "pink";
}

const hex = (n: number): string => n.toString(16).padStart(2, "0");

/** The most common colours in raw RGBA pixels, ignoring anything mostly transparent. */
export function dominantFromRgba(pixels: Buffer, top = 3): { colors: string[]; names: string[] } {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  let counted = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3]! < 40) continue;
    const r = pixels[i]!, g = pixels[i + 1]!, b = pixels[i + 2]!;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const cur = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    cur.n += 1; cur.r += r; cur.g += g; cur.b += b;
    buckets.set(key, cur);
    counted += 1;
  }
  if (counted === 0) return { colors: [], names: [] };
  const ranked = [...buckets.values()].sort((a, b) => b.n - a.n);
  const colors: string[] = [];
  const names: string[] = [];
  for (const bucket of ranked) {
    const r = Math.round(bucket.r / bucket.n), g = Math.round(bucket.g / bucket.n), b = Math.round(bucket.b / bucket.n);
    const name = colourName(r, g, b);
    // One entry per colour family, and only a family that holds a real share of the picture.
    if (names.includes(name) || bucket.n / counted < 0.1) continue;
    colors.push(`#${hex(r)}${hex(g)}${hex(b)}`);
    names.push(name);
    if (colors.length >= top) break;
  }
  return { colors, names };
}

// ---------------------------------------------------------------- audio

export const TARGET_LUFS = -18;

export interface SoundShape {
  durationSeconds: number;
  peakDb: number;
  /** Approximate integrated loudness: RMS over the audible part, in dB. Close enough to place a sound in a mix. */
  lufs: number;
  descriptors: string[];
  /** Low-confidence cue words. A person confirms them in the Review tab. */
  tags: string[];
}

const db = (x: number): number => (x <= 1e-9 ? -120 : 20 * Math.log10(x));

/**
 * Describe a sound from its samples: how loud, how long, and what its envelope does.
 *
 * The shape words are what separate a click from a whoosh from a riser, which is all a cue needs.
 * They are guesses from a few measured numbers — attack time, where the peak falls, how fast it
 * decays, how noisy it is (zero crossings) — and are tagged as guesses by whoever stores them.
 */
export function describeAudio(samples: Float32Array, sampleRate: number): SoundShape {
  const n = samples.length;
  const durationSeconds = n / sampleRate;
  let peak = 0;
  let crossings = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(samples[i]!);
    if (a > peak) peak = a;
    if (i > 0 && (samples[i]! >= 0) !== (samples[i - 1]! >= 0)) crossings += 1;
  }
  const zcr = n > 1 ? crossings / (n - 1) : 0;

  // RMS envelope in 10 ms windows.
  const win = Math.max(1, Math.round(sampleRate * 0.01));
  const env: number[] = [];
  for (let i = 0; i < n; i += win) {
    let sum = 0;
    const end = Math.min(n, i + win);
    for (let j = i; j < end; j++) sum += samples[j]! * samples[j]!;
    env.push(Math.sqrt(sum / (end - i)));
  }
  const envMax = Math.max(...env, 1e-9);
  const audible = env.filter((e) => e > envMax * 0.01);
  const meanSquare = audible.length ? audible.reduce((a, e) => a + e * e, 0) / audible.length : 0;
  const lufs = db(Math.sqrt(meanSquare)) - 0.7;

  const first = (pred: (e: number) => boolean): number => {
    const k = env.findIndex(pred);
    return k < 0 ? env.length : k;
  };
  const attackAt = first((e) => e >= envMax * 0.9) * 0.01;
  const peakAt = env.indexOf(envMax) * 0.01;
  const afterPeak = env.slice(env.indexOf(envMax));
  const decayEnd = afterPeak.findIndex((e) => e <= envMax * 0.1);
  const decay = (decayEnd < 0 ? afterPeak.length : decayEnd) * 0.01;
  const early = env[Math.max(0, Math.floor(env.length * 0.25))] ?? 0;

  const descriptors: string[] = [];
  const tags: string[] = [];
  const transient = attackAt < 0.025;
  const bright = zcr > 0.22;
  const dark = zcr < 0.08;
  if (durationSeconds < 0.6) descriptors.push("short");
  else if (durationSeconds > 3) descriptors.push("long");
  if (transient) descriptors.push("transient");
  if (bright) descriptors.push("bright");
  if (dark) descriptors.push("dark");
  const rising = peakAt > durationSeconds * 0.65 && early < envMax * 0.4 && durationSeconds > 0.5;
  const swell = !transient && peakAt > durationSeconds * 0.25 && peakAt < durationSeconds * 0.7 && attackAt >= durationSeconds * 0.12;
  if (rising) descriptors.push("rising");
  if (swell) descriptors.push("swell");
  if (transient && decay > 0.2) descriptors.push("decaying");

  if (transient && durationSeconds < 0.12) tags.push("tick");
  if (transient && durationSeconds < 0.25 && !dark) tags.push("click");
  if (transient && durationSeconds >= 0.05 && durationSeconds < 0.6 && !bright) tags.push("pop");
  if (transient && decay >= 0.25 && durationSeconds >= 0.4 && durationSeconds <= 3.5 && dark) tags.push("hit");
  if (swell && durationSeconds >= 0.3 && durationSeconds <= 2.8 && !dark) tags.push("whoosh");
  if (rising && durationSeconds >= 0.8) tags.push("riser");
  if (durationSeconds > 3 && envMax > 0 && (audible.length ? Math.min(...audible) / envMax : 0) > 0.3) tags.push("ambience");

  return { durationSeconds, peakDb: db(peak), lufs, descriptors, tags };
}

/** The gain, in dB, that brings a sound to the target loudness without its peak passing -1 dBFS. */
export function gainFor(shape: Pick<SoundShape, "peakDb" | "lufs">): number {
  const toTarget = TARGET_LUFS - shape.lufs;
  const headroom = -1 - shape.peakDb;
  return Math.round(Math.max(-18, Math.min(12, toTarget, headroom)) * 10) / 10;
}

// ---------------------------------------------------------------- ffmpeg

let ffmpegChecked: boolean | undefined;
export function hasFfmpeg(): boolean {
  if (ffmpegChecked === undefined) {
    try {
      execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
      execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
      ffmpegChecked = true;
    } catch {
      ffmpegChecked = false;
    }
  }
  return ffmpegChecked;
}

function run(cmd: string, args: string[], timeoutMs: number, asBuffer = false): Promise<{ stdout: string | Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: asBuffer ? "buffer" : "utf8", windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(error);
      resolve({ stdout, stderr: String(stderr) });
    });
  });
}

interface Probe {
  width?: number;
  height?: number;
  durationSeconds?: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

export async function probeMedia(file: string): Promise<Probe> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", file], 30_000);
  const data = JSON.parse(String(stdout)) as { streams?: { codec_type?: string; width?: number; height?: number }[]; format?: { duration?: string } };
  const video = data.streams?.find((s) => s.codec_type === "video");
  const duration = Number(data.format?.duration);
  return {
    hasVideo: Boolean(video),
    hasAudio: Boolean(data.streams?.some((s) => s.codec_type === "audio")),
    ...(video?.width ? { width: video.width, height: video.height } : {}),
    ...(Number.isFinite(duration) && duration > 0 ? { durationSeconds: duration } : {}),
  };
}

async function writeThumb(file: string, mediaType: MediaType, out: string, durationSeconds: number | undefined): Promise<boolean> {
  mkdirSync(path.dirname(out), { recursive: true });
  try {
    if (mediaType === "audio") {
      await run("ffmpeg", ["-v", "error", "-y", "-t", "30", "-i", file, "-filter_complex", "aformat=channel_layouts=mono,showwavespic=s=480x160:colors=0x8b7bff", "-frames:v", "1", out], 60_000);
    } else if (mediaType === "video") {
      const at = durationSeconds ? Math.min(1, durationSeconds / 2) : 0;
      await run("ffmpeg", ["-v", "error", "-y", "-ss", String(at), "-i", file, "-vf", "scale=480:480:force_original_aspect_ratio=decrease", "-frames:v", "1", out], 60_000);
    } else if (mediaType === "image") {
      await run("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", "scale=480:480:force_original_aspect_ratio=decrease", "-frames:v", "1", out], 60_000);
    } else {
      return false;
    }
    return statSync(out).size > 0;
  } catch {
    return false;
  }
}

async function colorsOf(preview: string): Promise<{ colors: string[]; names: string[] }> {
  try {
    const { stdout } = await run("ffmpeg", ["-v", "error", "-i", preview, "-vf", "scale=24:24:flags=area,format=rgba", "-f", "rawvideo", "-pix_fmt", "rgba", "-"], 30_000, true);
    return dominantFromRgba(stdout as Buffer);
  } catch {
    return { colors: [], names: [] };
  }
}

async function decodeMono(file: string): Promise<Float32Array | undefined> {
  try {
    const { stdout } = await run("ffmpeg", ["-v", "error", "-t", "15", "-i", file, "-ac", "1", "-ar", "8000", "-f", "f32le", "-"], 60_000, true);
    const buf = stdout as Buffer;
    const copy = new Uint8Array(buf.length - (buf.length % 4));
    copy.set(buf.subarray(0, copy.length));
    return new Float32Array(copy.buffer);
  } catch {
    return undefined;
  }
}

/** Title, description, text and size of an SVG, and whether it carries a script. */
export function svgInfo(file: string): { width?: number; height?: number; words: string[]; text: string; hasScript: boolean } {
  const text = readFileSync(file, "utf8").slice(0, 256 * 1024);
  const pick = (re: RegExp): string[] => [...text.matchAll(re)].map((m) => m[1]!.replace(/<[^>]+>/g, " ").trim()).filter(Boolean);
  const content = [...pick(/<title[^>]*>([\s\S]*?)<\/title>/gi), ...pick(/<desc[^>]*>([\s\S]*?)<\/desc>/gi), ...pick(/<text[^>]*>([\s\S]*?)<\/text>/gi)].join(" ").slice(0, 300);
  const box = /viewBox\s*=\s*["']\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(text);
  return {
    ...(box ? { width: Number(box[1]), height: Number(box[2]) } : {}),
    words: wordsFrom(content, 6),
    text: content,
    hasScript: /<script[\s>]|\son[a-z]+\s*=/i.test(text),
  };
}

// ---------------------------------------------------------------- the pass

export interface AnalyzeOptions {
  /** Path of the file's folder relative to its watched root, for the words in it. */
  relPath?: string;
  /** Where to write the preview. Without it no preview is made. */
  thumbOut?: string;
  /** Auto-tags a person has rejected twice or more; never suggested again. */
  suppress?: ReadonlySet<string>;
  /** A name to use instead of the file's. Uploads carry the browser's file name. */
  name?: string;
}

export interface AnalysisResult {
  mediaType: MediaType;
  ext: string;
  mime: string;
  name: string;
  analysis: Analysis;
  /** Words from the name, the folder, the colours and the sound's shape. All are guesses. */
  autoTags: string[];
  /** `thumbOut`, when a preview was written. */
  thumb?: string;
  notes: string[];
}

export async function analyzeFile(file: string, options: AnalyzeOptions = {}): Promise<AnalysisResult | { skipped: string }> {
  const sniffed = sniffFile(file);
  if (!sniffed) return { skipped: "not a type reelcut uses (image, SVG, video, audio or PDF)" };

  const notes: string[] = [];
  let { mediaType } = sniffed;
  const analysis: Analysis = { dominantColors: [], descriptors: [] };
  const tags: string[] = [];
  const ffmpeg = hasFfmpeg();
  if (!ffmpeg && mediaType !== "vector" && mediaType !== "document") notes.push("ffmpeg is not installed: no preview, size or colours were measured");

  if (mediaType === "vector") {
    const info = svgInfo(file);
    if (info.width) { analysis.width = info.width; analysis.height = info.height ?? info.width; }
    if (info.text) analysis.text = info.text;
    tags.push(...info.words);
    if (info.hasScript) notes.push("contains a script: it is only ever served sandboxed");
  } else if (ffmpeg && mediaType !== "document") {
    try {
      const probe = await probeMedia(file);
      if (mediaType === "video" && !probe.hasVideo && probe.hasAudio) mediaType = "audio";
      if (probe.width) { analysis.width = probe.width; analysis.height = probe.height ?? probe.width; }
      if (probe.durationSeconds) analysis.durationSeconds = probe.durationSeconds;
    } catch {
      notes.push("ffprobe could not read the file");
    }
  } else if (mediaType === "image") {
    const size = imageSize(file);
    if (size) { analysis.width = size.width; analysis.height = size.height; }
  }

  let thumb: string | undefined;
  if (options.thumbOut && ffmpeg && (await writeThumb(file, mediaType, options.thumbOut, analysis.durationSeconds))) thumb = options.thumbOut;
  if (thumb && (mediaType === "image" || mediaType === "video")) {
    const colours = await colorsOf(thumb);
    analysis.dominantColors = colours.colors;
    tags.push(...colours.names.slice(0, 2));
  }

  if (mediaType === "audio" && ffmpeg) {
    const samples = await decodeMono(file);
    if (samples && samples.length > 80) {
      const shape = describeAudio(samples, 8000);
      analysis.peakDb = Math.round(shape.peakDb * 10) / 10;
      analysis.lufs = Math.round(shape.lufs * 10) / 10;
      analysis.gainDb = gainFor(shape);
      analysis.descriptors = shape.descriptors;
      if (!analysis.durationSeconds) analysis.durationSeconds = shape.durationSeconds;
      tags.push(...shape.tags);
    }
    tags.push("sfx");
  }

  const name = options.name ? nameFromFile(options.name) : nameFromFile(file);
  tags.push(...wordsFrom(options.name ?? path.basename(file)));
  if (options.relPath) tags.push(...wordsFrom(path.dirname(options.relPath).split(/[\\/]/).slice(-2).join(" "), 3));
  const suppress = options.suppress ?? new Set<string>();
  const autoTags = normaliseTags(tags).filter((t) => !suppress.has(t)).slice(0, 14);

  return { mediaType, ext: sniffed.ext, mime: sniffed.mime, name, analysis, autoTags, ...(thumb ? { thumb } : {}), notes };
}
