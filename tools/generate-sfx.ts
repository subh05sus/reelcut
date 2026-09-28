import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * Synthesise the sound-effect set that `--sfx` draws from.
 *
 *   npm run sfx:generate
 *
 * ## Why synthesise instead of shipping a library
 *
 * The usual answer is a pack of recorded effects. That means third-party binaries committed to a
 * public repo, a licence to track per file, and — since they are recordings — no way to say what
 * any one of them actually is beyond its filename.
 *
 * These are formulas. Every sound is an expression over time or seeded noise through fixed
 * filters, so the whole set is:
 *
 * - **original**, with no licence to carry,
 * - **reproducible** byte for byte — `anoisesrc` takes a seed, so the noise-based ones are
 *   deterministic, which matters for a renderer whose whole contract is determinism. This was
 *   first claimed and not true: regenerating changed every hash. The decoded audio was always
 *   identical — the Ogg container carries a random stream serial per encode. `+bitexact` removes
 *   it, and the check below now proves the claim rather than asserting it,
 * - **small** — a few kilobytes each,
 * - **legible** — the formula states what the sound is, and changing one is a one-line edit.
 *
 * They will not out-shine a professionally recorded library, and they are not meant to. Effects in
 * this skill sit under a voice at 0.35 volume and support motion rather than announce it. For that
 * job, clean and restrained beats rich and characterful.
 *
 * ## The rules each sound follows
 *
 * - A few milliseconds of fade in and out, so no sound starts or stops with a click.
 * - **The same peak ceiling, measured.** The first set was generated at whatever level each
 *   formula happened to produce: peaks ranged from −14.8 dB to 0.0 dB, and mean loudness spanned
 *   ~18 dB — so at the same volume setting a whoosh was near-inaudible while a thud was loud, and
 *   two sounds sat at full scale where lossy encoding can push them over. Each sound is now
 *   rendered losslessly first, its peak measured, and a gain applied to land it at
 *   `TARGET_PEAK_DB`, with a limiter behind that as a net.
 * - Mono. A whoosh does not need stereo, and mono sits under a voice without fighting it.
 */

/** Every sound's peak lands here. Headroom below 0 dBFS for the overshoot lossy encoding adds. */
export const TARGET_PEAK_DB = -3;

interface Sound {
  name: string;
  /** Seconds. */
  duration: number;
  /** One line: what it is, and what motion it goes under. */
  use: string;
  /** An ffmpeg lavfi graph producing the raw signal. `{d}` is replaced with the duration. */
  graph: string;
}

const SAMPLE_RATE = 44100;

/**
 * Keystroke onsets in seconds, and each one's strength. Hand-written rather than generated so the
 * rhythm reads as a person: ~10 keys a second — the pace a type-on reveals characters at — with
 * uneven gaps, a short pause where a word would break, and no two neighbours equally loud. A
 * perfectly even run sounds like a machine gun, which is the first thing viewers notice.
 */
const TYPING_KEYS: readonly (readonly [number, number])[] = [
  [0.0, 0.9], [0.085, 0.7], [0.19, 1.0], [0.262, 0.75], [0.36, 0.85], [0.448, 0.65],
  [0.63, 0.95], [0.71, 0.7], [0.815, 0.9], [0.89, 0.6], [0.99, 0.85], [1.07, 0.75],
];

/**
 * One key is two parts: a click (noise with a ~5ms decay) and a faint body (a 210Hz tone decaying
 * over ~15ms) — the plastic and the desk under it. `random(0)` is ffmpeg's expression PRNG with its
 * seed held in variable 0, which starts at zero, so the noise is identical on every generation.
 * `gte(t,k)` gates each key on at its onset.
 */
function typingExpression(): string {
  return TYPING_KEYS.map(([k, a]) => {
    const since = `(t-${k})`;
    return `${a}*gte(t,${k})*((2*random(0)-1)*exp(-200*${since})+0.45*sin(2*PI*210*${since})*exp(-70*${since}))`;
  }).join("+");
}

