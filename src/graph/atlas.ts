import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { listRuns } from "../library/runs.js";
import { blobPath, loadIndex, reelcutHome } from "../library/store.js";
import { loadReferences, referenceBlobPath } from "../references/index.js";
import { Img, writeJpeg } from "../watch/image.js";

/**
 * Graph atlases: the images a graph shows (up to ~500), shrunk to one cell size and packed into one JPEG, so a beat
 * loads one file and the browser decodes it once. A composition names a cell with `RC.graph`'s
 * `image: { atlas: "assets/graph/<sha>.jpg", x, y, w, h, aw, ah }` (printed by `npm run graph -- atlas`); the render
 * copies the atlas from ~/.reelcut/graph/ into the clip's project.
 *
 * Where the images come from is recorded beside the atlas: library assets, rendered reels, files, and reference
 * films. A reference film is someone else's work: its frames may sit in a reel's graph only when that reel opted in
 * (`"referenceThumbnails": true` in reel.json, asked in Step 0), and every one is listed for report.md.
 */

export const GRAPH_ASSET_DIR = "assets/graph";
export const graphHome = (): string => path.join(reelcutHome(), "graph");
export const atlasFile = (sha: string): string => path.join(graphHome(), `${sha}.jpg`);
const metaFile = (sha: string): string => path.join(graphHome(), `${sha}.json`);

export type SourceKind = "library" | "reel" | "reference" | "file";
export interface AtlasSource {
  kind: SourceKind;
  file: string;
  label: string;
  /** library asset id, run id, or reference id */
  id?: string;
  /** for a reel or a reference: the second of the film the frame was taken at */
  at?: number;
}
export interface AtlasCell { x: number; y: number; w: number; h: number; source: Omit<AtlasSource, "file"> }
export interface AtlasMeta { sha: string; atlas: string; aw: number; ah: number; cell: [number, number]; cols: number; cells: AtlasCell[]; createdAt: string; references: number }

export class AtlasError extends Error {}

const REF = /assets\/graph\/([0-9a-f]{16})\.jpg/g;
export function graphRefsIn(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(REF)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}

export function readAtlas(sha: string): AtlasMeta | undefined {
  try { return JSON.parse(readFileSync(metaFile(sha), "utf8")) as AtlasMeta; } catch { return undefined; }
}

/** One frame of a video at a time, as a JPEG in a temporary folder. */
function frameOf(video: string, at: number, dir: string, n: number): string {
  const out = path.join(dir, `f${n}.jpg`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", at.toFixed(2), "-i", video, "-frames:v", "1", "-q:v", "3", "-vf", "scale=480:-2", out]);
  return out;
}
function durationOf(video: string): number {
  try { return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video], { encoding: "utf8" }).trim()) || 0; } catch { return 0; }
}

export interface CollectOptions {
  /** library images with all of these tags (approved only unless `pending` is set) */
  tags?: string[];
  assets?: string[];
  /** rendered reels: their poster and measured frames, newest first */
  reels?: number;
  /** reference films: this many frames from each of the films included in the studio */
  references?: number;
  files?: string[];
  pending?: boolean;
  limit?: number;
}

/** The images for an atlas, in order, from the places asked for. Video frames are pulled into `work`. */
export function collectSources(o: CollectOptions, work: string): AtlasSource[] {
  const out: AtlasSource[] = [];
  const lib = loadIndex().assets.filter((a) => a.status === "active" && a.mediaType === "image" && (o.pending || a.review.state === "approved"));
  if (o.tags?.length) for (const a of lib.filter((x) => o.tags!.every((t) => x.tags.includes(t)))) out.push({ kind: "library", file: blobPath(a), label: a.name, id: a.id });
  for (const id of o.assets ?? []) {
    const a = loadIndex().assets.find((x) => x.id === id);
    if (!a || !existsSync(blobPath(a))) throw new AtlasError(`no library asset ${id}`);
    if (a.mediaType !== "image") throw new AtlasError(`${a.name} is a ${a.mediaType}, not an image`);
    out.push({ kind: "library", file: blobPath(a), label: a.name, id: a.id });
  }
  if (o.reels) {
    for (const run of listRuns().filter((r) => !r.missing).slice(0, o.reels)) {
      const poster = run.poster ? path.join(run.outDir, run.poster) : path.join(run.outDir, "poster.jpg");
      if (existsSync(poster)) out.push({ kind: "reel", file: poster, label: `${path.basename(run.outDir)} poster`, id: run.id });
      const m = path.join(run.outDir, "measure");
      if (existsSync(m)) for (const f of readdirSync(m).filter((x) => /\.(png|jpe?g)$/.test(x)).sort().slice(0, 12)) out.push({ kind: "reel", file: path.join(m, f), label: `${path.basename(run.outDir)} ${f.replace(/\.\w+$/, "")}`, id: run.id });
    }
  }
  if (o.references) {
    let n = 0;
    for (const r of loadReferences().references.filter((x) => x.include)) {
      const film = referenceBlobPath(r);
      if (!existsSync(film)) continue;
      const d = durationOf(film);
      if (!d) continue;
      for (let i = 0; i < o.references; i++) {
        const at = Math.round(((i + 0.5) * d / o.references) * 100) / 100;
        out.push({ kind: "reference", file: frameOf(film, at, work, n++), label: r.name, id: r.id, at });
      }
    }
  }
  for (const f of o.files ?? []) {
    if (!existsSync(f)) throw new AtlasError(`no such file ${f}`);
    out.push({ kind: "file", file: path.resolve(f), label: path.basename(f) });
  }
  return out.slice(0, o.limit ?? 500);
}

