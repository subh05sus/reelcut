import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reportAssetGaps, resolutionsFor } from "../src/brief/assetGaps.js";
import type { AssetRequirement } from "../src/brief/assetRequirementTypes.js";
import {
  acceptMoments,
  addAsset,
  addMoment,
  analyzeFile,
  clock,
  findMoments,
  fitMoment,
  footageAgeDays,
  footageBlockReason,
  footageLegibility,
  footageOf,
  hasFfmpeg,
  LibraryAssetSchema,
  loadIndex,
  MAX_MOMENTS,
  parseTime,
  patchFootage,
  removeMoment,
  setReview,
  significantWords,
  updateMoment,
  type LibraryAsset,
} from "../src/library/index.js";
import { expandFootage, FootageError, linkOrCopy, LINK_FROM_BYTES, usesFootage } from "../src/render/footage.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), "reelcut-footage-"));
  process.env.REELCUT_HOME = home;
});
afterEach(() => {
  delete process.env.REELCUT_HOME;
  rmSync(home, { recursive: true, force: true });
});

let n = 0;
/** A video asset without a real video in it: the logic under test never decodes it. */
function recording(options: { approved?: boolean; checked?: boolean; recorded?: string; width?: number; seconds?: number; app?: string } = {}): LibraryAsset {
  const file = path.join(home, `rec-${++n}.mp4`);
  writeFileSync(file, `not really a video ${n}`);
  const { asset } = addAsset(file, {
    name: "install claude mac",
    assetKind: "identity",
    tags: ["claude"],
    provenance: { source: "user" },
    mediaType: "video",
    analysis: { dominantColors: [], descriptors: [], width: options.width ?? 1920, height: Math.round(((options.width ?? 1920) * 10) / 16), durationSeconds: options.seconds ?? 12, createdAt: options.recorded ?? new Date().toISOString() },
    ...(options.approved === false ? { review: { state: "pending" as const } } : {}),
  });
  if (options.app !== undefined || options.checked !== false) patchFootage(asset.id, { app: options.app ?? "Claude", platform: "mac", ...(options.checked === false ? {} : { privateChecked: true }) });
  return loadIndex().assets.find((a) => a.id === asset.id)!;
}

const daysAgo = (d: number): string => new Date(Date.now() - d * 86_400_000).toISOString();

