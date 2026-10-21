import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readingFloorSeconds, MIN_ENTRANCE_SECONDS } from "../core/readingFloor.js";
import { streamInfo } from "../render/assemble.js";
import { grabFrame, writeJpeg, Img, fit, pool } from "../watch/image.js";
import { readText, textReaderAvailable, type TextLine } from "../watch/ocr.js";
import { beatText, readReel } from "./edits.js";

/**
 * The hook check: does the first 3 seconds give someone scrolling a reason to stay?
 *
 * Instagram reports a reel's skip rate (who scrolled past within 3 s), so the first 3 seconds are the ones to protect.
 * The machine part is measured here, from the master itself: when the first words are on screen (read with macOS
 * Vision), when something first moves, whether frame 0 already shows something, and whether beat 1's words can be
 * read before the 3-second mark (the reading floor). It also reads the text on the whole master and lists every
 * line that sits under Instagram's own interface. Claude then looks at the strip and adds the judgement a number
 * cannot make (is it clear, is there a reason to keep watching) as the verdict, with a rewrite when it is weak.
 *
 * Everything lands in hook.json beside reel.json, with hook/strip.jpg; the studio shows it on the master.
 */

export const HOOK_SECONDS = 3;
export const HOOK_AT = [0, 0.25, 0.5, 1, 1.5, 2, 2.5, 3] as const;

/** Where Instagram's Reels interface covers a 9:16 frame, as [x, y, w, h] fractions (Meta's percentages, rounded). */
export interface SafeZone { id: "top" | "bottom" | "rail"; name: string; box: [number, number, number, number] }
export const INSTAGRAM_ZONES: readonly SafeZone[] = [
  { id: "top", name: "the Reels header", box: [0, 0, 1, 0.12] },
  { id: "bottom", name: "the caption, name and audio line", box: [0, 0.8, 1, 0.2] },
  { id: "rail", name: "the like, comment and share buttons", box: [0.84, 0.55, 0.16, 0.45] },
];
/** The profile grid shows a 9:16 reel cropped to 3:4, from the middle. */
export const GRID_CROP: [number, number, number, number] = [0, 0.125, 1, 0.75];

/** The share of a text box that a zone covers; a line counts as under the interface from a third of it. */
export function covered(box: readonly [number, number, number, number], zone: readonly [number, number, number, number]): number {
  const [x, y, w, h] = box, [zx, zy, zw, zh] = zone;
  const ix = Math.max(0, Math.min(x + w, zx + zw) - Math.max(x, zx)), iy = Math.max(0, Math.min(y + h, zy + zh) - Math.max(y, zy));
  return w * h > 0 ? (ix * iy) / (w * h) : 0;
}
export const UNDER_UI = 0.34;

export interface SafeHit { zone: SafeZone["id"]; name: string; text: string; from: number; to: number }

/**
 * Text big enough to be the reel's own words, not the small print inside a screen or a mockup: 44 px at 1080 wide
 * (Vision reads a menu bar or a phone's clock at about half that). As a fraction of the frame's height.
 */
export const displayHeight = (aspect: number) => (44 / 1080) * aspect;
export const isDisplay = (l: TextLine, minH: number) => !!l.box && l.box[3] >= minH && l.text.trim().length >= 2 && (l.conf ?? 1) >= 0.3;

/**
 * Lines read on frames (time → lines) to the spans where display text sits under the interface: one span per zone
 * while it lasts (the reader's spelling wobbles from frame to frame), named by the line seen most.
 */
export function safeHits(frames: readonly { t: number; lines: readonly TextLine[] }[], step: number, keep: (l: TextLine) => boolean = (l) => isDisplay(l, 0), zones: readonly SafeZone[] = INSTAGRAM_ZONES): SafeHit[] {
  const out: (SafeHit & { seen: Map<string, number> })[] = [];
  for (const f of [...frames].sort((a, b) => a.t - b.t)) {
    for (const z of zones) {
      const under = f.lines.filter((l) => keep(l) && !!l.box && covered(l.box, z.box) >= UNDER_UI).map((l) => l.text.trim());
      if (!under.length) continue;
      let open = out.find((h) => h.zone === z.id && f.t - h.to <= step + 1e-6);
      if (!open) { open = { zone: z.id, name: z.name, text: "", from: f.t, to: f.t, seen: new Map() }; out.push(open); }
      open.to = f.t;
      for (const t of under) open.seen.set(t, (open.seen.get(t) ?? 0) + 1);
    }
  }
  return out.map(({ seen, ...h }) => ({ ...h, text: [...seen.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]![0] })).sort((a, b) => a.from - b.from);
}

