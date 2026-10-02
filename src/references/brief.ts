import { median } from "./analyze.js";
import type { Reference } from "./schema.js";
import { REFERENCE_MIN } from "../learnings/infer.js";

/**
 * What the references say, in a few lines, for Claude to read at Step 0 and Step 1.
 *
 * This is a summary of numbers and fixed words — a description, not an instruction. What steers a reel is
 * the learned rule a person has switched on; this says what the references look like in the aggregate so
 * Claude can explain a recommendation ("your references cut at about 1.9s a shot").
 */

export interface ReferenceBrief {
  included: number;
  excluded: number;
  /** Median of each reference's median shot length. */
  medianShotSeconds: number;
  pacing: Record<string, number>;
  ground: Record<string, number>;
  /** Moves and text styles, counted only from references whose tags a person accepted. */
  moves: [string, number][];
  textStyles: Record<string, number>;
  /** References whose tags a person has accepted, of those included. */
  reviewed: number;
  /** Fewer than this many included references and nothing is proposed. */
  minimum: number;
}

const tally = (values: readonly string[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
};

export function buildReferenceBrief(refs: readonly Reference[]): ReferenceBrief {
  const on = refs.filter((r) => r.include);
  const accepted = on.filter((r) => r.annotation?.reviewed);
  const moves = Object.entries(tally(accepted.flatMap((r) => r.annotation!.moves))).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    included: on.length,
    excluded: refs.length - on.length,
    medianShotSeconds: Math.round(median(on.map((r) => r.analysis.medianShotSeconds)) * 100) / 100,
    pacing: tally(on.map((r) => r.analysis.pacing)),
    ground: tally(on.map((r) => r.analysis.ground)),
    moves,
    textStyles: tally(accepted.flatMap((r) => (r.annotation!.textStyle ? [r.annotation!.textStyle] : []))),
    reviewed: accepted.length,
    minimum: REFERENCE_MIN,
  };
}

const list = (o: Record<string, number>): string => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ") || "—";

export function formatReferenceBrief(b: ReferenceBrief): string {
  if (b.included === 0) return "No reference videos yet. Drop some on the studio's References tab.";
  const lines = [
    `${b.included} reference${b.included === 1 ? "" : "s"} in use${b.excluded ? ` (${b.excluded} switched off)` : ""}; ${b.reviewed} with tags a person accepted.`,
    `  cutting: median shot about ${b.medianShotSeconds}s (${list(b.pacing)})`,
    `  ground: ${list(b.ground)}`,
  ];
  if (b.moves.length) lines.push(`  moves: ${b.moves.slice(0, 8).map(([m, n]) => `${m} ${n}`).join(", ")}`);
  if (Object.keys(b.textStyles).length) lines.push(`  text: ${list(b.textStyles)}`);
  if (b.included < b.minimum) lines.push(`  (a rule needs at least ${b.minimum} references that agree; ${b.minimum - b.included} more needed before anything is proposed)`);
  lines.push("This describes the references. Only the rules a person has switched on (npm run learnings -- brief) steer a reel.");
  return lines.join("\n");
}
