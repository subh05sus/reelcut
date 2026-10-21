import path from "node:path";
import { cutPoints, writeMoment } from "../../../src/create/moments.js";
import { parseTime, WatchVideo } from "../../../src/watch/index.js";

/**
 * Moments of a long video, as reels: the real audio of each as its voiceover, what is said as its script.
 *
 *   npm run moments -- cut <video> --from 12:30 --to 13:15 --out <dir> --name moment-1 [--lang de] [--model small]
 *
 * The cut snaps to word edges from the local whisper transcript (made once and cached by `npm run watch`). It writes
 * <name>.m4a, <name>.txt and <name>.json; `npm run reelcut -- batch <dir>` pairs each script with its audio.
 */
const argv = process.argv.slice(2);
const cwd = process.env.INIT_CWD ?? process.cwd();
const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

async function main(): Promise<void> {
  if (argv[0] !== "cut" || !argv[1]) { console.error("usage: moments.ts cut <video> --from <t> --to <t> --out <dir> --name <name> [--lang de]"); process.exit(2); }
  const v = new WatchVideo(path.resolve(cwd, argv[1]));
  const from = parseTime(flag("--from"), v.duration), to = parseTime(flag("--to"), v.duration);
  if (from === undefined || to === undefined || to <= from) throw new Error("give --from and --to, the end after the start");
  if (to - from > 180) throw new Error("a moment is at most 3 minutes; reels are short");
  const tr = await v.transcript({ required: true, ...(flag("--lang") ? { lang: flag("--lang")! } : {}), ...(flag("--model") ? { model: flag("--model")! } : {}) });
  const cut = cutPoints(tr!, from, to);
  const out = writeMoment(v.path, cut, path.resolve(cwd, flag("--out") ?? "moments"), flag("--name") ?? `moment-${Math.round(cut.from)}`);
  console.log(`moment ${cut.from.toFixed(2)}–${cut.to.toFixed(2)} s (${cut.seconds} s, ${cut.words} words)\n  audio  ${out.audio}\n  script ${out.script}\n\n${cut.script}`);
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
