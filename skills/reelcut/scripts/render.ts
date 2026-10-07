import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { frameSizeFor, isOutputFormat } from "../../../src/core/constants.js";
import { assertComposition, buildProject, ProjectError, SFX_DEFAULT_VOLUME, type ProjectBeat, type ProjectFile, type SfxCue } from "../../../src/render/project.js";
import { loadKit, PROJECT_FONT_DIR } from "../../../src/render/kit.js";
import { recordPatternUses } from "../../../src/patterns/mine.js";
import { mixMusic, resolveMusic, type MusicSpec, type ResolvedMusic } from "../../../src/render/music.js";
import { durationsFromCuts, planMusic, type MusicPlan } from "../../../src/library/music.js";
import { applyDefaultPairing, fontFilesFor, pairingById, pairingIn, PAIRINGS } from "../../../src/fonts/index.js";
import { bakePoster, contactSheet, joinClips, planJobs, runPool, SHEET_AT, stackSheets } from "../../../src/render/assemble.js";
import { recordSignals, usedSignals, type BeatUse, type Choices } from "../../../src/learnings/index.js";
import { resolveCue } from "../../../src/library/sfx.js";
import { renderHyperframesProject } from "../../../src/render/hyperframes.js";
import { checkVideo, type VideoReport } from "../../../src/verify/checkVideo.js";
import { choosePosterTime } from "../../../src/render/poster.js";
import { LIBRARY_ASSET_DIR, loadSfxPack, acceptMoments, blobPath, detectKey, ensureKeyed, isKeyed, keyedBlob, libraryRefsIn, loadIndex, recordRun, recordUse, wantsKey, type LibraryAsset } from "../../../src/library/index.js";
import { expandFootage, linkOrCopy, type FootageUse, type HoldFrame } from "../../../src/render/footage.js";

/**
 * Turn a reel manifest into rendered clips and a master.
 *
 *   npm run render -- out/reel.json [--preflight] [--sfx] [--clips-only] [--master-only] [--only beat-03] [--jobs N] [--quality looks]
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
 * Every clip is its own project and renders on its own, several at a time (`--jobs`, or a number worked
 * out from the machine), so a beat that fails — a layout collision, a broken timeline — fails alone and is
 * reported, while every other clip still ships. A beat that cannot render yet (footage that does not fit,
 * a missing asset, a mismatched id) is listed as blocked and the rest render around it; `--preflight` lists
 * every blocker in seconds without rendering anything. The master is the passing clips joined, never a
 * second render; it is joined once every beat has a passing clip.
 *
 * Each rendered clip gets a contact sheet in `contact/`, and the reel one in `contact.jpg`: look at those
 * rather than opening the compositions in a browser again.
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
  /** The type pairing every beat uses unless it sets `data-type` itself (`npm run fonts -- pairings`). */
  type?: string;
  /** What happened to each beat that could have been generated with Higgsfield. Written by `npm run generate -- record`; the render leaves it as it is. */
  generation?: { beat: string; outcome: string; reason?: string; assetId?: string }[];
  beats: ManifestBeat[];
  /** A music bed under the master: `{ "source": "library:<id>", "sync": "fit" | "snap" }` (see `npm run music`). */
  music?: MusicSpec;
}

interface Args {
  manifest: string;
  sfx: boolean;
  clips: boolean;
  master: boolean;
  /** Render only these beats' clips. */
  only: string[];
  quality: "draft" | "looks" | "delivery";
  /** List what blocks each beat and stop, without rendering. */
  preflight: boolean;
  /** Clips rendered at once; left out, worked out from the machine. */
  jobs?: number;
}

