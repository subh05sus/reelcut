import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { jitter, mix, onsetIndex, peakIndex, SR, writeWav } from "../src/audio/mixer.js";
import { blurFrames } from "../src/render/blur.js";
import { keystrokeTimes, proposeCues } from "../src/library/sfx.js";
import { loadSfxPack, packAsAssets } from "../src/library/index.js";
import { beatTiming, germanNumber, matchWords, refineEdges, tokens, type VoiceAnalysis, type VoiceWord } from "../src/voice/index.js";

const dir = mkdtempSync(path.join(tmpdir(), "reelcut-mix-"));

/** A WAV of `seconds`, silent except where `f(t)` says. */
function wav(name: string, seconds: number, f: (t: number) => number): string {
  const n = Math.round(seconds * SR);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = f(i / SR);
  const file = path.join(dir, `${name}.wav`);
  writeWav(file, x, x);
  return file;
}
const rms = (x: Float32Array, a: number, b: number) => {
  let s = 0;
  for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, Math.round((b - a) * SR)));
};
const firstAbove = (x: Float32Array, v: number) => x.findIndex((s) => Math.abs(s) > v) / SR;

describe("placing a sound", () => {
  // 100 ms of near silence, then a click: its transient is at 0.1 s into the file.
  const click = wav("click", 0.4, (t) => (t >= 0.1 && t < 0.13 ? 0.8 * Math.sin(2 * Math.PI * 1000 * t) : 0.001));
  // A swell that peaks at 0.6 s and ends at 1 s.
  const whoosh = wav("whoosh", 1, (t) => Math.sin(2 * Math.PI * 300 * t) * Math.exp(-(((t - 0.6) / 0.08) ** 2)));

  it("finds a sound's transient and its loudest moment", () => {
    const x = new Float32Array(SR).map((_, i) => (i > 4800 && i < 4900 ? 1 : 0));
    expect(onsetIndex(x) / SR).toBeCloseTo(0.1 - 0.008, 2);
    const y = new Float32Array(SR).map((_, i) => Math.exp(-(((i / SR - 0.6) / 0.05) ** 2)));
    expect(peakIndex(y) / SR).toBeCloseTo(0.6, 1);
  });

  it("lands a click's transient on its time, a whoosh's peak, and a riser's end", () => {
    const onset = mix({ length: 2, cues: [{ file: click, at: 1, volume: 1 }] });
    expect(firstAbove(onset.left, 0.2)).toBeGreaterThan(0.995);
    expect(firstAbove(onset.left, 0.2)).toBeLessThan(1.012);
    const peak = mix({ length: 2, cues: [{ file: whoosh, at: 1, volume: 1, align: "peak" }] });
    expect(peakIndex(peak.left) / SR).toBeCloseTo(1, 1);
    const end = mix({ length: 2, cues: [{ file: whoosh, at: 1.5, volume: 1, align: "end" }] });
    expect(rms(end.left, 1.5, 2)).toBeLessThan(1e-4);
    expect(rms(end.left, 1.0, 1.2)).toBeGreaterThan(0.05);
  });

  it("pans with constant power and varies a repeat the same way every time", () => {
    const left = mix({ length: 1, cues: [{ file: click, at: 0.2, volume: 1, pan: -1 }] });
    expect(rms(left.right, 0, 1)).toBeLessThan(1e-3);
    expect(rms(left.left, 0, 1)).toBeGreaterThan(0.05);
    expect(jitter(3)).toBe(jitter(3));
    expect(Math.abs(jitter(3) - 1)).toBeLessThanOrEqual(0.05);
    expect(new Set([1, 2, 3, 4, 5].map((i) => jitter(i))).size).toBeGreaterThan(3);
  });
});

describe("ducking under the voice", () => {
  // The voice speaks from 1 to 2 s; the bed and an effect play throughout.
  const voice = wav("voice", 3, (t) => (t >= 1 && t < 2 ? 0.5 * Math.sin(2 * Math.PI * 220 * t) : 0));
  const bed = wav("bed", 3, (t) => 0.2 * Math.sin(2 * Math.PI * 110 * t));
  const tone = wav("tone", 3, (t) => 0.2 * Math.sin(2 * Math.PI * 880 * t));

  it("dips effects about 7 dB and music about 9 dB while the voice speaks, and comes back after", () => {
    const r = mix({ length: 3, cues: [{ file: tone, at: 0, volume: 1, align: "raw" }], bed: { file: bed, offset: 0, at: 0, length: 3, volume: 1, fadeOut: 0 }, voice: { file: voice } });
    const db = (a: number, b: number) => 20 * Math.log10(a / b);
    const fx = r.parts.fx[0], music = r.parts.bed![0];
    expect(db(rms(fx, 1.4, 1.8), rms(fx, 0.3, 0.7))).toBeCloseTo(-7, 0);
    expect(db(rms(music, 1.4, 1.8), rms(music, 0.3, 0.7))).toBeCloseTo(-9, 0);
    expect(db(rms(music, 2.7, 2.95), rms(music, 0.3, 0.7))).toBeGreaterThan(-1);
  });
});

