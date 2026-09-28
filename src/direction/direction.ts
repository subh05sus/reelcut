import type { BeatBrief } from "../brief/beatBrief.js";

/**
 * Creative direction given at invocation, and the parts of it that can be enforced.
 *
 * ## Why this is a module and not just prose in the prompt
 *
 * "Use a warm palette" is a suggestion and belongs in the brief. "No text at all" is a
 * constraint, and a constraint that is only written in prose gets quietly ignored on beat nine.
 * The axes here split along exactly that line: `look` and `visuals` are freeform and travel into
 * the plan untouched, while `textDensity` and `palette` are checkable and are checked.
 *
 * ## What direction may never do
 *
 * It sets register, palette, density and energy. It does **not** touch the reading floor,
 * determinism, hard cuts, or the rules against inventing content. "Make it fast and punchy" is a
 * legitimate instruction and it does not mean a line may be pulled off screen before it can be
 * read — pace comes from motion and cuts. `checkBriefAgainstDirection` deliberately cannot relax
 * anything; it only adds constraints.
 */

/**
 * How much of the script appears on screen.
 *
 * The axis that matters most here, and the one `/brag` has no equivalent for — because `/brag`
 * makes silent videos where type carries everything. These reels have a voiceover, so on-screen
 * text is often repeating what the viewer is already hearing.
 */
export type TextDensity =
  /** Every line on screen. Right when there is no voiceover and type carries the piece. */
  | "full"
  /** Only the beats that turn the argument: the hook, the claim, the payoff. */
  | "key-lines"
  /** A label per beat at most — three words or fewer. */
  | "minimal"
  /** No text at all. The voiceover carries the words; the frame carries everything else. */
  | "none";

export type MotionEnergy = "restrained" | "default" | "energetic";

export interface DirectionPalette {
  ground: string;
  ink: string;
  accent: string;
}

export interface Direction {
  textDensity: TextDensity;
  motion: MotionEnergy;
  /** Freeform art direction: "warm editorial", "Swiss print annual report", "late-90s broadcast". */
  look?: string;
  /** Freeform register steer: "lots of real product screens", "data-forward", "typographic only". */
  visuals?: string;
  palette?: DirectionPalette;
  /** Anything else the user typed, preserved verbatim for the plan. */
  freeform?: string;
}

export const TEXT_DENSITIES: readonly TextDensity[] = ["full", "key-lines", "minimal", "none"];
export const MOTION_ENERGIES: readonly MotionEnergy[] = ["restrained", "default", "energetic"];

/** Words a single on-screen line may carry. `undefined` means no limit from density alone. */
export function maxWordsPerLine(density: TextDensity): number | undefined {
  if (density === "none") return 0;
  if (density === "minimal") return 3;
  return undefined;
}

/**
 * The default, decided by whether there is a voiceover.
 *
 * With an SRT there is spoken audio, so putting every line on screen duplicates it — the viewer
 * reads and hears the same sentence, and the frame has no room left for anything else. `key-lines`
 * keeps the turns of the argument and gives the rest of the frame back.
 *
 * Without a voiceover, type is the only thing saying anything, so `full` is correct.
 */
export function defaultTextDensity(hasVoiceover: boolean): TextDensity {
  return hasVoiceover ? "key-lines" : "full";
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function parsePalette(value: string): { palette?: DirectionPalette; issue?: string } {
  const parts = value.trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length !== 3) return { issue: `--palette needs exactly three colours (ground ink accent), got ${parts.length}` };
  const bad = parts.filter((p) => !HEX.test(p));
  if (bad.length > 0) return { issue: `--palette values must be #rrggbb: ${bad.join(", ")}` };
  return { palette: { ground: parts[0]!, ink: parts[1]!, accent: parts[2]! } };
}

export interface ParseDirectionResult {
  direction: Direction;
  issues: string[];
}

/**
 * Read direction off the invocation.
 *
 * Flags are exact; everything left over is kept as `freeform` rather than discarded, because
 * "make it feel like a museum exhibit" is real direction that no flag will ever capture and it
 * must reach the plan intact.
 */
