import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let home: string;
const reel = (name: string, secs: number, extra: object = {}) => {
  const dir = path.join(home, name); mkdirSync(dir, { recursive: true });
  const p = path.join(dir, "reel.json");
  writeFileSync(p, JSON.stringify({ format: "9:16", beats: [{ id: "beat-00", durationSeconds: secs, style: "swiss" }], ...extra }));
  return p;
};
beforeEach(() => { home = mkdtempSync(path.join(os.tmpdir(), "rc-perf-")); process.env.REELCUT_HOME = home; });
afterEach(() => { delete process.env.REELCUT_HOME; rmSync(home, { recursive: true, force: true }); });

describe("performance", () => {
  it("keeps only the numbers given, rates as fractions, the latest per platform", async () => {
    const { addPerformance, readPerformance, latest } = await import("../src/create/performance.js");
    const p = reel("a", 20);
    const e = addPerformance(p, { platform: "instagram", views: "1200" as never, retention3s: 64, completionRate: 0.2, likes: "" as never, shares: -3, capturedAt: "2026-10-01" });
    expect(e).toMatchObject({ platform: "instagram", views: 1200, retention3s: 0.64, completionRate: 0.2, source: "typed" });
    expect(e).not.toHaveProperty("likes");
    expect(e).not.toHaveProperty("shares");
    addPerformance(p, { platform: "instagram", views: 3000, capturedAt: "2026-10-05" });
    addPerformance(p, { platform: "myspace", views: 5 });
    expect(readPerformance(p)).toHaveLength(3);
    expect(latest(readPerformance(p)).map((x) => [x.platform, x.views])).toEqual([["instagram", 3000], ["other", 5]]);
  });
  it("compares groups of reels by how much of them was watched", async () => {
    const { insights, holdOf } = await import("../src/create/performance.js");
    expect(holdOf({ platform: "tiktok", capturedAt: "", source: "typed", avgWatchSeconds: 10 }, 20)).toBe(0.5);
    const row = (secs: number, watched: number, views: number) => ({ conversation: "", title: "", reel: "", facts: { seconds: secs, beats: 1, format: "9:16", voiced: false, music: false, sfx: false, hook: "", lengthBand: secs <= 20 ? "up to 20 s" : "41–70 s" }, latest: [{ platform: "instagram" as const, capturedAt: "", source: "typed" as const, avgWatchSeconds: watched, views }] });
    const found = insights([row(15, 12, 900), row(18, 13, 1100), row(60, 15, 400), row(55, 11, 300)]);
    const short = found.find((i) => i.by === "length" && i.value === "up to 20 s")!;
    expect(short.reels).toBe(2);
    expect(short.hold).toBeGreaterThan(short.versus.hold);
    expect(short.views).toBe(1000);
    expect(found.some((i) => i.by === "format")).toBe(false);
  });
  it("describes a reel by what results are compared on", async () => {
    const { reelFacts } = await import("../src/create/performance.js");
    const f = reelFacts(reel("b", 33, { voiceover: { file: "vo.wav" }, direction: { text: "minimal" } }), { recipe: "tutorial" });
    expect(f).toMatchObject({ seconds: 33, format: "9:16", style: "swiss", recipe: "tutorial", voiced: true, music: false, text: "minimal", lengthBand: "21–40 s" });
  });
  it("asks Claude to record only what the file shows, and to propose rules for approval", async () => {
    const { importPrompt, analysisPrompt } = await import("../src/create/performance.js");
    const p = reel("c", 20);
    const ip = importPrompt(p, [{ name: "shot.png", path: "/x/shot.png" }], "any");
    expect(ip).toContain("npm run performance -- add");
    expect(ip).toContain("leave a flag out rather than estimate it");
    const ap = analysisPrompt([], []);
    expect(ap).toContain("AskUserQuestion (multiSelect)");
    expect(ap).toContain("npm run learnings -- add");
    expect(ap).toContain("never claim a cause");
  });
});
