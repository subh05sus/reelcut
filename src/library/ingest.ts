import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AssetKind } from "../brief/assetRequirementTypes.js";
import { analyzeFile, wordsFrom } from "./analyze.js";
import { recordJournal, type JournalEntry } from "./journal.js";
import { insertPrepared, libraryRoot, loadIndex, mutateIndex, placeBlob, reelcutHome, type PreparedAsset } from "./store.js";
import { normaliseTags, type TagOrigin } from "./schema.js";

/**
 * Take files from anywhere — a watched folder, a browser upload, a path on the command line — and
 * turn them into library assets, safely and in bulk.
 *
 * ## The order of things, and why
 *
 * 1. **Settle.** A file that is still being written (a cloud client mid-sync, a download, a copy)
 *    must not be hashed: content-addressing would store the truncated file under a hash that is
 *    forever "right". So wait until the size and modified time have stopped changing, and the file
 *    can actually be read.
 * 2. **Copy while hashing, into a temp file.** One read of the source produces both the hash and a
 *    private copy. The source's size and time are compared before and after: if it changed during the
 *    copy, the copy is thrown away and the file is tried again later.
 * 3. **Look up the hash.** Bytes already in the library are not analysed again, and bytes that were
 *    rejected or retired are not brought back.
 * 4. **Analyse, make a preview.** See `analyze.ts`.
 * 5. **One lock, one write per batch.** The index is rewritten once for the whole batch, not once per
 *    file, so dropping a thousand files does not rewrite a thousand-entry index a thousand times.
 */

export type IngestState = "ingested" | "duplicate" | "skipped" | "failed";

export interface IngestOutcome {
  /** What was given: an absolute path, or an upload's name. */
  path: string;
  state: IngestState;
  reason?: string;
  assetId?: string;
  sha?: string;
}

export interface IngestSource {
  kind: "folder" | "upload" | "cli";
  folderId?: string;
  /** Label for provenance: the folder's name, or "upload". */
  origin: string;
  /** The kind its files get. A person's decision about the folder; never inferred from a file. */
  assetKind: AssetKind;
  /** Approved on arrival. Only a folder a person marked trusted does this. */
  trusted: boolean;
  private: boolean;
}

export interface IngestItem {
  /** The file to read. */
  file: string;
  /** Its name for the library (an upload's browser file name, or the file's own). */
  name: string;
  /** Folder path relative to the source root, for the words in it. */
  relPath?: string;
  source: IngestSource;
  /** Size and time recorded in the journal. Absent for uploads. */
  stat?: { size: number; mtimeMs: number };
  /** Bytes that already arrived in a temp file (an upload): no settling and no second copy. */
  stored?: StoredTemp;
}

export class IngestError extends Error {}

export function maxFileBytes(): number {
  const mb = Number(process.env.REELCUT_MAX_FILE_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 500) * 1024 * 1024;
}

export function incomingDir(): string {
  return path.join(reelcutHome(), "incoming");
}

export interface StoredTemp {
  temp: string;
  sha256: string;
  bytes: number;
}

/**
 * Write a stream to a temp file while hashing it. Stops, and removes the temp file, the moment more
 * than `maxBytes` has arrived — the size a client claims is not a limit, the bytes are.
 */
export async function streamToTemp(source: AsyncIterable<Buffer | Uint8Array>, maxBytes = maxFileBytes()): Promise<StoredTemp> {
  mkdirSync(incomingDir(), { recursive: true });
  const temp = path.join(incomingDir(), `${randomUUID()}.part`);
  const out = createWriteStream(temp);
  // A write stream opens its file asynchronously; an error from that must be caught here, not left
  // to surface later as one nobody is listening for.
  let streamError: Error | undefined;
  out.on("error", (error) => {
    streamError = error;
  });
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of source) {
      if (streamError) throw streamError;
      bytes += chunk.length;
      if (bytes > maxBytes) throw new IngestError(`larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit`);
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise<void>((resolve) => out.once("drain", resolve));
    }
    await new Promise<void>((resolve) => out.end(resolve));
    if (streamError) throw streamError;
    return { temp, sha256: hash.digest("hex"), bytes };
  } catch (error) {
    // Let the file finish opening (or failing to) before removing it.
    if (!out.closed) {
      await new Promise<void>((resolve) => {
        out.once("close", () => resolve());
        out.destroy();
      });
    }
    rmSync(temp, { force: true });
    throw error;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** True when the first bytes can be read within `ms` — a cloud placeholder that must be downloaded first stalls here. */
export async function readableWithin(file: string, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const attempt = (async () => {
    const handle = await open(file, "r");
    try {
      await handle.read(Buffer.alloc(1), 0, 1, 0);
      return true;
    } finally {
      await handle.close();
    }
  })().catch(() => false);
  const result = await Promise.race([attempt, new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), ms)))]);
  clearTimeout(timer);
  return result;
}