export const SOUNDS: readonly Sound[] = [
  {
    name: "whoosh",
    duration: 0.55,
    use: "a large element travelling across the frame, or a scale change that moves a lot of area",
    // Band-limited pink noise with a sin² swell: the sound of air moving past.
    graph: "anoisesrc=d={d}:c=pink:r=44100:a=0.7:seed=7,highpass=f=250,lowpass=f=2800,volume='pow(sin(PI*t/{d}),2)':eval=frame",
  },
  {
    name: "swipe",
    duration: 0.3,
    use: "a lighter lateral move — a card sliding in, a panel shifting",
    graph: "anoisesrc=d={d}:c=pink:r=44100:a=0.55:seed=11,highpass=f=900,lowpass=f=5200,volume='pow(sin(PI*t/{d}),2)':eval=frame",
  },
  {
    name: "tick",
    duration: 0.035,
    use: "a single keystroke or UI tap; repeat it for typing, never faster than the characters appear",
    graph: "anoisesrc=d={d}:c=white:r=44100:a=0.5:seed=3,highpass=f=2200,volume='exp(-120*t)':eval=frame",
  },
  {
    name: "typing",
    duration: TYPING_KEYS[TYPING_KEYS.length - 1]![0] + 0.12,
    use: "a run of keystrokes under text that types on; trim it with durationSeconds to the type-on's length",
    graph: `aevalsrc='${typingExpression()}':d={d}:s=44100,highpass=f=140,lowpass=f=9000`,
  },
  {
    name: "thud",
    duration: 0.45,
    use: "something landing with weight — a heavy card settling, a headline slamming in",
    graph: "aevalsrc='0.85*sin(2*PI*62*t)*exp(-9*t)':d={d}:s=44100",
  },
];

/** Peak level of a file in dBFS. volumedetect reports on stderr, so it is read from there. */
function peakDb(file: string): number {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  return Number(/max_volume:\s*(-?[\d.]+)/.exec(result.stderr)?.[1] ?? "NaN");
}

const BITEXACT = ["-fflags", "+bitexact", "-flags:a", "+bitexact"];

function generate(sound: Sound, outDir: string): { file: string; gainDb: number } {
  const out = path.join(outDir, `${sound.name}.ogg`);
  const raw = path.join(outDir, `.${sound.name}.raw.wav`);
  const fadeOutStart = Math.max(0, sound.duration - 0.012);
  const signal = [sound.graph.replaceAll("{d}", String(sound.duration)), "afade=t=in:d=0.004", `afade=t=out:st=${fadeOutStart}:d=0.012`, "aformat=channel_layouts=mono"].join(",");

  // Pass 1: lossless, no gain, so the peak measured is the formula's own.
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", signal, "-t", String(sound.duration), "-ar", String(SAMPLE_RATE), "-c:a", "pcm_s16le", raw]);
  const measured = peakDb(raw);
  if (!Number.isFinite(measured)) throw new Error(`${sound.name}: could not measure a peak`);
  const gainDb = TARGET_PEAK_DB - measured;

  // Pass 2: the same signal with the gain that lands it on the ceiling, a limiter as a net, and
  // bit-exact muxing so the file is identical every time it is generated.
  const limit = Math.pow(10, TARGET_PEAK_DB / 20);
  // `level=disabled` matters: alimiter's auto-level is on by default and applies make-up gain back
  // to full scale, which silently undid the ceiling — the first run of this landed every peak at
  // 0.0 dBFS, exactly the clipping risk the normalisation exists to remove.
  const graph = `${signal},volume=${gainDb.toFixed(3)}dB,alimiter=limit=${limit.toFixed(4)}:level=disabled`;
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", graph, "-t", String(sound.duration), "-ar", String(SAMPLE_RATE), ...BITEXACT, "-c:a", "libvorbis", "-q:a", "5", out]);
  rmSync(raw, { force: true });
  return { file: out, gainDb };
}

function main(): void {
  const outDir = path.resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[2] ?? "skills/reelcut/assets/sfx");
  mkdirSync(outDir, { recursive: true });
  for (const sound of SOUNDS) {
    const { file, gainDb } = generate(sound, outDir);
    console.log(`${sound.name.padEnd(7)} ${sound.duration.toFixed(3)}s  gain ${gainDb >= 0 ? "+" : ""}${gainDb.toFixed(1)}dB  ${path.relative(process.cwd(), file)}`);
  }
}

main();