describe("footage in the library", () => {
  it("leaves every older asset readable: footage is optional", () => {
    const legacy = LibraryAssetSchema.parse({ id: "0123456789abcdef", name: "x", file: "files/x.png", ext: "png", bytes: 1, sha256: "a".repeat(64), assetKind: "generic", provenance: { source: "user" }, addedAt: "2026-01-01T00:00:00Z" });
    expect(legacy.footage).toBeUndefined();
    expect(footageOf(legacy)).toMatchObject({ muted: true, moments: [] });
  });

  it("marks moments, and refuses ones that cannot be real", () => {
    const a = recording();
    const { moment } = addMoment(a.id, { label: "download Claude", in: 2, out: 8.5, tags: ["Download", "claude"] });
    expect(moment).toMatchObject({ state: "confirmed", origin: "user", tags: ["claude", "download"] });
    expect(() => addMoment(a.id, { label: "x", in: 5, out: 5.1 })).toThrow(/at least 0.3/);
    expect(() => addMoment(a.id, { label: "x", in: 10, out: 20 })).toThrow(/12.0s long/);
    expect(() => addMoment(a.id, { label: "  ", in: 1, out: 3 })).toThrow(/label/);
    expect(() => addMoment(a.id, { label: "x", in: 1, out: 3, focus: { "2:1": { x: 0, y: 0, w: 0.5, h: 0.5 } } })).toThrow(/no format/);
    expect(() => addMoment(a.id, { label: "x", in: 1, out: 3, focus: { "1:1": { x: 0.8, y: 0, w: 0.5, h: 0.5 } } })).toThrow(/past the edge/);
  });

  it("only takes moments on a video", () => {
    const file = path.join(home, "mark.svg");
    writeFileSync(file, "<svg xmlns='http://www.w3.org/2000/svg'/>");
    const { asset } = addAsset(file, { name: "mark", assetKind: "generic", provenance: { source: "user" }, mediaType: "vector" });
    expect(() => addMoment(asset.id, { label: "x", in: 0, out: 2 })).toThrow(/not a video/);
  });

  it("makes whatever Claude writes a proposal, and only a person can confirm it", () => {
    const a = recording();
    const { moment } = addMoment(a.id, { label: "open the app", in: 8.5, out: 11, focus: { "1:1": { x: 0, y: 0, w: 0.5, h: 0.5 } } }, "claude");
    expect(moment).toMatchObject({ state: "proposed", origin: "claude", focus: {} });
    expect(findMoments(loadIndex().assets, "open the app")[0]).toMatchObject({ decision: "proposal" });
    expect(findMoments(loadIndex().assets, "open the app")[0]!.why).toMatch(/proposed by Claude/);
    updateMoment(a.id, moment.id, { confirm: true });
    expect(footageOf(loadIndex().assets[0]!).moments[0]!.state).toBe("confirmed");
  });

  it("bounds how many moments one recording can carry, so a proposal run cannot flood it", () => {
    const a = recording({ seconds: 600 });
    for (let i = 0; i < MAX_MOMENTS; i++) addMoment(a.id, { label: `step ${i}`, in: i, out: i + 0.5 }, "claude");
    expect(() => addMoment(a.id, { label: "one more", in: 100, out: 101 }, "claude")).toThrow(/already has/);
  });

  it("asks for a person's yes again when the edges of a moment move", () => {
    const a = recording();
    const { moment } = addMoment(a.id, { label: "download Claude", in: 2, out: 8 });
    acceptMoments([{ assetId: a.id, momentId: moment.id }]);
    expect(footageOf(loadIndex().assets[0]!).moments[0]!.acceptedAt).toBeDefined();
    updateMoment(a.id, moment.id, { label: "download Claude now" });
    expect(footageOf(loadIndex().assets[0]!).moments[0]!.acceptedAt).toBeDefined();
    updateMoment(a.id, moment.id, { out: 9 });
    expect(footageOf(loadIndex().assets[0]!).moments[0]!.acceptedAt).toBeUndefined();
  });

  it("does not mark a proposal as used", () => {
    const a = recording();
    const { moment } = addMoment(a.id, { label: "download Claude", in: 2, out: 8 }, "claude");
    acceptMoments([{ assetId: a.id, momentId: moment.id }]);
    expect(footageOf(loadIndex().assets[0]!).moments[0]!.acceptedAt).toBeUndefined();
  });

  it("removes a moment, and says when there is none", () => {
    const a = recording();
    const { moment } = addMoment(a.id, { label: "x y", in: 1, out: 3 });
    removeMoment(a.id, moment.id);
    expect(footageOf(loadIndex().assets[0]!).moments).toEqual([]);
    expect(() => removeMoment(a.id, moment.id)).toThrow(/no moment/);
  });

  it("takes back a private-information check as readily as it records it", () => {
    const a = recording({ checked: false });
    expect(footageOf(a).privateChecked).toBeUndefined();
    expect(patchFootage(a.id, { privateChecked: true }).footage!.privateChecked).toMatchObject({ by: "user" });
    expect(patchFootage(a.id, { privateChecked: false }).footage!.privateChecked).toBeUndefined();
  });
});

describe("times", () => {
  it("reads seconds and minutes:seconds, and refuses the rest", () => {
    expect(parseTime("12.5", "--in")).toBe(12.5);
    expect(parseTime("1:02.5", "--in")).toBe(62.5);
    expect(() => parseTime("a little later", "--in")).toThrow(/not a time/);
    expect(() => parseTime(undefined, "--in")).toThrow(/required/);
    expect(clock(62.5)).toBe("1:02.5");
  });
});