const tokens = (s: string) => s.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]{2,}/gu) ?? [];
/** Every word the reel's compositions put on screen: what the reader sees is checked against it, so noise and the text inside a screen recording are left out. */
export function ownWords(reelPath: string): Set<string> {
  const set = new Set<string>();
  for (const b of readReel(reelPath).beats) for (const l of beatText(reelPath, b)) for (const t of tokens(l)) set.add(t);
  return set;
}
/** A read line is the reel's own when most of its words are (the reader confuses I and l, so one miss in a few is fine). */
export function isOwn(text: string, own: ReadonlySet<string>): boolean {
  if (!own.size) return true;
  const ts = tokens(text);
  const near = (t: string) => t.length >= 5 && [...own].some((o) => Math.abs(o.length - t.length) <= 1 && oneEdit(o, t));
  return ts.length > 0 && ts.filter((t) => own.has(t) || own.has(t.replace(/l/g, "i")) || near(t)).length / ts.length >= 0.5;
}
/** The reader's "Al" for "AI": a word that is not the reel's, but is with its l read as I, is spelled the reel's way. */
export function respell(line: string, own: ReadonlySet<string>): string {
  return line.replace(/[\p{L}\p{N}]{2,}/gu, (w) => (!own.has(w.toLowerCase()) && own.has(w.toLowerCase().replace(/l/g, "i")) ? w.replace(/l/g, "I") : w));
}
/** At most one letter added, dropped or changed: the reader's usual slip. */
function oneEdit(a: string, b: string): boolean {
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
/** Distinct lines in order, without the partial ones (a line typed on, read halfway). */
export function distinctLines(lines: readonly string[]): string[] {
  const norm = (x: string) => tokens(x).join(" ");
  const first = new Map<string, string>();
  for (const l of lines) if (!first.has(norm(l))) first.set(norm(l), l.trim());
  const uniq = [...first.entries()].filter(([k]) => k);
  return uniq.filter(([k]) => !uniq.some(([o]) => o !== k && o.includes(k))).map(([, v]) => v);
}

export interface HookFlag { id: string; line: string; weight: number }
export interface HookInput {
  /** The words on screen in the hook (read off the frames), else beat 1's words as composed. */
  line: string;
  beatSeconds: number;
  /** The reel says its words aloud and shows few or none (text mode none or minimal). */
  quietText: boolean;
  blankStart: boolean;
  firstText?: number;
  firstMove?: number;
  safe: readonly SafeHit[];
}

/** The machine's score for a hook, out of 100, and what took points off. Pure: the measuring is done before. */
export function judgeHook(h: HookInput): { score: number; flags: HookFlag[] } {
  const flags: HookFlag[] = [];
  const words = h.line.trim().split(/\s+/).filter(Boolean).length;
  if (h.blankStart) flags.push({ id: "blank-start", weight: 25, line: "Frame 0 shows nothing yet: someone scrolling has nothing to stop for." });
  if (!h.quietText && words > 0) {
    if (h.firstText === undefined) flags.push({ id: "no-text", weight: 20, line: "No words are readable on screen in the first 3 seconds." });
    else if (h.firstText > 1) flags.push({ id: "late-text", weight: 15, line: `The first words appear at ${h.firstText.toFixed(1)} s; under a second keeps the scroller.` });
    const read = readingFloorSeconds(h.line);
    const lands = (h.firstText ?? MIN_ENTRANCE_SECONDS) + read;
    if (lands > HOOK_SECONDS + 0.05) flags.push({ id: "too-long", weight: lands > HOOK_SECONDS + 0.5 ? 20 : 10, line: `The hook's ${words} words need ${read.toFixed(1)} s to read, so the hook lands at ${lands.toFixed(1)} s, after the 3-second mark. Cut it to ${Math.max(3, Math.floor((HOOK_SECONDS - MIN_ENTRANCE_SECONDS) / 0.3))} words or fewer.` });
    else if (words > 12) flags.push({ id: "wordy", weight: 10, line: `The hook has ${words} words; ten or fewer read at a glance.` });
  }
  if (h.firstMove === undefined) flags.push({ id: "still", weight: 15, line: "Nothing moves in the first 3 seconds." });
  else if (h.firstMove > 0.5) flags.push({ id: "slow-move", weight: 10, line: `The first movement comes at ${h.firstMove.toFixed(1)} s; motion inside half a second holds the eye.` });
  if (h.beatSeconds > 5) flags.push({ id: "long-first-beat", weight: 5, line: `The first cut comes at ${h.beatSeconds.toFixed(1)} s; a hook usually turns before 4 s.` });
  const early = h.safe.filter((s) => s.from <= HOOK_SECONDS);
  for (const z of new Set(early.map((s) => s.zone))) {
    const s = early.find((x) => x.zone === z)!;
    flags.push({ id: `under-${z}`, weight: 15, line: `“${s.text.slice(0, 40)}” sits under ${s.name} in the hook.` });
  }
  return { score: Math.max(0, 100 - flags.reduce((a, f) => a + f.weight, 0)), flags };
}

export interface HookVerdict { score: number; clear: boolean; gap: boolean; line: string; rewrite?: string; why?: string; at: string }
export interface HookReport {
  at: string;
  /** The master's modified time when measured: a newer master makes this stale. */
  masterAt: number;
  format: string;
  hookLine: string;
  beatSeconds: number;
  firstText?: number;
  firstMove?: number;
  blankStart: boolean;
  score: number;
  flags: HookFlag[];
  /** Lines under Instagram's interface anywhere in the master (9:16 only). */
  safe: SafeHit[];
  /** Relative to the reel's folder. */
  strip?: string;
  verdict?: HookVerdict;
}

export const hookFile = (reelPath: string) => path.join(path.dirname(reelPath), "hook.json");
export function readHook(reelPath: string): HookReport | undefined {
  try { return JSON.parse(readFileSync(hookFile(reelPath), "utf8")) as HookReport; } catch { return undefined; }
}
function writeHook(reelPath: string, r: HookReport): void { writeFileSync(hookFile(reelPath), `${JSON.stringify(r, null, 1)}\n`); }

const luma = (img: Img) => { const g = new Float32Array(img.w * img.h); for (let i = 0; i < g.length; i++) g[i] = 0.2126 * img.data[i * 3]! + 0.7152 * img.data[i * 3 + 1]! + 0.0722 * img.data[i * 3 + 2]!; return g; };
const spread = (g: Float32Array) => { let m = 0; for (const v of g) m += v; m /= g.length; let s = 0; for (const v of g) s += (v - m) ** 2; return Math.sqrt(s / g.length); };
const diff = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i]! - b[i]!); return s / a.length / 255; };

