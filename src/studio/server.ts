import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AssetKindSchema } from "../brief/assetRequirementTypes.js";
import {
  assetSignals,
  createRule,
  deleteRule,
  exportLearnings,
  importLearnings,
  loadLearnings,
  promoteNote,
  recordSignals,
  reinfer,
  rerenderSignal,
  thumbSignal,
  noteSignal,
  updateRule,
} from "../learnings/index.js";
import { RuleStatusSchema, SubjectSchema } from "../learnings/schema.js";
import { addFolder, listFolders, removeFolder, updateFolder } from "../library/folders.js";
import { IngestManager } from "../library/ingestManager.js";
import { IngestError, ingestBatch, maxFileBytes, streamToTemp, type IngestSource } from "../library/ingest.js";
import { summarise } from "../library/journal.js";
import { claudeQueue, needsClaude } from "../library/queue.js";
import { blobPath, findAsset, LibraryError, libraryRoot, loadIndex, setReview, thumbBlobPath, updateAsset, type AssetPatch } from "../library/store.js";
import { editPattern, loadPatterns, patternHtmlPath, patternThumbPath, rankPatterns, ratePatternUse, removePattern, savePatternFromBeat, unsaveFromBeat, type PersonalPattern } from "../patterns/mine.js";
import { pairingIn } from "../fonts/index.js";
import { loadSfxPack, packSoundPath } from "../library/sfxpack.js";
import { detectKey, isKeyed, keyedBlob, keyingStatus, keyOf, patchKey, scheduleKey, wantsKey, type KeyPatch } from "../library/key.js";
import { addMoment, findMoments, patchFootage, refreshFootageAnalysis, removeMoment, updateMoment, type FootagePatch, type MomentInput, type MomentPatch } from "../library/footage.js";
import { PLATFORMS } from "../library/schema.js";
import { HIGGSFIELD_SETTINGS, loadSettings, setHiggsfieldSetting, type HiggsfieldSetting } from "../library/settings.js";
import { readGeneration } from "../generate/log.js";
import { CreateManager, filesDir as createFilesDir, insideAllowed, reelState } from "../create/manager.js";
import { readIntegrations } from "../create/integrations.js";

/** The Personality wizard's steps, in order (the page's PZ_STEPS). */
const PZ_STEP_IDS = ["start", "styles", "mixer", "colours", "fonts", "motion", "texture", "signature", "copy", "sound", "pacing", "guardrails", "review"];
import { drawPrompt } from "../create/draw.js";
import { addPerformance, analysisPrompt, importPrompt, insights, latest, readPerformance, reelFacts, type PerfRow } from "../create/performance.js";
import { cloudflaredPath, createShare, daemonState, ensureReviewDaemon, liveShare, loadShares, reviewUrl, revokeShare, sharesFor, stopReviewDaemon } from "../create/share.js";
import { writeCaptions } from "../create/captions.js";
import { coverFrames, LIMITS, makeCover, postKitPrompt, readCovers, readPostKit, PLATFORMS as POST_PLATFORMS, type Platform } from "../create/postkit.js";
import { getRecipe, listRecipes, recipePrompt, removeRecipe, saveRecipe } from "../create/recipes.js";
import { addEpisode, getSeries, listSeries, removeSeries, saveSeries, seriesPrompt } from "../create/series.js";
import { addComment, beatText, commentsPrompt, editPrompt, loadComments, readReel, removeComment, updateComment, type EditAction } from "../create/edits.js";
import { FAMILIES, PAIRINGS, fontFaceCss, loadFontLibrary } from "../fonts/index.js";
import { reelcutHome } from "../library/store.js";
import {
  STYLES, STYLE_TENSIONS, brandPalette, checkPersonality, deletePersonality, fromTaste, getPersonality, importBrand, loadPersonalities,
  PersonalitySchema, savePersonality, setDefaultPersonality, styleById, surprise, type Locks,
} from "../personality/index.js";
import { acceptAnnotation, annotateReference, buildReferenceBrief, ingestReferenceUpload, loadReferences, referenceBlobPath, referenceSheetPath, referenceThumbPath, removeReference, studyQueue, updateReference, type Reference } from "../references/index.js";
import type { LibraryAsset } from "../library/schema.js";
import { filterByTags } from "../library/match.js";
import { findRun, listRuns } from "../library/runs.js";
import { AssetStatusSchema, MediaTypeSchema, ReviewStateSchema } from "../library/schema.js";

/**
 * The studio: a local page for the library and every rendered reel.
 *
 *   npm run studio            -> http://localhost:5198
 *
 * No framework and no dependency beyond Node, because this ships inside a skill that is installed
 * as a plugin and should not bring a build step with it.
 *
 * ## What it will not do
 *
 * The library holds captures of real product screens, and the render folders hold whatever those
 * captures became. So:
 *   - it listens on 127.0.0.1 only, and rejects any request whose Host is not its own — a web page
 *     on another origin cannot reach it through DNS rebinding;
 *   - a write whose Origin is another site is refused;
 *   - files are served by asset id, or by a path that must resolve inside a *recorded* run's
 *     output folder — never by an arbitrary path;
 *   - everything under /files is served sandboxed, so an SVG carrying a script cannot run it here.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
export const DEFAULT_PORT = 5198;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".srt": "application/x-subrip; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".aiff": "audio/aiff",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
};

export interface Job {
  id: string;
  runId: string;
  beat: string;
  status: "running" | "ok" | "failed";
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  log: string[];
}

export interface StudioOptions {
  /** How a re-render is started. Injected by the tests; defaults to `render.ts --only`. */
  spawnRender?: (manifest: string, beat: string) => ChildProcess;
  /** The folder watcher. Tests pass one that does not watch; the real one starts with the studio. */
  ingest?: IngestManager;
}

function defaultSpawnRender(manifest: string, beat: string): ChildProcess {
  const tsx = createRequire(import.meta.url).resolve("tsx/cli");
  const script = path.join(REPO, "skills", "reelcut", "scripts", "render.ts");
  return spawn(process.execPath, [tsx, script, manifest, "--only", beat, "--clips-only"], { cwd: REPO, windowsHide: true });
}

function writeFileSyncSafe(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** Where the twenty style previews are rendered to, once (`npm run personality -- previews`). */
export const stylePreviewDir = (): string => path.join(reelcutHome(), "style-previews");

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly body?: unknown) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": TYPES[".json"]!, "Cache-Control": "no-store" });
  res.end(text);
}

async function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, "body too large");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "body is not JSON");
  }
}

/** `path` inside `root`, or undefined when it resolves anywhere else. */
export function containedPath(root: string, relative: string): string | undefined {
  const base = path.resolve(root);
  const target = path.resolve(base, relative);
  const rel = path.relative(base, target);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  return target;
}

/** Stream a file, honouring a single `Range: bytes=` request so video can seek. */
function sendFile(req: IncomingMessage, res: ServerResponse, file: string): void {
  let size: number;
  try {
    const stat = statSync(file);
    if (!stat.isFile()) throw new Error("not a file");
    size = stat.size;
  } catch {
    throw new HttpError(404, "no such file");
  }
  const headers: Record<string, string | number> = {
    "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
  };

  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start = match?.[1] ? Number(match[1]) : NaN;
    let end = match?.[2] ? Number(match[2]) : NaN;
    if (match && !match[1] && match[2]) {
      // A suffix range: the last N bytes.
      start = Math.max(0, size - Number(match[2]));
      end = size - 1;
    } else if (Number.isNaN(end)) {
      end = size - 1;
    }
    if (!match || Number.isNaN(start) || start > end || start >= size) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      res.end();
      return;
    }
    end = Math.min(end, size - 1);
    res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
    if (req.method === "HEAD") return void res.end();
    createReadStream(file, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, { ...headers, "Content-Length": size });
  if (req.method === "HEAD") return void res.end();
  createReadStream(file).pipe(res);
}

function readIfPresent(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

/** A file name from a header: no folders, no control characters, never empty, never long. */
export function cleanName(raw: string): string {
  const base = raw.replace(/[\\/]+/g, "/").split("/").pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]+/g, "").trim().slice(0, 120);
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : "upload";
}

/**
 * The folder an uploaded file came from, as words only. It is never used as a place on disk — an
 * upload is always written to a temp file the server names — so `..` can do nothing here, and is
 * dropped anyway.
 */
export function cleanRelPath(raw: string): string | undefined {
  const segments = raw
    .split(/[\\/]+/)
    .map((s) => s.trim())
    .filter((s) => s && s !== "." && s !== "..")
    .slice(0, 8)
    // eslint-disable-next-line no-control-regex
    .map((s) => s.replace(/[\u0000-\u001f]+/g, "").slice(0, 60));
  return segments.length ? segments.join("/") : undefined;
}

/** An asset as the page sees it: the index entry plus whether it is waiting for Claude and where its preview is. */
export function publicPattern(p: PersonalPattern): PersonalPattern & { thumbUrl?: string; path: string } {
  return { ...p, path: patternHtmlPath(p.id), ...(existsSync(patternThumbPath(p.id)) ? { thumbUrl: `/files/pattern-thumb/${p.id}?v=${encodeURIComponent(p.savedAt)}` } : {}) };
}

export function publicAsset(a: LibraryAsset): LibraryAsset & { queued: boolean; thumbUrl?: string; stripUrl?: string; keyedUrl?: string; keying?: { wanted: boolean; keyed: boolean; state: string; error?: string } } {
  const green = a.mediaType === "video" && (a.analysis.greenScreen !== undefined || keyOf(a).color !== undefined);
  return {
    ...a,
    queued: needsClaude(a),
    ...(a.thumb ? { thumbUrl: `/files/thumb/${a.id}` } : {}),
    ...(a.analysis.filmstrip ? { stripUrl: `/files/strip/${a.id}` } : {}),
    ...(green && isKeyed(a) ? { keyedUrl: `/files/keyed/${a.id}?v=${keyOf(a).hash ?? ""}` } : {}),
    ...(green ? { keying: { wanted: wantsKey(a), keyed: isKeyed(a), ...keyingStatus(a.id), ...(keyOf(a).error ? { error: keyOf(a).error } : {}) } } : {}),
  };
}