describe("the voiceover sets the timing", () => {
  it("reads numbers and percentages as they are spoken", () => {
    expect(germanNumber(21)).toBe("einundzwanzig");
    expect(germanNumber(30)).toBe("dreißig");
    expect(germanNumber(100)).toBe("hundert");
    expect(germanNumber(1999)).toBe("tausendneunhundertneunundneunzig");
    expect(tokens("20%")).toEqual(["zwanzig", "prozent"]);
    expect(tokens("Higgs-Field")).toEqual(["higgs", "field"]);
  });

  it("matches a misheard, split and spelled-out transcript to the script", () => {
    const beats = [{ id: "a", text: "Videos in Claude und ChatGPT." }, { id: "b", text: "Über 30 Modelle mit Higgsfield." }];
    const heard = [["Videos", 0, 0.4], ["in", 0.45, 0.5], ["Cloude", 0.55, 0.9], ["und", 0.9, 1], ["Chat", 1.05, 1.3], ["GPT", 1.3, 1.6], ["Über", 2, 2.2], ["dreißig", 2.2, 2.6], ["Modelle", 2.6, 3], ["mit", 3.1, 3.2], ["Higgs-Field", 3.2, 3.9]].map(([text, start, end]) => ({ text: text as string, start: start as number, end: end as number }));
    const { words, matched } = matchWords(beats, heard);
    expect(matched).toBe(1);
    const at = (w: string) => words.find((x) => x.w.replace(/\W/g, "") === w)!;
    expect(at("Claude").start).toBe(0.55);
    expect([at("ChatGPT").start, at("ChatGPT").end]).toEqual([1.05, 1.6]);
    expect(at("30").start).toBe(2.2);
    expect(at("Higgsfield").beat).toBe("b");
  });

  it("puts a word's edges on the voice, not on the transcriber's guess", () => {
    // Voice from 0.10 to 0.50 and from 0.80 to 1.20; the transcriber ran the first word into the pause.
    const rmsArr = Array.from({ length: 140 }, (_, f) => ((f >= 10 && f < 50) || (f >= 80 && f < 120) ? 0.5 : 0));
    const words: VoiceWord[] = [{ w: "eins", start: 0.1, end: 0.78, beat: "a", heard: true }, { w: "zwei", start: 0.78, end: 1.3, beat: "b", heard: true }];
    refineEdges(words, rmsArr, 100);
    expect(words[0]!.end).toBeCloseTo(0.5, 2);
    expect(words[1]!.start).toBeCloseTo(0.8, 2);
    expect(words[1]!.end).toBeCloseTo(1.2, 2);
  });

  it("cuts in the pause before each line: 45% of the pause ahead of the word, 0.04 to 0.18 s", () => {
    const v = { durationSeconds: 6, words: [
      { w: "a", start: 0.2, end: 1, beat: "x", heard: true },
      { w: "b", start: 2, end: 3, beat: "y", heard: true },
      { w: "c", start: 3.05, end: 4, beat: "z", heard: true },
    ] } as unknown as VoiceAnalysis;
    const t = beatTiming([{ id: "x", text: "a" }, { id: "y", text: "b" }, { id: "z", text: "c" }], v);
    expect(t[0]!.start).toBe(0);
    expect(t[1]!.start).toBeCloseTo(2 - 0.18, 3); // a long pause: the most lead
    expect(t[2]!.start).toBeCloseTo(3.01, 3); // a 50 ms pause: the least lead, and still after the last word ends
    expect(t[2]!.end).toBeCloseTo(4.7, 3);
    expect(t.reduce((s, b) => s + b.durationSeconds, 0)).toBeCloseTo(t[2]!.end, 6);
  });
});

describe("typing as keystrokes", () => {
  it("strikes about once per 2.6 letters, inside each word, in order, the same every time", () => {
    const times = keystrokeTimes("Mit Higgsfield", 1.4);
    expect(times.length).toBe(1 + 4);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(times.every((t) => t >= 0 && t <= 1.4)).toBe(true);
    expect(keystrokeTimes("Mit Higgsfield", 1.4)).toEqual(times);
  });

  it("proposes one short key sound per strike, varied, instead of a typing loop", () => {
    const pack = loadSfxPack()!;
    const cues = proposeCues([{ id: "b", durationSeconds: 4, events: [{ type: "type", at: 0.5, duration: 1.2, text: "Higgsfield ist da" }] }], packAsAssets(pack), { seed: "r" });
    expect(cues.length).toBeGreaterThan(4);
    expect(cues.every((c) => c.event === "keystroke" && /^pack:(key|typewriter)-/.test(c.source))).toBe(true);
    expect(new Set(cues.map((c) => c.source)).size).toBeGreaterThan(3);
    expect(cues.some((c) => c.pan !== undefined && c.pan !== 0)).toBe(true);
    const once = proposeCues([{ id: "b", durationSeconds: 4, events: [{ type: "type", at: 0.5, duration: 1.2, text: "x" }] }], packAsAssets(pack), { keystrokes: false });
    expect(once[0]!.event).toBe("type");
  });
});

describe("motion blur", () => {
  it("opens the shutter for half of each frame's sub-frames", () => {
    expect(blurFrames(4)).toBe(2);
    expect(blurFrames(8, 0.5)).toBe(4);
    expect(blurFrames(2, 0.1)).toBe(1);
  });

  it("averages sub-frames down to the frame rate, frame count exact", () => {
    const src = path.join(dir, "fast.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=64x64:r=120:d=1", "-pix_fmt", "yuv420p", src]);
    return import("../src/render/blur.js").then(({ applyMotionBlur }) => {
      const out = path.join(dir, "blurred.mp4");
      applyMotionBlur(src, out, { fps: 30, samples: 4 });
      const n = execFileSync("ffprobe", ["-v", "error", "-count_packets", "-show_entries", "stream=nb_read_packets,r_frame_rate", "-of", "csv=p=0", out], { encoding: "utf8" }).trim();
      expect(n).toBe("30/1,30");
    });
  });
});
