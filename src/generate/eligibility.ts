import type { LibraryAsset } from "../library/schema.js";

/**
 * Which beats may be generated, and which stills may be animated.
 *
 * Decided from what a beat **requires**, never from how Claude feels about it. A model that makes video
 * makes pictures of plausible things; it cannot make *the* Claude download page, *the* Higgsfield
 * connector screen or *the* logo, and a clip that pretends to is a fabrication in a film that gets posted.
 * So anything that needs a real thing — a named brand's mark, a real screen, a recorded step — is never
 * eligible, and what is left is atmosphere: a background, a mood, an abstract idea.
 */

export type GenerationMode = "atmosphere" | "whole-beat" | "animate-still";

export interface BeatInput {
  id: string;
  /** The beat's visual type from its brief (`ui_simulation`, `logo`, `ai_clip`, …). */
  visualType?: string;
  /** The beat is a concept line with no product in it, so a generated clip may be the whole beat. */
  abstract?: boolean;
  requirements?: readonly { name: string; assetKind: "identity" | "generic"; form?: "still" | "footage" | undefined }[];
  /** A library image the beat could animate. */
  stillAsset?: string;
}

export interface Eligibility {
  beat: string;
  eligible: boolean;
  /** The ways it may be generated, best first. Empty when it is not eligible. */
  modes: GenerationMode[];
  reasons: string[];
}

/** Visual types that show the real thing. */
const REAL_TYPES: ReadonlySet<string> = new Set(["ui_simulation", "logo"]);

export function beatEligibility(beat: BeatInput): Eligibility {
  const reasons: string[] = [];
  for (const r of beat.requirements ?? []) {
    if (r.form === "footage") reasons.push(`it shows a recorded step ("${r.name}")`);
    else if (r.assetKind === "identity") reasons.push(`it needs the real ${r.name}`);
  }
  if (beat.visualType && REAL_TYPES.has(beat.visualType)) reasons.push(`it shows ${beat.visualType === "logo" ? "a mark" : "the product"}`);
  if (reasons.length > 0) return { beat: beat.id, eligible: false, modes: [], reasons: [`not generated: ${reasons.join("; ")}`] };
  return {
    beat: beat.id,
    eligible: true,
    modes: beat.abstract ? ["whole-beat", "atmosphere"] : ["atmosphere"],
    reasons: [beat.abstract ? "an abstract idea: a generated clip may carry it" : "no real product or mark: a generated background is fine"],
  };
}

/** Words that say an image is a mark or a screen, whatever it was filed as. */
const REAL_THING_TAGS = new Set(["logo", "mark", "wordmark", "brand", "screenshot", "screen", "ui", "interface", "dashboard", "app", "capture", "icon"]);

export interface StillVerdict {
  ok: boolean;
  reason?: string;
}

/** Whether a library image may be animated: an approved, generic photograph or texture, never a mark or a screen. */
export function stillEligibility(asset: LibraryAsset): StillVerdict {
  if (asset.mediaType !== "image") return { ok: false, reason: "only images can be animated" };
  if (asset.status !== "active") return { ok: false, reason: `it is ${asset.status}` };
  if (asset.review.state !== "approved") return { ok: false, reason: "nobody has approved it" };
  if (asset.assetKind !== "generic") return { ok: false, reason: "it is a real brand mark or product screen (identity), which is never animated" };
  if (asset.provenance.source === "capture" || asset.provenance.source === "brand") return { ok: false, reason: `it is a ${asset.provenance.source}, a real thing` };
  const tag = asset.tags.find((t) => REAL_THING_TAGS.has(t));
  if (tag) return { ok: false, reason: `it is tagged #${tag}: it looks like a mark or a screen` };
  return { ok: true };
}
