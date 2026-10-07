import { readFileSync } from "node:fs";
import path from "node:path";
import { parseScript } from "../../../src/planner/parseScript.js";
import { parseSrt } from "../../../src/planner/parseSrt.js";
import { segmentBeats, type BeatTiming } from "../../../src/planner/beatSegmentation.js";
import { mergeShortBeats } from "../../../src/planner/mergeShortBeats.js";
import { planShortCut, type CutBeat } from "../../../src/planner/shortCut.js";
import { readingFloorSeconds } from "../../../src/core/readingFloor.js";
import { DEFAULT_FPS } from "../../../src/core/constants.js";

/**
 * Script in, beats out. Step 1 of the skill, as a command you can run and read.
 *
 * Reports, never writes. The beats it prints are what the agent then writes a `BeatBrief` against,
 * and seeing them before composing anything is the cheapest way to catch a script that segments
 * badly — a run-on sentence with no punctuation, a beat too short for its own line.
 *
 *   npm run beats -- script.txt [--fps 60] [--short]
 *
 * `.srt` gives exact timings. `.txt` is estimated from words per minute, which is an estimate and
 * is labelled as one in the output, because every duration downstream inherits it.
 */

interface Args {
  file: string;
  fps: number;
  short: boolean;
}

function parseArgs(argv: readonly string[]): Args | undefined {
  let file: string | undefined;
  let fps = DEFAULT_FPS;
  let short = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--fps") fps = Number(argv[++i]);
    else if (arg === "--short") short = true;
    else if (!arg.startsWith("--")) file = path.resolve(process.env.INIT_CWD ?? process.cwd(), arg);
  }
  return file ? { file, fps, short } : undefined;
}

function seconds(ms: number): number {
  return ms / 1000;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error("usage: beats.ts <script.txt|script.srt> [--fps 60] [--short]");
    process.exitCode = 2;
    return;
  }

  const text = readFileSync(args.file, "utf8");
  const isSrt = args.file.toLowerCase().endsWith(".srt");

  /*
   * An SRT still goes through `parseScript`: the cues carry the timing, the script text carries
   * the sentence boundaries, and a cue boundary is not a sentence boundary. `segmentBeats` needs
   * both.
   */
  const srtCues = isSrt ? parseSrt(text) : undefined;
  const scriptText = srtCues ? srtCues.map((c) => c.text).join(" ") : text;
  const { segments, lowConfidenceSegmentation } = parseScript(scriptText);

  const segmentation = segmentBeats({ segments, ...(srtCues ? { srtCues } : {}), fps: args.fps, lowConfidenceSegmentation });
  const merged = mergeShortBeats(segmentation.timings, args.fps);

  console.log(`${path.basename(args.file)} — ${merged.timings.length} beats, ${seconds(segmentation.totalDurationMs).toFixed(1)}s, ${segmentation.pacingSource === "srt_exact" ? "exact timings from SRT" : "durations ESTIMATED from words per minute"}`);

  if (lowConfidenceSegmentation) {
    console.log("  ! no sentence punctuation found — fell back to fixed-duration chunking, so spot-check these boundaries");
  }
  for (const entry of segmentation.planningLog) console.log(`  · ${entry.message}`);
  for (const warning of segmentation.warnings) console.log(`  ! ${JSON.stringify(warning)}`);

  console.log("");
  printBeats(merged.timings);

  if (!args.short) return;

  const cut = planShortCut(merged.timings.map(toCutBeat));
  console.log("");
  if (!("beats" in cut)) {
    console.log(`short cut refused: ${cut.issues.map((i) => i.message).join("; ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`short cut — ${cut.beats.length} of ${merged.timings.length} beats, ${cut.totalSeconds.toFixed(1)}s`);
  for (const beat of cut.beats) {
    console.log(`  ${beat.role.padEnd(9)} #${String(beat.index).padStart(2)}  ${beat.seconds.toFixed(2)}s  ${beat.text.slice(0, 64)}`);
  }
}

function toCutBeat(timing: BeatTiming): CutBeat {
  return { id: timing.id, index: timing.index, text: timing.sourceText, durationMs: timing.endMs - timing.startMs };
}

/**
 * Each beat with the one number that decides whether it is possible at all.
 *
 * `fits` compares the line's reading floor against the time it has. A beat marked `TIGHT` is not
 * a warning to be waved through — it means the line cannot be read at that length, and the answer
 * is to cut the copy or split the beat, never to speed it up.
 */
function printBeats(timings: readonly BeatTiming[]): void {
  console.log("  #   secs  floor  ");
  for (const t of timings) {
    const secs = seconds(t.endMs - t.startMs);
    const floor = readingFloorSeconds(t.sourceText);
    const tight = floor + 0.35 > secs;
    console.log(
      `  ${String(t.index).padStart(2)}  ${secs.toFixed(2)}  ${floor.toFixed(2)}  ${tight ? "TIGHT " : "      "}${t.sourceText.slice(0, 70)}`,
    );
  }
  const tight = timings.filter((t) => readingFloorSeconds(t.sourceText) + 0.35 > seconds(t.endMs - t.startMs));
  if (tight.length > 0) {
    console.log("");
    console.log(`  ${tight.length} beat(s) marked TIGHT: the line needs longer than the beat has. Cut the copy or split the beat — do not speed it up.`);
  }
}

main();