/** A reference as the page sees it: the record plus where its pictures and video are. */
export function publicReference(r: Reference): Reference & { thumbUrl?: string; sheetUrl?: string; videoUrl: string; queued: boolean } {
  return {
    ...r,
    videoUrl: `/files/reference/${r.id}`,
    ...(r.thumb ? { thumbUrl: `/files/reference-thumb/${r.id}` } : {}),
    ...(r.sheet ? { sheetUrl: `/files/reference-sheet/${r.id}` } : {}),
    queued: r.include && !r.annotation,
  };
}

function numberField(b: Record<string, unknown>, name: string): number | undefined {
  if (b[name] === undefined) return undefined;
  if (typeof b[name] !== "number" || !Number.isFinite(b[name])) throw new HttpError(400, `${name} must be a number`);
  return b[name] as number;
}

function focusField(b: Record<string, unknown>): Record<string, { x: number; y: number; w: number; h: number }> | undefined {
  if (b.focus === undefined) return undefined;
  if (typeof b.focus !== "object" || b.focus === null || Array.isArray(b.focus)) throw new HttpError(400, "focus must be an object keyed by format, like {\"1:1\": {x, y, w, h}}");
  return b.focus as Record<string, { x: number; y: number; w: number; h: number }>;
}

/** What the Footage tab sends for a moment. Only a person's edit: `origin` and `state` are not accepted here. */
function toMomentPatch(body: unknown): MomentPatch {
  if (typeof body !== "object" || body === null) throw new HttpError(400, "expected an object");
  const b = body as Record<string, unknown>;
  if (b.label !== undefined && typeof b.label !== "string") throw new HttpError(400, "label must be a string");
  if (b.note !== undefined && typeof b.note !== "string") throw new HttpError(400, "note must be a string");
  if (b.tags !== undefined && (!Array.isArray(b.tags) || !b.tags.every((t) => typeof t === "string"))) throw new HttpError(400, "tags must be a list of strings");
  const focus = focusField(b);
  const i = numberField(b, "in");
  const o = numberField(b, "out");
  return {
    ...(b.label !== undefined ? { label: b.label as string } : {}),
    ...(i !== undefined ? { in: i } : {}),
    ...(o !== undefined ? { out: o } : {}),
    ...(b.tags !== undefined ? { tags: b.tags as string[] } : {}),
    ...(focus ? { focus } : {}),
    ...(b.note !== undefined ? { note: b.note as string } : {}),
    ...(b.confirm === true ? { confirm: true } : {}),
  };
}

function toFootagePatch(body: unknown): FootagePatch {
  if (typeof body !== "object" || body === null) throw new HttpError(400, "expected an object");
  const b = body as Record<string, unknown>;
  const patch: FootagePatch = {};
  if (b.app !== undefined) {
    if (typeof b.app !== "string") throw new HttpError(400, "app must be a string");
    patch.app = b.app;
  }
  if (b.platform !== undefined) {
    if (typeof b.platform !== "string" || !(PLATFORMS as readonly string[]).includes(b.platform)) throw new HttpError(400, `platform must be one of ${PLATFORMS.join(", ")}`);
    patch.platform = b.platform as (typeof PLATFORMS)[number];
  }
  if (b.recordedAt !== undefined) {
    if (typeof b.recordedAt !== "string") throw new HttpError(400, "recordedAt must be a date");
    patch.recordedAt = b.recordedAt;
  }
  if (b.muted !== undefined) {
    if (typeof b.muted !== "boolean") throw new HttpError(400, "muted must be true or false");
    patch.muted = b.muted;
  }
  const textPx = numberField(b, "textPx");
  if (textPx !== undefined) patch.textPx = textPx;
  if (b.privateChecked !== undefined) {
    if (typeof b.privateChecked !== "boolean") throw new HttpError(400, "privateChecked must be true or false");
    patch.privateChecked = b.privateChecked;
  }
  return patch;
}

function toKeyPatch(body: unknown): KeyPatch {
  if (typeof body !== "object" || body === null) throw new HttpError(400, "expected an object");
  const b = body as Record<string, unknown>;
  const patch: KeyPatch = {};
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== "boolean") throw new HttpError(400, "enabled must be true or false");
    patch.enabled = b.enabled;
  }
  if (b.color !== undefined) {
    if (b.color !== null && (typeof b.color !== "string" || !/^#[0-9a-f]{6}$/i.test(b.color))) throw new HttpError(400, "color must look like #00f600");
    patch.color = b.color === null ? null : (b.color as string).toLowerCase();
  }
  for (const name of ["tolerance", "softness", "despill"] as const) {
    const v = numberField(b, name);
    if (v !== undefined) patch[name] = v;
  }
  const choke = numberField(b, "choke");
  if (choke !== undefined) patch.choke = Math.round(choke);
  if (b.shadows !== undefined) {
    if (b.shadows !== "keep" && b.shadows !== "drop") throw new HttpError(400, "shadows must be keep or drop");
    patch.shadows = b.shadows;
  }
  return patch;
}

function toPatch(body: unknown): AssetPatch {
  if (typeof body !== "object" || body === null) throw new HttpError(400, "expected an object");
  const b = body as Record<string, unknown>;
  const patch: AssetPatch = {};
  const strings = (v: unknown, field: string): string[] => {
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) throw new HttpError(400, `${field} must be a list of strings`);
    return v as string[];
  };
  if (b.name !== undefined) {
    if (typeof b.name !== "string" || !b.name.trim()) throw new HttpError(400, "name must be a non-empty string");
    patch.name = b.name.trim();
  }
  if (b.tags !== undefined) patch.tags = strings(b.tags, "tags");
  if (b.addTags !== undefined) patch.addTags = strings(b.addTags, "addTags");
  if (b.removeTags !== undefined) patch.removeTags = strings(b.removeTags, "removeTags");
  if (b.status !== undefined) {
    const parsed = AssetStatusSchema.safeParse(b.status);
    if (!parsed.success) throw new HttpError(400, "status must be active, superseded or retired");
    patch.status = parsed.data;
  }
  if (b.supersededBy !== undefined) {
    if (typeof b.supersededBy !== "string") throw new HttpError(400, "supersededBy must be an asset id");
    patch.supersededBy = b.supersededBy;
  }
  if (b.note !== undefined) {
    if (typeof b.note !== "string") throw new HttpError(400, "note must be a string");
    patch.note = b.note;
  }
  if (b.assetKind !== undefined) {
    const kind = AssetKindSchema.safeParse(b.assetKind);
    if (!kind.success) throw new HttpError(400, "assetKind must be identity or generic");
    patch.assetKind = kind.data;
  }
  if (b.description !== undefined) {
    if (typeof b.description !== "string") throw new HttpError(400, "description must be a string");
    patch.description = b.description.slice(0, 400);
  }
  return patch;
}

