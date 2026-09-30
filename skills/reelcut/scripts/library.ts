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
  const status = a.status === "active" ? "" : `  [${a.status}${a.supersededBy ? ` -> ${a.supersededBy}` : ""}]`;
  const tags = a.tags.length ? `  #${a.tags.join(" #")}` : "";
  return `${a.id}  ${a.assetKind.padEnd(8)} ${a.name}${tags}${status}\n${" ".repeat(18)}${a.provenance.url ?? a.provenance.source}  ·  ${LIBRARY_ASSET_DIR}/${path.basename(a.file)}`;
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

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
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
      console.error("usage: library add|list|search|tag|retire|supersede|serve (see the header of scripts/library.ts)");
      process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
