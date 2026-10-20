import path from "node:path";
import { AtlasError, buildAtlas, collectSources, readAtlas, withWork } from "../../../src/graph/atlas.js";

/**
 * Images for the graph engine (RC.graph): one atlas per graph, up to 500 images, each cropped to one cell.
 *
 *   npm run graph -- atlas [--tags claude,logo] [--assets <id>,<id>] [--reels 6] [--refs 4] [--pending] [--cell 96x120] [--limit 300] [files…] [--json]
 *   npm run graph -- show <sha>
 *
 * Prints the atlas path and the cells as RC.graph `image` objects, in order, to paste into the composition's data.
 * `--refs N` takes N frames from each reference film switched on in the studio: someone else's work, so a reel may
 * only use it with `"referenceThumbnails": true` in reel.json (asked in Step 0); the render refuses it otherwise and
 * lists every one for report.md.
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

function main(argv: string[]): number {
  const cmd = argv.shift();
  const json = bool(argv, "--json");
  if (cmd === "atlas") {
    const cellArg = flag(argv, "--cell") ?? "96x120";
    const [cw, ch] = cellArg.split("x").map(Number);
    if (!cw || !ch || cw > 400 || ch > 400) { console.error("--cell is WxH, e.g. 96x120 (at most 400 each)"); return 2; }
    const o = {
      tags: list(flag(argv, "--tags")), assets: list(flag(argv, "--assets")),
      reels: Number(flag(argv, "--reels") ?? 0) || undefined, references: Number(flag(argv, "--refs") ?? 0) || undefined,
      pending: bool(argv, "--pending"), limit: Number(flag(argv, "--limit") ?? 500), files: argv.map((f) => path.resolve(cwd, f)),
    };
    const meta = withWork((work) => buildAtlas(collectSources(o, work), [cw, ch]));
    const cells = meta.cells.map((c) => ({ atlas: meta.atlas, x: c.x, y: c.y, w: c.w, h: c.h, aw: meta.aw, ah: meta.ah }));
    if (json) { console.log(JSON.stringify({ ...meta, images: cells }, null, 2)); return 0; }
    const kinds = meta.cells.reduce<Record<string, number>>((a, c) => ({ ...a, [c.source.kind]: (a[c.source.kind] ?? 0) + 1 }), {});
    console.log(`atlas ${meta.atlas}  (${meta.cells.length} images: ${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(", ")}; ${meta.aw}×${meta.ah})`);
    if (meta.references) console.log(`  ${meta.references} reference-film frames: the reel needs "referenceThumbnails": true, and report.md lists them (the render prints the list)`);
    console.log("  In the composition:");
    console.log(`  const A = { atlas: "${meta.atlas}", aw: ${meta.aw}, ah: ${meta.ah}, w: ${meta.cell[0]}, h: ${meta.cell[1]}, cols: ${meta.cols} };`);
    console.log("  const img = (i) => ({ atlas: A.atlas, aw: A.aw, ah: A.ah, w: A.w, h: A.h, x: (i % A.cols) * A.w, y: Math.floor(i / A.cols) * A.h });   // node.image = img(i)");
    return 0;
  }
  if (cmd === "show") {
    const meta = readAtlas(argv[0] ?? "");
    if (!meta) { console.error(`no atlas ${argv[0] ?? ""}`); return 1; }
    console.log(JSON.stringify(meta, null, json ? 2 : 1));
    return 0;
  }
  console.error("usage: npm run graph -- atlas|show (see the header of scripts/graph.ts)");
  return 2;
}

try { process.exitCode = main(process.argv.slice(2)); } catch (error) {
  if (error instanceof AtlasError) { console.error(`graph: ${error.message}`); process.exitCode = 1; } else throw error;
}
