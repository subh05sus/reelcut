import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let home: string, reelDir: string, reelPath: string;
const beats = [
  { id: "beat-00", durationSeconds: 2, composition: "compositions/beat-00.html", kind: "hook", style: "claymation" },
  { id: "beat-01", durationSeconds: 3, composition: "compositions/beat-01.html" },
  { id: "beat-02", durationSeconds: 1.5, composition: "compositions/beat-02.html" },
];
beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), "rc-edits-")); process.env.REELCUT_HOME = home;
  reelDir = path.join(home, "out-x"); reelPath = path.join(reelDir, "reel.json");
  mkdirSync(path.join(reelDir, "compositions"), { recursive: true });
  writeFileSync(reelPath, JSON.stringify({ format: "1:1", beats, sfx: true }));
  writeFileSync(path.join(reelDir, "compositions/beat-00.html"), `<div id="root"><style>.a{}</style><h1 class="t">I built <em>Reelcut</em></h1><p>Your script &amp; your look</p><script>window.__timelines = {};</script></div>`);
});
afterEach(() => { delete process.env.REELCUT_HOME; rmSync(home, { recursive: true, force: true }); });

describe("beat edits", () => {
  it("finds the beat at a moment of the master", async () => {
    const { beatAt } = await import("../src/create/edits.js");
    expect(beatAt(beats, 0)).toMatchObject({ index: 0, into: 0 });
    expect(beatAt(beats, 2.5)).toMatchObject({ index: 1, into: 0.5 });
    expect(beatAt(beats, 99)!.index).toBe(2);
  });
  it("reads the words a beat shows, without its script or styles", async () => {
    const { beatText } = await import("../src/create/edits.js");
    expect(beatText(reelPath, beats[0]!)).toEqual(["I built Reelcut", "Your script & your look"]);
  });
  it("turns each action into one precise instruction that re-renders only that beat", async () => {
    const { editPrompt, readReel } = await import("../src/create/edits.js");
    const reel = readReel(reelPath);
    const calm = editPrompt(reelPath, reel, "beat-00", { kind: "calmer" });
    expect(calm.shown).toBe("Beat 1: calmer");
    expect(calm.prompt).toContain("--only beat-00 --clips-only --sfx");
    expect(calm.prompt).toContain("--master-only --sfx");
    expect(editPrompt(reelPath, reel, "beat-01", { kind: "style", style: "swiss" }).prompt).toContain('data-style="swiss"');
    expect(() => editPrompt(reelPath, reel, "beat-01", { kind: "style", style: "nope" })).toThrow();
    expect(editPrompt(reelPath, reel, "beat-02", { kind: "text", text: "New words\nhere" }).prompt).toContain('"""\nNew words\nhere\n"""');
    const move = editPrompt(reelPath, reel, "beat-02", { kind: "move", to: 0 });
    expect(move.shown).toBe("Move beat 3 to position 1");
    expect(move.prompt).not.toContain("--only");
    expect(() => editPrompt(reelPath, reel, "beat-09", { kind: "redo" })).toThrow(/no beat/);
  });
});

