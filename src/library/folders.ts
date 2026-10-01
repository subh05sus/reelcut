import { createHash } from "node:crypto";
import { existsSync, readdirSync, realpathSync, statSync, type Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { AssetKindSchema } from "../brief/assetRequirementTypes.js";
import { LibraryError, readValidated, reelcutHome, withLock, writeAtomic } from "./store.js";

/**
 * Watched folders: places you keep assets, which reelcut reads from and never writes to.
 *
 * A cloud-synced folder (Google Drive, Dropbox, OneDrive) is just a local path, so this is also how
 * "point it at the cloud folder" works. Only a person registers a folder, and what a folder says
 * about its contents is what the person said: its `kind` is the kind its files get, `trusted` skips
 * the review step for them, and `private` keeps them out of the queue Claude looks through.
 */

export const FolderSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{8}$/),
  path: z.string(),
  label: z.string().max(60).optional(),
  /** The kind its files are given. Set by the person; never inferred. */
  kind: AssetKindSchema.default("generic"),
  /** Files here are approved the moment they are ingested. */
  trusted: z.boolean().default(false),
  /** Files here are analysed on this machine and never shown to Claude. */
  private: z.boolean().default(false),
  paused: z.boolean().default(false),
  addedAt: z.string(),
  lastScanAt: z.string().optional(),
  lastError: z.string().optional(),
});
export type Folder = z.infer<typeof FolderSchema>;

const FoldersSchema = z.object({ version: z.literal(1), folders: z.array(FolderSchema) });

function foldersPath(): string {
  return path.join(reelcutHome(), "folders.json");
}

export function listFolders(): Folder[] {
  return readValidated(foldersPath(), (raw) => FoldersSchema.safeParse(raw), { version: 1 as const, folders: [] }).folders;
}

function mutateFolders<T>(fn: (folders: Folder[]) => T): T {
  return withLock(`${foldersPath()}.lock`, () => {
    const folders = listFolders();
    const result = fn(folders);
    writeAtomic(foldersPath(), `${JSON.stringify({ version: 1, folders }, null, 2)}\n`);
    return result;
  });
}

const samePath = (a: string, b: string): boolean => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
const inside = (child: string, parent: string): boolean => {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

export interface AddFolderInput {
  path: string;
  label?: string;
  kind?: "identity" | "generic";
  trusted?: boolean;
  private?: boolean;
}

/**
 * Register a folder. Refuses the places where watching goes wrong: one that does not exist, a
 * drive root or the home folder (far too much to ingest), reelcut's own library (it would eat
 * itself), and a folder inside or around one already watched (every file would be seen twice).
 */
export function addFolder(input: AddFolderInput): Folder {
  let real: string;
  try {
    real = realpathSync(path.resolve(input.path));
    if (!statSync(real).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new LibraryError(`${input.path} is not a folder that exists`);
  }
  if (path.parse(real).root === real) throw new LibraryError("a whole drive is too much to watch: choose the folder the assets are in");
  if (samePath(real, os.homedir())) throw new LibraryError("the home folder is too much to watch: choose the folder the assets are in");
  const home = reelcutHome();
  if (samePath(real, home) || inside(real, home) || inside(home, real)) throw new LibraryError("that folder contains reelcut's own library; choose a different one");

  return mutateFolders((folders) => {
    for (const f of folders) {
      if (samePath(f.path, real)) throw new LibraryError(`${real} is already watched`);
      if (inside(real, f.path)) throw new LibraryError(`${real} is already covered by the watched folder ${f.path}`);
      if (inside(f.path, real)) throw new LibraryError(`${real} contains the watched folder ${f.path}; remove that one first`);
    }
    const folder: Folder = FolderSchema.parse({
      id: createHash("sha256").update(real.toLowerCase()).digest("hex").slice(0, 8),
      path: real,
      ...(input.label ? { label: input.label.slice(0, 60) } : {}),
      kind: input.kind ?? "generic",
      trusted: input.trusted ?? false,
      private: input.private ?? false,
      paused: false,
      addedAt: new Date().toISOString(),
    });
    folders.push(folder);
    return folder;
  });
}

export interface FolderPatch {
  label?: string;
  kind?: "identity" | "generic";
  trusted?: boolean;
  private?: boolean;
  paused?: boolean;
  lastScanAt?: string;
  lastError?: string | null;
}

export function updateFolder(id: string, patch: FolderPatch): Folder {
  return mutateFolders((folders) => {
    const folder = folders.find((f) => f.id === id);
    if (!folder) throw new LibraryError(`no watched folder ${id}`);
    if (patch.label !== undefined) folder.label = patch.label.slice(0, 60);
    if (patch.kind) folder.kind = patch.kind;
    if (patch.trusted !== undefined) folder.trusted = patch.trusted;
    if (patch.private !== undefined) folder.private = patch.private;
    if (patch.paused !== undefined) folder.paused = patch.paused;
    if (patch.lastScanAt !== undefined) folder.lastScanAt = patch.lastScanAt;
    if (patch.lastError !== undefined) {
      if (patch.lastError === null) delete folder.lastError;
      else folder.lastError = patch.lastError;
    }
    return folder;
  });
}

/** Stop watching. What was ingested stays: removing a folder never deletes an asset. */
export function removeFolder(id: string): void {
  mutateFolders((folders) => {
    const at = folders.findIndex((f) => f.id === id);
    if (at < 0) throw new LibraryError(`no watched folder ${id}`);
    folders.splice(at, 1);
  });
}

// ---------------------------------------------------------------- scanning

export interface Candidate {
  abs: string;
  /** Path relative to the scanned root, with forward slashes. */
  rel: string;
  size: number;
  mtimeMs: number;
}

export interface ScanResult {
  files: Candidate[];
  /** More files than the cap: the rest are picked up on the next scan. */
  truncated: boolean;
}

export const MAX_SCAN_FILES = 5000;
const SKIP_DIRS = new Set(["node_modules", ".git", "__MACOSX", "$RECYCLE.BIN", "System Volume Information"]);
const SKIP_FILE = /^(\.|~\$|thumbs\.db$|desktop\.ini$)|\.(tmp|part|crdownload|download|partial|swp|lock|icloud)$|\.png\.json$/i;

/**
 * Every file under a root, without following links.
 *
 * A symbolic link is skipped, whether to a file or a folder: following one is how a scan escapes the
 * folder it was given, or walks in a circle. Dot-files, sync clients' temporary files and editors'
 * lock files are not assets.
 */
export function scanDir(root: string, limit = MAX_SCAN_FILES): ScanResult {
  const files: Candidate[] = [];
  const stack: string[] = [root];
  let truncated = false;
  while (stack.length > 0 && !truncated) {
    const dir = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !SKIP_DIRS.has(entry.name)) stack.push(abs);
        continue;
      }
      if (!entry.isFile() || SKIP_FILE.test(entry.name)) continue;
      try {
        const stat = statSync(abs);
        files.push({ abs, rel: path.relative(root, abs).split(path.sep).join("/"), size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        continue; // vanished between the listing and the stat
      }
      if (files.length >= limit) {
        truncated = true;
        break;
      }
    }
  }
  return { files, truncated };
}

export function folderExists(folder: Folder): boolean {
  return existsSync(folder.path);
}