/** Measures the master's hook and scans it for lines under the interface; keeps an earlier verdict only if the master is unchanged. */
export async function measureHook(reelPath: string, opts: { quietText?: boolean } = {}): Promise<HookReport> {
  const dir = path.dirname(reelPath), master = path.join(dir, "master.mp4");
  if (!existsSync(master)) throw new Error("the reel has no master yet");
  const reel = readReel(reelPath), first = reel.beats[0];
  if (!first) throw new Error("the reel has no beats");
  const m = await measureMaster(reelPath, master, path.join(dir, "hook"), beatText(reelPath, first).join(" "), opts);
  const prev = readHook(reelPath);
  const report: HookReport = { ...m, ...(prev?.verdict && prev.masterAt === m.masterAt ? { verdict: prev.verdict } : {}) };
  writeHook(reelPath, report);
  return report;
}

/** The measuring itself, on any master of this reel (the real one, or a hook variant's), into `out`. */
export async function measureMaster(reelPath: string, master: string, out: string, hookLine: string, opts: { quietText?: boolean; scanTo?: number } = {}): Promise<HookReport> {
  const dir = path.dirname(reelPath);
  const raw = JSON.parse(readFileSync(reelPath, "utf8")) as { format?: string; direction?: { text?: string } };
  const first = readReel(reelPath).beats[0]!;
  const format = raw.format ?? "1:1";
  const duration = streamInfo(master).durationSeconds;
  const size = sizeOf(master);
  mkdirSync(out, { recursive: true });

  // The hook's frames: small grey ones for motion and emptiness, readable ones for the text and the strip.
  const times = HOOK_AT.filter((t) => t < duration);
  const [sw, sh] = fit(size.w, size.h, 96), [rw, rh] = fit(size.w, size.h, 720);
  const small = await pool(times, 6, (t) => grabFrame(master, t, duration, sw, sh).then(luma));
  const big = await pool(times, 4, (t) => grabFrame(master, t, duration, rw, rh));
  const files = big.map((img, i) => writeJpeg(img, path.join(out, `t${String(Math.round(times[i]! * 100)).padStart(3, "0")}.jpg`)));
  // Motion is timed from 0.25 s: frame 0 is the thumbnail baked in from later, so it always differs from the next.
  let firstMove: number | undefined;
  for (let i = 2; i < small.length; i++) if (diff(small[i - 1]!, small[i]!) > 0.006) { firstMove = times[i - 1]; break; }
  const blankStart = spread(small[0]!) < 4;

  // The whole master every half second, for the interface; the hook's own frames for the first words.
  // Frame 0 is the baked thumbnail (a frame from later in the hook), so the first words are timed from the next one.
  // The reel's words, and this master's own hook (a variant's words are not in reel.json yet).
  const reader = textReaderAvailable(), minH = displayHeight(size.w / size.h), own = ownWords(reelPath);
  for (const t of tokens(hookLine)) own.add(t);
  const keep = (l: TextLine) => isDisplay(l, minH) && isOwn(l.text, own);
  let firstText: number | undefined, safe: SafeHit[] = [], seen: string[] = [];
  if (reader) {
    const read = readText(files);
    const shown = times.map((t, i) => ({ t, lines: (read.get(files[i]!) ?? []).filter(keep) }));
    firstText = shown.find((x) => x.t > 0 && x.lines.length > 0)?.t;
    seen = distinctLines(shown.filter((x) => x.t > 0).flatMap((x) => x.lines.map((l) => l.text)));
    if (format === "9:16") {
      const scan = Array.from({ length: Math.max(1, Math.floor(Math.min(duration, opts.scanTo ?? duration) / 0.5)) }, (_, i) => i * 0.5);
      const scanFiles = await pool(scan, 4, async (t) => writeJpeg(await grabFrame(master, t, duration, rw, rh), path.join(out, `s${String(Math.round(t * 10)).padStart(4, "0")}.jpg`)));
      const lines = readText(scanFiles);
      safe = safeHits(scan.map((t, i) => ({ t, lines: lines.get(scanFiles[i]!) ?? [] })), 0.5, keep);
    }
  }
  // What the viewer has to read in the hook: the display lines seen, in order, when the reader saw any.
  if (seen.length) hookLine = seen.map((l) => respell(l, own)).join(" ");
  const quietText = opts.quietText ?? ["none", "minimal"].includes(String(raw.direction?.text ?? ""));
  const judged = judgeHook({ line: hookLine, beatSeconds: first.durationSeconds ?? 0, quietText, blankStart, firstText, firstMove, safe });

  // One strip of the hook, timestamped, for Claude and the studio.
  const strip = path.join(out, "strip.jpg");
  stripOf(big, times, strip);
  return {
    at: new Date().toISOString(), masterAt: mtime(master), format, hookLine, beatSeconds: first.durationSeconds ?? 0,
    ...(firstText !== undefined ? { firstText } : {}), ...(firstMove !== undefined ? { firstMove } : {}), blankStart,
    score: judged.score, flags: judged.flags, safe, strip: path.relative(dir, strip),
  };
}

