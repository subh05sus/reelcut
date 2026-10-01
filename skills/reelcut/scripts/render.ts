import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { frameSizeFor, isOutputFormat } from "../../../src/core/constants.js";
import { buildProject, ProjectError, SFX_DEFAULT_VOLUME, type Kit, type ProjectBeat, type ProjectFile, type SfxCue } from "../../../src/render/project.js";
import { recordSignals, usedSignals, type BeatUse, type Choices } from "../../../src/learnings/index.js";
import { resolveCue } from "../../../src/library/sfx.js";
import { renderHyperframesProject } from "../../../src/render/hyperframes.js";
import { checkVideo, type VideoReport } from "../../../src/verify/checkVideo.js";
import { choosePosterTime } from "../../../src/render/poster.js";
import { LIBRARY_ASSET_DIR, acceptMoments, blobPath, libraryRefsIn, loadIndex, recordRun, recordUse, type LibraryAsset } from "../../../src/library/index.js";
import { expandFootage, linkOrCopy, type FootageUse, type HoldFrame } from "../../../src/render/footage.js";

/**
 * Turn a reel manifest into rendered clips and a master.
 *
 *   npm run render -- out/reel.json [--sfx] [--clips-only] [--master-only] [--only beat-03] [--quality looks]
 *
 * `reel.json`, written by the agent after composing:
 *
 *   {
 *     "format": "1:1", "fps": 30, "ground": "#ede9e3",
 *     "beats": [
 *       { "id": "beat-00", "durationSeconds": 6.67, "composition": "compositions/beat-00.html",
 *         "sfx": [{ "source": "sfx/whoosh.ogg", "at": 0.2 }, { "source": "library:3f2a9c1d5e7b8a40", "at": 1.4 }] }
 *     ]
 *   }
 *
 * Every clip is its own project and renders on its own, so a beat that fails — a layout collision,
 * a broken timeline — fails alone and is reported, while every other clip still ships. The master
 * is attempted regardless; if it fails, the passing clips are still delivered.
 *
 * Each rendered file then goes through the frame checker. A clip is only reported as done when it
 * rendered AND passed, because a file existing is not the same as a file being right.
 *
 * A composition uses a library asset by referring to `assets/library/<id>.<ext>`; those blobs are
 * copied into the project and the use is recorded. Recorded footage is placed with a
 * `data-footage="<asset>:<moment>"` placeholder, which is expanded here into the trimmed, retimed
 * `<video>` (see `src/render/footage.ts`); a big video blob is hardlinked rather than copied when it can be. Every render is recorded in `~/.reelcut/runs.json`
 * so the studio can list it.
 */

/** The design kit ships beside this script; a composition with `data-look` gets it injected. */
function loadKit(): Kit {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "kit");
  return { css: readFileSync(path.join(dir, "kit.css"), "utf8"), js: readFileSync(path.join(dir, "kit.js"), "utf8") };
}

interface ManifestBeat {
  id: string;
  durationSeconds: number;
  composition: string;
  /** The pattern this beat was adapted from, if any. The studio learns which patterns you keep. */
  pattern?: string;
  sfx?: { source: string; at: number; volume?: number; durationSeconds?: number }[];
}

interface Manifest {
  format?: string;
  fps?: number;
  ground?: string;
  /** Seconds into the master to use as the thumbnail. Chosen automatically when absent. */
  poster?: number;
  /** The brand or product the reel is about. Scopes what the studio learns from it. */
  brand?: string;
  /** What was chosen in Step 0, so the studio can learn from it. */
  direction?: { text?: string; motion?: string; look?: string };
  /** Ids of the learned rules Claude applied (from `npm run learnings -- brief`). */
  appliedLearnings?: string[];
  beats: ManifestBeat[];
}

interface Args {
  manifest: string;
  sfx: boolean;
  clips: boolean;
  master: boolean;
  /** Render only these beats' clips. */
  only: string[];
  quality: "draft" | "looks" | "delivery";
}

