import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatMeasureReport, measureComposition, parseMeasureArgs } from "../../../src/verify/measure.js";

/**
 * Measure a composition: layout rectangles, text baselines, optical side bearings, the grid drawn
 * over a screenshot, and a scan for anything outside the 84px safe area, overflowing, or too small.
 *
 *   npm run measure -- <composition.html> <t1,t2,…> [--guides] [--scan] [--no-camera]
 *                      [--select ".card||.row"] [--baselines ".price"] [--bearings ".rc-head .ln"]
 *                      [--out out/measure] [--name stem]
 *
 * Times are seconds into the beat. Rectangles are taken with the camera push switched off, so they
 * are the designed layout; the screenshot keeps the push unless you pass --no-camera. Lists take
 * `||` between selectors.
 *
 * Reports, never fixes. Pair it with `hyperframes check`: that says whether a beat is broken, this
 * says whether it is exact. See references/kit.md, "Layout discipline".
 */
async function main(): Promise<void> {
  const args = parseMeasureArgs(process.argv.slice(2));
  if (!args) {
    console.error('usage: measure.ts <composition.html> <t1,t2,…> [--guides] [--scan] [--no-camera] [--select "a||b"] [--baselines "a"] [--bearings "a"] [--out dir] [--name stem]');
    process.exitCode = 2;
    return;
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const kitDir = path.resolve(here, "..", "assets", "kit");
  const kit = { css: readFileSync(path.join(kitDir, "kit.css"), "utf8"), js: readFileSync(path.join(kitDir, "kit.js"), "utf8") };
  const base = process.env.INIT_CWD ?? process.cwd();

  const report = await measureComposition({
    file: path.resolve(base, args.file),
    times: args.times,
    kit,
    outDir: path.resolve(base, args.outDir),
    guides: args.guides,
    scan: args.scan,
    keepCamera: args.keepCamera,
    select: args.select,
    baselines: args.baselines,
    bearings: args.bearings,
    ...(args.name ? { name: args.name } : {}),
  });
  console.log(formatMeasureReport(report));
  if (report.samples.some((s) => s.findings.length > 0)) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 2;
});
