import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { frameSizeFor, isOutputFormat } from "../../../src/core/constants.js";
import { buildProject, ProjectError, type ProjectBeat, type ProjectFile, type SfxCue } from "../../../src/render/project.js";
import { renderHyperframesProject } from "../../../src/render/hyperframes.js";
import { checkVideo } from "../../../src/verify/checkVideo.js";

/**
 * Turn a reel manifest into rendered clips and a master.
 *
 *   npm run render -- out/reel.json [--sfx] [--clips-only] [--master-only] [--quality looks]
 *
 * `reel.json`, written by the agent after composing:
 *
 *   {
 *     "format": "1:1", "fps": 30, "ground": "#ede9e3",
 *     "beats": [
 *       { "id": "beat-00", "durationSeconds": 6.67, "composition": "compositions/beat-00.html",
 *         "sfx": [{ "source": "sfx/whoosh.ogg", "at": 0.2 }] }
 *     ]
 *   }
 *
 * Every clip is its own project and renders on its own, so a beat that fails — a layout collision,
 * a broken timeline — fails alone and is reported, while every other clip still ships. The master
 * is attempted regardless; if it fails, the passing clips are still delivered.
 *
 * Each rendered file then goes through the frame checker. A clip is only reported as done when it
 * rendered AND passed, because a file existing is not the same as a file being right.
 */

interface ManifestBeat {
  id: string;
  durationSeconds: number;
  composition: string;
  sfx?: { source: string; at: number; volume?: number; durationSeconds?: number }[];
}

interface Manifest {
  format?: string;
  fps?: number;
  ground?: string;
  beats: ManifestBeat[];
}

interface Args {
  manifest: string;
  sfx: boolean;
  clips: boolean;
  master: boolean;
  quality: "draft" | "looks" | "delivery";
}

function parseArgs(argv: readonly string[]): Args | undefined {
  const cwd = process.env.INIT_CWD ?? process.cwd();
  let manifest: string | undefined;
  let sfx = false;
  let clips = true;
  let master = true;
  let quality: Args["quality"] = "looks";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--sfx") sfx = true;
    else if (arg === "--clips-only") master = false;
    else if (arg === "--master-only") clips = false;
    else if (arg === "--quality") quality = (argv[++i] ?? "looks") as Args["quality"];
    else if (!arg.startsWith("--")) manifest = path.resolve(cwd, arg);
  }
  return manifest ? { manifest, sfx, clips, master, quality } : undefined;
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

interface Outcome {
  id: string;
  status: "ok" | "render_failed" | "check_failed";
  detail?: string;
  file?: string;
}

async function renderOne(id: string, projectDir: string, outFile: string, quality: Args["quality"]): Promise<Outcome> {
  const result = await renderHyperframesProject({ projectDir, outputPath: outFile, quality, samples: 12 });
  if (result.status !== "rendered" || !result.outputPath) {
    return { id, status: "render_failed", detail: result.error ?? "render failed" };
  }
  const report = checkVideo(result.outputPath, { samplesPerSecond: 4 });
  if (report.findings.length > 0) {
    return { id, status: "check_failed", file: result.outputPath, detail: report.findings.map((f) => `${f.at.toFixed(1)}s ${f.kind}`).join(", ") };
  }
  return { id, status: "ok", file: result.outputPath };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error("usage: render.ts <reel.json> [--sfx] [--clips-only] [--master-only] [--quality looks]");
    process.exitCode = 2;
    return;
  }

  const manifest = JSON.parse(readFileSync(args.manifest, "utf8")) as Manifest;
  const base = path.dirname(args.manifest);
  const format = manifest.format ?? "1:1";
  if (!isOutputFormat(format)) throw new Error(`unknown format ${format}`);
  const { width, height } = frameSizeFor(format);
  const fps = manifest.fps ?? 30;

  const beats: ProjectBeat[] = manifest.beats.map((b) => {
    const compositionPath = path.resolve(base, b.composition);
    if (!existsSync(compositionPath)) throw new Error(`${b.id}: composition not found at ${compositionPath}`);
    const sfx: SfxCue[] = (b.sfx ?? []).map((cue) => {
      const source = path.resolve(base, cue.source);
      return { source, at: cue.at, durationSeconds: cue.durationSeconds ?? probeSeconds(source), ...(cue.volume === undefined ? {} : { volume: cue.volume }) };
    });
    return { id: b.id, durationSeconds: b.durationSeconds, compositionHtml: readFileSync(compositionPath, "utf8"), sfx };
  });

  let built;
  try {
    built = buildProject(beats, { width, height, fps, ...(manifest.ground ? { ground: manifest.ground } : {}) }, args.sfx);
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
  const outcomes: Outcome[] = [];

  console.log(`${beats.length} beats, ${built.totalSeconds.toFixed(2)}s, ${width}x${height} @ ${fps}fps${args.sfx ? ", with sound effects" : ", silent"}`);

  if (args.clips) {
    for (const beat of beats) {
      const dir = path.join(projectRoot, "clips", beat.id);
      writeFiles(dir, built.clips[beat.id]!);
      copyAssets(dir, built.assets);
      process.stdout.write(`  ${beat.id} … `);
      const outcome = await renderOne(beat.id, dir, path.join(clipsOut, `${beat.id}.mp4`), args.quality);
      outcomes.push(outcome);
      console.log(outcome.status === "ok" ? "ok" : `${outcome.status}: ${outcome.detail}`);
    }
  }

  if (args.master) {
    const dir = path.join(projectRoot, "master");
    writeFiles(dir, built.master);
    copyAssets(dir, built.assets);
    process.stdout.write("  master … ");
    const outcome = await renderOne("master", dir, path.join(base, "master.mp4"), args.quality);
    outcomes.push(outcome);
    console.log(outcome.status === "ok" ? "ok" : `${outcome.status}: ${outcome.detail}`);
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
