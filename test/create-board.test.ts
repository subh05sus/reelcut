import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let home: string, dir: string, reelPath: string;
beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), "rc-board-")); process.env.REELCUT_HOME = home;
  dir = path.join(home, "out-x"); reelPath = path.join(dir, "reel.json");
  mkdirSync(path.join(dir, "clips"), { recursive: true });
  writeFileSync(reelPath, JSON.stringify({ beats: [
    { id: "beat-00", durationSeconds: 2, kind: "hook", technique: "differentiate/typographic/big-number/build", techniqueWhy: "the number is the claim" },
    { id: "beat-01", durationSeconds: 3, kind: "cta", technique: "differentiate/cultural/brand-code/snap" },
  ] }));
  writeFileSync(path.join(dir, "plan.md"), "# Plan\nHook: 71,000 followers\nCTA: follow");
  writeFileSync(path.join(dir, "clips", "beat-00.mp4"), Buffer.alloc(500, 1));
});
afterEach(() => { delete process.env.REELCUT_HOME; rmSync(home, { recursive: true, force: true }); });

describe("client approval boards", () => {
  it("snapshots a stage in plain words, and asks Claude to go on or change once every item is decided", async () => {
    const { createBoard, publishStage, decide, stagePrompt, publicBoard, boardFile } = await import("../src/create/board.js");
    const { board } = createBoard("c_1", "Launch", reelPath, ["directions", "beats", "nope"]);
    expect(board.stages).toEqual(["directions", "beats"]);
    expect(() => publishStage(board.token, "master")).toThrow(/does not ask/);
    const dirs = publishStage(board.token, "directions");
    expect(dirs.items.map((x) => [x.title, x.plain])).toEqual([["Beat 1 · hook", "Make the number stand out: big, counting up"], ["Beat 2 · cta", "The brand's colour or mark, instantly recognised"]]);
    // No paths or ids reach the client's page.
    expect(JSON.stringify(publicBoard(board))).not.toContain("differentiate/");
    expect(() => decide(board.token, "directions", "beat-00", { status: "changes", author: "Sam" })).toThrow(/what should change/);
    const a = decide(board.token, "directions", "beat-00", { status: "approved", author: "Sam" });
    expect(a).toMatchObject({ stageDone: false, line: "Sam approved Beat 1 · hook" });
    const b = decide(board.token, "directions", "beat-01", { status: "changes", note: "Use our green", author: "Sam" });
    expect(b.stageDone).toBe(true);
    const msg = stagePrompt(b.board, "directions");
    expect(msg.shown).toBe("The client asked for 1 change to the directions");
    expect(msg.prompt).toContain("- Beat 2 · cta: Use our green");
    // Beats: only rendered ones, and only their files can be served.
    const beats = publishStage(board.token, "beats");
    expect(beats.items.map((x) => x.id)).toEqual(["beat-00"]);
    const fresh = (await import("../src/create/board.js")).loadBoards()[0]!;
    expect(boardFile(fresh, "beats", "beat-00")).toBe(path.join(dir, "clips", "beat-00.mp4"));
    expect(boardFile(fresh, "beats", "beat-01")).toBeUndefined();
    expect(boardFile(fresh, "../etc", "passwd")).toBeUndefined();
    const ok = decide(board.token, "beats", "beat-00", { status: "approved", author: "Sam" });
    expect(stagePrompt(ok.board, "beats").prompt).toContain("join the master");
  });

  it("serves the board page, its listed files and decisions through the review server", async () => {
    const { createBoard, publishStage } = await import("../src/create/board.js");
    const { startReviewServer } = await import("../src/create/share.js");
    const heard: string[] = [];
    const server = await startReviewServer(0, { onDecision: (_s, stage, line, done) => heard.push(`${stage}: ${line}${done ? " (done)" : ""}`) });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const { board } = createBoard("c_1", "Launch", reelPath, ["script", "beats"]);
      const page = await (await fetch(`${base}/r/${board.token}`)).text();
      expect(page).toContain("For your approval");
      publishStage(board.token, "script");
      publishStage(board.token, "beats");
      const data = await (await fetch(`${base}/r/${board.token}/board`)).json() as { stages: { id: string; published: { items: { id: string; media: boolean; text?: string }[] } | null }[] };
      expect(data.stages[0]!.published!.items[0]!.text).toContain("71,000");
      expect(data.stages[1]!.published!.items).toMatchObject([{ id: "beat-00", media: true }]);
      expect((await fetch(`${base}/r/${board.token}/m/beats/beat-00`)).status).toBe(200);
      expect((await fetch(`${base}/r/${board.token}/m/beats/beat-01`)).status).toBe(404);
      const post = (body: object) => fetch(`${base}/r/${board.token}/decide`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      expect((await post({ stage: "script", item: "script", status: "approved" })).status).toBe(400);
      expect((await post({ stage: "script", item: "script", status: "approved", name: "Sam" })).status).toBe(201);
      expect(heard).toEqual(["script: Sam approved the script and beat plan (done)"]);
    } finally { server.close(); }
  });
});

describe("recipes with techniques", () => {
  it("keeps valid technique paths per beat kind and tells Claude to start from them", async () => {
    const { saveRecipe, recipePrompt, BUILT_IN_RECIPES } = await import("../src/create/recipes.js");
    const { checkPath } = await import("../src/taxonomy/paths.js");
    for (const r of BUILT_IN_RECIPES) for (const p of Object.values(r.techniques ?? {})) expect(checkPath(p!).ok, `${r.id} ${p}`).toBe(true);
    const r = saveRecipe({ name: "Mine", structure: ["Hook"], techniques: { hook: "differentiate/typographic/big-number", nope: "x/y/z", cta: "bad/path" } as never });
    expect(r.techniques).toEqual({ hook: "differentiate/typographic/big-number/build" });
    expect(recipePrompt(r).join("\n")).toContain("- hook: differentiate/typographic/big-number/build (Make the number stand out: big, counting up)");
  });
});
