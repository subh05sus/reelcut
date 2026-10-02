import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AssetKind } from "../brief/assetRequirementTypes.js";
import {
  LibraryIndexSchema,
  normaliseTags,
  type Analysis,
  type AssetStatus,
  type LibraryAsset,
  type LibraryIndex,
  type MediaType,
  type Provenance,
  type Review,
  type ReviewState,
  type TagOrigin,
} from "./schema.js";

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
  /** Defaults to `other`; ingest fills these from the file's own bytes. */
  mediaType?: MediaType;
  analysis?: Analysis;
  /** Defaults to approved by the CLI: adding an asset by hand is a decision. Ingest passes `pending`. */
  review?: Review;
  tagOrigin?: Record<string, TagOrigin>;
  folderId?: string;
  thumb?: string;
  private?: boolean;
}

export interface AddAssetResult {
  asset: LibraryAsset;
  /** True when the same bytes were already in the library and only their metadata was merged. */
  existed: boolean;
  /** Ingest only: the same bytes were rejected or retired earlier, and were not brought back. */
  blocked?: "rejected" | "retired";
}

/** An asset whose blob is on disk and whose analysis is done, ready to go into the index. */
export interface PreparedAsset {
  id: string;
  sha256: string;
  file: string;
  ext: string;
  bytes: number;
  name: string;
  assetKind: AssetKind;
  tags: string[];
  tagOrigin: Record<string, TagOrigin>;
  provenance: Provenance;
  mediaType: MediaType;
  analysis: Analysis;
  review: Review;
  folderId?: string | undefined;
  thumb?: string | undefined;
  private: boolean;
}

