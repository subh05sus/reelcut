import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { joinClips, planJobs, runPool, sheetFrames, contactSheet, stackSheets, streamInfo } from "../src/render/assemble.js";
import { hasFfmpeg } from "../src/library/index.js";

const GB = 1024 ** 3;

describe("planning parallel renders", () => {
  it("shares the cores out about three a clip, never more than four clips", () => {
    expect(planJobs({ cpus: 10, totalMemBytes: 32 * GB })).toEqual({ jobs: 3, workersPerJob: 3 });
    expect(planJobs({ cpus: 16, totalMemBytes: 64 * GB })).toEqual({ jobs: 4, workersPerJob: 4 });
    expect(planJobs({ cpus: 2, totalMemBytes: 8 * GB })).toEqual({ jobs: 1, workersPerJob: 2 });
  });

  it("renders fewer clips at once on a machine short of memory", () => {
    expect(planJobs({ cpus: 12, totalMemBytes: 8 * GB }).jobs).toBe(2);
  });

  it("does what --jobs says", () => {
    expect(planJobs({ cpus: 10, totalMemBytes: 32 * GB }, 1)).toEqual({ jobs: 1, workersPerJob: 10 });
  });
});

describe("the worker pool", () => {
  it("keeps results in input order and never runs more than it was told", async () => {
    let running = 0;
    let peak = 0;
    const out = await runPool([30, 5, 20, 1, 10], 2, async (ms, i) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, ms));
      running -= 1;
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
  });
});

describe("contact sheet frames", () => {
  it("picks the entrance, the build, the middle, the settle and the end, inside the clip", () => {
    expect(sheetFrames(101)).toEqual([4, 25, 50, 75, 97]);
    expect(sheetFrames(1)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe.runIf(hasFfmpeg())("joining clips into the master", () => {
  let dir: string;
  const clip = (name: string, frames: number, audio: boolean, color = "red"): string => {
    const file = path.join(dir, `${name}.mp4`);
    const seconds = (frames / 30).toFixed(6);
    execFileSync("ffmpeg", [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", `color=c=${color}:s=64x64:r=30:d=${seconds}`,
      ...(audio ? ["-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${seconds}`] : []),
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "30",
      ...(audio ? ["-c:a", "aac", "-shortest"] : []),
      "-frames:v", String(frames),
      file,
    ]);
    return file;
  };

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "rc-join-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("joins silent clips frame for frame", () => {
    const a = clip("a", 20, false);
    const b = clip("b", 13, false, "blue");
    const out = path.join(dir, "master.mp4");
    const result = joinClips([{ file: a, frames: 20, fps: 30 }, { file: b, frames: 13, fps: 30 }], out, path.join(dir, "work"));
    expect(result).toMatchObject({ ok: true, frames: 33 });
    expect(streamInfo(out)).toMatchObject({ frames: 33, hasAudio: false });
  });

  it("keeps sound when only some clips have it, with silence for the rest", () => {
    const a = clip("sa", 30, true);
    const b = clip("sb", 15, false, "blue");
    const out = path.join(dir, "master-sound.mp4");
    const result = joinClips([{ file: a, frames: 30, fps: 30 }, { file: b, frames: 15, fps: 30 }], out, path.join(dir, "work"));
    expect(result.ok).toBe(true);
    const info = streamInfo(out);
    expect(info).toMatchObject({ frames: 45, hasAudio: true });
    expect(info.durationSeconds).toBeGreaterThan(1.45);
    expect(info.durationSeconds).toBeLessThan(1.6);
  });

  it("refuses a clip whose length does not match the reel's timing", () => {
    const a = clip("stale", 20, false);
    const result = joinClips([{ file: a, frames: 21, fps: 30 }], path.join(dir, "never.mp4"), path.join(dir, "work"));
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/has 20, needs 21/);
    expect(existsSync(path.join(dir, "never.mp4"))).toBe(false);
  });

  it("makes a contact sheet a row per clip, and stacks them for the reel", async () => {
    const a = await contactSheet(clip("ca", 20, false), path.join(dir, "sheets", "a.jpg"), { cellWidth: 32 });
    const b = await contactSheet(clip("cb", 20, false, "blue"), path.join(dir, "sheets", "b.jpg"), { cellWidth: 32 });
    const reel = stackSheets([a, b], path.join(dir, "contact.jpg"))!;
    const size = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", reel], { encoding: "utf8" }).trim();
    const [w, h] = size.split(",").map(Number);
    // Five 32 px cells with 4 px between them, two rows.
    expect(w).toBe(5 * 32 + 4 * 4);
    expect(h).toBe(2 * 32);
  });
});
