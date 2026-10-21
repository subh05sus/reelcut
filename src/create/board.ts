import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { reelcutHome } from "../library/store.js";
import { defaultPersonality } from "../personality/store.js";
import { PLAIN } from "../taxonomy/plain.js";
import { previewDirFor } from "../taxonomy/previews.js";
import { Img, writeJpeg } from "../watch/image.js";
import { where } from "../watch/ocr.js";
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
 *
 * Each send keeps its own copies of the files (a beat re-rendered in place would otherwise change what the client
 * approved), and the one before it: an item sent back with a change shows the client the version they saw beside the
 * new one. A change can carry marks on the frame (a pin, or lines drawn over it); Claude gets the second, where, and a
 * still of that frame with the marks drawn on it. The owner's name, colour and logo can head the page.
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
export interface Published { at: string; items: BoardItem[]; version?: number }
/** A mark on a frame: a pin (x, y), or lines drawn over it (each a flat list x0, y0, x1, y1, …), as fractions. */
export interface Mark { t: number; x?: number; y?: number; strokes?: number[][]; /** The still with the marks drawn on it, for Claude. */ frame?: string }
export interface Decision { status: "approved" | "changes"; note?: string; author: string; at: string; marks?: Mark[] }
/** An earlier send of a stage, with what the client decided on it. */
export interface Sent { published: Published; decisions: Record<string, Decision> }
export interface Board {
  token: string;
  conversation: string;
  title: string;
  reel: string;
  stages: BoardStage[];
  published: Partial<Record<BoardStage, Published>>;
  decisions: Partial<Record<BoardStage, Record<string, Decision>>>;
  /** The send before the current one, per stage. */
  previous?: Partial<Record<BoardStage, Sent>>;
  createdAt: string;
}

const file = () => path.join(reelcutHome(), "create", "boards.json");
/** Where a board keeps the files it sent. */
export const boardDir = (token: string) => path.join(reelcutHome(), "create", "boards", token);
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
  const old = b.published[stage];
  const version = (old?.version ?? 0) + 1;
  // The client sees what was sent: copies, so a re-render does not change it under them.
  const vdir = path.join(boardDir(token), `${stage}-${version}`);
  mkdirSync(vdir, { recursive: true });
  for (const it of items) {
    const keep = (f?: string, ext = ".mp4") => { if (!f || !existsSync(f)) return undefined; const to = path.join(vdir, `${it.id.replace(/[^A-Za-z0-9_-]/g, "_")}${f.endsWith(".jpg") ? ".jpg" : ext}`); copyFileSync(f, to); return to; };
    it.file = keep(it.file); it.poster = keep(it.poster, ".jpg");
    if (!it.file) delete it.file; if (!it.poster) delete it.poster;
  }
  // The send before this one stays, with its decisions; the one before that is let go.
  b.previous ??= {};
  const gone = b.previous[stage]?.published.version;
  if (old) b.previous[stage] = { published: old, decisions: b.decisions[stage] ?? {} };
  if (gone && gone !== old?.version) rmSync(path.join(boardDir(token), `${stage}-${gone}`), { recursive: true, force: true });
  const pub: Published = { at: new Date().toISOString(), items, version };
  b.published[stage] = pub;
  b.decisions[stage] = {};
  saveBoards(list);
  return pub;
}

export interface DecideResult { board: Board; stageDone: boolean; line: string }
export function decide(token: string, stage: BoardStage, item: string, d: { status: "approved" | "changes"; note?: string; author: string; marks?: unknown }): DecideResult {
  const list = loadBoards(), b = list.find((x) => x.token === token);
  if (!b || !findShare(token)) throw new Error("This board has expired or was turned off.");
  const pub = b.published[stage];
  const it = pub?.items.find((x) => x.id === item);
  if (!pub || !it) throw new Error("That is not on the board.");
  const note = d.note?.trim().slice(0, 1000);
  if (d.status === "changes" && !note) throw new Error("Say what should change.");
  const marks = d.status === "changes" ? cleanMarks(d.marks) : [];
  marks.forEach((m, k) => { const f = it.file ? markedFrame(it.file, m, path.join(boardDir(token), "marks", `${stage}-${pub.version ?? 1}-${item.replace(/[^A-Za-z0-9_-]/g, "_")}-${k + 1}.jpg`)) : undefined; if (f) m.frame = f; });
  (b.decisions[stage] ??= {})[item] = { status: d.status, ...(note ? { note } : {}), author: d.author, at: new Date().toISOString(), ...(marks.length ? { marks } : {}) };
  saveBoards(list);
  const title = pub.items.find((x) => x.id === item)!.title;
  const stageDone = pub.items.every((x) => b.decisions[stage]?.[x.id]);
  return { board: b, stageDone, line: `${d.author} ${d.status === "approved" ? "approved" : "asked for a change to"} ${title.toLowerCase().startsWith("beat") ? title : `the ${STAGE_NAMES[stage].toLowerCase()}`}${note ? `: “${note.slice(0, 140)}”` : ""}` };
}