export interface SettleOptions {
  /** How long size and modified time must hold still. */
  stableMs?: number;
  /** How long to wait in total before giving up. */
  timeoutMs?: number;
  pollMs?: number;
  readTimeoutMs?: number;
}

/**
 * Wait until a file has stopped changing and can be read.
 *
 * A file whose modified time is already old is taken as settled straight away (the common case on a
 * rescan of a big folder); only a recently written one is polled.
 */
export async function waitUntilSettled(file: string, options: SettleOptions = {}): Promise<{ ok: true; size: number; mtimeMs: number } | { ok: false; reason: string }> {
  const { stableMs = 2000, timeoutMs = 60_000, pollMs = Math.max(20, Math.min(500, stableMs / 4)), readTimeoutMs = 15_000 } = options;
  const deadline = Date.now() + timeoutMs;
  let last: { size: number; mtimeMs: number } | undefined;
  let stableSince = Date.now();
  for (;;) {
    let stat;
    try {
      stat = statSync(file);
    } catch {
      return { ok: false, reason: "the file disappeared" };
    }
    const now = Date.now();
    const age = now - stat.mtimeMs;
    if (age >= stableMs * 2 && last === undefined) {
      return (await readableWithin(file, readTimeoutMs)) ? { ok: true, size: stat.size, mtimeMs: stat.mtimeMs } : { ok: false, reason: "could not be read (a cloud file that has not been downloaded, or one that is locked)" };
    }
    if (!last || last.size !== stat.size || last.mtimeMs !== stat.mtimeMs) {
      last = { size: stat.size, mtimeMs: stat.mtimeMs };
      stableSince = now;
    } else if (now - stableSince >= stableMs) {
      return (await readableWithin(file, readTimeoutMs)) ? { ok: true, size: stat.size, mtimeMs: stat.mtimeMs } : { ok: false, reason: "could not be read (a cloud file that has not been downloaded, or one that is locked)" };
    }
    if (now >= deadline) return { ok: false, reason: "still being written after waiting; it will be tried again" };
    await sleep(pollMs);
  }
}

/** Did the source change while it was being copied? Then the copy may be torn and must not be kept. */
export function changedDuring(before: { size: number; mtimeMs: number }, after: { size: number; mtimeMs: number }, copied: number): boolean {
  return after.size !== before.size || after.mtimeMs !== before.mtimeMs || copied !== before.size;
}

/** Copy a file into a temp file, hashing as it goes, and refuse the copy if the source moved under it. */
export async function copyAndHash(file: string, maxBytes = maxFileBytes()): Promise<StoredTemp & { size: number; mtimeMs: number }> {
  const before = statSync(file);
  if (before.size > maxBytes) throw new IngestError(`larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit`);
  const stored = await streamToTemp(createReadStream(file), maxBytes);
  const after = statSync(file);
  if (changedDuring(before, after, stored.bytes)) {
    rmSync(stored.temp, { force: true });
    throw new IngestError("changed while it was being copied; it will be tried again");
  }
  return { ...stored, size: before.size, mtimeMs: before.mtimeMs };
}

export interface IngestOptions {
  concurrency?: number;
  settle?: SettleOptions;
  /** Auto-tags a person has rejected before. Called once per batch. */
  suppress?: () => ReadonlySet<string>;
  /** Called as each file finishes, for progress. */
  onOutcome?: (outcome: IngestOutcome) => void;
  /** Stop starting new files. */
  signal?: { aborted: boolean };
}

interface Prepared {
  item: IngestItem;
  prepared: PreparedAsset;
  temp: string;
  /** Present for a file that came from a folder, for the journal. */
  stat?: { size: number; mtimeMs: number };
}

function entryFor(item: IngestItem, outcome: IngestOutcome, stat?: { size: number; mtimeMs: number }): JournalEntry | undefined {
  const s = stat ?? item.stat;
  if (!s || item.source.kind !== "folder") return undefined; // uploads and CLI paths are not rescanned
  return {
    path: item.file,
    size: s.size,
    mtimeMs: s.mtimeMs,
    state: outcome.state,
    ...(outcome.reason ? { reason: outcome.reason } : {}),
    ...(outcome.sha ? { sha: outcome.sha } : {}),
    ...(outcome.assetId ? { assetId: outcome.assetId } : {}),
    ...(item.source.folderId ? { folderId: item.source.folderId } : {}),
    at: new Date().toISOString(),
  };
}

/** Run `work` over `items` with at most `limit` in flight. */
async function pool<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>, signal?: { aborted: boolean }): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length && !signal?.aborted) {
      const item = items[next++]!;
      await work(item);
    }
  });
  await Promise.all(lanes);
}

/**
 * Ingest a batch of files. Never throws for one bad file: each gets an outcome, and the journal
 * records it so the dashboard can show what was skipped and why.
 */
