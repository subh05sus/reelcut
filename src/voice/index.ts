import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { decode, envelope, SR } from "../audio/mixer.js";

const run = promisify(exec);

/**
 * The voiceover, as timing.
 *
 * The real read sets the cut. The audio is transcribed (whisper.cpp through `hyperframes transcribe`, local,
 * German included), the transcript is matched to each beat's script text, word edges are moved to where the voice
 * actually starts and stops, and each cut lands in the pause just before its line: up to 0.18 s before the first
 * word, less when the pause is short. Compositions then get their own words and the voice's loudness, so an entrance
 * can land on the word that names it (`RC.word`) and a shape can move with the speaker (`RC.voice`).
 *
 * Every step is deterministic given the audio and the script; the transcript is cached by the audio's hash.
 */

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
}

export interface VoiceWord {
  w: string;
  start: number;
  end: number;
  /** The beat whose text the word belongs to. */
  beat: string;
  /** Whether a transcript word matched it (otherwise its time is interpolated between neighbours). */
  heard: boolean;
}

export interface VoiceAnalysis {
  file: string;
  sha: string;
  durationSeconds: number;
  /** Frames per second of `rms`. */
  fps: number;
  /** The voice's loudness, 0..1. */
  rms: number[];
  words: VoiceWord[];
  /** Share of script words the transcript confirmed. Low means the read differs from the script. */
  matched: number;
}

export interface VoiceBeat {
  id: string;
  /** The words spoken in this beat, as written in the script. */
  text: string;
}

// ---------------------------------------------------------------- matching words

const ONES_DE = ["null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf", "dreizehn", "vierzehn", "fünfzehn", "sechzehn", "siebzehn", "achtzehn", "neunzehn"];
const TENS_DE = ["", "", "zwanzig", "dreißig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig", "neunzig"];

/** A number as German words, as a speaker says it: 21 → einundzwanzig, 130 → hundertdreißig. */
export function germanNumber(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 9999) return String(n);
  if (n < 20) return ONES_DE[n]!;
  if (n < 100) { const o = n % 10, t = TENS_DE[Math.floor(n / 10)]!; return o ? `${o === 1 ? "ein" : ONES_DE[o]}und${t}` : t; }
  if (n < 1000) { const h = Math.floor(n / 100), r = n % 100; return `${h === 1 ? "" : h === 1 ? "ein" : ONES_DE[h]}hundert${r ? germanNumber(r) : ""}`; }
  const th = Math.floor(n / 1000), r = n % 1000;
  return `${th === 1 ? "" : ONES_DE[th]}tausend${r ? germanNumber(r) : ""}`;
}

/** The tokens a word is compared by: lower case, no punctuation, numbers spelled out, % as "prozent". */
export function tokens(word: string): string[] {
  const out: string[] = [];
  for (const part of word.toLowerCase().normalize("NFC").replace(/ß/g, "ss").split(/[\s\-–—/]+/)) {
    const pct = part.includes("%");
    const m = /(\d+)(?:[.,](\d+))?/.exec(part);
    if (m) {
      out.push(germanNumber(Number(m[1])).replace(/ß/g, "ss"));
      if (m[2]) out.push("komma", ...m[2].split("").map((d) => germanNumber(Number(d))));
    } else {
      const t = part.replace(/[^\p{L}\p{N}]+/gu, "");
      if (t) out.push(t);
    }
    if (pct) out.push("prozent");
  }
  return out;
}

/** 0..1: how alike two tokens are (Levenshtein ratio). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[b.length]! / Math.max(a.length, b.length);
}

/**
 * Give every script word a time. Script and transcript are reduced to tokens and aligned globally (Needleman–Wunsch:
 * a token pair that is at least 70% alike is a match), so a misheard "Cloude" still lands on "Claude" and a skipped
 * word does not shift everything after it. A script word nobody heard gets a time between its heard neighbours.
 */
