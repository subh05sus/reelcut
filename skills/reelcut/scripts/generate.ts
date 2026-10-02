import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { buildPrompt, formatPlan, planGeneration, recordGeneration, registerGenerated, MAX_CLIPS_PER_REEL, type BeatInput } from "../../../src/generate/index.js";
import { GENERATION_MODES, HIGGSFIELD_SETTINGS, getHiggsfieldSetting, loadIndex, setHiggsfieldSetting, type HiggsfieldSetting } from "../../../src/library/index.js";

/**
 * Higgsfield, optionally: decide whether to generate, make the prompt, register what came back, and log
 * what happened to each beat. Calling Higgsfield itself is Claude's job (its MCP); this is everything
 * around it, so the choice, the limits and the fallback are the same every time.
 *
 *   npm run generate -- setting [ask|always|never]
 *   npm run generate -- plan --beats beats.json --connected yes|no [--setting …] [--json]
 *   npm run generate -- prompt --mode atmosphere --subject "a quiet morning before the launch" --seconds 4.4 [--mood "calm, warm"]
 *   npm run generate -- add <file> --mode atmosphere --model "Veo 3" --prompt "…" [--beat beat-04] [--job <id>] [--credits n] [--from-asset <id>]
 *   npm run generate -- record <beat> --manifest out/reel.json --outcome generated|fallback|skipped [--reason "…"] [--asset <id>]
 *
 * `beats.json` is an array of { id, visualType?, abstract?, requirements?: [{ name, assetKind, form? }], stillAsset? }.
 * A generated clip is registered as pending: a person approves it before a reel can use it. If Higgsfield is
 * not connected, or anything fails, the beat is composed in HyperFrames and `record … --outcome fallback` says so.
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

const BeatsSchema = z.array(
  z.object({
    id: z.string().min(1),
    visualType: z.string().optional(),
    abstract: z.boolean().optional(),
    requirements: z.array(z.object({ name: z.string(), assetKind: z.enum(["identity", "generic"]), form: z.enum(["still", "footage"]).optional() })).optional(),
    stillAsset: z.string().optional(),
  }),
);

function setting(argv: string[]): void {
  const value = argv[0];
  if (value === undefined) {
    console.log(`Higgsfield: ${getHiggsfieldSetting()}  (ask: Step 0 asks when it is connected · always: use it when connected · never)`);
    return;
  }
  if (!(HIGGSFIELD_SETTINGS as readonly string[]).includes(value)) throw new Error(`usage: generate setting ${HIGGSFIELD_SETTINGS.join("|")}`);
  setHiggsfieldSetting(value as HiggsfieldSetting);
  console.log(`Higgsfield: ${value}`);
}

function plan(argv: string[]): void {
  const file = flag(argv, "--beats");
  const connected = flag(argv, "--connected");
  const override = flag(argv, "--setting");
  const json = bool(argv, "--json");
  if (!file || (connected !== "yes" && connected !== "no")) throw new Error("usage: generate plan --beats beats.json --connected yes|no [--setting ask|always|never] [--json]");
  if (override !== undefined && !(HIGGSFIELD_SETTINGS as readonly string[]).includes(override)) throw new Error(`--setting ${HIGGSFIELD_SETTINGS.join("|")}`);
  const parsed = BeatsSchema.safeParse(JSON.parse(readFileSync(path.resolve(cwd, file), "utf8")));
  if (!parsed.success) throw new Error(`${file}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  const result = planGeneration(parsed.data as BeatInput[], { setting: (override as HiggsfieldSetting | undefined) ?? getHiggsfieldSetting(), connected: connected === "yes", assets: loadIndex().assets });
  console.log(json ? JSON.stringify(result, null, 2) : formatPlan(result));
  if (result.decisions.some((d) => d.decision === "generate")) console.log(`\nAt most ${MAX_CLIPS_PER_REEL} clips for one reel. Estimate the credits from the Higgsfield tool and confirm once; never generate beyond what was agreed.`);
}

function prompt(argv: string[]): void {
  const mode = flag(argv, "--mode") ?? "atmosphere";
  const subject = flag(argv, "--subject");
  const seconds = Number(flag(argv, "--seconds") ?? 4);
  const mood = flag(argv, "--mood");
  if (!(GENERATION_MODES as readonly string[]).includes(mode)) throw new Error(`--mode ${GENERATION_MODES.join("|")}`);
  if (!subject) throw new Error('usage: generate prompt --mode atmosphere --subject "…" --seconds 4.4 [--mood "…"]');
  const built = buildPrompt({ mode: mode as (typeof GENERATION_MODES)[number], subject, beatSeconds: seconds, ...(mood ? { mood } : {}) });
  console.log(JSON.stringify(built, null, 2));
}

async function add(argv: string[]): Promise<void> {
  const mode = flag(argv, "--mode") ?? "atmosphere";
  const model = flag(argv, "--model");
  const promptText = flag(argv, "--prompt");
  const beat = flag(argv, "--beat");
  const job = flag(argv, "--job");
  const credits = flag(argv, "--credits");
  const from = flag(argv, "--from-asset");
  const file = argv.find((a) => !a.startsWith("--"));
  if (!file || !model || !promptText) throw new Error('usage: generate add <file> --mode atmosphere|whole-beat|animate-still --model "Veo 3" --prompt "…" [--beat beat-04] [--job id] [--credits n] [--from-asset id]');
  if (!(GENERATION_MODES as readonly string[]).includes(mode)) throw new Error(`--mode ${GENERATION_MODES.join("|")}`);
  const { asset, moment, existed } = await registerGenerated({ file: path.resolve(cwd, file), mode: mode as (typeof GENERATION_MODES)[number], model, prompt: promptText, beat, jobId: job, credits: credits === undefined ? undefined : Number(credits), fromAsset: from });
  console.log(`${existed ? "already in the library" : "registered"}: ${asset.id}  ${asset.name}  (${asset.analysis.durationSeconds?.toFixed(1) ?? "?"}s, AI-generated by ${asset.provenance.generation?.model})`);
  console.log(`place it as <div class="rc-footage" data-footage="${asset.id}:${moment.id}" data-frame="plain"> under the beat's type`);
  if (asset.review.state !== "approved") console.log("It is PENDING: a person approves it in the studio's Review tab (or `library review approve " + asset.id + "`) before a reel can use it.");
}

function record(argv: string[]): void {
  const manifest = flag(argv, "--manifest");
  const outcome = flag(argv, "--outcome");
  const reason = flag(argv, "--reason");
  const asset = flag(argv, "--asset");
  const beat = argv.find((a) => !a.startsWith("--"));
  if (!beat || !manifest || !outcome) throw new Error('usage: generate record <beat> --manifest out/reel.json --outcome generated|fallback|skipped [--reason "…"] [--asset id]');
  const entries = recordGeneration(path.resolve(cwd, manifest), { beat, outcome: outcome as "generated" | "fallback" | "skipped", ...(reason ? { reason } : {}), ...(asset ? { assetId: asset } : {}) });
  console.log(`${beat}: ${outcome}${reason ? ` — ${reason}` : ""}  (${entries.length} beat(s) logged in ${manifest})`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "setting":
      return setting(rest);
    case "plan":
      return plan(rest);
    case "prompt":
      return prompt(rest);
    case "add":
      return add(rest);
    case "record":
      return record(rest);
    default:
      console.error("usage: generate setting|plan|prompt|add|record (see the header of scripts/generate.ts)");
      process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