/** Pack the sources into one atlas (cells of `cell` pixels, each image cropped to fill). Cached by content. */
export function buildAtlas(sources: readonly AtlasSource[], cell: [number, number] = [96, 120]): AtlasMeta {
  if (!sources.length) throw new AtlasError("no images: say where they come from (--tags, --assets, --reels, --refs or files)");
  if (sources.length > 500) throw new AtlasError(`${sources.length} images is too many for one atlas (500 at most)`);
  const h = createHash("sha256").update(`${cell[0]}x${cell[1]}`);
  for (const s of sources) { const st = statSync(s.file); h.update(`${s.kind}|${s.id ?? ""}|${s.at ?? ""}|${s.file}|${st.size}|${st.mtimeMs}`); }
  const sha = h.digest("hex").slice(0, 16);
  const cached = readAtlas(sha);
  if (cached && existsSync(atlasFile(sha))) return cached;
  const cols = Math.ceil(Math.sqrt(sources.length * cell[1] / cell[0]));
  const rows = Math.ceil(sources.length / cols);
  const sheet = new Img(cols * cell[0], rows * cell[1], undefined, [24, 24, 24]);
  const cells: AtlasCell[] = [];
  sources.forEach((s, i) => {
    let img: Img;
    try {
      const ppm = execFileSync("ffmpeg", ["-v", "error", "-i", s.file, "-frames:v", "1", "-vf", `scale=${cell[0]}:${cell[1]}:force_original_aspect_ratio=increase,crop=${cell[0]}:${cell[1]}`, "-f", "image2pipe", "-c:v", "ppm", "-"], { maxBuffer: 64 << 20 });
      img = Img.fromPpm(ppm);
    } catch { throw new AtlasError(`could not read ${s.file} as an image`); }
    const x = (i % cols) * cell[0], y = Math.floor(i / cols) * cell[1];
    sheet.paste(img, x, y);
    const { file: _f, ...source } = s;
    cells.push({ x, y, w: cell[0], h: cell[1], source });
  });
  mkdirSync(graphHome(), { recursive: true });
  writeJpeg(sheet, atlasFile(sha), 3);
  const meta: AtlasMeta = { sha, atlas: `${GRAPH_ASSET_DIR}/${sha}.jpg`, aw: cols * cell[0], ah: rows * cell[1], cell, cols, cells, createdAt: new Date().toISOString(), references: sources.filter((s) => s.kind === "reference").length };
  writeFileSync(metaFile(sha), JSON.stringify(meta, null, 1));
  return meta;
}

export function withWork<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(os.tmpdir(), "rc-atlas-"));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** What a beat's atlases need before it may render: each exists, and reference frames only with the reel's opt-in. */
export function checkGraphRefs(html: string, manifest: { referenceThumbnails?: boolean }): string[] {
  const errors: string[] = [];
  for (const sha of graphRefsIn(html)) {
    const meta = readAtlas(sha);
    if (!meta || !existsSync(atlasFile(sha))) { errors.push(`refers to ${GRAPH_ASSET_DIR}/${sha}.jpg, which is not in ~/.reelcut/graph (npm run graph -- atlas)`); continue; }
    if (meta.references > 0 && manifest.referenceThumbnails !== true) errors.push(`its graph atlas ${sha} holds ${meta.references} reference-film frame${meta.references === 1 ? "" : "s"}, but the reel did not opt in ("referenceThumbnails": true in reel.json, asked in Step 0)`);
  }
  return errors;
}

export function copyGraphAssets(dir: string, shas: readonly string[]): void {
  for (const sha of shas) {
    const target = path.join(dir, GRAPH_ASSET_DIR, `${sha}.jpg`);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(atlasFile(sha), target);
  }
}

/** Every image a reel's graphs show, by beat, as Markdown for report.md. Reference frames are named with their moment. */
export function graphProvenance(beats: readonly { id: string; html: string }[]): string {
  const lines: string[] = [];
  for (const b of beats) {
    for (const sha of graphRefsIn(b.html)) {
      const meta = readAtlas(sha);
      if (!meta) continue;
      const by = new Map<string, string[]>();
      for (const c of meta.cells) {
        const key = c.source.kind;
        const what = c.source.kind === "reference" ? `${c.source.label} at ${c.source.at?.toFixed(1)}s` : c.source.kind === "library" ? `${c.source.label} (${c.source.id})` : c.source.label;
        by.set(key, [...(by.get(key) ?? []), what]);
      }
      lines.push(`- ${b.id}, atlas ${sha}: ${meta.cells.length} images`);
      for (const [k, v] of by) lines.push(`  - ${k === "reference" ? "**reference films (someone else's work, shown with the reel's opt-in)**" : k}: ${v.join("; ")}`);
    }
  }
  return lines.length ? `## Graph images\n\n${lines.join("\n")}\n` : "";
}
