import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { blobPath, loadIndex } from "../../../src/library/index.js";
import { voiceForReel, type VoiceoverSpec } from "../../../src/voice/reel.js";

/**
 * The voiceover sets the cut, before anything is composed.
 *
 *   npm run voice -- out/reel.json
 *
 * `reel.json` needs `"voiceover": { "file": "vo.wav", "language": "de" }` and each beat's `"text"` (the words
 * spoken while it is on screen). The recording is transcribed on this machine (whisper.cpp through `hyperframes
 * transcribe`, fetched once), matched to the text, and every beat's `durationSeconds` is rewritten from the read:
 * each cut sits in the pause before its first word. Writes `voice.json` (every word's time, the voice's loudness)
 * for the compositions (`RC.word`, `RC.voice`), `sfx suggest` and the render, which repeats this, cached.
 */

interface Manifest { voiceover?: VoiceoverSpec; beats: { id: string; durationSeconds: number; text?: string }[] }

async function main(): Promise<void> {
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const arg = process.argv[2];
  if (!arg) throw new Error("usage: voice <reel.json>");
  const file = path.resolve(cwd, arg);
  const base = path.dirname(file);
  const manifest = JSON.parse(readFileSync(file, "utf8")) as Manifest;
  const spec = manifest.voiceover;
  if (!spec) throw new Error(`${file} has no "voiceover": add { "file": "vo.wav", "language": "de" }`);
  const lib = /^library:([0-9a-f]{16})$/.exec(spec.file);
  const asset = lib ? loadIndex().assets.find((a) => a.id === lib[1]) : undefined;
  if (lib && !asset) throw new Error(`voiceover: ${spec.file} is not in the library`);
  const audio = asset ? blobPath(asset) : path.resolve(base, spec.file);
  if (!existsSync(audio)) throw new Error(`voiceover: no file at ${audio}`);

  const voice = await voiceForReel(spec, audio, manifest.beats, base);
  const timed = (spec.timing ?? "voice") === "voice";
  console.log(`${path.basename(audio)}: ${voice.analysis.durationSeconds.toFixed(2)}s, ${Math.round(voice.analysis.matched * 100)}% of the text heard\n`);
  for (const sp of voice.spans) {
    const words = voice.analysis.words.filter((w) => w.beat === sp.id);
    const before = manifest.beats.find((b) => b.id === sp.id)!.durationSeconds;
    const first = words[0];
    console.log(`  ${sp.id.padEnd(10)} ${sp.start.toFixed(2).padStart(6)}–${sp.end.toFixed(2).padEnd(6)} ${sp.durationSeconds.toFixed(2)}s${timed && Math.abs(before - sp.durationSeconds) > 0.01 ? ` (was ${before.toFixed(2)})` : ""}  first word "${first?.w ?? "?"}" at +${first ? (first.start - sp.start).toFixed(2) : "?"}s${words.some((w) => !w.heard) ? `  · not heard: ${words.filter((w) => !w.heard).map((w) => w.w).join(" ")}` : ""}`);
  }
  if (voice.analysis.matched < 0.6) console.warn(`\nwarning: only ${Math.round(voice.analysis.matched * 100)}% of the text was heard: check each beat's "text" is what is said, and the language.`);
  if (timed) {
    manifest.beats.forEach((b, i) => { b.durationSeconds = Math.round(voice.spans[i]!.durationSeconds * 1000) / 1000; });
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`\nWrote the lengths into ${path.basename(file)}, and every word's time into voice.json.`);
  } else console.log(`\n"timing": "manifest": the lengths in ${path.basename(file)} are kept. Words are in voice.json.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
