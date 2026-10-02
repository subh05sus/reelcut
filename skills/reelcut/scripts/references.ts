import { lstatSync } from "node:fs";
import path from "node:path";
import { scanDir } from "../../../src/library/folders.js";
import {
  acceptAnnotation,
  annotateReference,
  buildReferenceBrief,
  formatReferenceBrief,
  ingestReference,
  loadReferences,
  MOVES,
  referenceSheetPath,
  removeReference,
  studyQueue,
  TEXT_STYLES,
  updateReference,
  type Reference,
} from "../../../src/references/index.js";

/**
 * Reference videos: other people's motion graphics, kept to learn from.
 *
 *   npm run references -- add <file-or-folder>…            (measure and keep; nothing is ever used in a reel)
 *   npm run references -- list [--json]
 *   npm run references -- queue [--json]                   (references nobody has tagged: what Claude studies)
 *   npm run references -- annotate <id> --moves ui,kin,num [--text kinetic] [--note "…"]   (Claude's tags; unaccepted)
 *   npm run references -- accept <id> --reviewed           (a person keeping the tags as they are)
 *   npm run references -- include <id> | exclude <id>      (teach from it, or stop)
 *   npm run references -- remove <id>
 *   npm run references -- brief [--json]                   (the aggregate, for Step 0 and Step 1)
 *
 * Tags are the fixed words only (`moves`: see below; `--text`: kinetic, key-lines, minimal, none). Claude's
 * tags teach the studio nothing until a person accepts them in the studio's References tab (or `accept`).
 * A note is for the person and never becomes a rule.
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

function line(r: Reference): string {
  const x = r.analysis;
  const tags = r.annotation ? [...r.annotation.moves, r.annotation.textStyle].filter(Boolean).join(",") : "";
  const state = [r.include ? "" : "off", r.annotation ? (r.annotation.reviewed ? "tags accepted" : "tags unaccepted") : "untagged"].filter(Boolean).join(", ");
  return `${r.id}  ${r.name}\n${" ".repeat(18)}${x.pacing} (median shot ${x.medianShotSeconds}s, ${x.cutsPerMinute} cuts/min) · ${x.ground} ground · ${Math.round(x.durationSeconds)}s · ${state}${tags ? ` · ${tags}` : ""}`;
}

function find(id: string | undefined): Reference {
  const ref = loadReferences().references.find((r) => r.id === id);
  if (!ref) throw new Error(`no reference ${id ?? ""}: see \`references list\``);
  return ref;
}

async function add(argv: string[]): Promise<void> {
  const targets = argv.filter((a) => !a.startsWith("--"));
  if (targets.length === 0) throw new Error("usage: references add <file-or-folder>…");
  const files = targets.flatMap((t) => {
    const full = path.resolve(cwd, t);
    return lstatSync(full).isDirectory() ? scanDir(full).files.map((f) => ({ file: f.abs, name: path.basename(f.abs) })) : [{ file: full, name: path.basename(full) }];
  });
  const counts: Record<string, number> = {};
  for (const f of files) {
    const o = await ingestReference({ file: f.file, name: f.name, origin: "cli" });
    counts[o.state] = (counts[o.state] ?? 0) + 1;
    if (o.state === "failed" || o.state === "skipped") console.log(`  ${o.state}  ${f.name}  ${o.reason ?? ""}`);
  }
  console.log(`${files.length} file(s): ${counts.added ?? 0} added, ${counts.duplicate ?? 0} duplicate, ${counts.skipped ?? 0} skipped, ${counts.failed ?? 0} failed`);
  console.log("Tag them with `/reelcut study-references`, or in the studio's References tab.");
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "add":
      return add(rest);
    case "list": {
      const json = bool(rest, "--json");
      const refs = loadReferences().references;
      if (json) return console.log(JSON.stringify(refs, null, 2));
      console.log(`${refs.length} reference(s)`);
      for (const r of refs) console.log(line(r));
      return;
    }
    case "queue": {
      const json = bool(rest, "--json");
      const items = studyQueue(loadReferences().references);
      if (json) {
        console.log(JSON.stringify(items.map((r) => ({ id: r.id, name: r.name, sheet: referenceSheetPath(r), seconds: r.analysis.durationSeconds, pacing: r.analysis.pacing, ground: r.analysis.ground })), null, 2));
        return;
      }
      console.log(`${items.length} reference(s) waiting for Claude`);
      for (const r of items) console.log(`  ${r.id}  ${r.name}  sheet ${referenceSheetPath(r) ?? "(none)"}`);
      return;
    }
    case "annotate": {
      const moves = (flag(rest, "--moves") ?? "").split(",").map((m) => m.trim()).filter(Boolean);
      const text = flag(rest, "--text");
      const note = flag(rest, "--note");
      const id = rest.find((a) => !a.startsWith("--"));
      if (!id || (moves.length === 0 && !text)) throw new Error(`usage: references annotate <id> --moves ${MOVES.slice(0, 4).join(",")} [--text ${TEXT_STYLES.join("|")}] [--note "…"]\nmoves: ${MOVES.join(", ")}`);
      const ref = annotateReference(id, { moves, ...(text ? { textStyle: text } : {}), ...(note ? { note } : {}) }, "claude");
      console.log(line(ref));
      console.log("Suggested. It teaches the studio nothing until a person accepts the tags in the References tab.");
      return;
    }
    case "accept": {
      if (!bool(rest, "--reviewed")) throw new Error("This records that a PERSON looked at the tags and kept them. Claude never does this: it is the studio's References tab, or this command with --reviewed once the user has said they did.");
      console.log(line(acceptAnnotation(rest.find((a) => !a.startsWith("--")) ?? "")));
      return;
    }
    case "include":
    case "exclude":
      console.log(line(updateReference(find(rest[0]).id, { include: command === "include" })));
      return;
    case "remove":
      removeReference(find(rest[0]).id);
      console.log("removed, and what it taught with it");
      return;
    case "brief": {
      const json = bool(rest, "--json");
      const brief = buildReferenceBrief(loadReferences().references);
      console.log(json ? JSON.stringify(brief, null, 2) : formatReferenceBrief(brief));
      return;
    }
    default:
      console.error("usage: references add|list|queue|annotate|accept|include|exclude|remove|brief (see the header of scripts/references.ts)");
      process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
