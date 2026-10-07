import { readFileSync } from "node:fs";
import path from "node:path";
import { addAsset, analyzeFile, blobPath, loadIndex, mutateIndex, planMusic, type LibraryAsset } from "../../../src/library/index.js";
import { analyzeMusic } from "../../../src/library/music.js";
import { resolveMusic, type MusicSpec } from "../../../src/render/music.js";

/**
 * Music beds: tracks long enough to lay under a reel, with their beat grid.
 *
 *   npm run music -- list [--json]
 *   npm run music -- find [--mood upbeat,driving] [--bpm 100-130] [--min-seconds 60] [--json]
 *   npm run music -- add <file> --licence "Pixabay Content License" --url <page> [--credit "Artist – Title"] [--name …] [--tags …]
 *   npm run music -- add <file> --generated --model <model> --prompt "…" [--job <id>] [--credits 4]
 *   npm run music -- analyze <id>                       measure a track that came in without a beat grid
 *   npm run music -- plan <reel.json> [--sync fit|snap] [--source library:<id>]   where it would start, how many cuts land
 *
 * Where a track comes from, in order: the library (yours) → a free-licence site (Pixabay Music, Free Music Archive
 * CC0/CC-BY, Incompetech), downloaded with its page, licence and credit line → generated with Higgsfield (AI). The
 * render lays it under the master only, at about -16 LUFS, and writes the bed alone as music-bed.m4a.
 */

