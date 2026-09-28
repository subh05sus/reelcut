import type { OutputFormat } from "../core/index.js";

/**
 * Everything known about a beat before anyone decides what it looks like.
 *
 * This is the input the agent reads when writing a `BeatBrief`, and the input the deterministic
 * fallback reads when no one is there to write one. It replaces `BeatBriefPromptInput`, which
 * lived in a prompt builder whose whole job was turning these fields into text for Gemini. The
 * fields survive; the prompt does not, because `SKILL.md` and its references are the prompt now.
 */

/**
 * One asset the beat is allowed to mention.
 *
 * Never the whole library — only what was deliberately offered for this beat. Copied out of the
 * old `CandidateAsset` unchanged: it is a flat descriptor with no dependencies, and the fields are
 * what an agent needs to tell whether an asset is the right one.
 */
export interface CandidateAsset {
  id: string;
  product: string;
  surface: string;
  theme: string;
  screen: string;
  dynamicState: string | null;
  keywords: readonly string[];
  /** Decides whether it can be treated as footage or is a mark to be placed. */
  assetType?: "screenshot" | "recording" | "logo" | "component_crop";
  /** Real pixel size, when known. Needed to tell whether it will be legible at its target size. */
  width?: number;
  height?: number;
}

export interface BeatBriefInput {
  /** The spoken line, verbatim. */
  sourceText: string;
  description?: string;
  /** What this beat does in the argument: hook, contrast, escalate, resolve, demonstrate. */
  beatIntent?: string;
  durationMs: number;
  fps: number;
  format: OutputFormat;
  /** A named look, when the reel has one. */
  artDirection?: string;
  /** Surrounding beats, so entry and exit can be matched across a hard cut. */
  previousBeatText?: string;
  nextBeatText?: string;
  candidateAssets?: readonly CandidateAsset[];
  /** What earlier beats already did, so this one is not the third of the same idea. */
  recentCompositionNotes?: readonly string[];
}
