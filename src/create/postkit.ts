import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadKit } from "../render/kit.js";
import { injectKit } from "../render/project.js";
import { launchMeasureBrowser } from "../verify/measure.js";
import { captionLook } from "./captions.js";
import { readReel } from "./edits.js";

/**
 * The post kit: what a finished reel needs to be posted. Covers come from the reel's own frames with the title set in
 * the personality's type; the words (titles, captions, hashtags, the first comment, per platform) are written by Claude
 * in the conversation, into post-kit.json beside reel.json, so they are in the owner's voice and can be revised there.
 */

export const PLATFORMS = ["instagram", "tiktok", "youtube", "linkedin"] as const;
export type Platform = (typeof PLATFORMS)[number];
export interface PostKit {
  titles: string[];
  coverText?: string;
  instagram?: { caption: string; hashtags: string[]; firstComment?: string };
  tiktok?: { caption: string; hashtags: string[] };
  youtube?: { title: string; description: string; tags: string[] };
  linkedin?: { post: string };
}
/** Each platform's limits, for the counters on the page. */
export const LIMITS = { instagram: { caption: 2200, hashtags: 30 }, tiktok: { caption: 4000 }, youtube: { title: 100, description: 5000 }, linkedin: { post: 3000 } } as const;

const postDir = (reelPath: string) => path.join(path.dirname(reelPath), "post");
const SIZES: Record<string, [number, number]> = { "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350], "16:9": [1920, 1080] };

/** One candidate frame per beat (up to twelve, spread over the reel), taken where the beat has settled. */
export function coverFrames(reelPath: string): { beat: string; index: number; t: number; file: string }[] {
  const dir = path.join(postDir(reelPath), "frames");
  const master = path.join(path.dirname(reelPath), "master.mp4");
  if (!existsSync(master)) return [];
  mkdirSync(dir, { recursive: true });
  const beats = readReel(reelPath).beats;
  const step = Math.max(1, Math.ceil(beats.length / 12));
  const masterAt = statSync(master).mtimeMs;
  let start = 0;
  const out: { beat: string; index: number; t: number; file: string }[] = [];
  beats.forEach((b, i) => {
    const d = b.durationSeconds ?? 0;
    const t = +(start + d * 0.72).toFixed(2);
    start += d;
    if (i % step !== 0) return;
    const file = path.join(dir, `${b.id}.jpg`);
    if (!existsSync(file) || statSync(file).mtimeMs < masterAt) spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(t), "-i", master, "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", file]);
    if (existsSync(file)) out.push({ beat: b.id, index: i, t, file });
  });
  return out;
}