describe("finding the moment a line wants", () => {
  const phrase = "download Claude";

  function ready() {
    const a = recording({ recorded: daysAgo(5) });
    const { moment } = addMoment(a.id, { label: "download Claude", in: 2, out: 8.5, tags: ["mac"] });
    return { a, moment };
  }

  it("matches the step and the product, and not a different step", () => {
    const { a } = ready();
    addMoment(a.id, { label: "open the installer", in: 8.5, out: 11 });
    const found = findMoments(loadIndex().assets, phrase);
    expect(found.map((m) => m.moment.label)).toEqual(["download Claude"]);
    expect(found[0]!.confidence).toBe("exact");
  });

  it("takes the product from the recording and the step from the moment", () => {
    const a = recording({ recorded: daysAgo(5) });
    addMoment(a.id, { label: "click the Download button", in: 2, out: 4 });
    expect(findMoments(loadIndex().assets, phrase)[0]).toMatchObject({ confidence: "exact" });
  });

  it("does not offer a recording on the product alone: the step has to be in the moment", () => {
    const a = recording({ recorded: daysAgo(5) });
    addMoment(a.id, { label: "sign in with Google", in: 2, out: 4 });
    expect(findMoments(loadIndex().assets, phrase)).toEqual([]);
  });

  it("treats install and download as the same step, but less sure of it", () => {
    const a = recording({ recorded: daysAgo(5) });
    addMoment(a.id, { label: "install the app", in: 2, out: 6 });
    const [m] = findMoments(loadIndex().assets, "download Claude");
    expect(m).toBeDefined();
    expect(m!.confidence).not.toBe("exact");
    expect(m!.decision).toBe("proposal");
  });

  it("does not use a recording nobody has approved, nor one that was rejected", () => {
    const pending = recording({ approved: false, recorded: daysAgo(5) });
    addMoment(pending.id, { label: "download Claude", in: 2, out: 8 });
    expect(findMoments(loadIndex().assets, phrase)[0]!.why).toMatch(/not reviewed yet/);
    setReview([pending.id], "rejected", "user");
    expect(findMoments(loadIndex().assets, phrase)).toEqual([]);
  });

  it("asks once: a fresh, checked, approved, exact match is a proposal until a person has said yes", () => {
    const { a, moment } = ready();
    const first = findMoments(loadIndex().assets, phrase)[0]!;
    expect(first.decision).toBe("proposal");
    expect(first.why).toMatch(/first use/);
    acceptMoments([{ assetId: a.id, momentId: moment.id }]);
    expect(findMoments(loadIndex().assets, phrase)[0]!.decision).toBe("auto");
  });

  it("never uses by itself a recording nobody checked for private information", () => {
    const a = recording({ checked: false, recorded: daysAgo(5) });
    const { moment } = addMoment(a.id, { label: "download Claude", in: 2, out: 8 });
    acceptMoments([{ assetId: a.id, momentId: moment.id }]);
    expect(findMoments(loadIndex().assets, phrase)[0]!.why).toMatch(/private information/);
  });

  it("goes stale like a capture, and an unknown date is never taken as recent", () => {
    const old = recording({ recorded: daysAgo(120) });
    const m = addMoment(old.id, { label: "download Claude", in: 2, out: 8 }).moment;
    acceptMoments([{ assetId: old.id, momentId: m.id }]);
    expect(findMoments(loadIndex().assets, phrase)[0]!.why).toMatch(/recorded 120 days ago/);
    expect(footageBlockReason(loadIndex().assets[0]!, m, "exact", new Date())).toMatch(/120 days/);
    expect(footageAgeDays({ ...old, analysis: {} as never, footage: undefined } as LibraryAsset, new Date())).toBeUndefined();
  });

  it("prefers the newer recording of the same step", () => {
    const older = recording({ recorded: daysAgo(40) });
    addMoment(older.id, { label: "download Claude", in: 2, out: 8 });
    const newer = recording({ recorded: daysAgo(3) });
    addMoment(newer.id, { label: "download Claude", in: 3, out: 9 });
    expect(findMoments(loadIndex().assets, phrase)[0]!.asset.id).toBe(newer.id);
  });

  it("filters by platform and tag", () => {
    ready();
    expect(findMoments(loadIndex().assets, phrase, { platform: "windows" })).toEqual([]);
    expect(findMoments(loadIndex().assets, phrase, { tags: ["nope"] })).toEqual([]);
    expect(findMoments(loadIndex().assets, phrase, { platform: "mac", tags: ["claude"] })).toHaveLength(1);
  });

  it("drops filler and keeps what a line is about", () => {
    expect(significantWords("Now you have to download the Claude app")).toEqual(["have", "download", "claude", "app"]);
  });
});

