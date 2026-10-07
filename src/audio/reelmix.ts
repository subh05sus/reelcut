import { mkdirSync, renameSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { mix, normalize, writeWav, type MixInput } from "./mixer.js";

export interface ReelMix {
  /** The finished mix: 48 kHz stereo WAV, as long as the reel. */
  file: string;
  /** Each part alone, at its level in the mix: effects, voice, music. */
  stems: Record<string, string>;
  placed: number;
  /** The mix's loudness before normalising, when it was normalised. */
  inputLufs?: number;
}

/**
 * Mix the whole reel once, before any clip renders: cues, voice and bed are all known by then, so every clip carries
 * its exact slice of the same mix and the master gets the whole of it. A reel with a voice or music is normalised to
 * -14 LUFS (true peak -1.5); effects alone stay at the levels they were given.
 */
export function mixReel(input: MixInput, dir: string): ReelMix {
  mkdirSync(dir, { recursive: true });
  const result = mix(input);
  const raw = path.join(dir, "mix.raw.wav");
  writeWav(raw, result.left, result.right);
  const file = path.join(dir, "mix.wav");
  let inputLufs: number | undefined;
  if (input.voice || input.bed) {
    inputLufs = normalize(raw, file);
    rmSync(raw, { force: true });
  } else renameSync(raw, file);
  const stems: Record<string, string> = {};
  if (input.cues.length > 0) writeWav((stems.effects = path.join(dir, "stem-effects.wav")), ...result.parts.fx);
  if (result.parts.voice) writeWav((stems.voice = path.join(dir, "stem-voice.wav")), result.parts.voice, result.parts.voice);
  if (result.parts.bed) writeWav((stems.music = path.join(dir, "stem-music.wav")), ...result.parts.bed);
  return { file, stems, placed: result.placed, ...(inputLufs !== undefined && Number.isFinite(inputLufs) ? { inputLufs } : {}) };
}

/** Put `[start, start+length)` of the mix under a clip, replacing whatever audio it had. */
export function muxSlice(video: string, mixFile: string, start: number, length: number): void {
  const out = video.replace(/\.mp4$/, ".mixed.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-ss", start.toFixed(6), "-t", length.toFixed(6), "-i", mixFile, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", out]);
  execFileSync("mv", ["-f", out, video]);
}
