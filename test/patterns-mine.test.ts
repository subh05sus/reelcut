import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IngestManager, recordRun } from "../src/library/index.js";
import { asPattern, editPattern, findSlots, loadPatterns, patternHtmlPath, patternIdFor, rankPatterns, ratePatternUse, recordPatternUses, removePattern, savePatternFromBeat, unsaveFromBeat } from "../src/patterns/mine.js";
import { inspectComposition } from "../src/render/project.js";
import { createStudioServer } from "../src/studio/server.js";

const BEAT = `<template>
<style>#root .big { font-size: 120px; } /* not a slot */</style>
<div id="root" data-look="ink" data-type="poster" data-composition-id="beat-03" data-width="1080" data-height="1080">
  <div class="rc-head"><span class="ln">Du kannst jetzt</span> <em class="rc">Videos</em></div>
  <div class="big">20%</div>
  <img src="assets/library/0123456789abcdef.png" alt="">
  <div class="rc-footage" data-footage="fedcba9876543210:m_abcd1234"></div>
</div>
<script>
const tl = gsap.timeline({ paused: true });
RC.count(tl, "#root .big", 0.2, { to: 20 });
window.__timelines["beat-03"] = tl;
</script>
</template>`;

let home: string;
let work: string;
beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), "reelcut-pat-"));
  work = mkdtempSync(path.join(os.tmpdir(), "reelcut-pat-reel-"));
  process.env.REELCUT_HOME = home;
});
afterEach(() => {
  delete process.env.REELCUT_HOME;
  rmSync(home, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

const save = (beat = "beat-03", html = BEAT) => savePatternFromBeat({ run: "r1", outDir: work, beat, html, look: "ink", type: "poster", basedOn: "stat-count", format: "1:1", durationSeconds: 4.2 });

describe("what in a beat belongs to its reel", () => {
  it("finds the words, the numbers, the library assets and the recordings, but not the code", () => {
    const slots = findSlots(BEAT);
    expect(slots).toEqual(expect.arrayContaining([
      { kind: "text", value: "Du kannst jetzt" },
      { kind: "text", value: "Videos" },
      { kind: "number", value: "20%" },
      { kind: "number", value: "20" },
      { kind: "asset", value: "assets/library/0123456789abcdef.png" },
      { kind: "footage", value: "fedcba9876543210:m_abcd1234" },
    ]));
    expect(slots.some((s) => s.value.includes("font-size") || s.value.includes("not a slot") || s.value.includes("gsap"))).toBe(false);
  });

  it("renames the composition to the pattern and says what to replace", () => {
    const html = asPattern(BEAT, "beat-03", { id: "mine-0000abcd", name: "Big claim", from: { run: "r1", beat: "beat-03", outDir: work }, slots: findSlots(BEAT), basedOn: "stat-count" });
    expect(inspectComposition(html)).toMatchObject({ compositionId: "mine-0000abcd", timelineKey: "mine-0000abcd", hasTemplate: true });
    expect(html.indexOf("YOUR PATTERN")).toBeLessThan(html.indexOf("<template"));
    expect(html).toContain("footage fedcba9876543210:m_abcd1234");
    expect(html).not.toContain('data-composition-id="beat-03"');
  });
});

describe("your patterns", () => {
  it("keeps a beat you rated, named after its first words, and updates it rather than duplicating", () => {
    const p = save();
    expect(p.id).toBe(patternIdFor(work, "beat-03"));
    expect(p).toMatchObject({ name: "Du kannst jetzt Videos", look: "ink", type: "poster", basedOn: "stat-count", kept: false });
    expect(existsSync(patternHtmlPath(p.id))).toBe(true);
    save();
    expect(loadPatterns()).toHaveLength(1);
  });

  it("takes it back out when the beat is rated down, unless you made it yours", () => {
    const p = save();
    expect(unsaveFromBeat(work, "beat-03")).toBe(true);
    expect(loadPatterns()).toHaveLength(0);
    save();
    editPattern(p.id, { name: "My hook" });
    expect(unsaveFromBeat(work, "beat-03")).toBe(false);
    expect(loadPatterns()[0]).toMatchObject({ name: "My hook", kept: true });
    expect(readFileSync(patternHtmlPath(p.id), "utf8")).toContain('YOUR PATTERN: "My hook"');
    // Rated up again, a kept pattern keeps the name you gave it.
    save();
    expect(loadPatterns()[0]!.name).toBe("My hook");
  });

  it("ranks by what your reels kept, then by use, then by age", () => {
    const a = save("beat-01");
    const b = save("beat-02");
    const c = save("beat-03");
    recordPatternUses([a.id, a.id, b.id]);
    ratePatternUse(c.id, "up");
    ratePatternUse(a.id, "down");
    expect(rankPatterns(loadPatterns()).map((p) => p.id)).toEqual([c.id, b.id, a.id]);
  });

  it("removes a pattern and its files", () => {
    const p = save();
    removePattern(p.id);
    expect(existsSync(patternHtmlPath(p.id))).toBe(false);
    expect(() => removePattern(p.id)).toThrow(/no pattern/);
  });
});

describe("rating a beat in the studio", () => {
  let server: http.Server;
  let base: string;
  beforeEach(async () => {
    server = createStudioServer({ ingest: new IngestManager({ watch: false }) });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

  const reel = () => {
    mkdirSync(path.join(work, "compositions"), { recursive: true });
    writeFileSync(path.join(work, "compositions", "beat-03.html"), BEAT);
    writeFileSync(path.join(work, "reel.json"), JSON.stringify({ format: "1:1", type: "poster", beats: [{ id: "beat-03", durationSeconds: 4.2, composition: "compositions/beat-03.html", pattern: "stat-count" }] }));
    return recordRun({ outDir: work, manifest: path.join(work, "reel.json"), beats: ["beat-03"], clips: [], libraryAssets: [] });
  };
  const rate = async (run: string, rating: "up" | "down") => (await fetch(`${base}/api/runs/${run}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ beat: "beat-03", rating }) })).json() as Promise<{ pattern?: { id: string; name: string }; unsaved?: boolean }>;

  it("keeps a beat rated Works as your pattern, and lists it", async () => {
    const run = reel();
    const r = await rate(run.id, "up");
    expect(r.pattern).toMatchObject({ name: "Du kannst jetzt Videos" });
    const listed = (await (await fetch(`${base}/api/patterns`)).json()) as { patterns: { id: string; basedOn?: string }[] };
    expect(listed.patterns).toHaveLength(1);
    expect(listed.patterns[0]!.basedOn).toBe("stat-count");
  });

  it("takes it out again when the beat is rated Not quite", async () => {
    const run = reel();
    await rate(run.id, "up");
    expect((await rate(run.id, "down")).unsaved).toBe(true);
    expect(loadPatterns()).toHaveLength(0);
  });

  it("renames and removes through the studio", async () => {
    const run = reel();
    const { pattern } = await rate(run.id, "up");
    const renamed = await fetch(`${base}/api/patterns/${pattern!.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Hook", tags: ["Hook", "numbers"] }) });
    expect(((await renamed.json()) as { pattern: { name: string; tags: string[]; kept: boolean } }).pattern).toMatchObject({ name: "Hook", tags: ["hook", "numbers"], kept: true });
    expect((await fetch(`${base}/api/patterns/${pattern!.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await fetch(`${base}/api/patterns/${pattern!.id}`, { method: "DELETE" })).status).toBe(404);
  });
});