export interface Covers { reel?: string; square?: string; wide?: string; t?: number; title?: string }
export function readCovers(reelPath: string): Covers {
  const dir = postDir(reelPath);
  const at = (f: string) => (existsSync(path.join(dir, f)) ? path.join(dir, f) : undefined);
  let meta: { t?: number; title?: string } = {};
  try { meta = JSON.parse(readFileSync(path.join(dir, "cover.json"), "utf8")); } catch { /* none yet */ }
  return { reel: at("cover.jpg"), square: at("cover-square.jpg"), wide: at("cover-wide.jpg"), ...meta };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The cover page: the frame, a soft scrim, the title in the personality's display type with its key word accented. */
export function coverHtml(o: { frame: string; title: string; W: number; H: number; fit: "cover" | "contain"; look: ReturnType<typeof captionLook> }): string {
  const words = o.title.trim().split(/\s+/);
  // The longest word carries the accent, as a reel's emphasis would.
  const key = words.reduce((k, w, i) => (w.replace(/\W/g, "").length > words[k]!.replace(/\W/g, "").length ? i : k), 0);
  const size = Math.round(Math.min(o.W, o.H) * (o.title.length > 28 ? 0.085 : 0.11));
  const body = `<div id="root" data-look="${o.look.look}"${o.look.type ? ` data-type="${o.look.type}"` : ""}>
  <style>
    html, body { margin: 0; } #root { position: relative; width: ${o.W}px; height: ${o.H}px; overflow: hidden; background: ${o.look.ground}; --ink: ${o.look.ink}; --accent: ${o.look.accent}; --ground: ${o.look.ground}; }
    .bg { position: absolute; inset: -40px; background: url("${o.frame}") center / cover; filter: blur(30px) brightness(.7); }
    .fr { position: absolute; inset: 0; background: url("${o.frame}") center / ${o.fit} no-repeat; }
    .scrim { position: absolute; inset: 0; background: linear-gradient(transparent 45%, color-mix(in srgb, var(--ground) 92%, transparent) 82%); }
    #root h1.t { position: absolute; top: auto; left: 7%; right: 7%; bottom: ${o.H > o.W ? "14%" : "9%"}; margin: 0; padding: 0; color: var(--ink); font-size: ${size}px; line-height: 1.02; text-wrap: balance; transform: none; }
    #root h1.t em.rc { color: var(--accent); }
  </style>
  ${o.fit === "contain" ? `<div class="bg"></div>` : ""}<div class="fr"></div><div class="scrim"></div>
  <h1 class="t rc-head">${words.map((w, i) => (i === key ? `<em class="rc">${esc(w)}</em>` : esc(w))).join(" ")}</h1>
</div>`;
  return injectKit(`<template>${body}</template>`, loadKit("inline")).replace(/^<template>/, "").replace(/<\/template>$/, "");
}

/** Renders the covers at the reel's own size, square (for the grid) and wide (YouTube). */
export async function makeCover(reelPath: string, t: number, title: string): Promise<Covers> {
  const dir = postDir(reelPath);
  mkdirSync(dir, { recursive: true });
  const master = path.join(path.dirname(reelPath), "master.mp4");
  const still = path.join(dir, "cover-frame.png");
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(t), "-i", master, "-frames:v", "1", still]);
  if (r.status !== 0 || !existsSync(still)) throw new Error("could not take that frame from the master");
  const frame = `data:image/png;base64,${readFileSync(still).toString("base64")}`;
  const reel = JSON.parse(readFileSync(reelPath, "utf8")) as { format?: string };
  const [W, H] = SIZES[reel.format ?? "1:1"] ?? SIZES["1:1"]!;
  const look = captionLook(reelPath);
  const browser = await launchMeasureBrowser();
  try {
    const shots: [string, number, number, "cover" | "contain"][] = [["cover.jpg", W, H, "cover"], ["cover-square.jpg", 1080, 1080, "cover"], ["cover-wide.jpg", 1280, 720, "contain"]];
    for (const [name, w, h, fit] of shots) {
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: h });
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body>${coverHtml({ frame, title, W: w, H: h, fit, look })}</body></html>`, { waitUntil: "load" });
      await page.evaluate("document.fonts.ready");
      await page.screenshot({ path: path.join(dir, name) as `${string}.jpeg`, type: "jpeg", quality: 90 });
      await page.close();
    }
  } finally { await browser.close(); }
  writeFileSync(path.join(dir, "cover.json"), JSON.stringify({ t, title }));
  return readCovers(reelPath);
}

export function readPostKit(reelPath: string): PostKit | null {
  try { return JSON.parse(readFileSync(path.join(path.dirname(reelPath), "post-kit.json"), "utf8")) as PostKit; } catch { return null; }
}

/** What Claude is asked, in the conversation that made the reel. */
export function postKitPrompt(reelPath: string, platforms: readonly Platform[] = PLATFORMS, note = ""): string {
  const out = path.join(path.dirname(reelPath), "post-kit.json");
  return [
    `Write the post kit for the reel at ${reelPath}: the words that go with it when it is posted.`,
    "Read the script, report.md and the personality's copy and voice (`npm run personality -- brief`) first, and write in that voice.",
    `Write ${out} as JSON, exactly this shape (only the platforms listed):`,
    "```json",
    JSON.stringify({
      titles: ["three title options, the strongest first, each under 60 characters"],
      coverText: "the words for the cover, 2 to 6 of them",
      ...(platforms.includes("instagram") ? { instagram: { caption: "hook line, then 2–4 short lines, then a call to action", hashtags: ["3 to 8, specific, no #"], firstComment: "a comment to pin: a question that invites replies, or the link" } } : {}),
      ...(platforms.includes("tiktok") ? { tiktok: { caption: "one or two lines, under 150 characters", hashtags: ["3 to 5, no #"] } } : {}),
      ...(platforms.includes("youtube") ? { youtube: { title: "under 70 characters, searchable", description: "2–3 sentences, then links", tags: ["5 to 10 search terms"] } } : {}),
      ...(platforms.includes("linkedin") ? { linkedin: { post: "a short post: a first line that stops the scroll, 3–6 short paragraphs, a question at the end; no hashtag wall" } } : {}),
    }, null, 2),
    "```",
    "Never invent facts, figures or links the script does not have; leave a link out rather than guess it.",
    ...(note.trim() ? [`The owner adds: ${note.trim()}`] : []),
    "Reply in one or two lines; the studio shows the kit from the file.",
  ].join("\n");
}
