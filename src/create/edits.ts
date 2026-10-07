import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createDir } from "./manager.js";
import { STYLES } from "../personality/styles.js";

/**
 * Editing a finished reel from the Create page: actions on one beat, and comments pinned to frames of the master.
 * Neither edits a file itself. Each becomes a precise instruction to Claude in the same session (which knows the reel),
 * so a change is made the way the beat was made, and only that beat is re-rendered before the master is rejoined.
 */

export interface ReelBeat { id: string; durationSeconds?: number; composition?: string; style?: string; kind?: string }
export interface ReelFile { beats: ReelBeat[]; voiceover?: unknown; music?: unknown; sfx?: unknown }

export function readReel(reelPath: string): ReelFile {
  return JSON.parse(readFileSync(reelPath, "utf8")) as ReelFile;
}

/** Where a time in the master falls: which beat, and how far into it. */
export function beatAt(beats: readonly ReelBeat[], t: number): { beat: ReelBeat; index: number; into: number } | undefined {
  let start = 0;
  for (let i = 0; i < beats.length; i++) {
    const d = beats[i]!.durationSeconds ?? 0;
    if (t < start + d || i === beats.length - 1) return { beat: beats[i]!, index: i, into: Math.max(0, Math.min(d, t - start)) };
    start += d;
  }
  return undefined;
}

/** The words a beat puts on screen, read from its composition (for the Edit text field). */
export function beatText(reelPath: string, beat: ReelBeat): string[] {
  if (!beat.composition) return [];
  const file = path.resolve(path.dirname(reelPath), beat.composition);
  if (!existsSync(file)) return [];
  const html = readFileSync(file, "utf8").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<svg[\s\S]*?<\/svg>/gi, "");
  const lines = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(div|p|h\d|li|span class="ln")>/gi, "\n").replace(/<[^>]+>/g, " ")
    .split("\n").map((l) => l.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim()).filter((l) => l && l.length < 200);
  // A word set letter by letter (tiles, a typewriter) is one word: merge runs of single characters, on a line or
  // one per line.
  for (let i = 0; i < lines.length; i++) lines[i] = lines[i]!.replace(/(?<!\S)(?:\p{L}\p{N}?|\p{N}) (?:(?:\p{L}|\p{N}) ){1,}(?:\p{L}|\p{N})(?!\S)/gu, (m) => m.replace(/ /g, ""));
  const merged: string[] & { lastRun?: boolean } = [];
  for (const l of lines) {
    const prev = merged.at(-1);
    if (l.length === 1 && prev !== undefined && /^\S+$/.test(prev) && (prev.length === 1 || merged.lastRun)) { merged[merged.length - 1] = prev + l; merged.lastRun = true; continue; }
    merged.lastRun = l.length === 1;
    merged.push(l);
  }
  return [...new Set(merged)].slice(0, 20);
}

export type EditAction =
  | { kind: "redo" } | { kind: "calmer" } | { kind: "punchier" }
  | { kind: "style"; style: string }
  | { kind: "text"; text: string }
  | { kind: "image"; asset: { id: string; name: string; path: string } }
  | { kind: "move"; to: number }
  | { kind: "remove" }
  | { kind: "note"; text: string };

const renderTail = (reel: string, beat: string, audio: boolean) => [
  `Then re-render only this beat: \`npm run render -- ${reel} --only ${beat} --clips-only${audio ? " --sfx" : ""}\`, check it (measure or the contact frames),`,
  `and rejoin the master: \`npm run render -- ${reel} --master-only${audio ? " --sfx" : ""}\`. Reply in one or two lines saying what you changed.`,
].join("\n");

