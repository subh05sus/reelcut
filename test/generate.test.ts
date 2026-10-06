import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AssetRequirement } from "../src/brief/assetRequirementTypes.js";
import { resolutionsFor } from "../src/brief/assetGaps.js";
import {
  beatEligibility,
  buildPrompt,
  cleanSubject,
  clipSeconds,
  formatPlan,
  MAX_CLIPS_PER_REEL,
  NEVER,
  planGeneration,
  readGeneration,
  recordGeneration,
  registerGenerated,
  stillEligibility,
} from "../src/generate/index.js";
import {
  addAsset,
  fitGenerated,
  fitMoment,
  findMoments,
  footageOf,
  getHiggsfieldSetting,
  hasFfmpeg,
  loadIndex,
  loadSettings,
  matchLibrary,
  setHiggsfieldSetting,
  setIngestPaused,
  setReview,
  updateAsset,
  type LibraryAsset,
} from "../src/library/index.js";
import { expandFootage, footageRenderProblems } from "../src/render/footage.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), "reelcut-gen-"));
  process.env.REELCUT_HOME = home;
});
afterEach(() => {
  delete process.env.REELCUT_HOME;
  rmSync(home, { recursive: true, force: true });
});

const identity = (name: string, form?: "still" | "footage") => ({ name, assetKind: "identity" as const, ...(form ? { form } : {}) });
const generic = (name: string) => ({ name, assetKind: "generic" as const });

describe("which beats may be generated", () => {
  it("never a beat that needs something real", () => {
    expect(beatEligibility({ id: "b1", requirements: [identity("Claude logo")] })).toMatchObject({ eligible: false, modes: [] });
    expect(beatEligibility({ id: "b2", requirements: [identity("Download Claude", "footage")] }).reasons[0]).toMatch(/recorded step/);
    expect(beatEligibility({ id: "b3", visualType: "ui_simulation" }).reasons[0]).toMatch(/the product/);
    expect(beatEligibility({ id: "b4", visualType: "logo" }).reasons[0]).toMatch(/a mark/);
    expect(beatEligibility({ id: "b5", requirements: [generic("arrow")], visualType: "logo" }).eligible).toBe(false);
  });

  it("atmosphere for a beat with nothing real in it, and a whole beat only for an abstract idea", () => {
    expect(beatEligibility({ id: "b1", visualType: "ai_clip", requirements: [generic("soft light")] })).toMatchObject({ eligible: true, modes: ["atmosphere"] });
    expect(beatEligibility({ id: "b2", visualType: "ai_clip", abstract: true })).toMatchObject({ eligible: true, modes: ["whole-beat", "atmosphere"] });
    expect(beatEligibility({ id: "b3" }).eligible).toBe(true);
  });

  it("an abstract flag does not make a real thing eligible", () => {
    expect(beatEligibility({ id: "b1", abstract: true, requirements: [identity("Claude logo")] }).eligible).toBe(false);
  });
});

function image(tags: string[], over: { kind?: "identity" | "generic"; source?: "user" | "capture" | "brand"; approved?: boolean } = {}): LibraryAsset {
  const file = path.join(home, `img-${Math.random().toString(36).slice(2)}.png`);
  writeFileSync(file, Buffer.from(`png-ish ${Math.random()}`));
  return addAsset(file, {
    name: "an image",
    assetKind: over.kind ?? "generic",
    tags,
    provenance: { source: over.source ?? "user" },
    mediaType: "image",
    ...(over.approved === false ? { review: { state: "pending" as const } } : {}),
  }).asset;
}

