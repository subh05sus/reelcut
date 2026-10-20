import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fit, grabFrame, legend, makeGrids, writeJpeg } from "./image.js";
import { REGIONS, readText, region, textReaderAvailable, where } from "./ocr.js";
import { beatSegments, clipSpans, fastSpans, overlap, segmentsFor, shotsOf, soundSpans, speechIn, stillSpans, storyboardTimes, wordsIn, type Span } from "./timeline.js";
import { WatchError, fmt, mean, median, motionLevel, motionSpark, norm, resample, span, sparkline } from "./time.js";
import { BIN, DEPTHS, fetchUrl, resolveVideo, watchHome, which, type Depth, type Meta, type WatchVideo } from "./video.js";

/**
 * The watch commands. Each returns the text it prints; the CLI (skills/reelcut/scripts/watch.ts) is only argument
 * parsing. Every look logs itself (with Claude's `why`) for the studio's Watch panel and the report.
 */

const MAX_FRAMES_PER_CALL = 48;
const safe = (t: number) => fmt(t).replace(":", "m");

export interface OverviewOpts { question?: string; depth?: Depth; model?: string; lang?: string; rows?: number; noTranscript?: boolean; noStoryboard?: boolean; beats?: string }

export async function overview(srcs: string[], o: OverviewOpts = {}): Promise<string> {
  const out: string[] = [];
  for (const [i, src] of srcs.entries()) {
    if (i) out.push(`\n${"═".repeat(100)}\n`);
    out.push(await overviewOne(resolveVideo(src), o));
  }
  return out.join("\n");
}

