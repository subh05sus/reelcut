import { z } from "zod";
import { AssetKindSchema } from "../brief/assetRequirementTypes.js";

/**
 * The asset library: what reelcut has already acquired, verified and been allowed to use.
 *
 * It exists so a run does not re-acquire the Claude logo every time. But a library that reuses
 * blindly is a library that ships last year's logo, so every entry carries where it came from, and
 * the matcher (`match.ts`) only reuses without asking when that provenance is present and fresh.
 */

export const ProvenanceSchema = z.object({
  /** How it got here. `drawn` is only ever legal for `generic` assets. */
  source: z.enum(["user", "capture", "brand", "drawn"]),
  url: z.string().optional(),
  licence: z.string().optional(),
  /** ISO time the product surface was photographed. Captures go stale; marks mostly do not. */
  capturedAt: z.string().optional(),
  /** The capture sidecar (`*.png.json`) as it was when the asset was added. */
  captureSidecar: z.record(z.unknown()).optional(),
  /** Anything worth carrying into report.md — e.g. "masked: account email in header". */
  note: z.string().optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const AssetStatusSchema = z.enum(["active", "superseded", "retired"]);
export type AssetStatus = z.infer<typeof AssetStatusSchema>;

export const LibraryAssetSchema = z.object({
  /** First 16 hex chars of the sha256. Also the blob's basename. */
  id: z.string().regex(/^[0-9a-f]{16}$/),
  name: z.string().min(1).max(120),
  /** Blob path relative to the library root, e.g. `files/3f2a….svg`. */
  file: z.string(),
  ext: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  assetKind: AssetKindSchema,
  /** Lowercased. What "use the chatgpt-tagged items" filters on. */
  tags: z.array(z.string()).default([]),
  provenance: ProvenanceSchema,
  addedAt: z.string(),
  lastUsedAt: z.string().optional(),
  /** Run ids that rendered with this asset. */
  usedIn: z.array(z.string()).default([]),
  status: AssetStatusSchema.default("active"),
  supersededBy: z.string().optional(),
});
export type LibraryAsset = z.infer<typeof LibraryAssetSchema>;

export const LibraryIndexSchema = z.object({
  version: z.literal(1),
  assets: z.array(LibraryAssetSchema),
});
export type LibraryIndex = z.infer<typeof LibraryIndexSchema>;

export const RunRecordSchema = z.object({
  /** Stable per out dir: re-rendering the same reel updates its record rather than adding one. */
  id: z.string(),
  outDir: z.string(),
  manifest: z.string(),
  renderedAt: z.string(),
  beats: z.array(z.string()),
  /** Paths relative to `outDir`. */
  clips: z.array(z.string()),
  master: z.string().optional(),
  poster: z.string().optional(),
  libraryAssets: z.array(z.string()).default([]),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;

export const RunsFileSchema = z.object({
  version: z.literal(1),
  runs: z.array(RunRecordSchema),
});
export type RunsFile = z.infer<typeof RunsFileSchema>;

/** Tags are compared lowercased and trimmed, and never empty. */
export function normaliseTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].sort();
}
