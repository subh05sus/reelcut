import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addClawdSoundsToManifest, buildClawdSounds, claudeTopic, convertPack, kitPoses, loadClawdPrefs, MOVES, packModule, planClawd, setFavourite, shotComposition,
} from "../../../src/clawd/index.js";
import { defaultPersonality } from "../../../src/personality/index.js";
import { packDir } from "../../../src/library/sfxpack.js";
import { parseScript } from "../../../src/planner/parseScript.js";
import { parseSrt } from "../../../src/planner/parseSrt.js";
import { segmentBeats } from "../../../src/planner/beatSegmentation.js";
import { mergeShortBeats } from "../../../src/planner/mergeShortBeats.js";
import { buildProject } from "../../../src/render/project.js";
import { loadKit, PROJECT_FONT_DIR } from "../../../src/render/kit.js";
import { renderHyperframesProject } from "../../../src/render/hyperframes.js";
import { fontFilesFor } from "../../../src/fonts/index.js";
import { STYLES } from "../../../src/personality/index.js";

/**
 * Clawd, the Claude mascot, on the command line.
 *
 *   npm run clawd -- brief                        the personality's mascot setting, starred moves and poses, and what Clawd can do
 *   npm run clawd -- check <script.txt|srt>       is the script about Claude, and a first idea of Clawd's part in each beat
 *   npm run clawd -- poses [--tag word] [--json]  the mascot pack's poses (RC.clawd.pose)
 *   npm run clawd -- moves [--json]               the moves (the studio's Clawd page, overlay clips)
 *   npm run clawd -- import [dir]                 (maintainers) re-cast the mascot pack (assets/clawd-pack) into ui/82-clawd-pack.js
 *   npm run clawd -- sounds                       (maintainers) synthesise Clawd's 8-bit blips into the bundled sound pack
 *   npm run clawd -- overlay <move|pose:id|all> [--style claymation] [--look ink] [--format mov|webm] [--size 1080] [--out dir]
 *                                                 transparent clips of Clawd alone, for laying over footage in an editor
 *   npm run clawd -- star <move:id|pose:id> · unstar <…> · stars
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PACK_FILE = path.join(REPO, "skills", "reelcut", "assets", "kit", "ui", "82-clawd-pack.js");

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function brief(): number {
  const p = defaultPersonality(), prefs = loadClawdPrefs();
  const m = p?.mascot;
  console.log(m ? (m.character === "none" ? "Mascot: none in this personality." : `Mascot: Clawd, ${m.role} in ${m.when === "claude" ? "reels about Claude" : m.when === "always" ? "every reel" : "reels that ask for it"}, ${m.size}${m.wear ? `, wearing ${m.wear}` : ""}.`)
    : "Mascot: no personality yet; Clawd hosts reels about Claude by default.");
  console.log(prefs.favourites.length ? `Starred (reach for these first): ${prefs.favourites.join(", ")}` : "Starred: none yet (star moves and poses on the studio's Clawd page).");
  console.log(`Moves: ${MOVES.map((x) => x.id).join(", ")}`);
  console.log(`Poses: ${kitPoses().length} from the mascot pack (npm run clawd -- poses --tag <word>).`);
  console.log("How to compose with Clawd: skills/reelcut/references/clawd.md");
  return 0;
}

function beatsOf(file: string): { id: string; text: string }[] {
  const text = readFileSync(file, "utf8");
  const cues = file.toLowerCase().endsWith(".srt") ? parseSrt(text) : undefined;
  const { segments, lowConfidenceSegmentation } = parseScript(cues ? cues.map((c) => c.text).join(" ") : text);
  const seg = segmentBeats({ segments, ...(cues ? { srtCues: cues } : {}), fps: 60, lowConfidenceSegmentation });
  return mergeShortBeats(seg.timings, 60).timings.map((t) => ({ id: t.id, text: t.sourceText }));
}

function check(argv: string[]): number {
  const file = argv[0];
  if (!file || !existsSync(file)) { console.error("usage: clawd.ts check <script.txt|script.srt> [--json]"); return 2; }
  const text = readFileSync(file, "utf8"), topic = claudeTopic(text), mascot = defaultPersonality()?.mascot;
  const on = mascot ? mascot.character !== "none" && (mascot.when === "always" || (mascot.when === "claude" && topic.about)) : topic.about;
  const plan = on ? planClawd(beatsOf(file)) : [];
  if (argv.includes("--json")) { console.log(JSON.stringify({ about: topic.about, mentions: topic.mentions, clawd: on, plan }, null, 2)); return 0; }
  console.log(`${path.basename(file)}: ${topic.about ? `about Claude (${topic.mentions.join(", ")})` : "not about Claude"} — Clawd ${on ? "is in this reel" : "sits this reel out"}${mascot ? ` (personality: ${mascot.when})` : ""}.`);
  for (const b of plan) console.log(`  ${b.beat.padEnd(8)} ${b.role.padEnd(7)} ${b.acts.length ? b.acts.join(", ") : "—"}${b.poses.length ? `  · poses ${b.poses.slice(0, 2).join(", ")}` : ""}  — ${b.why}`);
  return 0;
}

function listPoses(argv: string[]): number {
  const tag = arg(argv, "--tag");
  const list = kitPoses().filter((p) => !tag || p.tags.includes(tag) || p.id.includes(tag));
  if (argv.includes("--json")) { console.log(JSON.stringify(list.map((p) => ({ id: p.id, tags: p.tags, expr: p.expr })), null, 2)); return 0; }
  for (const p of list) console.log(`  ${p.id.padEnd(34)} ${p.expr.padEnd(8)} ${p.tags.join(" ")}${p.minis.length ? `  (+${p.minis.length} minis)` : ""}`);
  console.log(`${list.length} pose(s). Play one with RC.clawd.pose(tl, c, at, "<id>").`);
  return 0;
}

function listMoves(argv: string[]): number {
  if (argv.includes("--json")) { console.log(JSON.stringify(MOVES.map((m) => ({ id: m.id, name: m.name, tags: m.tags, seconds: m.seconds })), null, 2)); return 0; }
  for (const m of MOVES) console.log(`  ${m.id.padEnd(13)} ${m.seconds.toFixed(1)}s  ${m.name}  — ${m.tags.join(" ")}`);
  return 0;
}

function importPack(argv: string[]): number {
  const dir = argv[0] ?? path.join(REPO, "skills", "reelcut", "assets", "clawd-pack");
  if (!existsSync(dir)) { console.error("usage: clawd.ts import [folder of pack SVGs] (default: skills/reelcut/assets/clawd-pack)"); return 2; }
  const { poses: list, skipped } = convertPack(dir);
  writeFileSync(PACK_FILE, packModule(list, path.relative(REPO, path.resolve(dir)) || dir));
  console.log(`${list.length} poses → ${path.relative(REPO, PACK_FILE)}${skipped.length ? `; skipped (no Clawd body found): ${skipped.join(", ")}` : ""}`);
  return 0;
}

function sounds(): number {
  const dir = packDir(), list = buildClawdSounds(dir), total = addClawdSoundsToManifest(dir, list);
  console.log(`${list.length} Clawd sounds in ${path.relative(REPO, dir)} (${total} in the pack)`);
  for (const s of list) console.log(`  ${s.id.padEnd(16)} ${s.durationSeconds.toFixed(2)}s  ${s.lufs} LUFS  ${s.category}`);
  return 0;
}

async function overlay(argv: string[]): Promise<number> {
  const what = argv[0];
  if (!what) { console.error("usage: clawd.ts overlay <move|pose:id|all> [--style s] [--look l] [--format mov|webm] [--size 1080] [--out dir]"); return 2; }
  const style = arg(argv, "--style"), look = arg(argv, "--look"), format = (arg(argv, "--format") ?? "mov") as "mov" | "webm";
  if (style && !STYLES.some((s) => s.id === style)) { console.error(`no style ${style} (${STYLES.map((s) => s.id).join(", ")})`); return 2; }
  const size = Number(arg(argv, "--size") ?? 1080), out = path.resolve(arg(argv, "--out") ?? path.join("out", "clawd-overlays"));
  const shots = what === "all" ? MOVES.map((m) => `move:${m.id}`) : [what.includes(":") ? what : `move:${what}`];
  const kit = loadKit("project");
  mkdirSync(out, { recursive: true });
  let failed = 0;
  for (const shot of shots) {
    const id = `clawd-${shot.replace(":", "-")}`.replace(/[^a-z0-9-]/g, "-");
    const { html, seconds } = shotComposition(id, { what: shot, ...(style ? { style } : {}), ...(look ? { look } : {}), width: size, height: size, transparent: true });
    const built = buildProject([{ id, durationSeconds: seconds, compositionHtml: html }], { width: size, height: size, fps: 60, ground: "transparent", kit });
    const dir = path.join(out, ".work", id);
    rmSync(dir, { recursive: true, force: true });
    for (const f of built.clips[id]!) { const t = path.join(dir, f.path); mkdirSync(path.dirname(t), { recursive: true }); writeFileSync(t, f.contents); }
    if (kit.fonts) for (const f of fontFilesFor(html, kit.fonts.lib)) { const t = path.join(dir, PROJECT_FONT_DIR, f); mkdirSync(path.dirname(t), { recursive: true }); copyFileSync(path.join(kit.fonts.lib.dir, f), t); }
    const file = path.join(out, `${id}${style ? `-${style}` : ""}.${format}`);
    process.stdout.write(`  ${shot} … `);
    const r = await renderHyperframesProject({ projectDir: dir, outputPath: file, skipCheck: true, format });
    if (r.status === "rendered") console.log(path.relative(process.cwd(), file));
    else { failed++; console.log(`failed: ${r.error}`); }
  }
  return failed ? 1 : 0;
}

function star(argv: string[], on: boolean): number {
  const id = argv[0];
  if (!id) { console.error(`usage: clawd.ts ${on ? "star" : "unstar"} <move:id|pose:id>`); return 2; }
  console.log(`Starred: ${setFavourite(id, on).join(", ") || "none"}`);
  return 0;
}

const [cmd, ...rest] = process.argv.slice(2);
const code = cmd === "brief" ? brief() : cmd === "check" ? check(rest) : cmd === "poses" ? listPoses(rest) : cmd === "moves" ? listMoves(rest)
  : cmd === "import" ? importPack(rest) : cmd === "sounds" ? sounds() : cmd === "overlay" ? await overlay(rest)
  : cmd === "star" ? star(rest, true) : cmd === "unstar" ? star(rest, false) : cmd === "stars" ? (console.log(loadClawdPrefs().favourites.join("\n") || "none"), 0)
  : (console.error("usage: clawd.ts brief | check <script> | poses [--tag t] | moves | import [dir] | sounds | overlay <what> [--style s] [--format mov|webm] | star <id> | unstar <id> | stars"), 2);
process.exitCode = code;