async function overviewOne(v: WatchVideo, o: OverviewOpts): Promise<string> {
  const prior = v.load<{ depth: Depth }>("session.json");
  if (o.question || o.depth || !prior) v.begin(o.depth ?? prior?.depth ?? "normal", o.question);
  const s = v.session();
  const vis = v.visual(), au = v.audio();
  const tr = o.noTranscript ? undefined : await v.transcript({ model: o.model, lang: o.lang });
  const m = v.meta, d = v.duration, L: string[] = [];
  const shots = shotsOf(v, vis).map(([a, b]) => b - a), med = median(shots);
  L.push(`VIDEO  ${m.title ?? m.name}   id ${v.id}`);
  if (m.url) L.push(`       ${m.url}`);
  L.push(`       ${fmt(d, v.long)} · ${m.width}×${m.height} ${m.height > m.width ? "portrait" : m.height === m.width ? "square" : "landscape"} · ${m.fps} fps · ${m.audio ? "sound" : "NO SOUND"}`);
  L.push(`       ${vis.cuts.length} cuts · median shot ${med.toFixed(1)}s · pacing ${med <= 1.6 ? "fast" : med <= 3.5 ? "medium" : "slow"} · ${Math.round((vis.cuts.length / Math.max(d, 1)) * 60)} cuts/min`);
  if (tr && !tr.segments.length) L.push("       no speech heard (voice detection found no words)");
  else if (tr) {
    const spoken = tr.segments.reduce((a, x) => a + x.b - x.a, 0), low = tr.segments.filter((x) => x.conf < 0.5).length;
    L.push(`       speech ${Math.round((spoken / Math.max(d, 1)) * 100)}% of the time · language ${tr.language ?? "?"} · ${tr.segments.length} segments${low ? ` (${low} low-confidence, marked ?)` : ""}`);
  } else if (m.audio) L.push(`       transcript: ${o.noTranscript ? "skipped" : "unavailable (install whisper-cpp)"}`);
  const snd = soundSpans(au, tr);
  if (au) L.push(`       sound without speech ${Math.round((snd.sound.reduce((a, [x, y]) => a + y - x, 0) / Math.max(d, 1)) * 100)}% · ${au.silences.length} silences · ${au.hits.length} hits`);
  L.push(`       session depth \`${s.depth}\` · budget ${s.used}/${s.budget} frames${s.question ? ` · question: ${s.question}` : ""}`);

  const notes = v.notes();
  if (notes.length) {
    L.push("", "WHAT IS ALREADY KNOWN (notes from earlier watching)");
    for (const n of notes.slice(-15)) L.push(`   ${n.t !== undefined ? `@${fmt(n.t, v.long)}` : "      "}  ${n.text}`);
  }

  const beats = o.beats ? beatSegments(o.beats) : undefined;
  const segs: { span: Span; label?: string; text?: string }[] = beats ? beats.map((b) => ({ span: b.span, label: `${b.id}${b.kind ? ` ${b.kind}` : ""}`, text: b.text })) : segmentsFor(d, vis, au, o.rows ?? 30).map((x) => ({ span: x }));
  L.push("", `TIMELINE  (${segs.length} ${beats ? "beats from reel.json" : "segments"}; motion ▁ still … █ very fast; audio S speech · M music/sound · · quiet)`);
  for (const { span: [a, b], label, text } of segs) {
    const mot = vis.motion.slice(Math.floor(a / BIN), Math.max(Math.floor(a / BIN) + 1, Math.floor(b / BIN)));
    const ncut = vis.cuts.filter((c) => c > a && c < b).length, len = Math.max(b - a, 1e-6);
    const sp = overlap(snd.speech, a, b) / len, so = overlap(snd.sound, a, b) / len;
    let aud = `${sp > 0.4 ? "S" : sp > 0.1 ? "s" : " "}${so > 0.4 ? "M" : so > 0.1 ? "m" : " "}`;
    if (!m.audio) aud = "--"; else if (aud === "  ") aud = "· ";
    let said = wordsIn(tr, a, b);
    const q = speechIn(tr, a, b).some((x) => x.conf < 0.5) ? "?" : " ";
    said = said.length > 65 ? `${said.slice(0, 64)}…` : said;
    L.push(`  ${span(a, b, v.long).padStart(15)}  ${label ? `${label.padEnd(16)} ` : ""}${motionSpark(mot).padEnd(8)} ${motionLevel(mean(mot)).padEnd(6)} cuts ${String(ncut).padStart(2)}  ${aud} ${q}${said ? `“${said}”` : ""}`);
    if (text) L.push(`  ${" ".repeat(15)}  script: “${text.length > 90 ? `${text.slice(0, 89)}…` : text}”`);
  }
  const fast = fastSpans(d, vis), still = stillSpans(d, vis);
  if (fast.length) L.push("", `FAST PARTS (re-watch at 8–12 fps if they matter): ${fast.slice(0, 12).map(([a, b]) => span(a, b, v.long)).join(", ")}${fast.length > 12 ? " …" : ""}`);
  if (still.length) L.push(`STILL PARTS (one frame tells all): ${still.slice(0, 10).map(([a, b]) => span(a, b, v.long)).join(", ")}${still.length > 10 ? " …" : ""}`);
  if (au?.hits.length) L.push(`SOUND HITS: ${au.hits.slice(0, 20).map((h) => fmt(h, v.long)).join(", ")}${au.hits.length > 20 ? " …" : ""}`);

  if (!o.noStoryboard) {
    const times = storyboardTimes(segs.map((x) => x.span), d, DEPTHS[s.depth].story);
    v.spend(times.length, true);
    const grids = await makeGrids(v.grid, times, (k, of) => v.lookPath(`storyboard${of > 1 ? `-${k + 1}` : ""}`));
    v.log("storyboard", { frm: 0, to: d, frames: times.length, files: grids.map((g) => g.path), times });
    L.push("", "STORYBOARD (one frame from the middle of each segment; Read these images):", ...grids.map((g) => `   ${g.path}`));
  }
  L.push("", "NEXT: think about where the answer lives, then search / frames / transcript / audio there. Skip what the timeline shows is irrelevant.");
  return L.join("\n");
}

