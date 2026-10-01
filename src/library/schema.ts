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

/** What the file is, decided from its bytes — never from its extension. */
export const MediaTypeSchema = z.enum(["image", "vector", "video", "audio", "document", "other"]);
export type MediaType = z.infer<typeof MediaTypeSchema>;

/**
 * Whether a person has looked at an asset.
 *
 * An asset dropped into a folder or onto the dashboard is `pending`: it can be searched and it can
 * be *proposed* for a requirement, but it is never applied without asking. Assets added on purpose
 * (`library add`, an older index) are `approved`. `rejected` is permanent — a rescan of the folder it
 * came from will not bring it back.
 */
export const ReviewStateSchema = z.enum(["pending", "approved", "rejected"]);
export type ReviewState = z.infer<typeof ReviewStateSchema>;
export const ReviewSchema = z.object({
  state: ReviewStateSchema,
  by: z.enum(["user", "folder-trust", "cli", "legacy"]).optional(),
  at: z.string().optional(),
});
export type Review = z.infer<typeof ReviewSchema>;

/** Who wrote a tag. Only a person's tags, or tags a person has reviewed, count as theirs. */
export const TagOriginSchema = z.enum(["user", "auto", "claude"]);
export type TagOrigin = z.infer<typeof TagOriginSchema>;

/** What the deterministic pass measured. Everything is optional: a document has no duration. */
export const AnalysisSchema = z.object({
  width: z.number().optional(),
  height: z.number().optional(),
  durationSeconds: z.number().optional(),
  dominantColors: z.array(z.string()).default([]),
  /** Audio. Peak is true peak in dBFS; loudness is integrated, in LUFS. */
  peakDb: z.number().optional(),
  lufs: z.number().optional(),
  /** Gain that brings a sound to the mix's target loudness. Applied when mixing, never to the file. */
  gainDb: z.number().optional(),
  /** Audio shape words: transient, bright, rising, sustained… */
  descriptors: z.array(z.string()).default([]),
  /** Text found inside a vector file, or a description written by Claude. */
  text: z.string().optional(),
  description: z.string().optional(),
  note: z.string().optional(),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

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
  mediaType: MediaTypeSchema.default("other"),
  analysis: AnalysisSchema.default({}),
  /** Defaults to approved so an index written before review existed keeps working as it did. */
  review: ReviewSchema.default({ state: "approved", by: "legacy" }),
  tagOrigin: z.record(TagOriginSchema).default({}),
  /** The watched folder it came from, if any. */
  folderId: z.string().optional(),
  /** Blob-relative path of a small preview, e.g. `thumbs/3f2a….png`. */
  thumb: z.string().optional(),
  /** From a private folder: analysed on this machine and never put in the queue for Claude to look at. */
  private: z.boolean().default(false),
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
  /** The brand or product the reel was about, from the manifest. Scopes what the studio learns from it. */
  brand: z.string().optional(),
  /** Ids of the learned rules Claude applied, from the manifest. */
  appliedLearnings: z.array(z.string()).default([]),
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