/** The chat line the owner sees, and the instruction Claude gets. */
export function editPrompt(reelPath: string, reel: ReelFile, beatId: string, action: EditAction): { shown: string; prompt: string } {
  const i = reel.beats.findIndex((b) => b.id === beatId);
  if (i < 0) throw new Error(`no beat ${beatId} in this reel`);
  const b = reel.beats[i]!;
  const audio = !!(reel.sfx || reel.beats.some((x) => (x as { sfx?: unknown[] }).sfx?.length) || reel.music || reel.voiceover);
  const where = `beat ${i + 1} (${b.id}${b.kind ? `, a ${b.kind}` : ""}${b.style ? ` in ${b.style}` : ""}; composition ${b.composition ?? "?"}) of the reel at ${reelPath}`;
  const keep = "Change only this beat. Keep its length and its place, its colours, type and personality unless the change is about them.";
  const label = `Beat ${i + 1}`;
  switch (action.kind) {
    case "redo": return { shown: `${label}: another take`, prompt: `Make a fresh take of ${where}: the same message and the same length, composed differently (a different move from the patterns, a different layout). ${keep}\n${renderTail(reelPath, b.id, audio)}` };
    case "calmer": return { shown: `${label}: calmer`, prompt: `Make ${where} calmer: fewer things moving at once, softer springs (spring.gentle and spring.soft), longer holds, no overshoot, a slower camera. ${keep}\n${renderTail(reelPath, b.id, audio)}` };
    case "punchier": return { shown: `${label}: punchier`, prompt: `Make ${where} punchier: quicker entrances (spring.snappy), a stronger hook in the first 0.3 s, bigger type, one decisive move; still no bounce except the reel's one earned moment. ${keep}\n${renderTail(reelPath, b.id, audio)}` };
    case "style": {
      const st = STYLES.find((s) => s.id === action.style);
      if (!st) throw new Error(`no style ${action.style}`);
      return { shown: `${label}: in ${st.name}`, prompt: `Remake ${where} in the ${st.name} style: data-style="${st.id}" on its root, that style's scheme from the personality (or its first curated scheme), its type pairing, its moves and motion; open skills/reelcut/assets/patterns/styles/${st.id}.html first. Same message, same length, same place. Record "style": "${st.id}" on the beat in reel.json.\n${renderTail(reelPath, b.id, audio)}` };
    }
    case "text": return { shown: `${label}: new text`, prompt: `Change the words on screen in ${where} to exactly this (one line per line, keep the emphasis style for the key word):\n"""\n${action.text.trim()}\n"""\nRe-check the reading floor for the new words; if they need more time than the beat has, say so instead of shortening them. ${keep}\n${renderTail(reelPath, b.id, audio)}` };
    case "image": return { shown: `${label}: swap in ${action.asset.name}`, prompt: `In ${where}, replace the main image (the logo, screenshot or picture it shows) with the library asset ${action.asset.id} ("${action.asset.name}", at ${action.asset.path}). Frame it the way the beat framed the old one; record the asset in report.md. ${keep}\n${renderTail(reelPath, b.id, audio)}` };
    case "move": {
      const to = Math.max(0, Math.min(reel.beats.length - 1, action.to));
      const voice = reel.voiceover ? " This reel has a voiceover: moving a beat breaks its timing, so check with the owner first (AskUserQuestion) and say what would change." : "";
      return { shown: `Move beat ${i + 1} to position ${to + 1}`, prompt: `Move ${where} so it becomes beat ${to + 1} of ${reel.beats.length}: reorder "beats" in reel.json. Check that the cut into and out of it still matches (exit direction to entry edge) and fix only what breaks.${voice}\nNo beat needs re-rendering unless you changed it; rejoin the master: \`npm run render -- ${reelPath} --master-only${audio ? " --sfx" : ""}\`. Reply in one line.` };
    }
    case "remove": return { shown: `Remove beat ${i + 1}`, prompt: `Remove ${where} from the reel: take it out of "beats" in reel.json (keep its files). Check the cut between the beats on either side still works, fix only what breaks, and rejoin the master: \`npm run render -- ${reelPath} --master-only${audio ? " --sfx" : ""}\`. Reply in one line.` };
    case "note": return { shown: `${label}: ${action.text.trim()}`, prompt: `For ${where}: ${action.text.trim()}\n${keep}\n${renderTail(reelPath, b.id, audio)}` };
  }
}

// ---- frame comments

export interface FrameComment {
  id: string;
  /** Seconds into the master. */
  t: number;
  beat: string;
  beatIndex: number;
  /** Seconds into that beat. */
  into: number;
  /** Where on the frame, as fractions of its width and height; absent for a comment on the whole frame. */
  x?: number;
  y?: number;
  text: string;
  author: string;
  status: "open" | "sent" | "resolved";
  /** A still of that frame, so Claude can look at exactly what the owner saw. */
  frame?: string;
  createdAt: string;
}