function mtime(f: string): number { try { return Math.round(statSync(f).mtimeMs); } catch { return 0; } }
function sizeOf(file: string): { w: number; h: number } {
  const [w, h] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { encoding: "utf8" }).trim().split(",").map(Number);
  return { w: w || 1080, h: h || 1080 };
}
function stripOf(frames: readonly Img[], times: readonly number[], file: string): void {
  if (!frames.length) return;
  const gap = 6, w = frames[0]!.w, h = frames[0]!.h, cw = Math.round(w / 2) & ~1, ch = Math.round(h / 2) & ~1;
  const grid = new Img(frames.length * cw + (frames.length - 1) * gap, ch);
  frames.forEach((f, i) => { const s = half(f, cw, ch); s.label(`${times[i]!.toFixed(2)}`, Math.max(2, Math.floor(Math.min(cw, ch) / 120))); grid.paste(s, i * (cw + gap), 0); });
  writeJpeg(grid, file);
}
function half(img: Img, w: number, h: number): Img {
  const o = new Img(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(img.w - 1, Math.floor((x * img.w) / w)), sy = Math.min(img.h - 1, Math.floor((y * img.h) / h));
    img.data.copy(o.data, (y * w + x) * 3, (sy * img.w + sx) * 3, (sy * img.w + sx) * 3 + 3);
  }
  return o;
}

