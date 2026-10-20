import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { reelcutHome } from "../library/store.js";
import { fit, pool } from "./image.js";
import { readText } from "./ocr.js";
import { WatchError, mean, norm, parseTime } from "./time.js";

/**
 * A video being watched, and everything known about it, cached under ~/.reelcut/watch/videos/<id>/ by the file's
 * content (a renamed or moved file keeps its memory): the measurements (cuts, motion, loudness), the transcript, the
 * on-screen text index, the notes, the session with its frame budget, the watch log and every image a look made.
 *
 * Nothing here decides what a video means. It answers the questions Claude asks while it watches.
 */

export const INDEX_VERSION = 3;
export const BIN = 0.5;
const CUT_SCORE = 0.3, CUT_MERGE = 0.25, MOTION_FPS = 4;
const MODEL_URL = (name: string) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${name}.bin`;
const VAD_URL = "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin";

export type Depth = "quick" | "normal" | "deep";
export const DEPTHS: Record<Depth, { budget: number; story: number; ocrEvery: number }> = {
  quick: { budget: 40, story: 9, ocrEvery: 20 },
  normal: { budget: 150, story: 16, ocrEvery: 10 },
  deep: { budget: 500, story: 25, ocrEvery: 5 },
};

export const watchHome = (): string => path.join(reelcutHome(), "watch");

export interface Meta { v: number; id: string; path: string; name: string; duration: number; width: number; height: number; fps: number; codec?: string; audio: boolean; size: number; url?: string; title?: string }
export interface Visual { cuts: number[]; motion: number[]; bin: number }
export interface Audio { lufs: number[]; bin: number; silences: [number, number][]; hits: number[] }
export interface Word { w: string; a: number; b: number; p: number }
export interface Segment { a: number; b: number; text: string; conf: number; words: Word[] }
export interface Transcript { model: string; language?: string; segments: Segment[]; seconds: number; via: string }
export interface Session { id: string; depth: Depth; budget: number; used: number; question?: string; started: number; conversation?: string }
export interface Note { t?: number; text: string; on: string }
export interface LogEntry { kind: string; at: number; frm?: number; to?: number; fps?: number; frames?: number; files?: string[]; times?: number[]; why?: string; text?: string; region?: string; query?: string[]; file?: string }

export function contentId(file: string): string {
  const size = statSync(file).size;
  const h = createHash("sha1").update(String(size));
  const fd = openSync(file, "r");
  try {
    const chunk = Buffer.alloc(Math.min(size, 2 << 20));
    readSync(fd, chunk, 0, chunk.length, 0); h.update(chunk);
    if (size > 4 << 20) { readSync(fd, chunk, 0, chunk.length, size - chunk.length); h.update(chunk); }
  } finally { closeSync(fd); }
  return h.digest("hex").slice(0, 12);
}

function sh(cmd: string, args: string[], input?: Buffer): { stdout: string; stderr: string; status: number } {
  const p = spawnSync(cmd, args, { input, maxBuffer: 512 << 20 });
  if (p.error) throw new WatchError(`${cmd} could not run: ${p.error.message}`);
  return { stdout: p.stdout?.toString() ?? "", stderr: p.stderr?.toString() ?? "", status: p.status ?? 1 };
}
function must(cmd: string, args: string[]): { stdout: string; stderr: string } {
  const r = sh(cmd, args);
  if (r.status !== 0) throw new WatchError(`${path.basename(cmd)} failed: ${r.stderr.trim().split("\n").slice(-4).join(" | ")}`);
  return r;
}
export const which = (bin: string): string | undefined => {
  const r = spawnSync("/usr/bin/which", [bin]);
  return r.status === 0 ? r.stdout.toString().trim() : undefined;
};
const progress = (s: string) => process.stderr.write(`watch: ${s}\n`);

function readScores(file: string, key = "lavfi.scene_score"): [number, number][] {
  if (!existsSync(file)) return [];
  const rows: [number, number][] = [];
  let t = 0;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith("frame:")) { const m = /pts_time:(-?[\d.e+-]+)/.exec(line); if (m) t = Number(m[1]); }
    else if (line.startsWith(`${key}=`)) { const v = Number(line.slice(key.length + 1)); if (Number.isFinite(v)) rows.push([t, v]); }
  }
  return rows;
}

/** whisper's inventions over music and silence: one repeated character, credits, a lone filler. */
export function hallucination(text: string): boolean {
  const letters = [...text.toLowerCase()].filter((c) => /\p{L}/u.test(c));
  if (new Set(letters).size <= 2) return true;
  if (/^(.{1,6}?)\1{4,}$/u.test(text.replace(/\s+/g, ""))) return true;
  const t = norm(text);
  return t.length < 60 && ["untertitel im auftrag", "untertitelung des zdf", "subtitles by the amara", "thanks for watching", "vielen dank fur ihre aufmerksamkeit"].some((x) => t.includes(x));
}

async function download(url: string, dest: string): Promise<string> {
  mkdirSync(path.dirname(dest), { recursive: true });
  const r = await fetch(url);
  if (!r.ok) throw new WatchError(`could not fetch ${url}: ${r.status}`);
  writeFileSync(`${dest}.part`, Buffer.from(await r.arrayBuffer()));
  renameSync(`${dest}.part`, dest);
  return dest;
}

export async function findModel(name: string): Promise<string> {
  if (process.env.REELCUT_WHISPER_MODEL && existsSync(process.env.REELCUT_WHISPER_MODEL)) return process.env.REELCUT_WHISPER_MODEL;
  const file = `ggml-${name}.bin`;
  for (const d of [path.join(watchHome(), "models"), path.join(os.homedir(), ".cache", "hyperframes", "whisper", "models"), path.join(os.homedir(), ".cache", "whisper"), "/opt/homebrew/share/whisper-cpp/models", "/usr/local/share/whisper-cpp/models"]) {
    if (existsSync(path.join(d, file))) return path.join(d, file);
  }
  progress(`fetching the whisper \`${name}\` model once …`);
  return download(MODEL_URL(name), path.join(watchHome(), "models", file));
}