const commentsFile = (id: string) => path.join(createDir(), id, "comments.json");
export function loadComments(id: string): FrameComment[] {
  try { return JSON.parse(readFileSync(commentsFile(id), "utf8")) as FrameComment[]; } catch { return []; }
}
function saveComments(id: string, list: FrameComment[]): void {
  mkdirSync(path.dirname(commentsFile(id)), { recursive: true });
  writeFileSync(commentsFile(id), JSON.stringify(list, null, 1));
}

export function addComment(id: string, reelPath: string, input: { t: number; x?: number; y?: number; text: string; author?: string }): FrameComment {
  const reel = readReel(reelPath);
  const at = beatAt(reel.beats, input.t);
  if (!at) throw new Error("the reel has no beats yet");
  const cid = `fc_${randomBytes(4).toString("hex")}`;
  const dir = path.join(createDir(), id, "comments");
  mkdirSync(dir, { recursive: true });
  const master = path.join(path.dirname(reelPath), "master.mp4");
  let frame: string | undefined = path.join(dir, `${cid}.jpg`);
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", input.t.toFixed(3), "-i", master, "-frames:v", "1", "-q:v", "3", frame]);
  if (r.status !== 0 || !existsSync(frame)) frame = undefined;
  const c: FrameComment = {
    id: cid, t: input.t, beat: at.beat.id, beatIndex: at.index, into: Math.round(at.into * 100) / 100,
    ...(input.x != null && input.y != null ? { x: Math.max(0, Math.min(1, input.x)), y: Math.max(0, Math.min(1, input.y)) } : {}),
    text: input.text.trim().slice(0, 1000), author: input.author ?? "you", status: "open", ...(frame ? { frame } : {}), createdAt: new Date().toISOString(),
  };
  const list = loadComments(id); list.push(c); list.sort((a, b) => a.t - b.t); saveComments(id, list);
  return c;
}

export function updateComment(id: string, cid: string, patch: Partial<Pick<FrameComment, "text" | "status">>): FrameComment {
  const list = loadComments(id);
  const c = list.find((x) => x.id === cid);
  if (!c) throw new Error("no such comment");
  if (patch.text != null) c.text = patch.text.trim().slice(0, 1000);
  if (patch.status) c.status = patch.status;
  saveComments(id, list);
  return c;
}
export function removeComment(id: string, cid: string): void { saveComments(id, loadComments(id).filter((x) => x.id !== cid)); }

const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

/** Every open comment as one instruction: grouped by beat, each with its moment, its spot and the frame to look at. */
export function commentsPrompt(id: string, reelPath: string): { shown: string; prompt: string; sent: string[] } {
  const open = loadComments(id).filter((c) => c.status === "open");
  if (!open.length) throw new Error("no open comments");
  const reel = readReel(reelPath);
  const audio = !!(reel.sfx || reel.beats.some((x) => (x as { sfx?: unknown[] }).sfx?.length) || reel.music || reel.voiceover);
  const byBeat = new Map<string, FrameComment[]>();
  for (const c of open) byBeat.set(c.beat, [...(byBeat.get(c.beat) ?? []), c]);
  const lines = [`The owner left ${open.length} comment${open.length > 1 ? "s" : ""} on frames of the master (${reelPath}). Fix each one in its beat. Look at each frame image before you change anything.`, ""];
  for (const [beat, cs] of byBeat) {
    const b = reel.beats.find((x) => x.id === beat);
    lines.push(`${beat} (beat ${cs[0]!.beatIndex + 1}${b?.composition ? `, ${b.composition}` : ""}):`);
    for (const c of cs) {
      const spot = c.x != null && c.y != null ? `, at ${Math.round(c.x * 100)}% across and ${Math.round(c.y * 100)}% down the frame` : "";
      lines.push(`- ${clock(c.t)} in the reel (${c.into.toFixed(2)} s into the beat${spot}): "${c.text}"${c.frame ? ` — frame: ${c.frame}` : ""}`);
    }
    lines.push("");
  }
  lines.push(`Change only what the comments ask, then re-render only the beats you changed (\`npm run render -- ${reelPath} --only <ids> --clips-only${audio ? " --sfx" : ""}\`) and rejoin the master (\`--master-only\`). Reply with one line per comment saying what you did.`);
  return { shown: `${open.length} frame comment${open.length > 1 ? "s" : ""} for Claude`, prompt: lines.join("\n"), sent: open.map((c) => c.id) };
}