export async function ingestBatch(items: readonly IngestItem[], options: IngestOptions = {}): Promise<IngestOutcome[]> {
  const outcomes = new Map<IngestItem, IngestOutcome>();
  const prepared: Prepared[] = [];
  const known = new Map(loadIndex().assets.map((a) => [a.sha256, a]));
  const suppress = options.suppress?.() ?? new Set<string>();
  const seen = new Set<string>();
  const finish = (item: IngestItem, outcome: IngestOutcome): void => {
    outcomes.set(item, outcome);
    options.onOutcome?.(outcome);
  };

  await pool(
    items,
    options.concurrency ?? 2,
    async (item) => {
      const base: IngestOutcome = { path: item.file, state: "failed" };
      let temp: string | undefined;
      try {
        let stored: StoredTemp;
        if (item.stored) {
          stored = item.stored;
          temp = stored.temp;
        } else {
          const settled = await waitUntilSettled(item.file, options.settle);
          if (!settled.ok) return finish(item, { ...base, state: "failed", reason: settled.reason });
          const copied = await copyAndHash(item.file);
          stored = copied;
          temp = stored.temp;
          item.stat = { size: copied.size, mtimeMs: copied.mtimeMs };
        }
        const sha = stored.sha256;
        const id = sha.slice(0, 16);
        const stat = item.stat;

        // The same bytes twice in one batch: the second is a duplicate without being analysed again.
        if (seen.has(sha)) {
          rmSync(temp, { force: true });
          return finish(item, { ...base, state: "duplicate", sha, assetId: id });
        }
        seen.add(sha);
        const existing = known.get(sha);
        if (existing) {
          rmSync(temp, { force: true });
          if (existing.review.state === "rejected") return finish(item, { ...base, state: "skipped", reason: "rejected earlier, so not added again", sha, assetId: id });
          if (existing.status === "retired" || existing.status === "superseded") return finish(item, { ...base, state: "skipped", reason: `${existing.status} earlier, so not added again`, sha, assetId: id });
          return finish(item, { ...base, state: "duplicate", sha, assetId: id });
        }

        const analysed = await analyzeFile(temp, { relPath: item.relPath, name: item.name, thumbOut: path.join(libraryRoot(), "thumbs", `${id}.png`), suppress });
        if ("skipped" in analysed) {
          rmSync(temp, { force: true });
          return finish(item, { ...base, state: "skipped", reason: analysed.skipped, sha });
        }

        const now = new Date().toISOString();
        const tagOrigin: Record<string, TagOrigin> = {};
        const tags = normaliseTags([...analysed.autoTags, ...wordsFrom(item.source.origin, 2)]);
        for (const t of tags) tagOrigin[t] = "auto";
        const where = item.relPath ? `${item.source.origin}/${item.relPath}` : item.source.origin;
        prepared.push({
          item,
          temp,
          ...(stat ? { stat } : {}),
          prepared: {
            id,
            sha256: sha,
            file: `files/${id}.${analysed.ext}`,
            ext: analysed.ext,
            bytes: stored.bytes,
            name: analysed.name,
            assetKind: item.source.assetKind,
            tags,
            tagOrigin,
            provenance: { source: "user", note: `dropped in ${where}${analysed.notes.length ? ` (${analysed.notes.join("; ")})` : ""}`.slice(0, 300) },
            mediaType: analysed.mediaType,
            analysis: analysed.analysis,
            review: item.source.trusted ? { state: "approved", by: "folder-trust", at: now } : { state: "pending" },
            ...(item.source.folderId ? { folderId: item.source.folderId } : {}),
            ...(analysed.thumb ? { thumb: `thumbs/${id}.png` } : {}),
            private: item.source.private,
          },
        });
      } catch (error) {
        if (temp) rmSync(temp, { force: true });
        finish(item, { ...base, state: "failed", reason: error instanceof Error ? error.message : String(error) });
      }
    },
    options.signal,
  );

  // One lock, one write for the whole batch.
  if (prepared.length > 0) {
    const now = new Date().toISOString();
    mutateIndex((index) => {
      for (const p of prepared) {
        const result = insertPrepared(index, p.prepared, { now, respectTombstones: true });
        if (!result.existed) placeBlob(p.temp, p.prepared.file, true);
        else rmSync(p.temp, { force: true });
        const state: IngestState = result.blocked ? "skipped" : result.existed ? "duplicate" : "ingested";
        finish(p.item, { path: p.item.file, state, ...(result.blocked ? { reason: `${result.blocked} earlier, so not added again` } : {}), sha: p.prepared.sha256, assetId: p.prepared.id });
      }
    });
  }

  const results = items.map((item) => outcomes.get(item) ?? { path: item.file, state: "failed" as const, reason: "not reached (stopped)" });
  recordJournal(items.map((item, i) => entryFor(item, results[i]!)).filter((e): e is JournalEntry => e !== undefined));
  return results;
}

/** Cheap check used by tests and the dashboard: is this path under the incoming directory? */
export function isIncoming(file: string): boolean {
  return existsSync(file) && path.resolve(file).startsWith(path.resolve(incomingDir()));
}
