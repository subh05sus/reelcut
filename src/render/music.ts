import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { analyzeMusic, type MusicAnalysis, type MusicPlan, type MusicSync } from "../library/music.js";
import type { LibraryAsset } from "../library/schema.js";

/**
 * The music bed in a render: which track, where it starts, how loud, and the mix.
 *
 * The bed goes under the **master** only. Clips stay without it, since they are cut into an edit where the music
 * runs across them. It is also written alone as `music-bed.m4a`, trimmed and faded exactly as in the master, so an
 * editor can lay a voiceover over the same bed.
 */

export interface MusicSpec {
  /** `library:<id>` or a path relative to reel.json. */
  source: string;
  /** fit: the cut stays and the track is placed; snap: the cuts move onto beats (at most 0.15 s). */
  sync?: MusicSync;
  /** 0..2, on top of the loudness match. Default 1. */
  volume?: number;
  /** Start the track here instead of choosing (seconds into the track). */
  start?: number;
}

export interface ResolvedMusic {
  file: string;
  name: string;
  analysis: MusicAnalysis;
  /** Integrated loudness, when the library measured it. */
  lufs?: number;
  asset?: LibraryAsset;
}

/** The bed sits at about -16 LUFS: full but leaves room for effects, and for a voice laid on later. */
export const BED_LUFS = -16;
const FADE_OUT = 1.5;

export function resolveMusic(spec: MusicSpec, base: string, assets: readonly LibraryAsset[], blobPath: (a: LibraryAsset) => string): ResolvedMusic {
  const lib = /^library:([0-9a-f]{16})$/.exec(spec.source);
  if (lib) {
    const asset = assets.find((a) => a.id === lib[1]);
    if (!asset) throw new Error(`music: ${spec.source} is not in the library`);
    if (asset.mediaType !== "audio") throw new Error(`music: ${asset.name} is ${asset.mediaType}, not audio`);
    if (asset.review.state === "rejected") throw new Error(`music: ${asset.name} was rejected`);
    const file = blobPath(asset);
    const analysis = asset.analysis.music ?? analyzeMusic(file);
    return { file, name: asset.name, analysis, asset, ...(asset.analysis.lufs !== undefined ? { lufs: asset.analysis.lufs } : {}) };
  }
  const file = path.resolve(base, spec.source);
  if (!existsSync(file)) throw new Error(`music: no file at ${file}`);
  return { file, name: path.basename(file), analysis: analyzeMusic(file) };
}

/** The gain that brings the track to the bed level, times the reel's own volume. */
export function bedGain(lufs: number | undefined, volume = 1): number {
  const base = lufs === undefined || !Number.isFinite(lufs) ? 0.7 : Math.pow(10, (BED_LUFS - lufs) / 20);
  return Math.round(Math.min(4, base * Math.max(0, Math.min(2, volume))) * 1000) / 1000;
}

/** The ffmpeg chain that turns the track into this reel's bed: trimmed, faded, levelled, stereo 48 kHz. */
function bedChain(input: string, plan: MusicPlan, length: number, gain: number, trackSeconds: number): string {
  const play = Math.min(length, Math.max(0.1, trackSeconds - plan.offset));
  const fadeIn = plan.offset > 0.02 ? 0.25 : 0;
  const outAt = Math.max(0, play - FADE_OUT);
  return `[${input}]atrim=start=${plan.offset}:duration=${play.toFixed(3)},asetpts=N/SR/TB,aresample=48000,aformat=channel_layouts=stereo${fadeIn ? `,afade=t=in:st=0:d=${fadeIn}` : ""},afade=t=out:st=${outAt.toFixed(3)}:d=${Math.min(FADE_OUT, play).toFixed(3)},volume=${gain},apad=whole_dur=${length.toFixed(3)}`;
}

/**
 * Lay the bed under the master, in place: the video stream is copied untouched; the audio is the master's own
 * (sound effects) mixed with the bed, or the bed alone. Also writes the bed by itself next to the master.
 */
export function mixMusic(master: string, music: ResolvedMusic, plan: MusicPlan, length: number, volume?: number): { stem: string; gain: number } {
  const gain = bedGain(music.lufs, volume);
  const hasAudio = execFileSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", master], { encoding: "utf8" }).trim().length > 0;
  const out = master.replace(/\.mp4$/, ".music.mp4");
  const chain = bedChain("1:a", plan, length, gain, music.analysis.durationSeconds);
  const graph = hasAudio
    ? `${chain}[bed];[0:a]aresample=48000,aformat=channel_layouts=stereo[fx];[fx][bed]amix=inputs=2:duration=first:normalize=0,atrim=0:${length.toFixed(3)}[a]`
    : `${chain},atrim=0:${length.toFixed(3)}[a]`;
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", master, "-i", music.file, "-filter_complex", graph, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", out]);
  rmSync(master, { force: true });
  copyFileSync(out, master);
  rmSync(out, { force: true });
  const stem = path.join(path.dirname(master), "music-bed.m4a");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", music.file, "-filter_complex", `${bedChain("0:a", plan, length, gain, music.analysis.durationSeconds)},atrim=0:${length.toFixed(3)}[a]`, "-map", "[a]", "-c:a", "aac", "-b:a", "192k", stem]);
  return { stem, gain };
}