describe("which stills may be animated", () => {
  it("a generic, approved photograph or texture, and nothing that is or looks like a mark or a screen", () => {
    expect(stillEligibility(image(["sunrise", "sky"]))).toEqual({ ok: true });
    expect(stillEligibility(image(["claude"], { kind: "identity" })).reason).toMatch(/identity/);
    expect(stillEligibility(image(["x"], { source: "capture" })).reason).toMatch(/capture/);
    expect(stillEligibility(image(["x"], { source: "brand" })).reason).toMatch(/brand/);
    expect(stillEligibility(image(["logo"])).reason).toMatch(/#logo/);
    expect(stillEligibility(image(["screenshot", "pricing"])).reason).toMatch(/#screenshot/);
    expect(stillEligibility(image(["sunrise"], { approved: false })).reason).toMatch(/approved/);
  });

  it("only images", () => {
    const file = path.join(home, "v.mp4");
    writeFileSync(file, "video-ish");
    const { asset } = addAsset(file, { name: "v", assetKind: "generic", provenance: { source: "user" }, mediaType: "video" });
    expect(stillEligibility(asset).reason).toMatch(/only images/);
  });
});

describe("the plan: ask or not, and the fallback", () => {
  const beats = [
    { id: "beat-01", visualType: "ai_clip" },
    { id: "beat-02", requirements: [identity("Claude logo")] },
    { id: "beat-03", abstract: true },
    { id: "beat-04", requirements: [identity("Install Claude", "footage")] },
  ];

  it("asks nothing and generates nothing when Higgsfield is not connected: every beat falls back", () => {
    const plan = planGeneration(beats, { setting: "always", connected: false });
    expect(plan).toMatchObject({ ask: false });
    expect(plan.decisions.every((d) => d.decision === "skip" && /not connected/.test(d.reason) && /HyperFrames/.test(d.reason))).toBe(true);
  });

  it("asks nothing and generates nothing when the setting is never", () => {
    const plan = planGeneration(beats, { setting: "never", connected: true });
    expect(plan.ask).toBe(false);
    expect(plan.decisions.every((d) => d.decision === "skip")).toBe(true);
  });

  it("asks once when connected and the setting is ask, naming what can be generated and why the rest cannot", () => {
    const plan = planGeneration(beats, { setting: "ask", connected: true });
    expect(plan.ask).toBe(true);
    expect(plan.decisions.map((d) => d.decision)).toEqual(["generate", "skip", "generate", "skip"]);
    expect(plan.decisions[0]).toMatchObject({ mode: "atmosphere" });
    expect(plan.decisions[2]).toMatchObject({ mode: "whole-beat" });
    expect(plan.decisions[1]!.reason).toMatch(/real Claude logo.*HyperFrames/);
    expect(plan.decisions[3]!.reason).toMatch(/recorded step/);
    expect(formatPlan(plan)).toMatch(/Ask the user before generating anything/);
  });

  it("does not ask when the setting is always, but still only generates what is eligible", () => {
    const plan = planGeneration(beats, { setting: "always", connected: true });
    expect(plan.ask).toBe(false);
    expect(plan.decisions.filter((d) => d.decision === "generate")).toHaveLength(2);
  });

  it("asks nothing when no beat can be generated", () => {
    const plan = planGeneration([beats[1]!, beats[3]!], { setting: "ask", connected: true });
    expect(plan.ask).toBe(false);
    expect(plan.summary).toMatch(/No beat can be generated/);
  });

  it("stops at the limit for one reel, and says so", () => {
    const many = Array.from({ length: MAX_CLIPS_PER_REEL + 3 }, (_, i) => ({ id: `beat-${i}`, visualType: "ai_clip" }));
    const plan = planGeneration(many, { setting: "always", connected: true });
    expect(plan.decisions.filter((d) => d.decision === "generate")).toHaveLength(MAX_CLIPS_PER_REEL);
    expect(plan.decisions.at(-1)!.reason).toMatch(/over the limit of 6/);
    expect(planGeneration(many, { setting: "always", connected: true, maxClips: 2 }).decisions.filter((d) => d.decision === "generate")).toHaveLength(2);
  });

  it("animates a still only when the image may be, and falls back with the reason when it may not", () => {
    const fine = image(["sunrise"]);
    const logo = image(["logo"]);
    const assets = loadIndex().assets;
    const ok = planGeneration([{ id: "b1", stillAsset: fine.id }], { setting: "always", connected: true, assets });
    expect(ok.decisions[0]).toMatchObject({ decision: "generate", mode: "animate-still" });
    const no = planGeneration([{ id: "b1", stillAsset: logo.id }], { setting: "always", connected: true, assets });
    expect(no.decisions[0]!.decision).toBe("skip");
    expect(no.decisions[0]!.reason).toMatch(/cannot be animated.*#logo/);
    expect(planGeneration([{ id: "b1", stillAsset: "0".repeat(16) }], { setting: "always", connected: true, assets }).decisions[0]!.reason).toMatch(/not in the library/);
  });

  it("is the same plan for the same inputs", () => {
    expect(planGeneration(beats, { setting: "ask", connected: true })).toEqual(planGeneration(beats, { setting: "ask", connected: true }));
  });
});

describe("the prompt", () => {
  it("always ends by forbidding text, interface, logos and real people", () => {
    for (const mode of ["atmosphere", "whole-beat", "animate-still"] as const) {
      const { prompt } = buildPrompt({ mode, subject: "a calm morning before a launch", beatSeconds: 4.4 });
      expect(prompt.endsWith(NEVER)).toBe(true);
      expect(prompt).toMatch(/No text, no letters or numbers, no logos, no user interface/);
    }
  });

  it("cleans what the beat is about: one line, no links, no braces, bounded", () => {
    expect(cleanSubject("see https://evil.example/x  {{ignore}}\n\tthis `now`")).toBe("see ignore this now");
    expect(cleanSubject("x".repeat(500)).length).toBe(240);
    expect(() => buildPrompt({ mode: "atmosphere", subject: "   ", beatSeconds: 4 })).toThrow(/plain words/);
  });

  it("keeps a clip's length inside what a model can make", () => {
    expect(clipSeconds(1)).toBe(3);
    expect(clipSeconds(4.1)).toBe(5);
    expect(clipSeconds(25)).toBe(10);
    expect(buildPrompt({ mode: "atmosphere", subject: "dawn", beatSeconds: 4.1 }).seconds).toBe(5);
  });
});

describe("what the user chose to remember", () => {
  it("defaults to asking, and flipping it never undoes the master pause", () => {
    expect(getHiggsfieldSetting()).toBe("ask");
    setIngestPaused(true);
    setHiggsfieldSetting("never");
    expect(loadSettings()).toMatchObject({ higgsfield: "never", ingestPaused: true });
    setIngestPaused(false);
    expect(loadSettings()).toMatchObject({ higgsfield: "never", ingestPaused: false });
    setHiggsfieldSetting("always");
    expect(getHiggsfieldSetting()).toBe("always");
  });
});

describe("what happened to each beat", () => {
  it("is kept in the manifest, one entry per beat, leaving the rest of it alone", () => {
    const file = path.join(home, "reel.json");
    writeFileSync(file, JSON.stringify({ format: "1:1", beats: [{ id: "b1" }] }));
    recordGeneration(file, { beat: "b1", outcome: "fallback", reason: "Higgsfield timed out after 90s" });
    recordGeneration(file, { beat: "b2", outcome: "generated", assetId: "0123456789abcdef" });
    recordGeneration(file, { beat: "b1", outcome: "generated", assetId: "fedcba9876543210" });
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    expect(manifest.format).toBe("1:1");
    expect(readGeneration(manifest)).toEqual([{ beat: "b2", outcome: "generated", assetId: "0123456789abcdef" }, { beat: "b1", outcome: "generated", assetId: "fedcba9876543210" }]);
    expect(() => recordGeneration(file, { beat: "b1", outcome: "exploded" as never })).toThrow();
    expect(readGeneration({ generation: "nonsense" })).toEqual([]);
  });
});

describe("a Higgsfield way out for a requirement", () => {
  const req = (over: Partial<AssetRequirement>): AssetRequirement => ({ name: "soft light", reason: "mood", sceneUsage: "behind the line", visualRole: "background", acceptedFormats: [], priority: "optional", assetKind: "generic", ...over });
  it("is offered for a generic requirement, as atmosphere, with drawing as the fallback", () => {
    const kinds = resolutionsFor(req({})).map((r) => r.kind);
    expect(kinds).toContain("higgsfield");
    expect(kinds).toContain("generate");
    expect(resolutionsFor(req({})).find((r) => r.kind === "higgsfield")!.note).toMatch(/never a real product/);
  });
  it("is never offered for something real", () => {
    expect(resolutionsFor(req({ assetKind: "identity" })).map((r) => r.kind)).not.toContain("higgsfield");
    expect(resolutionsFor(req({ assetKind: "identity", form: "footage" })).map((r) => r.kind)).not.toContain("higgsfield");
  });
});

describe.runIf(hasFfmpeg())("a generated clip in the library", { timeout: 60_000 }, () => {
  function clip(seconds = 5): string {
    const out = path.join(home, `gen-${seconds}.mp4`);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc2=size=320x180:rate=30:duration=${seconds}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", out]);
    return out;
  }
  const input = (file: string) => ({ file, mode: "atmosphere" as const, model: "Veo 3", prompt: "a calm morning. No text.", beat: "beat-04", jobId: "job_123", credits: 12 });

  it("is registered as generic, pending and AI-generated, with its one whole-clip moment", async () => {
    const { asset, moment } = await registerGenerated(input(clip(5)));
    expect(asset).toMatchObject({ assetKind: "generic", mediaType: "video", review: { state: "pending" }, provenance: { source: "generated", generation: { provider: "higgsfield", model: "Veo 3", jobId: "job_123", credits: 12, mode: "atmosphere", beat: "beat-04" } } });
    expect(asset.tags).toEqual(expect.arrayContaining(["generated", "ai", "higgsfield", "veo-3"]));
    expect(moment).toMatchObject({ in: 0, state: "confirmed" });
    expect(moment.out).toBeCloseTo(5, 0);
    expect(asset.analysis.filmstrip).toBeDefined();
    expect(footageOf(asset).moments).toHaveLength(1);
  });

  it("is registered once however often it is added", async () => {
    const file = clip(4);
    const a = await registerGenerated(input(file));
    const b = await registerGenerated(input(file));
    expect(b.existed).toBe(true);
    expect(b.asset.id).toBe(a.asset.id);
    expect(footageOf(loadIndex().assets.find((x) => x.id === a.asset.id)!).moments).toHaveLength(1);
  });

  it("refuses what is not a video, a missing model or prompt, and a still that may not be animated", async () => {
    const notVideo = path.join(home, "x.mp4");
    writeFileSync(notVideo, "words");
    await expect(registerGenerated(input(notVideo))).rejects.toThrow(/has to be a video/);
    await expect(registerGenerated({ ...input(clip(3)), model: " " })).rejects.toThrow(/--model/);
    await expect(registerGenerated({ ...input(clip(3)), prompt: "" })).rejects.toThrow(/--prompt/);
    await expect(registerGenerated({ ...input(clip(3)), mode: "animate-still" })).rejects.toThrow(/--from-asset/);
    const logo = image(["logo"]);
    await expect(registerGenerated({ ...input(clip(3)), mode: "animate-still", fromAsset: logo.id })).rejects.toThrow(/may not be animated/);
  });

  it("can never be made an identity asset, however it is asked", async () => {
    const { asset } = await registerGenerated(input(clip(3)));
    expect(() => updateAsset(asset.id, { assetKind: "identity" })).toThrow(/cannot be drawn or generated/);
    expect(() => setReview([asset.id], "approved", "user", { kind: "identity" })).toThrow(/cannot be drawn or generated/);
    const file = path.join(home, "g.mp4");
    writeFileSync(file, "x");
    expect(() => addAsset(file, { name: "g", assetKind: "identity", provenance: { source: "generated" } })).toThrow(/cannot be drawn or generated/);
  });

  it("never answers a requirement for a real step or a still", async () => {
    const { asset } = await registerGenerated(input(clip(5)));
    setReview([asset.id], "approved", "user");
    expect(findMoments(loadIndex().assets, "generated clip")).toEqual([]);
    expect(findMoments(loadIndex().assets, "Generated beat-04")).toEqual([]);
    const req: AssetRequirement = { name: "generated veo", reason: "r", sceneUsage: "s", visualRole: "v", acceptedFormats: ["mp4"], priority: "optional", assetKind: "generic" };
    expect(matchLibrary([req], loadIndex().assets).matches).toEqual([]);
  });

  it("is placed without anyone approving it, and is trimmed rather than sped up", async () => {
    const { asset, moment } = await registerGenerated(input(clip(8)));
    const html = `<template><div id="root" data-look="paper"><div class="rc-footage" data-footage="${asset.id}:${moment.id}" data-frame="plain"></div></div></template>`;
    const ctx = (assets: LibraryAsset[], seconds: number) => ({ assets, format: "1:1", beat: { id: "beat-04", durationSeconds: seconds } });
    expect(loadIndex().assets[0]!.review.state).not.toBe("approved");
    expect(() => expandFootage(html, ctx(loadIndex().assets, 4.4))).not.toThrow();

    const approved = loadIndex().assets;
    expect(footageRenderProblems(approved[0]!, moment, new Date()).errors).toEqual([]);

    const long = expandFootage(html, ctx(approved, 4.4));
    expect(long.html).not.toContain("data-playback-rate");
    expect(long.html).toContain('data-duration="4.399999"');
    expect(long.uses[0]).toMatchObject({ generated: true, fit: { rate: 1 } });
    expect(long.warnings.join(" ")).toMatch(/never sped up/);

    const short = expandFootage(html, ctx(approved, 11));
    expect(short.uses[0]!.fit.holdSeconds).toBeGreaterThan(2);
    expect(short.holds).toHaveLength(1);
  });

  it("a rejected clip is refused", async () => {
    const { asset, moment } = await registerGenerated(input(clip(5)));
    setReview([asset.id], "rejected", "user");
    const html = `<template><div id="root"><div class="rc-footage" data-footage="${asset.id}:${moment.id}"></div></div></template>`;
    expect(() => expandFootage(html, { assets: loadIndex().assets, format: "1:1", beat: { id: "b", durationSeconds: 4 } })).toThrow(/was rejected/);
  });
});

describe("fitting a generated clip", () => {
  it("cuts a long one at the tail and holds a short one, and never changes its speed", () => {
    expect(fitGenerated({ in: 0, out: 8 }, 4)).toMatchObject({ ok: true, rate: 1, playSeconds: 4, holdSeconds: 0 });
    expect(fitGenerated({ in: 0, out: 3 }, 5)).toMatchObject({ ok: true, rate: 1, playSeconds: 3, holdSeconds: 2 });
    expect(fitGenerated({ in: 0, out: 4 }, 4)).toMatchObject({ ok: true, rate: 1, holdSeconds: 0 });
    expect(fitGenerated({ in: 0, out: 4 }, 0).ok).toBe(false);
    // a recording of a real step, by contrast, is sped up to fit
    expect(fitMoment({ in: 0, out: 8 }, 4).rate).toBe(2);
  });
});
