import { z } from "zod";

export const VisualTypeSchema = z.enum([
  "ui_simulation",
  "animation",
  "logo",
  "static_graphic",
  "text_overlay",
  "ai_clip",
  "none",
]);

export type VisualType = z.infer<typeof VisualTypeSchema>;

/** Visual types that produce a file at all — 'none' is a deliberate absence, never rendered. */
export const RENDERABLE_VISUAL_TYPES = VisualTypeSchema.options.filter(
  (v): v is Exclude<VisualType, "none"> => v !== "none",
);

/**
 * Phase L: what a beat DOES in the script's argument — orthogonal to `visualType` (which names
 * the material). Set by the planner's keyword pass and, when available, Gemini's per-sentence
 * intent pass (L4); read by the scene director to pick a fitting composition/blueprint.
 */
export const BEAT_INTENTS = ["hook", "product_ui", "claim", "comparison", "number", "process", "transition", "cta"] as const;
export const BeatIntentSchema = z.enum(BEAT_INTENTS);
export type BeatIntent = z.infer<typeof BeatIntentSchema>;
