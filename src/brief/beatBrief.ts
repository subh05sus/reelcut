import { MIN_ENTRANCE_SECONDS, readingFloorSeconds } from "../core/index.js";
import { z } from "zod";

/**
 * What the director hands over once it stops choosing slots.
 *
 * ## Why this replaces `ScenePlan`
 *
 * `ScenePlan` asks the model to pick from a closed vocabulary — a composition id, a primitive per
 * element, a behavior, a camera mode — and `compileScenePlan` turns those picks into rectangles.
 * That pipeline can only produce arrangements the vocabulary already knows, which is why the
 * median beat put content on a quarter of the frame and why `logo_face_off` could express
 * "two logos and a divider" but not "a comparison that refuses to produce a winner".
 *
 * A brief asks for something different: what the beat *does*, what must be read, what must be
 * shown, and the identity to do it in. The model then composes the beat itself against the
 * `direct-beat` skill. Nothing here names a slot, a primitive, a region or a behavior.
 *
 * ## What this type is careful about
 *
 * The freedom that makes a brief better is the same freedom that lets a model invent content, and
 * inventing content is the defect class this repo has fixed more times than any other. So the
 * schema is permissive about *composition* and strict about *truth*:
 *
 * - `emphasis` words must actually occur in `mustRead`. A model cannot emphasise a word the
 *   script never said.
 * - `mustRead` lines are verbatim script, never paraphrase.
 * - `phases` must be ordered and inside the beat.
 * - every line that must be read has to fit its own reading floor inside the duration —
 *   the check that would have caught `beat_11` shipping its payoff with 0.83s to be read in.
 */

// The reading floor lives in `core`: the director, the short-cut planner and the authoring
// guidance all need the same arithmetic, and three copies would drift.
export { MIN_ENTRANCE_SECONDS, readingFloorSeconds };

const HEX = /^#[0-9a-fA-F]{6}$/;

export const BeatPhaseSchema = z.object({
  /** Seconds from the start of the beat. */
  at: z.number().min(0),
  /** What happens, in plain language. Not a behavior id. */
  does: z.string().min(3).max(200),
});

export const BeatPaletteSchema = z.object({
  ground: z.string().regex(HEX, "ground must be a #rrggbb hex colour"),
  ink: z.string().regex(HEX, "ink must be a #rrggbb hex colour"),
  accent: z.string().regex(HEX, "accent must be a #rrggbb hex colour"),
});

export const BeatBriefSchema = z
  .object({
    /** What this beat does to the viewer: reveal, contrast, escalate, resolve, demonstrate. */
    intent: z.string().min(8).max(240),
    /** Verbatim lines the viewer must be able to read, in the order they appear. */
    mustRead: z.array(z.string().min(1)).min(1).max(4),
    /** Words inside `mustRead` to carry the accent. May be empty. */
    emphasis: z.array(z.string().min(1)).max(6).default([]),
    /** Real material that must appear — a product surface, a mark, a captured detail. */
    mustShow: z.array(z.string().min(3)).max(4).default([]),
    /** What the layout does, in plain language. The one field that carries the composition. */
    composition: z.string().min(12).max(400),
    /** Ordered moments. Times are seconds from the start of the beat. */
    phases: z.array(BeatPhaseSchema).min(2).max(8),
    palette: BeatPaletteSchema,
    durationSeconds: z.number().min(0.8).max(20),
  })
  .strict();

export type BeatBrief = z.infer<typeof BeatBriefSchema>;
export type BeatPhase = z.infer<typeof BeatPhaseSchema>;

export interface BriefIssue {
  field: string;
  message: string;
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ");
}

/**
 * Everything wrong with a brief that the schema cannot express.
 *
 * Returns `[]` for a usable brief. Every rule here exists because its absence produced a defect
 * that reached a render.
 */