function flag(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

const isMusic = (a: LibraryAsset) => a.mediaType === "audio" && a.status === "active" && a.review.state !== "rejected" && Boolean(a.analysis.music);

function line(a: LibraryAsset): string {
  const m = a.analysis.music!;
  const p = a.provenance;
  const src = p.source === "generated" ? "AI-generated" : p.licence ? p.licence : "licence not recorded";
  return `  ${a.id}  ${a.name}\n${" ".repeat(20)}${m.bpm} BPM · ${Math.round(m.durationSeconds)} s · ${m.mood.join(", ")}${m.confidence < 0.25 ? " · beat unclear" : ""} · ${src}`;
}

function list(argv: string[]): void {
  const tracks = loadIndex().assets.filter(isMusic);
  if (argv.includes("--json")) return void console.log(JSON.stringify(tracks.map((a) => ({ id: a.id, name: a.name, ...a.analysis.music, beats: undefined, licence: a.provenance.licence, url: a.provenance.url, source: a.provenance.source })), null, 2));
  console.log(`${tracks.length} track(s)`);
  for (const a of tracks) console.log(line(a));
}

function find(argv: string[]): void {
  const moods = flag(argv, "--mood")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const bpm = flag(argv, "--bpm")?.split("-").map(Number);
  const minSeconds = Number(flag(argv, "--min-seconds") ?? 0);
  const scored = loadIndex().assets.filter(isMusic).map((a) => {
    const m = a.analysis.music!;
    let score = moods.filter((w) => m.mood.includes(w) || a.tags.includes(w)).length;
    if (bpm && bpm.length === 2 && m.bpm >= bpm[0]! && m.bpm <= bpm[1]!) score += 2;
    if (bpm && bpm.length === 2 && (m.bpm < bpm[0]! || m.bpm > bpm[1]!)) score -= 1;
    if (m.confidence >= 0.25) score += 0.5;
    return { a, score, fits: m.durationSeconds >= minSeconds };
  }).filter((x) => x.fits).sort((x, y) => y.score - x.score);
  if (argv.includes("--json")) return void console.log(JSON.stringify(scored.map(({ a, score }) => ({ id: a.id, name: a.name, score, bpm: a.analysis.music!.bpm, mood: a.analysis.music!.mood, seconds: a.analysis.music!.durationSeconds })), null, 2));
  if (!scored.length) return void console.log("Nothing in the library fits. Next: a free-licence site (Pixabay Music, Free Music Archive CC0/CC-BY, Incompetech), then `music add`; or generate one with Higgsfield and `music add --generated`.");
  for (const { a } of scored) console.log(line(a));
}

async function add(argv: string[]): Promise<void> {
  const file = argv.find((x, i) => !x.startsWith("--") && !(i > 0 && argv[i - 1]!.startsWith("--") && !["--generated"].includes(argv[i - 1]!)));
  if (!file) throw new Error("usage: music add <file> --licence … --url … | --generated --model … --prompt …");
  const full = path.resolve(process.env.INIT_CWD ?? process.cwd(), file);
  const generated = argv.includes("--generated");
  const licence = flag(argv, "--licence");
  if (!generated && !licence) throw new Error("a downloaded track needs --licence (and --url): a reel is posted, so where its music came from has to be on record");
  const analysed = await analyzeFile(full, { ...(flag(argv, "--name") ? { name: flag(argv, "--name")! } : {}) });
  if ("skipped" in analysed) throw new Error(analysed.skipped);
  if (analysed.mediaType !== "audio") throw new Error(`${file} is ${analysed.mediaType}, not audio`);
  const music = analysed.analysis.music ?? analyzeMusic(full);
  const credit = flag(argv, "--credit");
  const { asset, existed } = addAsset(full, {
    name: flag(argv, "--name") ?? analysed.name,
    assetKind: "generic",
    tags: [...new Set(["music", ...music.mood, ...(flag(argv, "--tags")?.split(",").map((t) => t.trim()).filter(Boolean) ?? [])])],
    mediaType: "audio",
    analysis: { ...analysed.analysis, music },
    provenance: generated
      ? { source: "generated", generation: { provider: "higgsfield", mode: "music", model: flag(argv, "--model") ?? "unknown", prompt: flag(argv, "--prompt") ?? "music bed", ...(flag(argv, "--job") ? { jobId: flag(argv, "--job")! } : {}), ...(flag(argv, "--credits") ? { credits: Number(flag(argv, "--credits")) } : {}), at: new Date().toISOString() }, note: "AI-generated music bed" }
      : { source: "user", licence: licence!, ...(flag(argv, "--url") ? { url: flag(argv, "--url")! } : {}), ...(credit ? { note: `credit: ${credit}`.slice(0, 300) } : {}) },
  });
  console.log(`${existed ? "already in the library" : "added"}: ${asset.id}  ${asset.name}  ${music.bpm} BPM, ${Math.round(music.durationSeconds)} s, ${music.mood.join(", ")}`);
  console.log(`use it with  "music": { "source": "library:${asset.id}", "sync": "fit" }  in reel.json`);
}

function analyze(argv: string[]): void {
  const id = argv[0];
  const a = loadIndex().assets.find((x) => x.id === id);
  if (!a || a.mediaType !== "audio") throw new Error(`no audio asset ${id}`);
  const music = analyzeMusic(blobPath(a));
  mutateIndex((index) => {
    const x = index.assets.find((y) => y.id === id)!;
    x.analysis = { ...x.analysis, music };
    x.tags = [...new Set([...x.tags.filter((t) => t !== "sfx"), "music", ...music.mood])].sort();
  });
  console.log(`${a.name}: ${music.bpm} BPM (confidence ${music.confidence}), ${music.beats.length} beats, ${music.downbeats.length} bars, ${music.mood.join(", ")}`);
}

function plan(argv: string[]): void {
  const manifestPath = path.resolve(process.env.INIT_CWD ?? process.cwd(), argv[0] ?? "");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { beats: { id: string; durationSeconds: number }[]; music?: MusicSpec };
  const source = flag(argv, "--source") ?? manifest.music?.source;
  if (!source) throw new Error("no music: pass --source library:<id>, or set \"music\" in reel.json");
  const sync = (flag(argv, "--sync") ?? manifest.music?.sync ?? "fit") as "fit" | "snap";
  const resolved = resolveMusic({ source, sync }, path.dirname(manifestPath), loadIndex().assets, blobPath);
  const d = manifest.beats.map((b) => b.durationSeconds);
  const length = d.reduce((x, y) => x + y, 0);
  const cuts = d.slice(0, -1).map((_, i) => d.slice(0, i + 1).reduce((x, y) => x + y, 0));
  const p = planMusic(resolved.analysis, cuts, length, sync);
  console.log(`"${resolved.name}" ${resolved.analysis.bpm} BPM, from ${p.offset.toFixed(2)} s: ${p.onBeat} of ${cuts.length} cuts on a beat; the reel ends ${p.endToBar.toFixed(2)} s from a bar line${p.short ? "; the track is shorter than the reel" : ""}`);
  manifest.beats.forEach((b, i) => { if (i < cuts.length) console.log(`  after ${b.id}  ${cuts[i]!.toFixed(2)} s${sync === "snap" && p.moved[i] ? ` → ${p.cuts[i]!.toFixed(2)} s (${p.moved[i]! > 0 ? "+" : ""}${p.moved[i]!.toFixed(2)})` : ""}`); });
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "list": return list(rest);
    case "find": return find(rest);
    case "add": return add(rest);
    case "analyze": return analyze(rest);
    case "plan": return plan(rest);
    default:
      console.error("usage: music list|find|add|analyze|plan (see the header of scripts/music.ts)");
      process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
