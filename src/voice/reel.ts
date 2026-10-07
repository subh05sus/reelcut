import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { analyzeVoice, beatTiming, beatVoice, type VoiceAnalysis } from "./index.js";

/** `reel.json` → `"voiceover"`. */
export interface VoiceoverSpec {
  /** The recording: a path next to reel.json, or `library:<id>`. */
  file: string;
  /** What is spoken: `de`, `en`, … (whisper's language code). Default `de`. */
  language?: string;
  /** whisper model: `small` (default), `medium` for a hard recording, `base` to be quick. */
  model?: string;
  /** `voice` (default): the read sets every beat's length. `manifest`: keep the lengths in reel.json. */
  timing?: "voice" | "manifest";
  /** Level of the voice in the mix, linear. Default 1. */
  volume?: number;
}

export interface BeatSpan {
  id: string;
  start: number;
  end: number;
  durationSeconds: number;
}

export interface ReelVoice {
  analysis: VoiceAnalysis;
  spans: BeatSpan[];
  /** Beats whose text the voice never said, as far as the transcript tells. */
  unheard: string[];
}

export const VOICE_FILE = "voice.json";

/**
 * Analyse the reel's voiceover and work out where every beat starts and ends. With `timing: "voice"` (the default)
 * the read sets the cut: every beat needs `text`, the words spoken while it is on screen. Writes voice.json beside
 * reel.json (the words, the loudness, the spans) for the studio, `sfx suggest` and a later render.
 */
export async function voiceForReel(spec: VoiceoverSpec, file: string, beats: readonly { id: string; text?: string; durationSeconds: number }[], base: string): Promise<ReelVoice> {
  const timing = spec.timing ?? "voice";
  const missing = beats.filter((b) => !b.text?.trim()).map((b) => b.id);
  if (timing === "voice" && missing.length > 0) throw new Error(`voiceover: ${missing.join(", ")} ${missing.length === 1 ? "has" : "have"} no "text". With the voice setting the cut, every beat needs the words spoken in it (or set "timing": "manifest")`);
  const vb = beats.map((b) => ({ id: b.id, text: b.text ?? "" }));
  const analysis = await analyzeVoice(file, vb, path.join(base, ".voice"), { ...(spec.language ? { language: spec.language } : {}), ...(spec.model ? { model: spec.model } : {}) });
  let spans: BeatSpan[];
  if (timing === "voice") spans = beatTiming(vb, analysis);
  else {
    let t = 0;
    spans = beats.map((b) => { const s = { id: b.id, start: t, end: t + b.durationSeconds, durationSeconds: b.durationSeconds }; t += b.durationSeconds; return s; });
  }
  const unheard = beats.filter((b) => b.text?.trim() && !analysis.words.some((w) => w.beat === b.id && w.heard)).map((b) => b.id);
  writeFileSync(path.join(base, VOICE_FILE), `${JSON.stringify({ ...analysis, timing, spans }, null, 1)}\n`);
  return { analysis, spans, unheard };
}

/** What a beat's composition gets from voice.json, if the reel has one. */
export function readBeatVoices(base: string): Map<string, ReturnType<typeof beatVoice>> | undefined {
  const file = path.join(base, VOICE_FILE);
  if (!existsSync(file)) return undefined;
  const v = JSON.parse(readFileSync(file, "utf8")) as VoiceAnalysis & { spans: BeatSpan[] };
  return new Map(v.spans.map((s) => [s.id, beatVoice(v, s.id, s.start, s.end)]));
}