export interface LookOpts { from?: string; to?: string; at?: string; fps?: number; count?: number; single?: boolean; cell?: number; cols?: number; over?: boolean; why?: string; region?: string; changes?: boolean }

function momentsOf(v: WatchVideo, o: LookOpts, defaultCount: number): { times: number[]; a: number; b: number } {
  if (o.at) {
    const times = o.at.split(",").filter((x) => x.trim()).map((x) => v.t(x)!);
    return { times, a: Math.min(...times), b: Math.max(...times) };
  }
  if (o.from === undefined) throw new WatchError("give --at t1,t2,… or a range with --from/--to");
  const a = v.t(o.from)!, b = v.t(o.to ?? "end")!;
  if (b <= a) throw new WatchError("--to must be after --from");
  if (o.fps) {
    const times: number[] = [];
    for (let t = a; t <= b + 1e-6; t += 1 / o.fps) times.push(Math.round(t * 1000) / 1000);
    return { times, a, b };
  }
  const n = o.count ?? defaultCount;
  return { times: n > 1 ? Array.from({ length: n }, (_, i) => Math.round((a + ((b - a) * (i + 0.5)) / n) * 1000) / 1000) : [Math.round(((a + b) / 2) * 1000) / 1000], a, b };
}

export async function frames(src: string, o: LookOpts): Promise<string> {
  const v = resolveVideo(src);
  const { times, a, b } = momentsOf(v, o, 9);
  if (times.length > MAX_FRAMES_PER_CALL) throw new WatchError(`${times.length} frames in one look is too many (max ${MAX_FRAMES_PER_CALL}). Narrow the range or lower the fps; look coarse first, then fine where it matters.`);
  const s = v.spend(times.length, !!o.over);
  const L: string[] = [];
  if (o.single) {
    const [w, h] = fit(v.meta.width, v.meta.height, o.cell ?? 1280);
    const scale = Math.max(2, Math.floor(Math.min(w, h) / 160));
    const files: string[] = [];
    for (const t of times) {
      const img = await grabFrame(v.path, t, v.duration, w, h);
      img.label(fmt(t, v.long), scale);
      files.push(writeJpeg(img, v.lookPath(`frame-${safe(t)}`)));
      L.push(`${fmt(t, v.long)}  ${files.at(-1)}`);
    }
    v.log("frames", { frm: a, to: b, fps: o.fps, frames: times.length, files, times, why: o.why });
  } else {
    const grids = await makeGrids(v.grid, times, (k, of) => v.lookPath(`${safe(a)}-${safe(b)}${of > 1 ? `-${k + 1}` : ""}`), o.cell, o.cols);
    v.log("frames", { frm: a, to: b, fps: o.fps, frames: times.length, files: grids.map((g) => g.path), times, why: o.why });
    for (const g of grids) L.push(g.path, legend(g.times, g.cols, v.long));
  }
  L.push(`(${o.fps ? `${o.fps} fps` : `${times.length} frames`} over ${span(a, b, v.long)} · budget ${s.used}/${s.budget})`);
  const said = wordsIn(v.load("transcript.json"), a, b);
  if (said) L.push(`said here: “${said.slice(0, 400)}${said.length > 400 ? "…" : ""}”`);
  return L.join("\n");
}

function cropFor(v: WatchVideo, r: string | undefined): { crop?: string; w: number; h: number } {
  const [x, y, w, h] = region(r), W = v.meta.width, H = v.meta.height;
  const cw = Math.max(2, Math.floor((W * w) / 2) * 2), ch = Math.max(2, Math.floor((H * h) / 2) * 2);
  return { crop: !r || r === "full" ? undefined : `crop=${cw}:${ch}:${Math.floor(W * x)}:${Math.floor(H * y)}`, w: cw, h: ch };
}

