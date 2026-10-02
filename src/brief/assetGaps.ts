import type { AssetRequirement } from "./assetRequirementTypes.js";

/**
 * What is missing, and what can be done about it.
 *
 * ## Why this exists
 *
 * Today a required asset that nobody uploaded simply stalls the reel: the Material stage says
 * "2 Asset(s) hochladen" and stops. That is correct — a missing logo must not be faked — but it
 * is not helpful, because it states the problem and says nothing about the ways out. Several of
 * those ways are things the pipeline can do itself (capture the screen, generate a conceptual
 * shape, use a different library asset that fills the same role) and one of them is simply
 * "this beat does not need it, compose it as type".
 *
 * So a gap is reported as a requirement plus an ordered list of resolutions, each naming what it
 * would take. Nothing here decides anything — it lays out the options and says which are
 * legitimate for *this* requirement.
 *
 * ## The one rule that is not negotiable
 *
 * `assetKind` already encodes it, and `assetRequirementTypes.ts` states why: **identity** is a
 * specific real-world thing that cannot be faked — a named company's logo, a real screenshot of a
 * real UI — and **generic** is conceptual, where a generated shape is an honest stand-in.
 *
 * So `generate` is never offered for an identity asset. A generated logo is a fabricated logo,
 * and passing one off as a real brand's mark in a client's video is the invented-content failure
 * this repo has fixed more times than any other. The same reason `emphasis` may only quote words
 * the script actually says.
 */

export type ResolutionKind =
  /** A human drops the file in. */
  | "provide"
  /** Capture it from a live product surface with a browser. */
  | "capture"
  /** Record the step on a real screen. The recording is used as it is. */
  | "record"
  /** Fetch the official mark from the brand's own source, with its licence recorded. */
  | "brand_source"
  /** Use a different asset already in the library that fills the same visual role. */
  | "substitute"
  /** Draw it, because it is conceptual and nothing real is being impersonated. */
  | "generate"
  /** Generate a clip with Higgsfield: atmosphere only, and only when its MCP is connected. */
  | "higgsfield"
  /** Change the brief so the beat does not need it — usually type-forward instead. */
  | "recompose"
  /** Leave it out. Only ever available to an optional requirement. */
  | "omit";

export interface GapResolution {
  kind: ResolutionKind;
  /** One line a human reads. */
  label: string;
  /** What this needs from a human before it can run. Absent when the pipeline can just do it. */
  needs?: string;
  /** Why this is, or is not, a good idea for this particular requirement. */
  note?: string;
}

export type GapStatus =
  /** Nobody has supplied it and nothing has been tried. */
  | "not_provided"
  /** Acquisition ran and did not produce anything usable. */
  | "acquisition_failed"
  /** Something was supplied but it could not be matched to this requirement with confidence. */
  | "ambiguous";

export interface AssetGap {
  requirement: AssetRequirement;
  status: GapStatus;
  /** Why acquisition failed, when it was tried. Carried through verbatim. */
  detail?: string;
  /** Best first. Never empty — there is always at least `recompose`. */
  resolutions: GapResolution[];
  /** Whether this stops the reel. */
  blocking: boolean;
}

/**
 * Whether a missing requirement stops the reel.
 *
 * Preserves the split `assetRequirementTypes.ts` already documents: a missing identity asset
 * blocks, because there is no honest substitute for a specific real thing; a missing generic one
 * never stalls the reel, because a generated shape stands in.
 */
export function isBlocking(req: AssetRequirement): boolean {
  return req.priority === "required" && req.assetKind === "identity";
}

/**
 * Words are matched whole, against the fields that describe the ASSET.
 *
 * Both halves of that matter. A substring test put "chat" inside "ChatGPT" and offered to screen-
 * capture a logo; "ui" and "app" hide inside ordinary words the same way. And searching `reason`
 * and `sceneUsage` searches the beat's narrative rather than the thing being asked for — the
 * sentence "shown beside the ChatGPT mark in the comparison beat" describes a logo, not a screen.
 */
function words(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
}

const SCREEN_WORDS = ["screenshot", "screen", "ui", "interface", "oberfläche", "dashboard", "app", "website", "webseite", "seite", "browser", "editor", "panel", "capture"];
const MARK_WORDS = ["logo", "logos", "wordmark", "mark", "icon", "brand", "marke", "markenzeichen"];

/** Whether a requirement names something that lives on a screen and could be captured. */
function looksCapturable(req: AssetRequirement): boolean {
  const have = words(`${req.name} ${req.visualRole}`);
  return SCREEN_WORDS.some((w) => have.has(w));
}

/** Whether it names a brand mark. */
function looksLikeMark(req: AssetRequirement): boolean {
  const have = words(`${req.name} ${req.visualRole}`);
  return MARK_WORDS.some((w) => have.has(w));
}

/**
 * The ways this particular requirement could be satisfied, best first.
 *
 * Ordering is by how much it costs a human: things the pipeline can do alone come before things
 * that need a file or a decision, and `recompose` is last because changing the beat is a real
 * creative concession rather than a fix.
 */
