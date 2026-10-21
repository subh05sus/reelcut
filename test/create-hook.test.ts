import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let home: string, dir: string, reelPath: string;
const ffmpeg = (args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
/** A clip like the render's: a colour, a moving box, 30 fps, with a tone so the master has sound. */
const clip = (file: string, frames: number, color: string, hz = 440) => ffmpeg([
  "-f", "lavfi", "-i", `color=c=${color}:s=270x480:r=30:d=${frames / 30}[bg];color=c=white:s=60x60:r=30:d=${frames / 30}[fg];[bg][fg]overlay=x='t*200':y=200`,
  "-f", "lavfi", "-i", `sine=frequency=${hz}:duration=${frames / 30}`, "-frames:v", String(frames), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file,
]);

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), "rc-hook-")); process.env.REELCUT_HOME = home;
  // The Vision text reader is built once per home; reuse the real one when this machine has it.
  const helper = path.join(os.homedir(), ".reelcut", "bin", "reelcut-vision");
  if (existsSync(helper)) { mkdirSync(path.join(home, "bin"), { recursive: true }); copyFileSync(helper, path.join(home, "bin", "reelcut-vision")); }
  dir = path.join(home, "out-x"); reelPath = path.join(dir, "reel.json");
  mkdirSync(path.join(dir, "clips"), { recursive: true }); mkdirSync(path.join(dir, "compositions"), { recursive: true });
  writeFileSync(reelPath, JSON.stringify({ format: "9:16", fps: 30, beats: [
    { id: "beat-00", durationSeconds: 1, composition: "compositions/beat-00.html", kind: "hook" },
    { id: "beat-01", durationSeconds: 1, composition: "compositions/beat-01.html" },
  ] }));
  writeFileSync(path.join(dir, "compositions", "beat-00.html"), `<template><div id="root"><span class="ln">Ship it today</span></div></template>`);
  writeFileSync(path.join(dir, "compositions", "beat-01.html"), `<template><div id="root"><span class="ln">Then rest</span></div></template>`);
});
afterEach(() => { delete process.env.REELCUT_HOME; rmSync(home, { recursive: true, force: true }); });

