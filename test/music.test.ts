import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeMusic, durationsFromCuts, planMusic, type MusicAnalysis } from "../src/library/music.js";
import { hasFfmpeg } from "../src/library/index.js";

/** A synthetic track: a kick (low thump) on every downbeat, a hat on every beat, at `bpm`, for `seconds`. */
function clickTrack(dir: string, bpm: number, seconds: number, startAt = 0): string {
  const file = path.join(dir, `t${bpm}-${startAt}.wav`);
  const beat = 60 / bpm;
  // A short decaying tone per beat; the downbeat is lower and louder.
  const expr = `if(gte(t,${startAt}),` +
    `if(lt(mod(t-${startAt},${beat * 4}),0.12),0.9*sin(2*PI*55*t)*exp(-30*mod(t-${startAt},${beat * 4})),0)` +
    `+if(lt(mod(t-${startAt},${beat}),0.05),0.4*sin(2*PI*5000*t)*exp(-60*mod(t-${startAt},${beat})),0),0)`;
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `aevalsrc='${expr}':s=22050:d=${seconds}`, file]);
  return file;
}

describe.runIf(hasFfmpeg())("finding the beat", () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(path.join(os.tmpdir(), "rc-music-")); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  for (const bpm of [96, 120, 128]) {
    it(`reads ${bpm} BPM and puts the beats where they are`, () => {
      const a = analyzeMusic(clickTrack(dir, bpm, 20));
      expect(Math.abs(a.bpm - bpm)).toBeLessThan(2.5);
      const period = 60 / bpm;
      // Every tracked beat sits within 30 ms of a real one.
      const off = a.beats.map((t) => Math.abs(((t + period / 2) % period) - period / 2));
      expect(Math.max(...off.slice(1, -1))).toBeLessThan(0.03);
      expect(a.beats.length).toBeGreaterThan(Math.floor(20 / period) - 3);
    }, 30_000);
  }

  it("finds the bar line from the low end", () => {
    const a = analyzeMusic(clickTrack(dir, 120, 16));
    const bar = 2; // four beats at 120
    const firstBar = a.beats[a.downbeats[0]!]!;
    expect(Math.abs(((firstBar + bar / 2) % bar) - bar / 2)).toBeLessThan(0.04);
  }, 30_000);

  it("describes it in words for finding it again", () => {
    const a = analyzeMusic(clickTrack(dir, 128, 12));
    expect(a.mood).toContain("upbeat");
    expect(a.confidence).toBeGreaterThan(0.2);
  }, 30_000);
});

/** A perfect grid at 120 BPM: a beat every 0.5 s, a bar every 2 s. */
function grid(seconds = 60): MusicAnalysis {
  const beats = Array.from({ length: seconds * 2 }, (_, i) => i * 0.5);
  return { bpm: 120, confidence: 0.9, beats, downbeats: beats.map((_, i) => i).filter((i) => i % 4 === 0), phrases: [0, 16, 32], durationSeconds: seconds, mood: ["upbeat"] };
}

describe("laying a track under a reel", () => {
  it("fit: keeps the cuts and starts the track where most of them land on beats", () => {
    // Cuts at x.25: the track has to start a quarter-beat in for them to land.
    const cuts = [2.25, 4.75, 7.25, 9.75];
    const plan = planMusic(grid(), cuts, 12, "fit");
    expect(plan.cuts).toEqual(cuts);
    expect(plan.onBeat).toBe(4);
    expect(((plan.offset * 1000) % 500) / 1000).toBeCloseTo(0.25, 2);
  });

  it("snap: moves each cut to the nearest beat, never by more than 0.15 s", () => {
    const cuts = [2.1, 4.38, 7.0, 9.9];
    const plan = planMusic(grid(), cuts, 12, "snap", { start: 0 });
    expect(plan.cuts).toEqual([2.0, 4.5, 7.0, 10.0]);
    expect(plan.moved).toEqual([-0.1, 0.12, 0, 0.1]);
    const far = planMusic(grid(), [2.25], 6, "snap", { start: 0 });
    expect(far.cuts).toEqual([2.25]);
  });

  it("never reorders cuts or squeezes a beat to nothing", () => {
    const plan = planMusic(grid(), [2.1, 2.2], 6, "snap", { start: 0 });
    expect(plan.cuts[1]! - plan.cuts[0]!).toBeGreaterThan(0.05);
  });

  it("says when the track is shorter than the reel", () => {
    expect(planMusic(grid(10), [3], 20, "fit").short).toBe(true);
  });

  it("turns cuts back into beat lengths that add up to the reel", () => {
    const d = durationsFromCuts([2, 4.5, 7], 10);
    expect(d).toEqual([2, 2.5, 2.5, 3]);
    expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(10, 6);
  });
});