export async function zoom(src: string, o: LookOpts): Promise<string> {
  const v = resolveVideo(src);
  if (!o.at) throw new WatchError("zoom needs --at");
  const t = v.t(o.at)!;
  const c = cropFor(v, o.region);
  let [tw, th] = Math.max(c.w, c.h) >= 1000 ? [c.w, c.h] : fit(c.w * 4, c.h * 4, 1000);
  [tw, th] = fit(tw, th, 2000);
  const s = v.spend(1, !!o.over);
  const img = await grabFrame(v.path, t, v.duration, tw, th, c.crop);
  const file = writeJpeg(img, v.lookPath(`zoom-${safe(t)}-${o.region ?? "full"}`), 2);
  v.log("zoom", { frm: t, to: t, frames: 1, files: [file], region: o.region ?? "full", why: o.why });
  return `${file}\n(${fmt(t, v.long)} · ${o.region ?? "full"} · ${tw}×${th} · budget ${s.used}/${s.budget})`;
}

export async function ocr(src: string, o: LookOpts): Promise<string> {
  const v = resolveVideo(src);
  const { times } = momentsOf(v, o, 6);
  if (times.length > 120) throw new WatchError("too many moments for one read; narrow the range");
  const c = cropFor(v, o.region);
  let [tw, th] = fit(c.w, c.h, 2000);
  if (Math.max(tw, th) < 1000) [tw, th] = fit(tw * 3, th * 3, 1600);
  const td = mkdtempSync(path.join(os.tmpdir(), "rc-ocr-"));
  try {
    const files: string[] = [];
    for (const [i, t] of times.entries()) files.push(writeJpeg(await grabFrame(v.path, t, v.duration, tw, th, c.crop), path.join(td, `o${i}.jpg`), 2));
    const res = readText(files);
    v.log("ocr", { frm: Math.min(...times), to: Math.max(...times), frames: 0, times, region: o.region, why: o.why });
    const L: string[] = [];
    let last: string | undefined;
    times.forEach((t, i) => {
      const lines = res.get(files[i]!) ?? [];
      const text = lines.map((l) => `${l.text}${l.box ? `   [${where(l.box)}]` : ""}`).join("\n      ");
      if (o.changes && text === last) return;
      L.push(`${fmt(t, v.long)}  ${text || "(no text)"}`);
      last = text;
    });
    return L.join("\n");
  } finally { rmSync(td, { recursive: true, force: true }); }
}

export async function transcript(src: string, o: { from?: string; to?: string; words?: boolean; srt?: boolean; model?: string; lang?: string; why?: string }): Promise<string> {
  const v = resolveVideo(src);
  const tr = await v.transcript({ model: o.model, lang: o.lang, required: true });
  if (!tr) throw new WatchError("this video has no sound");
  const a = o.from !== undefined ? v.t(o.from)! : 0, b = o.to !== undefined ? v.t(o.to)! : v.duration;
  const segs = speechIn(tr, a, b);
  v.log("transcript", { frm: a, to: b, frames: 0, why: o.why });
  if (o.srt) return segs.map((x, i) => `${i + 1}\n${srt(x.a)} --> ${srt(x.b)}\n${x.text}\n`).join("\n");
  const L = [`(language ${tr.language ?? "?"} · whisper ${tr.model} via ${tr.via} · ? = low confidence, check by looking or listening around it)`];
  for (const x of segs) {
    const q = x.conf < 0.5 ? "?" : " ";
    if (o.words) L.push(`${span(x.a, x.b, v.long)} ${q}`, `   ${x.words.filter((w) => w.b > a && w.a < b).map((w) => `${w.w}@${fmt(w.a, v.long)}`).join(" ")}`);
    else L.push(`${span(x.a, x.b, v.long)} ${q} ${x.text}`);
  }
  if (!segs.length) L.push("(nothing said in this range)");
  return L.join("\n");
}
const srt = (t: number) => `${String(Math.floor(t / 3600)).padStart(2, "0")}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")},${String(Math.round((t % 1) * 1000)).padStart(3, "0")}`;

