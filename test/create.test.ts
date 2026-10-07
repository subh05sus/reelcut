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
    expect(p.split("\n")[0]).toBe("/reelcut /a/s.srt --format 9:16 --short --4k --no-blur --voiceover /a/vo.wav --assets /a/assets");
    expect(p).toContain("Calm and warm.");
    expect(p).toContain('personality "gptmarlon" (p_1)');
    expect(p).toContain("AskUserQuestion");
    expect(p).toMatch(/Never ask whether to open the studio/);
    expect(p).toMatch(/never ask about them: format 9:16; a short cut; 4K; motion blur off; the look/);
  });
});

describe("titles", () => {
  it("takes Claude's first-line title for the chat, and does not show the line", async () => {
    const { CreateManager } = await import("../src/create/manager.js");
    const fake = (() => (async function* () {
      yield { type: "system", subtype: "init", session_id: "s2" };
      yield { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "Title: **Claude Code in 60 seconds**\n\nUsing gptmarlon." }] } };
      yield { type: "result", subtype: "success", usage: {}, num_turns: 1, duration_ms: 1 };
    })()) as never;
    const cm = new CreateManager({ queryFn: fake, idleMs: 10 });
    const s = cm.create("## Hook", {});
    cm.rename(s.id, "Hook", false);
    cm.send(s.id, "go");
    for (let i = 0; i < 50 && cm.get(s.id)!.status !== "done"; i++) await tick();
    expect(cm.get(s.id)!.title).toBe("Claude Code in 60 seconds");
    expect(cm.get(s.id)!.events.find((e) => e.k === "text")).toMatchObject({ text: "Using gptmarlon." });
  });
});

describe("integrations", () => {
  it("reads `claude mcp list` and maps Higgsfield, Premiere Pro and Resolve onto it", async () => {
    const { parseMcpList, integrationStatus } = await import("../src/create/integrations.js");
    const servers = parseMcpList(`Checking MCP server health…

notion: https://mcp.notion.com/mcp (HTTP) - ✔ Connected
higgsfield: https://mcp.higgsfield.ai/mcp (HTTP) - ! Needs authentication
code-review-graph: python3 -m code_review_graph serve - ⏸ Pending approval (run \`claude\` to approve)
broken: node x.js - ✗ Failed to connect`);
    expect(servers.map((s) => [s.name, s.state])).toEqual([["notion", "connected"], ["higgsfield", "needs-auth"], ["code-review-graph", "pending"], ["broken", "failed"]]);
    const st = integrationStatus(servers);
    expect(st.find((x) => x.id === "higgsfield")).toMatchObject({ state: "needs-auth", server: "higgsfield" });
    expect(st.find((x) => x.id === "premiere")).toMatchObject({ state: "planned" });
    expect(integrationStatus([]).find((x) => x.id === "higgsfield")!.state).toBe("not-added");
  });
});

describe("Claude in Chrome", () => {
  it("reads whether it is set up, turned on and connected, without talking to the browser", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { chromeStatus, integrationStatus } = await import("../src/create/integrations.js");
    const fake = path.join(home, "mac"), tmp = path.join(home, "tmp");
    expect(chromeStatus(fake, tmp, "me")).toMatchObject({ installed: false, live: false });
    expect(integrationStatus([], chromeStatus(fake, tmp, "me"))[0]).toMatchObject({ id: "chrome", state: "not-added" });
    const hosts = path.join(fake, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts");
    mkdirSync(hosts, { recursive: true }); writeFileSync(path.join(hosts, "com.anthropic.claude_code_browser_extension.json"), "{}");
    expect(integrationStatus([], chromeStatus(fake, tmp, "me"))[0]).toMatchObject({ state: "offline" });
    mkdirSync(path.join(tmp, "claude-mcp-browser-bridge-me"), { recursive: true });
    writeFileSync(path.join(tmp, "claude-mcp-browser-bridge-me", "999999.sock"), "");
    expect(chromeStatus(fake, tmp, "me").live).toBe(false);
    writeFileSync(path.join(tmp, "claude-mcp-browser-bridge-me", `${process.pid}.sock`), "");
    writeFileSync(path.join(fake, ".claude.json"), JSON.stringify({ chromeExtension: { pairedDeviceName: "Browser 1" } }));
    expect(integrationStatus([], chromeStatus(fake, tmp, "me"))[0]).toMatchObject({ state: "connected", detail: "connected (Browser 1)" });
    writeFileSync(path.join(fake, ".claude.json"), JSON.stringify({ claudeInChromeDefaultEnabled: false }));
    expect(integrationStatus([], chromeStatus(fake, tmp, "me"))[0]).toMatchObject({ state: "off" });
  });
  it("asks before each browser action, saying what it does", async () => {
    const { needsPermission } = await import("../src/create/manager.js");
    expect(needsPermission("mcp__claude-in-chrome__navigate", { url: "https://app.example.com" })).toBe("opens https://app.example.com in your Chrome");
    expect(needsPermission("mcp__claude-in-chrome__computer", {})).toMatch(/clicks, types/);
    expect(needsPermission("mcp__claude-in-chrome__read_page", {})).toBe("uses your Chrome (read page)");
  });
});
