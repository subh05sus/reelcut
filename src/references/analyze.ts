import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { probeMedia, runTool } from "../library/analyze.js";
import { dominantFromRgba } from "../library/analyze.js";
import { frameDelta, inkShare, type GreyFrame } from "../verify/frameMetrics.js";
import { ReferenceAnalysisSchema, type ReferenceAnalysis } from "./schema.js";
import { pacingOf, type Ground } from "./vocab.js";

/**
 * What can be measured about a reference without watching it: how it cuts, how light it is, how much of
 * the frame is type, how much moves, and what colours it is made of. ffmpeg and arithmetic only.
 *
 * Only the first `MAX_MEASURED_SECONDS` are measured: a long upload would otherwise take as long to
 * measure as to watch, and a launch film's character is set in its opening.
 */

export const MAX_MEASURED_SECONDS = 180;
/** A change in picture this large between frames is a cut. */
export const SCENE_THRESHOLD = 0.3;
/** Two cuts closer than this are one: a flash or a dissolve is detected twice. */
export const MIN_SHOT_SECONDS = 0.25;
/** Frames per second sampled for motion, brightness and ink. */
const SAMPLE_FPS = 4;
const SHEET_FRAMES = 24;

export interface AnalyzeReferenceOptions {
  /** Where to write the contact sheet (24 frames). */
  sheetOut?: string;
  /** Where to write one frame, for the grid. */
  thumbOut?: string;
  maxSeconds?: number;
}

export interface ReferenceMeasurement {
  analysis: ReferenceAnalysis;
  sheet?: string;
  thumb?: string;
  notes: string[];
}

/** Hard-cut times from ffmpeg's scene score, with near-duplicates merged. */
export function cutsFromShowinfo(stderr: string, minGap = MIN_SHOT_SECONDS): number[] {
  const times = [...stderr.matchAll(/pts_time:\s*([0-9]+(?:\.[0-9]+)?)/g)].map((m) => Number(m[1])).filter((t) => Number.isFinite(t) && t > 0);
  const out: number[] = [];
  for (const t of times.sort((a, b) => a - b)) {
    if (out.length === 0 || t - out[out.length - 1]! >= minGap) out.push(Math.round(t * 1000) / 1000);
  }
  return out;
}

/** Shot lengths from cut times over a measured stretch. */
export function shotLengths(cuts: readonly number[], measured: number): number[] {
  const edges = [0, ...cuts.filter((c) => c < measured), measured];
  const lengths: number[] = [];
  for (let i = 1; i < edges.length; i++) lengths.push(edges[i]! - edges[i - 1]!);
  return lengths.filter((l) => l > 0);
}

export const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** Light, dark, a saturated brand colour, or mixed — from mean brightness and mean saturation. */
export function groundOf(meanLuma: number, meanSaturation: number): Ground {
  if (meanSaturation > 0.45 && meanLuma >= 70 && meanLuma <= 200) return "brand";
  if (meanLuma >= 150) return "light";
  if (meanLuma <= 90) return "dark";
  return "mixed";
}

const round = (n: number, places = 3): number => Math.round(n * 10 ** places) / 10 ** places;

async function greyFrames(file: string, seconds: number, width: number, height: number): Promise<GreyFrame[]> {
  const { stdout } = await runTool("ffmpeg", ["-v", "error", "-t", String(seconds), "-i", file, "-an", "-vf", `fps=${SAMPLE_FPS},scale=${width}:${height}`, "-pix_fmt", "gray", "-f", "rawvideo", "-"], 300_000, true);
  const buffer = stdout as Buffer;
  const size = width * height;
  const frames: GreyFrame[] = [];
  for (let i = 0; i + size <= buffer.length; i += size) frames.push({ width, height, data: new Uint8Array(buffer.subarray(i, i + size)) });
  return frames;
}

/** Mean brightness and mean saturation of a handful of frames spread across the film, plus its main colours. */
async function palette(file: string, seconds: number): Promise<{ colors: string[]; luma: number; saturation: number }> {
  const rate = (8 / Math.max(seconds, 1)).toFixed(4);
  const { stdout } = await runTool("ffmpeg", ["-v", "error", "-t", String(seconds), "-i", file, "-an", "-vf", `fps=${rate},scale=24:24,format=rgba`, "-f", "rawvideo", "-"], 300_000, true);
  const px = stdout as Buffer;
  let n = 0;
  let luma = 0;
  let sat = 0;
  for (let i = 0; i + 3 < px.length; i += 4) {
    const r = px[i]! / 255, g = px[i + 1]! / 255, b = px[i + 2]! / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    luma += 0.299 * r + 0.587 * g + 0.114 * b;
    sat += max === 0 ? 0 : (max - min) / max;
    n += 1;
  }
  return { colors: dominantFromRgba(px, 4).colors, luma: n ? (luma / n) * 255 : 0, saturation: n ? sat / n : 0 };
}

