import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { AssetKindSchema, AssetRequirementSchema, type AssetRequirement } from "../../../src/brief/assetRequirementTypes.js";
import {
  addAsset,
  filterByTags,
  formatLibraryMatches,
  LIBRARY_ASSET_DIR,
  libraryRoot,
  loadIndex,
  matchLibrary,
  ProvenanceSchema,
  updateAsset,
  type LibraryAsset,
  type Provenance,
} from "../../../src/library/index.js";
import { runIdFor } from "../../../src/library/runs.js";
import { addFolder, annotateAsset, claudeQueue, IngestManager, ingestBatch, isIngestPaused, listFolders, removeFolder, scanDir, setIngestPaused, setReview, summarise, thumbBlobPath, blobPath, updateFolder, type IngestSource } from "../../../src/library/index.js";
import { assetSignals, recordSignals, suppressedTags } from "../../../src/learnings/index.js";
import { lstatSync } from "node:fs";
import { DEFAULT_PORT, findRunningStudio, startStudio } from "../../../src/studio/server.js";

/**
 * The asset library, from the command line.
 *
 *   npm run library -- add <file> --kind identity|generic [--name "Claude Logo"] [--tags claude,logo]
 *                         [--url <source>] [--licence "<terms>"] [--source user|capture|brand|drawn] [--note "..."]
 *   npm run library -- list [--tags chatgpt] [--all]
 *   npm run library -- search --requirements out/requirements.json [--tags chatgpt] [--json]
 *   npm run library -- tag <id> +chatgpt -old
 *   npm run library -- retire <id>
 *   npm run library -- supersede <old-id> <new-id>
 *   npm run library -- ingest <file-or-folder>... [--kind identity|generic] [--trusted] [--private]
 *   npm run library -- folders add <path> [--label "Brand kit"] [--kind identity|generic] [--trusted] [--private]
 *   npm run library -- folders list | remove <id> | pause <id> | resume <id> | rescan [<id>]
 *   npm run library -- pause | resume | status                               (the master pause for watched folders)
 *   npm run library -- queue [--json]                      (what is waiting for Claude to look at)
 *   npm run library -- annotate <id> --tags a,b --describe "an orange starburst"     (Claude's tags; never approves)
 *   npm run library -- review approve|reject <id>... [--kind identity|generic]       (a person's decision)
 *   npm run library -- serve [--port 5198] [--open] [--reel <out dir>]      (also: npm run studio)
 *
 * `serve` reuses a studio already running for this library: it opens the page and exits instead
 * of starting a second server. `--reel` opens straight onto that reel.
 *
 * A capture's `*.png.json` sidecar is picked up automatically by `add`, so its URL and capture
 * time become the asset's provenance without retyping them.
 */

const cwd = process.env.INIT_CWD ?? process.cwd();

function flag(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  if (at < 0) return undefined;
  const value = argv[at + 1];
  argv.splice(at, 2);
  return value;
}

function bool(argv: string[], name: string): boolean {
  const at = argv.indexOf(name);
  if (at < 0) return false;
  argv.splice(at, 1);
  return true;
}

function tagList(value: string | undefined): string[] {
  return (value ?? "").split(",").map((t) => t.trim()).filter(Boolean);
}

function line(a: LibraryAsset): string {
  const review = a.review.state === "approved" ? "" : `  <${a.review.state}>`;
  const status = a.status === "active" ? "" : `  [${a.status}${a.supersededBy ? ` -> ${a.supersededBy}` : ""}]`;
  const tags = a.tags.length ? `  #${a.tags.join(" #")}` : "";
  return `${a.id}  ${a.assetKind.padEnd(8)} ${a.name}${tags}${status}${review}\n${" ".repeat(18)}${a.provenance.url ?? a.provenance.source}  ·  ${LIBRARY_ASSET_DIR}/${path.basename(a.file)}`;
}

