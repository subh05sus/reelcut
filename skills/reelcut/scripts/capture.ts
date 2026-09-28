import path from "node:path";
import { capture } from "../../../src/capture/capture.js";
import { formatLegibility } from "../../../src/capture/legibility.js";
import { formatSecrets } from "../../../src/capture/secrets.js";

/**
 * Capture a product surface, with the gates that decide whether it is usable.
 *
 *   npm run capture -- <url> --selector "<css>" --target-width 0.8 \
 *     [--out assets/in/name.png] [--must-contain "text"] [--frame-width 1080] \
 *     [--viewport 1440x900] [--settle 600] [--keep-consent]
 *
 * Refuses rather than producing a file that looks fine, and says which of the four things went
 * wrong: it is illegible at the size it will be shown, it shows a consent wall or a sign-in, it
 * does not contain what it was supposed to, or it holds somebody's real data.
 *
 * Exits 1 on a refusal, so it can gate a step.
 */

interface Args {
  url: string;
  selector: string;
  out: string;
  targetWidth: number;
  frameWidth: number;
  mustContain: string[];
  viewport?: { width: number; height: number };
  settleMs: number;
  dismissConsent: boolean;
}

function parseArgs(argv: readonly string[]): Args | undefined {
  const cwd = process.env.INIT_CWD ?? process.cwd();
  let url: string | undefined;
  let selector: string | undefined;
  let out: string | undefined;
  let targetWidth = 0.8;
  let frameWidth = 1080;
  let settleMs = 600;
  let dismissConsent = true;
  let viewport: { width: number; height: number } | undefined;
  const mustContain: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--selector") selector = argv[++i];
    else if (arg === "--out") out = argv[++i];
    else if (arg === "--target-width") targetWidth = Number(argv[++i]);
    else if (arg === "--frame-width") frameWidth = Number(argv[++i]);
    else if (arg === "--must-contain") mustContain.push(argv[++i] ?? "");
    else if (arg === "--settle") settleMs = Number(argv[++i]);
    else if (arg === "--keep-consent") dismissConsent = false;
    else if (arg === "--viewport") {
      const [w, h] = (argv[++i] ?? "").split("x").map(Number);
      if (w && h) viewport = { width: w, height: h };
    } else if (!arg.startsWith("--")) url = arg;
  }

  if (!url || !selector) return undefined;
  const name = `${selector.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40) || "capture"}.png`;
  return {
    url,
    selector,
    out: path.resolve(cwd, out ?? path.join("assets", "in", name)),
    targetWidth,
    frameWidth,
    mustContain,
    ...(viewport ? { viewport } : {}),
    settleMs,
    dismissConsent,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error('usage: capture.ts <url> --selector "<css>" [--target-width 0.8] [--out path.png] [--must-contain "text"]');
    process.exitCode = 2;
    return;
  }

  const result = await capture({
    url: args.url,
    selector: args.selector,
    outputPath: args.out,
    targetWidthFraction: args.targetWidth,
    frameWidth: args.frameWidth,
    mustContain: args.mustContain,
    dismissConsent: args.dismissConsent,
    settleMs: args.settleMs,
    ...(args.viewport ? { viewport: args.viewport } : {}),
  });

  if (result.measurement) {
    const m = result.measurement;
    console.log(`${args.selector} — ${m.elementWidth}x${m.elementHeight}, ${m.textLength} chars, sizes ${m.fontSizes.map((f) => `${f.px}px×${f.chars}`).join(" ") || "none"}`);
  }
  if (result.legibility) console.log(formatLegibility(result.legibility));
  if (result.secrets && result.secrets.length > 0) console.log(formatSecrets(result.secrets));

  if (!result.ok) {
    console.error("");
    console.error(`REFUSED (${result.refusal}): ${result.detail}`);
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log(`wrote ${result.outputPath}`);
  console.log(`      ${result.outputPath}.json — provenance, for report.md`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
