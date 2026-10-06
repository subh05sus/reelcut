import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMoment, footageLegibility, loadIndex } from "../../../src/library/index.js";
import { formatMeasureReport, launchMeasureBrowser, measureComposition, parseMeasureArgs, reelTimes } from "../../../src/verify/measure.js";
import type { Kit } from "../../../src/render/project.js";
import { stackSheets } from "../../../src/render/assemble.js";

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
 *
 *   npm run measure -- --all out/reel.json [--out out/measure]
 *
 * measures every beat of a reel in ONE Chrome session — the entrance, the middle and the settled end, with
 * the guides and the scan on — and writes one sheet (`<out>/reel-sheet.jpg`, a row per beat) and one list of
 * findings. One pass over the whole reel instead of a browser launch per beat per round.
 */
async function measureAll(manifestPath: string, outDir: string, kit: Kit): Promise<void> {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { beats: { id: string; durationSeconds: number; composition: string }[] };
  const base = path.dirname(manifestPath);
  const browser = await launchMeasureBrowser();
  const rows: string[] = [];
  let findings = 0;
  try {
    for (const beat of manifest.beats) {
      const file = path.resolve(base, beat.composition);
      if (!existsSync(file)) {
        console.log(`${beat.id}  composition not found at ${file}`);
        findings += 1;
        continue;
      }
      const times = reelTimes(beat.durationSeconds);
      const report = await measureComposition({ file, times, kit, outDir, guides: true, scan: true, keepCamera: true, browser, name: beat.id });
      const found = report.samples.flatMap((s) => s.findings.map((f) => `  t=${s.at}  ${f.kind}  ${f.el}  "${f.text}"  ${f.detail}`));
      findings += found.length;
      console.log(found.length ? `${beat.id}  ${found.length} to look at\n${found.join("\n")}` : `${beat.id}  clean`);
      const row = path.join(outDir, `${beat.id}-row.jpg`);
      execFileSync("ffmpeg", ["-v", "error", "-y", ...report.samples.flatMap((s) => ["-i", s.screenshot]), "-filter_complex", `${report.samples.map((_, i) => `[${i}:v]scale=360:-2[s${i}]`).join(";")};${report.samples.map((_, i) => `[s${i}]`).join("")}hstack=inputs=${report.samples.length}`, "-q:v", "3", row]);
      rows.push(row);
    }
  } finally {
    await browser.close();
  }
  const sheet = stackSheets(rows, path.join(outDir, "reel-sheet.jpg"));
  console.log("");
  console.log(`${manifest.beats.length} beats measured, ${findings} finding(s).${sheet ? ` Sheet: ${sheet} (a row per beat: entrance, middle, settled end; guides on)` : ""}`);
  if (findings > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  const raw = process.argv.slice(2);
  if (raw[0] === "--all") {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const kitDir = path.resolve(here, "..", "assets", "kit");
    const kit = { css: readFileSync(path.join(kitDir, "kit.css"), "utf8"), js: readFileSync(path.join(kitDir, "kit.js"), "utf8") };
    const base = process.env.INIT_CWD ?? process.cwd();
    if (!raw[1]) throw new Error("usage: measure.ts --all <reel.json> [--out dir]");
    const outAt = raw.indexOf("--out");
    const manifest = path.resolve(base, raw[1]);
    await measureAll(manifest, path.resolve(base, outAt >= 0 && raw[outAt + 1] ? raw[outAt + 1]! : path.join(path.dirname(manifest), "measure")), kit);
    return;
  }
  const args = parseMeasureArgs(raw);
  if (!args) {
    console.error('usage: measure.ts --all <reel.json> [--out dir]  |  measure.ts <composition.html> <t1,t2,…> [--guides] [--scan] [--no-camera] [--select "a||b"] [--baselines "a"] [--bearings "a"] [--out dir] [--name stem]');
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