/** Keep `tagOrigin` to the tags that exist, and give every tag an origin (`user` when unknown). */
export function reconcileOrigins(tags: readonly string[], origin: Record<string, TagOrigin>, fallback: TagOrigin = "user"): Record<string, TagOrigin> {
  const out: Record<string, TagOrigin> = {};
  for (const tag of tags) out[tag] = origin[tag] ?? fallback;
  return out;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Put a prepared asset into an index that is already locked and loaded, or merge it with the one
 * that has the same bytes. The one place both `addAsset` and the batch ingest end up.
 *
 * `respectTombstones` is what keeps a rescan from undoing a decision: an asset that was rejected, or
 * retired, stays that way when the same file turns up again in a folder. A person adding the file by
 * hand is overriding that on purpose, so `addAsset` does not set it.
 */
export function insertPrepared(index: LibraryIndex, p: PreparedAsset, options: { now: string; respectTombstones: boolean }): AddAssetResult {
  const existing = index.assets.find((a) => a.sha256 === p.sha256);
  if (existing) {
    if (options.respectTombstones) {
      if (existing.review.state === "rejected") return { asset: existing, existed: true, blocked: "rejected" };
      if (existing.status === "retired" || existing.status === "superseded") return { asset: existing, existed: true, blocked: "retired" };
    }
    const merged = normaliseTags([...existing.tags, ...p.tags]);
    const origins: Record<string, TagOrigin> = { ...existing.tagOrigin };
    for (const tag of p.tags) {
      // A person's tag beats a machine's; a machine's tag never replaces what is already there.
      if (!origins[tag] || (p.tagOrigin[tag] === "user" && origins[tag] !== "user")) origins[tag] = p.tagOrigin[tag] ?? "user";
    }
    existing.tags = merged;
    existing.tagOrigin = reconcileOrigins(merged, origins);
    // Fill in provenance that was missing; never overwrite what was recorded first.
    existing.provenance = { ...p.provenance, ...stripUndefined(existing.provenance) };
    existing.analysis = { ...p.analysis, ...stripUndefined(existing.analysis) } as Analysis;
    if (existing.mediaType === "other" && p.mediaType !== "other") existing.mediaType = p.mediaType;
    if (!existing.thumb && p.thumb) existing.thumb = p.thumb;
    // Adding it on purpose approves it; a folder rediscovering it never un-approves it.
    if (existing.review.state === "pending" && p.review.state === "approved") existing.review = p.review;
    if (existing.review.state === "rejected" && p.review.state === "approved" && !options.respectTombstones) existing.review = p.review;
    return { asset: existing, existed: true };
  }

  const tags = normaliseTags(p.tags);
  const asset: LibraryAsset = {
    id: p.id,
    name: p.name,
    file: p.file,
    ext: p.ext,
    bytes: p.bytes,
    sha256: p.sha256,
    assetKind: p.assetKind,
    tags,
    provenance: p.provenance,
    addedAt: options.now,
    usedIn: [],
    status: "active",
    mediaType: p.mediaType,
    analysis: p.analysis,
    review: p.review,
    tagOrigin: reconcileOrigins(tags, p.tagOrigin),
    ...(p.folderId ? { folderId: p.folderId } : {}),
    ...(p.thumb ? { thumb: p.thumb } : {}),
    private: p.private,
  };
  index.assets.push(asset);
  return { asset, existed: false };
}

/**
 * Move or copy a file into the library as `files/<id>.<ext>`, unless those bytes are already there.
 * A move that crosses drives falls back to copy-and-delete.
 */
export function placeBlob(source: string, file: string, move: boolean): void {
  const target = path.join(libraryRoot(), file);
  mkdirSync(path.dirname(target), { recursive: true });
  if (existsSync(target)) {
    if (move) rmSync(source, { force: true });
    return;
  }
  if (!move) return void copyFileSync(source, target);
  try {
    renameSync(source, target);
  } catch {
    copyFileSync(source, target);
    unlinkSync(source);
  }
}

/**
 * Store a file and its provenance.
 *
 * Content-addressed: the same bytes added twice are one asset, with the tags merged. The file is
 * copied, never linked, so deleting `assets/in/` or an `out/` folder cannot break the library.
 * Adding by hand is a decision, so the asset is approved unless the caller says otherwise.
 */
export function addAsset(source: string, input: AddAssetInput): AddAssetResult {
  if (!existsSync(source) || !statSync(source).isFile()) throw new LibraryError(`${source} is not a file`);
  if ((input.provenance.source === "drawn" || input.provenance.source === "generated") && input.assetKind === "identity") {
    throw new LibraryError("an identity asset cannot be drawn or generated — a generated logo is a fabricated logo");
  }

  const sha256 = sha256Of(source);
  const id = sha256.slice(0, 16);
  const ext = path.extname(source).slice(1).toLowerCase();
  const file = `files/${id}${ext ? `.${ext}` : ""}`;
  const now = new Date().toISOString();
  const tags = normaliseTags(input.tags ?? []);

  const prepared: PreparedAsset = {
    id,
    sha256,
    file,
    ext,
    bytes: statSync(source).size,
    name: input.name,
    assetKind: input.assetKind,
    tags,
    tagOrigin: input.tagOrigin ?? Object.fromEntries(tags.map((t) => [t, "user" as const])),
    provenance: input.provenance,
    mediaType: input.mediaType ?? "other",
    analysis: input.analysis ?? { dominantColors: [], descriptors: [] },
    review: input.review ?? { state: "approved", by: "cli", at: now },
    folderId: input.folderId,
    thumb: input.thumb,
    private: input.private ?? false,
  };

  return mutateIndex((index) => {
    const result = insertPrepared(index, prepared, { now, respectTombstones: false });
    if (!result.existed) placeBlob(source, file, false);
    return result;
  });
}

export interface AssetPatch {
  name?: string;
  /** Replaces the tag list. Tags that were not there before are the person's own. */
  tags?: readonly string[];
  addTags?: readonly string[];
  removeTags?: readonly string[];
  status?: AssetStatus;
  supersededBy?: string;
  note?: string;
  /** Only a person decides that something is an identity asset; the dashboard sends this. */
  assetKind?: AssetKind;
  description?: string;
}

export function updateAsset(id: string, patch: AssetPatch): LibraryAsset {
  return mutateIndex((index) => {
    const asset = index.assets.find((a) => a.id === id);
    if (!asset) throw new LibraryError(`no asset ${id}`);
    if (patch.supersededBy !== undefined && !index.assets.some((a) => a.id === patch.supersededBy)) {
      throw new LibraryError(`no asset ${patch.supersededBy} to supersede ${id} with`);
    }
    if (patch.name !== undefined) asset.name = patch.name;
    const before = new Set(asset.tags);
    let tags = patch.tags ? [...patch.tags] : [...asset.tags];
    tags.push(...(patch.addTags ?? []));
    const remove = new Set(normaliseTags(patch.removeTags ?? []));
    tags = normaliseTags(tags).filter((t) => !remove.has(t));
    asset.tags = tags;
    // A tag a person adds is theirs; one that was already there keeps whoever wrote it.
    const origins: Record<string, TagOrigin> = { ...asset.tagOrigin };
    for (const tag of tags) if (!before.has(tag)) origins[tag] = "user";
    asset.tagOrigin = reconcileOrigins(tags, origins);
    if (patch.status !== undefined) asset.status = patch.status;
    if (patch.supersededBy !== undefined) {
      asset.status = "superseded";
      asset.supersededBy = patch.supersededBy;
    }
    if (patch.note !== undefined) asset.provenance.note = patch.note;
    if (patch.assetKind !== undefined) {
      if (patch.assetKind === "identity" && (asset.provenance.source === "drawn" || asset.provenance.source === "generated")) throw new LibraryError("an identity asset cannot be drawn or generated");
      asset.assetKind = patch.assetKind;
    }
    if (patch.description !== undefined) asset.analysis = { ...asset.analysis, description: patch.description };
    return asset;
  });
}

export interface ReviewResult {
  asset: LibraryAsset;
  /** Machine-written tags that were still there when a person approved the asset: they were accepted. */
  accepted: string[];
}

/**
 * Approve, reject or reopen assets. Approving is the human step the reuse policy waits for, so it
 * also turns the machine's tags into reviewed ones: the person looked at the asset and the tags,
 * and removed any they disagreed with before pressing the button.
 *
 * `kind` is only ever set here, by a person. Nothing in ingest or analysis can make an asset an
 * identity asset — a mis-tagged file must not become somebody's logo.
 */
export function setReview(ids: readonly string[], state: ReviewState, by: NonNullable<Review["by"]>, options: { kind?: AssetKind } = {}): ReviewResult[] {
  const now = new Date().toISOString();
  return mutateIndex((index) => {
    const out: ReviewResult[] = [];
    for (const id of ids) {
      const asset = index.assets.find((a) => a.id === id);
      if (!asset) continue;
      const accepted = state === "approved" ? asset.tags.filter((t) => (asset.tagOrigin[t] ?? "user") !== "user") : [];
      asset.review = { state, by, at: now };
      if (state === "approved") asset.tagOrigin = reconcileOrigins(asset.tags, {}, "user");
      if (options.kind) {
        if (options.kind === "identity" && (asset.provenance.source === "drawn" || asset.provenance.source === "generated")) throw new LibraryError("an identity asset cannot be drawn or generated");
        asset.assetKind = options.kind;
      }
      out.push({ asset, accepted });
    }
    return out;
  });
}

export interface Annotation {
  /** Tags Claude suggests. They are added as `claude`-origin and never overwrite a person's. */
  tags?: readonly string[];
  description?: string;
}

/**
 * Claude's contribution to the review queue: tags and a description, nothing else.
 *
 * It cannot approve, cannot touch the kind, and cannot remove a tag. The asset stays pending until
 * a person looks at what Claude said.
 */
export function annotateAsset(id: string, annotation: Annotation): LibraryAsset {
  return mutateIndex((index) => {
    const asset = index.assets.find((a) => a.id === id);
    if (!asset) throw new LibraryError(`no asset ${id}`);
    const fresh = normaliseTags(annotation.tags ?? []).filter((t) => !asset.tags.includes(t));
    asset.tags = normaliseTags([...asset.tags, ...fresh]);
    const origins: Record<string, TagOrigin> = { ...asset.tagOrigin };
    for (const tag of fresh) origins[tag] = "claude";
    asset.tagOrigin = reconcileOrigins(asset.tags, origins);
    if (annotation.description !== undefined) asset.analysis = { ...asset.analysis, description: annotation.description.slice(0, 400) };
    return asset;
  });
}

/** The blob-relative preview path, when the asset has one. */
export function thumbBlobPath(asset: Pick<LibraryAsset, "thumb">): string | undefined {
  return asset.thumb ? path.join(libraryRoot(), asset.thumb) : undefined;
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
