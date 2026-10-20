import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultPersonality, getPersonality } from "../../../src/personality/store.js";
import { PREVIEW_SECONDS, techniquePreviewComposition } from "../../../src/taxonomy/preview.js";
import { previewDirFor, previewLook, previewStatus, sketchDir, sketchKey, stampFor } from "../../../src/taxonomy/previews.js";
import {
  DOMAINS, OPERATIONS, TECHNIQUES, TIMINGS, TaxonomyError, acceptPatternTags, checkPath, formatPath, loadTaxonomy, patternOverrides, patternTags, patternsFor,
  pinTechnique, scoreTechniques, setAssetTags, setPatternTags, suggest, techniqueById, techniqueBeats,
} from "../../../src/taxonomy/index.js";
import { catalogJson, examplesFor, ideasFor } from "../../../src/taxonomy/examples.js";
import type { BeatKind } from "../../../src/personality/styles.js";

/**
 * The techniques catalog: Operation → Domain → Technique → Timing → Execution (see references/techniques.md).
 *
 *   npm run techniques -- list [--operation differentiate] [--domain semantic] [--json]
 *   npm run techniques -- show <technique>                    (definition, patterns, your beats, tagged assets)
 *   npm run techniques -- suggest "<line>" [--kind hook] [-n 5] [--near t1,t2] [--json]
 *   npm run techniques -- plan <reel.json>                    (each beat's path checked, or the best suggestion)
 *   npm run techniques -- check <operation/domain/technique[/timing]>
 *   npm run techniques -- ideas "<brief>" [--json]            (brief → operations → techniques → examples)
 *   npm run techniques -- patterns <technique> | of <pattern>
 *   npm run techniques -- tag pattern <id> <t1,t2> | tag asset <id> <t1,t2> [--by claude]
 *   npm run techniques -- accept [<pattern> | --all]          (the owner accepts Claude's pattern tags)
 *   npm run techniques -- pin <path> [--chat <conversation>] [--note "…"]
 *   npm run techniques -- scores                              (uses and ratings per technique)
 *   npm run techniques -- catalog --json                      (everything, for the studio)
 *   npm run techniques -- previews [--only a,b] [--personality <id>] [--missing] [--quality draft|looks]
 *       Render a 3.4 s preview clip per technique, its sample line in the (default) personality's look, into
 *       ~/.reelcut/technique-previews/<personality>/ (the studio's Techniques page and beat chips play them).
 *   npm run techniques -- sketch "<line>" --only a,b,c [--quality draft|looks]
 *       The same, with your own line in place of each technique's sample (Try a line): saved in
 *       ~/.reelcut/technique-previews/sketches/<key>/, and the key printed as "SKETCH <key>".
 *
 * Suggestions are ranked by the line's words and beat kind, the default personality's favoured and banned
 * techniques, and how the techniques were rated in your reels.
 */

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
const list = (v?: string) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const cwd = process.env.INIT_CWD ?? process.cwd();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Render technique clips through the normal render (so the kit, styles and checks are the reels' own). */
function renderClips(ids: string[], dir: string, p: ReturnType<typeof defaultPersonality>, quality: string, text?: string): number {
  const { style, options } = previewLook(p);
  const work = path.join(dir, ".work");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(path.join(work, "src"), { recursive: true });
  const beats = ids.map((id) => {
    const cid = `tq-${id}`, file = path.join(work, "src", `${cid}.html`);
    writeFileSync(file, techniquePreviewComposition(id, style, { ...options, id: cid, ...(text ? { text } : {}) }));
    const t = techniqueById(id)!;
    return { id: cid, durationSeconds: PREVIEW_SECONDS, composition: file, technique: `${t.operations[0]}/${t.domain}/${t.id}/${t.timing}` };
  });
  writeFileSync(path.join(work, "reel.json"), `${JSON.stringify({ format: "1:1", fps: 60, beats }, null, 2)}\n`);
  console.log(`rendering ${ids.length} technique clip(s) in ${p ? `"${p.name}"` : "the plain look"} (${style.name}) into ${dir}`);
  const tsx = createRequire(import.meta.url).resolve("tsx/cli");
  const r = spawnSync(process.execPath, [tsx, path.join(REPO, "skills", "reelcut", "scripts", "render.ts"), path.join(work, "reel.json"), "--clips-only", "--no-record", "--quality", quality], { cwd: REPO, stdio: "inherit" });
  let ok = 0;
  for (const id of ids) {
    const clip = path.join(work, "clips", `tq-${id}.mp4`);
    if (!existsSync(clip)) { console.error(`  ${id}: not rendered`); continue; }
    copyFileSync(clip, path.join(dir, `${id}.mp4`));
    spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", "2.9", "-i", clip, "-frames:v", "1", "-q:v", "3", path.join(dir, `${id}.jpg`)]);
    ok++;
  }
  console.log(`${ok} of ${ids.length} saved.${r.status ? " (the render reported a problem; see above)" : ""}`);
  return ok;
}

function previews(argv: string[]): number {
  const pid = flag(argv, "--personality"), quality = flag(argv, "--quality") ?? "looks", only = list(flag(argv, "--only")), missing = bool(argv, "--missing");
  const p = pid ? getPersonality(pid) : defaultPersonality();
  if (pid && !p) { console.error(`no personality ${pid}`); return 1; }
  const dir = previewDirFor(p), status = previewStatus(p);
  const ids = TECHNIQUES.map((t) => t.id).filter((id) => (!only.length || only.includes(id)) && (!missing || status.stale || !status.have.includes(id)));
  if (!ids.length) { console.log("every technique preview is up to date"); return 0; }
  const ok = renderClips(ids, dir, p, quality);
  if (ok) writeFileSync(path.join(dir, "stamp.json"), `${JSON.stringify(stampFor(p))}\n`);
  return ok === ids.length ? 0 : 1;
}

/** The owner's line, drawn by a few techniques. */
function sketch(argv: string[]): number {
  const quality = flag(argv, "--quality") ?? "looks", only = list(flag(argv, "--only")).filter((id) => techniqueById(id)).slice(0, 4);
  const text = argv.join(" ").replace(/\s+/g, " ").trim().slice(0, 90);
  if (!text || !only.length) { console.error('usage: techniques sketch "<line>" --only a,b,c'); return 2; }
  const p = defaultPersonality(), key = sketchKey(text, only, p), dir = sketchDir(key);
  mkdirSync(dir, { recursive: true });
  const ok = renderClips(only, dir, p, quality, text);
  console.log(`SKETCH ${key}`);
  return ok === only.length ? 0 : 1;
}

function personalityInput() {
  const p = defaultPersonality();
  const scores = new Map([...scoreTechniques()].map(([k, v]) => [k, v.score]));
  return { favour: p?.techniques.favour ?? [], ban: p?.techniques.ban ?? [], scores };
}

function main(argv: string[]): number {
  const cmd = argv.shift();
  const json = bool(argv, "--json");
  const out = (v: unknown, text: () => string) => { console.log(json ? JSON.stringify(v, null, 2) : text()); return 0; };
  switch (cmd) {
    case "list": {
      const op = flag(argv, "--operation"), dom = flag(argv, "--domain");
      const ts = TECHNIQUES.filter((t) => (!op || t.operations.includes(op as never)) && (!dom || t.domain === dom));
      return out(ts, () => [
        `Operations: ${OPERATIONS.map((o) => o.id).join(" · ")}`, `Domains: ${DOMAINS.map((d) => d.id).join(" · ")}`, `Timings: ${TIMINGS.map((x) => x.id).join(" · ")}`, "",
        ...DOMAINS.flatMap((d) => { const inD = ts.filter((t) => t.domain === d.id); return inD.length ? [`${d.name}`, ...inD.map((t) => `  ${t.id.padEnd(22)} ${t.operations.join("/").padEnd(26)} ${t.timing.padEnd(7)} ${t.does}`)] : []; }),
      ].join("\n"));
    }
    case "show": {
      const t = techniqueById(argv[0] ?? "");
      if (!t) { console.error(`no technique ${argv[0] ?? ""}`); return 1; }
      const ex = examplesFor(t.id);
      return out({ ...t, examples: ex }, () => [
        `${t.name}  (${t.id})`, `  ${t.does}`, `  Use it for: ${t.when}`, `  Domain ${t.domain} · operations ${t.operations.join(", ")} · plays ${t.timing} · moves ${t.moves.join(", ") || "—"}`,
        `  Path: ${formatPath({ operation: t.operations[0]!, domain: t.domain, technique: t.id, timing: t.timing })}`,
        `  Patterns: ${ex.patterns.map((p) => p.id).join(", ") || "none yet"}`,
        `  Your beats: ${ex.beats.length ? ex.beats.slice(0, 8).map((b) => `${b.beat} (${b.rating === "up" ? "Works" : b.rating === "down" ? "rated down" : "unrated"}) in ${path.basename(b.outDir)}`).join(", ") : "none yet"}`,
        `  Library: ${ex.assets.map((a) => `${a.name} (${a.id})`).join(", ") || "nothing tagged"}`,
      ].join("\n"));
    }
    case "suggest": {
      const kind = flag(argv, "--kind") as BeatKind | undefined, n = Number(flag(argv, "-n") ?? 5), near = list(flag(argv, "--near"));
      const text = argv.join(" ");
      const s = suggest({ ...personalityInput(), text, ...(kind ? { kind } : {}), recent: near }, n);
      return out(s.map((x) => ({ path: formatPath(x.path), name: x.technique.name, score: x.score, why: x.why, patterns: patternsFor(x.technique.id, patternOverrides()).slice(0, 3) })), () =>
        s.length ? s.map((x, i) => `${i + 1}. ${formatPath(x.path).padEnd(52)} ${x.technique.name} — ${x.why.join("; ") || "a fit"}\n   ${x.technique.does}  Patterns: ${patternsFor(x.technique.id, patternOverrides()).slice(0, 3).join(", ") || "compose it"}`).join("\n") : "no suggestion: say more about what the beat must do");
    }
    case "plan": {
      const file = path.resolve(cwd, argv[0] ?? "reel.json");
      const reel = JSON.parse(readFileSync(file, "utf8")) as { beats?: { id: string; kind?: BeatKind; text?: string; technique?: string; techniqueWhy?: string }[] };
      const pin = personalityInput();
      const rows: string[] = [];
      let missing = 0, bad = 0;
      const used: string[] = [];
      for (const b of reel.beats ?? []) {
        if (b.technique) {
          const c = checkPath(b.technique);
          if (!c.ok) bad++;
          rows.push(`${b.id.padEnd(9)} ${b.technique.padEnd(52)} ${c.ok ? (c.warnings.length ? `⚠ ${c.warnings.join("; ")}` : "✓") : `✗ ${c.errors.join("; ")}`}${b.techniqueWhy ? `\n          why: ${b.techniqueWhy}` : "  (no techniqueWhy)"}`);
          if (c.path) used.push(c.path.technique);
        } else {
          missing++;
          const s = suggest({ ...pin, ...(b.kind ? { kind: b.kind } : {}), ...(b.text ? { text: b.text } : {}), recent: used.slice(-2) }, 2);
          rows.push(`${b.id.padEnd(9)} (no technique) suggest ${s.map((x) => formatPath(x.path)).join("  or  ") || "—"}`);
          if (s[0]) used.push(s[0].technique.id);
        }
      }
      const ops = new Set((reel.beats ?? []).map((b) => b.technique?.split("/")[0]).filter(Boolean));
      console.log([...rows, "", `${(reel.beats ?? []).length} beats · ${missing} without a technique · ${bad} invalid · ${ops.size} operation${ops.size === 1 ? "" : "s"} used`].join("\n"));
      return bad ? 1 : 0;
    }
    case "check": {
      const c = checkPath(argv[0] ?? "");
      console.log(c.ok ? `✓ ${formatPath(c.path!)}${c.warnings.length ? `\n⚠ ${c.warnings.join("\n⚠ ")}` : ""}` : `✗ ${c.errors.join("\n✗ ")}`);
      return c.ok ? 0 : 1;
    }
    case "ideas": {
      const ideas = ideasFor(argv.join(" "), personalityInput());
      return out(ideas, () => ideas.map((idea, i) => [
        `${i + 1}. ${OPERATIONS.find((o) => o.id === idea.operation)!.name} — ${idea.why}`,
        ...idea.suggestions.map((s) => `   • ${s.technique.name}  ${formatPath(s.path)}\n     ${s.technique.does}\n     examples: ${[...s.examples.patterns.slice(0, 2).map((p) => `pattern ${p.id}`), ...s.examples.beats.filter((b) => b.rating === "up").slice(0, 2).map((b) => `your ${b.beat} (Works)`), ...s.examples.assets.slice(0, 2).map((a) => a.name)].join(", ") || "none yet"}`),
      ].join("\n")).join("\n\n"));
    }
    case "patterns": {
      if (argv[0] === "of") {
        const t = patternTags(argv[1] ?? "");
        console.log(t ? `${argv[1]}: ${t.techniques.join(", ")} (${t.by}, ${t.state})` : `no tags for ${argv[1] ?? ""}`);
        return t ? 0 : 1;
      }
      console.log(patternsFor(argv[0] ?? "", patternOverrides()).join("\n") || "none");
      return 0;
    }
    case "tag": {
      const by = (flag(argv, "--by") === "claude" ? "claude" : "user") as "user" | "claude";
      const [what, id, ts] = argv;
      if (what === "pattern" && id) { const tag = setPatternTags(id, list(ts), by); console.log(`${id}: ${tag.techniques.join(", ")}`); return 0; }
      if (what === "asset" && id) { const tag = setAssetTags(id, list(ts), by); console.log(`${id}: ${tag.techniques.join(", ") || "untagged"}`); return 0; }
      console.error("usage: techniques tag pattern|asset <id> <t1,t2>");
      return 2;
    }
    case "accept": {
      const n = acceptPatternTags(argv[0] === "--all" ? undefined : argv[0]);
      console.log(`accepted ${n} pattern tag set${n === 1 ? "" : "s"}`);
      return 0;
    }
    case "pin": {
      const chat = flag(argv, "--chat"), note = flag(argv, "--note");
      pinTechnique(argv[0] ?? "", chat, note);
      console.log(`pinned ${argv[0]}${chat ? ` to ${chat}` : ""}`);
      return 0;
    }
    case "scores": {
      const sc = scoreTechniques(techniqueBeats());
      const rows = [...sc].sort((a, b) => b[1].score - a[1].score || b[1].uses - a[1].uses);
      return out(Object.fromEntries(rows), () => rows.length ? rows.map(([id, s]) => `${id.padEnd(22)} used ${s.uses} · Works ${s.up} · down ${s.down}`).join("\n") : "no rendered beat names a technique yet");
    }
    case "previews":
      return previews(argv);
    case "sketch":
      return sketch(argv);
    case "catalog":
      console.log(JSON.stringify(catalogJson(), null, json ? 2 : 0));
      return 0;
    case "store":
      console.log(JSON.stringify(loadTaxonomy(), null, 2));
      return 0;
    default:
      console.error("usage: npm run techniques -- list|show|suggest|plan|check|ideas|patterns|tag|accept|pin|scores|catalog (see the header of scripts/techniques.ts)");
      return 2;
  }
}

try { process.exitCode = main(process.argv.slice(2)); } catch (error) {
  if (error instanceof TaxonomyError) { console.error(`techniques: ${error.message}`); process.exitCode = 1; } else throw error;
}
