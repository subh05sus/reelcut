import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { reelcutHome } from "../library/store.js";
import { defaultPersonality } from "../personality/store.js";
import { PLAIN } from "../taxonomy/plain.js";
import { previewDirFor } from "../taxonomy/previews.js";
import { readReel } from "./edits.js";
import { createShare, findShare, type Share } from "./share.js";

/**
 * A client approval board: one reel's review link, in up to four stages the client approves in turn.
 *
 *   directions   what each beat will do (its technique in plain words, its preview clip, why)
 *   script       the plan: the script and the beat list, before anything is rendered
 *   beats        each rendered beat, approved or sent back with a note
 *   master       the finished reel
 *
 * The owner publishes a stage from the studio when it is ready; publishing takes a snapshot (so the client sees what
 * was sent, not whatever Claude is doing now) and lists exactly which files the link may serve. Every decision is
 * kept; when a stage has a decision on every item, Claude gets one message: go on, or make these changes first.
 * The board never shows paths or technique ids, only the studio's plain words.
 */
export const BOARD_STAGES = ["directions", "script", "beats", "master"] as const;
export type BoardStage = (typeof BOARD_STAGES)[number];
export const STAGE_NAMES: Record<BoardStage, string> = { directions: "Directions", script: "Script and beat plan", beats: "Beat drafts", master: "Final reel" };

export interface BoardItem {
  id: string;
  title: string;
  /** What it does, in plain words (directions), or the beat's words. */
  plain?: string;
  why?: string;
  /** A file the link may serve for this item (a technique preview, a beat clip, the master). Never sent to the page. */
  file?: string;
  poster?: string;
  kind?: "video" | "text";
  text?: string;
}
export interface Published { at: string; items: BoardItem[] }
export interface Decision { status: "approved" | "changes"; note?: string; author: string; at: string }
export interface Board {
  token: string;
  conversation: string;
  title: string;
  reel: string;
  stages: BoardStage[];
  published: Partial<Record<BoardStage, Published>>;
  decisions: Partial<Record<BoardStage, Record<string, Decision>>>;
  createdAt: string;
}

const file = () => path.join(reelcutHome(), "create", "boards.json");
export function loadBoards(): Board[] { try { return JSON.parse(readFileSync(file(), "utf8")) as Board[]; } catch { return []; } }
function saveBoards(list: Board[]): void { mkdirSync(path.dirname(file()), { recursive: true }); writeFileSync(file(), JSON.stringify(list, null, 1)); }
/** The live board on a link (its share still live), or none. */
export function boardFor(token: string): Board | undefined {
  return findShare(token) ? loadBoards().find((b) => b.token === token) : undefined;
}
export function boardsOf(conversation: string): Board[] { return loadBoards().filter((b) => b.conversation === conversation && findShare(b.token)); }

export function createBoard(conversation: string, title: string, reel: string, stages: readonly string[], days = 14): { board: Board; share: Share } {
  const chosen = BOARD_STAGES.filter((s) => stages.includes(s));
  if (!chosen.length) throw new Error("choose at least one stage for the client to approve");
  const share = createShare(conversation, title, reel, days);
  const board: Board = { token: share.token, conversation, title, reel, stages: chosen, published: {}, decisions: {}, createdAt: new Date().toISOString() };
  saveBoards([board, ...loadBoards().filter((b) => findShare(b.token))]);
  return { board, share };
}

/** What the client sees for a stage, taken from the reel as it is now. */
export function snapshot(stage: BoardStage, reelPath: string): BoardItem[] {
  const reel = readReel(reelPath), dir = path.dirname(reelPath);
  const beats = reel.beats as (typeof reel.beats[number] & { technique?: string; techniqueWhy?: string; kind?: string })[];
  const label = (i: number, b: { kind?: string }) => `Beat ${i + 1}${b.kind ? ` · ${b.kind}` : ""}`;
  switch (stage) {
    case "directions": {
      const pv = previewDirFor(defaultPersonality());
      return beats.map((b, i) => {
        const id = b.technique?.split("/")[2];
        const clip = id ? path.join(pv, `${id}.mp4`) : undefined;
        return { id: b.id, title: label(i, b), plain: id ? PLAIN[id]?.plain ?? id : "Not decided yet", ...(b.techniqueWhy ? { why: b.techniqueWhy } : {}), ...(clip && existsSync(clip) ? { file: clip, poster: clip.replace(/\.mp4$/, ".jpg"), kind: "video" as const } : {}) };
      });
    }
    case "script": {
      const plan = path.join(dir, "plan.md");
      const text = existsSync(plan) ? readFileSync(plan, "utf8").slice(0, 20_000) : beats.map((b, i) => `${label(i, b)}: ${b.id}`).join("\n");
      return [{ id: "script", title: "The script and the beat plan", kind: "text", text }];
    }
    case "beats":
      return beats.map((b, i) => {
        const clip = path.join(dir, "clips", `${b.id}.mp4`);
        const id = b.technique?.split("/")[2];
        return { id: b.id, title: label(i, b), ...(id ? { plain: PLAIN[id]?.plain ?? id } : {}), ...(existsSync(clip) ? { file: clip, kind: "video" as const } : {}) };
      }).filter((x) => x.file);
    case "master": {
      const m = path.join(dir, "master.mp4");
      return existsSync(m) ? [{ id: "master", title: "The finished reel", file: m, kind: "video", ...(existsSync(path.join(dir, "poster.jpg")) ? { poster: path.join(dir, "poster.jpg") } : {}) }] : [];
    }
  }
}

