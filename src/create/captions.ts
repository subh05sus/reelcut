import { spawnSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import { getPersonality } from "../personality/store.js";
import { STYLES } from "../personality/styles.js";
import { loadKit } from "../render/kit.js";
import { injectKit } from "../render/project.js";
import { renderHyperframesProject } from "../render/hyperframes.js";
import { beatText, readReel, type ReelBeat } from "./edits.js";

/**
 * Captions for a finished reel: word-timed, in the personality's type and colours.
 *
 * The words come from the voiceover when there is one (voice.json: every word where the voice says it), otherwise from
 * what each beat shows (spread over the beat, as an accessible transcript of the text on screen). They are grouped into
 * short lines, written as .srt, .vtt and .json, and, for a voiced reel, can be burned in: a HyperFrames composition plays
 * the master under the kit's caption layer (karaoke, key words or plain), and the master's sound is carried over.
 */

export type CaptionStyle = "karaoke" | "key-words" | "full";
export interface CWord { w: string; start: number; end: number; beat: string; key?: boolean }
export interface Chunk { start: number; end: number; words: CWord[] }

const STOP = new Set(("a an and are as at be but by for from has have i if in into is it its of on or our so that the their them then there these they this to was we were what when which who will with you your " +
  "aber als am an auch auf aus bei bin bis bist da das dass dem den der des die dir doch du ein eine einem einen einer es für hat hier ich ihr im in ist ja kann man mein mit nach nicht noch nur oder schon sein sich sie sind so über um und uns von vor war was weil wenn wie wir wird zu zum zur").split(" "));

/** A word worth lighting up: a number, a long content word, or a name in the middle of a sentence. */
export function isKeyWord(w: string, prev?: string): boolean {
  const bare = w.replace(/[^\p{L}\p{N}%€$]/gu, "");
  if (!bare) return false;
  if (/\d/.test(bare)) return true;
  if (STOP.has(bare.toLowerCase())) return false;
  if (bare.length >= 7) return true;
  return /^\p{Lu}/u.test(bare) && !!prev && !/[.!?:]$/.test(prev);
}

/** The reel's words with their times in the master. */
export function captionWords(reelPath: string): { words: CWord[]; source: "voice" | "screen" } {
  const dir = path.dirname(reelPath);
  const voice = path.join(dir, "voice.json");
  if (existsSync(voice)) {
    const v = JSON.parse(readFileSync(voice, "utf8")) as { words: { w: string; start: number; end: number; beat: string }[]; spans?: { start: number }[] };
    // The master starts where the first beat does in the recording.
    const off = v.spans?.[0]?.start ?? 0;
    const words = v.words.filter((x) => x.w.trim()).map((x) => ({ w: x.w, start: Math.max(0, x.start - off), end: Math.max(x.end - off, x.start - off + 0.08), beat: x.beat }));
    if (words.length) return { words: mark(words), source: "voice" };
  }
  const reel = readReel(reelPath);
  const words: CWord[] = [];
  let t = 0;
  for (const b of reel.beats) {
    const d = b.durationSeconds ?? 0;
    const text = ((b as ReelBeat & { text?: string }).text?.trim() || beatText(reelPath, b).join(" ")).split(/\s+/).filter(Boolean);
    // Spread the words over the beat in proportion to their length, leaving a breath at each end.
    const pad = Math.min(0.25, d * 0.08), span = Math.max(0.1, d - 2 * pad);
    const weight = text.map((w) => w.length + 2), total = weight.reduce((a, x) => a + x, 0) || 1;
    let at = t + pad;
    text.forEach((w, i) => { const len = (span * weight[i]!) / total; words.push({ w, start: at, end: at + len, beat: b.id }); at += len; });
    t += d;
  }
  return { words: mark(words), source: "screen" };
}
function mark(words: CWord[]): CWord[] { return words.map((w, i) => ({ ...w, key: isKeyWord(w.w, words[i - 1]?.w) })); }

/** Short lines: a new one at a sentence end, a pause, a new beat, or when the line would pass `maxChars`. */
export function chunkWords(words: readonly CWord[], maxChars = 32): Chunk[] {
  const out: Chunk[] = [];
  let cur: CWord[] = [];
  const flush = () => { if (cur.length) out.push({ start: cur[0]!.start, end: cur.at(-1)!.end, words: cur }); cur = []; };
  for (const w of words) {
    const prev = cur.at(-1);
    const len = cur.reduce((a, x) => a + x.w.length + 1, 0) + w.w.length;
    if (prev && (prev.beat !== w.beat || w.start - prev.end > 0.45 || len > maxChars || /[.!?]$/.test(prev.w))) flush();
    cur.push(w);
  }
  flush();
  // Each line stays up a little after its last word, but never over the next one.
  out.forEach((c, i) => { const next = out[i + 1]; c.end = Math.min(c.end + 0.35, next ? next.start : c.end + 0.35); });
  return out;
}

const stamp = (t: number, sep: "," | ".") => {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${sep}${String(ms % 1000).padStart(3, "0")}`;
};
const lineText = (c: Chunk) => c.words.map((w) => w.w).join(" ");
export function toSrt(chunks: readonly Chunk[]): string {
  return chunks.map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${lineText(c)}\n`).join("\n");
}
export function toVtt(chunks: readonly Chunk[]): string {
  return `WEBVTT\n\n${chunks.map((c) => `${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${lineText(c)}\n`).join("\n")}`;
}

export interface CaptionFiles { srt: string; vtt: string; json: string; source: "voice" | "screen"; lines: number }
/** Writes captions.srt, captions.vtt and captions.json beside reel.json. */
export function writeCaptions(reelPath: string): CaptionFiles {
  const dir = path.dirname(reelPath);
  const { words, source } = captionWords(reelPath);
  const chunks = chunkWords(words);
  const f = { srt: path.join(dir, "captions.srt"), vtt: path.join(dir, "captions.vtt"), json: path.join(dir, "captions.json") };
  writeFileSync(f.srt, toSrt(chunks));
  writeFileSync(f.vtt, toVtt(chunks));
  writeFileSync(f.json, `${JSON.stringify({ source, chunks }, null, 1)}\n`);
  return { ...f, source, lines: chunks.length };
}

// ---- burning in

const SIZES: Record<string, [number, number]> = { "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350], "16:9": [1920, 1080] };
const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The reel's caption look: the lead style's colours and type from its personality, or the reel's own ground. */
export function captionLook(reelPath: string): { ground: string; ink: string; accent: string; type?: string; look: string } {
  const reel = JSON.parse(readFileSync(reelPath, "utf8")) as { personality?: string; ground?: string; type?: string; direction?: { look?: string } };
  const p = reel.personality ? getPersonality(reel.personality) : undefined;
  const lead = p?.styles[0]?.id;
  const st = lead ? STYLES.find((s) => s.id === lead) : undefined;
  const pal = (lead && p?.palettes[lead]) || st?.palettes[0];
  return {
    ground: pal?.ground ?? reel.ground ?? "#111111", ink: pal?.ink ?? "#ffffff", accent: pal?.accent ?? "#ff9230",
    type: reel.type ?? (lead ? p?.fonts[lead] : undefined), look: reel.direction?.look ?? "paper",
  };
}

/** The caption composition: the master as a video, the caption lines over it, one timeline. */
export function captionComposition(o: { chunks: readonly Chunk[]; style: CaptionStyle; format: string; duration: number; look: ReturnType<typeof captionLook> }): string {
  const [W, H] = SIZES[o.format] ?? SIZES["1:1"]!;
  const tall = H / W > 1.5;
  const size = Math.round(W * (tall ? 0.05 : W > H ? 0.032 : 0.045));
  const bottom = Math.round(H * (tall ? 0.24 : 0.08));
  const lines = o.chunks.map((c, i) => `<div class="cl" id="cl${i}">${c.words.map((w, j) => `<span class="w${o.style === "key-words" && w.key ? " k" : ""}" id="w${i}-${j}">${escHtml(w.w)}</span>`).join(" ")}</div>`).join("\n    ");
  const data = JSON.stringify(o.chunks.map((c) => ({ s: +c.start.toFixed(3), e: +c.end.toFixed(3), w: c.words.map((w) => +w.start.toFixed(3)) })));
  const d = o.duration.toFixed(3);
  return `<template id="captions-template">
<div id="root" data-composition-id="captions" data-start="0" data-duration="${d}" data-width="${W}" data-height="${H}" data-look="${o.look.look}"${o.look.type ? ` data-type="${o.look.type}"` : ""}>
  <style>
    #root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: #000; --ground: ${o.look.ground}; --ink: ${o.look.ink}; --accent: ${o.look.accent}; }
    #root > video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .caps { position: absolute; left: ${Math.round(W * 0.08)}px; right: ${Math.round(W * 0.08)}px; bottom: ${bottom}px; display: grid; justify-items: center; }
    .cl { grid-area: 1 / 1; max-width: 100%; text-align: center; font-family: var(--font-sans); font-weight: 700; font-size: ${size}px; line-height: 1.22;
      color: var(--ink); background: color-mix(in srgb, var(--ground) 92%, transparent); padding: ${Math.round(size * 0.22)}px ${Math.round(size * 0.45)}px;
      border-radius: ${Math.round(size * 0.5)}px; box-decoration-break: clone; -webkit-box-decoration-break: clone; opacity: 0; letter-spacing: -0.01em; }
    .cl .w { display: inline-block; }
    .cl .k { color: var(--accent); font-family: var(--font-serif); font-style: italic; }
    ${o.style === "karaoke" ? ".cl .w { opacity: .42; }" : ""}
  </style>
  <video src="assets/master.mp4" data-start="0" data-duration="${d}" muted playsinline preload="auto"></video>
  <div class="caps">
    ${lines}
  </div>
  <script>
    (function () {
      var C = ${data};
      var tl = gsap.timeline({ paused: true });
      var ease = (window.RC && RC.spring) ? RC.spring("default").ease : "power2.out";
      C.forEach(function (c, i) {
        var el = document.getElementById("cl" + i);
        tl.fromTo(el, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.22, ease: ease }, Math.max(0, c.s - 0.06));
        ${o.style === "karaoke" ? `c.w.forEach(function (t, j) { tl.to(document.getElementById("w" + i + "-" + j), { opacity: 1, duration: 0.08, ease: "none" }, t); });` : ""}
        tl.to(el, { opacity: 0, duration: 0.14, ease: "power1.in" }, Math.max(c.s + 0.1, c.e - 0.14));
      });
      tl.set({}, {}, ${d});
      window.__timelines = window.__timelines || {};
      window.__timelines["captions"] = tl;
    })();
  </script>
</div>
</template>
`;
}

/** Renders master.captioned.mp4: the master with its captions burned in, and its own sound. */
export async function burnCaptions(reelPath: string, style: CaptionStyle, log: (s: string) => void = () => {}): Promise<string> {
  const dir = path.dirname(reelPath);
  const master = path.join(dir, "master.mp4");
  if (!existsSync(master)) throw new Error("the reel has no master.mp4 yet");
  const reel = JSON.parse(readFileSync(reelPath, "utf8")) as { format?: string; fps?: number };
  const { words, source } = captionWords(reelPath);
  if (source !== "voice") throw new Error("this reel has no voiceover: its words are already on screen, so captions are written as files only");
  const chunks = chunkWords(words);
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", master], { encoding: "utf8" });
  const duration = Number(probe.stdout.trim()) || chunks.at(-1)!.end;
  const format = reel.format ?? "1:1";
  const [W, H] = SIZES[format] ?? SIZES["1:1"]!;
  const project = path.join(dir, "captions-project");
  rmSync(project, { recursive: true, force: true });
  mkdirSync(path.join(project, "compositions"), { recursive: true });
  mkdirSync(path.join(project, "assets"), { recursive: true });
  try { linkSync(master, path.join(project, "assets", "master.mp4")); } catch { copyFileSync(master, path.join(project, "assets", "master.mp4")); }
  const comp = injectKit(captionComposition({ chunks, style, format, duration, look: captionLook(reelPath) }), loadKit("inline"));
  writeFileSync(path.join(project, "compositions", "captions.html"), comp);
  writeFileSync(path.join(project, "hyperframes.json"), `${JSON.stringify({ $schema: "https://hyperframes.heygen.com/schema/hyperframes.json", paths: { blocks: "compositions", components: "compositions/components", assets: "assets" }, media: { autoProxy: true } }, null, 2)}\n`);
  const fps = reel.fps ?? 60;
  writeFileSync(path.join(project, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=${W}, height=${H}" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>* { margin: 0; padding: 0; box-sizing: border-box; } html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #000; } #host { width: 100%; height: 100%; position: relative; }</style></head>
<body><div id="host" data-composition-id="captions-host" data-start="0" data-duration="${duration.toFixed(3)}" data-width="${W}" data-height="${H}" data-fps="${fps}">
<div id="captions" class="clip" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="${duration.toFixed(3)}" data-track-index="0" data-width="${W}" data-height="${H}"></div></div>
<script>window.__timelines = window.__timelines || {}; window.__timelines["captions-host"] = gsap.timeline({ paused: true });</script></body></html>
`);
  log(`rendering ${chunks.length} caption lines over the master (${duration.toFixed(1)} s)`);
  const silent = path.join(project, "out.mp4");
  const r = await renderHyperframesProject({ projectDir: project, outputPath: silent, skipCheck: true, fps, timeoutMs: 60 * 60_000 });
  if (r.status !== "rendered") throw new Error(r.error ?? "render failed");
  const out = path.join(dir, "master.captioned.mp4");
  const mux = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", silent, "-i", master, "-map", "0:v:0", "-map", "1:a:0?", "-c:v", "copy", "-c:a", "copy", "-shortest", "-movflags", "+faststart", out], { encoding: "utf8" });
  if (mux.status !== 0) throw new Error(`could not add the sound: ${mux.stderr.slice(-300)}`);
  rmSync(project, { recursive: true, force: true });
  return out;
}
