import { scoreMatch, type MatchConfidence } from "../brief/assetIntake.js";
import type { AssetRequirement } from "../brief/assetRequirementTypes.js";
import { LIBRARY_ASSET_DIR } from "./refs.js";
import { normaliseTags, type LibraryAsset } from "./schema.js";

/**
 * Which library assets answer which requirements — and which of those can be used without asking.
 *
 * Scoring is `scoreMatch` from intake, so a library hit and a dropped file are judged by the same
 * words. The difference is what the library knows about each asset: its tags count as part of its
 * name, and its provenance decides whether an `exact` match is safe to apply.
 *
 * ## The reuse policy
 *
 * The failure this guards against: a brand refreshes its mark, or a product redesigns the screen
 * that was captured, and the library keeps handing out the old one. It fills the slot, the bounds
 * are legal, every later gate passes — the same class of failure as a fabricated statistic.
 *
 * So `auto` needs all of:
 *   - an `exact` match,
 *   - status `active` (superseded and retired assets are never offered at all),
 *   - review `approved`: an asset dropped in a folder or onto the dashboard has not been looked at,
 *     so it is only ever *proposed*, however well its machine-written tags match (a rejected one is
 *     never offered),
 *   - for `identity`: provenance someone can check — a source URL, a capture sidecar, or the
 *     user having handed it over,
 *   - for a capture: taken within `STALE_CAPTURE_DAYS`.
 * Everything else is a proposal, shown with the reason it was not applied.
 */

export const STALE_CAPTURE_DAYS = 90;

export type LibraryDecision = "auto" | "proposal";

export interface LibraryMatch {
  requirement: AssetRequirement;
  asset: LibraryAsset;
  confidence: MatchConfidence;
  decision: LibraryDecision;
  /** Why it matched, and — for a proposal — why it was not applied. */
  why: string;
}

export interface LibraryMatchResult {
  matches: LibraryMatch[];
  /** Requirements the library has nothing for. */
  stillOpen: AssetRequirement[];
}

export interface MatchOptions {
  /** Only consider assets carrying every one of these tags. */
  tags?: readonly string[];
  now?: Date;
}

const RANK: Record<MatchConfidence, number> = { exact: 3, likely: 2, guess: 1 };

/** The text an asset is matched on: its name plus its tags, with its real extension. */
function matchName(asset: LibraryAsset): string {
  return `${asset.name} ${asset.tags.join(" ")}${asset.ext ? `.${asset.ext}` : ""}`;
}

function hasCheckableProvenance(asset: LibraryAsset): boolean {
  const p = asset.provenance;
  return Boolean(p.url || p.captureSidecar || p.source === "user");
}

/** Days since the asset's surface was photographed, or undefined when it is not a capture. */
export function captureAgeDays(asset: LibraryAsset, now: Date): number | undefined {
  if (asset.provenance.source !== "capture") return undefined;
  const at = Date.parse(asset.provenance.capturedAt ?? asset.addedAt);
  if (Number.isNaN(at)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - at) / 86_400_000;
}

/** Why an asset may not be applied without asking, or undefined when it may. */
export function blockReason(asset: LibraryAsset, confidence: MatchConfidence, now: Date): string | undefined {
  if (asset.review.state !== "approved") return "not reviewed yet — approve it in the studio (Review tab) to let reelcut use it by itself";
  if (confidence !== "exact") return `${confidence} match`;
  if (asset.status !== "active") return `status is ${asset.status}`;
  if (asset.assetKind === "identity" && !hasCheckableProvenance(asset)) return "identity asset with no recorded source";
  const age = captureAgeDays(asset, now);
  if (age !== undefined && age > STALE_CAPTURE_DAYS) return `captured ${Math.floor(age)} days ago — recapture or confirm the screen has not changed`;
  return undefined;
}

export function filterByTags(assets: readonly LibraryAsset[], tags: readonly string[]): LibraryAsset[] {
  const wanted = normaliseTags(tags);
  if (wanted.length === 0) return [...assets];
  return assets.filter((a) => wanted.every((t) => a.tags.includes(t)));
}

/**
 * Best library asset for each requirement.
 *
 * Unlike a drop, one library asset may answer several requirements — the same mark can
 * legitimately appear in two beats. Each requirement still gets at most one asset.
 */
export function matchLibrary(open: readonly AssetRequirement[], assets: readonly LibraryAsset[], options: MatchOptions = {}): LibraryMatchResult {
  const now = options.now ?? new Date();
  // A clip a model made is atmosphere, never the thing a requirement names, so it is not offered for one.
  const pool = filterByTags(assets, options.tags ?? []).filter((a) => a.status === "active" && a.review.state !== "rejected" && a.provenance.source !== "generated");

  const matches: LibraryMatch[] = [];
  const stillOpen: AssetRequirement[] = [];

  for (const requirement of open) {
    // A moment of a recording is found by `findMoments`; a still is never offered for it by name.
    if (requirement.form === "footage") {
      stillOpen.push(requirement);
      continue;
    }
    let best: LibraryMatch | undefined;
    for (const asset of pool) {
      const score = scoreMatch(requirement, { path: asset.file, name: matchName(asset) });
      if (!score) continue;
      // An identity requirement is never answered by an asset that is only a generic stand-in —
      // except as a proposal, when nobody has decided what the asset is yet. A dropped file's kind is
      // never guessed, so a pending one that looks like the mark is shown for a person to confirm.
      const unconfirmed = requirement.assetKind === "identity" && asset.assetKind !== "identity";
      if (unconfirmed && asset.review.state === "approved") continue;
      const blocked = unconfirmed ? `kind is ${asset.assetKind}: confirm it is the real ${requirement.name} before it is used` : blockReason(asset, score.confidence, now);
      const candidate: LibraryMatch = {
        requirement,
        asset,
        confidence: score.confidence,
        decision: blocked ? "proposal" : "auto",
        why: blocked ? `${score.why}; not applied: ${blocked}` : score.why,
      };
      if (!best || isBetter(candidate, best)) best = candidate;
    }
    if (best) matches.push(best);
    else stillOpen.push(requirement);
  }

  return { matches, stillOpen };
}

function isBetter(a: LibraryMatch, b: LibraryMatch): boolean {
  if (RANK[a.confidence] !== RANK[b.confidence]) return RANK[a.confidence] > RANK[b.confidence];
  if (a.decision !== b.decision) return a.decision === "auto";
  // Newest wins a tie: of two exact Claude logos, the one added later is the likelier current one.
  return a.asset.addedAt > b.asset.addedAt;
}

export function formatLibraryMatches(result: LibraryMatchResult): string {
  if (result.matches.length === 0) return "Nothing in the library matched.";
  return result.matches
    .map((m) => {
      const mark = m.decision === "auto" ? "ok  " : "?   ";
      const source = m.asset.provenance.url ?? m.asset.provenance.source;
      const ref = `${LIBRARY_ASSET_DIR}/${m.asset.file.split("/").pop()}`;
      return `${mark}library: ${m.asset.name} -> ${m.requirement.name}  as ${ref}
      (${m.confidence}: ${m.why}; from ${source}, added ${m.asset.addedAt.slice(0, 10)})`;
    })
    .join("\n");
}
