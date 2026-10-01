import path from "node:path";
import { z } from "zod";
import { readValidated, reelcutHome, withLock, writeAtomic } from "./store.js";

/**
 * What ingest has done with every file it has looked at, so that a rescan costs a `stat` per file
 * rather than a hash, and so that the dashboard can say what happened to each one.
 *
 * A file is "unchanged" when its path, size and modified time match its entry; a file that was
 * edited, or copied over, is looked at again. A failed file is retried after a pause, because the
 * usual reason is that something was still writing it. The decisions that must never be undone —
 * a rejected or retired asset — are not kept here: they live on the asset itself, which is never
 * deleted, and ingest checks it by content hash before adding anything.
 */

export const JournalEntrySchema = z.object({
  path: z.string(),
  size: z.number(),
  mtimeMs: z.number(),
  state: z.enum(["ingested", "duplicate", "skipped", "failed"]),
  reason: z.string().optional(),
  sha: z.string().optional(),
  assetId: z.string().optional(),
  folderId: z.string().optional(),
  at: z.string(),
});
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

const JournalSchema = z.object({ version: z.literal(1), entries: z.record(JournalEntrySchema) });
export type Journal = z.infer<typeof JournalSchema>;

const MAX_ENTRIES = 20_000;
/** A failed file is tried again no sooner than this. */
export const RETRY_FAILED_MS = 5 * 60_000;

function journalPath(): string {
  return path.join(reelcutHome(), "ingest.json");
}

export function loadJournal(): Journal {
  return readValidated(journalPath(), (raw) => JournalSchema.safeParse(raw), { version: 1, entries: {} });
}

/** Add or replace entries, in one locked write. The oldest finished entries go first when it grows. */
export function recordJournal(entries: readonly JournalEntry[]): void {
  if (entries.length === 0) return;
  withLock(`${journalPath()}.lock`, () => {
    const journal = loadJournal();
    for (const entry of entries) journal.entries[entry.path] = entry;
    const keys = Object.keys(journal.entries);
    if (keys.length > MAX_ENTRIES) {
      const drop = keys
        .filter((k) => journal.entries[k]!.state !== "failed")
        .sort((a, b) => journal.entries[a]!.at.localeCompare(journal.entries[b]!.at))
        .slice(0, keys.length - MAX_ENTRIES);
      for (const key of drop) delete journal.entries[key];
    }
    writeAtomic(journalPath(), `${JSON.stringify(journal, null, 2)}\n`);
  });
}

/** True when this file has already been dealt with and has not changed since. */
export function unchanged(entry: JournalEntry | undefined, stat: { size: number; mtimeMs: number }, now = Date.now()): boolean {
  if (!entry || entry.size !== stat.size || entry.mtimeMs !== stat.mtimeMs) return false;
  if (entry.state === "failed") return now - Date.parse(entry.at) < RETRY_FAILED_MS;
  return true;
}

export interface JournalSummary {
  counts: Record<JournalEntry["state"], number>;
  /** The newest skipped and failed entries, which are the ones worth reading. */
  attention: JournalEntry[];
}

export function summarise(journal = loadJournal(), folderId?: string): JournalSummary {
  const counts = { ingested: 0, duplicate: 0, skipped: 0, failed: 0 };
  const attention: JournalEntry[] = [];
  for (const entry of Object.values(journal.entries)) {
    if (folderId && entry.folderId !== folderId) continue;
    counts[entry.state] += 1;
    if (entry.state === "skipped" || entry.state === "failed") attention.push(entry);
  }
  attention.sort((a, b) => b.at.localeCompare(a.at));
  return { counts, attention: attention.slice(0, 50) };
}
