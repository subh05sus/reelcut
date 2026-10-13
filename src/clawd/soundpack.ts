import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describeAudio, gainFor } from "../library/analyze.js";
import type { PackManifest, PackSound } from "../library/sfxpack.js";
import { EVENT_TAGS } from "../library/sfx.js";
import { CLAWD_SOUNDS, SAMPLE_RATE, synthesise, wav } from "./sounds.js";

/**
 * Put Clawd's 8-bit blips into the bundled sound pack: synthesised, trimmed and stored as Opus in Ogg the way the rest
 * of the pack is, measured with the library's loudness code, and listed in the manifest with reelcut as their author
 * (CC0, like everything else in the pack). Re-running replaces them; nothing else in the pack is touched.
 */

export const CLAWD_SOUND_SOURCE = { pack: "Clawd's 8-bit blips", author: "reelcut", url: "https://github.com/subh05sus/reelcut", licence: "CC0 1.0" as const };

function peakOf(file: string): number {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  return Number(/max_volume: (-?[\d.]+) dB/.exec(r.stderr ?? "")?.[1] ?? NaN);
}

/** Synthesise, encode and measure every Clawd sound into `dir` (the pack directory); returns their manifest entries. */
export function buildClawdSounds(dir: string): PackSound[] {
  const out: PackSound[] = [];
  for (const s of CLAWD_SOUNDS) {
    const file = `${s.category}/${s.id}.ogg`, target = path.join(dir, file), raw = `${target}.wav`;
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(raw, wav(synthesise(s)));
    // Like the rest of the pack: -3 dBFS peak, and encoded again quieter if Opus overshoots past -0.5 dBFS.
    let gain = -3 - peakOf(raw);
    for (let attempt = 0; attempt < 3; attempt++) {
      execFileSync("ffmpeg", ["-v", "error", "-y", "-i", raw, "-af", `volume=${gain.toFixed(2)}dB,aresample=48000`, "-c:a", "libopus", "-b:a", "96k", "-ar", "48000", target]);
      const decoded = peakOf(target);
      if (!(decoded > -0.5)) break;
      gain -= decoded + 0.5 + 0.2;
    }
    rmSync(raw, { force: true });
    const buf = execFileSync("ffmpeg", ["-v", "error", "-i", target, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], { maxBuffer: 64 * 1024 * 1024 });
    const samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
    const shape = describeAudio(samples, 48000);
    out.push({
      // Its moment's own words too, so for that moment it outranks any ordinary sound that shares a word or two.
      id: s.id, name: s.name, file, category: s.category, tags: [...new Set(["clawd", "8bit", "chiptune", ...(EVENT_TAGS[s.event] ?? [s.event]), ...s.tags])],
      durationSeconds: Math.round((samples.length / 48000) * 1000) / 1000, gainDb: gainFor(shape), lufs: Math.round(shape.lufs * 10) / 10, peakDb: Math.round(peakOf(target) * 10) / 10,
      source: CLAWD_SOUND_SOURCE, derivedFrom: `synthesised at ${SAMPLE_RATE} Hz from square waves and seeded noise (src/clawd/sounds.ts)`,
    });
  }
  return out;
}

/** CREDITS.md's line for them. */
export function clawdCreditLine(count: number): string {
  return `- **${CLAWD_SOUND_SOURCE.pack}** by reelcut, synthesised for it from square waves and seeded noise: ${CLAWD_SOUND_SOURCE.url} (CC0 1.0). ${count} sound(s).`;
}

/** Rewrite the pack's manifest with Clawd's sounds in place of any earlier ones, and its credit line in CREDITS.md. */
export function addClawdSoundsToManifest(dir: string, sounds: PackSound[]): number {
  const file = path.join(dir, "manifest.json");
  const m = JSON.parse(readFileSync(file, "utf8")) as PackManifest;
  m.sounds = [...m.sounds.filter((s) => !s.id.startsWith("clawd-")), ...sounds];
  writeFileSync(file, `${JSON.stringify(m, null, 2)}\n`);
  const credits = path.join(dir, "CREDITS.md");
  const text = readFileSync(credits, "utf8").split("\n").filter((l) => !l.startsWith(`- **${CLAWD_SOUND_SOURCE.pack}**`));
  const at = text.findIndex((l, i) => l.startsWith("- **") && !(text[i + 1] ?? "").startsWith("- **"));
  text.splice(at + 1, 0, clawdCreditLine(sounds.length));
  writeFileSync(credits, text.join("\n"));
  return m.sounds.length;
}
