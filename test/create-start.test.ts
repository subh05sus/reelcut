import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let home: string;
beforeEach(() => { home = mkdtempSync(path.join(os.tmpdir(), "rc-start-")); process.env.REELCUT_HOME = home; });
afterEach(() => { delete process.env.REELCUT_HOME; rmSync(home, { recursive: true, force: true }); });
const tick = () => new Promise((r) => setTimeout(r, 10));

describe("starting a reel", () => {
  it("writes the script first in write mode: three hooks, approval, then the skill", async () => {
    const { CreateManager } = await import("../src/create/manager.js");
    const cm = new CreateManager({ queryFn: (() => (async function* () { /* never runs */ })()) as never });
    const s = cm.create("x", { mode: "write", target: "30", format: "9:16" });
    const p = cm.firstPrompt(s, { text: "Why our CLI beats templates https://example.com", settings: s.settings });
    expect(p.startsWith("/reelcut")).toBe(false);
    expect(p).toContain("about 30 seconds, so about 75 spoken words");
    expect(p).toContain("Offer three hooks with AskUserQuestion");
    expect(p).toContain("Make the reel (Recommended)");
    expect(p).toMatch(/invoke the reelcut skill \(Skill tool\) with the arguments `\S+script\.txt --format 9:16 --no-blur`/);
    expect(p).not.toContain("There is no script file");
  });
  it("adds a recipe's shape and a series' intro and outro", async () => {
    const { CreateManager } = await import("../src/create/manager.js");
    const { getRecipe, recipePrompt } = await import("../src/create/recipes.js");
    const { saveSeries, addEpisode, seriesPrompt } = await import("../src/create/series.js");
    const cm = new CreateManager({ queryFn: (() => (async function* () {})()) as never });
    const s = cm.create("x", {});
    const sr = saveSeries({ name: "Tips", intro: "Tips, then Episode N", outro: "Follow for more" });
    expect(addEpisode(sr.id, "c_a")).toBe(1);
    expect(addEpisode(sr.id, "c_b")).toBe(2);
    expect(addEpisode(sr.id, "c_a")).toBe(1);
    const p = cm.firstPrompt(s, { text: "script words", settings: {}, recipeLines: recipePrompt(getRecipe("tutorial")!), seriesLines: seriesPrompt(sr, 2, undefined) });
    expect(p).toContain('Follow the recipe "Tutorial"');
    expect(p).toContain("1. Hook: the finished result");
    expect(p).toContain('episode 2 of the series "Tips"');
    expect(p).toContain("Outro (last beat, the same in every episode): Follow for more");
    expect(seriesPrompt(sr, 1, undefined).join("\n")).toContain("This is the first episode");
  });
  it("saves the owner's recipes next to the built-in ones, and keeps the built-in ones", async () => {
    const { listRecipes, saveRecipe, removeRecipe, BUILT_IN_RECIPES } = await import("../src/create/recipes.js");
    const r = saveRecipe({ name: "Weekly tip", structure: ["Hook", "", "Tip"], settings: { format: "1:1", text: "" as never } });
    expect(r.structure).toEqual(["Hook", "Tip"]);
    expect(r.settings).toEqual({ format: "1:1" });
    expect(listRecipes()[0]!.id).toBe(r.id);
    expect(listRecipes()).toHaveLength(BUILT_IN_RECIPES.length + 1);
    expect(() => removeRecipe("tutorial")).toThrow();
    removeRecipe(r.id);
    expect(listRecipes()).toHaveLength(BUILT_IN_RECIPES.length);
  });
  it("tells an unattended reel never to ask", async () => {
    const { CreateManager } = await import("../src/create/manager.js");
    const cm = new CreateManager({ queryFn: (() => (async function* () {})()) as never });
    const s = cm.create("x", { format: "1:1" });
    const p = cm.firstPrompt(s, { text: "", scriptPath: "/a/s.txt", settings: s.settings, unattended: true });
    expect(p).toContain("never call AskUserQuestion");
    expect(p).toContain("Decisions I made");
    expect(p).not.toContain("watching this chat");
  });
});

describe("batch", () => {
  it("runs queued reels one at a time, and waits for a start time", async () => {
    const { CreateManager } = await import("../src/create/manager.js");
    const started: string[] = [];
    let release: (() => void) | undefined;
    const fake = ((args: { prompt: AsyncIterable<{ message: { content: string } }> }) => (async function* () {
      const it = args.prompt[Symbol.asyncIterator]();
      const first = await it.next();
      started.push(first.value.message.content);
      yield { type: "system", subtype: "init", session_id: `s${started.length}` };
      await new Promise<void>((r) => { release = r; });
      yield { type: "result", subtype: "success", usage: {}, num_turns: 1, duration_ms: 1 };
    })()) as never;
    const cm = new CreateManager({ queryFn: fake, idleMs: 10 });
    const a = cm.create("a", {}), b = cm.create("b", {}), c = cm.create("c", {});
    for (const x of [a, b, c]) x.batch = "b_1";
    cm.enqueue(a.id, "a", [], "prompt A");
    cm.enqueue(b.id, "b", [], "prompt B");
    cm.enqueue(c.id, "c", [], "prompt C", new Date(Date.now() + 3600_000).toISOString());
    await tick(); await tick();
    expect(started).toEqual(["prompt A"]);
    expect(cm.get(b.id)!.status).toBe("queued");
    release!();
    for (let i = 0; i < 50 && started.length < 2; i++) await tick();
    expect(started).toEqual(["prompt A", "prompt B"]);
    expect(cm.get(a.id)!.status).toBe("done");
    release!();
    for (let i = 0; i < 20; i++) await tick();
    expect(started).toHaveLength(2);
    expect(cm.get(c.id)!.status).toBe("queued");
    cm.unqueue(c.id);
    expect(cm.get(c.id)!.status).toBe("stopped");
  });
});