export function createStudioServer(options: StudioOptions = {}): http.Server {
  const spawnRender = options.spawnRender ?? defaultSpawnRender;
  const ingest = options.ingest ?? new IngestManager();
  // Learning must never be the reason a request fails: a signal that cannot be written is dropped.
  const safely = (fn: () => void): void => {
    try {
      fn();
    } catch {
      // not recorded
    }
  };
  const learn = {
    onReview: (results: { asset: LibraryAsset; accepted: string[] }[], state: string): void =>
      safely(() => {
        if (state !== "approved") return;
        const at = new Date().toISOString();
        const signals = results.flatMap((r) => assetSignals({ after: r.asset, accepted: r.accepted, at }));
        if (signals.length) recordSignals(signals);
      }),
  };
  const jobs: Job[] = [];
  let jobSeq = 0;
  /** Create conversations: made on first use, so a studio that never opens Create never touches them. */
  let create: CreateManager | undefined;
  // Shared review links live in their own background process (the review daemon), so restarting the studio never takes
  // one down. When the studio starts and links are live but the daemon is not, it is started again.
  if (loadShares().some((x) => liveShare(x)) && !daemonState() && cloudflaredPath()) void ensureReviewDaemon().catch(() => undefined);
  const page = () => readFileSync(path.join(HERE, "index.html"), "utf8");

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (res.headersSent) return void res.destroy();
      if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message, ...(error.body ? { detail: error.body } : {}) });
      if (error instanceof LibraryError) return sendJson(res, 400, { error: error.message });
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });

  function ownPort(): number {
    const address = server.address();
    return typeof address === "object" && address ? address.port : 0;
  }

  function checkOrigin(req: IncomingMessage): void {
    const port = ownPort();
    const own = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
    if (!own.has(req.headers.host ?? "")) throw new HttpError(403, "wrong host");
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      const origin = req.headers.origin;
      if (origin && !own.has(origin.replace(/^https?:\/\//, ""))) throw new HttpError(403, "cross-origin write refused");
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    checkOrigin(req);
    const url = new URL(req.url ?? "/", "http://localhost");
    let parts: string[];
    try {
      parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    } catch {
      throw new HttpError(400, "bad path");
    }
    const method = req.method ?? "GET";
    const read = method === "GET" || method === "HEAD";

    if (read && parts.length === 0) {
      res.writeHead(200, { "Content-Type": TYPES[".html"]!, "Cache-Control": "no-store" });
      return void res.end(page());
    }

    // Lets a second `npm run studio` find this one instead of starting another.
    if (read && parts[0] === "api" && parts[1] === "ping" && parts.length === 2) {
      return sendJson(res, 200, { studio: "reelcut", library: libraryRoot() });
    }

    // ---- library
    if (parts[0] === "api" && parts[1] === "assets" && parts[2] !== "review") {
      if (read && parts.length === 2) {
        const tags = (url.searchParams.get("tags") ?? "").split(",").filter(Boolean);
        const q = (url.searchParams.get("q") ?? "").toLowerCase();
        const type = MediaTypeSchema.safeParse(url.searchParams.get("type"));
        const review = ReviewStateSchema.safeParse(url.searchParams.get("review"));
        const folder = url.searchParams.get("folder") ?? "";
        const all = loadIndex().assets;
        const assets = filterByTags(all, tags)
          .filter((a) => !q || `${a.name} ${a.tags.join(" ")} ${a.provenance.url ?? ""} ${a.analysis.description ?? ""}`.toLowerCase().includes(q))
          .filter((a) => !type.success || a.mediaType === type.data)
          .filter((a) => !review.success || a.review.state === review.data)
          .filter((a) => !folder || a.folderId === folder);
        const counts = {
          all: all.length,
          pending: all.filter((a) => a.review.state === "pending").length,
          queue: claudeQueue(all).length,
          audio: all.filter((a) => a.mediaType === "audio").length,
          footage: all.filter((a) => a.mediaType === "video" && a.review.state !== "rejected").length,
        };
        // `limit=0` is how the page asks for the badge counts without the assets.
        const limit = url.searchParams.has("limit") ? Math.max(0, Number(url.searchParams.get("limit")) || 0) : undefined;
        const sorted = assets.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
        return sendJson(res, 200, { assets: (limit === undefined ? sorted : sorted.slice(0, limit)).map(publicAsset), counts });
      }
      if (method === "PATCH" && parts.length === 3) {
        const patch = toPatch(await readBody(req));
        const before = findAsset(parts[2]!);
        const asset = updateAsset(parts[2]!, patch);
        safely(() => {
          const signals = assetSignals({ before, after: asset, at: new Date().toISOString() });
          if (signals.length) recordSignals(signals);
        });
        return sendJson(res, 200, { asset: publicAsset(asset) });
      }
    }
    // ---- settings that are not a master pause: for now, whether a reel may use Higgsfield
    if (parts[0] === "api" && parts[1] === "settings") {
      if (read && parts.length === 2) return sendJson(res, 200, { higgsfield: loadSettings().higgsfield, options: HIGGSFIELD_SETTINGS });
      if (method === "POST" && parts[2] === "higgsfield" && parts.length === 3) {
        const b = (await readBody(req)) as { value?: unknown };
        if (typeof b.value !== "string" || !(HIGGSFIELD_SETTINGS as readonly string[]).includes(b.value)) throw new HttpError(400, `value must be one of ${HIGGSFIELD_SETTINGS.join(", ")}`);
        return sendJson(res, 200, { higgsfield: setHiggsfieldSetting(b.value as HiggsfieldSetting).higgsfield });
      }
    }

    // ---- references: other people's films, kept to learn from. Their own index; nothing here is an asset.
    if (parts[0] === "api" && parts[1] === "references") {
      if (read && parts.length === 2) {
        const refs = loadReferences().references;
        return sendJson(res, 200, {
          references: [...refs].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).map(publicReference),
          brief: buildReferenceBrief(refs),
          counts: { all: refs.length, included: refs.filter((r) => r.include).length, queue: studyQueue(refs).length },
          command: "/reelcut study-references",
        });
      }
      if (method === "POST" && parts[2] === "upload" && parts.length === 3) {
        const length = Number(req.headers["content-length"]);
        if (!Number.isFinite(length) || length <= 0) throw new HttpError(411, "Content-Length is required: send the file as the request body");
        if (length > maxFileBytes()) throw new HttpError(413, `larger than the ${Math.round(maxFileBytes() / 1024 / 1024)} MB limit`);
        let name: string;
        try {
          name = cleanName(decodeURIComponent(typeof req.headers["x-reelcut-name"] === "string" ? req.headers["x-reelcut-name"] : "reference"));
        } catch {
          throw new HttpError(400, "bad file name header");
        }
        const outcome = await ingestReferenceUpload(req, name);
        const ref = outcome.id ? loadReferences().references.find((r) => r.id === outcome.id) : undefined;
        return sendJson(res, outcome.state === "added" ? 201 : outcome.state === "duplicate" ? 200 : 422, { outcome, ...(ref ? { reference: publicReference(ref) } : {}) });
      }
      if (method === "PATCH" && parts.length === 3) {
        const b = (await readBody(req)) as Record<string, unknown>;
        const id = parts[2]!;
        if (b.name !== undefined && typeof b.name !== "string") throw new HttpError(400, "name must be a string");
        if (b.include !== undefined && typeof b.include !== "boolean") throw new HttpError(400, "include must be true or false");
        if (b.moves !== undefined && (!Array.isArray(b.moves) || !b.moves.every((m) => typeof m === "string"))) throw new HttpError(400, "moves must be a list of move words");
        if (b.textStyle !== undefined && typeof b.textStyle !== "string") throw new HttpError(400, "textStyle must be a word");
        if (b.note !== undefined && typeof b.note !== "string") throw new HttpError(400, "note must be a string");
        let ref = loadReferences().references.find((r) => r.id === id);
        if (!ref) throw new HttpError(404, "no such reference");
        if (b.name !== undefined || b.include !== undefined) ref = updateReference(id, { ...(b.name !== undefined ? { name: b.name as string } : {}), ...(b.include !== undefined ? { include: b.include as boolean } : {}) });
        // A person's edit to the tags is accepted as it is written. Claude's tags only ever come in through the CLI.
        if (b.moves !== undefined || b.textStyle !== undefined || b.note !== undefined) {
          ref = annotateReference(id, { ...(b.moves !== undefined ? { moves: b.moves as string[] } : {}), ...(b.textStyle !== undefined ? { textStyle: b.textStyle as string } : {}), ...(b.note !== undefined ? { note: b.note as string } : {}) }, "user");
        } else if (b.accept === true) {
          ref = acceptAnnotation(id);
        }
        return sendJson(res, 200, { reference: publicReference(ref), brief: buildReferenceBrief(loadReferences().references) });
      }
      if (method === "DELETE" && parts.length === 3) {
        if (!loadReferences().references.some((r) => r.id === parts[2])) throw new HttpError(404, "no such reference");
        removeReference(parts[2]!);
        return sendJson(res, 200, { ok: true, brief: buildReferenceBrief(loadReferences().references) });
      }
    }

    // ---- footage: recordings, the moments marked on them, and a person's yes to using one
    if (parts[0] === "api" && parts[1] === "footage" && parts[2] === "find" && read && parts.length === 3) {
      const phrase = url.searchParams.get("q") ?? "";
      const matches = findMoments(loadIndex().assets, phrase).slice(0, 20);
      return sendJson(res, 200, { matches: matches.map((m) => ({ ref: `${m.asset.id}:${m.moment.id}`, label: m.moment.label, confidence: m.confidence, decision: m.decision, why: m.why, asset: m.asset.name })) });
    }
    if (parts[0] === "api" && parts[1] === "assets" && parts.length >= 4 && parts[3] === "footage" && method === "PATCH" && parts.length === 4) {
      const asset = patchFootage(parts[2]!, toFootagePatch(await readBody(req)));
      return sendJson(res, 200, { asset: publicAsset(asset) });
    }
    // ---- green screens: detected on ingest and keyed in the background; these tune it and say how it is going
    if (parts[0] === "api" && parts[1] === "footage" && parts[2] === "key-scan" && method === "POST" && parts.length === 3) {
      // Recordings added before green-screen removal existed are looked at once; anything on a green screen is queued.
      const queued: string[] = [];
      for (const a of loadIndex().assets.filter((x) => x.mediaType === "video" && x.status === "active" && x.review.state !== "rejected")) {
        const looked = detectKey(a.id);
        if (wantsKey(looked) && !isKeyed(looked) && keyingStatus(a.id).state === "idle") {
          scheduleKey(a.id);
          queued.push(a.id);
        }
      }
      return sendJson(res, 200, { queued });
    }
    if (parts[0] === "api" && parts[1] === "assets" && parts.length === 4 && parts[3] === "key") {
      if (!findAsset(parts[2]!)) throw new HttpError(404, "no such asset");
      if (method === "PATCH") {
        const asset = patchKey(parts[2]!, toKeyPatch(await readBody(req)));
        // The copy is made again in the background; its hash no longer matches, so nothing uses the old one meanwhile.
        if (wantsKey(asset)) scheduleKey(asset.id);
        return sendJson(res, 200, { asset: publicAsset(asset) });
      }
      if (read) return sendJson(res, 200, { asset: publicAsset(findAsset(parts[2]!)!) });
    }
    if (parts[0] === "api" && parts[1] === "assets" && parts.length === 4 && parts[3] === "analyze" && method === "POST") {
      const found = findAsset(parts[2]!);
      if (!found) throw new HttpError(404, "no such asset");
      return sendJson(res, 200, { asset: publicAsset(await refreshFootageAnalysis(parts[2]!)) });
    }
    if (parts[0] === "api" && parts[1] === "assets" && parts[3] === "moments") {
      if (method === "POST" && parts.length === 4) {
        const patch = toMomentPatch(await readBody(req));
        if (typeof patch.label !== "string" || patch.in === undefined || patch.out === undefined) throw new HttpError(400, "a moment needs a label, an in time and an out time");
        const input: MomentInput = { label: patch.label, in: patch.in, out: patch.out, ...(patch.tags ? { tags: patch.tags } : {}), ...(patch.focus ? { focus: patch.focus } : {}), ...(patch.note ? { note: patch.note } : {}) };
        const { asset, moment } = addMoment(parts[2]!, input, "user");
        return sendJson(res, 201, { asset: publicAsset(asset), moment });
      }
      if (method === "PATCH" && parts.length === 5) {
        const { asset, moment } = updateMoment(parts[2]!, parts[4]!, toMomentPatch(await readBody(req)));
        return sendJson(res, 200, { asset: publicAsset(asset), moment });
      }
      if (method === "DELETE" && parts.length === 5) {
        return sendJson(res, 200, { asset: publicAsset(removeMoment(parts[2]!, parts[4]!)) });
      }
    }
    if (read && parts[0] === "api" && parts[1] === "tags" && parts.length === 2) {
      const counts: Record<string, number> = {};
      for (const a of loadIndex().assets) for (const t of a.tags) counts[t] = (counts[t] ?? 0) + 1;
      return sendJson(res, 200, { tags: counts });
    }

    // ---- upload: one file per request, streamed to disk and hashed on the way
    if (method === "POST" && parts[0] === "api" && parts[1] === "upload" && parts.length === 2) {
      const length = Number(req.headers["content-length"]);
      if (!Number.isFinite(length) || length <= 0) throw new HttpError(411, "Content-Length is required: send the file as the request body");
      if (length > maxFileBytes()) throw new HttpError(413, `larger than the ${Math.round(maxFileBytes() / 1024 / 1024)} MB limit`);
      const header = (name: string): string | undefined => {
        const v = req.headers[name];
        return typeof v === "string" ? v : undefined;
      };
      let name: string;
      let rel: string | undefined;
      try {
        name = cleanName(decodeURIComponent(header("x-reelcut-name") ?? "upload"));
        rel = cleanRelPath(decodeURIComponent(header("x-reelcut-path") ?? ""));
      } catch {
        throw new HttpError(400, "bad file name header");
      }
      let stored;
      try {
        stored = await streamToTemp(req);
      } catch (error) {
        if (error instanceof IngestError) throw new HttpError(413, error.message);
        throw error;
      }
      if (stored.bytes !== length) {
        rmSync(stored.temp, { force: true });
        throw new HttpError(400, `the upload was cut short: ${stored.bytes} of ${length} bytes arrived`);
      }
      const kind = header("x-reelcut-kind") === "identity" ? "identity" : "generic";
      const source: IngestSource = { kind: "upload", origin: "upload", assetKind: kind, trusted: false, private: header("x-reelcut-private") === "1" };
      const [outcome] = await ingestBatch([{ file: name, name, ...(rel ? { relPath: `${rel}/${name}` } : {}), source, stored }]);
      const asset = outcome?.assetId ? findAsset(outcome.assetId) : undefined;
      return sendJson(res, outcome?.state === "ingested" ? 201 : outcome?.state === "duplicate" ? 200 : 422, { outcome, ...(asset ? { asset: publicAsset(asset) } : {}) });
    }

    // ---- review: approve or reject what has been dropped in
    if (method === "POST" && parts[0] === "api" && parts[1] === "assets" && parts[2] === "review" && parts.length === 3) {
      const body = (await readBody(req)) as { ids?: unknown; state?: unknown; kind?: unknown };
      if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 1000 || !body.ids.every((i) => typeof i === "string")) throw new HttpError(400, "ids must be a list of 1 to 1000 asset ids");
      const state = ReviewStateSchema.safeParse(body.state);
      if (!state.success) throw new HttpError(400, "state must be pending, approved or rejected");
      const kind = body.kind === undefined ? undefined : AssetKindSchema.safeParse(body.kind);
      if (kind && !kind.success) throw new HttpError(400, "kind must be identity or generic");
      const results = setReview(body.ids as string[], state.data, "user", kind?.success ? { kind: kind.data } : {});
      learn.onReview(results, state.data);
      return sendJson(res, 200, { assets: results.map((r) => publicAsset(r.asset)) });
    }

    // ---- the queue Claude works through, and a few counts for the page's badges
    if (read && parts[0] === "api" && parts[1] === "queue" && parts.length === 2) {
      return sendJson(res, 200, { command: "/reelcut tag-assets", assets: claudeQueue(loadIndex().assets).map(publicAsset) });
    }

    // ---- watched folders
    if (parts[0] === "api" && parts[1] === "folders") {
      if (read && parts.length === 2) return sendJson(res, 200, { folders: listFolders().map((f) => ({ ...f, summary: summarise(undefined, f.id).counts })) });
      if (method === "POST" && parts.length === 2) {
        const b = (await readBody(req)) as Record<string, unknown>;
        if (typeof b.path !== "string" || !b.path.trim()) throw new HttpError(400, "path is required");
        const folder = addFolder({
          path: b.path.trim(),
          ...(typeof b.label === "string" ? { label: b.label } : {}),
          ...(b.kind === "identity" || b.kind === "generic" ? { kind: b.kind } : {}),
          trusted: b.trusted === true,
          private: b.private === true,
        });
        ingest.syncWatchers();
        void ingest.rescan(folder.id);
        return sendJson(res, 201, { folder });
      }
      if (method === "PATCH" && parts.length === 3) {
        const b = (await readBody(req)) as Record<string, unknown>;
        const folder = updateFolder(parts[2]!, {
          ...(typeof b.label === "string" ? { label: b.label } : {}),
          ...(b.kind === "identity" || b.kind === "generic" ? { kind: b.kind } : {}),
          ...(typeof b.trusted === "boolean" ? { trusted: b.trusted } : {}),
          ...(typeof b.private === "boolean" ? { private: b.private } : {}),
          ...(typeof b.paused === "boolean" ? { paused: b.paused } : {}),
        });
        ingest.syncWatchers();
        return sendJson(res, 200, { folder });
      }
      if (method === "DELETE" && parts.length === 3) {
        removeFolder(parts[2]!);
        ingest.syncWatchers();
        return sendJson(res, 200, { ok: true });
      }
      if (method === "POST" && parts.length === 4 && parts[3] === "rescan") {
        void ingest.rescan(parts[2]!);
        return sendJson(res, 202, { ok: true });
      }
    }
    if (parts[0] === "api" && parts[1] === "ingest") {
      if (read && parts.length === 2) return sendJson(res, 200, { status: ingest.status(), summary: summarise(), folders: listFolders() });
      if (method === "POST" && parts[2] === "rescan" && parts.length === 3) {
        void ingest.rescan();
        return sendJson(res, 202, { ok: true });
      }
      if (method === "POST" && parts[2] === "pause" && parts.length === 3) {
        const b = (await readBody(req)) as { paused?: unknown };
        if (typeof b.paused !== "boolean") throw new HttpError(400, "paused must be true or false");
        if (b.paused) ingest.pause();
        else ingest.resume();
        return sendJson(res, 200, { status: ingest.status() });
      }
    }

    // ---- learnings: the rules the studio has proposed, and what a person does with them
    if (parts[0] === "api" && parts[1] === "learnings") {
      if (read && parts.length === 2) {
        const file = reinfer();
        return sendJson(res, 200, { rules: file.rules, signals: file.signals.length, notes: file.signals.filter((s) => s.note).slice(-50).reverse(), tagStats: file.tagStats });
      }
      if (read && parts[2] === "export" && parts.length === 3) return sendJson(res, 200, exportLearnings());
      if (read && parts[2] === "why" && parts.length === 4) {
        const file = loadLearnings();
        const rule = file.rules.find((r) => r.id === parts[3]);
        if (!rule) throw new HttpError(404, "no such rule");
        const byId = new Map(file.signals.map((s) => [s.id, s]));
        return sendJson(res, 200, { rule, evidence: rule.evidence.map((id) => byId.get(id)).filter(Boolean) });
      }
      if (method === "POST" && parts[2] === "rules" && parts.length === 3) {
        const b = (await readBody(req)) as Record<string, unknown>;
        const subject = b.subject ? SubjectSchema.safeParse(b.subject) : undefined;
        if (subject && !subject.success) throw new HttpError(400, "subject must be a look, accent, motion, pattern, text, format or sound with a plain value");
        const kind = b.kind === "prefer" || b.kind === "avoid" || b.kind === "note" ? b.kind : undefined;
        const rule = createRule({
          ...(kind ? { kind } : {}),
          ...(subject?.success ? { subject: subject.data } : {}),
          ...(typeof b.text === "string" ? { text: b.text } : {}),
          ...(typeof b.brand === "string" && b.brand.trim() ? { brand: b.brand } : {}),
        });
        return sendJson(res, 201, { rule });
      }
      if (method === "PATCH" && parts[2] === "rules" && parts.length === 4) {
        const b = (await readBody(req)) as Record<string, unknown>;
        const status = b.status === undefined ? undefined : RuleStatusSchema.safeParse(b.status);
        if (status && !status.success) throw new HttpError(400, "status must be proposed, active, disabled or expired");
        const rule = updateRule(parts[3]!, {
          ...(status?.success ? { status: status.data } : {}),
          ...(typeof b.pinned === "boolean" ? { pinned: b.pinned } : {}),
          ...(typeof b.text === "string" ? { text: b.text } : {}),
          ...(typeof b.scope === "string" ? { scope: b.scope } : {}),
        });
        return sendJson(res, 200, { rule });
      }
      if (method === "DELETE" && parts[2] === "rules" && parts.length === 4) {
        deleteRule(parts[3]!);
        return sendJson(res, 200, { ok: true });
      }
      if (method === "POST" && parts[2] === "promote" && parts.length === 3) {
        const b = (await readBody(req)) as Record<string, unknown>;
        if (typeof b.signal !== "string") throw new HttpError(400, "signal is required");
        return sendJson(res, 201, { rule: promoteNote(b.signal, typeof b.text === "string" ? b.text : undefined, typeof b.brand === "string" ? b.brand : undefined) });
      }
      if (method === "POST" && parts[2] === "import" && parts.length === 3) {
        const result = importLearnings(await readBody(req, 1024 * 1024), url.searchParams.get("mode") === "replace" ? "replace" : "merge");
        return sendJson(res, 200, result);
      }
    }

    // ---- the bundled CC0 sound pack, to audition and copy cues from
    if (read && parts[0] === "api" && parts[1] === "sfx-pack" && parts.length === 2) {
      const pack = loadSfxPack();
      return sendJson(res, 200, { sounds: (pack?.sounds ?? []).map((s) => ({ ...s, url: `/files/pack/${s.id}` })) });
    }

    // ---- your patterns: beats rated "Works", kept for the next reel
    if (parts[0] === "api" && parts[1] === "patterns") {
      if (read && parts.length === 2) return sendJson(res, 200, { patterns: rankPatterns(loadPatterns()).map(publicPattern) });
      const id = parts[2] ?? "";
      if (!loadPatterns().some((p) => p.id === id)) throw new HttpError(404, "no such pattern");
      if (method === "PATCH" && parts.length === 3) {
        const b = (await readBody(req)) as { name?: unknown; tags?: unknown };
        if (b.name !== undefined && typeof b.name !== "string") throw new HttpError(400, "name must be text");
        if (b.tags !== undefined && (!Array.isArray(b.tags) || b.tags.some((t) => typeof t !== "string"))) throw new HttpError(400, "tags must be a list of words");
        return sendJson(res, 200, { pattern: publicPattern(editPattern(id, { ...(typeof b.name === "string" ? { name: b.name } : {}), ...(Array.isArray(b.tags) ? { tags: b.tags as string[] } : {}) })) });
      }
      if (method === "DELETE" && parts.length === 3) {
        removePattern(id);
        return sendJson(res, 200, { ok: true });
      }
    }

    // ---- personality: the design crafter. Styles, colour, type and everything else that makes reels recognisably yours.
    if (parts[0] === "api" && parts[1] === "personality") {
      if (read && parts[2] === "catalog" && parts.length === 3) {
        const previews = Object.fromEntries(STYLES.map((st) => [st.id, Object.fromEntries((["sample", "showcase"] as const).map((k) => [k, existsSync(path.join(stylePreviewDir(), `${st.id}-${k}.mp4`))]))]));
        return sendJson(res, 200, { styles: STYLES, tensions: STYLE_TENSIONS, pairings: PAIRINGS, families: FAMILIES.map((f) => ({ family: f.family, kind: f.kind })), previews });
      }
      if (read && parts[2] === "taste" && parts.length === 3) {
        return sendJson(res, 200, { suggestions: fromTaste(loadReferences().references, loadPatterns()) });
      }
      if (method === "POST" && parts[2] === "check" && parts.length === 3) {
        const parsed = PersonalitySchema.safeParse(await readBody(req, 256 * 1024));
        if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "not a personality");
        return sendJson(res, 200, { findings: checkPersonality(parsed.data) });
      }
      if (method === "POST" && parts[2] === "surprise" && parts.length === 3) {
        const b = (await readBody(req)) as { seed?: unknown; locks?: Locks };
        const seed = typeof b.seed === "number" ? b.seed : Math.floor(Math.random() * 1e9);
        return sendJson(res, 200, { seed, roll: surprise(seed, b.locks ?? {}) });
      }
      if (method === "POST" && parts[2] === "brand" && parts.length === 3) {
        const b = (await readBody(req)) as { url?: unknown; colors?: unknown };
        if (Array.isArray(b.colors)) {
          const colors = b.colors.filter((c): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c));
          return sendJson(res, 200, { palettes: Object.fromEntries(STYLES.map((st) => [st.id, brandPalette(st, colors) ?? null])) });
        }
        if (typeof b.url !== "string" || !b.url.trim()) throw new HttpError(400, "give a website address");
        try { return sendJson(res, 200, { brand: await importBrand(b.url) }); }
        catch (error) { throw new HttpError(422, `could not read that site: ${(error as Error).message}`); }
      }
    }
    if (parts[0] === "api" && parts[1] === "personalities") {
      const withFindings = (pp: ReturnType<typeof loadPersonalities>[number]) => ({ ...pp, findings: checkPersonality(pp) });
      if (read && parts.length === 2) return sendJson(res, 200, { personalities: loadPersonalities().map(withFindings) });
      if (method === "POST" && parts.length === 2) {
        const b = (await readBody(req, 256 * 1024)) as Record<string, unknown>;
        const saved = savePersonality({ ...(b as object), name: typeof b.name === "string" && b.name.trim() ? b.name.trim() : "My personality" } as never);
        return sendJson(res, 201, { personality: withFindings(saved) });
      }
      const id = parts[2] ?? "";
      const current = getPersonality(id);
      if (!current) throw new HttpError(404, "no such personality");
      if (read && parts.length === 3) return sendJson(res, 200, { personality: withFindings(current) });
      if (method === "PUT" && parts.length === 3) {
        // Autosave: drafts are kept whatever their findings; finishing is what errors block.
        const parsed = PersonalitySchema.safeParse({ ...current, ...((await readBody(req, 256 * 1024)) as object), id, createdAt: current.createdAt, updatedAt: current.updatedAt });
        if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
        for (const st of parsed.data.styles) if (!styleById(st.id)) throw new HttpError(400, `no style ${st.id}`);
        return sendJson(res, 200, { personality: withFindings(savePersonality(parsed.data)) });
      }
      if (method === "POST" && parts[3] === "finish" && parts.length === 4) {
        const errors = checkPersonality(current).filter((f) => f.level === "error");
        if (errors.length) return sendJson(res, 409, { error: "fix the red findings first", findings: errors });
        // Finishing settles every step: the ones the owner skipped keep their defaults, which are real choices.
        const done = [...new Set([...current.done, ...PZ_STEP_IDS])];
        return sendJson(res, 200, { personality: withFindings(savePersonality({ ...current, done })) });
      }
      // Mini beats: one 4-second beat per chosen style in this personality's colours, type and motion, rendered and saved.
      if (read && parts[3] === "renders" && parts.length === 4) {
        const dir = path.join(reelcutHome(), "personality-renders", id);
        const renders = current.styles.filter((st) => existsSync(path.join(dir, `${st.id}.mp4`))).map((st) => ({ style: st.id, video: `/files/mini/${id}/${st.id}.mp4`, poster: `/files/mini/${id}/${st.id}.jpg`, at: statSync(path.join(dir, `${st.id}.mp4`)).mtime.toISOString() }));
        return sendJson(res, 200, { renders, job: jobs.find((j) => j.runId === `personality:${id}`) ?? null });
      }
      if (method === "POST" && parts[3] === "render" && parts.length === 4) {
        if (checkPersonality(current).some((f) => f.level === "error")) throw new HttpError(409, "fix the red findings first");
        if (!current.styles.length) throw new HttpError(409, "choose a style first");
        const running = jobs.find((j) => j.status === "running");
        if (running) throw new HttpError(409, `a render is already running (${running.beat})`, { job: running.id });
        const job: Job = { id: String(++jobSeq), runId: `personality:${id}`, beat: `mini beats: ${current.name}`, status: "running", startedAt: new Date().toISOString(), log: [] };
        jobs.unshift(job);
        const tsx = createRequire(import.meta.url).resolve("tsx/cli");
        const child = spawn(process.execPath, [tsx, path.join(REPO, "skills", "reelcut", "scripts", "personality.ts"), "mini", id], { cwd: REPO, windowsHide: true });
        const append = (chunk: Buffer) => { job.log.push(...chunk.toString("utf8").split(/\r?\n/).filter(Boolean)); if (job.log.length > 300) job.log.splice(0, job.log.length - 300); };
        child.stdout?.on("data", append); child.stderr?.on("data", append);
        child.on("error", (error) => { job.log.push(String(error)); job.status = "failed"; job.endedAt = new Date().toISOString(); });
        child.on("close", (code) => { if (job.status === "running") job.status = code === 0 ? "ok" : "failed"; job.exitCode = code; job.endedAt = new Date().toISOString(); });
        return sendJson(res, 202, { job });
      }
      if (method === "POST" && parts[3] === "default" && parts.length === 4) {
        setDefaultPersonality(id);
        return sendJson(res, 200, { ok: true });
      }
      if (method === "DELETE" && parts.length === 3) {
        deletePersonality(id);
        return sendJson(res, 200, { ok: true });
      }
    }

    // ---- create: a reel made from the dashboard, Claude Code driving /reelcut, the conversation streamed here
    // Every live review link, for `reelcut shares` and `status`.
    if (read && parts[0] === "api" && parts[1] === "shares" && parts.length === 2) {
      const u = reviewUrl();
      return sendJson(res, 200, { tunnel: u ?? null, shares: loadShares().filter((x) => liveShare(x)).map((x) => ({ token: x.token, conversation: x.conversation, title: x.title, expiresAt: x.expiresAt, url: u ? `${u}/r/${x.token}` : null })) });
    }
    // `reelcut stop`: the studio ends itself (it listens on this Mac only). Review links live on in their own process.
    if (method === "POST" && parts[0] === "api" && parts[1] === "shutdown" && parts.length === 2) {
      sendJson(res, 202, { ok: true });
      setTimeout(() => process.exit(0), 200);
      return;
    }
    // The tools reels are orchestrated with (MCP servers): connected or not, read from Claude Code itself.
    if (read && parts[0] === "api" && parts[1] === "integrations" && parts.length === 2) {
      return sendJson(res, 200, await readIntegrations(REPO, 60_000, url.searchParams.has("refresh")));
    }
    // Recipes (starting points) and series (episodes that share an intro and an outro).
    if (parts[0] === "api" && (parts[1] === "recipes" || parts[1] === "series")) {
      const recipes = parts[1] === "recipes";
      if (read && parts.length === 2) return sendJson(res, 200, recipes ? { recipes: listRecipes() } : { series: listSeries() });
      if (method === "POST" && parts.length === 2) {
        const b = (await readBody(req)) as Record<string, unknown> & { name?: string };
        if (!String(b.name ?? "").trim()) throw new HttpError(400, "give it a name");
        return sendJson(res, 201, recipes ? { recipe: saveRecipe(b as never) } : { series: saveSeries(b as never) });
      }
      if (method === "DELETE" && parts.length === 3) {
        try { if (recipes) removeRecipe(parts[2]!); else removeSeries(parts[2]!); } catch (error) { throw new HttpError(409, (error as Error).message); }
        return sendJson(res, 200, { ok: true });
      }
    }
    // Performance: every reel with results, what differs between them, and a conversation to make sense of it.
    if (parts[0] === "api" && parts[1] === "performance") {
      const cm = (create ??= new CreateManager());
      const rows = (): PerfRow[] => cm.list().flatMap((m) => {
        const rp = cm.findReel(m.id);
        if (!rp || !readPerformance(rp).length) return [];
        try { return [{ conversation: m.id, title: m.title, reel: rp, facts: reelFacts(rp, m.settings), latest: latest(readPerformance(rp)) }]; } catch { return []; }
      });
      if (read && parts.length === 2) {
        const r = rows();
        const reels = cm.list().filter((m) => m.reel).map((m) => ({ id: m.id, title: m.title, hasResults: r.some((x) => x.conversation === m.id) }));
        return sendJson(res, 200, { rows: r, insights: insights(r), reels });
      }
      if (method === "POST" && parts[2] === "analyze" && parts.length === 3) {
        const r = rows();
        if (r.length < 2) throw new HttpError(409, "add results for at least two reels first");
        const sess = cm.create("What's working", {});
        cm.send(sess.id, `What's working across my ${r.length} reels with results?`, [], analysisPrompt(r, insights(r)));
        return sendJson(res, 201, { id: sess.id });
      }
    }
    if (parts[0] === "api" && parts[1] === "create") {
      const cm = (create ??= new CreateManager());
      if (read && parts.length === 2) {
        return sendJson(res, 200, {
          sessions: cm.list(),
          personalities: loadPersonalities().map((pp) => ({ id: pp.id, name: pp.name, isDefault: pp.isDefault })),
          recipes: listRecipes(), series: listSeries(),
          models: [["", "Default"], ["opus", "Opus"], ["sonnet", "Sonnet"], ["haiku", "Haiku"]],
          efforts: [["", "Default"], ["low", "Low"], ["medium", "Medium"], ["high", "High"], ["xhigh", "Extra high"], ["max", "Max"]],
        });
      }
      if (method === "POST" && parts.length === 2) {
        const b = (await readBody(req)) as { title?: string; settings?: Record<string, string>; model?: string; effort?: string };
        const sess = cm.create(String(b.title ?? "New reel"), b.settings ?? {}, b.model || undefined, b.effort || undefined);
        return sendJson(res, 201, { session: { ...sess, events: undefined } });
      }
      const id = parts[2] ?? "";
      const sess = cm.get(id);
      if (!sess) throw new HttpError(404, "no such conversation");
      if (read && parts.length === 3) return sendJson(res, 200, { session: { ...sess, events: undefined }, events: sess.events });
      // The live stream: every event and every change to one, as server-sent events.
      if (read && parts[3] === "events" && parts.length === 4) {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
        res.write(": open\n\n");
        const off = cm.subscribe(id, (e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
        const beat = setInterval(() => res.write(": beat\n\n"), 20000);
        req.on("close", () => { off(); clearInterval(beat); });
        return;
      }
      if (read && parts[3] === "reel" && parts.length === 4) return sendJson(res, 200, { reel: reelState(cm.findReel(id)), progress: cm.progress(id) });
      if (method === "PATCH" && parts.length === 3) {
        const b = (await readBody(req)) as { title?: string };
        if (typeof b.title === "string") cm.rename(id, b.title);
        return sendJson(res, 200, { ok: true });
      }
      // Attachments: the script, the voiceover, assets. Saved with the conversation; assets also go into the library.
      if (method === "POST" && parts[3] === "files" && parts.length === 4) {
        const name = cleanName(decodeURIComponent(String(req.headers["x-reelcut-name"] ?? "file")));
        const kind = String(req.headers["x-reelcut-kind"] ?? "asset");
        let stored;
        try { stored = await streamToTemp(req); } catch (error) { if (error instanceof IngestError) throw new HttpError(413, error.message); throw error; }
        const dir = kind === "asset" ? path.join(createFilesDir(id), "assets") : createFilesDir(id);
        mkdirSync(dir, { recursive: true });
        const dest = path.join(dir, name);
        renameSync(stored.temp, dest);
        if (kind === "asset") {
          safely(() => void (async () => {
            const copy = await streamToTemp(createReadStream(dest));
            await ingestBatch([{ file: name, name, source: { kind: "upload", origin: "upload", assetKind: "generic", trusted: false, private: false }, stored: copy }]);
          })().catch(() => undefined));
        }
        return sendJson(res, 201, { file: { name, path: dest, kind } });
      }
      if (method === "POST" && (parts[3] === "start" || parts[3] === "message" || parts[3] === "queue") && parts.length === 4) {
        const b = (await readBody(req, 512 * 1024)) as { text?: string; files?: { name: string; path: string; kind: string }[]; batch?: string; startAt?: string };
        const files = (b.files ?? []).filter((f) => typeof f.path === "string" && f.path.startsWith(createFilesDir(id)));
        const text = String(b.text ?? "");
        if (!text.trim() && !files.length) throw new HttpError(400, "write something, or add a script");
        if (parts[3] === "message") { cm.send(id, text, files); return sendJson(res, 202, { ok: true }); }
        const unattended = parts[3] === "queue";
        if (unattended) sess.batch = /^b_[0-9a-z]+$/.test(String(b.batch)) ? String(b.batch) : `b_${Date.now().toString(36)}`;
        const script = files.find((f) => f.kind === "script");
        const vo = files.find((f) => f.kind === "voiceover");
        const assets = files.some((f) => f.kind === "asset") ? path.join(createFilesDir(id), "assets") : undefined;
        const pers = sess.settings.personality ? getPersonality(sess.settings.personality) : undefined;
        const write = sess.settings.mode === "write" && !script;
        // A pasted script becomes a file, so /reelcut gets a path like any other script.
        let scriptPath = script?.path;
        if (!write && !scriptPath && text.trim().split(/\s+/).length > 25) { scriptPath = path.join(createFilesDir(id), "script.txt"); writeFileSyncSafe(scriptPath, text.trim()); }
        const recipe = sess.settings.recipe ? getRecipe(sess.settings.recipe) : undefined;
        let seriesLines: string[] | undefined;
        const series = sess.settings.series ? getSeries(sess.settings.series) : undefined;
        if (series) {
          const n = addEpisode(series.id, id);
          const prev = n > 1 ? series.episodes[n - 2] : undefined;
          seriesLines = seriesPrompt(series, n, prev ? cm.findReel(prev) : undefined);
          sess.episode = { series: series.id, n };
        }
        const prompt = cm.firstPrompt(sess, { text: scriptPath && !script ? "" : text, scriptPath, voiceoverPath: vo?.path, assetsDir: assets, settings: sess.settings, personalityName: pers?.name, recipeLines: recipe ? recipePrompt(recipe) : undefined, seriesLines, unattended });
        // A placeholder until Claude names the reel: the script's first sentence, without markdown.
        if (!sess.named) {
          // From the script when there is one (the typed words may only be direction, "make it calm"), else from the words.
          let source = text;
          if (script) { try { source = readFileSync(script.path, "utf8").replace(/^\d+\s*$|^[\d:,.]+\s*-->.*$/gm, ""); } catch { /* keep the words */ } }
          const first = source.replace(/^[#>*\s-]+/gm, "").split(/(?<=[.!?])\s|\n/).map((x) => x.trim()).find((x) => x.length > 3);
          const name = first ? first.split(/\s+/).slice(0, 6).join(" ") : script?.name.replace(/\.[a-z0-9]+$/i, "") || "New reel";
          cm.rename(id, series ? `${series.name} ${sess.episode!.n}: ${name}` : name, false);
        }
        if (unattended) cm.enqueue(id, text, files, prompt, b.startAt && !Number.isNaN(Date.parse(b.startAt)) ? new Date(b.startAt).toISOString() : undefined);
        else cm.send(id, text, files, prompt);
        return sendJson(res, 202, { ok: true });
      }
      if (method === "POST" && parts[3] === "unqueue" && parts.length === 4) { cm.unqueue(id); return sendJson(res, 200, { ok: true }); }
      if (method === "POST" && parts[3] === "answer" && parts.length === 4) {
        const b = (await readBody(req)) as { event?: string; answers?: Record<string, string> };
        try { cm.answer(id, String(b.event), b.answers ?? {}); } catch (error) { throw new HttpError(409, (error as Error).message); }
        return sendJson(res, 200, { ok: true });
      }
      if (method === "POST" && parts[3] === "permit" && parts.length === 4) {
        const b = (await readBody(req)) as { event?: string; allow?: boolean; always?: boolean };
        try { cm.permit(id, String(b.event), !!b.allow, !!b.always); } catch (error) { throw new HttpError(409, (error as Error).message); }
        return sendJson(res, 200, { ok: true });
      }
      if (method === "POST" && parts[3] === "stop" && parts.length === 4) { cm.stop(id); return sendJson(res, 200, { ok: true }); }

      // Editing the finished reel: one beat at a time, or comments pinned to frames. Each becomes a message to Claude.
      const reelPath = () => { const r = cm.findReel(id); if (!r) throw new HttpError(409, "this conversation has no reel yet"); return r; };
      if (read && parts[3] === "beat" && parts.length === 5) {
        const rp = reelPath(); const reel = readReel(rp);
        const b = reel.beats.find((x) => x.id === parts[4]);
        if (!b) throw new HttpError(404, "no such beat");
        return sendJson(res, 200, { beat: b, index: reel.beats.indexOf(b), count: reel.beats.length, text: beatText(rp, b) });
      }
      if (method === "POST" && parts[3] === "edit" && parts.length === 4) {
        const b = (await readBody(req)) as { beat?: string; action?: EditAction };
        if (!b.beat || !b.action?.kind) throw new HttpError(400, "say which beat and what to do");
        const rp = reelPath();
        let action = b.action;
        if (action.kind === "image") {
          const a = findAsset(String((action.asset as { id?: string })?.id ?? ""));
          if (!a) throw new HttpError(404, "no such asset");
          action = { kind: "image", asset: { id: a.id, name: a.name, path: blobPath(a) } };
        }
        let msg;
        try { msg = editPrompt(rp, readReel(rp), b.beat, action); } catch (error) { throw new HttpError(400, (error as Error).message); }
        cm.send(id, msg.shown, [], msg.prompt);
        return sendJson(res, 202, { ok: true, shown: msg.shown });
      }
      // Posting: captions (files now, burned in as a job), covers from the reel's frames, and the words Claude writes.
      if (read && parts[3] === "post" && parts.length === 4) {
        const rp = reelPath(), dir = path.dirname(rp);
        const at = (f: string) => (existsSync(path.join(dir, f)) ? path.join(dir, f) : undefined);
        let captions: { source?: string; lines?: number } = {};
        try { const j = JSON.parse(readFileSync(path.join(dir, "captions.json"), "utf8")) as { source: string; chunks: unknown[] }; captions = { source: j.source, lines: j.chunks.length }; } catch { /* not written yet */ }
        const voiced = existsSync(path.join(dir, "voice.json"));
        const job = jobs.find((j) => j.runId === `captions:${id}`);
        return sendJson(res, 200, {
          captions: { ...captions, srt: at("captions.srt"), vtt: at("captions.vtt"), burned: at("master.captioned.mp4"), voiced, job: job && { id: job.id, status: job.status, log: job.log.slice(-4) } },
          frames: coverFrames(rp), covers: readCovers(rp), kit: readPostKit(rp), limits: LIMITS, platforms: POST_PLATFORMS, results: latest(readPerformance(rp)),
        });
      }
      if (method === "POST" && parts[3] === "captions" && parts.length === 4) {
        const b = (await readBody(req)) as { burn?: boolean; style?: string };
        const rp = reelPath();
        const files = writeCaptions(rp);
        if (!b.burn) return sendJson(res, 200, { files });
        if (files.source !== "voice") throw new HttpError(409, "this reel has no voiceover: its words are already on screen, so captions stay as files");
        const running = jobs.find((j) => j.status === "running");
        if (running) throw new HttpError(409, `a render is already running (${running.beat})`, { job: running.id });
        const style = ["karaoke", "key-words", "full"].includes(String(b.style)) ? String(b.style) : "key-words";
        const job: Job = { id: String(++jobSeq), runId: `captions:${id}`, beat: `captions: ${sess.title}`, status: "running", startedAt: new Date().toISOString(), log: [] };
        jobs.unshift(job);
        const tsx = createRequire(import.meta.url).resolve("tsx/cli");
        const child = spawn(process.execPath, [tsx, path.join(REPO, "skills", "reelcut", "scripts", "captions.ts"), rp, "--burn", "--style", style], { cwd: REPO, windowsHide: true });
        const append = (chunk: Buffer) => { job.log.push(...chunk.toString("utf8").split(/\r?\n/).filter(Boolean)); if (job.log.length > 300) job.log.splice(0, job.log.length - 300); };
        child.stdout?.on("data", append); child.stderr?.on("data", append);
        child.on("error", (error) => { job.log.push(String(error)); job.status = "failed"; job.endedAt = new Date().toISOString(); });
        child.on("close", (code) => { if (job.status === "running") job.status = code === 0 ? "ok" : "failed"; job.exitCode = code; job.endedAt = new Date().toISOString(); });
        return sendJson(res, 202, { files, job });
      }
      if (method === "POST" && parts[3] === "cover" && parts.length === 4) {
        const b = (await readBody(req)) as { t?: number; title?: string };
        if (typeof b.t !== "number") throw new HttpError(400, "pick a frame");
        try { return sendJson(res, 200, { covers: await makeCover(reelPath(), b.t, String(b.title ?? "").slice(0, 120)) }); }
        catch (error) { throw new HttpError(500, (error as Error).message); }
      }
      if (method === "POST" && parts[3] === "postkit" && parts.length === 4) {
        const b = (await readBody(req)) as { platforms?: string[]; note?: string };
        const pf = (b.platforms ?? []).filter((x): x is Platform => (POST_PLATFORMS as readonly string[]).includes(x));
        cm.send(id, `Write the post kit${pf.length && pf.length < POST_PLATFORMS.length ? ` for ${pf.join(", ")}` : ""}${b.note?.trim() ? `: ${b.note.trim()}` : ""}`, [], postKitPrompt(reelPath(), pf.length ? pf : POST_PLATFORMS, b.note ?? ""));
        return sendJson(res, 202, { ok: true });
      }
      // Share for review: a link to a review page for this reel, through a quick tunnel to the review port only.
      if (parts[3] === "shares") {
        const pub = (x: { token: string; expiresAt: string; createdAt: string }) => { const u = reviewUrl(); return { token: x.token, createdAt: x.createdAt, expiresAt: x.expiresAt, url: u ? `${u}/r/${x.token}` : undefined }; };
        if (read && parts.length === 4) {
          // A live link with no tunnel (the Mac slept, the network changed): bring it back; the page asks again shortly.
          const live = sharesFor(id);
          if (live.length && !reviewUrl() && cloudflaredPath()) void ensureReviewDaemon().catch(() => undefined);
          return sendJson(res, 200, { shares: live.map(pub), cloudflared: !!cloudflaredPath(), tunnel: reviewUrl() ?? null, since: daemonState()?.urlSince ?? null });
        }
        if (method === "POST" && parts.length === 4) {
          const b = (await readBody(req)) as { days?: number };
          const rp = reelPath();
          if (!existsSync(path.join(path.dirname(rp), "master.mp4"))) throw new HttpError(409, "the reel has no master yet");
          // The link is saved first, so the daemon (which quits when no link is live) has a reason to stay.
          const sh = createShare(id, sess.title, rp, Math.min(30, Math.max(1, Number(b.days) || 7)));
          try { await ensureReviewDaemon(); } catch (error) { revokeShare(sh.token); throw new HttpError(409, (error as Error).message); }
          return sendJson(res, 201, { share: pub(sh) });
        }
        if (method === "DELETE" && parts.length === 5) {
          revokeShare(parts[4]!);
          if (!loadShares().some((x) => liveShare(x))) stopReviewDaemon();
          return sendJson(res, 200, { ok: true });
        }
      }
      // A line from the review daemon: a reviewer commented. Only with the daemon's key.
      if (method === "POST" && parts[3] === "review-note" && parts.length === 4) {
        const d = daemonState();
        if (!d || req.headers["x-reelcut-key"] !== d.key) throw new HttpError(403, "not the review daemon");
        const b = (await readBody(req)) as { text?: string };
        cm.note(id, String(b.text ?? "").slice(0, 300));
        return sendJson(res, 200, { ok: true });
      }
      if (parts[3] === "comments") {
        if (read && parts.length === 4) return sendJson(res, 200, { comments: loadComments(id) });
        if (method === "POST" && parts.length === 4) {
          const b = (await readBody(req)) as { t?: number; x?: number; y?: number; text?: string };
          if (typeof b.t !== "number" || !String(b.text ?? "").trim()) throw new HttpError(400, "a comment needs a moment and some words");
          return sendJson(res, 201, { comment: addComment(id, reelPath(), { t: b.t, x: b.x, y: b.y, text: String(b.text) }) });
        }
        if (method === "POST" && parts[4] === "send" && parts.length === 5) {
          let msg;
          try { msg = commentsPrompt(id, reelPath()); } catch (error) { throw new HttpError(409, (error as Error).message); }
          for (const c of msg.sent) updateComment(id, c, { status: "sent" });
          cm.send(id, msg.shown, [], msg.prompt);
          return sendJson(res, 202, { ok: true, sent: msg.sent.length });
        }
        if (method === "PATCH" && parts.length === 5) {
          const b = (await readBody(req)) as { text?: string; status?: "open" | "sent" | "resolved" };
          try { return sendJson(res, 200, { comment: updateComment(id, parts[4]!, b) }); } catch (error) { throw new HttpError(404, (error as Error).message); }
        }
        if (method === "DELETE" && parts.length === 5) { removeComment(id, parts[4]!); return sendJson(res, 200, { ok: true }); }
      }
    }

    // ---- runs
    if (parts[0] === "api" && parts[1] === "runs") {
      if (read && parts.length === 2) return sendJson(res, 200, { runs: listRuns() });
      const run = parts[2] ? findRun(parts[2]) : undefined;
      if (parts.length >= 3 && !run) throw new HttpError(404, "no such run");
      if (read && parts.length === 3 && run) {
        const learned = loadLearnings();
        return sendJson(res, 200, {
          run,
          plan: run.missing ? undefined : readIfPresent(path.join(run.outDir, "plan.md")),
          report: run.missing ? undefined : readIfPresent(path.join(run.outDir, "report.md")),
          jobs: jobs.filter((j) => j.runId === run.id),
          feedback: learned.signals.filter((s) => s.reel === run.id && s.type === "thumb"),
          applied: learned.rules.filter((r) => run.appliedLearnings.includes(r.id)),
          generation: run.missing ? [] : (() => { try { return readGeneration(JSON.parse(readFileSync(run.manifest, "utf8"))); } catch { return []; } })(),
        });
      }
      if (method === "POST" && parts.length === 4 && parts[3] === "feedback" && run) {
        const b = (await readBody(req)) as { beat?: unknown; rating?: unknown; note?: unknown };
        const beat = typeof b.beat === "string" ? b.beat : "";
        if (!run.beats.includes(beat)) throw new HttpError(400, `no beat "${beat}" in this run`);
        const rating = b.rating === "up" || b.rating === "down" ? b.rating : undefined;
        const note = typeof b.note === "string" ? b.note.trim() : "";
        if (!rating && !note) throw new HttpError(400, "send a rating (up or down), a note, or both");
        const at = new Date().toISOString();
        const brand = run.brand;
        recordSignals([rating ? thumbSignal({ reel: run.id, beat, rating, note, brand, at }) : noteSignal({ reel: run.id, beat, note, at })]);
        // A beat that works becomes one of your patterns; one that does not is taken back out (unless you kept it).
        let pattern: PersonalPattern | undefined;
        let unsaved = false;
        if (rating && !run.missing) {
          safely(() => {
            const manifest = JSON.parse(readFileSync(run.manifest, "utf8")) as { format?: string; type?: string; beats?: { id: string; composition: string; durationSeconds?: number; pattern?: string }[] };
            const mb = manifest.beats?.find((x) => x.id === beat);
            if (!mb) return;
            if (mb.pattern?.startsWith("mine-")) ratePatternUse(mb.pattern, rating);
            if (rating === "down") { unsaved = unsaveFromBeat(run.outDir, beat); return; }
            const compositionPath = path.resolve(path.dirname(run.manifest), mb.composition);
            if (!existsSync(compositionPath)) return;
            const html = readFileSync(compositionPath, "utf8");
            pattern = savePatternFromBeat({
              run: run.id, outDir: run.outDir, beat, html,
              clip: path.join(run.outDir, "clips", `${beat}.mp4`),
              ...(/\bdata-look\s*=\s*["']([a-z]+)["']/i.exec(html)?.[1] ? { look: /\bdata-look\s*=\s*["']([a-z]+)["']/i.exec(html)![1]! } : {}),
              ...((pairingIn(html)?.id ?? manifest.type) ? { type: pairingIn(html)?.id ?? manifest.type! } : {}),
              ...(mb.pattern ? { basedOn: mb.pattern } : {}),
              ...(manifest.format ? { format: manifest.format } : {}),
              ...(mb.durationSeconds ? { durationSeconds: mb.durationSeconds } : {}),
            });
          });
        }
        return sendJson(res, 200, { ok: true, ...(pattern ? { pattern: publicPattern(pattern) } : {}), ...(unsaved ? { unsaved: true } : {}) });
      }
      if (method === "POST" && parts.length === 4 && parts[3] === "render" && run) {
        const body = (await readBody(req)) as { beat?: unknown };
        const beat = typeof body.beat === "string" ? body.beat : "";
        if (!run.beats.includes(beat)) throw new HttpError(400, `no beat "${beat}" in this run`);
        if (run.missing) throw new HttpError(409, "this run's folder or manifest is gone");
        const running = jobs.find((j) => j.status === "running");
        // One render at a time: HyperFrames drives a whole Chrome per render.
        if (running) throw new HttpError(409, `a render is already running (${running.beat})`, { job: running.id });
        const job: Job = { id: String(++jobSeq), runId: run.id, beat, status: "running", startedAt: new Date().toISOString(), log: [] };
        jobs.unshift(job);
        safely(() => void recordSignals([rerenderSignal({ reel: run.id, beat, at: new Date().toISOString() })]));
        const child = spawnRender(run.manifest, beat);
        const append = (chunk: Buffer) => {
          job.log.push(...chunk.toString("utf8").split(/\r?\n/).filter(Boolean));
          if (job.log.length > 300) job.log.splice(0, job.log.length - 300);
        };
        child.stdout?.on("data", append);
        child.stderr?.on("data", append);
        child.on("error", (error) => {
          job.log.push(String(error));
          job.status = "failed";
          job.endedAt = new Date().toISOString();
        });
        child.on("close", (code) => {
          if (job.status === "running") job.status = code === 0 ? "ok" : "failed";
          job.exitCode = code;
          job.endedAt = new Date().toISOString();
        });
        return sendJson(res, 202, { job });
      }
    }

    // ---- jobs
    if (read && parts[0] === "api" && parts[1] === "jobs") {
      if (parts.length === 2) return sendJson(res, 200, { jobs });
      const job = jobs.find((j) => j.id === parts[2]);
      if (!job) throw new HttpError(404, "no such job");
      return sendJson(res, 200, { job });
    }

    // ---- files
    if (read && parts[0] === "files") {
      if (parts[1] === "asset" && parts.length === 3) {
        const asset = findAsset(parts[2]!.replace(/\.[a-z0-9]+$/i, ""));
        if (!asset) throw new HttpError(404, "no such asset");
        return sendFile(req, res, blobPath(asset));
      }
      if ((parts[1] === "reference" || parts[1] === "reference-sheet" || parts[1] === "reference-thumb") && parts.length === 3) {
        const ref = loadReferences().references.find((r) => r.id === parts[2]!.replace(/\.[a-z0-9]+$/i, ""));
        const file = ref ? (parts[1] === "reference" ? referenceBlobPath(ref) : parts[1] === "reference-sheet" ? referenceSheetPath(ref) : referenceThumbPath(ref)) : undefined;
        if (!file) throw new HttpError(404, "no such file");
        return sendFile(req, res, file);
      }
      if (parts[1] === "pack" && parts.length === 3) {
        const pack = loadSfxPack();
        const sound = pack?.byId.get(parts[2]!);
        if (!pack || !sound) throw new HttpError(404, "no such sound");
        return sendFile(req, res, packSoundPath(pack, sound));
      }
      if (parts[1] === "pattern-thumb" && parts.length === 3) {
        const id = parts[2]!.replace(/\.[a-z0-9]+$/i, "");
        if (!loadPatterns().some((p) => p.id === id) || !existsSync(patternThumbPath(id))) throw new HttpError(404, "no picture");
        return sendFile(req, res, patternThumbPath(id));
      }
      if (parts[1] === "keyed" && parts.length === 3) {
        const asset = findAsset(parts[2]!.replace(/\.[a-z0-9]+$/i, ""));
        const keyed = asset && isKeyed(asset) ? keyedBlob(asset) : undefined;
        if (!keyed) throw new HttpError(404, "no keyed copy yet");
        return sendFile(req, res, keyed);
      }
      if (parts[1] === "strip" && parts.length === 3) {
        const asset = findAsset(parts[2]!.replace(/\.[a-z0-9]+$/i, ""));
        const strip = asset?.analysis.filmstrip ? path.join(libraryRoot(), asset.analysis.filmstrip) : undefined;
        if (!strip) throw new HttpError(404, "no filmstrip");
        return sendFile(req, res, strip);
      }
      if (parts[1] === "thumb" && parts.length === 3) {
        const asset = findAsset(parts[2]!.replace(/\.[a-z0-9]+$/i, ""));
        const thumb = asset ? thumbBlobPath(asset) : undefined;
        if (!thumb) throw new HttpError(404, "no preview");
        return sendFile(req, res, thumb);
      }
      // Frames, sheets and clips a Create conversation produced: only inside the project or the studio's home.
      if (parts[1] === "create-media" && parts.length === 2) {
        const p = url.searchParams.get("path") ?? "";
        if (!/\.(png|jpe?g|mp4|webm|gif|srt|vtt)$/i.test(p) || !path.isAbsolute(p) || !insideAllowed(p) || !existsSync(p)) throw new HttpError(404, "not available");
        return sendFile(req, res, p);
      }
      // The bundled type, so the Personality page shows every pairing in its real faces.
      if (parts[1] === "font" && parts.length === 3) {
        const lib = loadFontLibrary();
        const file = lib ? containedPath(lib.dir, parts[2]!) : undefined;
        if (!file) throw new HttpError(404, "no such font");
        return sendFile(req, res, file);
      }
      if (parts[1] === "fonts.css" && parts.length === 2) {
        const lib = loadFontLibrary();
        const css = lib ? fontFaceCss(FAMILIES.map((f) => f.family), lib, (file) => `/files/font/${encodeURIComponent(file)}`) : "";
        res.writeHead(200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "max-age=3600" });
        return void res.end(css);
      }
      if (parts[1] === "mini" && parts.length === 4 && /^p_[0-9a-f]+$/.test(parts[2]!) && /^[a-z0-9-]+\.(mp4|jpg)$/.test(parts[3]!)) {
        const file = path.join(reelcutHome(), "personality-renders", parts[2]!, parts[3]!);
        if (!existsSync(file)) throw new HttpError(404, "not rendered yet");
        return sendFile(req, res, file);
      }
      // The saved style previews: <style>-<sample|showcase>.mp4 and .jpg.
      if (parts[1] === "style-preview" && parts.length === 3 && /^[a-z0-9-]+-(sample|showcase)\.(mp4|jpg)$/.test(parts[2]!)) {
        const file = path.join(stylePreviewDir(), parts[2]!);
        if (!existsSync(file)) throw new HttpError(404, "not rendered yet");
        return sendFile(req, res, file);
      }
      if (parts[1] === "run" && parts.length >= 4) {
        const run = findRun(parts[2]!);
        if (!run) throw new HttpError(404, "no such run");
        const file = containedPath(run.outDir, parts.slice(3).join("/"));
        if (!file) throw new HttpError(403, "outside the run folder");
        return sendFile(req, res, file);
      }
    }

    throw new HttpError(404, "not found");
  }

  return server;
}

/**
 * The URL of a studio already serving this library on `port`, if there is one.
 *
 * Offering the studio at the end of every reel would otherwise start a new server each time, each
 * on the next free port. A studio for a *different* library (another `REELCUT_HOME`) does not count.
 */
export async function findRunningStudio(port = DEFAULT_PORT): Promise<string | undefined> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(800) });
    const body = (await res.json()) as { studio?: string; library?: string };
    if (body.studio === "reelcut" && body.library === libraryRoot()) return `http://localhost:${port}`;
  } catch {
    // nothing there, or something that is not a studio
  }
  return undefined;
}

/** Listen on 127.0.0.1, walking up from `port` when it is taken. */
export async function startStudio(port = DEFAULT_PORT, options: StudioOptions = {}, tries = 10): Promise<{ server: http.Server; url: string }> {
  // One manager for the studio that ends up bound, however many ports are tried.
  const manager = options.ingest ?? new IngestManager();
  for (let attempt = 0; attempt < tries; attempt++) {
    const server = createStudioServer({ ...options, ingest: manager });
    const candidate = port + attempt;
    const bound = await new Promise<boolean>((resolve, reject) => {
      server.once("error", (error: NodeJS.ErrnoException) => (error.code === "EADDRINUSE" ? resolve(false) : reject(error)));
      server.listen(candidate, "127.0.0.1", () => resolve(true));
    });
    if (bound) {
      // Only a studio that is really serving watches folders; the tests build servers without one.
      manager.start();
      server.on("close", () => manager.stop());
      return { server, url: `http://localhost:${candidate}` };
    }
  }
  throw new Error(`ports ${port}-${port + tries - 1} are all in use`);
}