async function findVad(): Promise<string | undefined> {
  const file = "ggml-silero-v5.1.2.bin", dest = path.join(watchHome(), "models", file);
  // The standalone video-understanding skill keeps the same model; fetch it once between the two.
  for (const d of [path.dirname(dest), path.join(os.homedir(), ".cache", "video-understanding", "models")]) if (existsSync(path.join(d, file))) return path.join(d, file);
  try { return await download(VAD_URL, dest); } catch (e) { progress(`voice-detection model unavailable (${(e as Error).message}); music may be transcribed as words`); return undefined; }
}

export class WatchVideo {
  readonly path: string;
  readonly id: string;
  readonly dir: string;
  readonly meta: Meta;

  constructor(file: string) {
    this.path = path.resolve(file);
    if (!existsSync(this.path)) throw new WatchError(`no such file: ${file}`);
    this.id = contentId(this.path);
    this.dir = path.join(watchHome(), "videos", this.id);
    mkdirSync(path.join(this.dir, "looks"), { recursive: true });
    this.meta = this.readMeta();
  }

  get duration(): number { return this.meta.duration; }
  get long(): boolean { return this.duration >= 3600; }
  /** A time on this video, clamped into it. */
  t(s: string | number | undefined): number | undefined {
    const v = parseTime(s, this.duration);
    return v === undefined ? undefined : Math.min(Math.max(0, v), this.duration);
  }
  get grid() { return { file: this.path, duration: this.duration, width: this.meta.width, height: this.meta.height, long: this.long }; }

