import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beatText, readReel } from "./edits.js";

/**
 * The performance loop: how each posted reel did, and what that says about the next one.
 *
 * Numbers come from the platforms' own analytics: a screenshot or a CSV export that Claude reads in the reel's
 * conversation (no platform logins), or typed in by hand. Each reel keeps them in performance.json beside reel.json.
 * Set against what each reel was (length, format, style, recipe, voice, music, the hook), they show what holds
 * attention; Claude turns that into proposed learnings the owner approves.
 */

export const PLATFORM_NAMES = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", linkedin: "LinkedIn", other: "Other" } as const;
export type PerfPlatform = keyof typeof PLATFORM_NAMES;
export interface PerfEntry {
  platform: PerfPlatform;
  /** When the numbers were read off the platform. */
  capturedAt: string;
  views?: number; reach?: number; likes?: number; comments?: number; shares?: number; saves?: number; follows?: number;
  /** Average watch time, seconds. */
  avgWatchSeconds?: number;
  /** Share of viewers still watching at 3 s, 0..1. */
  retention3s?: number;
  /** Share who watched to the end, 0..1. */
  completionRate?: number;
  source: "screenshot" | "csv" | "typed";
  note?: string;
}
export const METRICS = ["views", "reach", "likes", "comments", "shares", "saves", "follows", "avgWatchSeconds", "retention3s", "completionRate"] as const;

const file = (reelPath: string) => path.join(path.dirname(reelPath), "performance.json");
export function readPerformance(reelPath: string): PerfEntry[] {
  try { return (JSON.parse(readFileSync(file(reelPath), "utf8")) as { entries: PerfEntry[] }).entries ?? []; } catch { return []; }
}
/** Adds a reading, cleaned: numbers only where a number was given, rates as fractions. */
export function addPerformance(reelPath: string, input: Omit<Partial<PerfEntry>, "platform"> & { platform: string }): PerfEntry {
  const platform = (Object.keys(PLATFORM_NAMES) as PerfPlatform[]).includes(input.platform as PerfPlatform) ? (input.platform as PerfPlatform) : "other";
  const e: PerfEntry = { platform, capturedAt: input.capturedAt && !Number.isNaN(Date.parse(input.capturedAt)) ? new Date(input.capturedAt).toISOString() : new Date().toISOString(), source: input.source === "screenshot" || input.source === "csv" ? input.source : "typed" };
  for (const k of METRICS) {
    const raw = input[k];
    if (raw === undefined || raw === null || (raw as unknown) === "") continue;
    let n = Number(raw);
    if (!Number.isFinite(n) || n < 0) continue;
    if ((k === "retention3s" || k === "completionRate") && n > 1) n = n / 100;
    e[k] = k === "retention3s" || k === "completionRate" ? Math.min(1, n) : k === "avgWatchSeconds" ? Math.round(n * 10) / 10 : Math.round(n);
  }
  if (input.note) e.note = String(input.note).slice(0, 300);
  const entries = [...readPerformance(reelPath), e];
  writeFileSync(file(reelPath), `${JSON.stringify({ entries }, null, 1)}\n`);
  return e;
}
/** The latest reading per platform. */
export function latest(entries: readonly PerfEntry[]): PerfEntry[] {
  const by = new Map<string, PerfEntry>();
  for (const e of [...entries].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))) by.set(e.platform, e);
  return [...by.values()];
}

