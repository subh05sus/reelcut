import { existsSync } from "node:fs";
import path from "node:path";
import { FOOTAGE_FORMATS, PLATFORMS } from "../../../src/library/schema.js";
import {
  acceptMoments,
  addMoment,
  blobPath,
  findMoment,
  findMoments,
  fitMoment,
  footageAgeDays,
  footageLegibility,
  footageOf,
  isFootage,
  loadIndex,
  momentSeconds,
  parseTime,
  clock,
  patchFootage,
  recordedAt,
  refreshFootageAnalysis,
  removeMoment,
  updateMoment,
  type Focus,
  type LibraryAsset,
  type Moment,
} from "../../../src/library/index.js";
import { frameSizeFor, isOutputFormat } from "../../../src/core/constants.js";

/**
 * Recorded footage: screen recordings and other video, marked into moments a script line can use.
 *
 *   npm run footage -- list [--json]
 *   npm run footage -- show <asset>
 *   npm run footage -- find "download Claude" [--platform mac] [--tags claude] [--json]
 *   npm run footage -- fit <asset>:<moment> --seconds 4.4 [--format 1:1] [--width 912]
 *   npm run footage -- moment add <asset> --label "download Claude" --in 2 --out 8.5 [--tags a,b] [--focus 1:1=x,y,w,h] [--note "..."]
 *   npm run footage -- moment set <asset> <moment> [--label ...] [--in ...] [--out ...] [--tags ...] [--focus ...] [--note ...]
 *   npm run footage -- moment confirm|remove <asset> <moment>
 *   npm run footage -- meta <asset> [--app Claude] [--platform mac] [--recorded 2026-09-30] [--muted true|false] [--text-px 26]
 *   npm run footage -- check <asset> --watched [--undo]       (a person watched all of it for private information)
 *   npm run footage -- propose <asset> --label "..." --in 2 --out 8.5 [--tags a,b]     (Claude; never confirms)
 *   npm run footage -- queue [--json]                          (recordings with nothing marked yet, and proposals waiting)
 *   npm run footage -- accept <asset>:<moment>                 (a person said yes to using it)
 *   npm run footage -- analyze <asset>                         (measure a video that came in without it)
 *
 * Recordings come in the way every asset does: drop them on the studio, or `npm run library -- ingest`.
 * Nothing here changes a recording. A moment is a pair of times, and it has to be confirmed by a person
 * before a script line is matched to it.
 */

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

/** "1:1=0.04,0.36,0.6,0.36" */
function parseFocus(text: string): Record<string, Focus> {
  const m = /^([0-9]+:[0-9]+)=([\d.]+),([\d.]+),([\d.]+),([\d.]+)$/.exec(text.trim());
  if (!m || !(FOOTAGE_FORMATS as readonly string[]).includes(m[1]!)) throw new Error(`--focus must look like 1:1=x,y,w,h (fractions of the recording), with a format of ${FOOTAGE_FORMATS.join(", ")}`);
  return { [m[1]!]: { x: Number(m[2]), y: Number(m[3]), w: Number(m[4]), h: Number(m[5]) } };
}