describe("frame comments", () => {
  it("pins comments to a beat and a spot, and sends the open ones grouped by beat", async () => {
    const { addComment, loadComments, commentsPrompt, updateComment } = await import("../src/create/edits.js");
    const a = addComment("c_1", reelPath, { t: 2.4, x: 0.25, y: 0.8, text: "Logo too small here" });
    expect(a).toMatchObject({ beat: "beat-01", beatIndex: 1, into: 0.4, x: 0.25, y: 0.8, status: "open" });
    addComment("c_1", reelPath, { t: 0.5, text: "Hook needs more punch" });
    addComment("c_1", reelPath, { t: 2.9, x: 2, y: -1, text: "and this" });
    const list = loadComments("c_1");
    expect(list.map((c) => c.t)).toEqual([0.5, 2.4, 2.9]);
    expect(list[2]).toMatchObject({ x: 1, y: 0 });
    updateComment("c_1", list[2]!.id, { status: "resolved" });
    const msg = commentsPrompt("c_1", reelPath);
    expect(msg.sent).toHaveLength(2);
    expect(msg.prompt).toMatch(/beat-00 \(beat 1[\s\S]*Hook needs more punch[\s\S]*beat-01 \(beat 2[\s\S]*25% across and 80% down/);
    expect(msg.prompt).not.toContain("and this");
  });
});

describe("progress", () => {
  const sess = (status: string, runStartedAt?: string) => ({ status, runStartedAt, events: [] }) as never;
  it("reads the stages from the folder", async () => {
    const { progressOf } = await import("../src/create/manager.js");
    expect(progressOf(sess("running"), undefined)).toMatchObject({ line: "Reading the script and your personality", pct: 0 });
    let p = progressOf(sess("running"), reelPath);
    expect(p.stages.find((s) => s.state === "now")?.id).toBe("compose");
    expect(p.line).toBe("Composing beats · 1 of 3");
    for (const b of beats) writeFileSync(path.join(reelDir, b.composition), "<div></div>");
    mkdirSync(path.join(reelDir, "clips")); mkdirSync(path.join(reelDir, "measure"));
    for (const b of beats) writeFileSync(path.join(reelDir, "measure", `${b.id}-0.05.png`), "");
    writeFileSync(path.join(reelDir, "clips", "beat-00.mp4"), "");
    p = progressOf(sess("running"), reelPath);
    expect(p.line).toBe("Rendering clips · 1 of 3");
    expect(p.stages.filter((s) => s.state === "done").map((s) => s.id)).toEqual(["brief", "plan", "compose", "check"]);
    for (const b of beats) writeFileSync(path.join(reelDir, "clips", `${b.id}.mp4`), "");
    writeFileSync(path.join(reelDir, "master.mp4"), "");
    p = progressOf(sess("done"), reelPath);
    expect(p).toMatchObject({ pct: 100, line: "Finished" });
  });
  it("shows an edit as change, re-render, rejoin", async () => {
    const { progressOf } = await import("../src/create/manager.js");
    const old = new Date(Date.now() - 60_000);
    writeFileSync(path.join(reelDir, "master.mp4"), ""); utimesSync(path.join(reelDir, "master.mp4"), old, old);
    for (const b of beats) { const f = path.join(reelDir, b.composition); writeFileSync(f, "<div></div>"); utimesSync(f, old, old); }
    utimesSync(reelPath, old, old);
    const since = new Date(Date.now() - 1000).toISOString();
    expect(progressOf(sess("running", since), reelPath)).toMatchObject({ mode: "edit", line: "Making the change" });
    writeFileSync(path.join(reelDir, "compositions/beat-01.html"), "<div>new</div>");
    expect(progressOf(sess("running", since), reelPath).line).toBe("Re-rendering the changed beat");
  });
});

describe("progress, finished", () => {
  it("reads a reel with its master as finished, even when only some beats were measured", async () => {
    const { progressOf } = await import("../src/create/manager.js");
    for (const b of beats) writeFileSync(path.join(reelDir, b.composition), "<div></div>");
    mkdirSync(path.join(reelDir, "clips")); mkdirSync(path.join(reelDir, "measure"));
    writeFileSync(path.join(reelDir, "measure", "beat-00-0.05.png"), "");
    for (const b of beats) writeFileSync(path.join(reelDir, "clips", `${b.id}.mp4`), "");
    const rendering = progressOf({ status: "running", events: [] } as never, reelPath);
    expect(rendering.stages.find((s) => s.id === "check")!.state).toBe("done");
    writeFileSync(path.join(reelDir, "master.mp4"), "");
    expect(progressOf({ status: "done", events: [] } as never, reelPath)).toMatchObject({ pct: 100, line: "Finished" });
  });
});
