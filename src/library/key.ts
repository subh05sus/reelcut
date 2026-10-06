import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { detectGreen, KEY_VERSION, keyVideo, sampleSmallFrames, unionBounds, type Bounds, type KeyParams } from "./chroma.js";
import { footageOf, requireVideo } from "./footage.js";
import { FootageSchema, KeySchema, type Key, type LibraryAsset, type Moment } from "./schema.js";
import { LibraryError, libraryRoot, loadIndex, mutateIndex } from "./store.js";

/**
 * Green-screen removal in the library: which recordings get keyed, the cached transparent copy, and where the
 * subject is in each moment.
 *
 * A recording with a detected green screen is keyed automatically, once, the first time anything needs it
 * (ingest queues it in the background; a render makes sure of it). The copy is cached beside the original
 * and reused until the settings, the algorithm or the source change. A person can turn it off, or tune it.
 */

/** Where the transparent copies live, relative to the library root. */
export const KEYED_DIR = "keyed";

export function keyOf(asset: LibraryAsset): Key {
  return footageOf(asset).key ?? KeySchema.parse({});
}

/** The backdrop colour: a person's choice, else what was found. `undefined` for a recording with no green screen. */
export function keyColor(asset: LibraryAsset): string | undefined {
  return keyOf(asset).color ?? asset.analysis.greenScreen?.color;
}

export function keyParams(asset: LibraryAsset): KeyParams | undefined {
  const color = keyColor(asset);
  if (!color) return undefined;
  const k = keyOf(asset);
  return { color, tolerance: k.tolerance, softness: k.softness, despill: k.despill, shadows: k.shadows, choke: k.choke };
}

/** What a keyed copy depends on. A different value means the copy is out of date. */
export function keyHash(asset: LibraryAsset): string | undefined {
  const params = keyParams(asset);
  if (!params) return undefined;
  return createHash("sha256").update(JSON.stringify({ v: KEY_VERSION, sha: asset.sha256, params, fps: asset.analysis.fps ?? 30 })).digest("hex").slice(0, 16);
}

/** Should this recording be keyed, whether or not it has been yet? */
export function wantsKey(asset: LibraryAsset): boolean {
  return asset.mediaType === "video" && asset.provenance.source !== "generated" && keyOf(asset).enabled && keyColor(asset) !== undefined;
}

/** Is there an up-to-date keyed copy on disk? */
export function isKeyed(asset: LibraryAsset): boolean {
  const k = keyOf(asset);
  return wantsKey(asset) && Boolean(k.file) && k.hash === keyHash(asset) && existsSync(path.join(libraryRoot(), k.file!));
}

export function keyedBlob(asset: LibraryAsset): string | undefined {
  const k = keyOf(asset);
  return k.file ? path.join(libraryRoot(), k.file) : undefined;
}

function sidecarPath(asset: Pick<LibraryAsset, "id">): string {
  return path.join(libraryRoot(), KEYED_DIR, `${asset.id}.json`);
}

interface Sidecar {
  version: number;
  hash: string;
  width: number;
  height: number;
  fps: number;
  frames: number;
  /** `[x0, y0, x1, y1]` per frame, or `null` for an empty frame. */
  bounds: ([number, number, number, number] | null)[];
}

