import { blankPanels, edgeInk, frameDelta, gridInk, inkShare, type FlatRegion } from "./frameMetrics.js";
import { probeVideo, sampleFrames, type SampledFrame, type VideoInfo } from "./decode.js";

/**
 * The post-render gate: what is wrong with this video, stated as facts about its pixels.
 *
 * ## What is a finding and what is only a number
 *
 * Exactly one check fails a render today: `blank_panel`. That restraint is deliberate and is the
 * main lesson this repo keeps re-learning — a detector that cries wolf gets ignored and then
 * disabled. In this session alone the jitter detector produced 346 false positives before it was
 * re-based on ink centroid, the pop detector 41 before its window was widened, and the stutter
 * detector 4 before its neighbour threshold moved. Each was a real idea ruined by shipping the
 * threshold before the corpus.
 *
 * So everything else here is **reported, not gated**, until there is a measured distribution to
 * set a threshold from:
 *
 * - **Static holds.** Real, and worth seeing. But `/brag`'s horse-tinder holds a near-identical
 *   frame from 6.0s to 9.0s and reads beautifully, so "held too long" is not by itself a defect.
 * - **Grid ink.** Our own reel at 34s has a structurally dead bottom 40%, and that is a genuine
 *   composition failure — but a deliberate asymmetric layout produces the same numbers.
 * - **Edge ink.** Deliberately *not* a finding. A full-bleed photograph puts ink against all four
 *   edges by design, and no pixel measurement can separate that from a clipped headline. That
 *   question belongs to the DOM checker in X2, which can ask an element for its own rectangle.
 */

/** Mean per-pixel difference below which two samples count as the same picture. */
export const STATIC_DELTA = 1.0;

/** Shortest run of unchanged samples worth reporting, in seconds. */
export const STATIC_RUN_SECONDS = 2.0;

export interface Finding {
  kind: "blank_panel";
  at: number;
  detail: string;
  region: FlatRegion;
}

export interface FrameReport {
  at: number;
  ink: number;
  edgeInk: number;
  grid: number[];
}

export interface StaticRun {
  from: number;
  to: number;
  seconds: number;
}

export interface VideoReport {
  file: string;
  info: VideoInfo;
  samplesPerSecond: number;
  frames: FrameReport[];
  findings: Finding[];
  staticRuns: StaticRun[];
  /** Grid cells that stayed below `deadCellInk` for the whole video, as `row,col` pairs. */
  deadCells: { row: number; col: number; peak: number }[];
}

export interface CheckOptions {
  samplesPerSecond?: number;
  longEdge?: number;
  gridCols?: number;
  gridRows?: number;
  /** A cell whose ink never exceeds this across the whole video is structurally dead. */
  deadCellInk?: number;
}

export function checkVideo(file: string, options: CheckOptions = {}): VideoReport {
  const { samplesPerSecond = 2, longEdge = 192, gridCols = 3, gridRows = 3, deadCellInk = 0.005 } = options;

  const info = probeVideo(file);
  const frames = sampleFrames(file, samplesPerSecond, longEdge);
  if (frames.length === 0) throw new Error(`no frames decoded from ${file}`);

  const findings: Finding[] = [];
  const reports: FrameReport[] = [];
  const peak = new Array<number>(gridCols * gridRows).fill(0);

  for (const frame of frames) {
    const grid = gridInk(frame, gridCols, gridRows);
    for (let i = 0; i < grid.length; i++) peak[i] = Math.max(peak[i]!, grid[i]!);

    reports.push({ at: frame.at, ink: inkShare(frame), edgeInk: edgeInk(frame), grid });

    for (const region of blankPanels(frame)) {
      findings.push({
        kind: "blank_panel",
        at: frame.at,
        detail: `${(region.area * 100).toFixed(1)}% of frame, ${(region.rectFill * 100).toFixed(0)}% rectangular, at x ${region.x.toFixed(2)}..${(region.x + region.w).toFixed(2)} y ${region.y.toFixed(2)}..${(region.y + region.h).toFixed(2)}`,
        region,
      });
    }
  }

  return {
    file,
    info,
    samplesPerSecond,
    frames: reports,
    findings,
    staticRuns: findStaticRuns(frames, samplesPerSecond),
    deadCells: peak
      .map((p, i) => ({ row: Math.floor(i / gridCols), col: i % gridCols, peak: p }))
      .filter((c) => c.peak <= deadCellInk),
  };
}

function findStaticRuns(frames: SampledFrame[], samplesPerSecond: number): StaticRun[] {
  const runs: StaticRun[] = [];
  let start = 0;
  for (let i = 1; i <= frames.length; i++) {
    const same = i < frames.length && frameDelta(frames[i - 1]!, frames[i]!) < STATIC_DELTA;
    if (same) continue;
    const seconds = (i - 1 - start) / samplesPerSecond;
    if (seconds >= STATIC_RUN_SECONDS) runs.push({ from: frames[start]!.at, to: frames[i - 1]!.at, seconds });
    start = i;
  }
  return runs;
}

export function formatReport(report: VideoReport): string {
  const lines: string[] = [];
  const { info } = report;
  lines.push(`${report.file}`);
  lines.push(`  ${info.width}x${info.height}  ${info.durationSeconds.toFixed(2)}s  ${info.fps.toFixed(0)}fps  ${report.frames.length} samples @ ${report.samplesPerSecond}/s`);

  const ink = report.frames.map((f) => f.ink);
  const mean = ink.reduce((a, b) => a + b, 0) / ink.length;
  lines.push(`  ink: mean ${(mean * 100).toFixed(1)}%  min ${(Math.min(...ink) * 100).toFixed(1)}%  max ${(Math.max(...ink) * 100).toFixed(1)}%`);

  lines.push("");
  lines.push(`  FINDINGS (${report.findings.length})`);
  if (report.findings.length === 0) lines.push("    none");
  for (const f of report.findings) lines.push(`    ${f.at.toFixed(1)}s  ${f.kind}  ${f.detail}`);

  lines.push("");
  lines.push("  reported, not gated:");
  lines.push(`    static holds >= ${STATIC_RUN_SECONDS}s: ${report.staticRuns.length === 0 ? "none" : report.staticRuns.map((r) => `${r.from.toFixed(1)}-${r.to.toFixed(1)}s (${r.seconds.toFixed(1)}s)`).join(", ")}`);
  lines.push(`    always-empty grid cells: ${report.deadCells.length === 0 ? "none" : report.deadCells.map((c) => `r${c.row}c${c.col}`).join(", ")}`);

  return lines.join("\n");
}
