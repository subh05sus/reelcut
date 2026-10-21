import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bakePoster, joinClips, streamInfo } from "../render/assemble.js";
import { checkPath, formatPath } from "../taxonomy/paths.js";
import { beatText, readReel } from "./edits.js";
import { measureMaster, type HookFlag } from "./hook.js";

/**
 * Three hooks: the same reel with three other openings. Only beat 1 changes, at its exact length, so every other
 * clip is reused and a variant's master is the clips joined with beat 1 swapped (no second render), carrying the
 * real master's sound whole. The owner plays them side by side and uses one (swapped in, no render), or marks two to
 * post as an A/B test; the Performance page then records which variant each reading is for.
 *
 * Claude composes `compositions/<beat>-hook-a.html` (and b, c), renders them as clips, and `npm run hook -- variants`
 * finds the clips, joins and measures each. hooks.json beside reel.json keeps the set.
 */

export const VARIANT_IDS = ["a", "b", "c"] as const;
export interface HookVariant {
  /** a, b, c, or "original" for the hook the reel had. */
  id: string;
  line: string;
  angle?: string;
  technique?: string;
  /** Relative to the reel's folder. */
  composition: string;
  clip: string;
  master: string;
  poster?: string;
  strip?: string;
  score: number;
  flags: HookFlag[];
}
export interface HookSet { beat: string; beatSeconds: number; variants: HookVariant[]; chosen: string; ab?: [string, string]; at: string }

export const hooksFile = (reelPath: string) => path.join(path.dirname(reelPath), "hooks.json");
export function readHooks(reelPath: string): HookSet | undefined {
  try { return JSON.parse(readFileSync(hooksFile(reelPath), "utf8")) as HookSet; } catch { return undefined; }
}
function writeHooks(reelPath: string, s: HookSet): void { writeFileSync(hooksFile(reelPath), `${JSON.stringify(s, null, 1)}\n`); }

/** The instruction Claude gets from "Make 3 hooks". */
export function hooksPrompt(reelPath: string): { shown: string; prompt: string } {
  const reel = readReel(reelPath), b = reel.beats[0];
  if (!b) throw new Error("the reel has no beats");
  const now = beatText(reelPath, b).join(" ");
  return {
    shown: "Make 3 other hooks",
    prompt: [
      `Make three other hooks for the reel at ${reelPath}. Only beat 1 (${b.id}, ${b.composition ?? "?"}${now ? `, now “${now}”` : ""}) changes; everything after it stays.`,
      `1. Write three opening lines with different angles, each true to the script: a number, a question, a bold claim, a curiosity gap or a before/after. Ten words or fewer, readable before 3 s.`,
      `2. Compose each as compositions/${b.id}-hook-a.html, -hook-b.html, -hook-c.html (composition ids ${b.id}-hook-a …), exactly ${(b.durationSeconds ?? 0).toFixed(3)} s like the beat, in the reel's personality. Words on screen by 0.5 s, something moving in the first half second, nothing in Instagram's interface zones (top 12%, bottom 20%, the right edge below the middle). Put data-angle="<the angle>" and, if you used one, data-technique="<technique path>" on each root.`,
      `3. Render them as clips only, from a scratch manifest hooks-${b.id}.json beside reel.json (the same format and fps, the three as its beats): \`npm run render -- ${path.join(path.dirname(reelPath), `hooks-${b.id}.json`)} --clips-only --no-record\`.`,
      `4. Join and measure them: \`npm run hook -- variants ${reelPath}\`. Look at each strip it prints.`,
      `5. Reply with the three lines and a one-line read on each. Do not swap any in: the owner picks one, or two for an A/B test, in the studio.`,
    ].join("\n"),
  };
}

