import type { MixBed } from "../audio/mixer.js";
import { existsSync } from "node:fs";
import path from "node:path";
import { analyzeMusic, type MusicAnalysis, type MusicPlan, type MusicSync } from "../library/music.js";
import type { LibraryAsset } from "../library/schema.js";

/**
 * The music bed in a render: which track, where it starts and how loud. The render's mixer lays it under the reel
 * (ducked under a voiceover) and writes it alone as `mix/stem-music.wav`, so an editor has the same bed.
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

/** The bed as the mixer takes it: from where the plan starts the track, levelled, faded in when it starts mid-track. */
export function bedFor(music: ResolvedMusic, plan: MusicPlan, length: number, volume?: number): MixBed {
  const play = Math.min(length, Math.max(0.1, music.analysis.durationSeconds - plan.offset));
  return { file: music.file, offset: plan.offset, at: 0, length: play, volume: bedGain(music.lufs, volume), fadeIn: plan.offset > 0.02 ? 0.25 : 0, fadeOut: Math.min(FADE_OUT, play) };
}
