import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addAsset,
  addMoment,
  analyzeFile,
  detectKey,
  dropKeyed,
  ensureKeyed,
  hasFfmpeg,
  isKeyed,
  keyHash,
  keyOf,
  keyedBlob,
  libraryRoot,
  loadIndex,
  momentKeyView,
  patchKey,
  scheduleKey,
  settleKeying,
  wantsKey,
  type LibraryAsset,
} from "../src/library/index.js";
import { expandFootage, FootageError } from "../src/render/footage.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), "reelcut-key-"));
  process.env.REELCUT_HOME = home;
});
afterEach(() => {
  delete process.env.REELCUT_HOME;
  rmSync(home, { recursive: true, force: true });
});

/** 2 s at 15 fps, 160x96: a white 40x30 card sliding right across a green backdrop, or across a grey one. */
function clip(name: string, backdrop: string): string {
  const file = path.join(home, `${name}.mp4`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${backdrop}:s=160x96:r=15:d=2`, "-f", "lavfi", "-i", "color=c=white:s=40x30:r=15:d=2", "-filter_complex", "[0][1]overlay=x=10+t*50:y=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "12", file]);
  return file;
}

async function register(file: string): Promise<LibraryAsset> {
  const analysed = await analyzeFile(file);
  if ("skipped" in analysed) throw new Error(analysed.skipped);
  const { asset } = addAsset(file, { name: path.basename(file, ".mp4"), assetKind: "identity", provenance: { source: "user" }, mediaType: "video", analysis: analysed.analysis });
  return loadIndex().assets.find((a) => a.id === asset.id)!;
}

describe.runIf(hasFfmpeg())("green screens in the library", () => {
  it("is found when a recording is analysed, and not for an ordinary one", async () => {
    const green = await register(clip("green", "0x00f600"));
    const grey = await register(clip("grey", "0x303030"));
    // The encoder moves the colour a little: what was written as #00f600 is read back as #00f5xx.
    expect(green.analysis.greenScreen?.color).toMatch(/^#00f[4-7][0-3][0-3]$/);
    expect(grey.analysis.greenScreen).toBeUndefined();
    expect(grey.analysis.greenScreenChecked).toBeDefined();
    expect(wantsKey(green)).toBe(true);
    expect(wantsKey(grey)).toBe(false);
  }, 60_000);

  it("looks at a recording added before this existed, once", async () => {
    const file = clip("old", "0x00f600");
    const analysed = await analyzeFile(file);
    if ("skipped" in analysed) throw new Error("skipped");
    const { greenScreen: _g, greenScreenChecked: _c, ...analysis } = analysed.analysis;
    const { asset } = addAsset(file, { name: "old", assetKind: "identity", provenance: { source: "user" }, mediaType: "video", analysis });
    expect(loadIndex().assets[0]!.analysis.greenScreenChecked).toBeUndefined();
    const looked = detectKey(asset.id);
    expect(looked.analysis.greenScreen?.color).toMatch(/^#00f[4-7][0-3][0-3]$/);
    expect(looked.analysis.greenScreenChecked).toBeDefined();
  }, 60_000);

  it("keys once, saves the copy beside the original, and reuses it", async () => {
    const a = await register(clip("green", "0x00f600"));
    expect(isKeyed(a)).toBe(false);
    const keyed = await ensureKeyed(a.id);
    expect(isKeyed(keyed)).toBe(true);
    expect(existsSync(keyedBlob(keyed)!)).toBe(true);
    expect(keyedBlob(keyed)).toContain(path.join(libraryRoot(), "keyed"));
    // The original is untouched.
    expect(existsSync(path.join(libraryRoot(), keyed.file))).toBe(true);
    const stamp = keyOf(keyed).keyedAt;
    const again = await ensureKeyed(a.id);
    expect(keyOf(again).keyedAt).toBe(stamp);
  }, 60_000);

  it("makes the copy again when the settings change, and not before", async () => {
    const a = await register(clip("green", "0x00f600"));
    await ensureKeyed(a.id);
    const before = keyHash(loadIndex().assets[0]!);
    patchKey(a.id, { shadows: "drop" });
    const changed = loadIndex().assets[0]!;
    expect(keyHash(changed)).not.toBe(before);
    expect(isKeyed(changed)).toBe(false);
    const remade = await ensureKeyed(a.id);
    expect(isKeyed(remade)).toBe(true);
    expect(keyOf(remade).shadows).toBe("drop");
  }, 60_000);

  it("is left alone when a person turns keying off, and can be turned back on", async () => {
    const a = await register(clip("green", "0x00f600"));
    patchKey(a.id, { enabled: false });
    const off = await ensureKeyed(a.id);
    expect(wantsKey(off)).toBe(false);
    expect(isKeyed(off)).toBe(false);
    expect(keyOf(off).file).toBeUndefined();
    patchKey(a.id, { enabled: true });
    expect(isKeyed(await ensureKeyed(a.id))).toBe(true);
  }, 60_000);

  it("refuses a setting that cannot be real", async () => {
    const a = await register(clip("green", "0x00f600"));
    expect(() => patchKey(a.id, { tolerance: 0.9 })).toThrow();
    expect(() => patchKey(a.id, { shadows: "sideways" as "keep" })).toThrow();
  }, 60_000);

  it("can be dropped, which takes the copy and its sidecar away", async () => {
    const a = await register(clip("green", "0x00f600"));
    const keyed = await ensureKeyed(a.id);
    const blob = keyedBlob(keyed)!;
    dropKeyed(a.id);
    expect(existsSync(blob)).toBe(false);
    expect(isKeyed(loadIndex().assets[0]!)).toBe(false);
  }, 60_000);

  it("keys in the background one at a time, and says what it is doing", async () => {
    const a = await register(clip("green", "0x00f600"));
    scheduleKey(a.id);
    await settleKeying();
    expect(isKeyed(loadIndex().assets[0]!)).toBe(true);
  }, 60_000);

  describe("where the subject is, per moment", () => {
    it("crops each moment to the card in it, with room for the soft edge", async () => {
      const a = await register(clip("green", "0x00f600"));
      await ensureKeyed(a.id);
      const keyed = loadIndex().assets[0]!;
      const early = momentKeyView(keyed, { in: 0, out: 0.2 })!;
      const whole = momentKeyView(keyed, { in: 0, out: 2 })!;
      // The card is 40x30 and moves right 50 px a second: early on the crop is small, over the whole clip it is wide.
      expect(early.px.w).toBeLessThan(80);
      expect(early.px.h).toBeLessThan(60);
      expect(whole.px.w).toBeGreaterThan(early.px.w + 50);
      expect(early.x).toBeGreaterThan(0);
      expect(early.x + early.w).toBeLessThanOrEqual(1);
    }, 60_000);

    it("is nothing for a recording with no keyed copy", async () => {
      const a = await register(clip("green", "0x00f600"));
      expect(momentKeyView(a, { in: 0, out: 1 })).toBeUndefined();
    }, 60_000);
  });

  describe("placing it in a beat", () => {
    const html = (ref: string, extra = ""): string => `<template><div id="root" data-look="paper"><div class="rc-footage" data-footage="${ref}" ${extra}></div></div></template>`;

    it("plays the keyed copy, cropped to the card, as a cut-out", async () => {
      const a = await register(clip("green", "0x00f600"));
      await ensureKeyed(a.id);
      const asset = loadIndex().assets[0]!;
      const { moment } = addMoment(asset.id, { label: "card slides", in: 0, out: 1.5 });
      const expanded = expandFootage(html(`${asset.id}:${moment.id}`), { assets: loadIndex().assets, format: "1:1", beat: { id: "beat-01", durationSeconds: 2 } });
      expect(expanded.html).toContain(`src="assets/library/${asset.id}-key.webm"`);
      expect(expanded.html).toContain('data-frame="cutout"');
      expect(expanded.html).toContain('data-keyed="true"');
      expect(expanded.html).toMatch(/<video[^>]*muted[^>]*style="position:absolute;[^"]*left:-?[\d.]+%/);
      const view = momentKeyView(asset, moment)!;
      expect(expanded.html).toContain(`--fw:${view.px.w};--fh:${view.px.h};`);
    }, 60_000);

    it("lets the composition choose its own frame", async () => {
      const a = await register(clip("green", "0x00f600"));
      await ensureKeyed(a.id);
      const asset = loadIndex().assets[0]!;
      const { moment } = addMoment(asset.id, { label: "card slides", in: 0, out: 1.5 });
      const expanded = expandFootage(html(`${asset.id}:${moment.id}`, 'data-frame="window"'), { assets: loadIndex().assets, format: "1:1", beat: { id: "beat-01", durationSeconds: 2 } });
      expect(expanded.html).not.toContain('data-frame="cutout"');
      expect(expanded.html).toContain('data-frame="window"');
    }, 60_000);

    it("makes the held last frame from the keyed copy, named for how it was keyed", async () => {
      const a = await register(clip("green", "0x00f600"));
      await ensureKeyed(a.id);
      const asset = loadIndex().assets[0]!;
      const { moment } = addMoment(asset.id, { label: "card slides", in: 0, out: 1.5 });
      const expanded = expandFootage(html(`${asset.id}:${moment.id}`), { assets: loadIndex().assets, format: "1:1", beat: { id: "beat-01", durationSeconds: 4 } });
      expect(expanded.holds).toHaveLength(1);
      expect(expanded.holds[0]).toMatchObject({ keyed: true, assetId: asset.id });
      expect(expanded.holds[0]!.target).toContain(`-hold-${keyOf(asset).hash!.slice(0, 8)}.png`);
    }, 60_000);

    it("refuses to place a green recording that has no keyed copy, rather than show the green", async () => {
      const a = await register(clip("green", "0x00f600"));
      const { moment } = addMoment(a.id, { label: "card slides", in: 0, out: 1.5 });
      expect(() => expandFootage(html(`${a.id}:${moment.id}`), { assets: loadIndex().assets, format: "1:1", beat: { id: "beat-01", durationSeconds: 2 } })).toThrow(FootageError);
      expect(() => expandFootage(html(`${a.id}:${moment.id}`), { assets: loadIndex().assets, format: "1:1", beat: { id: "beat-01", durationSeconds: 2 } })).toThrow(/green screen.*footage -- key/);
    }, 60_000);

    it("places it as recorded when keying is off", async () => {
      const a = await register(clip("green", "0x00f600"));
      patchKey(a.id, { enabled: false });
      const { moment } = addMoment(a.id, { label: "card slides", in: 0, out: 1.5 });
      const expanded = expandFootage(html(`${a.id}:${moment.id}`), { assets: loadIndex().assets, format: "1:1", beat: { id: "beat-01", durationSeconds: 2 } });
      expect(expanded.html).not.toContain("-key.webm");
      expect(expanded.html).not.toContain("data-keyed");
    }, 60_000);

    it("does nothing different for an ordinary recording", async () => {
      const a = await register(clip("grey", "0x303030"));
      const { moment } = addMoment(a.id, { label: "card slides", in: 0, out: 1.5 });
      const expanded = expandFootage(html(`${a.id}:${moment.id}`), { assets: loadIndex().assets, format: "1:1", beat: { id: "beat-01", durationSeconds: 2 } });
      expect(expanded.html).toContain(`src="assets/library/${a.id}.mp4"`);
      expect(expanded.html).not.toContain("data-keyed");
      expect(readFileSync(path.join(libraryRoot(), a.file)).length).toBeGreaterThan(0);
      writeFileSync(path.join(home, "unused"), "");
    }, 60_000);
  });
});