export function validateBeatBrief(brief: BeatBrief): BriefIssue[] {
  const issues: BriefIssue[] = [];

  /*
   * Emphasis must be quotation, not invention.
   *
   * Matched on a normalised haystack rather than by word equality, because German emphasis lands
   * on inflected forms and on parts of compounds — "besser" inside "besseren" is a legitimate
   * accent, and requiring an exact token match would reject it.
   */
  const haystack = normalise(brief.mustRead.join(" "));
  for (const word of brief.emphasis) {
    if (!haystack.includes(normalise(word).trim())) {
      issues.push({ field: "emphasis", message: `"${word}" does not occur in mustRead — emphasis may only mark words the script actually says` });
    }
  }

  /*
   * The reading floor, checked per line against the beat it has to live in.
   *
   * This is the gate that `beat_11` needed and did not have: its payoff "Kein Sieger" was
   * scheduled into the last 25 frames of a 122-frame beat, so it had 0.83s on screen including
   * its own entrance, and no analytic gate in the pipeline could see that as a problem.
   */
  for (const line of brief.mustRead) {
    const floor = readingFloorSeconds(line);
    if (floor + MIN_ENTRANCE_SECONDS > brief.durationSeconds) {
      issues.push({
        field: "mustRead",
        message: `"${line}" needs ${floor.toFixed(2)}s settled plus an entrance, which does not fit a ${brief.durationSeconds.toFixed(2)}s beat — cut the line or split the beat`,
      });
    }
  }

  /*
   * Read time summed across lines, when they genuinely have to be read one after another.
   *
   * Lines can share the screen — a headline holding while a payoff arrives under it is the normal
   * case, and that is why this is not a simple sum against the duration. What is not survivable is
   * a beat whose lines cannot be read even if each one is shown for exactly its floor and nothing
   * else happens.
   */
  const total = brief.mustRead.reduce((sum, line) => sum + readingFloorSeconds(line), 0);
  const longest = Math.max(...brief.mustRead.map(readingFloorSeconds));
  if (longest + MIN_ENTRANCE_SECONDS <= brief.durationSeconds && total > brief.durationSeconds * 2) {
    issues.push({
      field: "mustRead",
      message: `${brief.mustRead.length} lines need ${total.toFixed(2)}s of reading in a ${brief.durationSeconds.toFixed(2)}s beat, which is more than they can share`,
    });
  }

  // Phases are a schedule, so they must be ordered and inside the beat.
  for (let i = 0; i < brief.phases.length; i++) {
    const phase = brief.phases[i]!;
    if (phase.at > brief.durationSeconds) {
      issues.push({ field: "phases", message: `phase ${i} starts at ${phase.at}s, past the end of a ${brief.durationSeconds}s beat` });
    }
    if (i > 0 && phase.at < brief.phases[i - 1]!.at) {
      issues.push({ field: "phases", message: `phase ${i} starts at ${phase.at}s, before phase ${i - 1} at ${brief.phases[i - 1]!.at}s — phases must be ordered` });
    }
  }
  if (brief.phases[0] && brief.phases[0].at > brief.durationSeconds * 0.35) {
    issues.push({ field: "phases", message: `nothing happens until ${brief.phases[0].at}s of a ${brief.durationSeconds}s beat — the beat opens on a still frame` });
  }

  /*
   * The accent has to be distinguishable from the ink, or the emphasis is invisible.
   *
   * A crude luminance distance rather than a contrast ratio: this is not an accessibility check
   * (`hyperframes check` does WCAG properly against the real render), it is a check that the model
   * did not return three shades of the same colour.
   */
  if (brief.emphasis.length > 0 && colourDistance(brief.palette.accent, brief.palette.ink) < 40) {
    issues.push({ field: "palette", message: `accent ${brief.palette.accent} is too close to ink ${brief.palette.ink} for emphasis to read` });
  }
  if (colourDistance(brief.palette.ink, brief.palette.ground) < 80) {
    issues.push({ field: "palette", message: `ink ${brief.palette.ink} is too close to ground ${brief.palette.ground} to be legible` });
  }

  return issues;
}

function channels(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** Plain Euclidean distance in sRGB. Good enough to catch "all three are grey". */
export function colourDistance(a: string, b: string): number {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}

/** Parse and validate in one step. Returns the brief or the reasons it is unusable. */
export function parseBeatBrief(value: unknown): { brief: BeatBrief } | { issues: BriefIssue[] } {
  const parsed = BeatBriefSchema.safeParse(value);
  if (!parsed.success) {
    return { issues: parsed.error.issues.map((i) => ({ field: i.path.join(".") || "(root)", message: i.message })) };
  }
  const issues = validateBeatBrief(parsed.data);
  return issues.length > 0 ? { issues } : { brief: parsed.data };
}
