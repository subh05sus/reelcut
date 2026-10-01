import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { reelcutHome, readValidated, withLock, writeAtomic } from "./store.js";
import { RunsFileSchema, type RunRecord, type RunsFile } from "./schema.js";

/**
 * Every reel that has been rendered, so the studio can show them all without searching the disk.
 *
 * A run is keyed by its output folder: rendering the same reel again updates its record instead of
 * adding a duplicate. Records point at files, they never hold them — an `out/` folder that has been
 * deleted or moved shows up as missing rather than breaking the list.
 */

function runsPath(): string {
  return path.join(reelcutHome(), "runs.json");
}

export function runIdFor(outDir: string): string {
  return createHash("sha256").update(path.resolve(outDir).toLowerCase()).digest("hex").slice(0, 12);
}

export function loadRuns(): RunsFile {
  return readValidated(runsPath(), (raw) => RunsFileSchema.safeParse(raw), { version: 1, runs: [] });
}

export function recordRun(record: Omit<RunRecord, "id" | "renderedAt" | "appliedLearnings"> & { renderedAt?: string; appliedLearnings?: string[] }): RunRecord {
  const full: RunRecord = {
    ...record,
    appliedLearnings: record.appliedLearnings ?? [],
    outDir: path.resolve(record.outDir),
    manifest: path.resolve(record.manifest),
    id: runIdFor(record.outDir),
    renderedAt: record.renderedAt ?? new Date().toISOString(),
  };
  return withLock(`${runsPath()}.lock`, () => {
    const file = loadRuns();
    const at = file.runs.findIndex((r) => r.id === full.id);
    if (at >= 0) {
      // A partial re-render (one beat) must not forget the clips it did not touch.
      const previous = file.runs[at]!;
      full.clips = [...new Set([...previous.clips, ...full.clips])].sort();
      full.beats = [...new Set([...previous.beats, ...full.beats])];
      full.libraryAssets = [...new Set([...previous.libraryAssets, ...full.libraryAssets])];
      full.appliedLearnings = [...new Set([...previous.appliedLearnings, ...full.appliedLearnings])];
      full.brand ??= previous.brand;
      full.master ??= previous.master;
      full.poster ??= previous.poster;
      file.runs[at] = full;
    } else {
      file.runs.push(full);
    }
    writeAtomic(runsPath(), `${JSON.stringify(file, null, 2)}\n`);
    return full;
  });
}

export interface RunView extends RunRecord {
  /** The out folder or its manifest is gone. */
  missing: boolean;
}

/** Newest first. */
export function listRuns(): RunView[] {
  return loadRuns()
    .runs.map((r) => ({ ...r, missing: !existsSync(r.outDir) || !existsSync(r.manifest) }))
    .sort((a, b) => b.renderedAt.localeCompare(a.renderedAt));
}

export function findRun(id: string): RunView | undefined {
  return listRuns().find((r) => r.id === id);
}