/** Marks as the page sent them, kept only if they make sense: at most 6, each a time and a pin or up to 30 lines. */
export function cleanMarks(raw: unknown): Mark[] {
  if (!Array.isArray(raw)) return [];
  const f = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : undefined);
  const out: Mark[] = [];
  for (const r of raw.slice(0, 6) as { t?: unknown; x?: unknown; y?: unknown; strokes?: unknown }[]) {
    const t = typeof r?.t === "number" && Number.isFinite(r.t) && r.t >= 0 ? Math.round(r.t * 100) / 100 : undefined;
    if (t === undefined) continue;
    const x = f(r.x), y = f(r.y);
    const strokes = Array.isArray(r.strokes) ? (r.strokes as unknown[]).slice(0, 30).map((st) => (Array.isArray(st) ? st.slice(0, 400).map(f).filter((v): v is number => v !== undefined) : [])).map((st) => st.slice(0, st.length - (st.length % 2))).filter((st) => st.length >= 4) : [];
    if (x !== undefined && y !== undefined) out.push({ t, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });
    else if (strokes.length) out.push({ t, strokes: strokes.map((st) => st.map((v) => Math.round(v * 1000) / 1000)) });
  }
  return out;
}

/** Where a mark is, in words: "top-left", from its pin or the middle of what was drawn. */
export function markPlace(m: Mark): string {
  if (m.x !== undefined && m.y !== undefined) return where([m.x, m.y, 0, 0]);
  const xs = (m.strokes ?? []).flatMap((s) => s.filter((_, i) => i % 2 === 0)), ys = (m.strokes ?? []).flatMap((s) => s.filter((_, i) => i % 2 === 1));
  if (!xs.length) return "the whole frame";
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return where([x0, y0, x1 - x0, y1 - y0]);
}

/** The frame at the mark's time, with the pin or lines drawn on it in red, for Claude to look at. */
export function markedFrame(video: string, m: Mark, out: string): string | undefined {
  try {
    const ppm = execFileSync("ffmpeg", ["-v", "error", "-ss", m.t.toFixed(3), "-i", video, "-frames:v", "1", "-an", "-vf", "scale=720:-2", "-f", "image2pipe", "-c:v", "ppm", "-"], { maxBuffer: 64 << 20 });
    const img = Img.fromPpm(ppm);
    const r = Math.max(3, Math.round(img.w / 160)), red: [number, number, number] = [255, 59, 48];
    const dot = (x: number, y: number, rad: number) => { for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) if (dx * dx + dy * dy <= rad * rad) img.rect(Math.round(x * img.w) + dx, Math.round(y * img.h) + dy, 1, 1, red); };
    if (m.x !== undefined && m.y !== undefined) {
      // A ring around the pin, so what is under it stays visible.
      const R = r * 6;
      for (let a = 0; a < 360; a += 2) { const rad = (a * Math.PI) / 180; dot(m.x + (Math.cos(rad) * R) / img.w, m.y + (Math.sin(rad) * R) / img.h, r); }
    }
    for (const st of m.strokes ?? []) for (let i = 0; i + 3 < st.length; i += 2) {
      const [x0, y0, x1, y1] = [st[i]!, st[i + 1]!, st[i + 2]!, st[i + 3]!];
      const n = Math.max(1, Math.ceil(Math.hypot((x1 - x0) * img.w, (y1 - y0) * img.h) / r));
      for (let k = 0; k <= n; k++) dot(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, r);
    }
    mkdirSync(path.dirname(out), { recursive: true });
    return writeJpeg(img, out);
  } catch { return undefined; }
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
      ...changes.flatMap((x) => [`- ${x.title}: ${ds[x.id]!.note}`, ...(ds[x.id]!.marks ?? []).map((m) => `  marked at ${m.t.toFixed(1)} s${x.id === "master" ? " into the reel" : " into it"}: ${m.strokes ? "drew" : "pinned"} on the ${markPlace(m)} of the frame${m.frame ? ` (look at ${m.frame})` : ""}`)]),
      `Make exactly these changes (only these items${stage === "beats" ? "; re-render only those beats" : ""}), then stop and tell the owner it is ready to send to the board again. Do not move on until the client approves it.`].join("\n"),
  };
}