describe("fitting a moment to a beat", () => {
  const m = (length: number) => ({ in: 2, out: 2 + length });

  it("plays a moment that is the slot's length as it is", () => {
    expect(fitMoment(m(4), 4)).toMatchObject({ ok: true, rate: 1, holdSeconds: 0 });
  });

  it("holds the last frame when the recording ends first, and never slows it down or loops it", () => {
    const f = fitMoment(m(3), 4.4);
    expect(f).toMatchObject({ ok: true, rate: 1, playSeconds: 3, holdSeconds: 1.4 });
  });

  it("says so when the hold is long enough to matter", () => {
    expect(fitMoment(m(2), 6).notes.join(" ")).toMatch(/ends 4.0s before the beat/);
  });

  it("plays a longer moment faster, at one even rate", () => {
    const f = fitMoment(m(6.5), 4.4);
    expect(f.ok).toBe(true);
    expect(f.rate).toBeCloseTo(1.4773, 3);
    expect(f.playSeconds).toBe(4.4);
    expect(f.holdSeconds).toBe(0);
  });

  it("reaches 2x and no further, and then reports a gap with the ways out", () => {
    expect(fitMoment(m(8), 4)).toMatchObject({ ok: true, rate: 2 });
    const f = fitMoment(m(8.4), 4);
    expect(f.ok).toBe(false);
    expect(f.options.join(" ")).toMatch(/tighter moment: at most 8.0s/);
    expect(f.options.join(" ")).toMatch(/at least 4.2s/);
    expect(f.options.join(" ")).toMatch(/stand-in/);
  });

  it("refuses a slot with no length", () => {
    expect(fitMoment(m(3), 0).ok).toBe(false);
  });
});

describe("legibility of a recording at the size it is shown", () => {
  it("passes a recording shown wide enough for its text, and fails one shrunk into a corner", () => {
    const a = recording({ width: 1000 });
    const { moment } = addMoment(a.id, { label: "download Claude", in: 2, out: 6 });
    const wide = footageLegibility(a, moment, { boxWidth: 912, boxHeight: 570, frameWidth: 1080, format: "1:1" });
    expect(wide).toMatchObject({ ok: true });
    const small = footageLegibility(a, moment, { boxWidth: 300, boxHeight: 187, frameWidth: 1080, format: "1:1" });
    expect(small!.ok).toBe(false);
    expect(small!.advice).toMatch(/floor/);
  });

  it("counts the saved focus region, because zooming in is how a wide recording becomes readable", () => {
    const a = recording({ width: 3840 });
    const { moment } = addMoment(a.id, { label: "download Claude", in: 2, out: 6, focus: { "1:1": { x: 0.1, y: 0.3, w: 0.4, h: 0.4 } } });
    const box = { boxWidth: 912, boxHeight: 570, frameWidth: 1080, format: "1:1" };
    const whole = footageLegibility(a, { ...moment, focus: {} }, box)!;
    const zoomed = footageLegibility(a, moment, box)!;
    expect(zoomed.renderedPx!).toBeGreaterThan(whole.renderedPx! * 2);
  });
});