describe("the hook check", () => {
  it("scores a hook by when its words land, when it moves, and what Instagram covers", async () => {
    const { judgeHook } = await import("../src/create/hook.js");
    expect(judgeHook({ line: "Ship it today", beatSeconds: 2, quietText: false, blankStart: false, firstText: 0.25, firstMove: 0, safe: [] })).toEqual({ score: 100, flags: [] });
    const slow = judgeHook({ line: "Apparently we have AI that can build entire applications now and it is wild", beatSeconds: 6, quietText: false, blankStart: true, firstText: 1.5, firstMove: 1, safe: [{ zone: "top", name: "the Reels header", text: "Apparently", from: 0.5, to: 2 }] });
    expect(slow.flags.map((f) => f.id)).toEqual(["blank-start", "late-text", "too-long", "slow-move", "long-first-beat", "under-top"]);
    expect(slow.score).toBe(10);
    // A reel whose words are spoken, not shown, is not marked down for having none on screen.
    expect(judgeHook({ line: "", beatSeconds: 2, quietText: true, blankStart: false, firstMove: 0.25, safe: [] }).score).toBe(100);
    expect(judgeHook({ line: "Ship it", beatSeconds: 2, quietText: false, blankStart: false, safe: [] }).flags.map((f) => f.id)).toEqual(["no-text", "still"]);
  });

  it("finds the reel's own lines under Instagram's interface, merged into one span per zone", async () => {
    const { safeHits, covered, isOwn, distinctLines, displayHeight, isDisplay, respell } = await import("../src/create/hook.js");
    expect(covered([0, 0.1, 0.5, 0.04], [0, 0, 1, 0.12])).toBeCloseTo(0.5);
    const h = displayHeight(1080 / 1920);
    const own = new Set(["ship", "it", "today", "rejected"]);
    const keep = (l: { text: string; box?: [number, number, number, number] }) => isDisplay(l, h) && isOwn(l.text, own);
    const big = (text: string, y: number): { text: string; box: [number, number, number, number]; conf: number } => ({ text, box: [0.1, y, 0.6, 0.03], conf: 1 });
    const hits = safeHits([
      { t: 0, lines: [big("Ship it today", 0.5)] },
      { t: 0.5, lines: [big("Rejected.", 0.83), { text: "9:41", box: [0.05, 0.01, 0.1, 0.012], conf: 1 }] },
      { t: 1, lines: [big("Rejccted.", 0.83)] },
      { t: 1.5, lines: [big("Rejected.", 0.83), big("Menu File Edit", 0.02)] },
      { t: 4, lines: [big("Rejected.", 0.83)] },
    ], 0.5, keep);
    expect(hits).toEqual([
      { zone: "bottom", name: "the caption, name and audio line", text: "Rejected.", from: 0.5, to: 1.5 },
      { zone: "bottom", name: "the caption, name and audio line", text: "Rejected.", from: 4, to: 4 },
    ]);
    expect(isOwn("Apparently, we have Al that", new Set(["apparently", "we", "have", "ai", "that"]))).toBe(true);
    expect(respell("Al builds all of it", new Set(["ai", "builds", "all"]))).toBe("AI builds all of it");
    expect(distinctLines(["Apparently, we have AI that can", "Apparently, we have AI that can build", "entire", "Entire"])).toEqual(["Apparently, we have AI that can build", "entire"]);
  });

  it("measures a real master, keeps Claude's verdict until the master changes, and writes the fix", async () => {
    clip(path.join(dir, "clips", "beat-00.mp4"), 30, "0x204060"); clip(path.join(dir, "clips", "beat-01.mp4"), 30, "0x602040", 660);
    const { joinClips } = await import("../src/render/assemble.js");
    expect(joinClips(["beat-00", "beat-01"].map((b) => ({ file: path.join(dir, "clips", `${b}.mp4`), frames: 30, fps: 30 })), path.join(dir, "master.mp4"), path.join(dir, ".j")).ok).toBe(true);
    const { measureHook, saveVerdict, readHook, hookFresh, fixHookPrompt } = await import("../src/create/hook.js");
    const r = await measureHook(reelPath, { quietText: true });
    expect(r.firstMove).toBe(0.25);
    expect(r.blankStart).toBe(false);
    expect(existsSync(path.join(dir, r.strip!))).toBe(true);
    expect(() => saveVerdict(path.join(home, "nope.json"), { score: 5, clear: true, gap: false, line: "x" })).toThrow(/measure the hook first/);
    saveVerdict(reelPath, { score: 5, clear: true, gap: false, line: "Clear but no reason to stay", rewrite: "71,000 people did this" });
    expect(hookFresh(reelPath)).toBe(true);
    await measureHook(reelPath, { quietText: true });
    expect(readHook(reelPath)!.verdict!.rewrite).toBe("71,000 people did this");
    const fix = fixHookPrompt(reelPath, readHook(reelPath)!);
    expect(fix.shown).toBe("Fix the hook: “71,000 people did this”");
    expect(fix.prompt).toContain("Keep beat 1's length (1.00 s)");
  }, 60_000);
});

describe("three hooks", () => {
  it("joins a master per hook clip with the real sound, swaps one in without a render, and calls an A/B", async () => {
    clip(path.join(dir, "clips", "beat-00.mp4"), 30, "0x204060"); clip(path.join(dir, "clips", "beat-01.mp4"), 30, "0x602040", 660);
    const { joinClips, streamInfo } = await import("../src/render/assemble.js");
    joinClips(["beat-00", "beat-01"].map((b) => ({ file: path.join(dir, "clips", `${b}.mp4`), frames: 30, fps: 30 })), path.join(dir, "master.mp4"), path.join(dir, ".j"));
    const { buildVariants, useVariant, setAB, abResult, hooksPrompt, readHooks } = await import("../src/create/hooks.js");
    expect(hooksPrompt(reelPath).prompt).toContain("exactly 1.000 s");
    await expect(buildVariants(reelPath)).rejects.toThrow(/no hook clips yet/);
    writeFileSync(path.join(dir, "compositions", "beat-00-hook-a.html"), `<template><div id="root" data-angle="a number" data-technique="differentiate/typographic/big-number"><span class="ln">71,000 did it</span></div></template>`);
    clip(path.join(dir, "clips", "beat-00-hook-a.mp4"), 30, "0x406020", 220);
    clip(path.join(dir, "clips", "beat-00-hook-b.mp4"), 24, "0x402060", 220);
    await expect(buildVariants(reelPath)).rejects.toThrow(/has 24 frames and beat 1 has 30/);
    rmSync(path.join(dir, "clips", "beat-00-hook-b.mp4"));
    const set = await buildVariants(reelPath);
    expect(set.variants.map((v) => [v.id, v.line, v.angle, v.technique])).toEqual([["original", expect.any(String), undefined, undefined], ["a", "71,000 did it", "a number", "differentiate/typographic/big-number/build"]]);
    const a = set.variants[1]!;
    expect(streamInfo(path.join(dir, a.master))).toMatchObject({ frames: 60, hasAudio: true });
    useVariant(reelPath, "a");
    const reel = JSON.parse(readFileSync(reelPath, "utf8"));
    expect(reel.beats[0]).toMatchObject({ composition: "compositions/beat-00-hook-a.html", technique: "differentiate/typographic/big-number/build" });
    expect(readFileSync(path.join(dir, "clips", "beat-00.mp4")).equals(readFileSync(path.join(dir, "clips", "beat-00-hook-a.mp4")))).toBe(true);
    // Back to the original: it was kept.
    useVariant(reelPath, "original");
    expect(JSON.parse(readFileSync(reelPath, "utf8")).beats[0].composition).toBe("compositions/beat-00.html");
    expect(() => setAB(reelPath, ["a", "a"])).toThrow(/two different/);
    const ab = setAB(reelPath, ["original", "a"]);
    const { addPerformance, readPerformance, latest } = await import("../src/create/performance.js");
    expect(abResult(ab, [])!.line).toContain("Add each one's numbers");
    addPerformance(reelPath, { platform: "instagram", retention3s: 52, variant: "original" });
    addPerformance(reelPath, { platform: "instagram", retention3s: 61, variant: "a" });
    addPerformance(reelPath, { platform: "instagram", retention3s: 1, variant: "../x" });
    expect(latest(readPerformance(reelPath))).toHaveLength(3);
    const res = abResult(readHooks(reelPath)!, readPerformance(reelPath))!;
    expect(res).toMatchObject({ winner: "a", line: "A/B: hook A held more viewers: 61% against 52% still watching at 3 s." });
  }, 90_000);
});

