import { readFileSync, writeFileSync } from "node:fs";
import { loadKit } from "../../../src/render/kit.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isUsableSound, loadIndex, proposeCues, searchSfx, type CueProposal } from "../../../src/library/index.js";
import { collectEvents } from "../../../src/verify/events.js";

/**
 * Sound effects from your own library.
 *
 *   npm run sfx -- list
 *   npm run sfx -- find --event click|type|count|roll|pop|reveal|hit [--tags whoosh] [--max 1.0] [--json]
 *   npm run sfx -- suggest <reel.json> [--cuts] [--apply] [--json]
 *
 * `suggest` loads each beat in Chrome, reads the moments the kit's helpers recorded (clicks, typing,
 * counts, reveals), and proposes a cue from the library for the few that matter. Without `--apply` it
 * only prints. With it, the cues are written into `reel.json` as `library:<id>` sources, which render
 * resolves — and they are heard only when the reel is rendered with `--sfx`. Only sounds a person has
 * approved in the studio are ever proposed.
 */

const cwd = process.env.INIT_CWD ?? process.cwd();

function flag(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  if (at < 0) return undefined;
  const v = argv[at + 1];
  argv.splice(at, 2);
  return v;
}
function bool(argv: string[], name: string): boolean {
  const at = argv.indexOf(name);
  if (at < 0) return false;
  argv.splice(at, 1);
  return true;
}

const row = (a: { id: string; name: string; tags: string[]; analysis: { durationSeconds?: number; gainDb?: number } }): string =>
  `${a.id}  ${(a.analysis.durationSeconds ?? 0).toFixed(2).padStart(5)}s  ${(a.analysis.gainDb ?? 0) >= 0 ? "+" : ""}${a.analysis.gainDb ?? 0} dB  ${a.name}  #${a.tags.join(" #")}`;

function list(): void {
  const sounds = loadIndex().assets.filter((a) => a.mediaType === "audio");
  const usable = sounds.filter(isUsableSound);
  console.log(`${sounds.length} sound(s) in the library, ${usable.length} approved and usable`);
  for (const a of sounds) console.log(`${isUsableSound(a) ? "  " : "? "}${row(a)}${isUsableSound(a) ? "" : `   <${a.review.state}>`}`);
  if (sounds.length > usable.length) console.log("\n? = not approved: approve it in the studio (Review tab) to use it.");
}

function find(argv: string[]): void {
  const event = flag(argv, "--event");
  const tags = (flag(argv, "--tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const max = flag(argv, "--max");
  const json = bool(argv, "--json");
  if (!event && tags.length === 0) throw new Error("usage: sfx find --event click [--tags a,b] [--max seconds] [--json]");
  const matches = searchSfx(loadIndex().assets, { ...(event ? { event } : {}), tags, ...(max ? { maxSeconds: Number(max) } : {}) });
  if (json) return void console.log(JSON.stringify(matches.map((m) => ({ id: m.asset.id, name: m.asset.name, score: m.score, why: m.why, source: `library:${m.asset.id}`, durationSeconds: m.asset.analysis.durationSeconds, gainDb: m.asset.analysis.gainDb })), null, 2));
  console.log(matches.length ? matches.map((m) => `${m.score.toFixed(1).padStart(5)}  ${row(m.asset)}  (${m.why})`).join("\n") : "No approved sound fits. Add some in the studio (Library → drop files), then approve them.");
}

interface Manifest { beats: { id: string; durationSeconds: number; composition: string; sfx?: { source: string; at: number; durationSeconds?: number; volume?: number }[] }[] }

async function suggest(argv: string[]): Promise<void> {
  const cuts = bool(argv, "--cuts");
  const apply = bool(argv, "--apply");
  const json = bool(argv, "--json");
  const file = argv.find((a) => !a.startsWith("--"));
  if (!file) throw new Error("usage: sfx suggest <reel.json> [--cuts] [--apply] [--json]");
  const manifestPath = path.resolve(cwd, file);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const base = path.dirname(manifestPath);
  const kit = loadKit("inline");
  if (!loadIndex().assets.some(isUsableSound)) {
    console.log("No approved sounds in the library, so there is nothing to propose. Drop sounds into the studio (Library), approve them (Review), then run this again.");
    return;
  }
  const events = await collectEvents(manifest.beats.map((b) => ({ id: b.id, html: readFileSync(path.resolve(base, b.composition), "utf8") })), kit);
  const proposals = proposeCues(manifest.beats.map((b) => ({ id: b.id, durationSeconds: b.durationSeconds, events: events[b.id] ?? [] })), loadIndex().assets, { cuts });

  if (json) console.log(JSON.stringify(proposals, null, 2));
  else if (proposals.length === 0) console.log("Nothing to propose: no beat has a moment the library has a sound for.");
  else for (const p of proposals) console.log(`${p.beat.padEnd(14)} ${p.at.toFixed(2).padStart(5)}s  ${p.name}  (${p.why})`);

  if (!apply || proposals.length === 0) {
    if (proposals.length && !apply) console.log("\nNot written. Add --apply to put these cues in reel.json; they play only with `npm run render -- reel.json --sfx`.");
    return;
  }
  let added = 0;
  const byBeat = new Map<string, CueProposal[]>();
  for (const p of proposals) byBeat.set(p.beat, [...(byBeat.get(p.beat) ?? []), p]);
  for (const beat of manifest.beats) {
    for (const p of byBeat.get(beat.id) ?? []) {
      const source = `library:${p.soundId}`;
      beat.sfx ??= [];
      if (beat.sfx.some((c) => c.source === source && Math.abs(c.at - p.at) < 0.05)) continue;
      beat.sfx.push({ source, at: p.at, ...(p.durationSeconds ? { durationSeconds: Math.round(p.durationSeconds * 1000) / 1000 } : {}) });
      beat.sfx.sort((a, b) => a.at - b.at);
      added += 1;
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nWrote ${added} cue(s) into ${manifestPath}. Render with --sfx to hear them.`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "list") return list();
  if (command === "find") return find(rest);
  if (command === "suggest") return suggest(rest);
  console.error("usage: sfx list | find --event click | suggest <reel.json> [--cuts] [--apply]");
  process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
