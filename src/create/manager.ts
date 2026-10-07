import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { query, type CanUseTool, type Query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { reelcutHome } from "../library/store.js";

/**
 * Create: a reel made from the dashboard. Each conversation drives the real /reelcut skill through Claude Code (the
 * Agent SDK, with the owner's own Claude login — never an API key), and becomes a stream of chat events the studio
 * shows: streamed replies, collapsed tool steps, question cards for AskUserQuestion, Allow / Deny cards for anything
 * outside the project, and frames and clips as they appear. Conversations are saved in ~/.reelcut/create/<id>/ and
 * resume the same Claude session when the owner writes again.
 */

export type Body =
  | { k: "user"; text: string; files?: { name: string; path: string; kind: string }[] }
  | { k: "text"; text: string; done: boolean }
  | { k: "tool"; name: string; summary: string; input: string; status: "running" | "ok" | "error"; output?: string; media: string[] }
  | { k: "question"; questions: Question[]; answers?: Record<string, string>; status: "waiting" | "answered" | "cancelled" }
  | { k: "permission"; tool: string; detail: string; reason: string; status: "waiting" | "allowed" | "denied" | "cancelled" }
  | { k: "status"; text: string; tone: "info" | "ok" | "error" };
export type Ev = { seq: number; id: string; at: string } & Body;
export interface Question { question: string; header?: string; multiSelect?: boolean; options: { label: string; description?: string; preview?: string }[] }

export interface Settings {
  personality?: string; format?: string; length?: "full" | "short"; resolution?: "hd" | "4k";
  text?: "full" | "key-lines" | "minimal" | "none"; sfx?: "on" | "off"; music?: "fits" | "snap" | "none"; blur?: "on" | "off";
  /** "write": the owner gave a topic, a link or notes, and Claude writes the script first. */
  mode?: "script" | "write";
  /** Target length in seconds for a script Claude writes. */
  target?: string;
  recipe?: string;
  series?: string;
}
export interface SessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: "idle" | "queued" | "running" | "waiting" | "done" | "failed" | "stopped";
  /** One of a batch: runs unattended, one after another, and never stops to ask. */
  batch?: string;
  /** Waiting its turn in a batch: what to send when it starts, and not before when. */
  queued?: { text: string; files: { name: string; path: string; kind: string }[]; prompt: string; startAt?: string };
  /** The series this reel is an episode of, and which episode. */
  episode?: { series: string; n: number };
  claudeSession?: string;
  model?: string;
  effort?: string;
  settings: Settings;
  /** Claude named it (or the owner did): the title is no longer a placeholder. */
  named?: boolean;
  /** The MCP servers this run could reach when it started. */
  mcp?: { name: string; status: string }[];
  /** The reel.json this conversation is making, once Claude has written it. */
  reel?: string;
  usage: { costUsd: number; inputTokens: number; outputTokens: number; turns: number; ms: number; plan?: { utilization?: number; resetsAt?: number; window?: string; status?: string } };
  runStartedAt?: string;
}
interface Session extends SessionMeta { events: Ev[] }

interface Live {
  q: Query;
  abort: AbortController;
  input: { push: (m: SDKUserMessage) => void; close: () => void };
  pending: Map<string, (v: unknown) => void>;
  /** Streaming text: the event a content block is being written into. */
  blocks: Map<number, string>;
  idleTimer?: NodeJS.Timeout;
  allowAlways: Set<string>;
}

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
export const createDir = (): string => path.join(reelcutHome(), "create");
const sessionFile = (id: string) => path.join(createDir(), id, "session.json");
export const filesDir = (id: string): string => path.join(createDir(), id, "files");

const trim = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const MEDIA = /(?:\/[\w .@+~%-]+)+\.(?:png|jpe?g|mp4|webm|gif)\b/gi;

/** Where Claude may write and run freely: the project, the studio's home, the system temp folders. */
export function insideAllowed(p: string): boolean {
  const abs = path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()));
  return [REPO, reelcutHome(), os.tmpdir(), "/private/tmp", "/tmp"].some((root) => abs === root || abs.startsWith(root + path.sep));
}
/** Commands that reach outside the machine or destroy things: these always ask. */
const OUTWARD = /\bgit\s+push\b|\bnpm\s+publish\b|\bgh\s+(pr|release|repo)\s+(create|delete|merge)\b|\bcurl\b[^|]*\s(-X\s*(POST|PUT|PATCH|DELETE)|--data\b|-d\s|-F\s|--upload-file\b)|\bscp\b|\bssh\b|\brsync\b[^|]*:|\bsudo\b|\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\$HOME)/i;

