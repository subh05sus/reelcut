import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EVENT_TAGS, loadSfxPack, packAsAssets, packSoundPath, proposeCues, resolveCue, searchSfx, SFX_CATEGORIES, type LibraryAsset } from "../src/library/index.js";

const pack = loadSfxPack()!;
const packAssets = packAsAssets(pack);

describe("the bundled sound pack", () => {
  it("ships over three hundred CC0 sounds, every file present, in every category", () => {
    expect(pack.sounds.length).toBeGreaterThanOrEqual(300);
    for (const s of pack.sounds) {
      expect(existsSync(packSoundPath(pack, s)), s.file).toBe(true);
      expect(s.source.licence).toBe("CC0 1.0");
      expect(s.source.url).toMatch(/^https:\/\/(kenney\.nl|opengameart\.org)\//);
    }
    for (const c of SFX_CATEGORIES) expect(pack.sounds.filter((s) => s.category === c).length, c).toBeGreaterThanOrEqual(10);
  });

  it("never clips, and knows how loud each sound is", () => {
    for (const s of pack.sounds) {
      expect(s.peakDb, s.id).toBeLessThanOrEqual(-0.5);
      expect(Number.isFinite(s.gainDb), s.id).toBe(true);
    }
  });

  it("has several sounds for every kind of moment, so a reel never repeats one", () => {
    for (const event of Object.keys(EVENT_TAGS)) {
      expect(searchSfx(packAssets, { event }).length, event).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("picking from your sounds and the pack", () => {
  const mine: LibraryAsset = { ...packAssets.find((a) => a.id === "pack:click-01")!, id: "0123456789abcdef", name: "My click", tags: ["click", "tap", "tick"] };

  it("prefers your own sound on a tie", () => {
    const [best] = searchSfx([...packAssets, mine], { event: "click" });
    expect(best!.asset.id).toBe("0123456789abcdef");
  });

  it("writes a pack sound as pack:<id> and yours as library:<id>", () => {
    const beats = [{ id: "beat-01", durationSeconds: 4, events: [{ type: "click", at: 1 }, { type: "reveal", at: 2 }] }];
    const props = proposeCues(beats, [...packAssets, mine]);
    expect(props.find((p) => p.event === "click")!.source).toBe("library:0123456789abcdef");
    expect(props.find((p) => p.event === "reveal")!.source).toMatch(/^pack:/);
  });

  it("varies among equally good sounds by reel, and repeats exactly for the same reel", () => {
    const beats = [{ id: "beat-01", durationSeconds: 4, events: [{ type: "click", at: 1 }] }];
    const pick = (seed: string) => proposeCues(beats, packAssets, { seed })[0]!.soundId;
    expect(pick("reel-a")).toBe(pick("reel-a"));
    const seen = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((s) => pick(`reel-${s}`)));
    expect(seen.size).toBeGreaterThan(2);
  });

  it("gives a typing moment a sound about as long as the typing", () => {
    const [best] = searchSfx(packAssets, { event: "type", wantSeconds: 2.2 });
    expect(best!.asset.id).toMatch(/typing-run/);
    expect(Math.abs(best!.asset.analysis.durationSeconds! - 2.2)).toBeLessThan(0.6);
  });
});

describe("a pack cue at render time", () => {
  const deps = { assets: [], blobPath: () => "", exists: existsSync, resolveFile: (s: string) => s, probe: () => 1, defaultVolume: 0.35, pack };

  it("resolves to the bundled file at a level matched to its loudness", () => {
    const r = resolveCue({ source: "pack:thud-01", at: 0.5 }, { id: "beat-01", durationSeconds: 4 }, deps)!;
    expect(r.source).toBe(packSoundPath(pack, pack.byId.get("thud-01")!));
    expect(r.volume).toBeGreaterThan(0.05);
    expect(r.volume).toBeLessThanOrEqual(1);
    expect(r.durationSeconds).toBeCloseTo(pack.byId.get("thud-01")!.durationSeconds, 3);
  });

  it("refuses a sound the pack does not have", () => {
    expect(() => resolveCue({ source: "pack:nope", at: 0 }, { id: "beat-01", durationSeconds: 4 }, deps)).toThrow(/not a sound in the bundled pack/);
  });

  it("never runs past the end of its beat", () => {
    const r = resolveCue({ source: "pack:riser-04", at: 2.5 }, { id: "beat-01", durationSeconds: 3 }, deps)!;
    expect(r.durationSeconds).toBeCloseTo(0.5, 5);
  });
});
