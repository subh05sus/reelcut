import type { Beat, PlanningLogEntry, PlanWarning, VisualType } from "../core/index.js";
import { DENSITY_TARGET } from "../core/index.js";
import { isLeadBeat } from "./continuation.js";

/**
 * Density enforcement — spec Phase 1 item 4: "5-8 visuals per 30 seconds ... deliberately
 * downgrades some beats if density is too high, or flags a gap if too low. This has to be a
 * visible, logged decision, not silent."
 *
 * Phase L2a: "visuals" are scene LEADS (a continuation beat shares its lead's scene — see
 * continuation.ts), and the two corrections changed:
 *  - too dense → the least load-bearing lead becomes a CONTINUATION of the scene before it,
 *    never `none` (the old downgrade to `none` is where 59% of the reported reel went blank);
 *  - too sparse → a hard guarantee, not a log line: the longest continuation in the bucket is
 *    promoted to its own lead (`density_span_split`), repeated until the floor is met or there
 *    is nothing left to split. Only then is a gap flagged.
 *
 * Non-overlapping 30-second buckets, keyed by beat start time. Beats are treated as one
 * index-ordered list so a split/merge across the bucket boundary stays consistent.
 */

const DOWNGRADE_ORDER: VisualType[] = ["text_overlay", "static_graphic", "logo", "animation", "ai_clip", "ui_simulation"];
const MIN_BUCKET_SPAN_FOR_GAP_CHECK_MS = 20_000;
const SHORT_SCRIPT_THRESHOLD_MS = 10_000;

function downgradeRank(visualType: VisualType): number {
  const idx = DOWNGRADE_ORDER.indexOf(visualType);
  return idx === -1 ? DOWNGRADE_ORDER.length : idx;
}

export interface DensityResult {
  beats: Beat[];
  planningLog: PlanningLogEntry[];
  warnings: PlanWarning[];
}

/** The lead beat whose scene `beats[i]` belongs to (itself when it is a lead). */
function leadFor(beats: readonly Beat[], i: number): Beat | undefined {
  for (let j = i; j >= 0; j--) {
    if (!beats[j]!.continuesPrevious) return beats[j];
  }
  return undefined;
}

export function applyDensityEnforcement(beats: readonly Beat[], totalDurationMs: number): DensityResult {
  const planningLog: PlanningLogEntry[] = [];
  const warnings: PlanWarning[] = [];
  const result = [...beats].sort((a, b) => a.index - b.index).map((b) => ({ ...b }));

  if (totalDurationMs < SHORT_SCRIPT_THRESHOLD_MS) {
    warnings.push({
      code: "short_script_density_not_applicable",
      message: `Total duration ${totalDurationMs}ms is under the 10s floor — density enforcement skipped entirely for this plan.`,
    });
    return { beats: result, planningLog, warnings };
  }

  const bucketCount = Math.ceil(totalDurationMs / DENSITY_TARGET.windowMs);
  for (let b = 0; b < bucketCount; b++) {
    const bucketStart = b * DENSITY_TARGET.windowMs;
    const bucketEnd = Math.min(bucketStart + DENSITY_TARGET.windowMs, totalDurationMs);
    const bucketSpan = bucketEnd - bucketStart;
    const inBucket = (beat: Beat) => beat.startMs >= bucketStart && beat.startMs < bucketEnd;
    const leadsInBucket = () => result.filter((beat) => inBucket(beat) && isLeadBeat(beat));

    // Too dense: fold the least load-bearing leads into the scene before them.
    const leads = leadsInBucket();
    if (leads.length > DENSITY_TARGET.max) {
      const excess = leads.length - DENSITY_TARGET.max;
      // Never fold the very first beat of the reel (nothing precedes it).
      const candidates = leads.filter((l) => l.index > 0).sort((a, z) => downgradeRank(a.visualType) - downgradeRank(z.visualType));
      for (let i = 0; i < Math.min(excess, candidates.length); i++) {
        const target = result.find((r) => r.id === candidates[i]!.id)!;
        const previousLead = leadFor(result, target.index - 1)!;
        const originalType = target.visualType;
        target.continuesPrevious = true;
        target.visualType = previousLead.visualType;
        target.description = target.sourceText;
        target.libraryMatch = undefined;
        planningLog.push({
          type: "density_downgrade",
          beatId: target.id,
          message: `Bucket [${bucketStart}ms-${bucketEnd}ms] had ${leads.length} scenes (target: ${DENSITY_TARGET.min}-${DENSITY_TARGET.max}) — ${target.id} ('${originalType}') now continues ${previousLead.id}'s scene instead of starting its own.`,
        });
      }
      continue;
    }

    // Too sparse: split the longest continuation off into its own lead until the floor is met.
    if (bucketSpan >= MIN_BUCKET_SPAN_FOR_GAP_CHECK_MS) {
      while (leadsInBucket().length < DENSITY_TARGET.min) {
        const continuations = result.filter((beat) => inBucket(beat) && beat.continuesPrevious && beat.visualType !== "none");
        if (continuations.length === 0) break;
        const longest = continuations.reduce((best, beat) => (beat.endFrame - beat.startFrame > best.endFrame - best.startFrame ? beat : best));
        longest.continuesPrevious = false;
        planningLog.push({
          type: "density_span_split",
          beatId: longest.id,
          message: `Bucket [${bucketStart}ms-${bucketEnd}ms] had fewer than ${DENSITY_TARGET.min} scenes — ${longest.id} promoted from a continuation to its own '${longest.visualType}' scene.`,
        });
      }
      const remaining = leadsInBucket().length;
      if (remaining < DENSITY_TARGET.min) {
        planningLog.push({
          type: "density_gap_flagged",
          message: `Bucket [${bucketStart}ms-${bucketEnd}ms] has only ${remaining} scene(s) (target: ${DENSITY_TARGET.min}-${DENSITY_TARGET.max}) and nothing left to split — flagged as a gap.`,
        });
        warnings.push({
          code: "density_below_target",
          message: `Bucket [${bucketStart}ms-${bucketEnd}ms] is below the density target (${remaining}/${DENSITY_TARGET.min}-${DENSITY_TARGET.max}).`,
        });
      }
    }
  }

  return { beats: result, planningLog, warnings };
}
