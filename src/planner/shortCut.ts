import { lineFitsDuration, readingFloorSeconds } from "../core/index.js";

/**
 * Cutting a long reel down to something postable.
 *
 * ## Why this is a separate mode and not a shorter reel
 *
 * The reels this project makes are 55s of German script. `/brag` makes 15-25s pieces and its
 * first creative law is that length: *"Short. 15-25 seconds. Not one second more without a
 * reason."* That is not a stylistic preference, it is what makes the rest of its laws affordable.
 * A 20s piece can give every line its reading floor, hold its payoff for over a second, and still
 * cut four times. A 55s piece has to choose.
 *
 * So the short cut is a *selection* problem, and the honest split is the same one `beatBrief`
 * makes: the arithmetic belongs here, the judgement does not. `planShortCut` will produce a
 * defensible cut with no model at all, and `validateShortCut` will tell you whether a cut chosen
 * by a model is actually watchable. Neither pretends to know which beat is the best one.
 *
 * ## The shape
 *
 * Hook, then two or three highlights, then the payoff. Taken from `/brag`'s pattern, which states
 * it as a starting shape rather than a template — the count flexes with the material, and the
 * only positions that are structural are the first and the last.
 */

/** Shortest cut worth calling a cut. */
export const SHORT_CUT_MIN_SECONDS = 15;
/** Longest. Past this it is a short reel, not a cut, and it stops being postable. */
export const SHORT_CUT_MAX_SECONDS = 25;
/** Where to aim when there is a choice. */
export const SHORT_CUT_TARGET_SECONDS = 20;

export interface CutBeat {
  id: string;
  /** Position in the source reel. */
  index: number;
  /** The spoken line, verbatim. */
  text: string;
  durationMs: number;
  /** What the beat does in the argument, when the planner knows. */
  intent?: string;
}

export type CutRole = "hook" | "highlight" | "payoff";

export interface ChosenBeat extends CutBeat {
  role: CutRole;
  /** Seconds this beat gets in the cut. May be shorter than its source duration. */
  seconds: number;
}

export interface ShortCut {
  beats: ChosenBeat[];
  totalSeconds: number;
}

export interface CutIssue {
  beatId?: string;
  message: string;
}

/**
 * Everything wrong with a cut, or `[]`.
 *
 * Deliberately not "a score". Every rule is a thing a viewer would notice.
 */
export function validateShortCut(cut: ShortCut): CutIssue[] {
  const issues: CutIssue[] = [];

  if (cut.beats.length === 0) {
    return [{ message: "the cut is empty" }];
  }

  const total = cut.beats.reduce((sum, b) => sum + b.seconds, 0);
  if (Math.abs(total - cut.totalSeconds) > 0.01) {
    issues.push({ message: `totalSeconds says ${cut.totalSeconds.toFixed(2)}s but the beats sum to ${total.toFixed(2)}s` });
  }
  if (total < SHORT_CUT_MIN_SECONDS) {
    issues.push({ message: `${total.toFixed(2)}s is under the ${SHORT_CUT_MIN_SECONDS}s floor — too thin to say anything` });
  }
  if (total > SHORT_CUT_MAX_SECONDS) {
    issues.push({ message: `${total.toFixed(2)}s is over the ${SHORT_CUT_MAX_SECONDS}s ceiling — cut a beat rather than speeding one up` });
  }

  if (cut.beats[0]!.role !== "hook") {
    issues.push({ beatId: cut.beats[0]!.id, message: "the first beat must be the hook — the first two seconds decide whether anyone keeps watching" });
  }
  if (cut.beats[cut.beats.length - 1]!.role !== "payoff") {
    issues.push({ beatId: cut.beats[cut.beats.length - 1]!.id, message: "the last beat must be the payoff — a cut that stops rather than lands" });
  }
  if (cut.beats.filter((b) => b.role === "hook").length !== 1) {
    issues.push({ message: "exactly one beat may be the hook" });
  }
  if (cut.beats.filter((b) => b.role === "payoff").length !== 1) {
    issues.push({ message: "exactly one beat may be the payoff" });
  }

  // Source order must be preserved: a cut that reorders the argument breaks it.
  for (let i = 1; i < cut.beats.length; i++) {
    if (cut.beats[i]!.index <= cut.beats[i - 1]!.index) {
      issues.push({ beatId: cut.beats[i]!.id, message: "beats are out of source order — a cut may drop beats but not reorder them" });
      break;
    }
  }

  /*
   * The floor, applied per beat. This is the rule that makes a short cut different from a fast
   * one: shortening a beat is only allowed while its line still has time to be read.
   */
  for (const beat of cut.beats) {
    if (!lineFitsDuration(beat.text, beat.seconds)) {
      issues.push({
        beatId: beat.id,
        message: `"${beat.text}" needs ${readingFloorSeconds(beat.text).toFixed(2)}s settled plus an entrance and has ${beat.seconds.toFixed(2)}s — drop the beat rather than outrunning it`,
      });
    }
  }

  return issues;
}

