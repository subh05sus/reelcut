import type { PlanningLogEntry } from "../core/index.js";
import type { BeatTiming } from "./beatSegmentation.js";

/**
 * Phase L2a: no beat shorter than two seconds. One beat per sentence gave the reported reel a
 * 1.1 s beat ("Claude oder ChatGPT?") — 33 frames, in which an 8-frame transition, an entrance
 * and an exit leave no settled state at all. A short beat merges into the shorter of its
 * neighbours (preferring the following one, so a short opener joins the sentence it introduces),
 * concatenating the spoken text; frames stay contiguous by construction (first start, last end),
 * and ids/indices are reassigned afterwards. Runs on the timing shells, before classification,
 * so the classifier sees the merged sentence as one unit.
 */
export const MIN_BEAT_SECONDS = 2;

export function minBeatFrames(fps: number): number {
  return Math.round(MIN_BEAT_SECONDS * fps);
}

function beatId(index: number): string {
  return `beat_${String(index).padStart(2, "0")}`;
}

function frames(t: BeatTiming): number {
  return t.endFrame - t.startFrame;
}

function merge(a: BeatTiming, b: BeatTiming, fps: number): BeatTiming {
  const startFrame = a.startFrame;
  const endFrame = b.endFrame;
  return {
    id: a.id,
    index: a.index,
    startFrame,
    endFrame,
    startMs: Math.round((startFrame / fps) * 1000),
    endMs: Math.round((endFrame / fps) * 1000),
    sourceText: `${a.sourceText.trim()} ${b.sourceText.trim()}`.trim(),
  };
}

export interface MergeShortBeatsResult {
  timings: BeatTiming[];
  planningLog: PlanningLogEntry[];
}

export function mergeShortBeats(timings: readonly BeatTiming[], fps: number): MergeShortBeatsResult {
  const min = minBeatFrames(fps);
  const planningLog: PlanningLogEntry[] = [];
  const out: BeatTiming[] = timings.map((t) => ({ ...t }));

  // Repeat until nothing is short (a merge can itself still be short) or one beat is left.
  let guard = 0;
  while (out.length > 1 && guard++ < 1000) {
    const i = out.findIndex((t) => frames(t) < min);
    if (i === -1) break;
    const prev = out[i - 1];
    const next = out[i + 1];
    // Prefer the following neighbour; fall back to the previous; when both exist, the shorter.
    let target: "prev" | "next";
    if (!prev) target = "next";
    else if (!next) target = "prev";
    else target = frames(next) <= frames(prev) ? "next" : "prev";

    const short = out[i]!;
    if (target === "next") {
      out.splice(i, 2, merge(short, next!, fps));
    } else {
      out.splice(i - 1, 2, merge(prev!, short, fps));
    }
    planningLog.push({
      type: "beats_merged",
      message: `${short.id} (${frames(short)} frames < ${min}) merged into the ${target === "next" ? "following" : "previous"} beat: "${short.sourceText.slice(0, 50)}"`,
    });
  }

  return {
    timings: out.map((t, index) => ({ ...t, id: beatId(index), index })),
    planningLog,
  };
}
