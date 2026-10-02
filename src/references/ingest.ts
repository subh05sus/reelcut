import { rmSync } from "node:fs";
import path from "node:path";
import { sniffFile } from "../library/analyze.js";
import { copyAndHash, IngestError, streamToTemp, type StoredTemp } from "../library/ingest.js";
import { analyzeReference } from "./analyze.js";
import { addReference, loadReferences, referencesRoot, type PreparedReference } from "./store.js";

/**
 * Bring a reference video in: a file on disk, or an upload that has already been streamed to a temp file.
 *
 * Same care as any ingest — the type is decided from the bytes, the same bytes twice are one reference,
 * a size limit applies, and one bad file never stops a batch — but with no review gate: a reference is
 * never used in a reel, so there is nothing for a person to approve before it is safe to use.
 */

export type ReferenceState = "added" | "duplicate" | "skipped" | "failed";

export interface ReferenceOutcome {
  name: string;
  state: ReferenceState;
  reason?: string;
  id?: string;
}

export type ReferenceInput =
  | { file: string; name: string; origin: string }
  | { stored: StoredTemp; name: string; origin: string };

export async function ingestReference(input: ReferenceInput): Promise<ReferenceOutcome> {
  const name = input.name;
  let stored: StoredTemp | undefined;
  try {
    stored = "stored" in input ? input.stored : await copyAndHash(input.file);
    const id = stored.sha256.slice(0, 16);

    if (loadReferences().references.some((r) => r.sha256 === stored!.sha256)) {
      rmSync(stored.temp, { force: true });
      return { name, state: "duplicate", id };
    }
    const sniffed = sniffFile(stored.temp);
    if (!sniffed || sniffed.mediaType !== "video") {
      rmSync(stored.temp, { force: true });
      return { name, state: "skipped", reason: "not a video" };
    }

    const root = referencesRoot();
    const measured = await analyzeReference(stored.temp, { sheetOut: path.join(root, "sheets", `${id}.png`), thumbOut: path.join(root, "thumbs", `${id}.png`) });
    const prepared: PreparedReference = {
      id,
      name: path.basename(name, path.extname(name)).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "reference",
      file: `files/${id}.${sniffed.ext}`,
      ext: sniffed.ext,
      bytes: stored.bytes,
      sha256: stored.sha256,
      addedAt: new Date().toISOString(),
      origin: input.origin.slice(0, 120),
      include: true,
      analysis: measured.analysis,
      ...(measured.sheet ? { sheet: `sheets/${id}.png` } : {}),
      ...(measured.thumb ? { thumb: `thumbs/${id}.png` } : {}),
      temp: stored.temp,
    };
    const { existed } = addReference(prepared);
    return { name, state: existed ? "duplicate" : "added", id };
  } catch (error) {
    if (stored) rmSync(stored.temp, { force: true });
    return { name, state: "failed", reason: error instanceof IngestError || error instanceof Error ? error.message : String(error) };
  }
}

/** Upload helper for the studio: stream the request body to a temp file, then ingest it. */
export async function ingestReferenceUpload(body: AsyncIterable<Buffer | Uint8Array>, name: string, origin = "dropped on the studio"): Promise<ReferenceOutcome> {
  let stored: StoredTemp;
  try {
    stored = await streamToTemp(body);
  } catch (error) {
    return { name, state: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
  return ingestReference({ stored, name, origin });
}