function parseArgs(argv: readonly string[]): Args | undefined {
  const cwd = process.env.INIT_CWD ?? process.cwd();
  let manifest: string | undefined;
  let sfx = false;
  let clips = true;
  let master = true;
  let quality: Args["quality"] = "looks";
  const only: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--sfx") sfx = true;
    else if (arg === "--clips-only") master = false;
    else if (arg === "--master-only") clips = false;
    else if (arg === "--only") only.push(...(argv[++i] ?? "").split(",").filter(Boolean));
    else if (arg === "--quality") quality = (argv[++i] ?? "looks") as Args["quality"];
    else if (!arg.startsWith("--")) manifest = path.resolve(cwd, arg);
  }
  return manifest ? { manifest, sfx, clips, master, only, quality } : undefined;
}

/** Sound effects need a duration on the element; probe it rather than trusting the manifest. */
function probeSeconds(file: string): number {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file], { encoding: "utf8" });
  const value = Number(out.trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error(`could not read a duration from ${file}`);
  return value;
}

function writeFiles(dir: string, files: readonly ProjectFile[]): void {
  rmSync(dir, { recursive: true, force: true });
  for (const file of files) {
    const target = path.join(dir, file.path);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.contents, "utf8");
  }
}

function copyAssets(dir: string, assets: readonly { source: string; target: string }[]): void {
  for (const asset of assets) {
    const target = path.join(dir, asset.target);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(asset.source, target);
  }
}

/** Copy the library blobs a project refers to into its `assets/library/`. */
function copyLibraryAssets(dir: string, assets: readonly LibraryAsset[]): void {
  for (const asset of assets) {
    const target = path.join(dir, LIBRARY_ASSET_DIR, path.basename(asset.file));
    if (asset.mediaType === "video") linkOrCopy(blobPath(asset), target, asset.bytes);
    else {
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(blobPath(asset), target);
    }
  }
}

/** The last frame of each moment that ends before its beat does, made once from the library blob. */
function makeHoldFrames(cacheDir: string, holds: readonly HoldFrame[], libraryById: ReadonlyMap<string, LibraryAsset>): void {
  mkdirSync(cacheDir, { recursive: true });
  for (const hold of holds) {
    const out = path.join(cacheDir, path.basename(hold.target));
    if (existsSync(out)) continue;
    const asset = libraryById.get(hold.assetId)!;
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", hold.at.toFixed(3), "-i", blobPath(asset), "-frames:v", "1", out]);
  }
}

function copyHoldFrames(dir: string, cacheDir: string, holds: readonly HoldFrame[]): void {
  for (const hold of holds) {
    const target = path.join(dir, hold.target);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(cacheDir, path.basename(hold.target)), target);
  }
}

/** Record the run for the studio. A library problem is reported, never allowed to fail a render. */
/** What a render knows about the choices behind it, for the studio to learn from. */
interface LearningContext {
  brand?: string;
  applied: string[];
  choices: Choices;
  beats: BeatUse[];
}

function recordForStudio(base: string, manifestPath: string, beatIds: readonly string[], outcomes: readonly Outcome[], libraryIds: readonly string[], learning: LearningContext): void {
  try {
    const ok = (id: string) => outcomes.some((o) => o.id === id && o.status === "ok");
    const run = recordRun({
      outDir: base,
      manifest: manifestPath,
      beats: [...beatIds],
      clips: beatIds.filter((id) => existsSync(path.join(base, "clips", `${id}.mp4`))).map((id) => `clips/${id}.mp4`),
      ...(ok("master") ? { master: "master.mp4" } : {}),
      ...(ok("master") && existsSync(path.join(base, "poster.jpg")) ? { poster: "poster.jpg" } : {}),
      libraryAssets: [...libraryIds],
      ...(learning.brand ? { brand: learning.brand } : {}),
      appliedLearnings: learning.applied,
    });
    recordUse(libraryIds, run.id);
    // What this reel was made with: the beats that rendered, and the Step 0 choices. Never fatal.
    try {
      const rendered = learning.beats.filter((b) => ok(b.id));
      if (rendered.length > 0) recordSignals(usedSignals({ reel: run.id, brand: learning.brand, choices: learning.choices, beats: rendered, at: new Date().toISOString() }));
    } catch (error) {
      console.warn(`  (not recorded for learning: ${error instanceof Error ? error.message : String(error)})`);
    }
    console.log(`  recorded as run ${run.id} — watch it with: npm run studio -- --reel "${base}"`);
  } catch (error) {
    console.warn(`  (not recorded for the studio: ${error instanceof Error ? error.message : String(error)})`);
  }
}

