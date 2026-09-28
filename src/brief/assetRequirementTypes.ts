import { z } from "zod";

/**
 * Phase J, Tier 2 (spec sections 7-9): a deeper, per-asset pass scoped to the *selected*
 * treatment — richer than Tier 1's coarse `requiredAssets` guess (made before any treatment was
 * chosen), matching spec section 7's fuller field set (name / why it's needed / scene usage /
 * visual role / accepted formats / animation hint / priority). This is still structured JSON the
 * model composes, never code or an asset id it wasn't given — the actual library search and
 * upload-gating logic live in the web app layer (this package has no DB/asset-search
 * dependency), exactly like `ScenePlanInput.candidateAssets` is pre-resolved by the caller today.
 */
/**
 * Phase K, user decision: split asset gating. "identity" = a specific real-world thing that can't
 * be faked — a named product/company's logo, a real screenshot of a specific UI, a real captured
 * interaction. "generic" = a conceptual/illustrative visual (an arrow, a diagram, an abstract
 * shape) where the constrained `generated_vector` primitive can stand in when the library has no
 * match, so a missing generic asset never stalls the whole reel the way a missing logo should.
 */
export const AssetKindSchema = z.enum(["identity", "generic"]);
export type AssetKind = z.infer<typeof AssetKindSchema>;

export const AssetRequirementSchema = z.object({
  name: z.string().min(1).max(80),
  reason: z.string().min(1).max(200),
  sceneUsage: z.string().min(1).max(160),
  visualRole: z.string().min(1).max(120),
  acceptedFormats: z.array(z.string().min(1).max(30)).max(5).default([]),
  animationHint: z.string().max(160).optional(),
  priority: z.enum(["required", "optional"]),
  assetKind: AssetKindSchema,
});
export type AssetRequirement = z.infer<typeof AssetRequirementSchema>;

export const AssetRequirementSetSchema = z.object({
  assets: z.array(AssetRequirementSchema).max(15),
});
export type AssetRequirementSet = z.infer<typeof AssetRequirementSetSchema>;

/*
 * The `AssetRequirementDirector` interface that lived here is gone.
 *
 * It described a model producing requirements from a treatment, and typed its input with
 * `TreatmentSchema` and `SemanticPaletteSchema` — which was the only thing in this file reaching
 * into the 13,770-LOC slot vocabulary that `beatBrief.ts` exists to replace. In this skill the
 * agent writes the requirements directly, so the interface has nothing to describe and the
 * dependency has nothing to justify it.
 *
 * `AssetRequirementSchema` above is what `assetGaps` and `assetIntake` actually consume, and it
 * is pure zod with no external references.
 */