function parseArgs(argv: readonly string[]): Args | undefined {
  const cwd = process.env.INIT_CWD ?? process.cwd();
  let manifest: string | undefined;
  let sfx = false;
  let clips = true;
  let master = true;
  let quality: Args["quality"] = "looks";
  let preflight = false;
  let jobs: number | undefined;
  const only: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--sfx") sfx = true;
    else if (arg === "--clips-only") master = false;
    else if (arg === "--master-only") clips = false;
    else if (arg === "--only") only.push(...(argv[++i] ?? "").split(",").filter(Boolean));
    else if (arg === "--quality") quality = (argv[++i] ?? "looks") as Args["quality"];
    else if (arg === "--preflight") preflight = true;
    else if (arg === "--jobs") jobs = Number(argv[++i]) || undefined;
    else if (!arg.startsWith("--")) manifest = path.resolve(cwd, arg);
  }
  return manifest ? { manifest, sfx, clips, master, only, quality, preflight, ...(jobs ? { jobs } : {}) } : undefined;
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
    if (asset.mediaType === "video") {
      // A green-screen recording is placed as its transparent copy; the original is not needed in the project.
      const keyed = isKeyed(asset) ? keyedBlob(asset) : undefined;
      if (keyed) {
        const keyedTarget = path.join(dir, LIBRARY_ASSET_DIR, `${asset.id}-key.webm`);
        mkdirSync(path.dirname(keyedTarget), { recursive: true });
        copyFileSync(keyed, keyedTarget);
      } else linkOrCopy(blobPath(asset), target, asset.bytes);
    } else {
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(blobPath(asset), target);
    }
  }
}

/**
 * The last frame of each moment that ends before its beat does, made once from the library blob (or from the
 * keyed copy, decoded with the VP9 decoder that keeps transparency). A recording's container can be longer than
 * its video stream, and then a seek to the very end writes nothing and exits 0; so the file is looked for, and the
 * frame is taken a little earlier until there is one. Returns the targets that could not be made.
 */
function makeHoldFrames(cacheDir: string, holds: readonly HoldFrame[], libraryById: ReadonlyMap<string, LibraryAsset>): Set<string> {
  mkdirSync(cacheDir, { recursive: true });
  const failed = new Set<string>();
  for (const hold of holds) {
    const out = path.join(cacheDir, path.basename(hold.target));
    if (existsSync(out)) continue;
    const asset = libraryById.get(hold.assetId)!;
    const source = hold.keyed ? keyedBlob(asset)! : blobPath(asset);
    for (const back of [0, 0.1, 0.25, 0.5]) {
      try {
        execFileSync("ffmpeg", ["-v", "error", "-y", ...(hold.keyed ? ["-c:v", "libvpx-vp9"] : []), "-ss", Math.max(0, hold.at - back).toFixed(3), "-i", source, "-frames:v", "1", ...(hold.keyed ? ["-pix_fmt", "rgba"] : []), out], { stdio: "pipe" });
      } catch {
        // try a little earlier
      }
      if (existsSync(out)) break;
    }
    if (!existsSync(out)) failed.add(hold.target);
  }
  return failed;
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
  status: "ok" | "render_failed" | "check_failed" | "blocked";
  detail?: string;
  file?: string;
  report?: VideoReport;
  seconds?: number;
}

