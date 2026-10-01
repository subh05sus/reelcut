import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { listFolders, scanDir, updateFolder, folderExists, type Candidate, type Folder } from "./folders.js";
import { ingestBatch, type IngestItem, type IngestOptions, type IngestOutcome, type IngestSource } from "./ingest.js";
import { loadJournal, unchanged } from "./journal.js";
import { isIngestPaused, setIngestPaused } from "./settings.js";

/**
 * Keeps the watched folders ingested while the studio runs.
 *
 * Two things find new files, because neither is enough alone: `fs.watch` on each folder, which is
 * immediate but silently misses events on some network and cloud-synced paths, and a rescan on a
 * timer, which is slow but cannot miss. Both end in the same place — `rescan` — which compares the
 * folder with the journal and ingests only what is new or changed. Scans run one at a time.
 */

export interface ManagerOptions extends IngestOptions {
  /** Rescan period. Watching makes this a backstop, so it is not short. */
  rescanMs?: number;
  /** Wait after a file-system event before scanning, so a copy in progress is one scan, not fifty. */
  debounceMs?: number;
  /** Turn off `fs.watch` (the timer still runs). For tests and for paths that cannot be watched. */
  watch?: boolean;
}

export interface ManagerStatus {
  running: boolean;
  /** The master pause: nothing is read, scanned or indexed from watched folders until it is lifted. */
  paused: boolean;
  scanning: boolean;
  /** Files found by the scan in progress that have not finished yet. */
  pending: number;
  lastScanAt?: string;
  recent: IngestOutcome[];
}

export function folderSource(folder: Folder): IngestSource {
  return { kind: "folder", folderId: folder.id, origin: folder.label || path.basename(folder.path), assetKind: folder.kind, trusted: folder.trusted, private: folder.private };
}

export function itemsFor(folder: Folder, files: readonly Candidate[]): IngestItem[] {
  const source = folderSource(folder);
  return files.map((f) => ({ file: f.abs, name: path.basename(f.abs), relPath: f.rel, source, stat: { size: f.size, mtimeMs: f.mtimeMs } }));
}

export class IngestManager {
  private watchers = new Map<string, FSWatcher>();
  private timer: NodeJS.Timeout | undefined;
  private debounce = new Map<string, NodeJS.Timeout>();
  private chain: Promise<unknown> = Promise.resolve();
  private scanning = 0;
  private pending = 0;
  private recent: IngestOutcome[] = [];
  private lastScanAt: string | undefined;
  private running = false;
  private stopSignal = { aborted: false };

  constructor(private readonly options: ManagerOptions = {}) {}

  status(): ManagerStatus {
    return { running: this.running, paused: isIngestPaused(), scanning: this.scanning > 0, pending: this.pending, ...(this.lastScanAt ? { lastScanAt: this.lastScanAt } : {}), recent: this.recent.slice(-100) };
  }

  /** Scan everything now, then keep watching. Safe to call twice. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopSignal = { aborted: false };
    void this.rescan();
    this.syncWatchers();
    this.timer = setInterval(() => {
      this.syncWatchers();
      void this.rescan();
    }, this.options.rescanMs ?? 30_000);
    this.timer.unref();
  }

  stop(): void {
    this.running = false;
    this.stopSignal.aborted = true;
    if (this.timer) clearInterval(this.timer);
    for (const t of this.debounce.values()) clearTimeout(t);
    this.debounce.clear();
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
  }

  /**
   * Master pause. Stops the watchers, stops a scan in progress from starting new files, and makes
   * every later scan a no-op until `resume`. Persisted, so it holds across a restart.
   */
  pause(): void {
    setIngestPaused(true);
    this.stopSignal.aborted = true;
    this.syncWatchers();
  }

  resume(): void {
    setIngestPaused(false);
    this.stopSignal = { aborted: false };
    this.syncWatchers();
    if (this.running) void this.rescan();
  }

  /** Watch each active folder, and stop watching removed or paused ones. */
  syncWatchers(): void {
    if (this.options.watch === false) return;
    const wanted = new Map(isIngestPaused() ? [] : listFolders().filter((f) => !f.paused && folderExists(f)).map((f) => [f.id, f]));
    for (const [id, watcher] of this.watchers) {
      if (!wanted.has(id)) {
        watcher.close();
        this.watchers.delete(id);
      }
    }
    for (const [id, folder] of wanted) {
      if (this.watchers.has(id)) continue;
      try {
        const watcher = watch(folder.path, { recursive: true, persistent: false }, () => this.touched(id));
        watcher.on("error", () => {
          watcher.close();
          this.watchers.delete(id);
        });
        this.watchers.set(id, watcher);
      } catch {
        // Not every path can be watched. The timer still finds its files.
      }
    }
  }

  private touched(id: string): void {
    clearTimeout(this.debounce.get(id));
    this.debounce.set(id, setTimeout(() => void this.rescan(id), this.options.debounceMs ?? 1500));
  }

  /** Scan one folder, or all of them. Resolves when this scan (and any queued before it) is done. */
  rescan(folderId?: string): Promise<IngestOutcome[]> {
    const run = this.chain.then(() => this.scanNow(folderId));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async scanNow(folderId?: string): Promise<IngestOutcome[]> {
    const out: IngestOutcome[] = [];
    if (isIngestPaused()) return out;
    if (this.stopSignal.aborted && this.running) this.stopSignal = { aborted: false };
    this.scanning += 1;
    try {
      const folders = listFolders().filter((f) => (!folderId || f.id === folderId) && !f.paused);
      for (const folder of folders) {
        if (this.stopSignal.aborted) break;
        if (!folderExists(folder)) {
          updateFolder(folder.id, { lastError: "folder not found (is the drive or cloud client connected?)" });
          continue;
        }
        const journal = loadJournal();
        const { files, truncated } = scanDir(folder.path);
        const fresh = files.filter((f) => !unchanged(journal.entries[f.abs], f));
        this.pending += fresh.length;
        const results = await ingestBatch(itemsFor(folder, fresh), {
          ...this.options,
          signal: this.stopSignal,
          onOutcome: (o) => {
            this.pending = Math.max(0, this.pending - 1);
            this.recent.push(o);
            if (this.recent.length > 300) this.recent.splice(0, this.recent.length - 300);
            this.options.onOutcome?.(o);
          },
        });
        out.push(...results);
        updateFolder(folder.id, { lastScanAt: new Date().toISOString(), lastError: truncated ? "more files than one scan handles; the rest follow on the next scan" : null });
      }
      this.lastScanAt = new Date().toISOString();
    } finally {
      this.scanning -= 1;
      this.pending = 0;
    }
    return out;
  }
}
