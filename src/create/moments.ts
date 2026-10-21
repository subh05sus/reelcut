import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Transcript, Word } from "../watch/video.js";

/**
 * A long video (a podcast, a webinar, a talk) into short reels: each strong moment becomes its own reel, with the
 * real audio of that moment as its voiceover and what is said in it as its script. The words come from the local
 * whisper transcript the watch tools already make; a moment is trimmed to word edges, so it never starts or ends
 * mid-word. Only the sound is used: the reel's visuals are composed, never the speaker's picture.
 */

/** The words spoken between two times: those whose middle falls inside, so a word grazing an edge stays out. */
export function wordsBetween(tr: Transcript, from: number, to: number): Word[] {
  const all = tr.segments.flatMap((s) => s.words.length ? s.words : [{ w: s.text, a: s.a, b: s.b, p: s.conf }]);
  return all.filter((w) => (w.a + w.b) / 2 >= from && (w.a + w.b) / 2 <= to);
}

/** A script from spoken words: one sentence per line, the spacing whisper leaves cleaned up. */
export function scriptOf(words: readonly Word[]): string {
  const text = words.map((w) => w.w).join(" ").replace(/\s+/g, " ").replace(/\s+([,.!?;:])/g, "$1").trim();
  return text.split(/(?<=[.!?])\s+/).map((l) => l.trim()).filter(Boolean).join("\n");
}

export interface Cut { from: number; to: number; seconds: number; script: string; words: number }
/** Where to cut: from just before the first word to just after the last, never into a neighbouring word. */
export function cutPoints(tr: Transcript, from: number, to: number): Cut {
  const ws = wordsBetween(tr, from, to);
  if (!ws.length) throw new Error(`nothing is said between ${from.toFixed(1)} s and ${to.toFixed(1)} s`);
  const all = tr.segments.flatMap((s) => s.words);
  const first = ws[0]!, last = ws[ws.length - 1]!;
  const before = all.filter((w) => w.b <= first.a).at(-1), after = all.find((w) => w.a >= last.b);
  const a = Math.max(0, before ? Math.max(before.b, first.a - 0.15) : first.a - 0.15);
  const b = after ? Math.min(after.a, last.b + 0.25) : last.b + 0.25;
  return { from: Math.round(a * 1000) / 1000, to: Math.round(b * 1000) / 1000, seconds: Math.round((b - a) * 100) / 100, script: scriptOf(ws), words: ws.length };
}

/** Writes <name>.m4a (the moment's audio), <name>.txt (its script) and <name>.json (where it came from). */
export function writeMoment(video: string, cut: Cut, outDir: string, name: string): { audio: string; script: string; meta: string } {
  mkdirSync(outDir, { recursive: true });
  const audio = path.join(outDir, `${name}.m4a`), script = path.join(outDir, `${name}.txt`), meta = path.join(outDir, `${name}.json`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", cut.from.toFixed(3), "-to", cut.to.toFixed(3), "-i", video, "-vn", "-ac", "2", "-ar", "48000", "-af", "afade=t=in:d=0.04,areverse,afade=t=in:d=0.08,areverse", "-c:a", "aac", "-b:a", "192k", audio]);
  writeFileSync(script, `${cut.script}\n`);
  writeFileSync(meta, `${JSON.stringify({ source: path.resolve(video), from: cut.from, to: cut.to, seconds: cut.seconds, words: cut.words }, null, 1)}\n`);
  return { audio, script, meta };
}
