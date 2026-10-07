import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EVENT_TAGS, isUsableSound, proposeCues, searchSfx, type LibraryAsset, type RcEvent } from "../src/library/index.js";

const sound = (id: string, tags: string[], over: Partial<LibraryAsset> & { seconds?: number; gainDb?: number } = {}): LibraryAsset => {
  const { seconds = 0.2, gainDb, ...rest } = over;
  return {
    id: id.padEnd(16, "0"), name: `sound ${id}`, file: `files/${id}.wav`, ext: "wav", bytes: 1, sha256: "0".repeat(64), assetKind: "generic", tags, provenance: { source: "user" },
    addedAt: "2026-09-01T00:00:00.000Z", usedIn: [], status: "active", mediaType: "audio", analysis: { dominantColors: [], descriptors: [], durationSeconds: seconds, ...(gainDb === undefined ? {} : { gainDb }) },
    review: { state: "approved", by: "user" }, tagOrigin: {}, private: false, ...rest,
  };
};

describe("which sounds a reel may use", () => {
  it("only approved, active audio", () => {
    expect(isUsableSound(sound("a", ["click"]))).toBe(true);
    expect(isUsableSound(sound("a", ["click"], { review: { state: "pending" } }))).toBe(false);
    expect(isUsableSound(sound("a", ["click"], { review: { state: "rejected" } }))).toBe(false);
    expect(isUsableSound(sound("a", ["click"], { status: "retired" }))).toBe(false);
    expect(isUsableSound(sound("a", ["click"], { mediaType: "image" }))).toBe(false);
  });
});

describe("searchSfx", () => {
  const library = [
    sound("click1", ["click", "sfx"], { seconds: 0.08 }),
    sound("tick1", ["tick", "sfx"], { seconds: 0.05 }),
    sound("pending", ["click"], { review: { state: "pending" } }),
    sound("long", ["click"], { seconds: 4 }),
    sound("whoosh1", ["whoosh"], { seconds: 1.2 }),
  ];

  it("ranks the best-fitting word first, and leaves out the unreviewed and the too long", () => {
    const found = searchSfx(library, { event: "click" });
    expect(found.map((m) => m.asset.id.replace(/0+$/, ""))).toEqual(["click1", "tick1"]);
    expect(found[0]!.why).toContain("#click");
  });

  it("finds by tags and a length limit", () => {
    expect(searchSfx(library, { tags: ["whoosh"] }).map((m) => m.asset.id.replace(/0+$/, ""))).toEqual(["whoosh1"]);
    expect(searchSfx(library, { tags: ["whoosh"], maxSeconds: 1 })).toEqual([]);
    expect(searchSfx(library, {})).toEqual([]);
  });

  it("trusts a person's tag more than a machine's guess, and passes over what was used", () => {
    const guessed = sound("guess", ["click"], { tagOrigin: { click: "auto" } });
    const mine = sound("mine", ["click"], { tagOrigin: { click: "user" } });
    expect(searchSfx([guessed, mine], { event: "click" })[0]!.asset.id).toBe(mine.id);
    const worn = sound("worn", ["click"], { usedIn: ["a", "b", "c", "d"] });
    expect(searchSfx([worn, mine], { event: "click" })[0]!.asset.id).toBe(mine.id);
    expect(searchSfx([mine, guessed], { event: "click", avoid: new Set([mine.id]) })[0]!.asset.id).toBe(guessed.id);
  });

  it("knows the words for each kind of moment", () => {
    for (const e of ["click", "type", "count", "roll", "pop", "reveal", "hit"]) expect(EVENT_TAGS[e]!.length).toBeGreaterThan(1);
  });
});

describe("proposeCues", () => {
  const sounds = [sound("click1", ["click"], { gainDb: 3 }), sound("click2", ["click"]), sound("type1", ["type"], { seconds: 2 }), sound("whoosh1", ["whoosh"], { seconds: 1 }), sound("hit1", ["hit"], { seconds: 1 }), sound("tick1", ["tick"])];
  const beat = (id: string, events: RcEvent[], durationSeconds = 5) => ({ id, durationSeconds, events });

  it("proposes the moments the beat has, in time order, with the gain and the length", () => {
    const out = proposeCues([beat("b1", [{ type: "click", at: 2.1 }, { type: "type", at: 1.2, duration: 1.5 }])], sounds);
    expect(out.map((p) => [p.event, p.at])).toEqual([["type", 1.2], ["click", 2.1]]);
    expect(out[1]).toMatchObject({ gainDb: 3 });
    expect(out[0]!.durationSeconds).toBe(1.5);
  });

  it("is quiet: three cues at most a beat, and a run of the same event is one moment", () => {
    const events: RcEvent[] = [{ type: "roll", at: 1 }, { type: "roll", at: 1.5 }, { type: "roll", at: 2 }, { type: "click", at: 3 }, { type: "reveal", at: 0.5 }, { type: "type", at: 0.2, duration: 1 }, { type: "pop", at: 4 }];
    const out = proposeCues([beat("b1", events)], sounds);
    expect(out.length).toBeLessThanOrEqual(3);
    expect(out.filter((p) => p.event === "roll").length).toBeLessThanOrEqual(1);
    // The strongest moments are kept: the click and the reveal outrank a typing run or a roll.
    expect(out.map((p) => p.event)).toEqual(expect.arrayContaining(["click", "reveal"]));
  });

  it("does not reuse a sound while another fits, and ignores events past the end of the beat", () => {
    const out = proposeCues([beat("b1", [{ type: "click", at: 1 }]), beat("b2", [{ type: "click", at: 1 }, { type: "click", at: 9 }])], sounds);
    expect(out).toHaveLength(2);
    expect(new Set(out.map((p) => p.soundId)).size).toBe(2);
  });

  it("proposes a sound for the hard cut only when asked, and never for the first beat", () => {
    const beats = [beat("b1", []), beat("b2", [])];
    expect(proposeCues(beats, sounds)).toEqual([]);
    const cuts = proposeCues(beats, sounds, { cuts: true });
    expect(cuts.map((p) => [p.beat, p.event, p.at])).toEqual([["b2", "cut", 0]]);
  });

  it("proposes nothing when no approved sound fits", () => {
    expect(proposeCues([beat("b1", [{ type: "click", at: 1 }])], [sound("p", ["click"], { review: { state: "pending" } })])).toEqual([]);
  });
});

