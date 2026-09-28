import { readingFloorSeconds, type BeatBrief } from "./beatBrief.js";
import type { BeatBriefInput } from "./beatInput.js";

/**
 * A usable brief without a model.
 *
 * Same contract as `deterministicDirector.ts`: the pipeline must produce something renderable when
 * the API key is missing, the call times out, or three attempts all come back unusable. What it
 * must never do is guess — every field here is derived from the input or from a fixed table, and
 * `emphasis` is deliberately left empty because a fallback that invents emphasis is a fallback
 * that invents content.
 *
 * The composition it describes is honest about being a fallback: one line, held, on a committed
 * ground. That is a worse beat than a directed one and a better beat than a broken one.
 */

/** Grounds per art direction, so the fallback still commits to a field rather than defaulting to near-white. */
const PALETTES: Record<string, BeatBrief["palette"]> = {
  swiss_paper: { ground: "#ede9e3", ink: "#14110e", accent: "#d02d1c" },
  editorial_dark: { ground: "#121114", ink: "#f2efe9", accent: "#e8654a" },
  terminal_mono: { ground: "#0d1117", ink: "#d7e2ea", accent: "#4ade80" },
  blueprint_grid: { ground: "#10243a", ink: "#e6eef6", accent: "#7fb7e8" },
  neo_brutal_print: { ground: "#f5f1e6", ink: "#111111", accent: "#ff4b1f" },
  broadcast_bold: { ground: "#0a0a0a", ink: "#ffffff", accent: "#ffd400" },
  product_light: { ground: "#f4f2ef", ink: "#1b1b1f", accent: "#3b5bdb" },
};

const DEFAULT_PALETTE: BeatBrief["palette"] = PALETTES.swiss_paper!;

export function deterministicBeatBrief(input: BeatBriefInput): BeatBrief {
  const durationSeconds = Math.max(0.8, input.durationMs / 1000);
  const line = input.sourceText.trim();
  const palette = (input.artDirection && PALETTES[input.artDirection]) || DEFAULT_PALETTE;

  /*
   * Entrance scaled to what the line needs, not to a fixed share of the beat.
   *
   * A flat fraction collapses at both ends — on a 1.2s beat it leaves nothing settled, and on a
   * 6s beat it produces a two-second entrance. Reserve the floor first, then spend what is left.
   */
  const floor = readingFloorSeconds(line);
  const entrance = Math.min(0.5, Math.max(0.25, (durationSeconds - floor) * 0.5));

  const phases: BeatBrief["phases"] = [
    { at: 0, does: "the line arrives on a committed ground" },
    { at: Number(entrance.toFixed(2)), does: "it settles and holds long enough to be read" },
  ];
  if (durationSeconds - entrance - floor > 0.6) {
    phases.push({ at: Number((durationSeconds - 0.45).toFixed(2)), does: "it gives way ahead of the next beat" });
  }

  return {
    intent: input.beatIntent ?? "State the line plainly and give it time to land",
    mustRead: [line],
    // Never invented. A fallback that guesses which word matters is guessing about the script.
    emphasis: [],
    mustShow: [],
    composition:
      "A single full-bleed ground with the line set large and left-aligned, entering once and holding. No secondary elements, because there is no direction to justify any.",
    phases,
    palette,
    durationSeconds: Number(durationSeconds.toFixed(3)),
  };
}