export interface PlanShortCutOptions {
  targetSeconds?: number;
  /** Most beats the cut may contain. Past this the cut reads as a montage, not an argument. */
  maxBeats?: number;
}

/**
 * A defensible cut with no model involved.
 *
 * The rules, in order of how much they matter:
 *
 * 1. **The first and last beats are structural.** The hook earns the next fifteen seconds and the
 *    payoff is what the viewer leaves with. Neither is negotiable, so both are taken from the
 *    source reel's own ends.
 * 2. **A beat that cannot be read is not included.** No beat is ever compressed below its own
 *    reading floor; it is dropped instead. That is the one rule this shares with the director and
 *    the authoring guidance.
 * 3. **The middle is spread across the reel**, not taken from the front. A cut made of the first
 *    five beats is the opening of the reel, not a summary of it.
 *
 * It does not try to judge which beat is most interesting — see the note at the top of the file.
 * A caller with a model should choose the middle and pass the result to `validateShortCut`.
 */
export function planShortCut(beats: readonly CutBeat[], options: PlanShortCutOptions = {}): ShortCut | { issues: CutIssue[] } {
  const target = options.targetSeconds ?? SHORT_CUT_TARGET_SECONDS;
  const maxBeats = options.maxBeats ?? 6;

  const usable = beats.filter((b) => b.text.trim().length > 0 && lineFitsDuration(b.text, b.durationMs / 1000));
  if (usable.length < 2) {
    return { issues: [{ message: `only ${usable.length} beat(s) can be read in their own duration — nothing to cut` }] };
  }

  const first = usable[0]!;
  const last = usable[usable.length - 1]!;
  /*
   * A highlight has to stand on its own, and a beat that opens mid-sentence cannot.
   *
   * Segmentation splits long sentences at clause connectors (", und", ", aber" …), so a beat can
   * begin "es verliert den Faden nicht" — the second half of a thought whose first half was cut.
   * Run on the example script, the first version of this planner picked exactly that beat as a
   * highlight. In German a lowercase first letter is strong evidence of a continuation, because
   * sentences and nouns both start uppercase while the pronouns and verbs that open a clause do
   * not. An uppercase start is not proof of a sentence start, but a lowercase one is proof of a
   * fragment, which is the direction that matters.
   *
   * Falls back to the whole pool if every middle beat is a fragment, because a cut with a fragment
   * in it beats no cut at all.
   */
  const allMiddle = usable.slice(1, -1);
  const standalone = allMiddle.filter((b) => startsSentence(b.text));
  const middlePool = standalone.length > 0 ? standalone : allMiddle;

  const seconds = (b: CutBeat): number => b.durationMs / 1000;
  const ends = seconds(first) + seconds(last);
  const budget = Math.min(target, SHORT_CUT_MAX_SECONDS);

  /*
   * Sample the middle at even positions across the pool, then shrink the sample until it fits.
   *
   * The first version sorted the middle by distance from the centre and took the closest few,
   * which on the real reel picked beats 7, 8, 9 and 10 — four consecutive beats. That is a
   * contiguous slab out of the middle, and a slab is the same mistake as taking the front: it is
   * an excerpt of the reel, not a summary of it. Even sampling is what makes the survivors span
   * the argument.
   */
  let middle: CutBeat[] = [];
  for (let k = Math.max(0, Math.min(maxBeats - 2, middlePool.length)); k >= 1; k--) {
    const sample: CutBeat[] = [];
    for (let i = 0; i < k; i++) {
      const at = Math.min(middlePool.length - 1, Math.floor(((i + 0.5) / k) * middlePool.length));
      const beat = middlePool[at]!;
      if (!sample.includes(beat)) sample.push(beat);
    }
    const total = ends + sample.reduce((sum, b) => sum + seconds(b), 0);
    if (total <= budget) {
      middle = sample;
      break;
    }
  }

  const withPayoff = [first, ...middle.sort((a, b) => a.index - b.index), last];

  const out: ShortCut = {
    beats: withPayoff.map((b, i) => ({
      ...b,
      role: i === 0 ? "hook" : i === withPayoff.length - 1 ? "payoff" : "highlight",
      seconds: Number(seconds(b).toFixed(3)),
    })),
    totalSeconds: Number(withPayoff.reduce((sum, b) => sum + seconds(b), 0).toFixed(3)),
  };

  const issues = validateShortCut(out);
  return issues.length > 0 ? { issues } : out;
}

/**
 * Whether a beat opens a sentence rather than continuing one.
 *
 * The first letter decides: lowercase is a continuation. Leading punctuation and quotes are
 * skipped, so `„Nicht welcher…"` counts as a start.
 */
export function startsSentence(text: string): boolean {
  const first = /\p{L}/u.exec(text);
  if (!first) return true;
  return first[0] === first[0].toUpperCase();
}