export async function search(src: string, queries: string[], o: { noOcr?: boolean; model?: string } = {}): Promise<string> {
  const v = resolveVideo(src);
  const tr = await v.transcript({ model: o.model });
  const s = v.session();
  let ocrIdx: { t: number; text: string }[] = [];
  if (!o.noOcr) { try { ocrIdx = await v.ocrIndex(DEPTHS[s.depth].ocrEvery); } catch (e) { process.stderr.write(`watch: on-screen text skipped: ${(e as Error).message}\n`); } }
  v.log("search", { frames: 0, query: queries });
  const L: string[] = [];
  const hit = (text: string, nq: string, words: string[]) => { const nt = norm(text); return nt.includes(nq) || (words.length > 1 && words.every((w) => nt.includes(w))); };
  for (const q of queries) {
    const nq = norm(q), words = nq.split(" ");
    L.push(`── “${q}”`);
    let n = 0;
    for (const seg of tr?.segments ?? []) {
      if (!hit(seg.text, nq, words)) continue;
      const stem = words[0]!.slice(0, Math.max(3, words[0]!.length - 2));
      const at = seg.words.find((w) => norm(w.w).startsWith(stem))?.a ?? seg.a;
      L.push(`   said   ${fmt(at, v.long)}  “${seg.text.slice(0, 110)}”`); n++;
    }
    for (const fr of ocrIdx) if (hit(fr.text, nq, words)) { L.push(`   shown  ${fmt(fr.t, v.long)}  ${fr.text.slice(0, 110)}`); n++; }
    for (const nt of v.notes()) if (norm(nt.text).includes(nq)) { L.push(`   noted  ${nt.t !== undefined ? fmt(nt.t, v.long) : "   —  "}  ${nt.text.slice(0, 110)}`); n++; }
    if (!n) L.push(`   no match in speech${o.noOcr ? "" : ", on-screen text"} or notes. Try a synonym, or look at the segments the timeline suggests.`);
  }
  if (ocrIdx.length) L.push(`(on-screen text sampled every ${DEPTHS[s.depth].ocrEvery}s and at each shot; text between samples can be missed)`);
  return L.join("\n");
}

export function audio(src: string, o: { from?: string; to?: string; why?: string }): string {
  const v = resolveVideo(src);
  const au = v.audio();
  if (!au) return "this video has no sound";
  const tr = v.load<Parameters<typeof soundSpans>[1]>("transcript.json");
  const a = o.from !== undefined ? v.t(o.from)! : 0, b = o.to !== undefined ? v.t(o.to)! : v.duration;
  const vals = au.lufs.slice(Math.floor(a / BIN), Math.max(Math.floor(a / BIN) + 1, Math.ceil(b / BIN)));
  const width = Math.min(80, vals.length), loud = Math.max(...vals);
  const snd = soundSpans(au, tr);
  const list = (xs: Span[]) => (xs.length ? `${xs.slice(0, 20).map(([x, y]) => span(x, y, v.long)).join(", ")}${xs.length > 20 ? " …" : ""}` : "none");
  const hits = au.hits.filter((h) => h >= a && h <= b);
  v.log("audio", { frm: a, to: b, frames: 0, why: o.why });
  return [
    `LOUDNESS ${span(a, b, v.long)}  (-60 … -10 LUFS, ${((b - a) / Math.max(width, 1)).toFixed(1)}s per mark)`,
    `   ${sparkline(resample(vals, width), -60, -10)}`,
    `   loudest ${loud.toFixed(0)} LUFS at ${fmt(Math.floor(a / BIN) * BIN + vals.indexOf(loud) * BIN, v.long)} · mean ${mean(vals).toFixed(0)} LUFS`,
    tr ? `   speech: ${list(clipSpans(snd.speech, a, b))}` : "   speech: unknown until a transcript exists (npm run watch -- transcript)",
    `   music / sound without speech: ${list(clipSpans(snd.sound, a, b))}`,
    `   silence: ${list(clipSpans(snd.quiet, a, b))}`,
    `   hits (sudden loud): ${hits.length ? hits.slice(0, 30).map((h) => fmt(h, v.long)).join(", ") : "none"}`,
    "   (music vs speech is told apart by whether whisper heard words there, not by listening to the music itself)",
  ].join("\n");
}

