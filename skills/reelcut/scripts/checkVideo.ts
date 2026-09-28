import path from "node:path";
import { checkVideo, formatReport } from "../../../src/verify/checkVideo.js";

/**
 * Report on one or more rendered videos.
 *
 * Reports, never fixes — the same posture as `the auditPages script this pattern came from`. A script that
 * edits what it audits is a script whose output you cannot trust.
 *
 *   npx tsx scripts/checkVideo.ts <file.mp4> [more.mp4 ...] [--fps 2] [--edge 192]
 *   npm run check-video -- <file.mp4>
 *
 * Relative paths resolve against the directory the command was typed in, not this package.
 * npm exports the invoking directory as `INIT_CWD`; without it a relative path would resolve
 * against wherever the script lives rather than where it was typed.
 *
 * Exits non-zero if any file produced a finding, so it can gate a render in CI.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const files: string[] = [];
  let samplesPerSecond = 2;
  let longEdge = 192;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--fps") samplesPerSecond = Number(args[++i]);
    else if (arg === "--edge") longEdge = Number(args[++i]);
    else files.push(path.resolve(process.env.INIT_CWD ?? process.cwd(), arg));
  }

  if (files.length === 0) {
    console.error("usage: checkVideo.ts <file.mp4> [more.mp4 ...] [--fps 2] [--edge 192]");
    process.exitCode = 2;
    return;
  }

  let total = 0;
  for (const file of files) {
    const report = checkVideo(file, { samplesPerSecond, longEdge });
    total += report.findings.length;
    console.log(formatReport(report));
    console.log("");
  }

  console.log(`${total} finding${total === 1 ? "" : "s"} across ${files.length} file${files.length === 1 ? "" : "s"}`);
  if (total > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 2;
});
