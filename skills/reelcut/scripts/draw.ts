import path from "node:path";
import { keepDrawing, type SvgCheck } from "../../../src/create/draw.js";
import type { StyleId } from "../../../src/personality/styles.js";

/**
 * Keep an SVG Claude drew: check it (nothing that runs or fetches, a viewBox, the personality's colours) and add it to
 * the library as a drawn, generic image waiting for the owner's approval.
 *
 *   npm run draw -- out/drawn/rocket.svg --name "A paper rocket" [--tags rocket,launch] [--style paper-cutout] [--personality p_…] [--describe "…"]
 */
const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const file = argv.find((a) => a.endsWith(".svg"));
const name = flag("--name");
if (!file || !name) { console.error('usage: draw.ts <file.svg> --name "…" [--tags a,b] [--style <style>] [--personality <id>] [--describe "…"]'); process.exit(2); }
try {
  const r = keepDrawing(path.resolve(file), { name, tags: (flag("--tags") ?? "").split(",").filter(Boolean), style: flag("--style") as StyleId | undefined, personality: flag("--personality"), describe: flag("--describe") });
  console.log(`${r.existed ? "already in the library" : "kept"}: ${r.id} "${name}" (drawn, waiting for approval in Review)`);
  for (const w of r.check.warnings) console.log(`  warning: ${w}`);
} catch (error) {
  const check = (error as { check?: SvgCheck }).check;
  console.error(`draw: ${(error as Error).message}`);
  for (const w of check?.warnings ?? []) console.error(`  warning: ${w}`);
  process.exit(1);
}
