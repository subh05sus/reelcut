import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { editPattern, loadPatterns, patternHtmlPath, patternThumbPath, rankPatterns, removePattern, savePatternFromBeat } from "../../../src/patterns/mine.js";
import { pairingIn } from "../../../src/fonts/index.js";

/**
 * Patterns to start a beat from: yours (beats you rated "Works" in the studio) first, best-rated first, then the
 * built-in ones.
 *
 *   npm run patterns -- list [--look paper] [--mine] [--json]
 *   npm run patterns -- show <id>                     the file to read and adapt, and the slots to replace
 *   npm run patterns -- save <reel.json> <beat>       keep a beat as your pattern without rating it
 *   npm run patterns -- rename <id> "name"
 *   npm run patterns -- tag <id> a,b,c
 *   npm run patterns -- remove <id>
 *
 * A beat that starts from a pattern says so in reel.json (`"pattern": "<id>"`), so the studio can learn which
 * patterns you keep, and your own patterns climb when beats made from them are rated "Works".
 */

const builtinDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "patterns");

function flag(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

function builtins(): { id: string; file: string; look?: string }[] {
  const out: { id: string; file: string; look?: string }[] = [];
  for (const dir of [builtinDir, path.join(builtinDir, "footage")]) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".html"))) {
      const file = path.join(dir, f);
      const look = /\bdata-look\s*=\s*["']([a-z]+)["']/.exec(readFileSync(file, "utf8"))?.[1];
      out.push({ id: f.replace(/\.html$/, ""), file, ...(look ? { look } : {}) });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function list(argv: string[]): void {
  const look = flag(argv, "--look");
  const mine = rankPatterns(loadPatterns()).filter((p) => !look || p.look === look);
  const theirs = argv.includes("--mine") ? [] : builtins().filter((b) => !look || b.look === look);
  if (argv.includes("--json")) {
    console.log(JSON.stringify({ mine: mine.map((p) => ({ ...p, file: patternHtmlPath(p.id), thumb: patternThumbPath(p.id) })), builtin: theirs }, null, 2));
    return;
  }
  console.log(`Yours (${mine.length}), best first`);
  if (!mine.length) console.log("  none yet: rate a beat \"Works\" in the studio and it is kept here");
  for (const p of mine) console.log(`  ${p.id}  ${p.name}\n${" ".repeat(16)}${[p.look, p.type && `type ${p.type}`, p.format, p.durationSeconds && `${p.durationSeconds.toFixed(1)} s`, `${p.likes} works / ${p.dislikes} not quite`, `${p.uses} use${p.uses === 1 ? "" : "s"}`, p.tags.length ? `#${p.tags.join(" #")}` : ""].filter(Boolean).join(" · ")}`);
  if (theirs.length) {
    console.log(`\nBuilt in (${theirs.length})`);
    console.log(theirs.map((b) => `  ${b.id}${b.look ? ` (${b.look})` : ""}`).join("\n"));
  }
}

function show(argv: string[]): void {
  const id = argv[0];
  const mine = loadPatterns().find((p) => p.id === id);
  if (mine) {
    console.log(`${mine.name}  (${mine.id})\nfile   ${patternHtmlPath(mine.id)}\nfrom   reel ${mine.from.run}, ${mine.from.beat}${mine.basedOn ? `, adapted from ${mine.basedOn}` : ""}\nslots  (replace these; keep the layout and motion)`);
    for (const s of mine.slots) console.log(`  ${s.kind.padEnd(7)} ${s.value}`);
    return;
  }
  const b = builtins().find((x) => x.id === id);
  if (!b) throw new Error(`no pattern ${id}: see \`npm run patterns -- list\``);
  console.log(`${b.id}\nfile   ${b.file}`);
}

function save(argv: string[]): void {
  const [manifestArg, beat] = argv;
  if (!manifestArg || !beat) throw new Error("usage: patterns save <reel.json> <beat>");
  const manifestPath = path.resolve(process.env.INIT_CWD ?? process.cwd(), manifestArg);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { format?: string; type?: string; beats: { id: string; composition: string; durationSeconds?: number; pattern?: string }[] };
  const mb = manifest.beats.find((b) => b.id === beat);
  if (!mb) throw new Error(`no beat ${beat} in ${manifestPath}`);
  const outDir = path.dirname(manifestPath);
  const html = readFileSync(path.resolve(outDir, mb.composition), "utf8");
  const look = /\bdata-look\s*=\s*["']([a-z]+)["']/i.exec(html)?.[1];
  const type = pairingIn(html)?.id ?? manifest.type;
  const p = savePatternFromBeat({ run: path.basename(outDir), outDir, beat, html, clip: path.join(outDir, "clips", `${beat}.mp4`), ...(look ? { look } : {}), ...(type ? { type } : {}), ...(mb.pattern ? { basedOn: mb.pattern } : {}), ...(manifest.format ? { format: manifest.format } : {}), ...(mb.durationSeconds ? { durationSeconds: mb.durationSeconds } : {}) });
  console.log(`kept as ${p.id}: ${p.name} (${p.slots.length} slots)`);
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "list":
      return list(rest);
    case "show":
      return show(rest);
    case "save":
      return save(rest);
    case "rename":
      if (!rest[0] || !rest[1]) throw new Error('usage: patterns rename <id> "name"');
      return void console.log(editPattern(rest[0], { name: rest[1] }).name);
    case "tag":
      if (!rest[0] || rest[1] === undefined) throw new Error("usage: patterns tag <id> a,b,c");
      return void console.log(editPattern(rest[0], { tags: rest[1].split(",") }).tags.join(", "));
    case "remove":
      if (!rest[0]) throw new Error("usage: patterns remove <id>");
      removePattern(rest[0]);
      return void console.log(`removed ${rest[0]}`);
    default:
      console.error("usage: patterns list|show|save|rename|tag|remove (see the header of scripts/patterns.ts)");
      process.exitCode = 2;
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