export function needsPermission(tool: string, input: Record<string, unknown>, blockedPath?: string): string | null {
  if (blockedPath) return `reaches ${blockedPath}, outside the project`;
  if (tool === "AskUserQuestion") return null;
  if (/^mcp__/.test(tool)) return "uses a connected service";
  if (["Edit", "Write", "NotebookEdit", "MultiEdit"].includes(tool)) {
    const f = String(input.file_path ?? input.notebook_path ?? "");
    return f && !insideAllowed(f) ? `writes ${f}, outside the project` : null;
  }
  if (tool === "Bash") {
    const cmd = String(input.command ?? "");
    if (OUTWARD.test(cmd)) return "reaches outside this machine, or deletes broadly";
    const abs = cmd.match(/(?:^|\s)(\/(?:Users|home|etc|var|opt|Applications|System)[^\s'"]*)/g) ?? [];
    const outside = abs.map((a) => a.trim()).find((a) => !insideAllowed(a) && !/^\/(usr|bin|opt\/homebrew)\//.test(a));
    return outside ? `touches ${outside}, outside the project` : null;
  }
  return null;
}

function toolSummary(name: string, input: Record<string, unknown>): string {
  const f = (k: string) => String(input[k] ?? "");
  const short = (p: string) => p.replace(REPO + "/", "").replace(os.homedir(), "~");
  switch (name) {
    case "Bash": return f("description") || trim(f("command"), 80);
    case "Read": return `Read ${short(f("file_path"))}`;
    case "Write": return `Wrote ${short(f("file_path"))}`;
    case "Edit": case "MultiEdit": return `Edited ${short(f("file_path"))}`;
    case "Glob": case "Grep": return `Searched for ${trim(f("pattern"), 60)}`;
    case "Skill": return `Opened the ${f("skill")} skill`;
    case "WebFetch": return `Read ${trim(f("url"), 60)}`;
    case "WebSearch": return `Searched the web: ${trim(f("query"), 60)}`;
    case "TodoWrite": return "Updated the plan";
    case "Agent": case "Task": return `Asked a helper: ${trim(f("description"), 60)}`;
    default: return name.replace(/^mcp__[^_]+__/, "");
  }
}

function inputQueue(): { iter: AsyncIterable<SDKUserMessage>; push: (m: SDKUserMessage) => void; close: () => void } {
  const items: SDKUserMessage[] = [];
  let wake: (() => void) | null = null, closed = false;
  return {
    push: (m) => { items.push(m); wake?.(); },
    close: () => { closed = true; wake?.(); },
    iter: { async *[Symbol.asyncIterator]() {
      for (;;) {
        while (items.length) yield items.shift()!;
        if (closed) return;
        await new Promise<void>((r) => { wake = r; });
        wake = null;
      }
    } },
  };
}

export interface StartInput {
  text: string; scriptPath?: string; voiceoverPath?: string; assetsDir?: string; files?: { name: string; path: string; kind: string }[];
  settings?: Settings; model?: string; effort?: string; personalityName?: string;
  /** Lines from the recipe and the series, already worded. */
  recipeLines?: string[]; seriesLines?: string[];
  /** Nobody is watching (a batch): decide instead of asking. */
  unattended?: boolean;
}

export class CreateManager {
  private sessions = new Map<string, Session>();
  private live = new Map<string, Live>();
  private listeners = new Map<string, Set<(e: Ev | { k: "meta"; meta: SessionMeta }) => void>>();
  private saveTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly opts: { idleMs?: number; queryFn?: typeof query } = {}) {
    // Batch reels wait for their time; look once every half minute.
    setInterval(() => this.pump(), 30_000).unref();
    if (!existsSync(createDir())) return;
    for (const id of readdirSync(createDir())) {
      try {
        const s = JSON.parse(readFileSync(sessionFile(id), "utf8")) as Session;
        // A run that was going when the studio stopped is not going any more.
        if (s.status === "running" || s.status === "waiting") {
          // A batch reel that was cut off goes back in line and picks up where it was.
          if (s.batch) { s.status = "queued"; s.queued = { text: "Continue", files: [], prompt: "The studio restarted while you were working. Continue this reel from where you left off, to the end; nobody is watching, so never ask questions." }; }
          else s.status = "stopped";
        }
        for (const e of s.events) if ((e.k === "question" || e.k === "permission") && e.status === "waiting") e.status = "cancelled";
        this.sessions.set(id, s);
      } catch { /* not a conversation */ }
    }
    setTimeout(() => this.pump(), 2000).unref();
  }

  list(): SessionMeta[] { return [...this.sessions.values()].map(meta).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  get(id: string): Session | undefined { return this.sessions.get(id); }

  subscribe(id: string, fn: (e: Ev | { k: "meta"; meta: SessionMeta }) => void): () => void {
    const set = this.listeners.get(id) ?? new Set();
    set.add(fn); this.listeners.set(id, set);
    return () => set.delete(fn);
  }

  create(title: string, settings: Settings, model?: string, effort?: string): Session {
    const id = `c_${randomBytes(4).toString("hex")}`;
    const now = new Date().toISOString();
    const s: Session = { id, title: trim(title || "New reel", 60), createdAt: now, updatedAt: now, status: "idle", settings, model, effort, usage: { costUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0, ms: 0 }, events: [] };
    mkdirSync(filesDir(id), { recursive: true });
    this.sessions.set(id, s); this.save(s, true);
    return s;
  }

  /** The first message of a conversation: the /reelcut invocation, with everything the composer gathered. */
  firstPrompt(s: Session, i: StartInput): string {
    const flags: string[] = [];
    if (i.settings?.format) flags.push(`--format ${i.settings.format}`);
    if (i.settings?.length === "short") flags.push("--short");
    if (i.settings?.resolution === "4k") flags.push("--4k"); else if (i.settings?.resolution === "hd") flags.push("--hd");
    if (i.settings?.text) flags.push(`--text ${i.settings.text}`);
    if (i.settings?.blur === "on") flags.push("--blur"); else flags.push("--no-blur");
    if (i.voiceoverPath) flags.push(`--voiceover ${i.voiceoverPath}`);
    if (i.assetsDir) flags.push(`--assets ${i.assetsDir}`);
    const write = i.settings?.mode === "write" && !i.scriptPath;
    const head = `/reelcut ${i.scriptPath ?? ""} ${flags.join(" ")}`.replace(/\s+/g, " ").trim();
    const lines = write ? [] : [head, ""];
    if (write) {
      const secs = Number(i.settings?.target) || 45;
      const scriptOut = path.join(filesDir(s.id), "script.txt");
      lines.push(
        "Write the script for a reel first, then make the reel from it.",
        "",
        "What the owner gave you (a topic, notes or links; read any link with WebFetch first):",
        i.text.trim(), "",
        `- Length: about ${secs} seconds, so about ${Math.round(secs * 2.5)} spoken words.`,
        "- Voice: the default personality's copy and voice (`npm run personality -- brief`), or plain and direct without one.",
        "- 1. Offer three hooks with AskUserQuestion: one question (header \"Hook\"), each option's label the hook's first words and",
        "     its description the whole hook line; your favourite first, marked (Recommended).",
        `- 2. Write the full script on the chosen hook, save it to ${scriptOut}, and show it in your reply as a quote block.`,
        "- 3. Ask with AskUserQuestion: \"Make the reel from this script?\" with options \"Make the reel (Recommended)\", \"Tighten it\"",
        "     and \"Another angle\". Revise and ask again until the owner picks Make the reel.",
        `- 4. Then make the reel: invoke the reelcut skill (Skill tool) with the arguments \`${`${scriptOut} ${flags.join(" ")}`.trim()}\`, and`,
        "     follow it as usual.", "",
      );
    } else if (i.text.trim()) lines.push("Instructions from the owner:", i.text.trim(), "");
    if (i.recipeLines?.length) lines.push(...i.recipeLines);
    if (i.seriesLines?.length) lines.push(...i.seriesLines);
    if (i.settings?.personality) lines.push(`Use the personality "${i.personalityName ?? i.settings.personality}" (${i.settings.personality}); write it into reel.json.`, "");
    if (!i.scriptPath && !write) lines.push("There is no script file: the script is in the instructions above.", "");
    const st = i.settings ?? {};
    const settled = [
      st.format && `format ${st.format}`, st.length && (st.length === "short" ? "a short cut" : "the whole script"), st.resolution && st.resolution.toUpperCase(),
      st.text && `text on screen: ${st.text}`, st.sfx && `sound effects ${st.sfx === "on" ? "on (render with --sfx)" : "off"}`,
      st.music && (st.music === "none" ? "no music" : `a music bed, ${st.music === "snap" ? "cuts snapped to its beat" : "fitted to the cut"}`),
      `motion blur ${st.blur === "on" ? "on" : "off"}`, st.personality && "the look, palette, type and motion (the personality)",
    ].filter(Boolean);
    if (i.unattended) {
      lines.push(
        "This run is one of a batch running unattended: nobody is watching, so never call AskUserQuestion. For every open",
        "question take the option you would recommend, and end your final reply with a section \"Decisions I made\" listing each one.",
        `- Already settled, so follow them: ${settled.join("; ")}.`,
        "- Start your first reply with one line `Title: <a short name for this reel, 2 to 6 words>`.",
        `- Write the reel to a new out-<timestamp>/ folder in ${REPO}, say its path when you write reel.json, and render it to the end.`,
      );
      return lines.join("\n");
    }
    lines.push(
      "This run is driven from the reelcut studio's Create page: the owner is in the studio now, watching this chat.",
      "- Ask your questions with the AskUserQuestion tool; the owner answers them there as cards.",
      "- Never ask whether to open the studio: it is already open, and the page shows the reel as it is made.",
      `- Already settled on the page, so never ask about them: ${settled.join("; ")}.`,
      "- Ask only what is still open and what only this script raises (a step with no recording, a figure with no source…).",
      "- Start your first reply with one line `Title: <a short name for this reel, 2 to 6 words>`; the chat is named after it.",
      `- Write the reel to a new out-<timestamp>/ folder in ${REPO}, and say its path when you write reel.json. Render when`,
      "  ready; the page shows frames and clips as they appear.",
    );
    return lines.join("\n");
  }

  /** Puts a batch reel in line: it starts when no other batch reel is running and its time has come. */
  enqueue(id: string, text: string, files: { name: string; path: string; kind: string }[], prompt: string, startAt?: string): void {
    const s = this.sessions.get(id); if (!s) throw new Error("no such conversation");
    s.queued = { text, files, prompt, ...(startAt ? { startAt } : {}) };
    this.setStatus(s, "queued");
    this.pump();
  }

  /** Starts the next batch reel when the line is free. Called on a timer, when a reel finishes, and when one is queued. */
  pump(): void {
    const busy = [...this.sessions.values()].some((x) => x.batch && this.live.has(x.id) && (x.status === "running" || x.status === "waiting"));
    if (busy) return;
    const now = Date.now();
    const next = [...this.sessions.values()]
      .filter((x) => x.status === "queued" && x.queued && (!x.queued.startAt || Date.parse(x.queued.startAt) <= now))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!next?.queued) return;
    const q = next.queued; delete next.queued;
    this.send(next.id, q.text, q.files, q.prompt);
  }

  /** Takes a reel out of the line before it starts. */
  unqueue(id: string): void {
    const s = this.sessions.get(id);
    if (!s || s.status !== "queued") return;
    delete s.queued; this.push(s, { k: "status", text: "Taken out of the batch", tone: "info" }); this.setStatus(s, "stopped");
  }

  /** Send a message: starts (or resumes) Claude when it is not running, or reaches it at its next turn when it is. */
  send(id: string, text: string, files: { name: string; path: string; kind: string }[] = [], prompt?: string): void {
    const s = this.sessions.get(id); if (!s) throw new Error("no such conversation");
    this.push(s, { k: "user", text, ...(files.length ? { files } : {}) });
    const content = prompt ?? (files.length ? `${text}\n\nFiles the owner added: ${files.map((f) => `${f.name} (${f.path})`).join(", ")}` : text);
    const msg: SDKUserMessage = { type: "user", message: { role: "user", content }, parent_tool_use_id: null };
    const l = this.live.get(id);
    if (l) { clearTimeout(l.idleTimer); l.input.push(msg); this.setStatus(s, "running"); return; }
    this.run(s, msg);
  }

  answer(id: string, eventId: string, answers: Record<string, string>): void {
    const s = this.sessions.get(id), l = this.live.get(id);
    const e = s?.events.find((x) => x.id === eventId);
    const resolve = l?.pending.get(eventId);
    if (!s || !e || e.k !== "question" || !resolve) throw new Error("that question is no longer waiting");
    e.answers = answers; e.status = "answered"; this.emit(s, e);
    l!.pending.delete(eventId);
    resolve({ behavior: "allow", updatedInput: { questions: e.questions, answers } });
    this.setStatus(s, "running");
  }

  permit(id: string, eventId: string, allow: boolean, always = false): void {
    const s = this.sessions.get(id), l = this.live.get(id);
    const e = s?.events.find((x) => x.id === eventId);
    const resolve = l?.pending.get(eventId);
    if (!s || !e || e.k !== "permission" || !resolve) throw new Error("that request is no longer waiting");
    e.status = allow ? "allowed" : "denied"; this.emit(s, e);
    if (allow && always) l!.allowAlways.add(e.tool);
    l!.pending.delete(eventId);
    resolve(allow ? { behavior: "allow" } : { behavior: "deny", message: "The owner declined this in the studio. Find another way, or ask them." });
    this.setStatus(s, "running");
  }

  stop(id: string): void {
    const s = this.sessions.get(id), l = this.live.get(id);
    if (!s || !l) return;
    l.abort.abort();
    for (const [, r] of l.pending) r({ behavior: "deny", message: "Stopped by the owner.", interrupt: true });
    l.input.close();
    this.live.delete(id);
    for (const e of s.events) if ((e.k === "question" || e.k === "permission") && e.status === "waiting") { e.status = "cancelled"; this.emit(s, e); }
    this.push(s, { k: "status", text: "Stopped", tone: "info" });
    this.setStatus(s, "stopped");
  }

  rename(id: string, title: string, byOwner = true): void { const s = this.sessions.get(id); if (s) { s.title = trim(title, 60); if (byOwner) s.named = true; this.save(s); this.emitMeta(s); } }

  private run(s: Session, first: SDKUserMessage): void {
    const abort = new AbortController();
    const queue = inputQueue();
    const live: Live = { q: undefined as unknown as Query, abort, input: queue, pending: new Map(), blocks: new Map(), allowAlways: new Set() };
    this.live.set(s.id, live);
    s.runStartedAt = new Date().toISOString();
    this.setStatus(s, "running");
    const canUseTool: CanUseTool = async (name, input, o) => {
      if (name === "AskUserQuestion") {
        const ev = this.push(s, { k: "question", questions: (input.questions as Question[]) ?? [], status: "waiting" });
        this.setStatus(s, "waiting");
        return new Promise((resolve) => live.pending.set(ev.id, resolve as (v: unknown) => void));
      }
      const reason = live.allowAlways.has(name) ? null : needsPermission(name, input, o.blockedPath);
      if (!reason) return { behavior: "allow", updatedInput: input };
      const ev = this.push(s, { k: "permission", tool: name, detail: trim(name === "Bash" ? String(input.command ?? "") : JSON.stringify(input), 600), reason, status: "waiting" });
      this.setStatus(s, "waiting");
      return new Promise((resolve) => live.pending.set(ev.id, (v) => resolve(v as never)));
    };
    // The owner's Claude login, never an API key: drop one from the environment so Claude Code cannot prefer it.
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "ANTHROPIC_API_KEY" && k !== "CLAUDECODE") env[k] = v;
    queue.push(first);
    const q = (this.opts.queryFn ?? query)({
      prompt: queue.iter,
      options: {
        cwd: REPO, abortController: abort, includePartialMessages: true, canUseTool, env,
        settingSources: ["user", "project", "local"], permissionMode: "default", additionalDirectories: [reelcutHome()],
        ...(s.claudeSession ? { resume: s.claudeSession } : {}),
        ...(s.model ? { model: s.model } : {}),
        ...(s.effort ? { effort: s.effort as never } : {}),
      },
    });
    live.q = q;
    void (async () => {
      try {
        for await (const m of q) this.onMessage(s, live, m);
      } catch (error) {
        if (!abort.signal.aborted) { this.push(s, { k: "status", text: `Claude stopped with an error: ${(error as Error).message}`, tone: "error" }); this.setStatus(s, "failed"); }
      } finally {
        if (this.live.get(s.id) === live) this.live.delete(s.id);
        if (s.status === "running" || s.status === "waiting") this.setStatus(s, "done");
        if (s.batch) this.pump();
      }
    })();
  }

  private onMessage(s: Session, live: Live, m: SDKMessage): void {
    const any = m as Record<string, any>;
    if (m.type === "system" && any.subtype === "init") {
      s.claudeSession = any.session_id;
      // What this run can reach: the MCP servers as Claude Code saw them when it started.
      s.mcp = (any.mcp_servers ?? []).map((x: { name: string; status: string }) => ({ name: x.name, status: x.status }));
      this.emitMeta(s); return;
    }
    if (m.type === "rate_limit_event") {
      const r = any.rate_limit_info ?? {};
      s.usage.plan = { utilization: r.utilization, resetsAt: r.resetsAt, window: r.rateLimitType, status: r.status };
      this.emitMeta(s); return;
    }
    if (m.type === "stream_event" && !any.parent_tool_use_id) {
      const ev = any.event;
      if (ev?.type === "content_block_start" && ev.content_block?.type === "text") {
        const e = this.push(s, { k: "text", text: "", done: false });
        live.blocks.set(ev.index, e.id);
      } else if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        const id = live.blocks.get(ev.index); const e = id && s.events.find((x) => x.id === id);
        if (e && e.k === "text") { e.text += ev.delta.text; this.takeTitle(s, e); this.emit(s, e, false); }
      } else if (ev?.type === "message_start") live.blocks.clear();
      return;
    }
    if (m.type === "assistant" && !any.parent_tool_use_id) {
      for (const b of any.message.content ?? []) {
        if (b.type === "text") {
          // The streamed block is final now; if streaming missed it, add it whole.
          const streamed = [...s.events].reverse().find((e) => e.k === "text" && !e.done);
          if (streamed && streamed.k === "text") { streamed.text = b.text; streamed.done = true; this.takeTitle(s, streamed); this.emit(s, streamed); }
          else { const e = this.push(s, { k: "text", text: b.text, done: true }); if (e.k === "text") { this.takeTitle(s, e); this.emit(s, e); } }
        } else if (b.type === "tool_use" && b.name !== "AskUserQuestion") {
          const input = (b.input ?? {}) as Record<string, unknown>;
          const media = [...JSON.stringify(input).matchAll(MEDIA)].map((x) => x[0]).filter((p) => insideAllowed(p));
          this.push(s, { k: "tool", name: b.name, summary: toolSummary(b.name, input), input: trim(b.name === "Bash" ? String(input.command ?? "") : JSON.stringify(input, null, 1), 2000), status: "running", media }, b.id);
          const f = String(input.file_path ?? "");
          if (/reel\.json$/.test(f)) this.setReel(s, f);
          const fromCmd = /([^\s'"]+\/reel\.json)\b/.exec(String(input.command ?? ""))?.[1];
          if (fromCmd) this.setReel(s, fromCmd);
        }
      }
      return;
    }
    if (m.type === "user" && !any.parent_tool_use_id) {
      const content = any.message?.content;
      for (const b of Array.isArray(content) ? content : []) {
        if (b.type !== "tool_result") continue;
        const e = s.events.find((x) => x.id === b.tool_use_id);
        if (!e || e.k !== "tool") continue;
        const text = Array.isArray(b.content) ? b.content.map((c: any) => c.text ?? "").join("\n") : String(b.content ?? "");
        e.status = b.is_error ? "error" : "ok";
        e.output = trim(text, 4000);
        for (const p of text.match(MEDIA) ?? []) if (insideAllowed(p) && !e.media.includes(p)) e.media.push(p);
        e.media = e.media.filter((p) => existsSync(p)).slice(0, 12);
        if (!s.reel) { const r = /([^\s'"`(]+\/reel\.json)\b/.exec(text)?.[1]; if (r) this.setReel(s, r); }
        this.emit(s, e);
      }
      return;
    }
    if (m.type === "result") {
      s.usage.costUsd += any.total_cost_usd ?? 0;
      s.usage.inputTokens += (any.usage?.input_tokens ?? 0) + (any.usage?.cache_creation_input_tokens ?? 0) + (any.usage?.cache_read_input_tokens ?? 0);
      s.usage.outputTokens += any.usage?.output_tokens ?? 0;
      s.usage.turns += any.num_turns ?? 0;
      s.usage.ms += any.duration_ms ?? 0;
      if (any.subtype !== "success") this.push(s, { k: "status", text: `Claude ended: ${String(any.subtype).replace(/_/g, " ")}`, tone: "error" });
      this.setStatus(s, any.subtype === "success" ? "done" : "failed");
      // Keep the session open a while for a quick follow-up; then let it go (the next message resumes it).
      clearTimeout(live.idleTimer);
      // A batch reel lets go at once, so the next one in line can start.
      live.idleTimer = setTimeout(() => { live.input.close(); }, s.batch ? 0 : this.opts.idleMs ?? 10 * 60_000);
    }
  }

  /** Claude writes paths relative to the project as often as absolute ones; either names the reel once it exists. */
  setReel(s: Session, p: string): void {
    const abs = path.isAbsolute(p) ? p : path.resolve(REPO, p.replace(/^\.\//, ""));
    if (s.reel === abs || !insideAllowed(abs)) return;
    s.reel = abs; this.emitMeta(s);
  }

  /**
   * The reel a conversation made, when nothing in its messages named it: the newest out-*\/reel.json in the project
   * written after the conversation began.
   */
  findReel(id: string): string | undefined {
    const s = this.sessions.get(id); if (!s) return undefined;
    if (s.reel && existsSync(s.reel)) return s.reel;
    const since = Date.parse(s.createdAt);
    let best: { p: string; t: number } | undefined;
    for (const d of readdirSync(REPO)) {
      if (!/^out(-|$)/.test(d)) continue;
      const p = path.join(REPO, d, "reel.json");
      try { const t = statSync(p).mtimeMs; if (t >= since && (!best || t > best.t)) best = { p, t }; } catch { /* no reel here */ }
    }
    if (best) this.setReel(s, best.p);
    return best?.p;
  }

  /** A line in the chat from outside Claude: a reviewer's comment, a finished job. */
  note(id: string, text: string, tone: "info" | "ok" | "error" = "info"): void { const s = this.sessions.get(id); if (s) this.push(s, { k: "status", text, tone }); }

  progress(id: string): Progress | undefined { const s = this.sessions.get(id); return s ? progressOf(s, this.findReel(id)) : undefined; }

  /** "Title: …" on the first line of a reply names the conversation, and is not shown. */
  private takeTitle(s: Session, e: Ev): void {
    if (e.k !== "text") return;
    const m = /^\s*Title:\s*([^\n]+)\n+/.exec(e.text);
    if (!m) return;
    e.text = e.text.slice(m[0].length);
    if (!s.named) { s.named = true; s.title = trim(m[1]!.replace(/[*_`#"“”]/g, "").trim(), 60); this.emitMeta(s); }
  }

  private push(s: Session, e: Body, id?: string): Ev {
    const ev = { ...e, id: id ?? `e${s.events.length + 1}_${randomBytes(2).toString("hex")}`, seq: s.events.length + 1, at: new Date().toISOString() } as Ev;
    s.events.push(ev);
    this.emit(s, ev);
    return ev;
  }
  private emit(s: Session, e: Ev, persist = true): void {
    s.updatedAt = new Date().toISOString();
    for (const fn of this.listeners.get(s.id) ?? []) fn(e);
    this.save(s, !persist);
  }
  private emitMeta(s: Session): void { for (const fn of this.listeners.get(s.id) ?? []) fn({ k: "meta", meta: meta(s) }); this.save(s); }
  private setStatus(s: Session, status: SessionMeta["status"]): void { if (s.status === status) return; s.status = status; this.emitMeta(s); }
  /** Saved a moment after the last change, so streaming text is not written to disk word by word. */
  private save(s: Session, later = false): void {
    clearTimeout(this.saveTimers.get(s.id));
    const write = () => { mkdirSync(path.dirname(sessionFile(s.id)), { recursive: true }); writeFileSync(sessionFile(s.id), JSON.stringify(s)); };
    if (!later) return write();
    this.saveTimers.set(s.id, setTimeout(write, 800));
  }
}

export interface Stage { id: string; label: string; state: "done" | "now" | "todo"; n?: number; of?: number }
export interface Progress { mode: "make" | "edit"; stages: Stage[]; pct: number; line: string; live: boolean }

/**
 * How far along a reel is, read from what exists on disk (and, before there is a reel, from the chat): the brief,
 * the plan, a composition per beat, a measured frame per beat, a clip per beat, the master. A run on a reel that
 * already has a master is an edit: changed beats, their new clips and the rejoined master since the run began.
 */
export function progressOf(s: Pick<Session, "status" | "runStartedAt" | "events">, reelPath: string | undefined): Progress {
  const live = s.status === "running" || s.status === "waiting";
  const waiting = s.events.some((e) => (e.k === "question" || e.k === "permission") && e.status === "waiting");
  const mk = (stages: Stage[], weights: number[], line: string, mode: Progress["mode"]): Progress => {
    let pct = 0;
    stages.forEach((st, i) => { pct += weights[i]! * (st.state === "done" ? 1 : st.state === "now" && st.of ? (st.n ?? 0) / st.of : 0); });
    return { mode, stages, pct: Math.round(Math.min(1, pct) * 100), line, live };
  };
  const labels = [["brief", "Brief"], ["plan", "Plan"], ["compose", "Compose"], ["check", "Check"], ["render", "Render"], ["master", "Master"]] as const;
  const W = [0.08, 0.07, 0.35, 0.15, 0.3, 0.05];
  if (!reelPath || !existsSync(reelPath)) {
    const st: Stage[] = labels.map(([id, label], i) => ({ id, label, state: i === 0 && (live || waiting) ? "now" : "todo" }));
    const line = waiting ? "Waiting for your answer" : live ? "Reading the script and your personality" : s.events.length ? "Not started on the reel yet" : "";
    return mk(st, W, line, "make");
  }
  const dir = path.dirname(reelPath);
  let beats: { id: string; composition?: string }[] = [];
  try { beats = (JSON.parse(readFileSync(reelPath, "utf8")) as { beats?: typeof beats }).beats ?? []; } catch { /* being written */ }
  const mtime = (p: string) => { try { return statSync(p).mtimeMs; } catch { return 0; } };
  const comp = (b: { id: string; composition?: string }) => path.join(dir, b.composition ?? `compositions/${b.id}.html`);
  const measureDir = path.join(dir, "measure");
  const shots = existsSync(measureDir) ? readdirSync(measureDir) : [];
  const since = s.runStartedAt ? Date.parse(s.runStartedAt) : 0;
  const masterAt = mtime(path.join(dir, "master.mp4"));
  const of = beats.length;

  // An edit: the reel was finished before this run began.
  if (masterAt && since && masterAt < since && live) {
    const changed = beats.filter((b) => mtime(comp(b)) > since).length || (mtime(reelPath) > since ? 1 : 0);
    const rendered = beats.filter((b) => mtime(path.join(dir, "clips", `${b.id}.mp4`)) > since).length;
    const joined = masterAt > since;
    const st: Stage[] = [
      { id: "change", label: "Change", state: changed ? "done" : "now" },
      { id: "render", label: "Re-render", state: rendered ? (joined ? "done" : "now") : changed ? "now" : "todo", n: rendered, of: Math.max(1, changed) },
      { id: "master", label: "Rejoin", state: joined ? "done" : rendered ? "now" : "todo" },
    ];
    const line = waiting ? "Waiting for your answer" : !changed ? "Making the change" : !rendered ? "Re-rendering the changed beat" : !joined ? "Rejoining the master" : "Checking the result";
    return mk(st, [0.4, 0.45, 0.15], line, "edit");
  }

  const composed = beats.filter((b) => existsSync(comp(b))).length;
  const checked = beats.filter((b) => shots.some((f) => f.startsWith(`${b.id}-`))).length;
  const clips = beats.filter((b) => existsSync(path.join(dir, "clips", `${b.id}.mp4`))).length;
  const master = !!masterAt;
  const planned = of > 0;
  const state = (done: boolean, started: boolean): Stage["state"] => done ? "done" : started ? "now" : "todo";
  const st: Stage[] = [
    { id: "brief", label: "Brief", state: "done" },
    { id: "plan", label: "Plan", state: state(planned && composed > 0, true), n: of, of: of || undefined },
    { id: "compose", label: "Compose", state: state(planned && composed === of, composed > 0), n: composed, of },
    { id: "check", label: "Check", state: state(planned && checked === of, checked > 0), n: checked, of },
    { id: "render", label: "Render", state: state(planned && clips === of, clips > 0), n: clips, of },
    { id: "master", label: "Master", state: master ? "done" : clips === of && planned ? "now" : "todo" },
  ];
  // Stages run in order: anything before the furthest stage started reads as done (Claude may check only some beats'
  // frames), and only that furthest stage can be "now". A reel with its master is finished.
  const furthest = Math.max(st.map((x) => x.state).lastIndexOf("now"), st.map((x) => x.state).lastIndexOf("done"));
  st.forEach((x, i) => { if (i < furthest) x.state = "done"; });
  if (master) st.forEach((x) => { x.state = "done"; });
  if (!live && !master) st.forEach((x) => { if (x.state === "now") x.state = "todo"; });
  const cur = st.find((x) => x.state === "now");
  const line = master && !live ? "Finished" : waiting ? "Waiting for your answer"
    : !cur ? (live ? "Working" : "Paused")
    : cur.id === "plan" ? `Planned ${of} beat${of === 1 ? "" : "s"}; composing next`
    : cur.id === "compose" ? `Composing beats · ${composed} of ${of}`
    : cur.id === "check" ? `Checking frames · ${checked} of ${of}`
    : cur.id === "render" ? `Rendering clips · ${clips} of ${of}`
    : "Joining the master";
  return mk(st, W, line, "make");
}

function meta(s: Session): SessionMeta { const { events: _e, ...m } = s; return m; }

/** What the reel panel shows: the beats of reel.json and what exists for each so far. */
export function reelState(reelPath: string | undefined): unknown {
  if (!reelPath || !existsSync(reelPath)) return null;
  const dir = path.dirname(reelPath);
  let manifest: { beats?: { id: string; durationSeconds?: number; composition?: string; style?: string; kind?: string }[]; format?: string } = {};
  try { manifest = JSON.parse(readFileSync(reelPath, "utf8")); } catch { return { dir, beats: [], error: "reel.json does not parse yet" }; }
  // Each file carries its modified time, so a beat Claude re-renders reloads in the page instead of staying cached.
  const at = (rel: string) => { const p = path.join(dir, rel); try { return `${p}#${Math.round(statSync(p).mtimeMs)}`; } catch { return undefined; } };
  const measureDir = path.join(dir, "measure");
  const shots = existsSync(measureDir) ? readdirSync(measureDir).filter((f) => /\.(png|jpe?g)$/.test(f)) : [];
  let start = 0;
  const beats = (manifest.beats ?? []).map((b) => ({
    id: b.id, seconds: b.durationSeconds, style: b.style, kind: b.kind, start: (start += b.durationSeconds ?? 0) - (b.durationSeconds ?? 0),
    clip: at(`clips/${b.id}.mp4`),
    frame: shots.filter((f) => f.startsWith(b.id)).sort().map((f) => path.join(measureDir, f)).at(-1),
  }));
  const plan = existsSync(path.join(dir, "plan.md")) ? path.join(dir, "plan.md") : undefined;
  return {
    dir, format: manifest.format, beats,
    seconds: beats.reduce((a, b) => a + (b.seconds ?? 0), 0),
    master: at("master.mp4"), contact: at("contact.jpg"), poster: at("poster.jpg"), sheet: at("measure/reel-sheet.jpg"),
    plan: plan ? readFileSync(plan, "utf8").slice(0, 6000) : undefined,
  };
}
