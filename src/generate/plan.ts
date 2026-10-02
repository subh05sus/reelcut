import type { HiggsfieldSetting } from "../library/settings.js";
import type { LibraryAsset } from "../library/schema.js";
import { beatEligibility, stillEligibility, type BeatInput, type GenerationMode } from "./eligibility.js";

/**
 * What to do about Higgsfield for a reel: ask or not, and which beats.
 *
 * A pure function of four things — the user's setting, whether the Higgsfield MCP is connected (Claude
 * checks that; code cannot), the beats, and the clip limit — so the same inputs always give the same
 * plan, and every beat that is *not* generated says why and falls back to HyperFrames. Nothing is ever
 * generated because the plan said so: the plan only says what may be, and whether to ask first.
 */

/** Most clips generated for one reel: a cap on spend that does not depend on anyone remembering to set one. */
export const MAX_CLIPS_PER_REEL = 6;

export interface PlanOptions {
  setting: HiggsfieldSetting;
  /** The Higgsfield MCP is connected in Claude's session. */
  connected: boolean;
  maxClips?: number;
  /** The library, to check an image a beat wants to animate. */
  assets?: readonly LibraryAsset[];
}

export type Decision = "generate" | "skip";

export interface BeatDecision {
  beat: string;
  decision: Decision;
  mode?: GenerationMode;
  /** Why, in words that go in plan.md. A skip is always the HyperFrames fallback. */
  reason: string;
}

export interface GenerationPlan {
  /** Claude asks the user before generating anything. False when there is nothing to ask. */
  ask: boolean;
  /** One line for plan.md about the whole decision. */
  summary: string;
  decisions: BeatDecision[];
}

export function planGeneration(beats: readonly BeatInput[], options: PlanOptions): GenerationPlan {
  const skip = (beat: string, reason: string): BeatDecision => ({ beat, decision: "skip", reason: `${reason}: composed in HyperFrames` });
  const everyBeat = (reason: string): BeatDecision[] => beats.map((b) => skip(b.id, reason));

  if (!options.connected) return { ask: false, summary: "Higgsfield is not connected: every beat is composed in HyperFrames.", decisions: everyBeat("Higgsfield is not connected") };
  if (options.setting === "never") return { ask: false, summary: "Higgsfield is turned off in the studio's settings: every beat is composed in HyperFrames.", decisions: everyBeat("Higgsfield is turned off") };

  const limit = options.maxClips ?? MAX_CLIPS_PER_REEL;
  let used = 0;
  const decisions: BeatDecision[] = beats.map((beat) => {
    const e = beatEligibility(beat);
    if (!e.eligible) return skip(beat.id, e.reasons[0]!.replace(/^not generated: /, ""));
    if (used >= limit) return skip(beat.id, `over the limit of ${limit} generated clips for one reel`);
    let mode: GenerationMode = e.modes[0]!;
    if (beat.stillAsset) {
      const asset = options.assets?.find((a) => a.id === beat.stillAsset);
      const verdict = asset ? stillEligibility(asset) : { ok: false, reason: "that image is not in the library" };
      if (verdict.ok) mode = "animate-still";
      else return skip(beat.id, `${beat.stillAsset} cannot be animated: ${verdict.reason}`);
    }
    used += 1;
    return { beat: beat.id, decision: "generate", mode, reason: e.reasons[0]! };
  });

  const count = decisions.filter((d) => d.decision === "generate").length;
  if (count === 0) return { ask: false, summary: "No beat can be generated: each needs something real, so every beat is composed in HyperFrames.", decisions };
  return {
    ask: options.setting === "ask",
    summary: `${count} of ${beats.length} beat${beats.length === 1 ? "" : "s"} can be generated${options.setting === "always" ? " (the setting is always: no question)" : ""}; the rest are composed in HyperFrames.`,
    decisions,
  };
}

export function formatPlan(plan: GenerationPlan): string {
  const lines = [plan.summary, plan.ask ? "Ask the user before generating anything: show the beats below and the credit estimate, once." : "No question is asked."];
  for (const d of plan.decisions) lines.push(`  ${d.beat}  ${d.decision === "generate" ? `GENERATE (${d.mode})` : "hyperframes"}  — ${d.reason}`);
  return lines.join("\n");
}
