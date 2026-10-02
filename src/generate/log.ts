import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

/**
 * What happened to each beat that could have been generated, kept in `reel.json`.
 *
 * `generated` — a clip was made and is placed; `fallback` — it was meant to be generated and something
 * went wrong, so the beat was composed in HyperFrames; `skipped` — it was never going to be (not
 * connected, turned off, not eligible). The studio shows it on the reel and `plan.md` carries it.
 */

export const GenerationEntrySchema = z.object({
  beat: z.string().min(1).max(40),
  outcome: z.enum(["generated", "fallback", "skipped"]),
  reason: z.string().max(300).optional(),
  assetId: z.string().regex(/^[0-9a-f]{16}$/).optional(),
});
export type GenerationEntry = z.infer<typeof GenerationEntrySchema>;

/** Add or replace the entry for a beat, keeping everything else in the manifest as it was. */
export function recordGeneration(manifestPath: string, entry: GenerationEntry): GenerationEntry[] {
  const parsed = GenerationEntrySchema.parse(entry);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  const existing = Array.isArray(manifest.generation) ? (manifest.generation as unknown[]).flatMap((e) => (GenerationEntrySchema.safeParse(e).success ? [e as GenerationEntry] : [])) : [];
  const next = [...existing.filter((e) => e.beat !== parsed.beat), parsed];
  manifest.generation = next;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return next;
}

export function readGeneration(manifest: unknown): GenerationEntry[] {
  const raw = (manifest as { generation?: unknown } | undefined)?.generation;
  return Array.isArray(raw) ? raw.flatMap((e) => { const p = GenerationEntrySchema.safeParse(e); return p.success ? [p.data] : []; }) : [];
}
