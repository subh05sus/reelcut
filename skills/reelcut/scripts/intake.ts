import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { intakeDrops, formatIntake, type DroppedFile } from "../../../src/brief/assetIntake.js";
import { formatGapReport, reportAssetGaps } from "../../../src/brief/assetGaps.js";
import { AssetRequirementSchema, type AssetRequirement } from "../../../src/brief/assetRequirementTypes.js";
import { findMoments, formatLibraryMatches, LibraryError, loadIndex, matchLibrary, momentSeconds, type FootageMatch, type LibraryMatchResult } from "../../../src/library/index.js";

/**
 * Match what has been handed over against what the script needs, and report the rest.
 *
 *   npm run intake -- [--dir assets/in] [--requirements out/requirements.json] [--tags chatgpt] [--no-library] [--json]
 *
 * `requirements.json` is an array of `AssetRequirement`, written by the agent in step 2. Without
 * it this just lists what is in the folder, which is still useful before the requirements exist.
 *
 * The library (`~/.reelcut/library`) is searched first: an asset reelcut already acquired and
 * verified does not need acquiring again. Only an `auto` library match closes a requirement; a
 * proposal is shown, and the requirement stays open for the folder to answer too.
 *
 * A requirement with `"form": "footage"` is a moment of a real recording ("Download Claude"). It is looked
 * for in the library's recordings only, by what happens in the moment, and never matched to a dropped file by
 * name. See references/footage.md.
 *
 * Reports, never moves or renames anything. A script that rearranges the files it is describing
 * is a script whose output you cannot check.
 */

const MEDIA = new Set([".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".avif", ".mp4", ".webm", ".mov", ".pdf"]);

interface Args {
  dir: string;
  requirementsPath?: string;
  json: boolean;
  library: boolean;
  tags: string[];
}

function parseArgs(argv: readonly string[]): Args {
  const cwd = process.env.INIT_CWD ?? process.cwd();
  let dir = path.resolve(cwd, "assets/in");
  let requirementsPath: string | undefined;
  let json = false;
  let library = true;
  const tags: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dir") dir = path.resolve(cwd, argv[++i] ?? "");
    else if (arg === "--requirements") requirementsPath = path.resolve(cwd, argv[++i] ?? "");
    else if (arg === "--json") json = true;
    else if (arg === "--no-library") library = false;
    else if (arg === "--tags") tags.push(...(argv[++i] ?? "").split(",").filter(Boolean));
  }
  return { dir, ...(requirementsPath ? { requirementsPath } : {}), json, library, tags };
}

/** Every media file in the folder, one level deep. Sidecars and dotfiles are not assets. */
function collectDrops(dir: string): DroppedFile[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: DroppedFile[] = [];
  for (const name of entries.sort()) {
    if (name.startsWith(".") || name.endsWith(".json")) continue;
    const full = path.join(dir, name);
    let size: number;
    try {
      const stat = statSync(full);
      if (!stat.isFile()) continue;
      size = stat.size;
    } catch {
      continue;
    }
    if (!MEDIA.has(path.extname(name).toLowerCase())) continue;
    out.push({ path: full, name, bytes: size });
  }
  return out;
}

function loadRequirements(file: string): AssetRequirement[] {
  const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
  const list = Array.isArray(raw) ? raw : (raw as { assets?: unknown }).assets;
  if (!Array.isArray(list)) throw new Error(`${file} must be an array of AssetRequirement, or { "assets": [...] }`);
  return list.map((item, i) => {
    const parsed = AssetRequirementSchema.safeParse(item);
    if (!parsed.success) {
      throw new Error(`${file}[${i}] is not a valid AssetRequirement: ${parsed.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
    }
    return parsed.data;
  });
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const drops = collectDrops(args.dir);

  if (!args.requirementsPath) {
    console.log(`${drops.length} file(s) in ${args.dir}`);
    for (const d of drops) console.log(`  ${d.name}  ${((d.bytes ?? 0) / 1024).toFixed(0)}kB`);
    console.log("");
    console.log("Pass --requirements <file.json> to match these against what the script needs.");
    return;
  }

  let requirements: AssetRequirement[];
  try {
    requirements = loadRequirements(args.requirementsPath);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }

  let fromLibrary: LibraryMatchResult = { matches: [], stillOpen: requirements };
  if (args.library) {
    try {
      fromLibrary = matchLibrary(requirements, loadIndex().assets, { tags: args.tags });
    } catch (error) {
      // A broken library is reported, not allowed to stop intake from the folder.
      if (!(error instanceof LibraryError)) throw error;
      console.error(`library skipped: ${error.message}`);
    }
  }
  // Footage: the moment that answers each requirement, best first.
  const footage = requirements
    .filter((r) => r.form === "footage")
    .map((requirement) => ({ requirement, matches: findMoments(loadIndex().assets, requirement.name) }));
  const best = (f: { matches: FootageMatch[] }): FootageMatch | undefined => f.matches[0];
  const closedFootage = new Set(footage.filter((f) => best(f)?.decision === "auto").map((f) => f.requirement.name));
  const closed = new Set([...fromLibrary.matches.filter((m) => m.decision === "auto").map((m) => m.requirement.name), ...closedFootage]);
  const result = intakeDrops(requirements.filter((r) => r.form !== "footage" && !closed.has(r.name)), drops);
  const openFootage = footage.filter((f) => !closedFootage.has(f.requirement.name)).map((f) => f.requirement);
  const gaps = reportAssetGaps([...result.stillOpen, ...openFootage].map((requirement) => ({ requirement, status: "not_provided" as const })));

  if (args.json) {
    console.log(JSON.stringify({ library: fromLibrary.matches, footage: footage.map((f) => ({ requirement: f.requirement.name, matches: f.matches.map((m) => ({ ref: `${m.asset.id}:${m.moment.id}`, label: m.moment.label, seconds: momentSeconds(m.moment), confidence: m.confidence, decision: m.decision, why: m.why })) })), matches: result.matches, unmatched: result.unmatched, gaps }, null, 2));
  } else {
    console.log(`${drops.length} file(s) in ${args.dir}, ${requirements.length} requirement(s)`);
    if (args.library && requirements.some((r) => r.form !== "footage")) {
      console.log("");
      console.log(formatLibraryMatches(fromLibrary));
      if (closed.size > 0) console.log("Refer to a library asset in a composition by the path shown; the render copies it in.");
    }
    if (footage.length > 0) {
      console.log("");
      for (const f of footage) {
        const top = f.matches.slice(0, 3);
        if (top.length === 0) console.log(`      footage: nothing in the library answers "${f.requirement.name}"`);
        for (const m of top) console.log(`${m.decision === "auto" ? "ok  " : "?   "}footage: ${m.asset.id}:${m.moment.id}  "${m.moment.label}" (${momentSeconds(m.moment).toFixed(1)}s) -> ${f.requirement.name}\n      ${m.why}`);
      }
      console.log("Place a moment as <div class=\"rc-footage\" data-footage=\"<asset>:<moment>\">; show a proposal to the user and ask once before using it.");
    }
    console.log("");
    console.log(formatIntake(result).replace(/^(ok {2}|\? {3}|\?\? {2})/gm, "$1drop:"));
    console.log("");
    console.log(formatGapReport(gaps));
  }

  // Non-zero only when something actually stops the reel, so this can gate a step without
  // failing a run that merely has optional gaps left.
  if (gaps.some((g) => g.blocking)) process.exitCode = 1;
}

main();
