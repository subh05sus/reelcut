import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream, readFileSync, statSync } from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blobPath, findAsset, LibraryError, libraryRoot, loadIndex, updateAsset, type AssetPatch } from "../library/store.js";
import { filterByTags } from "../library/match.js";
import { findRun, listRuns } from "../library/runs.js";
import { AssetStatusSchema } from "../library/schema.js";

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

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new HttpError(413, "body too large");
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
  return patch;
}

export function createStudioServer(options: StudioOptions = {}): http.Server {
  const spawnRender = options.spawnRender ?? defaultSpawnRender;
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
    if (parts[0] === "api" && parts[1] === "assets") {
      if (read && parts.length === 2) {
        const tags = (url.searchParams.get("tags") ?? "").split(",").filter(Boolean);
        const q = (url.searchParams.get("q") ?? "").toLowerCase();
        const assets = filterByTags(loadIndex().assets, tags).filter((a) => !q || `${a.name} ${a.tags.join(" ")} ${a.provenance.url ?? ""}`.toLowerCase().includes(q));
        return sendJson(res, 200, { assets: assets.sort((a, b) => b.addedAt.localeCompare(a.addedAt)) });
      }
      if (method === "PATCH" && parts.length === 3) {
        const patch = toPatch(await readBody(req));
        return sendJson(res, 200, { asset: updateAsset(parts[2]!, patch) });
      }
    }
    if (read && parts[0] === "api" && parts[1] === "tags" && parts.length === 2) {
      const counts: Record<string, number> = {};
      for (const a of loadIndex().assets) for (const t of a.tags) counts[t] = (counts[t] ?? 0) + 1;
      return sendJson(res, 200, { tags: counts });
    }

    // ---- runs
    if (parts[0] === "api" && parts[1] === "runs") {
      if (read && parts.length === 2) return sendJson(res, 200, { runs: listRuns() });
      const run = parts[2] ? findRun(parts[2]) : undefined;
      if (parts.length >= 3 && !run) throw new HttpError(404, "no such run");
      if (read && parts.length === 3 && run) {
        return sendJson(res, 200, {
          run,
          plan: run.missing ? undefined : readIfPresent(path.join(run.outDir, "plan.md")),
          report: run.missing ? undefined : readIfPresent(path.join(run.outDir, "report.md")),
          jobs: jobs.filter((j) => j.runId === run.id),
        });
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
  for (let attempt = 0; attempt < tries; attempt++) {
    const server = createStudioServer(options);
    const candidate = port + attempt;
    const bound = await new Promise<boolean>((resolve, reject) => {
      server.once("error", (error: NodeJS.ErrnoException) => (error.code === "EADDRINUSE" ? resolve(false) : reject(error)));
      server.listen(candidate, "127.0.0.1", () => resolve(true));
    });
    if (bound) return { server, url: `http://localhost:${candidate}` };
  }
  throw new Error(`ports ${port}-${port + tries - 1} are all in use`);
}
