import { z } from "zod";
import { GROUNDS, MOVES, PACING, TEXT_STYLES } from "./vocab.js";

/**
 * Reference videos: other people's motion graphics, kept to learn from.
 *
 * A reference is **third-party content**, so it is kept apart from the asset library on purpose. It has
 * its own index and its own folder, nothing here can be matched to a script line or placed in a
 * composition, and it never leaves this machine — the learnings export carries rules, not references.
 * What the studio takes from one is a handful of numbers (how it cuts, how light it is, how much of the
 * frame is type) and a few words from a fixed list (the moves in it), never the pictures and never a sentence.
 */

/** What the deterministic pass measured. */
export const ReferenceAnalysisSchema = z.object({
  durationSeconds: z.number().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fps: z.number().positive().optional(),
  /** Only the first stretch of a long film is measured, so a ten-minute upload does not take ten minutes. */
  measuredSeconds: z.number().nonnegative(),
  /** Hard cuts found, as seconds from the start; the shots are the gaps between them. */
  cutTimes: z.array(z.number()).max(500).default([]),
  shots: z.number().int().nonnegative().default(1),
  medianShotSeconds: z.number().nonnegative().default(0),
  meanShotSeconds: z.number().nonnegative().default(0),
  cutsPerMinute: z.number().nonnegative().default(0),
  /** Mean change between frames a quarter-second apart, 0 (still) to 1. How much moves. */
  motionEnergy: z.number().min(0).max(1).default(0),
  /** Mean brightness, 0 to 255. */
  meanLuma: z.number().min(0).max(255).default(0),
  ground: z.enum(GROUNDS).default("mixed"),
  pacing: z.enum(PACING).default("medium"),
  dominantColors: z.array(z.string()).max(6).default([]),
  /** Mean share of the frame that is ink (type and graphics against the ground), 0 to 1. */
  textShare: z.number().min(0).max(1).default(0),
});
export type ReferenceAnalysis = z.infer<typeof ReferenceAnalysisSchema>;

/**
 * What was seen in it, in fixed words. Claude writes it from the contact sheet; a person accepts or edits
 * it, and only an accepted annotation teaches the studio anything.
 */
export const AnnotationSchema = z.object({
  moves: z.array(z.enum(MOVES)).max(12).default([]),
  textStyle: z.enum(TEXT_STYLES).optional(),
  /** For the person to read. Never a rule, never read by anything that decides. */
  note: z.string().max(400).optional(),
  by: z.enum(["claude", "user"]),
  at: z.string(),
  /** A person has looked at these tags and kept them. */
  reviewed: z.boolean().default(false),
});
export type Annotation = z.infer<typeof AnnotationSchema>;

export const ReferenceSchema = z.object({
  /** First 16 hex chars of the sha256, which is also the file's name. */
  id: z.string().regex(/^[0-9a-f]{16}$/),
  name: z.string().min(1).max(120),
  /** Relative to the references folder, e.g. `files/3f2a….mp4`. */
  file: z.string(),
  ext: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  addedAt: z.string(),
  /** Where it came from, for the person: "dropped on the studio", "cli". Never read by anything that decides. */
  origin: z.string().max(120).default("dropped"),
  /** Taught from, or kept on file but ignored. */
  include: z.boolean().default(true),
  analysis: ReferenceAnalysisSchema,
  /** `sheets/<id>.png`: 24 frames across the film, for Claude and for the person. */
  sheet: z.string().optional(),
  /** `thumbs/<id>.png`: one frame, for the grid. */
  thumb: z.string().optional(),
  annotation: AnnotationSchema.optional(),
});
export type Reference = z.infer<typeof ReferenceSchema>;

export const ReferencesFileSchema = z.object({
  version: z.literal(1),
  references: z.array(ReferenceSchema).default([]),
});
export type ReferencesFile = z.infer<typeof ReferencesFileSchema>;