export async function analyzeReference(file: string, options: AnalyzeReferenceOptions = {}): Promise<ReferenceMeasurement> {
  const notes: string[] = [];
  const probe = await probeMedia(file);
  if (!probe.hasVideo || !probe.width || !probe.height) throw new Error("not a video with a picture");
  const duration = probe.durationSeconds ?? 0;
  if (!(duration > 0)) throw new Error("could not read how long it is");
  const measured = Math.min(duration, options.maxSeconds ?? MAX_MEASURED_SECONDS);
  if (duration > measured) notes.push(`only the first ${Math.round(measured)}s of ${Math.round(duration)}s were measured`);

  // Cuts: the scene score at a small size, which is cheap and does not care what the film is about.
  const scene = await runTool("ffmpeg", ["-v", "info", "-t", String(measured), "-i", file, "-an", "-vf", `scale=320:-2,select='gt(scene,${SCENE_THRESHOLD})',showinfo`, "-f", "null", "-"], 300_000);
  const cutTimes = cutsFromShowinfo(scene.stderr);
  const shots = shotLengths(cutTimes, measured);
  const medianShot = median(shots);

  // Frames at a quarter-second for brightness, ink and how much moves.
  const long = 160;
  const scale = long / Math.max(probe.width, probe.height);
  const width = Math.max(2, Math.round((probe.width * scale) / 2) * 2);
  const height = Math.max(2, Math.round((probe.height * scale) / 2) * 2);
  const frames = await greyFrames(file, measured, width, height);
  let ink = 0;
  let delta = 0;
  frames.forEach((f, i) => {
    ink += inkShare(f);
    if (i > 0) delta += frameDelta(frames[i - 1]!, f) / 255;
  });
  const motionEnergy = frames.length > 1 ? delta / (frames.length - 1) : 0;
  const textShare = frames.length ? ink / frames.length : 0;

  const colours = await palette(file, measured);

  let sheet: string | undefined;
  if (options.sheetOut) {
    try {
      mkdirSync(path.dirname(options.sheetOut), { recursive: true });
      await runTool("ffmpeg", ["-v", "error", "-y", "-t", String(measured), "-i", file, "-an", "-vf", `fps=${(SHEET_FRAMES / measured).toFixed(5)},scale=320:-2,tile=6x4`, "-frames:v", "1", options.sheetOut], 300_000);
      if (statSync(options.sheetOut).size > 0) sheet = options.sheetOut;
    } catch {
      notes.push("no contact sheet could be made");
    }
  }
  let thumb: string | undefined;
  if (options.thumbOut) {
    try {
      mkdirSync(path.dirname(options.thumbOut), { recursive: true });
      await runTool("ffmpeg", ["-v", "error", "-y", "-ss", (measured / 3).toFixed(2), "-i", file, "-vf", "scale=480:-2", "-frames:v", "1", options.thumbOut], 120_000);
      if (statSync(options.thumbOut).size > 0) thumb = options.thumbOut;
    } catch {
      notes.push("no thumbnail could be made");
    }
  }

  const analysis = ReferenceAnalysisSchema.parse({
    durationSeconds: round(duration, 2),
    width: probe.width,
    height: probe.height,
    ...(probe.fps ? { fps: probe.fps } : {}),
    measuredSeconds: round(measured, 2),
    cutTimes: cutTimes.slice(0, 500),
    shots: shots.length,
    medianShotSeconds: round(medianShot, 2),
    meanShotSeconds: round(shots.reduce((a, b) => a + b, 0) / Math.max(1, shots.length), 2),
    cutsPerMinute: round((cutTimes.length / measured) * 60, 1),
    motionEnergy: round(Math.min(1, motionEnergy), 4),
    meanLuma: round(colours.luma || frames.reduce((a, f) => a + f.data.reduce((x, y) => x + y, 0) / f.data.length, 0) / Math.max(1, frames.length), 1),
    ground: groundOf(colours.luma, colours.saturation),
    pacing: pacingOf(medianShot),
    dominantColors: colours.colors,
    textShare: round(Math.min(1, textShare), 4),
  });
  return { analysis, ...(sheet ? { sheet } : {}), ...(thumb ? { thumb } : {}), notes };
}