describe("what a requirement for footage offers when nothing matches", () => {
  const req: AssetRequirement = { name: "Download Claude", reason: "the beat shows the first step", sceneUsage: "the install step", visualRole: "screen recording", acceptedFormats: ["mp4", "mov"], priority: "required", assetKind: "identity", form: "footage" };

  it("offers recording it, never drawing it", () => {
    const kinds = resolutionsFor(req).map((r) => r.kind);
    expect(kinds[0]).toBe("record");
    expect(kinds).not.toContain("generate");
    expect(kinds).not.toContain("capture");
    expect(kinds.at(-1)).toBe("recompose");
  });

  it("calls the animated alternative a stand-in, and still blocks a required real one", () => {
    const [gap] = reportAssetGaps([{ requirement: req, status: "not_provided" }]);
    expect(gap!.blocking).toBe(true);
    expect(gap!.resolutions.at(-1)!.note).toMatch(/stand-in/);
  });
});

describe("expanding a placeholder into the video that plays it", () => {
  const html = (attrs = "", inner = "") => `<template><div id="root" data-look="paper"><div class="rc-footage" data-footage="REF" data-frame="window"${attrs}>${inner}</div></div></template>`;

  function setup(over: { approved?: boolean; checked?: boolean; length?: number } = {}) {
    const a = recording({ ...(over.approved === undefined ? {} : { approved: over.approved }), ...(over.checked === undefined ? {} : { checked: over.checked }), recorded: daysAgo(3) });
    const { moment } = addMoment(a.id, { label: "download Claude", in: 2, out: 2 + (over.length ?? 6.5), focus: { "1:1": { x: 0.04, y: 0.34, w: 0.6, h: 0.6 } } });
    return { a: loadIndex().assets.find((x) => x.id === a.id)!, moment, ref: `${a.id}:${moment.id}` };
  }
  const ctx = (assets: LibraryAsset[], seconds = 4.4) => ({ assets, format: "1:1", beat: { id: "beat-01", durationSeconds: seconds } });

  it("leaves a composition without footage alone", () => {
    const out = expandFootage("<template><div id='root'></div></template>", ctx([]));
    expect(out).toMatchObject({ html: "<template><div id='root'></div></template>", uses: [], holds: [] });
    expect(usesFootage("<div data-footage='x'>")).toBe(true);
  });

  it("writes the trim, the rate and the recording's own shape into a video, and nothing else", () => {
    const { a, ref } = setup();
    const out = expandFootage(html().replace("REF", ref), ctx([a]));
    expect(out.html).toContain(`src="assets/library/${a.id}.mp4"`);
    expect(out.html).toContain('data-start="0"');
    expect(out.html).toContain('data-duration="4.399999"');
    expect(out.html).toContain('data-media-start="2"');
    expect(out.html).toContain('data-playback-rate="1.4773"');
    expect(out.html).toMatch(/<video [^>]*\bmuted\b/);
    expect(out.html).toContain("--fw:1920;--fh:1200;");
    expect(out.html).toContain('data-focus="0.04,0.34,0.6,0.6"');
    expect(out.holds).toEqual([]);
    expect(out.uses[0]).toMatchObject({ assetId: a.id, label: "download Claude", fit: { rate: 1.4773 } });
  });

  it("does not move the video's own timing onto the wrapper, which would make HyperFrames treat it as a clip", () => {
    const { a, ref } = setup();
    const out = expandFootage(html(' data-start="9" data-duration="9"').replace("REF", ref), ctx([a]));
    expect(out.html).toMatch(/<div class="rc-footage"[^>]*>/);
    expect(/<div class="rc-footage"([^>]*)>/.exec(out.html)![1]).not.toMatch(/data-start|data-duration/);
  });

  it("keeps overlays the author put in .rc-fv, above the video", () => {
    const { a, ref } = setup();
    const out = expandFootage(html("", '<div class="rc-fv"><i class="rc-spot"></i></div>').replace("REF", ref), ctx([a]));
    expect(out.html.indexOf("<video")).toBeGreaterThan(out.html.indexOf('class="rc-fv"'));
    expect(out.html.indexOf("<video")).toBeLessThan(out.html.indexOf("rc-spot"));
    expect(out.html.match(/class="rc-fv"/g)).toHaveLength(1);
  });

  it("holds the last frame when the recording ends before the beat, with a still made from the library blob", () => {
    const { a, moment, ref } = setup({ length: 3 });
    const out = expandFootage(html().replace("REF", ref), ctx([a], 4.4));
    expect(out.html).not.toContain("data-playback-rate");
    expect(out.html).toContain(`<img class="rc-fh" alt="" src="assets/library/${a.id}-${moment.id}-hold.png" data-start="2.999999" data-duration="1.399999"`);
    expect(out.holds).toEqual([{ target: `assets/library/${a.id}-${moment.id}-hold.png`, assetId: a.id, at: 4.95 }]);
  });

  it("places it where it is asked to, and refuses a slot that runs past the beat", () => {
    const { a, ref } = setup({ length: 2 });
    const out = expandFootage(html(' data-at="1" data-for="2"').replace("REF", ref), ctx([a], 4));
    expect(out.html).toContain('data-start="0.999999"');
    expect(() => expandFootage(html(' data-at="3" data-for="2"').replace("REF", ref), ctx([a], 4))).toThrow(/runs past the end/);
  });

  it("refuses what has not been approved, checked, confirmed or has been rejected", () => {
    const pending = setup({ approved: false });
    expect(() => expandFootage(html().replace("REF", pending.ref), ctx([pending.a]))).toThrow(/has not been approved/);
    const unchecked = setup({ checked: false });
    expect(() => expandFootage(html().replace("REF", unchecked.ref), ctx([unchecked.a]))).toThrow(/private information/);
    const proposed = recording({ recorded: daysAgo(2) });
    const { moment } = addMoment(proposed.id, { label: "download Claude", in: 2, out: 6 }, "claude");
    expect(() => expandFootage(html().replace("REF", `${proposed.id}:${moment.id}`), ctx([loadIndex().assets.find((x) => x.id === proposed.id)!]))).toThrow(/proposed by Claude/);
    const rejected = setup();
    setReview([rejected.a.id], "rejected", "user");
    expect(() => expandFootage(html().replace("REF", rejected.ref), ctx(loadIndex().assets))).toThrow(/was rejected/);
  });

  it("refuses a moment that needs more than 2x, saying how to get out of it", () => {
    const { a, ref } = setup({ length: 10 });
    try {
      expandFootage(html().replace("REF", ref), ctx([a], 4));
      throw new Error("should have refused");
    } catch (error) {
      expect(error).toBeInstanceOf(FootageError);
      expect((error as Error).message).toMatch(/more than 2x/);
      expect((error as Error).message).toMatch(/tighter moment/);
    }
  });

  it("names a moment that was deleted, and a recording that is not there", () => {
    const { a } = setup();
    expect(() => expandFootage(html().replace("REF", `${a.id}:m_00000000`), ctx([a]))).toThrow(/no moment m_00000000/);
    expect(() => expandFootage(html().replace("REF", "0000000000000000:m_00000000"), ctx([a]))).toThrow(/not a recording in the library/);
    expect(() => expandFootage(html().replace("REF", "nonsense"), ctx([a]))).toThrow(/<asset id>:<moment id>/);
  });

  it("warns, without refusing, about an old recording", () => {
    const old = recording({ recorded: daysAgo(200) });
    const { moment } = addMoment(old.id, { label: "download Claude", in: 2, out: 6 });
    const out = expandFootage(html().replace("REF", `${old.id}:${moment.id}`), ctx([loadIndex().assets.find((x) => x.id === old.id)!]));
    expect(out.warnings.join(" ")).toMatch(/recorded 200 days ago/);
  });

  it("lets a recording's own sound through only when it was asked for and the recording has some", () => {
    const { a, ref } = setup();
    patchFootage(a.id, { muted: false });
    const loud = loadIndex().assets.find((x) => x.id === a.id)!;
    expect(expandFootage(html().replace("REF", ref), ctx([loud])).html).toMatch(/<video [^>]*\bmuted\b/);
    const withSound = { ...loud, analysis: { ...loud.analysis, hasAudio: true } };
    const out = expandFootage(html().replace("REF", ref), ctx([withSound])).html;
    expect(out).toContain('data-has-audio="true"');
    expect(/<video [^>]*>/.exec(out)![0]).not.toMatch(/\bmuted\b/);
  });
});

