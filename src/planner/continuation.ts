import type { Beat, PlanningLogEntry } from "../core/index.js";
import { visualForIntent } from "./visualMix.js";

/**
 * Phase L2a: scene spans — the "never a blank beat" rule the user chose. A sentence with no
 * strong visual of its own does not become `visualType: none` (10 of 17 beats of the reported
 * reel were, ~37 s of a 62 s reel); it CONTINUES the previous scene with a new move, and the
 * scene director later plans one scene for the lead plus one continuation per follower.
 *
 *  - A default-classified beat (`none`) after a lead → `continuesPrevious: true`, inheriting the
 *    lead's `visualType`; its description becomes its own spoken sentence.
 *  - A default-classified beat before any lead → promoted to a lead (there is nothing to continue).
 *  - A span is capped at `MAX_SPAN_SECONDS`: a continuation that would push the span past it
 *    is promoted to a new lead, forcing a cut.
 *
 * Phase T5: a promoted lead takes the visual type its INTENT implies (`visualForIntent`), not
 * `text_overlay`. That one hardcoded literal is the reported "the main output is always pure
 * Textoverlay": this promotion is the most frequently taken path in the planner, because the
 * keyword classifier needs very specific German to say anything and defaults to `none`. Every
 * sentence it could not read became a caption, and `visualType` is what the scene director is told
 * the beat is — so it reached the frame.
 *
 * `none` is never written. `hasStrongVisual` (L4's Gemini intent pass) can override the
 * keyword classifier's opinion per beat when present.
 */
export const MAX_SPAN_SECONDS = 6;

export function maxSpanFrames(fps: number): number {
  return Math.round(MAX_SPAN_SECONDS * fps);
}

export interface AssignContinuationsOptions {
  fps: number;
  /** Per-beat override: `true` forces a lead, `false` forces a continuation attempt. */
  hasStrongVisual?: (beat: Beat) => boolean | undefined;
}

export interface AssignContinuationsResult {
  beats: Beat[];
  planningLog: PlanningLogEntry[];
}

export function assignContinuations(beats: readonly Beat[], options: AssignContinuationsOptions): AssignContinuationsResult {
  const cap = maxSpanFrames(options.fps);
  const planningLog: PlanningLogEntry[] = [];
  const out: Beat[] = [];
  let lead: Beat | undefined;

  for (const original of beats) {
    const beat: Beat = { ...original, continuesPrevious: false };
    const override = options.hasStrongVisual?.(beat);
    const strong = override ?? beat.visualType !== "none";

    if (strong && beat.visualType !== "none") {
      lead = beat;
      out.push(beat);
      continue;
    }

    // No strong visual of its own.
    const spanFrames = lead ? beat.endFrame - lead.startFrame : Infinity;
    if (lead && spanFrames <= cap) {
      beat.continuesPrevious = true;
      beat.visualType = lead.visualType;
      beat.description = beat.sourceText;
      beat.libraryMatch = undefined;
      planningLog.push({ type: "continuation_assigned", beatId: beat.id, message: `${beat.id} continues ${lead.id}'s scene (${lead.visualType}) — span now ${beat.endFrame - lead.startFrame} frames.` });
      out.push(beat);
      continue;
    }

    // Nothing to continue (first beats) or the span is full: a fresh lead forces a cut.
    beat.continuesPrevious = false;
    beat.visualType = visualForIntent(beat.beatIntent);
    beat.description = beat.sourceText;
    planningLog.push({
      type: "continuation_assigned",
      beatId: beat.id,
      message: lead
        ? `${beat.id} promoted to a ${beat.visualType} lead — continuing ${lead.id} would exceed the ${MAX_SPAN_SECONDS}s span cap.`
        : `${beat.id} promoted to a ${beat.visualType} lead — no earlier scene to continue.`,
    });
    lead = beat;
    out.push(beat);
  }

  return { beats: out, planningLog };
}

/** A scene span: a lead beat and the continuation beats that share its scene, in order. */
export interface BeatSpan {
  lead: Beat;
  continuations: Beat[];
  startFrame: number;
  endFrame: number;
}

/** Groups a contiguous, index-ordered beat list into spans. A continuation with no lead before
 * it (a malformed plan) is treated as its own lead rather than dropped. */
export function buildSpans(beats: readonly Beat[]): BeatSpan[] {
  const spans: BeatSpan[] = [];
  for (const beat of [...beats].sort((a, b) => a.index - b.index)) {
    const current = spans[spans.length - 1];
    if (beat.continuesPrevious && current) {
      current.continuations.push(beat);
      current.endFrame = beat.endFrame;
    } else {
      spans.push({ lead: beat, continuations: [], startFrame: beat.startFrame, endFrame: beat.endFrame });
    }
  }
  return spans;
}

/** The beats a director actually plans — leads only. */
export function isLeadBeat(beat: Pick<Beat, "visualType" | "continuesPrevious">): boolean {
  return beat.visualType !== "none" && !beat.continuesPrevious;
}
