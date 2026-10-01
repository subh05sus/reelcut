import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildBrief, createRule, exportLearnings, formatBrief, importLearnings, loadLearnings, reinfer, updateRule } from "../../../src/learnings/index.js";

/**
 * What the studio has learned about your taste, for Claude to read before it composes.
 *
 *   npm run learnings -- brief [--script script.txt] [--brand Notiz] [--json]
 *   npm run learnings -- list [--status active|proposed|disabled|expired]
 *   npm run learnings -- accept <id> | disable <id>
 *   npm run learnings -- add "Never more than two accent colours." [--brand Notiz]
 *   npm run learnings -- export [file.json]
 *   npm run learnings -- import <file.json> [--replace]
 *
 * `brief` is what Step 0 and Step 4 read. It lists only rules that are on, in a short list, with the
 * ids to record in reel.json as `appliedLearnings`. Proposed rules are counted, never listed: they do
 * nothing until a person accepts them (in the studio, or with `accept`).
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

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "brief": {
      const scriptFile = flag(rest, "--script");
      const brand = flag(rest, "--brand");
      const json = bool(rest, "--json");
      const file = reinfer();
      const brief = buildBrief(file, {
        ...(brand ? { brands: [brand] } : {}),
        ...(scriptFile ? { scriptText: readFileSync(path.resolve(cwd, scriptFile), "utf8") } : {}),
      });
      console.log(json ? JSON.stringify(brief, null, 2) : formatBrief(brief));
      return;
    }
    case "list": {
      const status = flag(rest, "--status");
      const rules = reinfer().rules.filter((r) => !status || r.status === status);
      console.log(`${rules.length} rule(s)`);
      for (const r of rules) console.log(`${r.id}  ${r.status.padEnd(8)} ${r.scope === "global" ? "everywhere" : r.scope}  ${r.text}  (${r.origin}, ${r.confidence.toFixed(2)}${r.conflictWith.length ? ", CONFLICT" : ""}${r.pinned ? ", pinned" : ""})`);
      return;
    }
    case "accept":
    case "disable": {
      if (!rest[0]) throw new Error(`usage: learnings ${command} <id>`);
      const rule = updateRule(rest[0], { status: command === "accept" ? "active" : "disabled" });
      console.log(`${rule.id}  ${rule.status}  ${rule.text}`);
      return;
    }
    case "add": {
      const brand = flag(rest, "--brand");
      const text = rest.join(" ").trim();
      if (!text) throw new Error('usage: learnings add "your rule" [--brand Name]');
      const rule = createRule({ kind: "note", text, ...(brand ? { brand } : {}) });
      console.log(`${rule.id}  on  ${rule.text}`);
      return;
    }
    case "export": {
      const out = rest[0];
      const text = `${JSON.stringify(exportLearnings(), null, 2)}\n`;
      if (out) {
        writeFileSync(path.resolve(cwd, out), text);
        console.log(`wrote ${path.resolve(cwd, out)}`);
      } else process.stdout.write(text);
      return;
    }
    case "import": {
      const replace = bool(rest, "--replace");
      if (!rest[0]) throw new Error("usage: learnings import <file.json> [--replace]");
      const result = importLearnings(JSON.parse(readFileSync(path.resolve(cwd, rest[0]), "utf8")), replace ? "replace" : "merge");
      console.log(`${result.added} added, ${result.replaced} replaced, ${result.skipped} skipped. Inferred rules arrive as proposals.`);
      return;
    }
    case "signals":
      console.log(`${loadLearnings().signals.length} signals recorded`);
      return;
    default:
      console.error("usage: learnings brief|list|accept|disable|add|export|import");
      process.exitCode = 2;
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
