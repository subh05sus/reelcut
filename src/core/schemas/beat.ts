import { z } from "zod";
import { BeatIntentSchema, VisualTypeSchema } from "./visualType.js";

/**
 * Frames, not milliseconds, are authoritative. startMs/endMs are derived for human readability
 * (JSON diffs, log lines) but every renderer and every timing check operates on startFrame/
 * endFrame. See LEARNINGS.md "Frame numbers, not milliseconds, are authoritative for timing" —
 * rounding ms->frames at render time causes drift that compounds across a Reel; quantizing once
 * at plan time and treating frames as ground truth prevents that class of bug entirely.
 */
export function msToFrames(ms: number, fps: number): number {
  return Math.round((ms / 1000) * fps);
}

export function framesToMs(frames: number, fps: number): number {
  return Math.round((frames / fps) * 1000);
}

export const LibraryMatchSchema = z.object({
  assetId: z.string().min(1),
  confidence: z.number().min(0).max(1),
  source: z.enum(["raw_reference", "finished_visual"]),
});
export type LibraryMatch = z.infer<typeof LibraryMatchSchema>;

export const ManualTaskSchema = z.object({
  reason: z.string().min(1, "manualTask.reason must explain why this beat can't be automated"),
  tool: z.enum(["higgsfield", "seedance", "screen_recording", "other"]),
  brief: z.string().min(1, "manualTask.brief must be a ready-to-execute brief, not empty"),
});
export type ManualTask = z.infer<typeof ManualTaskSchema>;

export const BeatSchema = z
  .object({
    id: z.string().regex(/^beat_\d{2,}$/, "beat id must look like 'beat_03'"),
    index: z.number().int().nonnegative(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
    startFrame: z.number().int().nonnegative(),
    endFrame: z.number().int().nonnegative(),
    sourceText: z.string(),
    visualType: VisualTypeSchema,
    description: z.string().min(1, "description must say what the visual should show"),
    libraryMatch: LibraryMatchSchema.optional(),
    templateProps: z.record(z.string(), z.unknown()).optional(),
    manualTask: ManualTaskSchema.optional(),
    /**
     * Phase L2a: this beat continues the previous scene instead of starting a new one — the
     * scene director plans ONE scene for the lead beat plus a new move per continuation beat
     * (a scene "span"), so no beat is ever blank. Timing rows stay exactly as they are (the
     * beat keeps its own SRT-exact frames); only the visual is shared. The first beat of a reel
     * can never continue (asserted on `BeatPlanSchema`).
     */
    continuesPrevious: z.boolean().default(false),
    /** Phase L: what the beat does in the argument (hook, claim, comparison, …) — see
     * `BEAT_INTENTS`. Optional: older plans and the CLI path may not set it. */
    beatIntent: BeatIntentSchema.optional(),
  })
  .superRefine((beat, ctx) => {
    if (beat.endFrame <= beat.startFrame) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${beat.id}: endFrame (${beat.endFrame}) must be greater than startFrame (${beat.startFrame})`,
        path: ["endFrame"],
      });
    }
    if (beat.visualType === "none" && beat.libraryMatch) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${beat.id}: visualType 'none' must not carry a libraryMatch`,
        path: ["libraryMatch"],
      });
    }
  });
export type Beat = z.infer<typeof BeatSchema>;

export const PlanningLogEntrySchema = z.object({
  type: z.enum([
    "density_downgrade",
    "density_gap_flagged",
    "low_confidence_segmentation",
    "library_match_applied",
    // Phase L2a: scene spans
    "beats_merged",
    "continuation_assigned",
    "density_span_split",
    "intent_pass_fallback",
    // Phase T5: a text lead re-typed to the visual its intent implies.
    "visual_mix_retyped",
    "other",
  ]),
  beatId: z.string().optional(),
  message: z.string().min(1),
});
export type PlanningLogEntry = z.infer<typeof PlanningLogEntrySchema>;

export const PlanWarningSchema = z.object({
  code: z.enum([
    "srt_duration_mismatch",
    "srt_beat_alignment_mismatch",
    "short_script_density_not_applicable",
    "density_below_target",
    "density_above_target",
    // Phase T5: the text-lead cap could not be met because the remaining beats really are text.
    "visual_mix_text_heavy",
    "other",
  ]),
  message: z.string().min(1),
});
export type PlanWarning = z.infer<typeof PlanWarningSchema>;

export const BeatPlanSchema = z
  .object({
    reelId: z.string().min(1),
    scriptSourcePath: z.string().min(1),
    srtSourcePath: z.string().optional(),
    fps: z.number().int().positive(),
    totalDurationMs: z.number().int().positive(),
    totalDurationFrames: z.number().int().positive(),
    beats: z.array(BeatSchema).min(1, "a BeatPlan must contain at least one beat"),
    generatedAt: z.string().datetime(),
    pacingSource: z.enum(["estimated_wpm", "srt_exact"]),
    planningLog: z.array(PlanningLogEntrySchema).default([]),
    warnings: z.array(PlanWarningSchema).default([]),
  })
  .superRefine((plan, ctx) => {
    const beats = [...plan.beats].sort((a, b) => a.index - b.index);

    beats.forEach((beat, i) => {
      if (beat.index !== i) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `beats must have sequential 0-based index; expected ${i} at position ${i}, got ${beat.index} (${beat.id})`,
          path: ["beats", i, "index"],
        });
      }
    });

    if (beats.length > 0) {
      const first = beats[0]!;
      if (first.continuesPrevious) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `first beat (${first.id}) cannot continue a previous scene — there is none`,
          path: ["beats", 0, "continuesPrevious"],
        });
      }
      if (first.startFrame !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `first beat (${first.id}) must start at frame 0, got ${first.startFrame}`,
          path: ["beats", 0, "startFrame"],
        });
      }

      for (let i = 0; i < beats.length - 1; i++) {
        const cur = beats[i]!;
        const next = beats[i + 1]!;
        if (cur.endFrame !== next.startFrame) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `beats must be contiguous with no gap or overlap: ${cur.id}.endFrame (${cur.endFrame}) !== ${next.id}.startFrame (${next.startFrame})`,
            path: ["beats", i + 1, "startFrame"],
          });
        }
      }

      const last = beats[beats.length - 1]!;
      if (last.endFrame !== plan.totalDurationFrames) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `last beat (${last.id}).endFrame (${last.endFrame}) must equal totalDurationFrames (${plan.totalDurationFrames})`,
          path: ["beats", beats.length - 1, "endFrame"],
        });
      }
    }
  });
export type BeatPlan = z.infer<typeof BeatPlanSchema>;