describe("other formats", () => {
  it("asks Claude for a laid-out copy per format, and lists the ones made", async () => {
    const { formatsPrompt, formatVersions } = await import("../src/create/formats.js");
    expect(() => formatsPrompt(reelPath, ["9:16"])).toThrow(/not in already/);
    const m = formatsPrompt(reelPath, ["4:5", "1:1", "9:16"]);
    expect(m.shown).toBe("Make it in 4:5, 1:1");
    expect(m.prompt).toContain(path.join(dir, "formats", "1080x1350"));
    expect(formatVersions(reelPath).map((v) => v.format)).toEqual(["9:16"]);
    mkdirSync(path.join(dir, "formats", "1080x1350"), { recursive: true });
    writeFileSync(path.join(dir, "formats", "1080x1350", "reel.json"), JSON.stringify({ format: "4:5", beats: [] }));
    expect(formatVersions(reelPath).map((v) => [v.format, !!v.master])).toEqual([["9:16", false], ["4:5", false]]);
  });
});

describe("the reel's sound", () => {
  it("says how the cuts sit on the music's beat, what snapping would move, and whose the cues are", async () => {
    // A click on every beat at 120 BPM, and cuts just off it (1.9 s and 4.1 s).
    ffmpeg(["-f", "lavfi", "-i", "aevalsrc=0.8*sin(2*PI*1000*t)*lt(mod(t\\,0.5)\\,0.02):s=48000:d=12", "-ac", "2", path.join(dir, "clicks.flac")]);
    writeFileSync(reelPath, JSON.stringify({ format: "9:16", music: { source: "clicks.flac" }, beats: [
      { id: "beat-00", durationSeconds: 1.9, sfx: [{ source: "pack:pop-01", at: 0.2 }] },
      { id: "beat-01", durationSeconds: 2.2, sfx: [{ source: "library:0123456789abcdef", at: 0.4 }, { source: "pack:pop-02", at: 1 }] },
      { id: "beat-02", durationSeconds: 2 },
    ] }));
    const { soundState, snapPrompt } = await import("../src/create/sound.js");
    const s = soundState(reelPath);
    expect(s.cues).toEqual({ total: 3, beats: 2, mine: 1, pack: 2 });
    expect(s.music).toMatchObject({ bpm: 120, sync: "fit", cuts: 2, voiced: false });
    expect(s.music!.snap!.onBeat).toBe(2);
    expect(s.music!.snap!.maxShift).toBeLessThanOrEqual(0.15);
    expect(snapPrompt(reelPath, s).prompt).toContain('"sync": "snap"');
    expect(() => snapPrompt(reelPath, { ...s, music: { ...s.music!, voiced: true } })).toThrow(/voiceover sets/);
  });
});