export function matchWords(beats: readonly VoiceBeat[], heard: readonly TranscriptWord[]): { words: VoiceWord[]; matched: number } {
  const script: { w: string; beat: string }[] = beats.flatMap((b) => b.text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).map((w) => ({ w, beat: b.id })));
  const st = script.flatMap((s, i) => tokens(s.w).map((t) => ({ t, i })));
  const ht = heard.flatMap((h, i) => tokens(h.text).map((t) => ({ t, i })));
  const n = st.length, m = ht.length;
  const GAP = -1;
  const score = new Float64Array((n + 1) * (m + 1));
  // 0 diagonal, 1 skip script, 2 skip heard, 3 one script token = two heard ("ChatGPT" / "Chat GPT"), 4 two script = one heard
  const back = new Uint8Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = 1; i <= n; i++) { score[at(i, 0)] = i * GAP; back[at(i, 0)] = 1; }
  for (let j = 1; j <= m; j++) { score[at(0, j)] = j * GAP; back[at(0, j)] = 2; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sim = similarity(st[i - 1]!.t, ht[j - 1]!.t);
      const diag = score[at(i - 1, j - 1)]! + (sim >= 0.7 ? 2 * sim : -1);
      const up = score[at(i - 1, j)]! + GAP, left = score[at(i, j - 1)]! + GAP;
      const s12 = j >= 2 ? similarity(st[i - 1]!.t, ht[j - 2]!.t + ht[j - 1]!.t) : 0;
      const s21 = i >= 2 ? similarity(st[i - 2]!.t + st[i - 1]!.t, ht[j - 1]!.t) : 0;
      const split = s12 >= 0.8 ? score[at(i - 1, j - 2)]! + 3 * s12 : -Infinity;
      const join = s21 >= 0.8 ? score[at(i - 2, j - 1)]! + 3 * s21 : -Infinity;
      const best = Math.max(diag, up, left, split, join);
      score[at(i, j)] = best;
      back[at(i, j)] = best === diag ? 0 : best === split ? 3 : best === join ? 4 : best === up ? 1 : 2;
    }
  }
  const spans = new Map<number, { start: number; end: number }>();
  const add = (si: number, h: TranscriptWord) => {
    const cur = spans.get(si);
    spans.set(si, cur ? { start: Math.min(cur.start, h.start), end: Math.max(cur.end, h.end) } : { start: h.start, end: h.end });
  };
  for (let i = n, j = m; i > 0 || j > 0;) {
    const b = back[at(i, j)];
    if (b === 3 && i > 0 && j > 1) {
      add(st[i - 1]!.i, heard[ht[j - 2]!.i]!); add(st[i - 1]!.i, heard[ht[j - 1]!.i]!);
      i--; j -= 2;
    } else if (b === 4 && i > 1 && j > 0) {
      add(st[i - 2]!.i, heard[ht[j - 1]!.i]!); add(st[i - 1]!.i, heard[ht[j - 1]!.i]!);
      i -= 2; j--;
    } else if (i > 0 && j > 0 && b === 0) {
      if (similarity(st[i - 1]!.t, ht[j - 1]!.t) >= 0.7) {
        const si = st[i - 1]!.i, h = heard[ht[j - 1]!.i]!;
        const cur = spans.get(si);
        spans.set(si, cur ? { start: Math.min(cur.start, h.start), end: Math.max(cur.end, h.end) } : { start: h.start, end: h.end });
      }
      i--; j--;
    } else if (i > 0 && (b === 1 || j === 0)) i--;
    else j--;
  }
  const words: VoiceWord[] = script.map((s, i) => ({ w: s.w, beat: s.beat, start: spans.get(i)?.start ?? NaN, end: spans.get(i)?.end ?? NaN, heard: spans.has(i) }));
  // Unheard words: spread between the heard neighbours, in proportion to their length.
  for (let i = 0; i < words.length; i++) {
    if (words[i]!.heard) continue;
    let a = i;
    while (a < words.length && !words[a]!.heard) a++;
    const prevEnd = i > 0 ? words[i - 1]!.end : heard[0]?.start ?? 0;
    const nextStart = a < words.length ? words[a]!.start : heard[heard.length - 1]?.end ?? prevEnd;
    const run = words.slice(i, a);
    const total = run.reduce((s, w) => s + w.w.length, 0) || 1;
    let t = prevEnd;
    for (const w of run) { const d = ((nextStart - prevEnd) * w.w.length) / total; w.start = t; w.end = t + d; t += d; }
    i = a - 1;
  }
  return { words, matched: script.length ? words.filter((w) => w.heard).length / script.length : 0 };
}

/**
 * Move word edges to the voice. Whisper's boundaries run through pauses, and the cut needs the pauses: between two
 * heard words, the nearest real silence (at least 70 ms of no voice, within 0.25 s of whisper's boundary and inside
 * the pair) becomes the end of one and the start of the next. A word that starts in silence moves up to the voice.
 */
export function refineEdges(words: VoiceWord[], rms: readonly number[], fps: number): void {
  const voiced = (f: number) => (rms[f] ?? 0) > 0.06;
  const silences: [number, number][] = [];
  for (let f = 0; f < rms.length;) {
    if (voiced(f)) { f++; continue; }
    let g = f;
    while (g < rms.length && !voiced(g)) g++;
    if (g - f >= Math.round(0.07 * fps)) silences.push([f / fps, g / fps]);
    f = g;
  }
  for (let k = 0; k + 1 < words.length; k++) {
    const a = words[k]!, b = words[k + 1]!;
    if (!a.heard || !b.heard) continue;
    const boundary = (a.end + b.start) / 2;
    let best: [number, number] | undefined;
    for (const sil of silences) {
      if (sil[0] < a.start + 0.05 || sil[1] > b.end - 0.05) continue;
      const centre = (sil[0] + sil[1]) / 2;
      if (Math.abs(centre - boundary) > 0.25) continue;
      if (!best || Math.abs(centre - boundary) < Math.abs((best[0] + best[1]) / 2 - boundary)) best = sil;
    }
    if (best) { a.end = best[0]; b.start = best[1]; }
  }
  for (const w of words) {
    if (!w.heard) continue;
    let i = Math.round(w.start * fps);
    const endF = Math.round(w.end * fps);
    while (i < endF - 2 && !voiced(i)) i++;
    w.start = i / fps;
    let j = endF;
    while (j - 1 > i + 2 && !voiced(j - 1)) j--;
    w.end = Math.max(w.start + 0.05, j / fps);
  }
}