export function publishStage(token: string, stage: BoardStage): Published {
  const list = loadBoards(), b = list.find((x) => x.token === token);
  if (!b) throw new Error("no such board");
  if (!b.stages.includes(stage)) throw new Error(`this board does not ask for ${STAGE_NAMES[stage].toLowerCase()}`);
  const items = snapshot(stage, b.reel);
  if (!items.length) throw new Error(stage === "beats" ? "no beat is rendered yet" : stage === "master" ? "the reel has no master yet" : "nothing to show yet");
  const pub: Published = { at: new Date().toISOString(), items };
  b.published[stage] = pub;
  b.decisions[stage] = {};
  saveBoards(list);
  return pub;
}

export interface DecideResult { board: Board; stageDone: boolean; line: string }
export function decide(token: string, stage: BoardStage, item: string, d: { status: "approved" | "changes"; note?: string; author: string }): DecideResult {
  const list = loadBoards(), b = list.find((x) => x.token === token);
  if (!b || !findShare(token)) throw new Error("This board has expired or was turned off.");
  const pub = b.published[stage];
  if (!pub || !pub.items.some((x) => x.id === item)) throw new Error("That is not on the board.");
  const note = d.note?.trim().slice(0, 1000);
  if (d.status === "changes" && !note) throw new Error("Say what should change.");
  (b.decisions[stage] ??= {})[item] = { status: d.status, ...(note ? { note } : {}), author: d.author, at: new Date().toISOString() };
  saveBoards(list);
  const title = pub.items.find((x) => x.id === item)!.title;
  const stageDone = pub.items.every((x) => b.decisions[stage]?.[x.id]);
  return { board: b, stageDone, line: `${d.author} ${d.status === "approved" ? "approved" : "asked for a change to"} ${title.toLowerCase().startsWith("beat") ? title : `the ${STAGE_NAMES[stage].toLowerCase()}`}${note ? `: “${note.slice(0, 140)}”` : ""}` };
}

const NEXT: Record<BoardStage, string> = {
  directions: "write the script on these directions and plan the beats (Step 1), then stop: the owner sends the script to the board",
  script: "compose and render the beats, then stop: the owner sends the beat drafts to the board",
  beats: "join the master and finish the reel, then stop: the owner sends the final reel to the board",
  master: "the reel is approved: finish (post kit if asked) and tell the owner",
};

/** The message Claude gets when the client has decided every item of a stage. */
export function stagePrompt(b: Board, stage: BoardStage): { shown: string; prompt: string } {
  const pub = b.published[stage]!, ds = b.decisions[stage] ?? {};
  const changes = pub.items.filter((x) => ds[x.id]?.status === "changes");
  const who = [...new Set(Object.values(ds).map((x) => x.author))].join(", ");
  if (!changes.length) {
    const later = b.stages.slice(b.stages.indexOf(stage) + 1);
    return { shown: `The client approved the ${STAGE_NAMES[stage].toLowerCase()}`, prompt: `On the client approval board, ${who} approved the ${STAGE_NAMES[stage].toLowerCase()} (every item). Now ${NEXT[stage]}.${later.length ? ` The board still asks for: ${later.map((s) => STAGE_NAMES[s].toLowerCase()).join(", ")}. After each, stop and say it is ready for the board; wait for the client's decision before going on.` : ""}` };
  }
  return {
    shown: `The client asked for ${changes.length} change${changes.length === 1 ? "" : "s"} to the ${STAGE_NAMES[stage].toLowerCase()}`,
    prompt: [`On the client approval board, ${who} asked for changes to the ${STAGE_NAMES[stage].toLowerCase()}:`,
      ...changes.map((x) => `- ${x.title}: ${ds[x.id]!.note}`),
      `Make exactly these changes (only these items${stage === "beats" ? "; re-render only those beats" : ""}), then stop and tell the owner it is ready to send to the board again. Do not move on until the client approves it.`].join("\n"),
  };
}

/** The board as the client's page reads it: no paths, no ids beyond the items'. */
export function publicBoard(b: Board): unknown {
  return {
    title: b.title, stages: b.stages.map((s) => ({ id: s, name: STAGE_NAMES[s], published: b.published[s] ? { at: b.published[s]!.at, items: b.published[s]!.items.map(({ file: f, poster: p, ...x }) => ({ ...x, media: !!f, poster: !!p })) } : null, decisions: b.decisions[s] ?? {} })),
  };
}

/** The file for a published item, if the board lists it (the only files a board link serves). */
export function boardFile(b: Board, stage: string, item: string, poster = false): string | undefined {
  const it = (BOARD_STAGES as readonly string[]).includes(stage) ? b.published[stage as BoardStage]?.items.find((x) => x.id === item) : undefined;
  const f = poster ? it?.poster : it?.file;
  return f && existsSync(f) ? f : undefined;
}

/** For the owner's panel: where each stage stands. */
export function boardStatus(b: Board): { stage: BoardStage; name: string; published: string | null; items: number; approved: number; changes: number }[] {
  return b.stages.map((s) => {
    const pub = b.published[s], ds = b.decisions[s] ?? {};
    return { stage: s, name: STAGE_NAMES[s], published: pub?.at ?? null, items: pub?.items.length ?? 0, approved: Object.values(ds).filter((x) => x.status === "approved").length, changes: Object.values(ds).filter((x) => x.status === "changes").length };
  });
}
