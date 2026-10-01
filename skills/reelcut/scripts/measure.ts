import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMoment, footageLegibility, loadIndex } from "../../../src/library/index.js";
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
 * A composition with recorded footage in it (`data-footage="<asset>:<moment>"`) also gets each recording's
 * box measured and its text checked against the same 11px floor as a capture, using the moment's saved focus
 * region for --format (default 1:1): a full-screen recording shrunk into a card is the thing that fails.
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

  const file = path.resolve(base, args.file);
  const source = readFileSync(file, "utf8");
  const placed = [...source.matchAll(/data-footage\s*=\s*["']([0-9a-f]{16}):(m_[0-9a-f]{8})["']/g)].map((m) => ({ assetId: m[1]!, momentId: m[2]! }));
  const select = placed.length > 0 && !args.select.includes(".rc-footage") ? [...args.select, ".rc-footage"] : args.select;

  const report = await measureComposition({
    file,
    times: args.times,
    kit,
    outDir: path.resolve(base, args.outDir),
    guides: args.guides,
    scan: args.scan,
    keepCamera: args.keepCamera,
    select,
    baselines: args.baselines,
    bearings: args.bearings,
    ...(args.name ? { name: args.name } : {}),
  });
  console.log(formatMeasureReport(report));
  if (report.samples.some((s) => s.findings.length > 0)) process.exitCode = 1;

  if (placed.length > 0) {
    const format = /--format\s+(\S+)/.exec(process.argv.join(" "))?.[1] ?? "1:1";
    const frameWidth = Number(/data-width\s*=\s*["'](\d+)["']/.exec(source)?.[1] ?? 1080);
    const boxes = report.samples[0]?.rects[".rc-footage"] ?? [];
    const assets = loadIndex().assets;
    console.log("\nfootage:");
    placed.forEach((p, i) => {
      const asset = assets.find((a) => a.id === p.assetId);
      const moment = asset ? findMoment(asset, p.momentId) : undefined;
      const box = boxes[i];
      if (!asset || !moment) return console.log(`  ${p.assetId}:${p.momentId}  not in the library`);
      if (!box) return console.log(`  "${moment.label}"  no .rc-footage box was found to measure`);
      const ratio = (asset.analysis.height ?? 9) / (asset.analysis.width ?? 16);
      const verdict = footageLegibility(asset, moment, { boxWidth: box.w, boxHeight: box.w * ratio, frameWidth, format });
      if (!verdict) return console.log(`  "${moment.label}"  the recording's size is not known: run \`npm run footage -- analyze ${asset.id}\``);
      const where = `${Math.round(box.w)}px wide at (${Math.round(box.x)}, ${Math.round(box.y)})`;
      if (verdict.bodyPx === undefined) return console.log(`  "${moment.label}"  ${where}  no text to read`);
      console.log(`  "${moment.label}"  ${where}  ${verdict.ok ? "legible" : "ILLEGIBLE"}: text of about ${verdict.bodyPx}px renders at ${verdict.renderedPx!.toFixed(1)}px${moment.focus[format] ? " (saved focus region counted)" : ""}`);
      if (!verdict.ok) {
        console.log(`    ${verdict.advice}`);
        console.log(`    Or zoom in on the part that matters: npm run footage -- moment set ${asset.id} ${moment.id} --focus ${format}=x,y,w,h, then RC.zoomTo(...)`);
        process.exitCode = 1;
      }
    });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 2;
});