async function renderOne(id: string, projectDir: string, outFile: string, quality: Args["quality"], footage: boolean, workers: number | undefined, sheetDir: string): Promise<Outcome> {
  const started = Date.now();
  // Recorded footage is pulled out as PNG: JPEG smears the thin text of a recorded interface.
  const result = await renderHyperframesProject({ projectDir, outputPath: outFile, quality, samples: 12, ...(footage ? { videoFrameFormat: "png" as const } : {}), ...(workers ? { workers } : {}) });
  const seconds = (Date.now() - started) / 1000;
  if (result.status !== "rendered" || !result.outputPath) {
    return { id, status: "render_failed", detail: result.error ?? "render failed", seconds };
  }
  const report = checkVideo(result.outputPath, { samplesPerSecond: 4, footage });
  // The contact sheet is what to look at instead of opening the composition in a browser again.
  try {
    await contactSheet(result.outputPath, path.join(sheetDir, `${id}.jpg`));
  } catch (error) {
    console.warn(`  (${id}: no contact sheet: ${error instanceof Error ? error.message : String(error)})`);
  }
  if (report.findings.length > 0) {
    return { id, status: "check_failed", file: result.outputPath, detail: report.findings.map((f) => `${f.at.toFixed(1)}s ${f.kind}`).join(", "), seconds };
  }
  return { id, status: "ok", file: result.outputPath, report, seconds };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error("usage: render.ts <reel.json> [--preflight] [--sfx] [--clips-only] [--master-only] [--only beat-03] [--jobs N] [--quality looks]");
    process.exitCode = 2;
    return;
  }

  const manifest = JSON.parse(readFileSync(args.manifest, "utf8")) as Manifest;
  const base = path.dirname(args.manifest);
  const format = manifest.format ?? "1:1";
  if (!isOutputFormat(format)) throw new Error(`unknown format ${format}`);
  const { width, height } = frameSizeFor(format);
  const fps = manifest.fps ?? 30;
  // The music bed is planned before anything is placed: in snap mode the cuts move onto its beats, which changes
  // the beats' lengths, and so every clip's.
  let music: { resolved: ResolvedMusic; plan: MusicPlan; length: number } | undefined;
  if (manifest.music) {
    try {
      const resolved = resolveMusic(manifest.music, base, loadIndex().assets, blobPath);
      const durations = manifest.beats.map((b) => b.durationSeconds);
      const length = durations.reduce((a, b) => a + b, 0);
      const cuts = durations.slice(0, -1).map((_, i) => durations.slice(0, i + 1).reduce((a, b) => a + b, 0));
      const sync = manifest.music.sync ?? "fit";
      const plan = planMusic(resolved.analysis, cuts, length, sync, manifest.music.start !== undefined ? { start: manifest.music.start } : {});
      if (sync === "snap") durationsFromCuts(plan.cuts, length).forEach((d, i) => { manifest.beats[i]!.durationSeconds = d; });
      music = { resolved, plan, length };
      const movedBy = plan.moved.filter((m) => m !== 0);
      console.log(`  music … "${resolved.name}" ${resolved.analysis.bpm} BPM from ${plan.offset.toFixed(2)}s · ${plan.onBeat} of ${cuts.length} cuts on a beat${sync === "snap" ? ` (${movedBy.length} moved, at most ${Math.max(0, ...movedBy.map(Math.abs)).toFixed(2)}s)` : ""}${plan.short ? " · the track is shorter than the reel and fades out early" : ""}${resolved.analysis.confidence < 0.25 ? " · its beat is not clear, so the grid is a guess" : ""}`);
      const prov = resolved.asset?.provenance;
      if (resolved.asset && prov && prov.source !== "user" && prov.source !== "generated" && !prov.licence) console.warn(`  warning: music "${resolved.name}" has no licence recorded: add it before posting (npm run music -- add … --licence)`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      return;
    }
  }

  const kit = loadKit("project");
  const projectOptions = { width, height, fps, kit, ...(manifest.ground ? { ground: manifest.ground } : {}) };
  if (manifest.type && !pairingById(manifest.type)) {
    console.error(`reel.json: no type pairing "${manifest.type}" (one of ${PAIRINGS.map((p) => p.id).join(", ")})`);
    process.exitCode = 1;
    return;
  }

  // Everything that can stop a beat is collected per beat, not thrown at the first one: one beat
  // waiting on something must not hold up the other thirteen, and --preflight lists them all at once.
  const blocked = new Map<string, string[]>();
  const block = (id: string, reason: string) => blocked.set(id, [...(blocked.get(id) ?? []), reason]);
  const own = (id: string, message: string) => message.replace(new RegExp(`^${id}: `), "");

  // Recordings on a green screen are keyed first, once: the copy is saved in the library and reused. A recording
  // added before green-screen removal existed is looked at now.
  const wantedIds = new Set<string>();
  for (const b of manifest.beats) {
    const file = path.resolve(base, b.composition);
    if (!existsSync(file)) continue;
    for (const m of readFileSync(file, "utf8").matchAll(/data-footage\s*=\s*["']([0-9a-f]{16}):/g)) wantedIds.add(m[1]!);
  }
  const keyingErrors = new Map<string, string>();
  for (const id of wantedIds) {
    const before = loadIndex().assets.find((a) => a.id === id);
    if (!before || before.mediaType !== "video") continue;
    try {
      const looked = detectKey(id);
      if (wantsKey(looked) && !isKeyed(looked)) await ensureKeyed(id, { log: (m) => console.log(`  ${m}`) });
    } catch (error) {
      keyingErrors.set(id, error instanceof Error ? error.message : String(error));
      console.warn(`  warning: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const sfxLibraryIds = new Set<string>();
  const sfxPack = loadSfxPack();
  const footageUses: FootageUse[] = [];
  const footageByBeat = new Map<string, { uses: FootageUse[]; holds: HoldFrame[] }>();
  const index = loadIndex();
  const beats: ProjectBeat[] = manifest.beats.map((b) => {
    const compositionPath = path.resolve(base, b.composition);
    if (!existsSync(compositionPath)) {
      block(b.id, `composition not found at ${compositionPath}`);
      return { id: b.id, durationSeconds: b.durationSeconds, compositionHtml: "", sfx: [] };
    }
    const html = applyDefaultPairing(readFileSync(compositionPath, "utf8"), manifest.type);
    let sfx: SfxCue[] = [];
    if (args.sfx) {
      try {
        sfx = (b.sfx ?? []).flatMap((cue): SfxCue[] => {
          const resolved = resolveCue(cue, b, { assets: index.assets, blobPath, exists: existsSync, resolveFile: (source) => path.resolve(base, source), probe: probeSeconds, defaultVolume: SFX_DEFAULT_VOLUME, ...(sfxPack ? { pack: sfxPack } : {}) });
          if (!resolved) {
            console.warn(`  warning: ${b.id}: a cue at ${cue.at}s has no room before the beat ends; dropped`);
            return [];
          }
          for (const w of resolved.warnings) console.warn(`  warning: ${w}`);
          if (resolved.libraryId) sfxLibraryIds.add(resolved.libraryId);
          return [{ source: resolved.source, at: resolved.at, durationSeconds: resolved.durationSeconds, ...(resolved.volume === undefined ? {} : { volume: resolved.volume }) }];
        });
      } catch (error) {
        block(b.id, own(b.id, error instanceof Error ? error.message : String(error)));
      }
    }
    try {
      // Recorded footage: placeholders become the trimmed, retimed <video>, or the beat is blocked with the reason.
      const expanded = expandFootage(html, { assets: index.assets, format, beat: b });
      for (const w of expanded.warnings) console.warn(`  warning: ${w}`);
      if (expanded.uses.length > 0) {
        footageByBeat.set(b.id, { uses: expanded.uses, holds: expanded.holds });
        footageUses.push(...expanded.uses);
      }
      return { id: b.id, durationSeconds: b.durationSeconds, compositionHtml: expanded.html, sfx };
    } catch (error) {
      if (!(error instanceof ProjectError)) throw error;
      block(b.id, own(b.id, error.message));
      return { id: b.id, durationSeconds: b.durationSeconds, compositionHtml: html, sfx };
    }
  });

  const unknown = args.only.filter((id) => !beats.some((b) => b.id === id));
  if (unknown.length > 0) {
    console.error(`--only: no beat ${unknown.join(", ")} in ${args.manifest}`);
    process.exitCode = 2;
    return;
  }

  // Library references, per beat: a composition naming an asset the library does not have would
  // render a broken image that no later check is guaranteed to notice.
  const refsByBeat = new Map(beats.map((b) => [b.id, libraryRefsIn(b.compositionHtml)]));
  const libraryById = new Map<string, LibraryAsset>();
  for (const [beatId, ids] of refsByBeat) {
    for (const id of ids) {
      const asset = index.assets.find((a) => a.id === id);
      if (!asset || !existsSync(blobPath(asset))) {
        block(beatId, `refers to ${LIBRARY_ASSET_DIR}/${id}, which is not in the library`);
        continue;
      }
      if (asset.status !== "active" && !libraryById.has(id)) console.warn(`  warning: library asset ${id} (${asset.name}) is ${asset.status}${asset.supersededBy ? ` by ${asset.supersededBy}` : ""}`);
      libraryById.set(id, asset);
    }
  }
  const allRefs = [...libraryById.keys()];
  const libraryFor = (ids: readonly string[]) => ids.flatMap((id) => (libraryById.has(id) ? [libraryById.get(id)!] : []));

  // The composition contract (ids, template, size) per beat, so a typo blocks its own beat only.
  for (const beat of beats) {
    if (blocked.has(beat.id)) continue;
    try {
      assertComposition(beat, projectOptions);
    } catch (error) {
      if (!(error instanceof ProjectError)) throw error;
      block(beat.id, own(beat.id, error.message));
    }
  }

  const holdCache = path.join(base, "project", ".holds");
  const holdsFailed = makeHoldFrames(holdCache, [...footageByBeat.entries()].filter(([id]) => !blocked.has(id)).flatMap(([, f]) => f.holds), libraryById);
  for (const [beatId, f] of footageByBeat) {
    const bad = f.holds.filter((h) => holdsFailed.has(h.target));
    if (bad.length > 0) block(beatId, `could not make the held last frame of ${bad.map((h) => h.assetId).join(", ")}: the recording ends before its container does and no earlier frame could be read`);
  }

  let built;
  try {
    built = buildProject(beats, projectOptions, args.sfx, new Set(blocked.keys()));
  } catch (error) {
    if (error instanceof ProjectError) {
      console.error(`project refused: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const plan = planJobs(undefined, args.jobs);
  const wanted = beats.filter((b) => args.only.length === 0 || args.only.includes(b.id));
  console.log(`${beats.length} beats, ${built.totalSeconds.toFixed(2)}s, ${width}x${height} @ ${fps}fps${args.sfx ? ", with sound effects" : ", silent"}${args.clips && !args.preflight ? ` · ${plan.jobs} clip${plan.jobs === 1 ? "" : "s"} at a time, ${plan.workersPerJob} worker${plan.workersPerJob === 1 ? "" : "s"} each` : ""}`);

  if (args.preflight) {
    console.log("");
    for (const b of wanted) {
      const reasons = blocked.get(b.id);
      const f = footageByBeat.get(b.id);
      console.log(reasons ? `  ${b.id}  BLOCKED\n${reasons.map((r) => `      - ${r}`).join("\n")}` : `  ${b.id}  ready${f ? `  (footage: ${f.uses.map((u) => `"${u.label}"`).join(", ")})` : ""}`);
    }
    const n = wanted.filter((b) => blocked.has(b.id)).length;
    console.log("");
    console.log(n === 0 ? `All ${wanted.length} beats are ready to render.` : `${n} of ${wanted.length} beats are blocked. A render still renders the other ${wanted.length - n} and lists these.`);
    if (n > 0) process.exitCode = 1;
    return;
  }

  const projectRoot = path.join(base, "project");
  const clipsOut = path.join(base, "clips");
  const sheetDir = path.join(base, "contact");
  const outcomes: Outcome[] = [];
  const started = Date.now();

  if (args.clips) {
    for (const b of wanted) {
      const reasons = blocked.get(b.id);
      if (!reasons) continue;
      outcomes.push({ id: b.id, status: "blocked", detail: reasons.join("; ") });
      console.log(`  ${b.id} … blocked: ${reasons.join("; ")}`);
    }
    const toRender = wanted.filter((b) => !blocked.has(b.id));
    const rendered = await runPool(toRender, plan.jobs, async (beat) => {
      const dir = path.join(projectRoot, "clips", beat.id);
      writeFiles(dir, built.clips[beat.id]!);
      copyAssets(dir, built.assets);
      copyLibraryAssets(dir, libraryFor(refsByBeat.get(beat.id) ?? []));
      copyHoldFrames(dir, holdCache, footageByBeat.get(beat.id)?.holds ?? []);
      // Only the fonts this beat uses, from the bundled library: nothing is fetched while it renders.
      if (kit.fonts) for (const file of fontFilesFor(beat.compositionHtml, kit.fonts.lib)) {
        const target = path.join(dir, PROJECT_FONT_DIR, file);
        mkdirSync(path.dirname(target), { recursive: true });
        copyFileSync(path.join(kit.fonts.lib.dir, file), target);
      }
      const outcome = await renderOne(beat.id, dir, path.join(clipsOut, `${beat.id}.mp4`), args.quality, footageByBeat.has(beat.id), plan.jobs > 1 ? plan.workersPerJob : undefined, sheetDir);
      console.log(`  ${beat.id} … ${outcome.status === "ok" ? "ok" : `${outcome.status}: ${outcome.detail}`}${outcome.seconds ? `  (${outcome.seconds.toFixed(1)}s)` : ""}`);
      return outcome;
    });
    outcomes.push(...rendered);
  }

  if (args.master) {
    // The master is the clips joined. Every beat needs a passing clip: from this run, or on disk from an earlier one.
    const thisRun = new Map(outcomes.map((o) => [o.id, o]));
    const missing = built.placements.filter((p) => {
      const o = thisRun.get(p.id);
      return o ? o.status !== "ok" : blocked.has(p.id) || !existsSync(path.join(clipsOut, `${p.id}.mp4`));
    });
    if (missing.length > 0) {
      const detail = `waiting on ${missing.map((p) => p.id).join(", ")}: render ${missing.length === 1 ? "it" : "them"} with --only, and the master is joined then`;
      outcomes.push({ id: "master", status: "blocked", detail });
      console.log(`  master … not joined, ${detail}`);
    } else {
      process.stdout.write("  master … ");
      const masterFile = path.join(base, "master.mp4");
      const joined = joinClips(built.placements.map((p) => ({ file: path.join(clipsOut, `${p.id}.mp4`), frames: p.endFrame - p.startFrame, fps })), masterFile, path.join(projectRoot, ".join"));
      if (!joined.ok) {
        outcomes.push({ id: "master", status: "render_failed", detail: joined.detail });
        console.log(`join failed: ${joined.detail}`);
      } else {
        console.log(`joined (${joined.detail})`);
        if (music) {
          const mixed = mixMusic(masterFile, music.resolved, music.plan, built.totalSeconds, manifest.music?.volume);
          console.log(`  music … mixed under the master at ×${mixed.gain}, and alone in ${path.basename(mixed.stem)}`);
        }
        const report = checkVideo(masterFile, { samplesPerSecond: 4, footage: footageByBeat.size > 0 });
        outcomes.push({ id: "master", status: "ok", file: masterFile, report });
        // The first beat is the hook, and the hook is the beat whose job is to say what this is.
        const first = built.placements[0]!;
        const choice = choosePosterTime(report, manifest.poster, { from: first.startSeconds, to: first.startSeconds + first.durationSeconds });
        const posterPath = path.join(base, "poster.jpg");
        const baked = bakePoster(masterFile, choice.at, posterPath);
        console.log(`  poster … ${choice.at.toFixed(2)}s (${choice.reason})${baked.ok ? `, baked as frame 0 — ${baked.detail}` : ` — NOT baked: ${baked.detail}`}`);
      }
    }
  }

  // One sheet for the whole reel, a row per beat, from whatever clip sheets exist.
  const rows = beats.map((b) => path.join(sheetDir, `${b.id}.jpg`)).filter((f) => existsSync(f));
  try {
    const sheet = stackSheets(rows, path.join(base, "contact.jpg"));
    if (sheet) console.log(`  contact sheet … ${sheet} (a row per beat, frames at ${SHEET_AT.map((f) => `${Math.round(f * 100)}%`).join(", ")})`);
  } catch (error) {
    console.warn(`  (no reel contact sheet: ${error instanceof Error ? error.message : String(error)})`);
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
      type: manifest.type,
    },
    beats: manifest.beats.map((mb): BeatUse => {
      const html = beats.find((b) => b.id === mb.id)?.compositionHtml ?? "";
      return {
        id: mb.id,
        look: /\bdata-look\s*=\s*["']([a-z]+)["']/i.exec(html)?.[1]?.toLowerCase(),
        accent: /--accent\s*:\s*(#[0-9a-f]{3,8})\b/i.exec(html)?.[1],
        pattern: mb.pattern,
        motion: manifest.direction?.motion,
        type: pairingIn(html)?.id,
      };
    }),
  });

  const renderedBeat = (id: string) => outcomes.some((o) => o.id === id && o.status === "ok");
  // Your patterns that rendered into this reel: each counts a use, which ranks it in Step 4.
  try {
    recordPatternUses(manifest.beats.filter((b) => b.pattern?.startsWith("mine-") && renderedBeat(b.id)).map((b) => b.pattern!));
  } catch (error) {
    console.warn(`  (pattern uses not recorded: ${error instanceof Error ? error.message : String(error)})`);
  }

  // A moment that rendered has been used on purpose: from now on a fresh, exact match is used without asking.
  const renderedIds = new Set(outcomes.filter((o) => o.status === "ok").map((o) => o.id));
  const accepted = [...footageByBeat]
    .filter(([id]) => renderedIds.has(id))
    .flatMap(([, f]) => f.uses.map((u) => ({ assetId: u.assetId, momentId: u.momentId })));
  try {
    acceptMoments(accepted);
  } catch (error) {
    console.warn(`  (footage not marked as used: ${error instanceof Error ? error.message : String(error)})`);
  }
  if (footageUses.length > 0) {
    console.log("");
    console.log(`  footage: ${footageUses.map((u) => `"${u.label}" at ${u.at.toFixed(1)}s${u.fit.rate !== 1 ? ` (${u.fit.rate}x)` : ""}${u.fit.holdSeconds > 0 ? ` (last frame held ${u.fit.holdSeconds.toFixed(1)}s)` : ""}${u.generated ? " [AI-generated]" : ""}`).join("; ")}`);
  }

  const failed = outcomes.filter((o) => o.status !== "ok");
  console.log("");
  console.log(`${outcomes.length - failed.length} of ${outcomes.length} rendered and passed, in ${((Date.now() - started) / 1000).toFixed(0)}s.`);
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
