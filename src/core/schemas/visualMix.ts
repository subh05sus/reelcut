import { z } from "zod";
import type { BeatIntent, VisualType } from "./visualType.js";

/**
 * How much of a reel is allowed to be text on a background, and what a sentence becomes instead.
 *
 * Lives in core rather than in the planner for the reason this barrel's own header states: core is
 * the browser-safe one. The planner's barrel reaches `visualTypeClassifier.ts`, which reads its
 * ruleset with `node:fs`, so a client component importing a preset name from there takes the whole
 * classifier with it and the Turbopack build dies on "does not support external modules
 * (request: node:fs)". The enforcement mechanism was the build, and it fired.
 *
 * What stays in the planner is the part that needs beats: `applyVisualMix` and `textLeadRatio`.
 */

export const VISUAL_MIXES = ["text_sparsam", "ausgewogen", "text_lastig"] as const;
export const VisualMixSchema = z.enum(VISUAL_MIXES);
export type VisualMix = z.infer<typeof VisualMixSchema>;

export const DEFAULT_VISUAL_MIX: VisualMix = "ausgewogen";

/** The largest share of scene LEADS that may be pure text, per preset. */
export const TEXT_LEAD_CAP: Record<VisualMix, number> = {
  text_sparsam: 1 / 5,
  ausgewogen: 1 / 3,
  // Not "no rule" — the pre-T5 behaviour, which is occasionally what a quote-driven script wants.
  text_lastig: 1,
};

export const VISUAL_MIX_LABELS: Record<VisualMix, string> = {
  text_sparsam: "Text sparsam",
  ausgewogen: "Ausgewogen",
  text_lastig: "Text-lastig",
};

/**
 * What a sentence with no visual of its own should become, given what it DOES.
 *
 * A `Record` over `BEAT_INTENTS`, so a ninth intent is a build error until somebody has decided
 * what it looks like — which is the question `continuation.ts` never asked. It answered
 * `text_overlay`, unconditionally, on the most frequently taken path in the planner, and that one
 * literal is the reported "the main output is always pure Textoverlay".
 *
 * `cta` stays text on purpose. "Schreib mir in die Kommentare" is a line addressed to the viewer;
 * rendering it as a simulated interface would be inventing something that is not in the script,
 * which is the defect on the other side of this one.
 */
export const VISUAL_FOR_INTENT: Record<BeatIntent, VisualType> = {
  hook: "animation",
  product_ui: "ui_simulation",
  claim: "static_graphic",
  comparison: "static_graphic",
  number: "static_graphic",
  process: "animation",
  transition: "animation",
  cta: "text_overlay",
};

export function visualForIntent(intent: BeatIntent | undefined): VisualType {
  return intent ? VISUAL_FOR_INTENT[intent] : "static_graphic";
}

/** Guards the enum at a form boundary, the same way `isOutputFormat` does for the shape. */
export function isVisualMix(value: unknown): value is VisualMix {
  return typeof value === "string" && (VISUAL_MIXES as readonly string[]).includes(value);
}