export function parseDirection(argv: readonly string[], options: { hasVoiceover: boolean }): ParseDirectionResult {
  const issues: string[] = [];
  const direction: Direction = {
    textDensity: defaultTextDensity(options.hasVoiceover),
    motion: "default",
  };
  const leftovers: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--text") {
      const value = argv[++i] ?? "";
      if ((TEXT_DENSITIES as readonly string[]).includes(value)) direction.textDensity = value as TextDensity;
      else issues.push(`--text must be one of ${TEXT_DENSITIES.join(" | ")}, got ${JSON.stringify(value)}`);
    } else if (arg === "--motion") {
      const value = argv[++i] ?? "";
      if ((MOTION_ENERGIES as readonly string[]).includes(value)) direction.motion = value as MotionEnergy;
      else issues.push(`--motion must be one of ${MOTION_ENERGIES.join(" | ")}, got ${JSON.stringify(value)}`);
    } else if (arg === "--look") {
      direction.look = argv[++i] ?? "";
    } else if (arg === "--visuals") {
      direction.visuals = argv[++i] ?? "";
    } else if (arg === "--palette") {
      const { palette, issue } = parsePalette(argv[++i] ?? "");
      if (palette) direction.palette = palette;
      if (issue) issues.push(issue);
    } else if (!arg.startsWith("--")) {
      leftovers.push(arg);
    }
  }

  const freeform = leftovers.join(" ").trim();
  if (freeform) direction.freeform = freeform;
  return { direction, issues };
}

/**
 * Where a brief disagrees with the direction it was written under.
 *
 * Only ever adds constraints. There is no direction that makes a brief legal which
 * `validateBeatBrief` rejected — the reading floor and the emphasis rule survive every setting.
 */
export function checkBriefAgainstDirection(brief: BeatBrief, direction: Direction): string[] {
  const issues: string[] = [];
  const limit = maxWordsPerLine(direction.textDensity);

  if (direction.textDensity === "none" && brief.mustRead.length > 0) {
    issues.push(`--text none, but this beat puts ${brief.mustRead.length} line(s) on screen. The voiceover carries the words; give the frame something else to do.`);
  } else if (limit !== undefined && limit > 0) {
    for (const line of brief.mustRead) {
      const words = line.trim().split(/\s+/).filter(Boolean).length;
      if (words > limit) {
        issues.push(`--text ${direction.textDensity} allows ${limit} words on screen, and "${line}" has ${words}. Cut it to a label or drop it.`);
      }
    }
  }

  if (direction.palette) {
    const { ground, ink, accent } = direction.palette;
    if (brief.palette.ground !== ground || brief.palette.ink !== ink || brief.palette.accent !== accent) {
      issues.push(`--palette was given as ${ground}/${ink}/${accent}, and this beat uses ${brief.palette.ground}/${brief.palette.ink}/${brief.palette.accent}.`);
    }
  }

  return issues;
}

/**
 * Reel-level checks, for the densities that are about proportion rather than per-beat limits.
 *
 * `key-lines` cannot be judged one beat at a time — a beat with text is fine, every beat with
 * text is not.
 */
export function checkReelAgainstDirection(briefs: readonly BeatBrief[], direction: Direction): string[] {
  if (direction.textDensity !== "key-lines" || briefs.length === 0) return [];
  const withText = briefs.filter((b) => b.mustRead.length > 0).length;
  const share = withText / briefs.length;
  if (share > 0.6) {
    return [
      `--text key-lines, but ${withText} of ${briefs.length} beats carry text (${Math.round(share * 100)}%). Keep it to the turns of the argument — the hook, the claim, the payoff — and let the voiceover do the rest.`,
    ];
  }
  return [];
}

/** One paragraph for the top of the plan, so the direction is visible beside the beats. */
export function describeDirection(direction: Direction): string {
  const lines = [
    `Text on screen: ${direction.textDensity}${direction.textDensity === "none" ? " — the voiceover carries every word" : ""}`,
    `Motion: ${direction.motion}`,
  ];
  if (direction.palette) lines.push(`Palette: ground ${direction.palette.ground}, ink ${direction.palette.ink}, accent ${direction.palette.accent}`);
  if (direction.look) lines.push(`Look: ${direction.look}`);
  if (direction.visuals) lines.push(`Visuals: ${direction.visuals}`);
  if (direction.freeform) lines.push(`Direction, verbatim: ${direction.freeform}`);
  return lines.join("\n");
}