describe.runIf(hasFfmpeg())("measuring a real recording", { timeout: 60_000 }, () => {
  it("reads size, rate and length, makes a filmstrip, and notices a recorder that skips still frames", async () => {
    const steady = path.join(home, "steady.mp4");
    const skipping = path.join(home, "skipping.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=640x400:rate=30:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", steady]);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=640x400:rate=60:duration=3", "-vf", "select='not(mod(n,7))+gt(mod(n,60),40)'", "-fps_mode", "vfr", "-c:v", "libx264", "-pix_fmt", "yuv420p", skipping]);

    const a = await analyzeFile(steady, { filmstripOut: path.join(home, "strip.png"), thumbOut: path.join(home, "t.png") });
    expect("skipped" in a).toBe(false);
    if ("skipped" in a) return;
    expect(a.mediaType).toBe("video");
    expect(a.analysis).toMatchObject({ width: 640, height: 400, fps: 30, vfr: false, hasAudio: false });
    expect(a.analysis.durationSeconds).toBeCloseTo(3, 1);
    expect(a.filmstrip).toBe(path.join(home, "strip.png"));

    const b = await analyzeFile(skipping);
    if ("skipped" in b) throw new Error("skipped");
    expect(b.analysis.vfr).toBe(true);
  });
});

describe("putting a big recording into a render project", () => {
  it("links a big one, so it is not copied into every clip, and copies a small one", () => {
    const source = path.join(home, "big.mov");
    writeFileSync(source, Buffer.alloc(LINK_FROM_BYTES + 1024, 7));
    const target = path.join(home, "project", "assets", "library", "big.mov");
    expect(linkOrCopy(source, target, LINK_FROM_BYTES + 1024)).toBe("linked");
    expect(statSync(target).ino).toBe(statSync(source).ino);

    const small = path.join(home, "small.mov");
    writeFileSync(small, "tiny");
    const copied = path.join(home, "project", "assets", "library", "small.mov");
    expect(linkOrCopy(small, copied, 4)).toBe("copied");
    expect(statSync(copied).ino).not.toBe(statSync(small).ino);
  });

  it("copies when a link cannot be made, and removing the project leaves the library file whole", () => {
    const source = path.join(home, "big.mov");
    writeFileSync(source, "pretend this is big");
    const target = path.join(home, "p2", "big.mov");
    const refuse = (): void => {
      throw new Error("EXDEV: cross-device link not permitted");
    };
    expect(linkOrCopy(source, target, 1e9, { link: refuse })).toBe("copied");
    expect(readFileSync(target, "utf8")).toBe("pretend this is big");

    const linked = path.join(home, "p3", "big.mov");
    expect(linkOrCopy(source, linked, 1e9)).toBe("linked");
    rmSync(path.join(home, "p3"), { recursive: true, force: true });
    expect(readFileSync(source, "utf8")).toBe("pretend this is big");
  });
});
