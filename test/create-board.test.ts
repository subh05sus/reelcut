import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    // The board keeps its own copy: a beat re-rendered in place does not change what the client approved.
    expect(boardFile(fresh, "beats", "beat-00")).toBe(path.join(home, "create", "boards", board.token, "beats-1", "beat-00.mp4"));
    expect(readFileSync(boardFile(fresh, "beats", "beat-00")!).equals(readFileSync(path.join(dir, "clips", "beat-00.mp4")))).toBe(true);
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

describe("boards, round two", () => {
  it("shows a changed item beside the version the client saw, with their marks drawn on the frame for Claude", async () => {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x204060:s=320x568:r=30:d=1", "-frames:v", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(dir, "clips", "beat-00.mp4")]);
    const { createBoard, publishStage, decide, stagePrompt, publicBoard, boardFile, loadBoards, cleanMarks, markPlace } = await import("../src/create/board.js");
    const { board } = createBoard("c_1", "Launch", reelPath, ["beats"]);
    publishStage(board.token, "beats");
    const r = decide(board.token, "beats", "beat-00", { status: "changes", note: "Logo is too small", author: "Sam", marks: [{ t: 0.5, x: 0.2, y: 0.1 }, { t: 0.8, strokes: [[0.6, 0.6, 0.9, 0.9, 0.6, 0.9]] }, { t: "x" }] });
    const d = r.board.decisions.beats!["beat-00"]!;
    expect(d.marks!.map((m) => markPlace(m))).toEqual(["top-left", "bottom-right"]);
    expect(d.marks!.every((m) => m.frame && existsSync(m.frame))).toBe(true);
    const prompt = stagePrompt(r.board, "beats").prompt;
    expect(prompt).toContain("marked at 0.5 s into it: pinned on the top-left of the frame (look at ");
    expect(prompt).toContain("drew on the bottom-right");
    // The client's page never gets the stills' paths.
    expect(JSON.stringify(publicBoard(r.board))).not.toContain(".jpg");
    // Re-rendered and sent again: the page shows before and now, and both files are served.
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x406020:s=320x568:r=30:d=1", "-frames:v", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(dir, "clips", "beat-00.mp4")]);
    publishStage(board.token, "beats");
    const b = loadBoards()[0]!;
    const item = (publicBoard(b) as { stages: { published: { version: number; items: { before?: { media: boolean; decision: { note: string; marks?: unknown[] } } }[] } }[] }).stages[0]!.published;
    expect(item.version).toBe(2);
    expect(item.items[0]!.before).toMatchObject({ media: true, decision: { note: "Logo is too small" } });
    expect(item.items[0]!.before!.decision.marks).toHaveLength(2);
    const before = boardFile(b, "beats", "beat-00", false, true)!, now = boardFile(b, "beats", "beat-00")!;
    expect(readFileSync(before).equals(readFileSync(now))).toBe(false);
    expect(cleanMarks([{ t: 1, x: 2, y: -1 }, { t: 1, strokes: [[0.1]] }, ...Array.from({ length: 9 }, () => ({ t: 0, x: 0.5, y: 0.5 }))])).toHaveLength(5);
  });

  it("puts the owner's name, colour and logo on the board", async () => {
    const { saveBoardBrand, publicBrand, createBoard } = await import("../src/create/board.js");
    const { startReviewServer } = await import("../src/create/share.js");
    expect(() => saveBoardBrand({ accent: "red" })).toThrow(/hex value/);
    const logo = path.join(home, "logo.png");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=64x64", "-frames:v", "1", logo]);
    saveBoardBrand({ name: "Studio <Marlon>", accent: "#22AA66", logo });
    expect(publicBrand()).toEqual({ name: "Studio Marlon", accent: "#22aa66", logo: true });
    const server = await startReviewServer(0, {});
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const { board } = createBoard("c_1", "Launch", reelPath, ["directions"]);
      const page = await (await fetch(`${base}/r/${board.token}`)).text();
      expect(page).toContain("--accent: #22aa66");
      expect(page).toContain("Studio Marlon");
      const img = await fetch(`${base}/r/${board.token}/brand-logo`);
      expect(img.headers.get("content-type")).toBe("image/png");
      saveBoardBrand({ logo: null });
      expect(publicBrand().logo).toBe(false);
      expect((await fetch(`${base}/r/${board.token}/brand-logo`)).status).toBe(404);
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