const rel = (dir: string, f: string) => path.relative(dir, f);
const attr = (html: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(html)?.[1];

/** Joins a master for each hook clip Claude rendered, measures it, and records the set (the original kept as one). */
export async function buildVariants(reelPath: string): Promise<HookSet> {
  const dir = path.dirname(reelPath), reel = readReel(reelPath), b = reel.beats[0];
  if (!b) throw new Error("the reel has no beats");
  const clipsDir = path.join(dir, "clips"), hdir = path.join(dir, "hooks");
  mkdirSync(hdir, { recursive: true });
  const master = path.join(dir, "master.mp4");
  if (!existsSync(master)) throw new Error("the reel has no master yet: hooks are made on a finished reel");
  const clip = (id: string) => path.join(clipsDir, `${id}.mp4`);
  const prev = readHooks(reelPath);
  const prevBeat = prev?.beat === b.id ? prev : undefined;
  // The opening the reel has now is kept as a variant too, so it can come back.
  const current = prevBeat?.chosen ?? "original";
  const variants: HookVariant[] = prevBeat?.variants.filter((v) => v.id === "original") ?? [];
  if (!variants.length) {
    const keep = path.join(clipsDir, `${b.id}-hook-original.mp4`), km = path.join(hdir, "master-original.mp4");
    copyFileSync(clip(b.id), keep); copyFileSync(master, km);
    const poster = path.join(dir, "poster.jpg"), kp = path.join(hdir, "poster-original.jpg");
    if (existsSync(poster)) copyFileSync(poster, kp);
    const m = await measureMaster(reelPath, km, path.join(hdir, "original"), beatText(reelPath, b).join(" "), { scanTo: b.durationSeconds });
    variants.push({ id: "original", line: m.hookLine, composition: b.composition ?? "", clip: rel(dir, keep), master: rel(dir, km), ...(existsSync(kp) ? { poster: rel(dir, kp) } : {}), ...(m.strip ? { strip: m.strip } : {}), score: m.score, flags: m.flags });
  }
  const frames = streamInfo(clip(b.id)).frames;
  const fps = frames / (b.durationSeconds || 1);
  const rest = reel.beats.slice(1).map((x) => ({ file: clip(x.id), frames: streamInfo(clip(x.id)).frames, fps }));
  const found = VARIANT_IDS.filter((v) => existsSync(clip(`${b.id}-hook-${v}`)));
  if (!found.length) throw new Error(`no hook clips yet: render compositions/${b.id}-hook-a.html (and b, c) as clips first`);
  const hasSound = streamInfo(master).hasAudio;
  for (const v of found) {
    const vc = clip(`${b.id}-hook-${v}`), got = streamInfo(vc).frames;
    if (Math.abs(got - frames) > 0) throw new Error(`${path.basename(vc)} has ${got} frames and beat 1 has ${frames}: compose it at exactly ${(b.durationSeconds ?? 0).toFixed(3)} s and render it again`);
    const out = path.join(hdir, `master-${v}.mp4`), work = path.join(hdir, `.join-${v}`);
    const joined = joinClips([{ file: vc, frames, fps }, ...rest], out, work);
    rmSync(work, { recursive: true, force: true });
    if (!joined.ok) throw new Error(`hook ${v}: ${joined.detail}`);
    // The real master's sound, whole: the scratch render's clip has no slice of the reel's mix.
    if (hasSound) {
      const tmp = out.replace(/\.mp4$/, ".sound.mp4");
      execFileSync("ffmpeg", ["-v", "error", "-y", "-i", out, "-i", master, "-map", "0:v", "-map", "1:a", "-c", "copy", "-shortest", tmp]);
      rmSync(out, { force: true }); copyFileSync(tmp, out); rmSync(tmp, { force: true });
    }
    const poster = path.join(hdir, `poster-${v}.jpg`);
    bakePoster(out, Math.min(1.2, (b.durationSeconds ?? 2) * 0.6), poster);
    const compRel = path.join(path.dirname(b.composition ?? "compositions/x.html"), `${b.id}-hook-${v}.html`);
    const html = existsSync(path.join(dir, compRel)) ? readFileSync(path.join(dir, compRel), "utf8") : "";
    const line = html ? beatText(reelPath, { id: `${b.id}-hook-${v}`, composition: compRel }).join(" ") : "";
    // Only beat 1 differs, so only the hook is read for the interface; the rest is the reel's own check.
    const m = await measureMaster(reelPath, out, path.join(hdir, v), line, { scanTo: b.durationSeconds });
    const tech = attr(html, "data-technique"), checked = tech ? checkPath(tech) : undefined;
    const angle = attr(html, "data-angle");
    const entry: HookVariant = { id: v, line: m.hookLine, ...(angle ? { angle } : {}), ...(checked?.ok && checked.path ? { technique: formatPath(checked.path) } : {}), composition: compRel, clip: rel(dir, vc), master: rel(dir, out), poster: rel(dir, poster), ...(m.strip ? { strip: m.strip } : {}), score: m.score, flags: m.flags };
    const i = variants.findIndex((x) => x.id === v);
    if (i >= 0) variants[i] = entry; else variants.push(entry);
  }
  const set: HookSet = { beat: b.id, beatSeconds: b.durationSeconds ?? 0, variants: [...prevBeat?.variants.filter((x) => x.id !== "original" && !found.includes(x.id as never)) ?? [], ...variants].sort((x, y) => order(x.id) - order(y.id)), chosen: current, ...(prevBeat?.ab ? { ab: prevBeat.ab } : {}), at: new Date().toISOString() };
  writeHooks(reelPath, set);
  return set;
}
const order = (id: string) => (id === "original" ? -1 : VARIANT_IDS.indexOf(id as never));

/** Puts a variant in as the reel's hook: its composition in reel.json, its clip, its master and poster. No render. */
export function useVariant(reelPath: string, id: string): HookSet {
  const set = readHooks(reelPath);
  const v = set?.variants.find((x) => x.id === id);
  if (!set || !v) throw new Error("no such hook");
  const dir = path.dirname(reelPath);
  const raw = JSON.parse(readFileSync(reelPath, "utf8")) as { beats: { id: string; composition?: string; technique?: string; techniqueWhy?: string }[] };
  const b = raw.beats.find((x) => x.id === set.beat);
  if (!b) throw new Error("the reel's first beat changed since these hooks were made");
  for (const f of [v.clip, v.master]) if (!existsSync(path.join(dir, f))) throw new Error(`${f} is missing: make the hooks again`);
  b.composition = v.composition;
  if (v.technique) { b.technique = v.technique; b.techniqueWhy = `the hook chosen from three${v.angle ? `: ${v.angle}` : ""}`; }
  writeFileSync(reelPath, `${JSON.stringify(raw, null, 2)}\n`);
  copyFileSync(path.join(dir, v.clip), path.join(dir, "clips", `${set.beat}.mp4`));
  copyFileSync(path.join(dir, v.master), path.join(dir, "master.mp4"));
  if (v.poster && existsSync(path.join(dir, v.poster))) copyFileSync(path.join(dir, v.poster), path.join(dir, "poster.jpg"));
  set.chosen = id;
  writeHooks(reelPath, set);
  return set;
}

/** Two variants to post against each other; null clears it. */
export function setAB(reelPath: string, ids: [string, string] | null): HookSet {
  const set = readHooks(reelPath);
  if (!set) throw new Error("make the hooks first");
  if (ids) {
    if (ids[0] === ids[1] || !ids.every((x) => set.variants.some((v) => v.id === x))) throw new Error("pick two different hooks");
    set.ab = ids;
  } else delete set.ab;
  writeHooks(reelPath, set);
  return set;
}

/** For an A/B: each variant's latest reading per platform, and which held more viewers at 3 s (else watched longer). */
export function abResult(set: HookSet, entries: readonly { platform: string; variant?: string; capturedAt: string; retention3s?: number; avgWatchSeconds?: number; views?: number }[]): { by: Record<string, { retention3s?: number; avgWatchSeconds?: number; views?: number }>; winner?: string; line: string } | undefined {
  if (!set.ab) return undefined;
  const by: Record<string, { retention3s?: number; avgWatchSeconds?: number; views?: number }> = {};
  for (const id of set.ab) {
    const mine = entries.filter((e) => e.variant === id).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)).at(-1);
    if (mine) by[id] = { ...(mine.retention3s != null ? { retention3s: mine.retention3s } : {}), ...(mine.avgWatchSeconds != null ? { avgWatchSeconds: mine.avgWatchSeconds } : {}), ...(mine.views != null ? { views: mine.views } : {}) };
  }
  const [x, y] = set.ab, nm = (id: string) => (id === "original" ? "the original" : `hook ${id.toUpperCase()}`);
  const a = by[x], c = by[y];
  if (!a || !c) return { by, line: `A/B: ${nm(x)} against ${nm(y)}. Add each one's numbers on the Post tab once they have been up a day.` };
  const key = a.retention3s != null && c.retention3s != null ? "retention3s" : a.avgWatchSeconds != null && c.avgWatchSeconds != null ? "avgWatchSeconds" : undefined;
  if (!key) return { by, line: `A/B: both have numbers, but not the same kind: add 3-second retention or average watch time for both.` };
  const va = a[key]!, vc = c[key]!;
  if (Math.abs(va - vc) < (key === "retention3s" ? 0.02 : 0.3)) return { by, line: `A/B: too close to call (${fmtM(key, va)} against ${fmtM(key, vc)}).` };
  const winner = va > vc ? x : y;
  return { by, winner, line: `A/B: ${nm(winner)} held more viewers: ${fmtM(key, Math.max(va, vc))} against ${fmtM(key, Math.min(va, vc))}${key === "retention3s" ? " still watching at 3 s" : " watched on average"}.` };
}
const fmtM = (k: string, v: number) => (k === "retention3s" ? `${Math.round(v * 100)}%` : `${v.toFixed(1)} s`);

/** The hook files in a reel folder, for clean-up and listing. */
export function hookClips(reelPath: string): string[] {
  const d = path.join(path.dirname(reelPath), "clips");
  return existsSync(d) ? readdirSync(d).filter((f) => /-hook-[a-z]+\.mp4$/.test(f)) : [];
}
