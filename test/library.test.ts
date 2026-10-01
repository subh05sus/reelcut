import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AssetRequirement } from "../src/brief/assetRequirementTypes.js";
import {
  addAsset,
  annotateAsset,
  blockReason,
  insertPrepared,
  libraryRefsIn,
  libraryRoot,
  listRuns,
  loadIndex,
  matchLibrary,
  mutateIndex,
  recordRun,
  recordUse,
  setReview,
  updateAsset,
  LibraryError,
  type LibraryAsset,
  type PreparedAsset,
} from "../src/library/index.js";

let home: string;
let work: string;

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), "reelcut-home-"));
  work = mkdtempSync(path.join(os.tmpdir(), "reelcut-work-"));
  process.env.REELCUT_HOME = home;
});

afterEach(() => {
  delete process.env.REELCUT_HOME;
  rmSync(home, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

function file(name: string, contents = name): string {
  const p = path.join(work, name);
  writeFileSync(p, contents);
  return p;
}

function req(name: string, over: Partial<AssetRequirement> = {}): AssetRequirement {
  return { name, reason: "r", sceneUsage: "s", visualRole: "v", acceptedFormats: ["svg", "png"], priority: "required", assetKind: "identity", ...over };
}

function asset(over: Partial<LibraryAsset> = {}): LibraryAsset {
  return {
    id: "0123456789abcdef",
    name: "Claude Logo",
    file: "files/0123456789abcdef.svg",
    ext: "svg",
    bytes: 10,
    sha256: "0".repeat(64),
    assetKind: "identity",
    tags: [],
    provenance: { source: "brand", url: "https://anthropic.com/brand" },
    addedAt: "2026-09-01T00:00:00.000Z",
    usedIn: [],
    status: "active",
    mediaType: "vector",
    analysis: { dominantColors: [], descriptors: [] },
    review: { state: "approved", by: "legacy" },
    tagOrigin: {},
    private: false,
    ...over,
  };
}

const NOW = new Date("2026-09-30T00:00:00.000Z");

describe("addAsset", () => {
  it("stores the bytes once and merges tags when the same file is added again", () => {
    const first = addAsset(file("claude-logo.svg", "<svg/>"), { name: "Claude Logo", assetKind: "identity", tags: ["Claude"], provenance: { source: "brand", url: "https://anthropic.com" } });
    const again = addAsset(file("copy.svg", "<svg/>"), { name: "Other", assetKind: "identity", tags: ["logo", "claude"], provenance: { source: "user" } });

    expect(again.existed).toBe(true);
    expect(again.asset.id).toBe(first.asset.id);
    expect(loadIndex().assets).toHaveLength(1);
    expect(loadIndex().assets[0]!.tags).toEqual(["claude", "logo"]);
    // Provenance recorded first is kept.
    expect(loadIndex().assets[0]!.provenance.url).toBe("https://anthropic.com");
    expect(readdirSync(path.join(libraryRoot(), "files"))).toHaveLength(1);
  });

  it("copies rather than links, so the source can be deleted", () => {
    const src = file("mark.png", "png-bytes");
    const { asset: a } = addAsset(src, { name: "Mark", assetKind: "generic", provenance: { source: "user" } });
    rmSync(src);
    expect(readFileSync(path.join(libraryRoot(), a.file), "utf8")).toBe("png-bytes");
  });

  it("refuses a drawn identity asset", () => {
    expect(() => addAsset(file("fake.svg"), { name: "Fake", assetKind: "identity", provenance: { source: "drawn" } })).toThrow(LibraryError);
  });
});

describe("index integrity", () => {
  it("backs up and refuses an index that does not parse, instead of replacing it", () => {
    addAsset(file("a.svg"), { name: "A", assetKind: "generic", provenance: { source: "user" } });
    const index = path.join(libraryRoot(), "index.json");
    writeFileSync(index, "{ not json");
    expect(() => loadIndex()).toThrow(/not valid/);
    expect(readFileSync(index, "utf8")).toBe("{ not json");
    expect(readdirSync(libraryRoot()).some((f) => f.startsWith("index.json.bak-"))).toBe(true);
  });

  it("leaves the index untouched when a mutation throws", () => {
    addAsset(file("a.svg"), { name: "A", assetKind: "generic", provenance: { source: "user" } });
    const before = readFileSync(path.join(libraryRoot(), "index.json"), "utf8");
    expect(() =>
      mutateIndex((index) => {
        index.assets = [];
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(readFileSync(path.join(libraryRoot(), "index.json"), "utf8")).toBe(before);
    expect(existsSync(path.join(libraryRoot(), "index.json.lock"))).toBe(false);
  });
});

describe("updateAsset", () => {
  it("adds and removes tags, and supersedes", () => {
    const { asset: old } = addAsset(file("old.svg", "1"), { name: "Old", assetKind: "identity", tags: ["chatgpt", "v1"], provenance: { source: "user" } });
    const { asset: fresh } = addAsset(file("new.svg", "2"), { name: "New", assetKind: "identity", provenance: { source: "user" } });
    expect(updateAsset(old.id, { addTags: ["OpenAI"], removeTags: ["v1"] }).tags).toEqual(["chatgpt", "openai"]);
    const superseded = updateAsset(old.id, { supersededBy: fresh.id });
    expect(superseded.status).toBe("superseded");
    expect(() => updateAsset(old.id, { supersededBy: "ffffffffffffffff" })).toThrow(/no asset/);
  });
});

describe("the reuse policy", () => {
  it("applies an exact identity match with a recorded source", () => {
    const [m] = matchLibrary([req("Claude Logo")], [asset()], { now: NOW }).matches;
    expect(m).toMatchObject({ decision: "auto", confidence: "exact" });
  });

  it("matches on tags as well as the name", () => {
    const tagged = asset({ name: "Mark", tags: ["chatgpt", "logo"], provenance: { source: "user" } });
    expect(matchLibrary([req("ChatGPT Logo")], [tagged], { now: NOW }).matches[0]?.decision).toBe("auto");
  });

  it("only proposes an identity asset with no recorded source", () => {
    const orphan = asset({ provenance: { source: "brand" } });
    const [m] = matchLibrary([req("Claude Logo")], [orphan], { now: NOW }).matches;
    expect(m?.decision).toBe("proposal");
    expect(m?.why).toMatch(/no recorded source/);
  });

  it("only proposes a capture older than 90 days", () => {
    const stale = asset({ name: "Dashboard Screen", ext: "png", provenance: { source: "capture", url: "https://x", capturedAt: "2026-05-01T00:00:00Z" } });
    expect(blockReason(stale, "exact", NOW)).toMatch(/captured 152 days ago/);
    expect(matchLibrary([req("Dashboard")], [stale], { now: NOW }).matches[0]?.decision).toBe("proposal");
  });

  it("never offers a superseded or retired asset", () => {
    const result = matchLibrary([req("Claude Logo")], [asset({ status: "superseded" }), asset({ id: "1111111111111111", status: "retired" })], { now: NOW });
    expect(result.matches).toEqual([]);
    expect(result.stillOpen).toHaveLength(1);
  });

  it("never answers an identity requirement with a generic asset", () => {
    expect(matchLibrary([req("Arrow")], [asset({ name: "Arrow", assetKind: "generic" })], { now: NOW }).matches).toEqual([]);
  });

  it("narrows to the tags asked for", () => {
    const claude = asset({ tags: ["claude"] });
    const other = asset({ id: "2222222222222222", tags: ["chatgpt"], name: "Logo" });
    const result = matchLibrary([req("Logo")], [claude, other], { now: NOW, tags: ["ChatGPT"] });
    expect(result.matches[0]?.asset.id).toBe("2222222222222222");
  });

  it("prefers the newest of two equal matches", () => {
    const older = asset({ addedAt: "2026-01-01T00:00:00Z" });
    const newer = asset({ id: "3333333333333333", addedAt: "2026-09-01T00:00:00Z" });
    expect(matchLibrary([req("Claude Logo")], [older, newer], { now: NOW }).matches[0]?.asset.id).toBe("3333333333333333");
  });
});

describe("runs", () => {
  it("keys a run by its folder and keeps clips a partial re-render did not touch", () => {
    const out = path.join(work, "out");
    const manifest = path.join(out, "reel.json");
    const first = recordRun({ outDir: out, manifest, beats: ["beat-00", "beat-01"], clips: ["clips/beat-00.mp4", "clips/beat-01.mp4"], master: "master.mp4", libraryAssets: [] });
    const second = recordRun({ outDir: out, manifest, beats: ["beat-01"], clips: ["clips/beat-01.mp4"], libraryAssets: ["0123456789abcdef"] });
    expect(second.id).toBe(first.id);
    const [run] = listRuns();
    expect(run?.clips).toEqual(["clips/beat-00.mp4", "clips/beat-01.mp4"]);
    expect(run?.master).toBe("master.mp4");
    expect(run?.libraryAssets).toEqual(["0123456789abcdef"]);
    expect(run?.missing).toBe(true);
  });

  it("records which runs used an asset", () => {
    const { asset: a } = addAsset(file("logo.svg"), { name: "Logo", assetKind: "generic", provenance: { source: "user" } });
    recordUse([a.id, "ffffffffffffffff"], "run1");
    const stored = loadIndex().assets[0]!;
    expect(stored.usedIn).toEqual(["run1"]);
    expect(stored.lastUsedAt).toBeDefined();
  });
});

describe("libraryRefsIn", () => {
  it("finds each referenced id once", () => {
    const html = `<img src="assets/library/0123456789abcdef.svg"><div style="background:url(assets/library/0123456789ABCDEF.svg)"></div><img src="assets/library/fedcba9876543210.png">`;
    expect(libraryRefsIn(html)).toEqual(["0123456789abcdef", "fedcba9876543210"]);
  });
});

describe("review: what has been dropped in but not yet looked at", () => {
  const pending = (over: Partial<LibraryAsset> = {}) => asset({ review: { state: "pending" }, provenance: { source: "user" }, tags: ["claude", "logo"], tagOrigin: { claude: "auto", logo: "auto" }, ...over });

  it("is only ever proposed, however exact the match", () => {
    const result = matchLibrary([req("Claude Logo")], [pending()], { now: NOW });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.decision).toBe("proposal");
    expect(result.matches[0]!.why).toContain("not reviewed yet");
  });

  it("is applied once a person approves it", () => {
    addAsset(file("claude-logo.svg", "<svg/>"), { name: "Claude Logo", assetKind: "identity", tags: ["claude"], provenance: { source: "user" }, review: { state: "pending" }, tagOrigin: { claude: "auto" } });
    const [added] = loadIndex().assets;
    expect(matchLibrary([req("Claude Logo")], loadIndex().assets, { now: NOW }).matches[0]!.decision).toBe("proposal");

    const [result] = setReview([added!.id], "approved", "user");
    expect(result!.accepted).toEqual(["claude"]);
    expect(matchLibrary([req("Claude Logo")], loadIndex().assets, { now: NOW }).matches[0]!.decision).toBe("auto");
  });

  it("never offers a rejected asset at all", () => {
    const rejected = pending({ review: { state: "rejected" } });
    expect(matchLibrary([req("Claude Logo")], [rejected], { now: NOW }).matches).toHaveLength(0);
  });

  it("does not guess that a dropped file is somebody's logo: a generic one is shown, never applied", () => {
    const dropped = pending({ assetKind: "generic" });
    const [match] = matchLibrary([req("Claude Logo")], [dropped], { now: NOW }).matches;
    expect(match!.decision).toBe("proposal");
    expect(match!.why).toContain("confirm it is the real Claude Logo");
    // Once a person has decided it is generic, it never answers an identity requirement.
    expect(matchLibrary([req("Claude Logo")], [{ ...dropped, review: { state: "approved", by: "user" } }], { now: NOW }).matches).toHaveLength(0);
  });

  it("is never made an identity asset by annotation: Claude can add tags and a description, nothing else", () => {
    addAsset(file("mark.svg", "<svg/>"), { name: "mark", assetKind: "generic", provenance: { source: "user" }, review: { state: "pending" } });
    const id = loadIndex().assets[0]!.id;
    const annotated = annotateAsset(id, { tags: ["Claude", "logo"], description: "an orange starburst mark" });
    expect(annotated.tags).toEqual(["claude", "logo"]);
    expect(annotated.tagOrigin).toEqual({ claude: "claude", logo: "claude" });
    expect(annotated.assetKind).toBe("generic");
    expect(annotated.review.state).toBe("pending");
    expect(annotated.analysis.description).toBe("an orange starburst mark");
  });

  it("keeps a person's own tags as theirs, and marks only new ones as theirs when they edit", () => {
    addAsset(file("a.svg", "<svg/>"), { name: "a", assetKind: "generic", tags: ["logo"], provenance: { source: "user" }, review: { state: "pending" }, tagOrigin: { logo: "auto" } });
    const id = loadIndex().assets[0]!.id;
    const edited = updateAsset(id, { tags: ["logo", "brand"] });
    expect(edited.tagOrigin).toEqual({ brand: "user", logo: "auto" });
  });
});

describe("a rescan does not undo a decision", () => {
  const prepared = (sha: string, over: Partial<PreparedAsset> = {}): PreparedAsset => ({
    id: sha.slice(0, 16), sha256: sha, file: `files/${sha.slice(0, 16)}.png`, ext: "png", bytes: 3, name: "dropped", assetKind: "generic", tags: ["dropped"],
    tagOrigin: { dropped: "auto" }, provenance: { source: "user" }, mediaType: "image", analysis: { dominantColors: [], descriptors: [] },
    review: { state: "pending" }, private: false, ...over,
  });
  const sha = "a".repeat(64);

  it("leaves a rejected or retired asset out when the same bytes turn up again", () => {
    mutateIndex((index) => insertPrepared(index, prepared(sha), { now: "t", respectTombstones: true }));
    setReview([sha.slice(0, 16)], "rejected", "user");
    const again = mutateIndex((index) => insertPrepared(index, prepared(sha, { tags: ["extra"] }), { now: "t", respectTombstones: true }));
    expect(again.blocked).toBe("rejected");
    expect(loadIndex().assets[0]!.tags).toEqual(["dropped"]);

    // A person adding the file by hand is overriding that, on purpose.
    const manual = mutateIndex((index) => insertPrepared(index, prepared(sha, { review: { state: "approved", by: "cli" } }), { now: "t", respectTombstones: false }));
    expect(manual.blocked).toBeUndefined();
    expect(loadIndex().assets[0]!.review.state).toBe("approved");
  });

  it("never lets a folder rediscovering a file un-approve it", () => {
    mutateIndex((index) => insertPrepared(index, prepared(sha, { review: { state: "approved", by: "user" } }), { now: "t", respectTombstones: true }));
    mutateIndex((index) => insertPrepared(index, prepared(sha), { now: "t", respectTombstones: true }));
    expect(loadIndex().assets[0]!.review.state).toBe("approved");
  });
});