  load<T>(name: string): T | undefined {
    const f = path.join(this.dir, name);
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as T) : undefined;
  }
  save(name: string, data: unknown): void { writeFileSync(path.join(this.dir, name), JSON.stringify(data)); }
  lookPath(tag: string): string {
    const n = readdirSync(path.join(this.dir, "looks")).filter((f) => f.endsWith(".jpg")).length;
    return path.join(this.dir, "looks", `${String(n).padStart(3, "0")}-${tag}.jpg`);
  }

  private readMeta(): Meta {
    const f = path.join(this.dir, "meta.json");
    if (existsSync(f)) {
      const m = JSON.parse(readFileSync(f, "utf8")) as Meta;
      if (m.v === INDEX_VERSION) { if (m.path !== this.path) { m.path = this.path; writeFileSync(f, JSON.stringify(m, null, 1)); } return m; }
    }
    if (!which("ffprobe")) throw new WatchError("ffprobe is not installed (it comes with ffmpeg: brew install ffmpeg)");
    const info = JSON.parse(must("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", this.path]).stdout) as { streams?: Record<string, any>[]; format?: { duration?: string } };
    const vs = info.streams?.find((s) => s.codec_type === "video");
    if (!vs) throw new WatchError(`${path.basename(this.path)} has no video stream`);
    let w = Number(vs.width ?? 0), h = Number(vs.height ?? 0);
    let rot = Number(vs.tags?.rotate ?? 0);
    for (const sd of vs.side_data_list ?? []) if (sd.rotation !== undefined) rot = Number(sd.rotation);
    if (Math.abs(rot) % 180 === 90) [w, h] = [h, w];
    const [num, den] = String(vs.avg_frame_rate || vs.r_frame_rate || "0/1").split("/").map(Number);
    const m: Meta = {
      v: INDEX_VERSION, id: this.id, path: this.path, name: path.basename(this.path),
      duration: Number(info.format?.duration ?? vs.duration ?? 0), width: w, height: h, fps: den ? Math.round((num! / den) * 1000) / 1000 : 0,
      codec: vs.codec_name, audio: !!info.streams?.some((s) => s.codec_type === "audio"), size: statSync(this.path).size,
    };
    const urls = readUrls();
    for (const [url, rec] of Object.entries(urls)) if (rec.path === this.path) { m.url = url; m.title = rec.title; }
    writeFileSync(f, JSON.stringify(m, null, 1));
    return m;
  }

  /** One pass over the pictures: the cuts (frame to frame) and the motion (frames a quarter-second apart). */
  visual(): Visual {
    const got = this.load<Visual>("visual.json");
    if (got) return got;
    progress(`measuring cuts and motion in ${this.meta.name} …`);
    const td = mkdtempSync(path.join(os.tmpdir(), "rc-watch-"));
    try {
      const cutsF = path.join(td, "cuts.txt"), motF = path.join(td, "motion.txt");
      const graph = `[0:v]scale=160:-2,split[a][b];[a]select='gte(scene,0)',metadata=print:key=lavfi.scene_score:file=${cutsF}[ca];`
        + `[b]fps=${MOTION_FPS},select='gte(scene,0)',metadata=print:key=lavfi.scene_score:file=${motF}[cb]`;
      const args = (hw: boolean) => ["-hide_banner", "-nostats", "-v", "error", ...(hw ? ["-hwaccel", "videotoolbox"] : []), "-i", this.path, "-an", "-sn",
        "-filter_complex", graph, "-map", "[ca]", "-f", "null", "-", "-map", "[cb]", "-f", "null", "-"];
      if (sh("ffmpeg", args(process.platform === "darwin")).status !== 0) must("ffmpeg", args(false));
      const cuts: number[] = [];
      for (const [t, s] of readScores(cutsF)) if (s > CUT_SCORE && t > 0.05 && !(cuts.length && t - cuts.at(-1)! < CUT_MERGE)) cuts.push(Math.round(t * 1000) / 1000);
      const nb = Math.max(1, Math.ceil(this.duration / BIN));
      const sums = new Array<number>(nb).fill(0), counts = new Array<number>(nb).fill(0);
      for (const [t, s] of readScores(motF)) {
        if (cuts.some((c) => Math.abs(t - c) < 0.3)) continue; // a cut is not motion
        const i = Math.min(nb - 1, Math.floor(t / BIN)); sums[i]! += s; counts[i]!++;
      }
      const raw = sums.map((s, i) => (counts[i] ? Math.round((s / counts[i]!) * 1e5) / 1e5 : undefined));
      // A bin emptied by a cut takes the busier of its neighbours.
      const motion = raw.map((v, i) => {
        if (v !== undefined) return v;
        const left = raw.slice(0, i).reverse().find((x) => x !== undefined), right = raw.slice(i + 1).find((x) => x !== undefined);
        return Math.max(left ?? 0, right ?? 0);
      });
      const data: Visual = { cuts, motion, bin: BIN };
      this.save("visual.json", data);
      return data;
    } finally { rmSync(td, { recursive: true, force: true }); }
  }

  /** One pass over the sound: loudness every half second, silences, sudden loud hits. */
  audio(): Audio | undefined {
    if (!this.meta.audio) return undefined;
    const got = this.load<Audio>("audio.json");
    if (got) return got;
    progress(`listening to the loudness of ${this.meta.name} …`);
    const td = mkdtempSync(path.join(os.tmpdir(), "rc-watch-"));
    try {
      const lf = path.join(td, "loud.txt");
      const r = must("ffmpeg", ["-hide_banner", "-nostats", "-i", this.path, "-vn", "-sn", "-af",
        `ebur128=metadata=1:framelog=verbose,ametadata=mode=print:key=lavfi.r128.M:file=${lf},silencedetect=n=-42dB:d=0.35`, "-f", "null", "-"]);
      const silences: [number, number][] = [];
      let start: number | undefined;
      for (const line of r.stderr.split("\n")) {
        let m = /silence_start: (-?[\d.]+)/.exec(line);
        if (m) start = Math.max(0, Number(m[1]));
        m = /silence_end: ([\d.]+)/.exec(line);
        if (m && start !== undefined) { silences.push([round2(start), round2(Number(m[1]))]); start = undefined; }
      }
      if (start !== undefined) silences.push([round2(start), round2(this.duration)]);
      const nb = Math.max(1, Math.ceil(this.duration / BIN));
      const bins: number[][] = Array.from({ length: nb }, () => []);
      for (const [t, v] of readScores(lf, "lavfi.r128.M")) bins[Math.min(nb - 1, Math.floor(t / BIN))]!.push(Math.max(v, -70));
      const lufs = bins.map((b) => (b.length ? Math.round(mean(b) * 10) / 10 : -70));
      const hits: number[] = [];
      for (let i = 2; i < nb; i++) {
        const before = mean(lufs.slice(Math.max(0, i - 3), i));
        if (lufs[i]! > -32 && lufs[i]! - before >= 8 && (!hits.length || i * BIN - hits.at(-1)! > 0.75)) hits.push(round2(i * BIN));
      }
      const data: Audio = { lufs, bin: BIN, silences, hits };
      this.save("audio.json", data);
      return data;
    } finally { rmSync(td, { recursive: true, force: true }); }
  }

  /**
   * What is said. whisper.cpp when it is installed (voice detection first, so music is not heard as words; the
   * language detected), else `hyperframes transcribe`, which reelcut already depends on. Cached.
   */
  async transcript(opts: { model?: string; lang?: string; required?: boolean } = {}): Promise<Transcript | undefined> {
    if (!this.meta.audio) return undefined;
    const model = opts.model ?? "small", lang = opts.lang ?? "auto";
    const got = this.load<Transcript>("transcript.json");
    if (got && (got.model === model || model === "small")) return got;
    const bin = ["whisper-cli", "whisper-cpp"].find((b) => which(b));
    progress(`transcribing ${this.meta.name} with whisper ${model} (language ${lang}) …`);
    const t0 = Date.now();
    const td = mkdtempSync(path.join(os.tmpdir(), "rc-watch-"));
    try {
      let data: Transcript;
      if (bin) {
        const wav = path.join(td, "a.wav");
        must("ffmpeg", ["-v", "error", "-i", this.path, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
        const vad = await findVad();
        must(bin, ["-m", await findModel(model), "-f", wav, "-l", lang, "-ojf", "-of", path.join(td, "out"), "-np", "-t", String(Math.max(2, os.cpus().length - 1)), ...(vad ? ["--vad", "-vm", vad] : [])]);
        const raw = JSON.parse(readFileSync(path.join(td, "out.json"), "utf8")) as { result?: { language?: string }; transcription?: { offsets: { from: number; to: number }; text: string; tokens?: { text: string; offsets: { from: number; to: number }; p?: number }[] }[] };
        const segments: Segment[] = [];
        for (const seg of raw.transcription ?? []) {
          const text = seg.text.trim();
          if (!text || hallucination(text)) continue;
          const words: Word[] = [];
          let cur: { w: string; a: number; b: number; p: number[] } | undefined;
          for (const tok of seg.tokens ?? []) {
            if (tok.text.startsWith("[_") || tok.text.startsWith("<|")) continue;
            const a = tok.offsets.from / 1000, b = tok.offsets.to / 1000;
            if (!cur || tok.text.startsWith(" ") || !cur.w) {
              if (cur?.w.trim()) words.push({ w: cur.w.trim(), a: round2(cur.a), b: round2(cur.b), p: round2(Math.min(...cur.p)) });
              cur = { w: tok.text.trim(), a, b, p: [tok.p ?? 1] };
            } else { cur.w += tok.text; cur.b = b; cur.p.push(tok.p ?? 1); }
          }
          if (cur?.w.trim()) words.push({ w: cur.w.trim(), a: round2(cur.a), b: round2(cur.b), p: round2(Math.min(...cur.p)) });
          segments.push({ a: seg.offsets.from / 1000, b: seg.offsets.to / 1000, text, conf: words.length ? round2(mean(words.map((w) => w.p))) : 0, words });
        }
        data = { model, language: raw.result?.language, segments, seconds: (Date.now() - t0) / 1000, via: "whisper.cpp" };
      } else {
        const r = sh("npx", ["hyperframes", "transcribe", this.path, ...(lang !== "auto" ? ["--language", lang] : []), "--model", model, "--json", "-d", td]);
        if (r.status !== 0) {
          if (opts.required) throw new WatchError("no transcriber: install whisper.cpp (brew install whisper-cpp), or run `npx hyperframes doctor`");
          return undefined;
        }
        const words = (JSON.parse(readFileSync(path.join(td, "transcript.json"), "utf8")) as { text: string; start: number; end: number }[]).map((w) => ({ w: w.text.trim(), a: w.start, b: w.end, p: 1 }));
        data = { model, language: lang === "auto" ? undefined : lang, segments: wordsToSegments(words), seconds: (Date.now() - t0) / 1000, via: "hyperframes" };
      }
      this.save("transcript.json", data);
      return data;
    } finally { rmSync(td, { recursive: true, force: true }); }
  }

  /** On-screen text, sampled every `every` seconds and in the middle of every shot. Built once, for search. */
  async ocrIndex(every: number): Promise<{ t: number; text: string }[]> {
    const got = this.load<{ every: number; frames: { t: number; text: string }[] }>("ocr_index.json");
    if (got && got.every <= every) return got.frames;
    const vis = this.visual();
    const times = new Set<number>();
    for (let t = 0.5; t < this.duration; t += every) times.add(Math.round(t * 10) / 10);
    const bounds = [0, ...vis.cuts, this.duration];
    if (bounds.length < 400) for (let i = 1; i < bounds.length; i++) times.add(Math.round(((bounds[i - 1]! + bounds[i]!) / 2) * 10) / 10);
    const sorted = [...times].sort((a, b) => a - b);
    progress(`reading on-screen text at ${sorted.length} moments (cached after this) …`);
    const td = mkdtempSync(path.join(os.tmpdir(), "rc-watch-"));
    try {
      const [w, h] = fit(this.meta.width, this.meta.height, 1600);
      const files = await pool(sorted, 8, async (t, i) => {
        const out = path.join(td, `f${String(i).padStart(5, "0")}.jpg`);
        execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", Math.min(t, Math.max(0, this.duration - 0.05)).toFixed(3), "-i", this.path, "-frames:v", "1", "-an", "-vf", `scale=${w}:${h}`, "-q:v", "2", out]);
        return out;
      });
      const res = readText(files);
      const frames: { t: number; text: string }[] = [];
      let last = "";
      sorted.forEach((t, i) => {
        const text = (res.get(files[i]!) ?? []).map((l) => l.text).join(" | ");
        if (text && text !== last) frames.push({ t, text });
        last = text;
      });
      this.save("ocr_index.json", { every, frames });
      return frames;
    } finally { rmSync(td, { recursive: true, force: true }); }
  }

  // ── session, budget, log, notes ──

  session(): Session { return this.load<Session>("session.json") ?? this.begin("normal"); }

  begin(depth: Depth, question?: string): Session {
    const s: Session = { id: new Date().toISOString().replace(/[-:]/g, "").slice(0, 15), depth, budget: DEPTHS[depth].budget, used: 0, started: Date.now(),
      ...(question ? { question } : {}), ...(process.env.REELCUT_CONVERSATION ? { conversation: process.env.REELCUT_CONVERSATION } : {}) };
    this.save("session.json", s);
    writeFileSync(path.join(this.dir, "log.jsonl"), "");
    return s;
  }

  spend(n: number, over: boolean): Session {
    const s = this.session();
    if (n && s.used + n > s.budget && !over) {
      throw new WatchError(`budget: ${s.used} of ${s.budget} frames used at depth \`${s.depth}\`; this look needs ${n}. Narrow the range, lower the fps, use transcript/ocr/search, or pass --over if the question truly needs it.`, 3);
    }
    s.used += n;
    // A conversation that looks at a video it watched before takes the session over.
    if (process.env.REELCUT_CONVERSATION) s.conversation = process.env.REELCUT_CONVERSATION;
    this.save("session.json", s);
    return s;
  }

  log(kind: string, entry: Omit<LogEntry, "kind" | "at"> = {}): void {
    const clean = Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined));
    appendFileSync(path.join(this.dir, "log.jsonl"), `${JSON.stringify({ kind, at: Date.now(), ...clean })}\n`);
  }
  readLog(): LogEntry[] {
    const f = path.join(this.dir, "log.jsonl");
    return existsSync(f) ? readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as LogEntry) : [];
  }
  notes(): Note[] { return this.load<Note[]>("notes.json") ?? []; }
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** hyperframes gives words only: a segment ends at a sentence end or a pause of 0.6 s. */
function wordsToSegments(words: Word[]): Segment[] {
  const out: Segment[] = [];
  let cur: Word[] = [];
  const flush = () => { if (cur.length) out.push({ a: cur[0]!.a, b: cur.at(-1)!.b, text: cur.map((w) => w.w).join(" "), conf: 1, words: cur }); cur = []; };
  for (const w of words) {
    if (cur.length && w.a - cur.at(-1)!.b > 0.6) flush();
    cur.push(w);
    if (/[.!?]$/.test(w.w)) flush();
  }
  flush();
  return out;
}

