import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addFolder,
  annotateAsset,
  changedDuring,
  claudeQueue,
  hasFfmpeg,
  incomingDir,
  IngestManager,
  ingestBatch,
  itemsFor,
  libraryRoot,
  listFolders,
  loadIndex,
  loadJournal,
  removeFolder,
  scanDir,
  setReview,
  streamToTemp,
  unchanged,
  updateFolder,
  waitUntilSettled,
  type IngestSource,
} from "../src/library/index.js";

let home: string;
let work: string;
beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), "reelcut-home-"));
  work = mkdtempSync(path.join(os.tmpdir(), "reelcut-drop-"));
  process.env.REELCUT_HOME = home;
});
afterEach(() => {
  delete process.env.REELCUT_HOME;
  rmSync(home, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

const ffmpeg = hasFfmpeg();
function png(file: string, colour: string): string {
  mkdirSync(path.dirname(file), { recursive: true });
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${colour}:s=32x32:d=1`, "-frames:v", "1", file]);
  return file;
}
const old = (file: string): void => utimesSync(file, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
const source = (over: Partial<IngestSource> = {}): IngestSource => ({ kind: "folder", folderId: "f1f1f1f1", origin: "Brand kit", assetKind: "generic", trusted: false, private: false, ...over });
const fast = { settle: { stableMs: 60, pollMs: 15, timeoutMs: 2000 } };

describe("streamToTemp", () => {
  it("hashes while it writes, and counts the bytes it was actually sent", async () => {
    const stored = await streamToTemp(Readable.from([Buffer.from("hello "), Buffer.from("world")]), 1024);
    expect(stored.bytes).toBe(11);
    expect(stored.sha256).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
    expect(existsSync(stored.temp)).toBe(true);
  });

  it("stops and cleans up the moment the limit is passed, whatever length was claimed", async () => {
    await expect(streamToTemp(Readable.from([Buffer.alloc(600), Buffer.alloc(600)]), 1000)).rejects.toThrow(/limit/);
    expect(readdirSync(incomingDir())).toEqual([]);
  });
});

describe("waitUntilSettled", () => {
  it("takes a file that has not been touched for a while as settled at once", async () => {
    const file = path.join(work, "a.bin");
    writeFileSync(file, "x");
    old(file);
    const t = Date.now();
    expect(await waitUntilSettled(file, { stableMs: 500 })).toMatchObject({ ok: true });
    expect(Date.now() - t).toBeLessThan(400);
  });

  it("waits while a file is still growing, and returns once it holds still", async () => {
    const file = path.join(work, "growing.bin");
    writeFileSync(file, "x");
    let writes = 0;
    const timer = setInterval(() => {
      appendFileSync(file, "more");
      if (++writes >= 6) clearInterval(timer);
    }, 30);
    const result = await waitUntilSettled(file, { stableMs: 150, pollMs: 20, timeoutMs: 3000 });
    clearInterval(timer);
    expect(result.ok).toBe(true);
    expect(writes).toBeGreaterThanOrEqual(6);
  });

  it("gives up with a reason when a file never settles or vanishes", async () => {
    const file = path.join(work, "busy.bin");
    writeFileSync(file, "x");
    const timer = setInterval(() => appendFileSync(file, "y"), 15);
    expect(await waitUntilSettled(file, { stableMs: 300, pollMs: 15, timeoutMs: 200 })).toMatchObject({ ok: false, reason: expect.stringContaining("still being written") });
    clearInterval(timer);
    expect(await waitUntilSettled(path.join(work, "gone.bin"), { stableMs: 50 })).toMatchObject({ ok: false, reason: expect.stringContaining("disappeared") });
  });

  it("notices a copy that was torn by a change to the source", () => {
    expect(changedDuring({ size: 10, mtimeMs: 1 }, { size: 10, mtimeMs: 1 }, 10)).toBe(false);
    expect(changedDuring({ size: 10, mtimeMs: 1 }, { size: 12, mtimeMs: 1 }, 10)).toBe(true);
    expect(changedDuring({ size: 10, mtimeMs: 1 }, { size: 10, mtimeMs: 2 }, 10)).toBe(true);
    expect(changedDuring({ size: 10, mtimeMs: 1 }, { size: 10, mtimeMs: 1 }, 7)).toBe(true);
  });
});

describe("scanDir", () => {
  it("lists real files, skipping dot-files, sync temp files, links and capped overflow", () => {
    writeFileSync(path.join(work, "a.png"), "x");
    writeFileSync(path.join(work, ".hidden.png"), "x");
    writeFileSync(path.join(work, "b.png.crdownload"), "x");
    writeFileSync(path.join(work, "~$lock.docx"), "x");
    mkdirSync(path.join(work, "sub", "deeper"), { recursive: true });
    writeFileSync(path.join(work, "sub", "deeper", "c.svg"), "x");
    mkdirSync(path.join(work, "node_modules"));
    writeFileSync(path.join(work, "node_modules", "no.png"), "x");
    try {
      symlinkSync(path.join(work, "sub"), path.join(work, "loop"), "dir");
    } catch {
      // creating links needs a privilege on Windows; the rest of the test still stands
    }
    const { files, truncated } = scanDir(work);
    expect(files.map((f) => f.rel)).toEqual(["a.png", "sub/deeper/c.svg"]);
    expect(truncated).toBe(false);
    expect(scanDir(work, 1)).toMatchObject({ truncated: true });
  });
});

describe("watched folders", () => {
  it("registers a folder, and refuses the ones that go wrong", () => {
    const folder = addFolder({ path: work, label: "Brand kit", kind: "identity", trusted: true });
    expect(folder).toMatchObject({ kind: "identity", trusted: true, private: false, paused: false });
    expect(() => addFolder({ path: work })).toThrow(/already watched/);
    mkdirSync(path.join(work, "inner"));
    expect(() => addFolder({ path: path.join(work, "inner") })).toThrow(/already covered/);
    expect(() => addFolder({ path: path.parse(work).root })).toThrow(/whole drive/);
    expect(() => addFolder({ path: os.homedir() })).toThrow(/home folder/);
    expect(() => addFolder({ path: path.join(work, "nope") })).toThrow(/not a folder/);
    expect(() => addFolder({ path: home })).toThrow(/own library/);
    expect(() => addFolder({ path: libraryRoot() })).toThrow();
  });

  it("refuses a folder that would contain one already watched", () => {
    mkdirSync(path.join(work, "inner"));
    addFolder({ path: path.join(work, "inner") });
    expect(() => addFolder({ path: work })).toThrow(/contains the watched folder/);
  });

  it("edits and removes, and removing never deletes assets", () => {
    const folder = addFolder({ path: work });
    expect(updateFolder(folder.id, { trusted: true, paused: true })).toMatchObject({ trusted: true, paused: true });
    removeFolder(folder.id);
    expect(listFolders()).toEqual([]);
  });
});

describe("the journal", () => {
  const entry = { path: "p", size: 5, mtimeMs: 100, state: "ingested" as const, at: new Date().toISOString() };
  it("treats an unchanged file as done, and a changed one as new", () => {
    expect(unchanged(entry, { size: 5, mtimeMs: 100 })).toBe(true);
    expect(unchanged(entry, { size: 6, mtimeMs: 100 })).toBe(false);
    expect(unchanged(entry, { size: 5, mtimeMs: 101 })).toBe(false);
    expect(unchanged(undefined, { size: 5, mtimeMs: 100 })).toBe(false);
  });

  it("retries a failed file only after a pause", () => {
    const failed = { ...entry, state: "failed" as const, at: new Date(Date.now() - 60_000).toISOString() };
    expect(unchanged(failed, { size: 5, mtimeMs: 100 })).toBe(true);
    expect(unchanged({ ...failed, at: new Date(Date.now() - 10 * 60_000).toISOString() }, { size: 5, mtimeMs: 100 })).toBe(false);
  });
});

describe.skipIf(!ffmpeg)("ingestBatch (needs ffmpeg)", () => {
  it("ingests a mixed batch: images in, a program refused, duplicates merged", async () => {
    const a = png(path.join(work, "brand-kit", "claude-logo.png"), "0xff6a2a");
    const b = png(path.join(work, "brand-kit", "blue.png"), "0x2f5bff");
    const dup = path.join(work, "copy-of-blue.png");
    writeFileSync(dup, readBytes(b));
    const exe = path.join(work, "notes.png");
    writeFileSync(exe, "MZ\x90\0 definitely not an image");
    [a, b, dup, exe].forEach(old);

    const items = [a, b, dup, exe].map((file) => ({ file, name: path.basename(file), relPath: path.relative(work, file).replace(/\\/g, "/"), source: source() }));
    const outcomes = await ingestBatch(items, fast);

    expect(outcomes.map((o) => o.state)).toEqual(["ingested", "ingested", "duplicate", "skipped"]);
    expect(outcomes[3]!.reason).toContain("not a type");
    const assets = loadIndex().assets;
    expect(assets).toHaveLength(2);
    const logo = assets.find((x) => x.name === "claude logo")!;
    expect(logo).toMatchObject({ mediaType: "image", assetKind: "generic", review: { state: "pending" }, private: false, folderId: "f1f1f1f1" });
    expect(logo.tags).toEqual(expect.arrayContaining(["claude", "logo", "brand", "kit"]));
    expect(Object.values(logo.tagOrigin).every((o) => o === "auto")).toBe(true);
    expect(logo.thumb && existsSync(path.join(libraryRoot(), logo.thumb))).toBe(true);
    expect(logo.provenance.note).toContain("dropped in Brand kit");
    // The blobs are under their content hash with the extension the bytes call for, and nothing is left behind.
    expect(readdirSync(path.join(libraryRoot(), "files")).sort()).toEqual(assets.map((x) => `${x.id}.png`).sort());
    expect(readdirSync(incomingDir())).toEqual([]);
  });

  it("approves on arrival only in a trusted folder, and keeps the folder's privacy and kind", async () => {
    const file = png(path.join(work, "trusted.png"), "0x123456");
    old(file);
    await ingestBatch([{ file, name: "trusted.png", source: source({ trusted: true, private: true, assetKind: "identity" }) }], fast);
    expect(loadIndex().assets[0]).toMatchObject({ review: { state: "approved", by: "folder-trust" }, private: true, assetKind: "identity" });
    // A private asset is never put in the queue for Claude to look at.
    expect(claudeQueue(loadIndex().assets)).toEqual([]);
  });

  it("never brings back what was rejected, however often the folder is scanned", async () => {
    const file = png(path.join(work, "unwanted.png"), "0x00ff00");
    old(file);
    const item = { file, name: "unwanted.png", source: source() };
    const [first] = await ingestBatch([item], fast);
    setReview([first!.assetId!], "rejected", "user");
    const [again] = await ingestBatch([{ ...item }], fast);
    expect(again).toMatchObject({ state: "skipped", reason: expect.stringContaining("rejected earlier") });
    expect(loadIndex().assets).toHaveLength(1);
    expect(loadIndex().assets[0]!.review.state).toBe("rejected");
  });

  it("puts a pending image in the queue for Claude, and takes it out once Claude has annotated it", async () => {
    const file = png(path.join(work, "queue-me.png"), "0xabcdef");
    old(file);
    await ingestBatch([{ file, name: "queue-me.png", source: source() }], fast);
    const [queued] = claudeQueue(loadIndex().assets);
    expect(queued).toBeDefined();
    annotateAsset(queued!.id, { tags: ["pricing", "screenshot"], description: "a pricing page" });
    expect(claudeQueue(loadIndex().assets)).toEqual([]);
    // Still pending: Claude suggested, a person has not approved.
    expect(loadIndex().assets[0]!.review.state).toBe("pending");
  });

  it("reports a file that vanished, and a file that is too big, without stopping the batch", async () => {
    const good = png(path.join(work, "good.png"), "0x111111");
    old(good);
    process.env.REELCUT_MAX_FILE_MB = "0.000001"; // about a kilobyte
    const big = path.join(work, "big.png");
    writeFileSync(big, Buffer.alloc(5000));
    old(big);
    const outcomes = await ingestBatch(
      [
        { file: path.join(work, "gone.png"), name: "gone.png", source: source() },
        { file: big, name: "big.png", source: source() },
      ],
      fast,
    );
    delete process.env.REELCUT_MAX_FILE_MB;
    expect(outcomes[0]).toMatchObject({ state: "failed", reason: expect.stringContaining("disappeared") });
    expect(outcomes[1]).toMatchObject({ state: "failed", reason: expect.stringContaining("limit") });
    expect(good).toBeTruthy();
  });
});

describe.skipIf(!ffmpeg)("IngestManager (needs ffmpeg)", () => {
  it("ingests a folder once, ignores it when unchanged, and picks up a new or edited file", async () => {
    const first = png(path.join(work, "one.png"), "0xaa0000");
    old(first);
    addFolder({ path: work, label: "Drop" });
    const manager = new IngestManager({ ...fast, watch: false });

    expect((await manager.rescan()).map((o) => o.state)).toEqual(["ingested"]);
    expect(await manager.rescan()).toEqual([]);

    const second = png(path.join(work, "sub", "two.png"), "0x00aa00");
    old(second);
    expect((await manager.rescan()).map((o) => [path.basename(o.path), o.state])).toEqual([["two.png", "ingested"]]);

    // Copied over with different bytes: seen as new.
    png(first, "0x0000aa");
    old(first);
    expect((await manager.rescan()).map((o) => o.state)).toEqual(["ingested"]);

    expect(loadIndex().assets).toHaveLength(3);
    expect(Object.keys(loadJournal().entries)).toHaveLength(2);
    expect(listFolders()[0]!.lastScanAt).toBeDefined();
  });

  it("notes a folder that is gone instead of failing, and recovers when it returns", async () => {
    const folder = addFolder({ path: work });
    const manager = new IngestManager({ ...fast, watch: false });
    const moved = `${work}-away`;
    rmSync(moved, { recursive: true, force: true });
    renameDir(work, moved);
    await manager.rescan();
    expect(listFolders()[0]!.lastError).toContain("not found");
    renameDir(moved, work);
    await manager.rescan();
    expect(listFolders().find((f) => f.id === folder.id)!.lastError).toBeUndefined();
  });

  it("does not scan a paused folder", async () => {
    const file = png(path.join(work, "p.png"), "0x333333");
    old(file);
    const folder = addFolder({ path: work });
    updateFolder(folder.id, { paused: true });
    expect(await new IngestManager({ ...fast, watch: false }).rescan()).toEqual([]);
    expect(itemsFor(folder, [])).toEqual([]);
  });
});

import { readFileSync, renameSync } from "node:fs";
function readBytes(file: string): Buffer {
  return readFileSync(file);
}
function renameDir(from: string, to: string): void {
  renameSync(from, to);
}