/** What a reel was, in the terms its results are compared by. */
export interface ReelFacts { seconds: number; beats: number; format: string; style?: string; recipe?: string; voiced: boolean; music: boolean; sfx: boolean; text?: string; hook: string; lengthBand: string }
export function reelFacts(reelPath: string, settings: { recipe?: string; text?: string } = {}): ReelFacts {
  const raw = JSON.parse(readFileSync(reelPath, "utf8")) as { format?: string; voiceover?: unknown; music?: unknown; sfx?: unknown; direction?: { text?: string } };
  const reel = readReel(reelPath);
  const seconds = Math.round(reel.beats.reduce((a, b) => a + (b.durationSeconds ?? 0), 0));
  const styles = new Map<string, number>();
  for (const b of reel.beats) if (b.style) styles.set(b.style, (styles.get(b.style) ?? 0) + (b.durationSeconds ?? 0));
  const style = [...styles.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const first = reel.beats[0];
  return {
    seconds, beats: reel.beats.length, format: raw.format ?? "?", ...(style ? { style } : {}), ...(settings.recipe ? { recipe: settings.recipe } : {}),
    voiced: !!raw.voiceover, music: !!raw.music, sfx: !!raw.sfx || reel.beats.some((b) => ((b as { sfx?: unknown[] }).sfx ?? []).length > 0),
    ...(raw.direction?.text || settings.text ? { text: raw.direction?.text ?? settings.text } : {}),
    hook: first ? beatText(reelPath, first).join(" ").slice(0, 120) : "",
    lengthBand: seconds <= 20 ? "up to 20 s" : seconds <= 40 ? "21–40 s" : seconds <= 70 ? "41–70 s" : "over 70 s",
  };
}

export interface PerfRow { conversation: string; title: string; reel: string; facts: ReelFacts; latest: PerfEntry[] }
/** How well a reel held attention on one reading: the share of it watched on average, else 3-second retention. */
export function holdOf(e: PerfEntry, seconds: number): number | undefined {
  if (e.avgWatchSeconds != null && seconds > 0) return Math.min(1, e.avgWatchSeconds / seconds);
  return e.completionRate ?? e.retention3s;
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

export interface Insight { by: string; value: string; reels: number; hold: number; views: number; versus: { hold: number; views: number; reels: number } }
/**
 * Per attribute value, the median share watched and the median views against every other reel; only where both sides
 * have at least two reels. Strongest differences first.
 */
export function insights(rows: readonly PerfRow[]): Insight[] {
  const scored = rows.map((r) => {
    const holds = r.latest.map((e) => holdOf(e, r.facts.seconds)).filter((x): x is number => x != null);
    const views = r.latest.map((e) => e.views).filter((x): x is number => x != null);
    return { r, hold: holds.length ? Math.max(...holds) : undefined, views: views.length ? views.reduce((a, b) => a + b, 0) : undefined };
  }).filter((x) => x.hold != null || x.views != null);
  const dims: [string, (f: ReelFacts) => string | undefined][] = [
    ["length", (f) => f.lengthBand], ["format", (f) => f.format], ["style", (f) => f.style], ["recipe", (f) => f.recipe],
    ["voiceover", (f) => (f.voiced ? "with a voiceover" : "without a voiceover")], ["music", (f) => (f.music ? "with music" : "without music")], ["text", (f) => f.text],
  ];
  const out: Insight[] = [];
  for (const [by, key] of dims) {
    const values = new Set(scored.map((x) => key(x.r.facts)).filter((v): v is string => !!v));
    for (const value of values) {
      const ins = scored.filter((x) => key(x.r.facts) === value), outs = scored.filter((x) => key(x.r.facts) !== value);
      if (ins.length < 2 || outs.length < 2) continue;
      const med = (xs: (number | undefined)[]) => { const v = xs.filter((n): n is number => n != null); return v.length ? median(v) : 0; };
      const h = (xs: typeof scored) => med(xs.map((x) => x.hold)), v = (xs: typeof scored) => med(xs.map((x) => x.views));
      out.push({ by, value, reels: ins.length, hold: h(ins), views: v(ins), versus: { hold: h(outs), views: v(outs), reels: outs.length } });
    }
  }
  return out.sort((a, b) => Math.abs(b.hold - b.versus.hold) - Math.abs(a.hold - a.versus.hold));
}

/** Claude reads a screenshot or a CSV of the platform's analytics into performance.json. */
export function importPrompt(reelPath: string, files: readonly { name: string; path: string }[], platform: string): string {
  const reelSecs = readReel(reelPath).beats.reduce((a, b) => a + (b.durationSeconds ?? 0), 0);
  return [
    `Read the ${platform === "any" ? "platform" : platform} analytics in ${files.map((f) => f.path).join(", ")} (look at an image with Read; read a CSV as text) for the reel at ${reelPath} (${Math.round(reelSecs)} s long).`,
    `Record what they show with \`npm run performance -- add ${reelPath} --platform <instagram|tiktok|youtube|linkedin|other> --source <screenshot|csv> [--views N] [--reach N] [--likes N] [--comments N] [--shares N] [--saves N] [--follows N] [--avg-watch SECONDS] [--retention3s PERCENT] [--completion PERCENT] [--captured YYYY-MM-DD]\`, one call per platform shown.`,
    "Only numbers the file actually shows: leave a flag out rather than estimate it, and read \"1.2K\" as 1200. If the file is not analytics for this reel, say so and record nothing.",
    "Then reply in two or three lines: the numbers in words, and how this reel compares with the others (`npm run performance -- summary`).",
  ].join("\n");
}

/** Claude looks across every reel with results and proposes what to change, for the owner to approve. */
export function analysisPrompt(rows: readonly PerfRow[], found: readonly Insight[]): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return [
    "Look at how my posted reels performed and tell me what is working. Then propose what to change.",
    "",
    "The reels (facts and the latest numbers per platform):",
    "```json",
    JSON.stringify(rows.map((r) => ({ title: r.title, reel: r.reel, ...r.facts, results: r.latest })), null, 1),
    "```",
    ...(found.length ? ["", "Differences the studio found (median share watched, median views):", ...found.slice(0, 8).map((i) => `- ${i.by} ${i.value}: ${pct(i.hold)} watched, ${Math.round(i.views)} views (${i.reels} reels) vs ${pct(i.versus.hold)}, ${Math.round(i.versus.views)} (${i.versus.reels} others)`)] : []),
    "",
    "- Read `npm run learnings -- brief` and `npm run personality -- brief` first, so you know what is already a rule.",
    "- Be honest about how little a handful of reels can prove: say how sure you are, and never claim a cause the numbers cannot show.",
    "- Then ask me with AskUserQuestion (multiSelect) which of up to four concrete changes to adopt, each a rule a reel can follow (\"Hooks under 2 s\", \"Keep reels under 40 s\").",
    "- Record each one I pick with `npm run learnings -- add \"<rule>\"`, and say which you recorded. Change nothing else.",
    "- Start your first reply with `Title: What's working`.",
  ].join("\n");
}

export function hasPerformance(reelPath: string | undefined): boolean { return !!reelPath && existsSync(file(reelPath)); }