interface Outcome {
  id: string;
  status: "ok" | "render_failed" | "check_failed";
  detail?: string;
  file?: string;
  report?: VideoReport;
}

async function renderOne(id: string, projectDir: string, outFile: string, quality: Args["quality"], footage = false): Promise<Outcome> {
  // Recorded footage is pulled out as PNG: JPEG smears the thin text of a recorded interface.
  const result = await renderHyperframesProject({ projectDir, outputPath: outFile, quality, samples: 12, ...(footage ? { videoFrameFormat: "png" as const } : {}) });
  if (result.status !== "rendered" || !result.outputPath) {
    return { id, status: "render_failed", detail: result.error ?? "render failed" };
  }
  const report = checkVideo(result.outputPath, { samplesPerSecond: 4, footage });
  if (report.findings.length > 0) {
    return { id, status: "check_failed", file: result.outputPath, detail: report.findings.map((f) => `${f.at.toFixed(1)}s ${f.kind}`).join(", ") };
  }
  return { id, status: "ok", file: result.outputPath, report };
}

function frameCount(file: string): number {
  const out = execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "default=noprint_wrappers=1:nokey=1", file], { encoding: "utf8" });
  return Number(out.trim());
}

/**
 * Extract the chosen frame as poster.jpg, then bake it in as frame 0 of the master.
 *
 * Frame 0 is REPLACED, never added: an extra leading frame would shift every beat, every sound
 * effect and any voiceover laid against the cut by one frame. The frame count is checked before
 * and after, and the baked file is only kept if they match.
 */
