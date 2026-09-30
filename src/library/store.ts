import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AssetKind } from "../brief/assetRequirementTypes.js";
import { LibraryIndexSchema, normaliseTags, type AssetStatus, type LibraryAsset, type LibraryIndex, type Provenance } from "./schema.js";

/**
 * Where the library lives, and the only code that writes to it.
 *
 * Global and per user (`~/.reelcut`), because the skill is usually installed as a plugin whose own
 * directory is neither stable nor ours to write to, and because the Claude logo acquired for one
 * project is the same Claude logo in the next. `REELCUT_HOME` overrides it — the tests rely on that.
 *
 * ## Why the writes are this careful
 *
 * A render recording a run while the studio saves a tag edit is two writers on one file. A
 * half-written `index.json` would lose every asset's provenance at once, so every write is
 * read-modify-write under a lockfile, lands in a temp file first and is renamed into place, and a
 * file that does not parse is backed up and refused — never silently replaced by an empty library.
 */

export function reelcutHome(): string {
  return path.resolve(process.env.REELCUT_HOME ?? path.join(os.homedir(), ".reelcut"));
}

export function libraryRoot(): string {
  return path.join(reelcutHome(), "library");
}

function indexPath(): string {
  return path.join(libraryRoot(), "index.json");
}

export class LibraryError extends Error {}

const LOCK_WAIT_MS = 5000;
const LOCK_STALE_MS = 30_000;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Run `fn` holding an exclusive lockfile. A lock older than 30s is a crashed writer's and is broken. */
export function withLock<T>(lockPath: string, fn: () => T): T {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      closeSync(openSync(lockPath, "wx"));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
          rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        continue; // released between the open and the stat
      }
      if (Date.now() > deadline) throw new LibraryError(`timed out waiting for ${lockPath}; delete it if no reelcut process is running`);
      sleepSync(25);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lockPath, { force: true });
  }
}

/** Write via temp file + rename, so a reader never sees half a file. */
export function writeAtomic(file: string, contents: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, contents, "utf8");
  // Windows refuses the rename while another process has the target open for reading; that is
  // brief, so retry rather than fail.
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(temp, file);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 20 || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) {
        rmSync(temp, { force: true });
        throw error;
      }
      sleepSync(25);
    }
  }
}

/**
 * Read and validate a JSON file, or back it up and refuse.
 *
 * Refusing is the point: returning an empty value here would let the next write replace the
 * whole library with nothing.
 */
export function readValidated<T>(file: string, parse: (raw: unknown) => { success: true; data: T } | { success: false; error: { message: string } }, empty: T): T {
  if (!existsSync(file)) return empty;
  const text = readFileSync(file, "utf8");
  let raw: unknown;
  let problem: string | undefined;
  try {
    raw = JSON.parse(text);
    const parsed = parse(raw);
    if (parsed.success) return parsed.data;
    problem = parsed.error.message;
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }
  const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  copyFileSync(file, backup);
  throw new LibraryError(`${file} is not valid (${problem}). A copy is at ${backup}; fix or remove the original.`);
}

export function loadIndex(): LibraryIndex {
  return readValidated(indexPath(), (raw) => LibraryIndexSchema.safeParse(raw), { version: 1, assets: [] });
}

/** Read-modify-write the index under the lock. */
export function mutateIndex<T>(fn: (index: LibraryIndex) => T): T {
  return withLock(`${indexPath()}.lock`, () => {
    const index = loadIndex();
    const result = fn(index);
    writeAtomic(indexPath(), `${JSON.stringify(index, null, 2)}\n`);
    return result;
  });
}

