import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { FORMAT_LABELS, frameSizeFor, isOutputFormat, type OutputFormat } from "../core/constants.js";

/**
 * The same reel in other formats: 9:16 for Reels, 4:5 for the feed, 1:1 for everywhere else. A format is a new
 * layout, not a crop (type, safe zones and framing all move), so Claude lays each beat out again from the reel's own
 * compositions, in formats/<w>x<h>/ beside reel.json, and renders it there. The studio's master view switches
 * between the versions that exist.
 */

export const OTHER_FORMATS = ["9:16", "4:5", "1:1"] as const satisfies readonly OutputFormat[];
export const formatDir = (reelPath: string, f: OutputFormat) => { const { width, height } = frameSizeFor(f); return path.join(path.dirname(reelPath), "formats", `${width}x${height}`); };

export interface FormatVersion { format: OutputFormat; label: string; dir: string; reel: string; master?: string; poster?: string }
/** The reel's own format first, then each other version with a reel.json. */
export function formatVersions(reelPath: string): FormatVersion[] {
  const dir = path.dirname(reelPath);
  const own = (JSON.parse(readFileSync(reelPath, "utf8")) as { format?: string }).format ?? "1:1";
  const at = (f: string) => { try { return `${f}#${Math.round(statSync(f).mtimeMs)}`; } catch { return undefined; } };
  const one = (d: string, f: OutputFormat): FormatVersion => ({ format: f, label: FORMAT_LABELS[f], dir: d, reel: path.join(d, "reel.json"), ...(at(path.join(d, "master.mp4")) ? { master: at(path.join(d, "master.mp4")) } : {}), ...(at(path.join(d, "poster.jpg")) ? { poster: at(path.join(d, "poster.jpg")) } : {}) });
  const out: FormatVersion[] = isOutputFormat(own) ? [one(dir, own)] : [];
  const fd = path.join(dir, "formats");
  if (existsSync(fd)) for (const d of readdirSync(fd).sort()) {
    const r = path.join(fd, d, "reel.json");
    if (!existsSync(r)) continue;
    try { const f = (JSON.parse(readFileSync(r, "utf8")) as { format?: string }).format; if (isOutputFormat(f) && f !== own) out.push(one(path.join(fd, d), f)); } catch { /* being written */ }
  }
  return out;
}

/** The instruction Claude gets from "Make the other formats". */
export function formatsPrompt(reelPath: string, wanted: readonly string[]): { shown: string; prompt: string } {
  const own = (JSON.parse(readFileSync(reelPath, "utf8")) as { format?: string }).format ?? "1:1";
  const fs = wanted.filter((f): f is OutputFormat => isOutputFormat(f) && f !== own);
  if (!fs.length) throw new Error("choose a format the reel is not in already");
  return {
    shown: `Make it in ${fs.join(", ")}`,
    prompt: [
      `Make the reel at ${reelPath} (${own}) in ${fs.map((f) => `${f} (${FORMAT_LABELS[f]})`).join(" and ")} as well. The reel stays as it is; each format is its own copy:`,
      ...fs.map((f) => `- ${f}: ${formatDir(reelPath, f)}/ with its own reel.json ("format": "${f}", the same beats, lengths, sound and voiceover; relative paths to sounds, footage and assets point back up with ../../, library: references stay as they are) and compositions/ laid out again for ${frameSizeFor(f).width}×${frameSizeFor(f).height}.`),
      `Lay each beat out again, do not crop or letterbox: the same words, moves, colours and timing, with the type, framing and spacing refitted (\`npm run measure -- <beat.html> <t> --format <fmt>\` for each). ${fs.includes("9:16") ? "In 9:16 keep every line clear of Instagram's interface (top 12%, bottom 20%, the right edge below the middle). " : ""}Then render each copy: \`npm run render -- <its reel.json>\` (with --sfx if the reel has sound effects). Reply with one line per format.`,
    ].join("\n"),
  };
}