// ── URLs ──

interface UrlRec { path: string; title?: string; at: string }
const urlsFile = () => path.join(watchHome(), "urls.json");
function readUrls(): Record<string, UrlRec> { try { return JSON.parse(readFileSync(urlsFile(), "utf8")) as Record<string, UrlRec>; } catch { return {}; } }

export function fetchUrl(url: string): string {
  const urls = readUrls();
  if (urls[url] && existsSync(urls[url]!.path)) return urls[url]!.path;
  const ytdlp = which("yt-dlp");
  if (!ytdlp) throw new WatchError("yt-dlp is not installed. Install it to watch URLs (macOS: brew install yt-dlp; elsewhere: pipx install yt-dlp).");
  const out = path.join(watchHome(), "downloads");
  mkdirSync(out, { recursive: true });
  progress(`downloading ${url} …`);
  const r = must(ytdlp, ["--no-playlist", "--no-progress", "-f", "bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b", "--merge-output-format", "mp4",
    "-o", path.join(out, "%(extractor)s-%(id)s.%(ext)s"), "--print", "after_move:filepath", "--print", "title", url]);
  const lines = r.stdout.split("\n").filter((l) => l.trim());
  const file = [...lines].reverse().find((l) => existsSync(l));
  if (!file) throw new WatchError(`yt-dlp finished but no file was found: ${lines.slice(-3).join(" | ")}`);
  urls[url] = { path: file, title: lines.find((l) => l !== file), at: new Date().toISOString().slice(0, 10) };
  writeFileSync(urlsFile(), JSON.stringify(urls, null, 1));
  return file;
}

/** A file, a URL (downloaded once), or the 12-character id a video was cached under. */
export function resolveVideo(src: string): WatchVideo {
  if (/^https?:\/\//.test(src)) return new WatchVideo(fetchUrl(src));
  const p = src.replace(/^~(?=$|\/)/, os.homedir());
  if (existsSync(p)) return new WatchVideo(p);
  const meta = path.join(watchHome(), "videos", src, "meta.json");
  if (/^[0-9a-f]{12}$/.test(src) && existsSync(meta)) return new WatchVideo((JSON.parse(readFileSync(meta, "utf8")) as Meta).path);
  throw new WatchError(`no such file, URL or watched video id: ${src}`);
}