/** The board as the client's page reads it: no paths, no ids beyond the items'. */
export function publicBoard(b: Board): unknown {
  const pubDecision = (d: Decision) => ({ status: d.status, ...(d.note ? { note: d.note } : {}), author: d.author, at: d.at, ...(d.marks?.length ? { marks: d.marks.map(({ frame: _f, ...m }) => m) } : {}) });
  return {
    title: b.title, brand: publicBrand(),
    stages: b.stages.map((s) => {
      const pub = b.published[s], prev = b.previous?.[s];
      return {
        id: s, name: STAGE_NAMES[s],
        published: pub ? { at: pub.at, version: pub.version ?? 1, items: pub.items.map(({ file: f, poster: p, ...x }) => {
          // What the client asked to change last time, and the version they saw then.
          const was = prev?.decisions[x.id], old = prev?.published.items.find((o) => o.id === x.id);
          return { ...x, media: !!f, poster: !!p, ...(was?.status === "changes" && old ? { before: { media: !!old.file, poster: !!old.poster, ...(old.text ? { text: old.text } : {}), decision: pubDecision(was) } } : {}) };
        }) } : null,
        decisions: Object.fromEntries(Object.entries(b.decisions[s] ?? {}).map(([k, d]) => [k, pubDecision(d)])),
      };
    }),
  };
}

/** The file for a published item, if the board lists it (the only files a board link serves). */
export function boardFile(b: Board, stage: string, item: string, poster = false, before = false): string | undefined {
  const ok = (BOARD_STAGES as readonly string[]).includes(stage);
  const it = !ok ? undefined : before ? b.previous?.[stage as BoardStage]?.published.items.find((x) => x.id === item) : b.published[stage as BoardStage]?.items.find((x) => x.id === item);
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

// ---- the owner's brand on the board

export interface BoardBrand { name?: string; accent?: string; /** A copy of the logo, in the studio's home. */ logo?: string }
const brandFile = () => path.join(reelcutHome(), "create", "board-brand.json");
export function boardBrand(): BoardBrand { try { return JSON.parse(readFileSync(brandFile(), "utf8")) as BoardBrand; } catch { return {}; } }
/** Name and colour as given (a #rrggbb colour only); the logo is copied in, an image of at most 2 MB. */
export function saveBoardBrand(input: { name?: string; accent?: string; logo?: string | null }): BoardBrand {
  const cur = boardBrand();
  const out: BoardBrand = {};
  const name = (input.name ?? cur.name ?? "").trim().replace(/[<>]/g, "").slice(0, 60);
  if (name) out.name = name;
  const accent = (input.accent ?? cur.accent ?? "").trim();
  if (accent && !/^#[0-9a-f]{6}$/i.test(accent)) throw new Error("the colour is a hex value like #ff9230");
  if (accent) out.accent = accent.toLowerCase();
  if (input.logo === null) { if (cur.logo) rmSync(cur.logo, { force: true }); }
  else if (input.logo) {
    const ext = path.extname(input.logo).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".svg", ".webp"].includes(ext)) throw new Error("the logo is a PNG, JPEG, SVG or WebP");
    if (!existsSync(input.logo)) throw new Error("no such logo file");
    const buf = readFileSync(input.logo);
    if (buf.length > 2 << 20) throw new Error("the logo is over 2 MB");
    const to = path.join(reelcutHome(), "create", "brand", `logo${ext}`);
    mkdirSync(path.dirname(to), { recursive: true });
    if (cur.logo && cur.logo !== to) rmSync(cur.logo, { force: true });
    writeFileSync(to, buf);
    out.logo = to;
  } else if (cur.logo && existsSync(cur.logo)) out.logo = cur.logo;
  mkdirSync(path.dirname(brandFile()), { recursive: true });
  writeFileSync(brandFile(), JSON.stringify(out, null, 1));
  return out;
}
export function publicBrand(): { name?: string; accent?: string; logo: boolean } {
  const b = boardBrand();
  return { ...(b.name ? { name: b.name } : {}), ...(b.accent ? { accent: b.accent } : {}), logo: !!b.logo && existsSync(b.logo) };
}