export function motion(src: string, o: { from?: string; to?: string; why?: string }): string {
  const v = resolveVideo(src);
  const vis = v.visual();
  const a = o.from !== undefined ? v.t(o.from)! : 0, b = o.to !== undefined ? v.t(o.to)! : v.duration;
  const vals = vis.motion.slice(Math.floor(a / BIN), Math.max(Math.floor(a / BIN) + 1, Math.ceil(b / BIN)));
  const width = Math.min(80, vals.length);
  const cuts = vis.cuts.filter((c) => c >= a && c <= b);
  const fast = fastSpans(v.duration, vis).filter(([x, y]) => y > a && x < b), still = stillSpans(v.duration, vis).filter(([x, y]) => y > a && x < b);
  v.log("motion", { frm: a, to: b, frames: 0, why: o.why });
  return [
    `MOTION ${span(a, b, v.long)}  (${((b - a) / Math.max(width, 1)).toFixed(1)}s per mark, ▁ still … █ very fast)`,
    `   ${motionSpark(vals, width)}`,
    `   cuts (${cuts.length}): ${cuts.length ? `${cuts.slice(0, 40).map((c) => fmt(c, v.long)).join(", ")}${cuts.length > 40 ? " …" : ""}` : "none"}`,
    `   fast: ${fast.length ? `${fast.map(([x, y]) => span(x, y, v.long)).join(", ")}   → re-watch these at 8–12 fps` : "none"}`,
    `   still: ${still.length ? `${still.map(([x, y]) => span(x, y, v.long)).join(", ")}   → one frame each is enough` : "none"}`,
  ].join("\n");
}

export function scenes(src: string, o: { from?: string; to?: string; why?: string }): string {
  const v = resolveVideo(src);
  const vis = v.visual();
  const a = o.from !== undefined ? v.t(o.from)! : 0, b = o.to !== undefined ? v.t(o.to)! : v.duration;
  const shots = shotsOf(v, vis).filter(([x, y]) => y > a && x < b), lens = shots.map(([x, y]) => y - x);
  v.log("scenes", { frm: a, to: b, frames: 0, why: o.why });
  return [`${shots.length} shots in ${span(a, b, v.long)} · median ${median(lens).toFixed(2)}s · shortest ${Math.min(...lens).toFixed(2)}s · longest ${Math.max(...lens).toFixed(2)}s`,
    ...shots.slice(0, 200).map(([x, y], i) => `  #${String(i + 1).padEnd(3)} ${span(x, y, v.long)}  ${(y - x).toFixed(2).padStart(5)}s`), ...(shots.length > 200 ? ["  …"] : [])].join("\n");
}

export function note(src: string, text: string, at?: string): string {
  const v = resolveVideo(src);
  const notes = v.notes();
  notes.push({ ...(at ? { t: v.t(at) } : {}), text, on: new Date().toISOString().slice(0, 10) });
  v.save("notes.json", notes);
  v.log("note", { frm: notes.at(-1)!.t, text });
  return `noted (${notes.length} notes on this video)`;
}

export function notes(src: string, clear = false): string {
  const v = resolveVideo(src);
  if (clear) { v.save("notes.json", []); return "notes cleared"; }
  const ns = v.notes();
  return ns.length ? ns.map((n) => `${n.t !== undefined ? fmt(n.t, v.long) : "   —  "}  ${n.text}   (${n.on})`).join("\n") : "no notes yet";
}

