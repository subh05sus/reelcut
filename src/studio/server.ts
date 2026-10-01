import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream, readFileSync, rmSync, statSync } from "node:fs";
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
export function publicAsset(a: LibraryAsset): LibraryAsset & { queued: boolean; thumbUrl?: string } {
  return { ...a, queued: needsClaude(a), ...(a.thumb ? { thumbUrl: `/files/thumb/${a.id}` } : {}) };
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
        return sendJson(res, 200, { ok: true });
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
      if (parts[1] === "thumb" && parts.length === 3) {
        const asset = findAsset(parts[2]!.replace(/\.[a-z0-9]+$/i, ""));
        const thumb = asset ? thumbBlobPath(asset) : undefined;
        if (!thumb) throw new HttpError(404, "no preview");
        return sendFile(req, res, thumb);
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
