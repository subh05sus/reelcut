/**
 * How long a line has to be on screen before a viewer can be expected to have read it.
 *
 * This lives in `core` because it is a fact about reading, not about any one stage: the director
 * uses it to reject a brief whose payoff cannot fit, the short-cut planner uses it to decide
 * whether a beat survives being shortened, and the authoring guidance states it as a rule. Three
 * copies of the same arithmetic would drift.
 *
 * The numbers come from `/brag`'s creative laws, which state them as the difference between a cut
 * that reads as punchy and one that reads as broken: pace comes from motion and cuts, never from
 * pulling text away before it can be read. This project has the matching negative evidence —
 * `beat_11` of reel 765c6d40 scheduled its payoff line into the last 25 of 122 frames, giving it
 * 0.83s including its own entrance, and no gate in the pipeline could see that as a defect.
 *
 * Time is counted from when the WHOLE line is on screen and settled, not from when it begins
 * entering. An entrance is not reading time.
 */

/** Seconds a line needs settled on screen. Returns 0 for empty text rather than NaN. */
export function readingFloorSeconds(line: string): number {
  const words = line.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;
  // 1-3 words is a label: recognised, not read word by word.
  if (words <= 3) return 0.8;
  return Math.max(1.2, 0.3 * words);
}

/**
 * The fastest an entrance may be and still read as deliberate.
 *
 * Used to reserve room when checking a line against a duration: a line cannot be settled for its
 * floor if the beat is barely longer than the floor itself.
 */
export const MIN_ENTRANCE_SECONDS = 0.35;

/** Whether `line` can be both entered and read inside `seconds`. */
export function lineFitsDuration(line: string, seconds: number): boolean {
  return readingFloorSeconds(line) + MIN_ENTRANCE_SECONDS <= seconds;
}