function readSidecar(asset: LibraryAsset): Sidecar | undefined {
  try {
    const parsed = JSON.parse(readFileSync(sidecarPath(asset), "utf8")) as Sidecar;
    return parsed.hash === keyHash(asset) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Where the subject is during a moment, and how big it is in the keyed video's own pixels. */
export interface KeyView {
  /** The crop, as fractions of the keyed video. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The crop in pixels: the shape the box takes on the page. */
  px: { w: number; h: number };
}

/**
 * The crop for a moment: the union of where the subject is over the moment's frames, so a card that slides in
 * is not cut. `undefined` when there is nothing to crop to (the subject fills the frame, or there is no keyed copy).
 */
export function momentKeyView(asset: LibraryAsset, moment: Pick<Moment, "in" | "out">): KeyView | undefined {
  if (!isKeyed(asset)) return undefined;
  const side = readSidecar(asset);
  if (!side) return undefined;
  const bounds: (Bounds | null)[] = side.bounds.map((b) => (b ? { x0: b[0], y0: b[1], x1: b[2], y1: b[3] } : null));
  const size = { width: side.width, height: side.height };
  const u = unionBounds(bounds, side.fps, moment.in, moment.out, size, keyOf(asset).shadows === "keep" ? 8 : 2);
  if (!u) return undefined;
  const px = { w: u.x1 - u.x0, h: u.y1 - u.y0 };
  return { x: u.x0 / size.width, y: u.y0 / size.height, w: px.w / size.width, h: px.h / size.height, px };
}

// ---------------------------------------------------------------- finding a green screen

/**
 * Look at a recording that has not been looked at (one added before green-screen removal existed) and record
 * whether it is on a green screen. Cheap: six small frames.
 */
export function detectKey(id: string): LibraryAsset {
  const asset = loadIndex().assets.find((a) => a.id === id);
  if (!asset) throw new LibraryError(`no asset ${id}`);
  requireVideo(asset, id);
  if (asset.analysis.greenScreenChecked) return asset;
  const { width, height, durationSeconds } = asset.analysis;
  let found: ReturnType<typeof detectGreen> | undefined;
  if (width && height && durationSeconds) {
    try {
      found = detectGreen(sampleSmallFrames(path.join(libraryRoot(), asset.file), { width, height, durationSeconds }));
    } catch {
      return asset;
    }
  }
  return mutateIndex((index) => {
    const a = index.assets.find((x) => x.id === id)!;
    a.analysis = { ...a.analysis, greenScreenChecked: new Date().toISOString() };
    if (found?.detected) a.analysis.greenScreen = { color: found.color as `#${string}`, coverage: found.coverage, border: found.border };
    return a;
  });
}

// ---------------------------------------------------------------- making the keyed copy

const running = new Map<string, Promise<LibraryAsset>>();

export interface EnsureOptions {
  /** Make it again even if the copy is up to date. */
  force?: boolean;
  log?: (message: string) => void;
}

/**
 * Make sure a recording's keyed copy exists and is current. Returns the asset as it is after. A recording with
 * no green screen, or one a person turned keying off for, is returned untouched.
 */
export function ensureKeyed(id: string, options: EnsureOptions = {}): Promise<LibraryAsset> {
  const current = loadIndex().assets.find((a) => a.id === id);
  if (!current) return Promise.reject(new LibraryError(`no asset ${id}`));
  if (!wantsKey(current) || (isKeyed(current) && !options.force)) return Promise.resolve(current);
  const pending = running.get(id);
  if (pending) return pending;
  const job = makeKeyed(current, options).finally(() => running.delete(id));
  running.set(id, job);
  return job;
}

async function makeKeyed(asset: LibraryAsset, options: EnsureOptions): Promise<LibraryAsset> {
  const params = keyParams(asset)!;
  const hash = keyHash(asset)!;
  const width = asset.analysis.width;
  const height = asset.analysis.height;
  if (!width || !height) throw new LibraryError(`${asset.name}: its size is not known, so it cannot be keyed — run \`npm run footage -- analyze ${asset.id}\``);
  const fps = asset.analysis.fps ?? 30;
  const rel = `${KEYED_DIR}/${asset.id}.webm`;
  const source = path.join(libraryRoot(), asset.file);
  const started = Date.now();
  options.log?.(`keying "${asset.name}" (green screen ${params.color}), once: it is saved and reused`);
  try {
    const result = await keyVideo(source, path.join(libraryRoot(), rel), params, { width, height, fps }, (frames) => options.log?.(`  … ${frames} frames`));
    const side: Sidecar = {
      version: KEY_VERSION,
      hash,
      width,
      height,
      fps,
      frames: result.frames,
      bounds: result.bounds.map((b) => (b ? [b.x0, b.y0, b.x1, b.y1] : null)),
    };
    writeFileSync(sidecarPath(asset), JSON.stringify(side), "utf8");
    options.log?.(`  keyed ${result.frames} frames in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return mutateIndex((index) => {
      const a = requireVideo(index.assets.find((x) => x.id === asset.id), asset.id);
      const footage = footageOf(a);
      const key = { ...keyOf(a), file: rel, hash, keyedAt: new Date().toISOString() };
      delete (key as Partial<Key>).error;
      a.footage = FootageSchema.parse({ ...footage, key });
      return a;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    mutateIndex((index) => {
      const a = index.assets.find((x) => x.id === asset.id);
      if (a) a.footage = FootageSchema.parse({ ...footageOf(a), key: { ...keyOf(a), error: message.slice(0, 300) } });
    });
    throw new LibraryError(`could not key "${asset.name}": ${message}`);
  }
}

export interface KeyPatch {
  enabled?: boolean;
  color?: string | null;
  tolerance?: number;
  softness?: number;
  despill?: number;
  shadows?: "keep" | "drop";
  choke?: number;
}

/**
 * Change how a recording is keyed. The keyed copy is not remade here: its hash no longer matches, so the next
 * thing that needs it (a render, or `ensureKeyed`) remakes it.
 */
export function patchKey(id: string, patch: KeyPatch): LibraryAsset {
  return mutateIndex((index) => {
    const asset = requireVideo(index.assets.find((a) => a.id === id), id);
    const next: Record<string, unknown> = { ...keyOf(asset) };
    for (const [name, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (name === "color" && value === null) delete next.color;
      else next[name] = value;
    }
    const parsed = KeySchema.safeParse(next);
    if (!parsed.success) throw new LibraryError(parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; "));
    asset.footage = FootageSchema.parse({ ...footageOf(asset), key: parsed.data });
    return asset;
  });
}

/** Take a recording's keyed copy away (and forget it was made). */
export function dropKeyed(id: string): void {
  mutateIndex((index) => {
    const asset = index.assets.find((a) => a.id === id);
    if (!asset) return;
    const k = keyOf(asset);
    if (k.file) rmSync(path.join(libraryRoot(), k.file), { force: true });
    rmSync(sidecarPath(asset), { force: true });
    const { file: _file, hash: _hash, keyedAt: _keyedAt, ...rest } = k;
    asset.footage = FootageSchema.parse({ ...footageOf(asset), key: rest });
  });
}

// ---------------------------------------------------------------- in the background

let chain: Promise<void> = Promise.resolve();
const queued = new Set<string>();
const failures = new Map<string, string>();

/** Key a recording after the current work, one at a time. Never throws: a failure is kept for `keyingStatus`. */
export function scheduleKey(id: string, log?: (message: string) => void): void {
  if (queued.has(id)) return;
  queued.add(id);
  failures.delete(id);
  chain = chain.then(async () => {
    try {
      await ensureKeyed(id, { ...(log ? { log } : {}) });
    } catch (error) {
      failures.set(id, error instanceof Error ? error.message : String(error));
    } finally {
      queued.delete(id);
    }
  });
}

/** Wait for everything scheduled so far. */
export function settleKeying(): Promise<void> {
  return chain;
}

export type KeyingState = "queued" | "running" | "failed" | "idle";

export function keyingStatus(id: string): { state: KeyingState; error?: string } {
  if (running.has(id)) return { state: "running" };
  if (queued.has(id)) return { state: "queued" };
  const error = failures.get(id);
  return error ? { state: "failed", error } : { state: "idle" };
}
