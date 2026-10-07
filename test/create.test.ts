import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/*
 * Create: the conversation manager behind the studio's chat. A scripted stand-in for Claude Code plays the messages the
 * Agent SDK sends (streamed text, a tool call and its result, an AskUserQuestion that waits for the owner), so the
 * tests check the chat events without spending anyone's usage.
 */
let home: string;
beforeEach(() => { home = mkdtempSync(path.join(os.tmpdir(), "rc-create-")); process.env.REELCUT_HOME = home; });
afterEach(() => { delete process.env.REELCUT_HOME; rmSync(home, { recursive: true, force: true }); });

const tick = () => new Promise((r) => setTimeout(r, 10));

describe("permissions", () => {
  it("lets Claude work inside the project and asks for anything outside or outward-facing", async () => {
    const { needsPermission } = await import("../src/create/manager.js");
    const repo = path.resolve(__dirname, "..");
    expect(needsPermission("Read", { file_path: "/etc/hosts" })).toBeNull();
    expect(needsPermission("Write", { file_path: path.join(repo, "out-1/reel.json") })).toBeNull();
    expect(needsPermission("Write", { file_path: path.join(home, "create/x/files/a.txt") })).toBeNull();
    expect(needsPermission("Write", { file_path: "/Users/someone/Desktop/a.txt" })).toMatch(/outside the project/);
    expect(needsPermission("Bash", { command: "npm run render -- out/reel.json" })).toBeNull();
    expect(needsPermission("Bash", { command: "git push origin main" })).toMatch(/outside this machine/);
    expect(needsPermission("Bash", { command: "curl -X POST https://example.com -d x" })).toMatch(/outside this machine/);
    expect(needsPermission("Bash", { command: "ls /Users/someone/Documents" })).toMatch(/outside the project/);
    expect(needsPermission("mcp__notion__notion-create-pages", {})).toMatch(/connected service/);
    expect(needsPermission("Bash", { command: "ls" }, "/Users/someone/Pictures")).toMatch(/outside the project/);
  });
});

describe("a conversation", () => {
  it("streams text, records tool steps, turns AskUserQuestion into a card that waits, and saves itself", async () => {
    const { CreateManager } = await import("../src/create/manager.js");
    const seen: string[] = [];
    let answered: unknown;
    const fake = ((args: { options: { canUseTool: (n: string, i: Record<string, unknown>, o: object) => Promise<unknown> } }) => (async function* () {
      yield { type: "system", subtype: "init", session_id: "sess-1" };
      yield { type: "stream_event", parent_tool_use_id: null, event: { type: "message_start" } };
      yield { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_start", index: 0, content_block: { type: "text" } } };
      yield { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Using " } } };
      yield { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "gptmarlon." } } };
      yield { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "Using gptmarlon." }, { type: "tool_use", id: "t1", name: "Bash", input: { command: "npm run beats -- s.txt", description: "Split the script into beats" } }] } };
      yield { type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "7 beats" }] } };
      answered = await args.options.canUseTool("AskUserQuestion", { questions: [{ question: "Text on screen?", header: "Text", options: [{ label: "Key lines" }, { label: "Full" }] }] }, {});
      yield { type: "result", subtype: "success", total_cost_usd: 0.1, usage: { input_tokens: 10, output_tokens: 5 }, num_turns: 2, duration_ms: 1000 };
    })()) as never;
    const cm = new CreateManager({ queryFn: fake, idleMs: 10 });
    const s = cm.create("Test", { format: "9:16" });
    cm.subscribe(s.id, (e) => seen.push(e.k));
    cm.send(s.id, "make it", [], cm.firstPrompt(s, { text: "make it", scriptPath: "/tmp/s.txt", settings: { format: "9:16", resolution: "4k" } }));
    for (let i = 0; i < 50 && !cm.get(s.id)!.events.some((e) => e.k === "question"); i++) await tick();
    const st = cm.get(s.id)!;
    expect(st.status).toBe("waiting");
    expect(st.claudeSession).toBe("sess-1");
    const text = st.events.find((e) => e.k === "text");
    expect(text).toMatchObject({ text: "Using gptmarlon.", done: true });
    expect(st.events.find((e) => e.k === "tool")).toMatchObject({ summary: "Split the script into beats", status: "ok", output: "7 beats" });
    const q = st.events.find((e) => e.k === "question")!;
    cm.answer(s.id, q.id, { "Text on screen?": "Key lines" });
    for (let i = 0; i < 50 && st.status !== "done"; i++) await tick();
    expect(answered).toEqual({ behavior: "allow", updatedInput: { questions: (q as { questions: unknown }).questions, answers: { "Text on screen?": "Key lines" } } });
    expect(st.status).toBe("done");
    expect(st.usage).toMatchObject({ costUsd: 0.1, turns: 2 });
    expect(seen).toContain("question");
    // Saved: a new manager (a restarted studio) finds it.
    await new Promise((r) => setTimeout(r, 900));
    expect(new CreateManager().get(s.id)?.events.length).toBe(st.events.length);
  });

  it("starts /reelcut with the composer's settings and files", async () => {
    const { CreateManager } = await import("../src/create/manager.js");
    const cm = new CreateManager();
    const s = cm.create("x", {});
    const p = cm.firstPrompt(s, { text: "Calm and warm.", scriptPath: "/a/s.srt", voiceoverPath: "/a/vo.wav", assetsDir: "/a/assets", settings: { format: "9:16", length: "short", resolution: "4k", personality: "p_1" }, personalityName: "gptmarlon" });
    expect(p.split("\n")[0]).toBe("/reelcut /a/s.srt --format 9:16 --short --4k --voiceover /a/vo.wav --assets /a/assets");
    expect(p).toContain("Calm and warm.");
    expect(p).toContain('personality "gptmarlon" (p_1)');
    expect(p).toContain("AskUserQuestion");
  });
});
