import {
  audio, budget, cacheList, clip, doctor, fetchVideos, forget, frames, motion, note, notes, observe, ocr, overview, scenes, search, transcript, zoom,
  DEPTHS, WatchError, writeReport, type Depth,
} from "../../../src/watch/index.js";

/**
 * Watch a video the way a person does: a map first, then looks wherever Claude decides (any fps, zoomed, read,
 * listened to), within a frame budget. See references/watch.md for the loop.
 *
 *   npm run watch -- overview <video|url> [<video2> …] [--question "…"] [--depth quick|normal|deep] [--beats reel.json] [--no-transcript] [--no-storyboard]
 *   npm run watch -- search <video> "term" ["term2" …] [--no-ocr]
 *   npm run watch -- frames <video> --from 1:44 --to 1:56 [--count 9 | --fps 10] [--at t1,t2] [--single] [--why "…"] [--over]
 *   npm run watch -- zoom <video> --at 1:49 [--region top-right | x,y,w,h] [--why "…"]
 *   npm run watch -- ocr <video> --at 1:49 | --from A --to B [--fps 1] [--changes] [--region …]
 *   npm run watch -- transcript <video> [--from A --to B] [--words] [--srt] [--model small|medium] [--lang auto|de|en]
 *   npm run watch -- audio|motion|scenes <video> [--from A --to B]
 *   npm run watch -- note <video> "text" [--at t]      npm run watch -- notes <video> [--clear]
 *   npm run watch -- observe <video> "what the last look showed" [--at t]
 *   npm run watch -- clip <video> --from A --to B [--gif] [--out file]
 *   npm run watch -- report <video> [<video2> …] [--answer answer.md] [--out page.html]
 *   npm run watch -- budget <video> [--depth deep]     npm run watch -- forget <video>
 *   npm run watch -- fetch <url>     npm run watch -- doctor     npm run watch -- cache
 *
 * A video is a file, a URL (downloaded once with yt-dlp) or the id `overview` prints. Relative paths resolve against
 * the directory the command was typed in. Exit code 3 is a look refused for the budget.
 */

function flag(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  if (at < 0) return undefined;
  const value = argv[at + 1];
  argv.splice(at, 2);
  return value;
}
function bool(argv: string[], name: string): boolean {
  const at = argv.indexOf(name);
  if (at < 0) return false;
  argv.splice(at, 1);
  return true;
}
const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));
const cwd = process.env.INIT_CWD ?? process.cwd();
/** A path typed by a person is relative to where they typed it; a URL or a cached id stays as it is. */
const src = (s: string | undefined): string => {
  if (!s) throw new WatchError("give a video: a file, a URL, or an id from `overview`");
  return /^https?:\/\//.test(s) || /^[0-9a-f]{12}$/.test(s) || s.startsWith("/") || s.startsWith("~") ? s : `${cwd}/${s}`;
};
const depthOf = (v: string | undefined): Depth | undefined => {
  if (v === undefined) return undefined;
  if (!(v in DEPTHS)) throw new WatchError(`depth must be ${Object.keys(DEPTHS).join(", ")}`);
  return v as Depth;
};

async function main(): Promise<string> {
  const argv = process.argv.slice(2);
  const cmd = argv.shift();
  const look = () => ({
    from: flag(argv, "--from"), to: flag(argv, "--to"), at: flag(argv, "--at"), fps: num(flag(argv, "--fps")), count: num(flag(argv, "--count")),
    cell: num(flag(argv, "--cell")), cols: num(flag(argv, "--cols")), region: flag(argv, "--region"), why: flag(argv, "--why"),
    single: bool(argv, "--single"), over: bool(argv, "--over"), changes: bool(argv, "--changes"),
  });
  const range = () => ({ from: flag(argv, "--from"), to: flag(argv, "--to"), why: flag(argv, "--why") });
  switch (cmd) {
    case "overview": {
      const o = { question: flag(argv, "--question") ?? flag(argv, "-q"), depth: depthOf(flag(argv, "--depth")), model: flag(argv, "--model"), lang: flag(argv, "--lang"),
        rows: num(flag(argv, "--rows")), beats: flag(argv, "--beats"), noTranscript: bool(argv, "--no-transcript"), noStoryboard: bool(argv, "--no-storyboard") };
      if (o.beats && !o.beats.startsWith("/")) o.beats = `${cwd}/${o.beats}`;
      if (!argv.length) throw new WatchError("overview needs at least one video");
      return overview(argv.map(src), o);
    }
    case "frames": { const o = look(); return frames(src(argv[0]), o); }
    case "zoom": { const o = look(); return zoom(src(argv[0]), o); }
    case "ocr": { const o = look(); return ocr(src(argv[0]), o); }
    case "transcript": {
      const o = { ...range(), words: bool(argv, "--words"), srt: bool(argv, "--srt"), model: flag(argv, "--model"), lang: flag(argv, "--lang") };
      return transcript(src(argv[0]), o);
    }
    case "search": { const noOcr = bool(argv, "--no-ocr"), model = flag(argv, "--model"); const [v, ...q] = argv; if (!q.length) throw new WatchError("search needs at least one term"); return search(src(v), q, { noOcr, model }); }
    case "audio": { const o = range(); return audio(src(argv[0]), o); }
    case "motion": { const o = range(); return motion(src(argv[0]), o); }
    case "scenes": { const o = range(); return scenes(src(argv[0]), o); }
    case "note": { const at = flag(argv, "--at"); return note(src(argv[0]), argv.slice(1).join(" "), at); }
    case "notes": { const clear = bool(argv, "--clear"); return notes(src(argv[0]), clear); }
    case "observe": { const at = flag(argv, "--at"); return observe(src(argv[0]), argv.slice(1).join(" "), at); }
    case "clip": {
      const o = { from: flag(argv, "--from")!, to: flag(argv, "--to")!, gif: bool(argv, "--gif"), fps: num(flag(argv, "--fps")), width: num(flag(argv, "--width")), out: flag(argv, "--out") };
      if (o.from === undefined || o.to === undefined) throw new WatchError("clip needs --from and --to");
      return clip(src(argv[0]), o);
    }
    case "report": {
      const answer = flag(argv, "--answer"), out = flag(argv, "--out");
      return writeReport(argv.map(src), { answer: answer && !answer.startsWith("/") ? `${cwd}/${answer}` : answer, out });
    }
    case "budget": { const d = depthOf(flag(argv, "--depth")); return budget(src(argv[0]), d); }
    case "forget": return forget(src(argv[0]));
    case "fetch": return fetchVideos(argv);
    case "doctor": return doctor();
    case "cache": return cacheList();
    default:
      throw new WatchError("usage: npm run watch -- overview|search|frames|zoom|ocr|transcript|audio|motion|scenes|note|notes|observe|clip|report|budget|forget|fetch|doctor|cache …  (see references/watch.md)", 2);
  }
}

main().then((out) => { if (out) console.log(out); }).catch((error: unknown) => {
  if (error instanceof WatchError) { console.error(`watch: ${error.message}`); process.exitCode = error.code; return; }
  console.error(error);
  process.exitCode = 1;
});