export function resolutionsFor(req: AssetRequirement): GapResolution[] {
  const out: GapResolution[] = [];

  if (req.form === "footage") {
    out.push({
      kind: "record",
      label: `Record "${req.name}" on a real screen`,
      needs: "a screen recording of just that step (on a Mac: Shift-Cmd-5), then marked as a moment in the studio",
      note: "It is used as recorded — trimmed, framed and sped up at most 2x, never redrawn. Record the whole step and leave a beat of the result at the end.",
    });
    out.push({
      kind: "provide",
      label: "Mark a moment in a recording you already have",
      needs: "the recording in the studio's Footage tab, and the step named on it",
    });
    out.push({
      kind: "substitute",
      label: "Use another moment in the library",
      needs: "a choice from the library",
      note: `The role is "${req.visualRole}". Only honest if it really shows the same step.`,
    });
    if (req.priority === "optional") out.push({ kind: "omit", label: "Leave it out", note: "It is marked optional, so the beat works without it." });
    out.push({
      kind: "recompose",
      label: "Compose the beat as an animation or as type instead",
      needs: "a re-direction of this beat",
      note: `That is a stand-in for the real step, not the recording. The beat currently wants it for: ${req.sceneUsage}`,
    });
    return out;
  }

  if (req.assetKind === "identity") {
    if (looksCapturable(req)) {
      out.push({
        kind: "capture",
        label: `Capture "${req.name}" from the live product`,
        needs: "a URL, and a sign-in if the screen is behind one",
        note: "Crop to the detail the beat uses. A full browser window shrunk into the frame is the reason screenshots in this reel are unreadable.",
      });
    }
    if (looksLikeMark(req)) {
      out.push({
        kind: "brand_source",
        label: `Fetch the official "${req.name}" from the brand's own press or brand page`,
        needs: "confirmation of the source URL and its licence terms",
        note: "Recorded with the asset. Nominative use of a mark is usually fine; anything unclear stays blocked.",
      });
    }
    out.push({
      kind: "provide",
      label: `Drop the file in`,
      needs: req.acceptedFormats.length > 0 ? `a file in ${req.acceptedFormats.join(", ")}` : "the file",
    });
    out.push({
      kind: "substitute",
      label: "Use another library asset in the same role",
      needs: "a choice from the library",
      note: `The role is "${req.visualRole}". Only honest if the substitute really is the same thing.`,
    });
  } else {
    out.push({
      kind: "generate",
      label: `Draw "${req.name}"`,
      note: "It is conceptual, so nothing real is being impersonated and no reel needs to stall for it.",
    });
    out.push({
      kind: "higgsfield",
      label: `Generate "${req.name}" with Higgsfield (AI video)`,
      needs: "the Higgsfield MCP connected, and credits",
      note: "Atmosphere only — never a real product, mark or screen. If it is not connected, or the generation fails, drawing it above is the fallback.",
    });
    out.push({
      kind: "substitute",
      label: "Use another library asset in the same role",
      needs: "a choice from the library",
      note: `The role is "${req.visualRole}".`,
    });
    out.push({
      kind: "provide",
      label: "Drop the file in",
      needs: req.acceptedFormats.length > 0 ? `a file in ${req.acceptedFormats.join(", ")}` : "the file",
    });
  }

  if (req.priority === "optional") {
    out.push({ kind: "omit", label: "Leave it out", note: "It is marked optional, so the beat works without it." });
  }

  out.push({
    kind: "recompose",
    label: "Compose the beat without it",
    needs: "a re-direction of this beat",
    note: `The beat currently wants it for: ${req.sceneUsage}`,
  });

  return out;
}

export interface GapInput {
  requirement: AssetRequirement;
  status: GapStatus;
  detail?: string;
}

/** Turn open requirements into gaps with their options, blocking ones first. */
export function reportAssetGaps(open: readonly GapInput[]): AssetGap[] {
  return open
    .map(({ requirement, status, detail }) => ({
      requirement,
      status,
      ...(detail ? { detail } : {}),
      resolutions: resolutionsFor(requirement),
      blocking: isBlocking(requirement),
    }))
    .sort((a, b) => Number(b.blocking) - Number(a.blocking));
}

const STATUS_TEXT: Record<GapStatus, string> = {
  not_provided: "not provided",
  acquisition_failed: "could not be acquired",
  ambiguous: "supplied but could not be matched",
};

/**
 * The gap report a human reads.
 *
 * States what is missing, whether it stops the reel, and what can be done — never just the first
 * of those. A report that says "2 assets missing" and stops is the behaviour this replaces.
 */
export function formatGapReport(gaps: readonly AssetGap[]): string {
  if (gaps.length === 0) return "No open asset requirements.";

  const blocking = gaps.filter((g) => g.blocking).length;
  const lines: string[] = [];
  lines.push(
    blocking > 0
      ? `${gaps.length} open requirement${gaps.length === 1 ? "" : "s"}, ${blocking} of which stop${blocking === 1 ? "s" : ""} the reel.`
      : `${gaps.length} open requirement${gaps.length === 1 ? "" : "s"}. None stop the reel.`,
  );

  for (const gap of gaps) {
    const { requirement: req } = gap;
    lines.push("");
    lines.push(`${gap.blocking ? "BLOCKS" : "open  "}  ${req.name} — ${STATUS_TEXT[gap.status]}${gap.detail ? ` (${gap.detail})` : ""}`);
    lines.push(`        needed for: ${req.sceneUsage}`);
    lines.push(`        ${req.form === "footage" ? "A real recording of a real step — it cannot be drawn." : req.assetKind === "identity" ? "A specific real thing — it cannot be drawn." : "Conceptual — it can be drawn."}`);
    for (const [i, r] of gap.resolutions.entries()) {
      lines.push(`        ${i + 1}. ${r.label}${r.needs ? ` — needs ${r.needs}` : ""}`);
      if (r.note) lines.push(`           ${r.note}`);
    }
  }

  return lines.join("\n");
}
