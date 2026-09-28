import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { intakeDrops, formatIntake, type DroppedFile } from "../../../src/brief/assetIntake.js";
import { formatGapReport, reportAssetGaps } from "../../../src/brief/assetGaps.js";
import { AssetRequirementSchema, type AssetRequirement } from "../../../src/brief/assetRequirementTypes.js";

/**
 * Match what has been handed over against what the script needs, and report the rest.
 *
 *   npm run intake -- [--dir assets/in] [--requirements out/requirements.json] [--json]
 *
 * `requirements.json` is an array of `AssetRequirement`, written by the agent in step 2. Without
 * it this just lists what is in the folder, which is still useful before the requirements exist.
 *
 * Reports, never moves or renames anything. A script that rearranges the files it is describing
 * is a script whose output you cannot check.
 */

const MEDIA = new Set([".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".avif", ".mp4", ".webm", ".mov", ".pdf"]);

interface Args {
  dir: string;
  requirementsPath?: string;
  json: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const cwd = process.env.INIT_CWD ?? process.cwd();
  let dir = path.resolve(cwd, "assets/in");
  let requirementsPath: string | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dir") dir = path.resolve(cwd, argv[++i] ?? "");
    else if (arg === "--requirements") requirementsPath = path.resolve(cwd, argv[++i] ?? "");
    else if (arg === "--json") json = true;
  }
  return { dir, ...(requirementsPath ? { requirementsPath } : {}), json };
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

  const result = intakeDrops(requirements, drops);
  const gaps = reportAssetGaps(result.stillOpen.map((requirement) => ({ requirement, status: "not_provided" as const })));

  if (args.json) {
    console.log(JSON.stringify({ matches: result.matches, unmatched: result.unmatched, gaps }, null, 2));
  } else {
    console.log(`${drops.length} file(s) in ${args.dir}, ${requirements.length} requirement(s)`);
    console.log("");
    console.log(formatIntake(result));
    console.log("");
    console.log(formatGapReport(gaps));
  }

  // Non-zero only when something actually stops the reel, so this can gate a step without
  // failing a run that merely has optional gaps left.
  if (gaps.some((g) => g.blocking)) process.exitCode = 1;
}

main();
