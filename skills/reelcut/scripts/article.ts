import { writeFileSync } from "node:fs";
import path from "node:path";
import { articleMarkdown, readArticle } from "../../../src/create/article.js";

/**
 * A blog post or article as the page's own words, for writing a reel from it.
 *
 *   npm run article -- <url> [--out article.md]
 */
const argv = process.argv.slice(2);
const cwd = process.env.INIT_CWD ?? process.cwd();
const url = argv.find((a) => !a.startsWith("--"));
const outAt = argv.indexOf("--out");

async function main(): Promise<void> {
  if (!url) { console.error("usage: article.ts <url> [--out article.md]"); process.exit(2); }
  const a = await readArticle(url);
  const md = articleMarkdown(a);
  if (outAt >= 0 && argv[outAt + 1]) { const f = path.resolve(cwd, argv[outAt + 1]!); writeFileSync(f, md); console.log(`${a.title} · ${a.words} words → ${f}`); }
  else console.log(md);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