/** Claude's verdict on the hook it looked at. */
export function saveVerdict(reelPath: string, v: { score: number; clear: boolean; gap: boolean; line: string; rewrite?: string; why?: string }): HookReport {
  const r = readHook(reelPath);
  if (!r) throw new Error("measure the hook first: npm run hook -- check <reel.json>");
  const score = Math.max(1, Math.min(10, Math.round(Number(v.score))));
  if (!Number.isFinite(score)) throw new Error("--score is 1 to 10");
  r.verdict = { score, clear: !!v.clear, gap: !!v.gap, line: v.line.trim().slice(0, 300), ...(v.rewrite?.trim() ? { rewrite: v.rewrite.trim().slice(0, 200) } : {}), ...(v.why?.trim() ? { why: v.why.trim().slice(0, 300) } : {}), at: new Date().toISOString() };
  writeHook(reelPath, r);
  return r;
}

/** Whether the saved check is for the master as it is now. */
export function hookFresh(reelPath: string, r: HookReport | undefined = readHook(reelPath)): boolean {
  return !!r && r.masterAt === mtime(path.join(path.dirname(reelPath), "master.mp4"));
}

/** The check in words, for the render's output and the chat: what Claude should look at and do next. */
export function hookSummary(reelPath: string, r: HookReport): string {
  const lines = [`hook … ${r.score}/100 by measure${r.firstText !== undefined ? ` · words at ${r.firstText.toFixed(2)} s` : ""}${r.firstMove !== undefined ? ` · moving at ${r.firstMove.toFixed(2)} s` : ""}`];
  for (const f of r.flags) lines.push(`  - ${f.line}`);
  const later = r.safe.filter((s) => s.from > HOOK_SECONDS);
  if (later.length) lines.push(`  under Instagram's interface later: ${later.map((s) => `“${s.text.slice(0, 30)}” ${s.from.toFixed(1)}–${s.to.toFixed(1)} s (${s.name})`).join("; ")}`);
  if (r.strip) lines.push(`  look at ${path.join(path.dirname(reelPath), r.strip)}, then: npm run hook -- verdict ${reelPath} --score <1-10> --clear yes|no --gap yes|no --line "<one line>" [--rewrite "<a stronger opening line>" --why "<why>"]`);
  return lines.join("\n");
}

/** The instruction Claude gets from the studio's "Fix the hook". */
export function fixHookPrompt(reelPath: string, r: HookReport): { shown: string; prompt: string } {
  const reel = readReel(reelPath), b = reel.beats[0]!;
  const rewrite = r.verdict?.rewrite;
  return {
    shown: rewrite ? `Fix the hook: “${rewrite}”` : "Fix the hook",
    prompt: [
      `Fix the hook of the reel at ${reelPath}: beat 1 (${b.id}, ${b.composition ?? "?"}), the first 3 seconds.`,
      ...(rewrite ? [`Use this opening line: "${rewrite}"${r.verdict?.why ? ` (${r.verdict.why})` : ""}.`] : []),
      ...(r.flags.length ? ["The check found:", ...r.flags.map((f) => `- ${f.line}`)] : []),
      `Keep beat 1's length (${(b.durationSeconds ?? 0).toFixed(2)} s) so nothing after it moves. Words on screen by 0.5 s, something moving in the first half second, the line readable before 3 s, nothing under Instagram's interface (top 12%, bottom 20%, the right edge below the middle).`,
      `Re-render only this beat and rejoin the master: \`npm run render -- ${reelPath} --only ${b.id} --clips-only\` then \`npm run render -- ${reelPath} --master-only\` (add --sfx if the reel has sound). The check runs again on the new master; save a new verdict and reply in two lines.`,
    ].join("\n"),
  };
}