export function observe(src: string, text: string, at?: string): string {
  const v = resolveVideo(src);
  v.log("observe", { frm: at ? v.t(at) : undefined, text });
  return "logged";
}

export function clip(src: string, o: { from: string; to: string; gif?: boolean; fps?: number; width?: number; out?: string }): string {
  const v = resolveVideo(src);
  const a = v.t(o.from)!, b = v.t(o.to)!;
  if (b <= a) throw new WatchError("--to must be after --from");
  const out = path.resolve(process.env.INIT_CWD ?? process.cwd(), o.out ?? `${path.parse(v.meta.name).name}-${safe(a)}-${safe(b)}.${o.gif ? "gif" : "mp4"}`);
  if (o.gif) {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", a.toFixed(3), "-to", b.toFixed(3), "-i", v.path, "-an", "-filter_complex",
      `fps=${o.fps ?? 12},scale=${o.width ?? 480}:-2:flags=lanczos,split[x][y];[x]palettegen=stats_mode=diff[p];[y][p]paletteuse=dither=bayer:bayer_scale=4`, out]);
  } else {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", a.toFixed(3), "-to", b.toFixed(3), "-i", v.path, "-c:v", "libx264", "-crf", "18", "-preset", "veryfast",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", ...(o.width ? ["-vf", `scale=${o.width}:-2`] : []), ...(v.meta.audio ? ["-c:a", "aac", "-b:a", "160k"] : ["-an"]), out]);
  }
  v.log("clip", { frm: a, to: b, file: out });
  return out;
}

export function budget(src: string, depth?: Depth): string {
  const v = resolveVideo(src);
  if (depth) { const s = v.session(); s.depth = depth; s.budget = DEPTHS[depth].budget; v.save("session.json", s); }
  const s = v.session();
  return `depth \`${s.depth}\` · ${s.used} of ${s.budget} frames looked at · ${Math.max(0, s.budget - s.used)} left`;
}

export const fetchVideos = (urls: string[]): string => urls.map(fetchUrl).join("\n");

/** Forget a video: everything watched, read and noted about it. A reference film is watched, tagged, then forgotten. */
export function forget(src: string): string {
  const v = resolveVideo(src);
  rmSync(v.dir, { recursive: true, force: true });
  return `forgot ${v.id} (${v.meta.name})`;
}

export function doctor(): string {
  const row = (name: string, ok: boolean, detail: string) => `  ${ok ? "✓" : "✗"} ${name.padEnd(14)} ${detail}`;
  const wb = ["whisper-cli", "whisper-cpp"].find((b) => which(b));
  const text = textReaderAvailable();
  return [`watch · cache ${watchHome()}`,
    row("ffmpeg", !!which("ffmpeg"), which("ffmpeg") ?? "required: brew install ffmpeg"),
    row("whisper.cpp", !!wb, wb ? which(wb)! : "for speech: brew install whisper-cpp (else hyperframes transcribe is used)"),
    row("yt-dlp", !!which("yt-dlp"), which("yt-dlp") ?? "for URLs: brew install yt-dlp"),
    row("text reader", !!text, text ?? "macOS: xcode-select --install (Vision); elsewhere: tesseract"),
  ].join("\n");
}

export function cacheList(): string {
  const root = path.join(watchHome(), "videos");
  if (!existsSync(root)) return "nothing watched yet";
  return readdirSync(root).map((id) => path.join(root, id, "meta.json")).filter(existsSync)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    .map((f) => { const m = JSON.parse(readFileSync(f, "utf8")) as Meta; const n = path.join(path.dirname(f), "notes.json"); return `${m.id}  ${fmt(m.duration).padStart(8)}  ${String(existsSync(n) ? (JSON.parse(readFileSync(n, "utf8")) as unknown[]).length : 0).padStart(2)} notes  ${m.title ?? m.name}`; })
    .join("\n");
}

export { REGIONS };
