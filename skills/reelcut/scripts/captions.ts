import path from "node:path";
import { burnCaptions, writeCaptions, type CaptionStyle } from "../../../src/create/captions.js";

/**
 * Captions for a finished reel.
 *
 *   npm run captions -- out/reel.json                    captions.srt, .vtt and .json beside reel.json
 *   npm run captions -- out/reel.json --burn [--style karaoke|key-words|full]
 *                                                        and master.captioned.mp4 (voiced reels)
 */
const argv = process.argv.slice(2);
const reel = argv.find((a) => a.endsWith(".json"));
if (!reel) { console.error("usage: captions.ts <reel.json> [--burn] [--style karaoke|key-words|full]"); process.exit(2); }
const style = (argv[argv.indexOf("--style") + 1] ?? "key-words") as CaptionStyle;
const files = writeCaptions(path.resolve(reel));
console.log(`captions: ${files.lines} lines from the ${files.source === "voice" ? "voiceover" : "text on screen"} → ${path.basename(files.srt)}, ${path.basename(files.vtt)}`);
if (argv.includes("--burn")) {
  try { console.log(`burned in → ${await burnCaptions(path.resolve(reel), ["karaoke", "key-words", "full"].includes(style) ? style : "key-words", (s) => console.log(`  ${s}`))}`); }
  catch (error) { console.error(`captions: ${(error as Error).message}`); process.exit(1); }
}