export function sha256Of(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** The absolute path of an asset's blob — always inside `libraryRoot()/files`. */
export function blobPath(asset: Pick<LibraryAsset, "file">): string {
  return path.join(libraryRoot(), asset.file);
}

export interface AddAssetInput {
  name: string;
  assetKind: AssetKind;
  tags?: readonly string[];
  provenance: Provenance;
}

export interface AddAssetResult {
  asset: LibraryAsset;
  /** True when the same bytes were already in the library and only their metadata was merged. */
  existed: boolean;
}

/**
 * Store a file and its provenance.
 *
 * Content-addressed: the same bytes added twice are one asset, with the tags merged. The file is
 * copied, never linked, so deleting `assets/in/` or an `out/` folder cannot break the library.
 */
export function addAsset(source: string, input: AddAssetInput): AddAssetResult {
  if (!existsSync(source) || !statSync(source).isFile()) throw new LibraryError(`${source} is not a file`);
  if (input.provenance.source === "drawn" && input.assetKind === "identity") {
    throw new LibraryError("an identity asset cannot be drawn — a generated logo is a fabricated logo");
  }

  const sha256 = sha256Of(source);
  const id = sha256.slice(0, 16);
  const ext = path.extname(source).slice(1).toLowerCase();
  const file = `files/${id}${ext ? `.${ext}` : ""}`;
  const now = new Date().toISOString();

  return mutateIndex((index) => {
    const existing = index.assets.find((a) => a.sha256 === sha256);
    if (existing) {
      existing.tags = normaliseTags([...existing.tags, ...(input.tags ?? [])]);
      // Fill in provenance that was missing; never overwrite what was recorded first.
      existing.provenance = { ...input.provenance, ...stripUndefined(existing.provenance) };
      return { asset: existing, existed: true };
    }

    const target = path.join(libraryRoot(), file);
    mkdirSync(path.dirname(target), { recursive: true });
    if (!existsSync(target)) copyFileSync(source, target);

    const asset: LibraryAsset = {
      id,
      name: input.name,
      file,
      ext,
      bytes: statSync(source).size,
      sha256,
      assetKind: input.assetKind,
      tags: normaliseTags(input.tags ?? []),
      provenance: input.provenance,
      addedAt: now,
      usedIn: [],
      status: "active",
    };
    index.assets.push(asset);
    return { asset, existed: false };
  });
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export interface AssetPatch {
  name?: string;
  /** Replaces the tag list. */
  tags?: readonly string[];
  addTags?: readonly string[];
  removeTags?: readonly string[];
  status?: AssetStatus;
  supersededBy?: string;
  note?: string;
}

export function updateAsset(id: string, patch: AssetPatch): LibraryAsset {
  return mutateIndex((index) => {
    const asset = index.assets.find((a) => a.id === id);
    if (!asset) throw new LibraryError(`no asset ${id}`);
    if (patch.supersededBy !== undefined && !index.assets.some((a) => a.id === patch.supersededBy)) {
      throw new LibraryError(`no asset ${patch.supersededBy} to supersede ${id} with`);
    }
    if (patch.name !== undefined) asset.name = patch.name;
    let tags = patch.tags ? [...patch.tags] : [...asset.tags];
    tags.push(...(patch.addTags ?? []));
    const remove = new Set(normaliseTags(patch.removeTags ?? []));
    tags = normaliseTags(tags).filter((t) => !remove.has(t));
    asset.tags = tags;
    if (patch.status !== undefined) asset.status = patch.status;
    if (patch.supersededBy !== undefined) {
      asset.status = "superseded";
      asset.supersededBy = patch.supersededBy;
    }
    if (patch.note !== undefined) asset.provenance.note = patch.note;
    return asset;
  });
}

/** Mark assets as used by a run. Unknown ids are ignored — a composition may name a deleted blob. */
export function recordUse(ids: readonly string[], runId: string): void {
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  mutateIndex((index) => {
    for (const asset of index.assets) {
      if (!ids.includes(asset.id)) continue;
      asset.lastUsedAt = now;
      if (!asset.usedIn.includes(runId)) asset.usedIn.push(runId);
    }
  });
}

export function findAsset(id: string): LibraryAsset | undefined {
  return loadIndex().assets.find((a) => a.id === id);
}