describe("the kit records the moments a sound could go with", () => {
  const kitJs = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "skills", "reelcut", "assets", "kit", "kit.js"), "utf8");

  function load(): { RC: Record<string, (...args: unknown[]) => unknown>; events: RcEvent[]; tl: unknown } {
    const el = { style: {}, textContent: "42", parentNode: { querySelector: () => null }, appendChild: () => undefined, matches: () => false, closest: () => null };
    const document = { querySelectorAll: () => [el], createElement: () => ({ style: {}, appendChild: () => undefined }), body: {} };
    const tl: unknown = new Proxy({}, { get: () => () => tl });
    const window: Record<string, unknown> = { gsap: { set: () => undefined } };
    new Function("window", "document", kitJs)(window, document);
    return { RC: window.RC as never, events: window.__rcEvents as RcEvent[], tl };
  }

  it("notes a click, typing, a count, rolls, a pop and a reveal, with their times", () => {
    const { RC, events, tl } = load();
    RC.click!(tl, null, 2.1, {});
    RC.type!(tl, "#x", 1.2, { text: "hello", cps: 10 });
    RC.count!(tl, "#x", 0.5, { from: 0, to: 9, duration: 1 });
    RC.roll!(tl, "#x", 3, { values: ["a", "b", "c"], each: 0.5 });
    RC.pop!(tl, "#x", 4);
    RC.iris!(tl, "#x", 4.5);
    expect(events).toEqual([
      { type: "click", at: 2.1 },
      { type: "type", at: 1.2, duration: 0.5, text: "hello" },
      { type: "count", at: 0.5, duration: 1 },
      { type: "roll", at: 3 },
      { type: "roll", at: 3.5 },
      { type: "pop", at: 4 },
      { type: "reveal", at: 4.5 },
    ]);
  });
});

describe("resolveCue: a manifest cue, ready to mix", async () => {
  const { resolveCue } = await import("../src/library/index.js");
  const deps = (assets: LibraryAsset[], present = true) => ({ assets, blobPath: (a: LibraryAsset) => `/lib/${a.file}`, exists: () => present, resolveFile: (s: string) => `/reel/${s}`, probe: () => 2, defaultVolume: 0.35 });
  const beat = { id: "beat-01", durationSeconds: 4 };
  const clack = sound("abcd1234", ["click"], { seconds: 0.4, gainDb: 6 });

  it("plays a library sound at the default level plus the gain it was measured with, never louder than full", () => {
    const cue = resolveCue({ source: `library:${clack.id}`, at: 1 }, beat, deps([clack]))!;
    expect(cue).toMatchObject({ source: `/lib/${clack.file}`, at: 1, durationSeconds: 0.4, libraryId: clack.id });
    expect(cue.volume).toBeCloseTo(0.35 * 10 ** (6 / 20), 3);
    expect(resolveCue({ source: `library:${clack.id}`, at: 1 }, beat, deps([sound("abcd1234", ["click"], { gainDb: 12 })]))!.volume).toBe(1);
    // A volume in the manifest wins.
    expect(resolveCue({ source: `library:${clack.id}`, at: 1, volume: 0.2 }, beat, deps([clack]))!.volume).toBe(0.2);
  });

  it("clips a cue to the end of its beat, and drops one with no room", () => {
    expect(resolveCue({ source: `library:${clack.id}`, at: 3.8 }, beat, deps([clack]))!.durationSeconds).toBeCloseTo(0.2, 5);
    expect(resolveCue({ source: `library:${clack.id}`, at: 3.97 }, beat, deps([clack]))).toBeNull();
  });

  it("resolves a plain file against the manifest and probes its length", () => {
    expect(resolveCue({ source: "sfx/whoosh.ogg", at: 0.5 }, beat, deps([]))).toMatchObject({ source: "/reel/sfx/whoosh.ogg", durationSeconds: 2, warnings: [] });
  });

  it("refuses what cannot be used: not in the library, not a sound, rejected, or its file gone", () => {
    expect(() => resolveCue({ source: "library:ffffffffffffffff", at: 0 }, beat, deps([clack]))).toThrow(/not a sound in the library/);
    expect(() => resolveCue({ source: `library:${clack.id}`, at: 0 }, beat, deps([sound("abcd1234", ["x"], { mediaType: "image" })]))).toThrow(/not a sound/);
    expect(() => resolveCue({ source: `library:${clack.id}`, at: 0 }, beat, deps([sound("abcd1234", ["x"], { review: { state: "rejected" } })]))).toThrow(/rejected/);
    expect(() => resolveCue({ source: `library:${clack.id}`, at: 0 }, beat, deps([clack], false))).toThrow(/not a sound in the library/);
  });

  it("warns, but still plays, a sound nobody has reviewed", () => {
    const cue = resolveCue({ source: `library:${clack.id}`, at: 0 }, beat, deps([sound("abcd1234", ["click"], { review: { state: "pending" } })]))!;
    expect(cue.warnings[0]).toContain("has not been reviewed");
  });
});