function bakePoster(master: string, at: number, posterPath: string): { ok: boolean; detail: string } {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(at), "-i", master, "-frames:v", "1", "-q:v", "2", posterPath]);

  const baked = master.replace(/\.mp4$/, ".baked.mp4");
  execFileSync("ffmpeg", [
    "-v", "error", "-y",
    "-i", master,
    "-i", posterPath,
    "-filter_complex", "[0:v][1:v]overlay=0:0:enable='eq(n\,0)'[v]",
    "-map", "[v]", "-map", "0:a?",
    "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "copy",
    baked,
  ]);

  const before = frameCount(master);
  const after = frameCount(baked);
  if (before !== after) {
    rmSync(baked, { force: true });
    return { ok: false, detail: `frame count changed ${before} -> ${after}; kept the original` };
  }
  rmSync(master, { force: true });
  copyFileSync(baked, master);
  rmSync(baked, { force: true });
  return { ok: true, detail: `${after} frames, unchanged` };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error("usage: render.ts <reel.json> [--sfx] [--clips-only] [--master-only] [--only beat-03] [--quality looks]");
    process.exitCode = 2;
    return;
  }

  const manifest = JSON.parse(readFileSync(args.manifest, "utf8")) as Manifest;
  const base = path.dirname(args.manifest);
  const format = manifest.format ?? "1:1";
  if (!isOutputFormat(format)) throw new Error(`unknown format ${format}`);
  const { width, height } = frameSizeFor(format);
  const fps = manifest.fps ?? 30;

  const sfxLibraryIds = new Set<string>();
  const footageUses: FootageUse[] = [];
  const footageByBeat = new Map<string, { uses: FootageUse[]; holds: HoldFrame[] }>();
  let beats: ProjectBeat[];
  try {
    const index = loadIndex();
    beats = manifest.beats.map((b) => {
      const compositionPath = path.resolve(base, b.composition);
      if (!existsSync(compositionPath)) throw new Error(`${b.id}: composition not found at ${compositionPath}`);
      const sfx: SfxCue[] = (b.sfx ?? []).flatMap((cue): SfxCue[] => {
        const resolved = resolveCue(cue, b, { assets: index.assets, blobPath, exists: existsSync, resolveFile: (source) => path.resolve(base, source), probe: probeSeconds, defaultVolume: SFX_DEFAULT_VOLUME });
        if (!resolved) {
          console.warn(`  warning: ${b.id}: a cue at ${cue.at}s has no room before the beat ends; dropped`);
          return [];
        }
        for (const w of resolved.warnings) console.warn(`  warning: ${w}`);
        if (resolved.libraryId) sfxLibraryIds.add(resolved.libraryId);
        return [{ source: resolved.source, at: resolved.at, durationSeconds: resolved.durationSeconds, ...(resolved.volume === undefined ? {} : { volume: resolved.volume }) }];
      });
      // Recorded footage: placeholders become the trimmed, retimed <video>, or the beat is refused with the reason.
      const expanded = expandFootage(readFileSync(compositionPath, "utf8"), { assets: index.assets, format, beat: b });
      for (const w of expanded.warnings) console.warn(`  warning: ${w}`);
      if (expanded.uses.length > 0) {
        footageByBeat.set(b.id, { uses: expanded.uses, holds: expanded.holds });
        footageUses.push(...expanded.uses);
      }
      return { id: b.id, durationSeconds: b.durationSeconds, compositionHtml: expanded.html, sfx };
    });
  } catch (error) {
    if (error instanceof ProjectError) {
      console.error(`project refused: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const unknown = args.only.filter((id) => !beats.some((b) => b.id === id));
  if (unknown.length > 0) {
    console.error(`--only: no beat ${unknown.join(", ")} in ${args.manifest}`);
    process.exitCode = 2;
    return;
  }

  // Resolve library references up front: a composition naming an asset the library does not
  // have would render a broken image that no later check is guaranteed to notice.
  const refsByBeat = new Map(beats.map((b) => [b.id, libraryRefsIn(b.compositionHtml)]));
  const allRefs = [...new Set([...refsByBeat.values()].flat())];
  const libraryById = new Map<string, LibraryAsset>();
  if (allRefs.length > 0) {
    const index = loadIndex();
    for (const id of allRefs) {
      const asset = index.assets.find((a) => a.id === id);
      if (!asset || !existsSync(blobPath(asset))) {
        console.error(`a composition refers to ${LIBRARY_ASSET_DIR}/${id}, which is not in the library`);
        process.exitCode = 1;
        return;
      }
      if (asset.status !== "active") console.warn(`  warning: library asset ${id} (${asset.name}) is ${asset.status}${asset.supersededBy ? ` by ${asset.supersededBy}` : ""}`);
      libraryById.set(id, asset);
    }
  }
  const libraryFor = (ids: readonly string[]) => ids.map((id) => libraryById.get(id)!);

  let built;
  try {
    built = buildProject(beats, { width, height, fps, kit: loadKit(), ...(manifest.ground ? { ground: manifest.ground } : {}) }, args.sfx);
  } catch (error) {
    if (error instanceof ProjectError) {
      console.error(`project refused: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const projectRoot = path.join(base, "project");
  const clipsOut = path.join(base, "clips");
  const holdCache = path.join(projectRoot, ".holds");
  const allHolds = [...footageByBeat.values()].flatMap((f) => f.holds);
  if (allHolds.length > 0) makeHoldFrames(holdCache, allHolds, libraryById);
  const outcomes: Outcome[] = [];

  console.log(`${beats.length} beats, ${built.totalSeconds.toFixed(2)}s, ${width}x${height} @ ${fps}fps${args.sfx ? ", with sound effects" : ", silent"}`);

  if (args.clips) {
    for (const beat of beats) {
      if (args.only.length > 0 && !args.only.includes(beat.id)) continue;
      const dir = path.join(projectRoot, "clips", beat.id);
      writeFiles(dir, built.clips[beat.id]!);
      copyAssets(dir, built.assets);
      copyLibraryAssets(dir, libraryFor(refsByBeat.get(beat.id) ?? []));
      copyHoldFrames(dir, holdCache, footageByBeat.get(beat.id)?.holds ?? []);
      process.stdout.write(`  ${beat.id} … `);
      const outcome = await renderOne(beat.id, dir, path.join(clipsOut, `${beat.id}.mp4`), args.quality, footageByBeat.has(beat.id));
      outcomes.push(outcome);
      console.log(outcome.status === "ok" ? "ok" : `${outcome.status}: ${outcome.detail}`);
    }
  }

  if (args.master) {
    const dir = path.join(projectRoot, "master");
    writeFiles(dir, built.master);
    copyAssets(dir, built.assets);
    copyLibraryAssets(dir, libraryFor(allRefs));
    copyHoldFrames(dir, holdCache, allHolds);
    process.stdout.write("  master … ");
    const outcome = await renderOne("master", dir, path.join(base, "master.mp4"), args.quality, footageByBeat.size > 0);
    outcomes.push(outcome);
    console.log(outcome.status === "ok" ? "ok" : `${outcome.status}: ${outcome.detail}`);

    if (outcome.status === "ok" && outcome.file && outcome.report) {
      // The first beat is the hook, and the hook is the beat whose job is to say what this is.
      const first = built.placements[0]!;
      const choice = choosePosterTime(outcome.report, manifest.poster, { from: first.startSeconds, to: first.startSeconds + first.durationSeconds });
      const posterPath = path.join(base, "poster.jpg");
      const baked = bakePoster(outcome.file, choice.at, posterPath);
      console.log(`  poster … ${choice.at.toFixed(2)}s (${choice.reason})${baked.ok ? `, baked as frame 0 — ${baked.detail}` : ` — NOT baked: ${baked.detail}`}`);
    }
  }

  recordForStudio(base, args.manifest, beats.map((b) => b.id), outcomes, args.sfx ? [...new Set([...allRefs, ...sfxLibraryIds])] : allRefs, {
    ...(manifest.brand ? { brand: manifest.brand } : {}),
    applied: manifest.appliedLearnings ?? [],
    choices: {
      text: manifest.direction?.text,
      motion: manifest.direction?.motion,
      format,
      sound: args.sfx ? "effects" : "silent",
      look: manifest.direction?.look,
    },
    beats: manifest.beats.map((mb): BeatUse => {
      const html = beats.find((b) => b.id === mb.id)?.compositionHtml ?? "";
      return {
        id: mb.id,
        look: /\bdata-look\s*=\s*["']([a-z]+)["']/i.exec(html)?.[1]?.toLowerCase(),
        accent: /--accent\s*:\s*(#[0-9a-f]{3,8})\b/i.exec(html)?.[1],
        pattern: mb.pattern,
        motion: manifest.direction?.motion,
      };
    }),
  });

  // A moment that rendered has been used on purpose: from now on a fresh, exact match is used without asking.
  const rendered = new Set(outcomes.filter((o) => o.status === "ok").map((o) => o.id));
  const accepted = [...footageByBeat]
    .filter(([id]) => rendered.has(id) || rendered.has("master"))
    .flatMap(([, f]) => f.uses.map((u) => ({ assetId: u.assetId, momentId: u.momentId })));
  try {
    acceptMoments(accepted);
  } catch (error) {
    console.warn(`  (footage not marked as used: ${error instanceof Error ? error.message : String(error)})`);
  }
  if (footageUses.length > 0) {
    console.log("");
    console.log(`  footage: ${footageUses.map((u) => `"${u.label}" at ${u.at.toFixed(1)}s${u.fit.rate !== 1 ? ` (${u.fit.rate}x)` : ""}${u.fit.holdSeconds > 0 ? ` (last frame held ${u.fit.holdSeconds.toFixed(1)}s)` : ""}`).join("; ")}`);
  }

  const failed = outcomes.filter((o) => o.status !== "ok");
  console.log("");
  console.log(`${outcomes.length - failed.length} of ${outcomes.length} rendered and passed.`);
  if (failed.length > 0) {
    console.log("Not delivered:");
    for (const f of failed) console.log(`  ${f.id}  ${f.status}  ${f.detail ?? ""}`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