function nameFrom(file: string): string {
  return path.basename(file, path.extname(file)).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

function add(argv: string[]): void {
  const kindRaw = flag(argv, "--kind");
  const name = flag(argv, "--name");
  const tags = tagList(flag(argv, "--tags"));
  const url = flag(argv, "--url");
  const licence = flag(argv, "--licence") ?? flag(argv, "--license");
  const sourceFlag = flag(argv, "--source");
  const note = flag(argv, "--note");
  const file = argv.find((a) => !a.startsWith("--"));
  if (!file) throw new Error("usage: library add <file> --kind identity|generic [--name ...] [--tags a,b] [--url ...]");

  // Kind is never defaulted: it decides whether the asset may be reused without asking.
  const kind = AssetKindSchema.safeParse(kindRaw);
  if (!kind.success) throw new Error("--kind identity|generic is required. A named brand's mark or a real product screen is identity.");

  const full = path.resolve(cwd, file);
  const sidecarPath = `${full}.json`;
  const sidecar = existsSync(sidecarPath) ? (JSON.parse(readFileSync(sidecarPath, "utf8")) as Record<string, unknown>) : undefined;

  const sidecarUrl = typeof sidecar?.url === "string" ? sidecar.url : undefined;
  const provenance: Provenance = ProvenanceSchema.parse({
    source: sourceFlag ?? (sidecar ? "capture" : url ? "brand" : "user"),
    url: url ?? sidecarUrl,
    licence,
    capturedAt: typeof sidecar?.capturedAt === "string" ? sidecar.capturedAt : undefined,
    captureSidecar: sidecar,
    note,
  });

  const { asset, existed } = addAsset(full, { name: name ?? nameFrom(full), assetKind: kind.data, tags, provenance });
  console.log(existed ? "already in the library; tags merged:" : "added:");
  console.log(line(asset));
  if (asset.assetKind === "identity" && !asset.provenance.url && !asset.provenance.captureSidecar && asset.provenance.source !== "user") {
    console.log("\nNo source recorded, so this will only ever be proposed, never reused automatically.");
  }
}

function list(argv: string[]): void {
  const tags = tagList(flag(argv, "--tags"));
  const all = bool(argv, "--all");
  const assets = filterByTags(loadIndex().assets, tags).filter((a) => all || a.status === "active");
  console.log(`${assets.length} asset(s) in ${libraryRoot()}${tags.length ? ` tagged #${tags.join(" #")}` : ""}`);
  for (const a of assets) console.log(line(a));
}

function loadRequirements(file: string): AssetRequirement[] {
  const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
  const items = Array.isArray(raw) ? raw : (raw as { assets?: unknown }).assets;
  if (!Array.isArray(items)) throw new Error(`${file} must be an array of AssetRequirement, or { "assets": [...] }`);
  return items.map((item) => AssetRequirementSchema.parse(item));
}

function search(argv: string[]): void {
  const req = flag(argv, "--requirements");
  const tags = tagList(flag(argv, "--tags"));
  const json = bool(argv, "--json");
  if (!req) throw new Error("usage: library search --requirements <file.json> [--tags a,b] [--json]");
  const result = matchLibrary(loadRequirements(path.resolve(cwd, req)), loadIndex().assets, { tags });
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(formatLibraryMatches(result));
  if (result.stillOpen.length > 0) console.log(`\nNot in the library: ${result.stillOpen.map((r) => r.name).join(", ")}`);
}

function tag(argv: string[]): void {
  const [id, ...changes] = argv;
  if (!id || changes.length === 0) throw new Error("usage: library tag <id> +add -remove");
  const addTags = changes.filter((c) => !c.startsWith("-")).map((c) => c.replace(/^\+/, ""));
  const removeTags = changes.filter((c) => c.startsWith("-")).map((c) => c.slice(1));
  console.log(line(updateAsset(id, { addTags, removeTags })));
}

function openBrowser(url: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
}

async function serve(argv: string[]): Promise<void> {
  const port = Number(flag(argv, "--port") ?? DEFAULT_PORT);
  const reel = flag(argv, "--reel");
  const open = bool(argv, "--open") || reel !== undefined;
  const hash = reel ? `#reels/${runIdFor(path.resolve(cwd, reel))}` : "";

  const running = await findRunningStudio(port);
  if (running) {
    console.log(`reelcut studio already running on ${running}`);
    if (open) openBrowser(`${running}/${hash}`);
    return;
  }

  const { url } = await startStudio(port);
  console.log(`reelcut studio on ${url}   (library: ${libraryRoot()})`);
  console.log("Ctrl+C to stop.");
  if (open) openBrowser(`${url}/${hash}`);
}

/** Ingest local files and folders once, without registering them as watched. */
async function ingest(argv: string[]): Promise<void> {
  const kind = flag(argv, "--kind") ?? "generic";
  if (kind !== "identity" && kind !== "generic") throw new Error("--kind identity|generic");
  const trusted = bool(argv, "--trusted");
  const priv = bool(argv, "--private");
  const targets = argv.filter((a) => !a.startsWith("--"));
  if (targets.length === 0) throw new Error("usage: library ingest <file-or-folder>... [--kind ...] [--trusted] [--private]");
  const source: IngestSource = { kind: "cli", origin: "cli", assetKind: kind, trusted, private: priv };
  const items = targets.flatMap((t) => {
    const full = path.resolve(cwd, t);
    if (lstatSync(full).isDirectory()) return scanDir(full).files.map((f) => ({ file: f.abs, name: path.basename(f.abs), relPath: f.rel, source: { ...source, origin: path.basename(full) } }));
    return [{ file: full, name: path.basename(full), source }];
  });
  const outcomes = await ingestBatch(items, { suppress: () => suppressedTags() });
  const count = (state: string) => outcomes.filter((o) => o.state === state).length;
  console.log(`${items.length} file(s): ${count("ingested")} added, ${count("duplicate")} duplicate, ${count("skipped")} skipped, ${count("failed")} failed`);
  for (const o of outcomes.filter((x) => x.state === "skipped" || x.state === "failed")) console.log(`  ${o.state}  ${o.path}  ${o.reason ?? ""}`);
  if (!trusted && count("ingested") > 0) console.log("\nAdded as pending: approve them in the studio (Review tab) or with `library review approve <id>`.");
}

async function folders(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  if (sub === "add") {
    const kind = flag(rest, "--kind") ?? "generic";
    if (kind !== "identity" && kind !== "generic") throw new Error("--kind identity|generic");
    const label = flag(rest, "--label");
    const trusted = bool(rest, "--trusted");
    const priv = bool(rest, "--private");
    const target = rest.find((a) => !a.startsWith("--"));
    if (!target) throw new Error("usage: library folders add <path> [--label ...] [--kind ...] [--trusted] [--private]");
    const folder = addFolder({ path: path.resolve(cwd, target), ...(label ? { label } : {}), kind, trusted, private: priv });
    console.log(`watching ${folder.path}  (id ${folder.id}${folder.trusted ? ", trusted" : ""}${folder.private ? ", private" : ""})`);
    console.log("The studio scans it while it runs; or run `library folders rescan` to ingest now.");
    return;
  }
  if (sub === "list" || sub === undefined) {
    const all = listFolders();
    console.log(`${all.length} watched folder(s)${isIngestPaused() ? "  [ALL PAUSED: `library resume`]" : ""}`);
    for (const f of all) {
      const c = summarise(undefined, f.id).counts;
      console.log(`${f.id}  ${f.paused ? "paused " : "watching"}  ${f.kind}${f.trusted ? " trusted" : ""}${f.private ? " private" : ""}  ${f.path}\n          ${c.ingested} added, ${c.duplicate} duplicate, ${c.skipped} skipped, ${c.failed} failed${f.lastError ? `  ! ${f.lastError}` : ""}`);
    }
    return;
  }
  if (sub === "remove" || sub === "pause" || sub === "resume") {
    const id = rest[0];
    if (!id) throw new Error(`usage: library folders ${sub} <id>`);
    if (sub === "remove") removeFolder(id);
    else updateFolder(id, { paused: sub === "pause" });
    console.log(`${sub}d ${id}`.replace("removed", "removed (assets already added stay)"));
    return;
  }
  if (sub === "rescan") {
    if (isIngestPaused()) throw new Error("ingest is paused: run `library resume` first");
    const outcomes = await new IngestManager({ watch: false }).rescan(rest[0]);
    const count = (state: string) => outcomes.filter((o) => o.state === state).length;
    console.log(`${outcomes.length} new or changed file(s): ${count("ingested")} added, ${count("duplicate")} duplicate, ${count("skipped")} skipped, ${count("failed")} failed`);
    return;
  }
  throw new Error("usage: library folders add|list|remove|pause|resume|rescan");
}

function queue(argv: string[]): void {
  const json = bool(argv, "--json");
  const items = claudeQueue(loadIndex().assets);
  if (json) {
    console.log(JSON.stringify(items.map((a) => ({ id: a.id, name: a.name, mediaType: a.mediaType, view: thumbBlobPath(a) ?? blobPath(a), file: blobPath(a), tags: a.tags, from: a.provenance.note, width: a.analysis.width, height: a.analysis.height })), null, 2));
    return;
  }
  console.log(`${items.length} asset(s) waiting for Claude`);
  for (const a of items) console.log(`${a.id}  ${a.mediaType.padEnd(7)} ${a.name}${a.tags.length ? `  #${a.tags.join(" #")}` : ""}`);
}

function annotate(argv: string[]): void {
  const tags = tagList(flag(argv, "--tags"));
  const describe = flag(argv, "--describe");
  if (flag(argv, "--kind") !== undefined) throw new Error("annotate cannot set the kind: only a person decides that something is an identity asset (Review tab, or `library review approve <id> --kind identity`)");
  const id = argv.find((a) => !a.startsWith("--"));
  if (!id || (tags.length === 0 && !describe)) throw new Error('usage: library annotate <id> --tags a,b [--describe "what it shows"]');
  console.log(line(annotateAsset(id, { tags, ...(describe ? { description: describe } : {}) })));
}

function review(argv: string[]): void {
  const [action, ...rest] = argv;
  if (action !== "approve" && action !== "reject") throw new Error("usage: library review approve|reject <id>... [--kind identity|generic]");
  const kind = flag(rest, "--kind");
  if (kind !== undefined && kind !== "identity" && kind !== "generic") throw new Error("--kind identity|generic");
  const ids = rest.filter((a) => !a.startsWith("--"));
  if (ids.length === 0) throw new Error("name at least one asset id");
  const results = setReview(ids, action === "approve" ? "approved" : "rejected", "user", kind ? { kind } : {});
  const at = new Date().toISOString();
  if (action === "approve") {
    const signals = results.flatMap((r) => assetSignals({ after: r.asset, accepted: r.accepted, at }));
    if (signals.length) recordSignals(signals);
  }
  for (const r of results) console.log(line(r.asset));
  console.log(`${results.length} ${action === "approve" ? "approved" : "rejected"}`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "ingest":
      return ingest(rest);
    case "folders":
      return folders(rest);
    case "queue":
      return queue(rest);
    case "annotate":
      return annotate(rest);
    case "review":
      return review(rest);
    case "pause":
      setIngestPaused(true);
      console.log("Paused: watched folders will not be read, scanned or indexed until `library resume`.");
      return;
    case "resume":
      setIngestPaused(false);
      console.log("Resumed.");
      return;
    case "status":
      console.log(`ingest: ${isIngestPaused() ? "PAUSED" : "running"}  ·  ${listFolders().length} watched folder(s)  ·  ${loadIndex().assets.filter((a) => a.review.state === "pending").length} pending review  ·  ${claudeQueue(loadIndex().assets).length} waiting for Claude`);
      return;
    case "add":
      return add(rest);
    case "list":
      return list(rest);
    case "search":
      return search(rest);
    case "tag":
      return tag(rest);
    case "retire":
      if (!rest[0]) throw new Error("usage: library retire <id>");
      console.log(line(updateAsset(rest[0], { status: "retired" })));
      return;
    case "supersede":
      if (!rest[0] || !rest[1]) throw new Error("usage: library supersede <old-id> <new-id>");
      console.log(line(updateAsset(rest[0], { supersededBy: rest[1] })));
      return;
    case "serve":
      return serve(rest);
    default:
      console.error("usage: library add|list|search|tag|retire|supersede|ingest|folders|pause|resume|status|queue|annotate|review|serve (see the header of scripts/library.ts)");
      process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