// ---------------------------------------------------------------- the whole voiceover

export function shaOf(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 16);
}

/** Transcribe with `hyperframes transcribe` (whisper.cpp; the runtime and model are fetched once). Cached by hash. */
export async function transcribe(file: string, cacheDir: string, language = "de", model = "small"): Promise<TranscriptWord[]> {
  const sha = shaOf(file);
  const cached = path.join(cacheDir, `${sha}.${language}.${model}.words.json`);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, "utf8")) as TranscriptWord[];
  mkdirSync(cacheDir, { recursive: true });
  const work = path.join(cacheDir, `${sha}-work`);
  mkdirSync(work, { recursive: true });
  const q = (s: string) => `"${s.replace(/(["\\$`])/g, "\\$1")}"`;
  await run(`npx hyperframes transcribe ${q(file)} --language ${language} --model ${model} --json -d ${q(work)}`, { maxBuffer: 64 * 1024 * 1024, timeout: 20 * 60 * 1000 });
  const words = (JSON.parse(readFileSync(path.join(work, "transcript.json"), "utf8")) as { text: string; start: number; end: number }[]).map((w) => ({ text: w.text, start: w.start, end: w.end }));
  writeFileSync(cached, JSON.stringify(words));
  return words;
}

export async function analyzeVoice(file: string, beats: readonly VoiceBeat[], cacheDir: string, options: { language?: string; model?: string } = {}): Promise<VoiceAnalysis> {
  const heard = await transcribe(file, cacheDir, options.language, options.model);
  const [mono] = decode(file, 1);
  const env = envelope(mono!);
  const fps = 100;
  const rms = Array.from(env, (v) => Math.round(v * 1000) / 1000);
  const { words, matched } = matchWords(beats, heard);
  refineEdges(words, rms, fps);
  return { file, sha: shaOf(file), durationSeconds: Math.round((mono!.length / SR) * 1000) / 1000, fps, rms, words: words.map((w) => ({ ...w, start: Math.round(w.start * 1000) / 1000, end: Math.round(w.end * 1000) / 1000 })), matched: Math.round(matched * 100) / 100 };
}

/**
 * Beat lengths from the read. Each cut sits in the pause before its beat's first word: 45% of the pause before it,
 * at least 0.04 s and at most 0.18 s ahead of the word. The first beat starts at 0; the last ends `tail` after its
 * last word (or at the end of the audio, whichever is sooner, but never before the last word).
 */
export function beatTiming(beats: readonly VoiceBeat[], voice: VoiceAnalysis, tail = 0.7): { id: string; start: number; end: number; durationSeconds: number }[] {
  const first = (id: string) => voice.words.find((w) => w.beat === id);
  const last = (id: string) => [...voice.words].reverse().find((w) => w.beat === id);
  const cuts: number[] = [0];
  for (let i = 1; i < beats.length; i++) {
    const f = first(beats[i]!.id), l = last(beats[i - 1]!.id);
    if (!f || !l) throw new Error(`${beats[i]!.id}: no words to time it by (give each beat its spoken text)`);
    const gap = Math.max(0, f.start - l.end);
    // Never before the last word of the previous beat has ended: with no pause, the cut sits on the boundary.
    cuts.push(Math.max(cuts[i - 1]! + 0.3, l.end, f.start - Math.min(0.18, Math.max(0.04, gap * 0.45))));
  }
  const lastWord = last(beats[beats.length - 1]!.id);
  const end = Math.max((lastWord?.end ?? 0) + 0.2, Math.min(voice.durationSeconds, (lastWord?.end ?? 0) + tail));
  cuts.push(end);
  return beats.map((b, i) => ({ id: b.id, start: Math.round(cuts[i]! * 1000) / 1000, end: Math.round(cuts[i + 1]! * 1000) / 1000, durationSeconds: Math.round((cuts[i + 1]! - cuts[i]!) * 1e6) / 1e6 }));
}

/** What a composition gets: its own words and the voice's loudness, in its own time (0 = the beat's first frame). */
export function beatVoice(voice: VoiceAnalysis, beatId: string, start: number, end: number): { words: { w: string; start: number; end: number }[]; fps: number; rms: number[] } {
  const a = Math.max(0, Math.floor(start * voice.fps)), b = Math.min(voice.rms.length, Math.ceil(end * voice.fps));
  return {
    words: voice.words.filter((w) => w.beat === beatId).map((w) => ({ w: w.w, start: Math.round((w.start - start) * 1000) / 1000, end: Math.round((w.end - start) * 1000) / 1000 })),
    fps: voice.fps,
    rms: voice.rms.slice(a, b),
  };
}