function asset(id: string | undefined): LibraryAsset {
  if (!id) throw new Error("name a recording (its id, from `footage list`)");
  const found = loadIndex().assets.find((a) => a.id === id);
  if (!found) throw new Error(`no asset ${id}`);
  if (!isFootage(found)) throw new Error(`${id} is ${found.mediaType}, not a video${found.mediaType === "other" ? ` — run \`footage analyze ${id}\` first if it is one` : ""}`);
  return found;
}

function ref(text: string | undefined): { asset: LibraryAsset; moment: Moment } {
  const m = /^([0-9a-f]{16}):(m_[0-9a-f]{8})$/.exec(text ?? "");
  if (!m) throw new Error("name a moment as <asset>:<moment>, as `footage find` prints it");
  const a = asset(m[1]);
  const moment = findMoment(a, m[2]!);
  if (!moment) throw new Error(`no moment ${m[2]} on ${a.name}`);
  return { asset: a, moment };
}

function describe(a: LibraryAsset): string {
  const f = footageOf(a);
  const age = footageAgeDays(a, new Date());
  const facts = [
    a.analysis.width ? `${a.analysis.width}x${a.analysis.height}` : undefined,
    a.analysis.durationSeconds ? clock(a.analysis.durationSeconds) : undefined,
    a.analysis.fps ? `${a.analysis.fps}fps${a.analysis.vfr ? " (variable)" : ""}` : undefined,
    f.platform,
    age === undefined ? "date unknown" : `${Math.floor(age)}d old`,
  ].filter(Boolean);
  const state = [`<${a.review.state}>`, f.privateChecked ? "checked for private info" : "NOT checked for private info", a.status !== "active" ? `[${a.status}]` : undefined].filter(Boolean);
  return `${a.id}  ${f.app ? `${f.app}: ` : ""}${a.name}\n${" ".repeat(18)}${facts.join(" · ")}\n${" ".repeat(18)}${state.join(" · ")}`;
}

function momentLine(a: LibraryAsset, m: Moment): string {
  const flags = [m.state === "proposed" ? "PROPOSED by Claude, unconfirmed" : undefined, m.acceptedAt ? "used before" : undefined, Object.keys(m.focus).length ? `focus ${Object.keys(m.focus).join(",")}` : undefined].filter(Boolean);
  return `    ${a.id}:${m.id}  ${clock(m.in)}–${clock(m.out)} (${momentSeconds(m).toFixed(1)}s)  ${m.label}${m.tags.length ? `  #${m.tags.join(" #")}` : ""}${flags.length ? `  [${flags.join("; ")}]` : ""}`;
}

function list(argv: string[]): void {
  const json = bool(argv, "--json");
  const videos = loadIndex().assets.filter((a) => isFootage(a) && a.status === "active" && a.review.state !== "rejected");
  if (json) {
    console.log(JSON.stringify(videos.map((a) => ({ id: a.id, name: a.name, review: a.review.state, privateChecked: Boolean(footageOf(a).privateChecked), recordedAt: recordedAt(a), analysis: a.analysis, footage: footageOf(a) })), null, 2));
    return;
  }
  console.log(`${videos.length} recording(s)`);
  for (const a of videos) {
    console.log(describe(a));
    const moments = footageOf(a).moments;
    if (moments.length === 0) console.log("    (no moments marked yet)");
    for (const m of moments) console.log(momentLine(a, m));
  }
}

function show(argv: string[]): void {
  const a = asset(argv[0]);
  console.log(describe(a));
  if (a.analysis.filmstrip) console.log(`${" ".repeat(18)}filmstrip: ${path.join(path.dirname(path.dirname(blobPath(a))), a.analysis.filmstrip)}`);
  for (const m of footageOf(a).moments) console.log(momentLine(a, m));
}

function find(argv: string[]): void {
  const json = bool(argv, "--json");
  const platform = flag(argv, "--platform");
  const tags = tagList(flag(argv, "--tags"));
  const phrase = argv.filter((a) => !a.startsWith("--")).join(" ");
  if (!phrase) throw new Error('usage: footage find "download Claude" [--platform mac] [--tags a,b] [--json]');
  if (platform && !(PLATFORMS as readonly string[]).includes(platform)) throw new Error(`--platform ${PLATFORMS.join("|")}`);
  const matches = findMoments(loadIndex().assets, phrase, { tags, ...(platform ? { platform: platform as (typeof PLATFORMS)[number] } : {}) });
  if (json) {
    console.log(JSON.stringify(matches.map((m) => ({ ref: `${m.asset.id}:${m.moment.id}`, label: m.moment.label, seconds: momentSeconds(m.moment), confidence: m.confidence, decision: m.decision, why: m.why, recordedAt: recordedAt(m.asset) })), null, 2));
    return;
  }
  if (matches.length === 0) {
    console.log(`No moment in the library answers "${phrase}".`);
    console.log("Ways out: record the step (Shift-Cmd-5 on a Mac) and mark it in the studio's Footage tab; use another recording; or compose the beat as an animation, as a stand-in.");
    return;
  }
  for (const m of matches) {
    console.log(`${m.decision === "auto" ? "ok  " : "?   "}${m.asset.id}:${m.moment.id}  ${m.moment.label} (${momentSeconds(m.moment).toFixed(1)}s) — ${m.asset.name}`);
    console.log(`      ${m.why}`);
  }
  console.log('\nPlace one in a composition as <div class="rc-footage" data-footage="<asset>:<moment>">; the render does the rest.');
}

function fit(argv: string[]): void {
  const seconds = Number(flag(argv, "--seconds"));
  const format = flag(argv, "--format") ?? "1:1";
  const widthFlag = flag(argv, "--width");
  const target = ref(argv.find((a) => !a.startsWith("--")));
  if (!(seconds > 0)) throw new Error("usage: footage fit <asset>:<moment> --seconds 4.4 [--format 1:1] [--width 912]");
  if (!isOutputFormat(format)) throw new Error(`unknown format ${format}`);
  const f = fitMoment(target.moment, seconds);
  console.log(`"${target.moment.label}" is ${momentSeconds(target.moment).toFixed(1)}s in a ${seconds}s slot.`);
  if (f.ok) console.log(`  fits: ${f.rate === 1 ? "plays at normal speed" : `plays at ${f.rate}x`}${f.holdSeconds > 0 ? `, then holds the last frame for ${f.holdSeconds.toFixed(1)}s` : ""}`);
  else console.log(`  DOES NOT FIT. Ways out:\n    - ${f.options.join("\n    - ")}`);
  for (const n of f.notes) console.log(`  note: ${n}`);

  const { width: frameWidth } = frameSizeFor(format);
  const boxWidth = widthFlag ? Number(widthFlag) : frameWidth - 168;
  const ratio = (target.asset.analysis.height ?? 9) / (target.asset.analysis.width ?? 16);
  const verdict = footageLegibility(target.asset, target.moment, { boxWidth, boxHeight: boxWidth * ratio, frameWidth, format });
  if (!verdict) console.log("  legibility: the recording's size is not known — run `footage analyze` first");
  else if (verdict.bodyPx === undefined) console.log("  legibility: no text to read");
  else console.log(`  legibility: ${verdict.ok ? "ok" : "ILLEGIBLE"} — text of about ${verdict.bodyPx}px renders at ${verdict.renderedPx!.toFixed(1)}px in a ${Math.round(boxWidth)}px-wide box${target.moment.focus[format] ? " (with the saved focus region)" : ""}${verdict.ok ? "" : `\n    ${verdict.advice}\n    Or save a focus region for ${format}: --focus ${format}=x,y,w,h`}`);
  if (!f.ok) process.exitCode = 1;
}

function moment(argv: string[]): void {
  const [action, ...rest] = argv;
  if (action === "add") {
    const label = flag(rest, "--label");
    const inAt = parseTime(flag(rest, "--in"), "--in");
    const outAt = parseTime(flag(rest, "--out"), "--out");
    const tags = tagList(flag(rest, "--tags"));
    const focusText = flag(rest, "--focus");
    const note = flag(rest, "--note");
    const a = asset(rest.find((x) => !x.startsWith("--")));
    if (!label) throw new Error('--label "what the viewer sees happen" is required');
    const { moment: m } = addMoment(a.id, { label, in: inAt, out: outAt, tags, ...(focusText ? { focus: parseFocus(focusText) } : {}), ...(note ? { note } : {}) });
    console.log(momentLine(a, m));
    return;
  }
  if (action === "set") {
    const label = flag(rest, "--label");
    const i = flag(rest, "--in");
    const o = flag(rest, "--out");
    const tags = flag(rest, "--tags");
    const focus = flag(rest, "--focus");
    const note = flag(rest, "--note");
    const [id, mid] = rest.filter((x) => !x.startsWith("--"));
    const a = asset(id);
    if (!mid) throw new Error("usage: footage moment set <asset> <moment> [--label ...] [--in ...] [--out ...] [--tags ...] [--focus ...] [--note ...]");
    const existing = findMoment(a, mid);
    const { moment: m } = updateMoment(a.id, mid, {
      ...(label !== undefined ? { label } : {}),
      ...(i !== undefined ? { in: parseTime(i, "--in") } : {}),
      ...(o !== undefined ? { out: parseTime(o, "--out") } : {}),
      ...(tags !== undefined ? { tags: tagList(tags) } : {}),
      ...(focus !== undefined ? { focus: { ...(existing?.focus ?? {}), ...parseFocus(focus) } } : {}),
      ...(note !== undefined ? { note } : {}),
    });
    console.log(momentLine(a, m));
    return;
  }
  if (action === "confirm") {
    const [id, mid] = rest;
    const a = asset(id);
    if (!mid) throw new Error("usage: footage moment confirm <asset> <moment>");
    console.log(momentLine(a, updateMoment(a.id, mid, { confirm: true }).moment));
    return;
  }
  if (action === "remove") {
    const [id, mid] = rest;
    const a = asset(id);
    if (!mid) throw new Error("usage: footage moment remove <asset> <moment>");
    removeMoment(a.id, mid);
    console.log(`removed ${mid}`);
    return;
  }
  throw new Error("usage: footage moment add|set|confirm|remove");
}

function meta(argv: string[]): void {
  const app = flag(argv, "--app");
  const platform = flag(argv, "--platform");
  const recorded = flag(argv, "--recorded");
  const muted = flag(argv, "--muted");
  const textPx = flag(argv, "--text-px");
  const a = asset(argv.find((x) => !x.startsWith("--")));
  if (platform !== undefined && !(PLATFORMS as readonly string[]).includes(platform)) throw new Error(`--platform ${PLATFORMS.join("|")}`);
  if (muted !== undefined && muted !== "true" && muted !== "false") throw new Error("--muted true|false");
  const updated = patchFootage(a.id, {
    ...(app !== undefined ? { app } : {}),
    ...(platform !== undefined ? { platform: platform as (typeof PLATFORMS)[number] } : {}),
    ...(recorded !== undefined ? { recordedAt: recorded } : {}),
    ...(muted !== undefined ? { muted: muted === "true" } : {}),
    ...(textPx !== undefined ? { textPx: Number(textPx) } : {}),
  });
  console.log(describe(updated));
}

function check(argv: string[]): void {
  const watched = bool(argv, "--watched");
  const undo = bool(argv, "--undo");
  const a = asset(argv.find((x) => !x.startsWith("--")));
  if (!undo && !watched) {
    throw new Error(
      "This records that a PERSON watched the whole recording for private information (emails, notifications, other windows, the menu bar). " +
        "Claude never does this for them: it is the studio's Footage tab, or this command with --watched once the user has said they did.",
    );
  }
  console.log(describe(patchFootage(a.id, { privateChecked: !undo })));
}

function propose(argv: string[]): void {
  const label = flag(argv, "--label");
  const inAt = parseTime(flag(argv, "--in"), "--in");
  const outAt = parseTime(flag(argv, "--out"), "--out");
  const tags = tagList(flag(argv, "--tags"));
  const a = asset(argv.find((x) => !x.startsWith("--")));
  if (!label) throw new Error('--label "what the viewer sees happen" is required');
  const { moment: m } = addMoment(a.id, { label, in: inAt, out: outAt, tags }, "claude");
  console.log(momentLine(a, m));
  console.log("Proposed. It cannot be matched to a script line until a person confirms it in the studio's Footage tab.");
}

function queue(argv: string[]): void {
  const json = bool(argv, "--json");
  const strip = (a: LibraryAsset): string | undefined => (a.analysis.filmstrip ? path.join(path.dirname(path.dirname(blobPath(a))), a.analysis.filmstrip) : undefined);
  const waiting = loadIndex().assets.filter((a) => isFootage(a) && a.status === "active" && a.review.state !== "rejected" && !a.private);
  const bare = waiting.filter((a) => footageOf(a).moments.length === 0);
  const proposed = waiting.flatMap((a) => footageOf(a).moments.filter((m) => m.state === "proposed").map((m) => ({ a, m })));
  if (json) {
    console.log(JSON.stringify({ unmarked: bare.map((a) => ({ id: a.id, name: a.name, seconds: a.analysis.durationSeconds, filmstrip: strip(a), file: blobPath(a), tags: a.tags })), proposed: proposed.map(({ a, m }) => ({ ref: `${a.id}:${m.id}`, label: m.label })) }, null, 2));
    return;
  }
  console.log(`${bare.length} recording(s) with nothing marked; ${proposed.length} proposed moment(s) waiting for a person`);
  for (const a of bare) console.log(`  ${a.id}  ${a.name}  ${a.analysis.durationSeconds ? clock(a.analysis.durationSeconds) : ""}${strip(a) && existsSync(strip(a)!) ? `  filmstrip ${strip(a)}` : "  (no filmstrip: run `footage analyze`)"}`);
}

function accept(argv: string[]): void {
  const target = ref(argv[0]);
  acceptMoments([{ assetId: target.asset.id, momentId: target.moment.id }]);
  console.log(`accepted ${target.moment.label}`);
}

async function analyze(argv: string[]): Promise<void> {
  const id = argv.find((x) => !x.startsWith("--"));
  if (!id) throw new Error("usage: footage analyze <asset>");
  const a = await refreshFootageAnalysis(id);
  console.log(describe(a));
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "list":
      return list(rest);
    case "show":
      return show(rest);
    case "find":
      return find(rest);
    case "fit":
      return fit(rest);
    case "moment":
      return moment(rest);
    case "meta":
      return meta(rest);
    case "check":
      return check(rest);
    case "propose":
      return propose(rest);
    case "queue":
      return queue(rest);
    case "accept":
      return accept(rest);
    case "analyze":
      return analyze(rest);
    default:
      console.error("usage: footage list|show|find|fit|moment|meta|check|propose|queue|accept|analyze (see the header of scripts/footage.ts)");
      process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
