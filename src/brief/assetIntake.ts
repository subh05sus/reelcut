import type { AssetRequirement } from "./assetRequirementTypes.js";

/**
 * Matching dropped files to open requirements.
 *
 * The intake path for "just hand me the assets": a folder, a paste, a drag into the session —
 * whatever the source, it arrives as a list of filenames and this decides which requirement each
 * one answers.
 *
 * ## Why it reports confidence instead of just matching
 *
 * A wrong match is worse than no match. Putting a competitor's logo in the slot reserved for the
 * client's, because both filenames contained "logo", produces a reel that is confidently wrong —
 * and it would pass every downstream gate, because the slot is filled and the bounds are legal.
 * That is the same class of failure as a fabricated statistic.
 *
 * So the matcher scores, and only an `exact` match is safe to apply without asking. Anything
 * weaker is a proposal.
 */

export interface DroppedFile {
  /** Where it is now. */
  path: string;
  /** Basename including extension. */
  name: string;
  bytes?: number;
}

export type MatchConfidence =
  /** Every significant word of the requirement's name is in the filename, and the format fits. */
  | "exact"
  /** Most of the name matches, or all of it but the format is unexpected. */
  | "likely"
  /** Something overlaps. Never apply without asking. */
  | "guess";

export interface DropMatch {
  requirement: AssetRequirement;
  file: DroppedFile;
  confidence: MatchConfidence;
  /** Why it matched, in words, so a human can disagree with it. */
  why: string;
}

export interface IntakeResult {
  matches: DropMatch[];
  /** Files that answered nothing. */
  unmatched: DroppedFile[];
  /** Requirements still open after intake. */
  stillOpen: AssetRequirement[];
}

/** Words too common to carry any signal in a filename. */
const NOISE = new Set([
  "the", "a", "an", "of", "for", "and", "der", "die", "das", "des", "den", "ein", "eine", "und", "von", "für",
  "asset", "image", "img", "file", "final", "v1", "v2", "v3", "copy", "screenshot", "screen", "shot", "export",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !NOISE.has(t));
}

function extensionOf(name: string): string {
  const match = /\.([a-z0-9]{1,5})$/i.exec(name);
  return match ? match[1]!.toLowerCase() : "";
}

/**
 * Whether the file's extension is one the requirement said it would take.
 *
 * `acceptedFormats` is free text from the model ("SVG", "png", "PNG or SVG"), so this looks for
 * the extension inside the declared formats rather than comparing them as equals. An empty
 * `acceptedFormats` means the requirement did not care.
 */
export function formatAccepted(req: AssetRequirement, name: string): boolean {
  if (req.acceptedFormats.length === 0) return true;
  const ext = extensionOf(name);
  if (!ext) return false;
  return req.acceptedFormats.some((f) => f.toLowerCase().includes(ext));
}

export function scoreMatch(req: AssetRequirement, file: DroppedFile): { confidence: MatchConfidence; why: string } | undefined {
  const wanted = tokens(req.name);
  if (wanted.length === 0) return undefined;
  const got = new Set(tokens(file.name));

  const hit = wanted.filter((w) => got.has(w));
  if (hit.length === 0) return undefined;

  const share = hit.length / wanted.length;
  const formatOk = formatAccepted(req, file.name);
  const matched = `matched ${hit.map((h) => `"${h}"`).join(", ")}`;

  if (share === 1 && formatOk) {
    return { confidence: "exact", why: `${matched}; format fits` };
  }
  if (share === 1) {
    return { confidence: "likely", why: `${matched}, but ${extensionOf(file.name) || "no extension"} is not in ${req.acceptedFormats.join("/")}` };
  }
  if (share >= 0.5 && formatOk) {
    return { confidence: "likely", why: `${matched} of ${wanted.length} words; format fits` };
  }
  return { confidence: "guess", why: `${matched} of ${wanted.length} words${formatOk ? "" : "; format does not fit"}` };
}

const RANK: Record<MatchConfidence, number> = { exact: 3, likely: 2, guess: 1 };

/**
 * Match a drop against the open requirements.
 *
 * Greedy, strongest first, and one file answers at most one requirement — a single PNG cannot be
 * both the product screenshot and the logo, and letting it claim both hides a real gap behind a
 * filled slot.
 */
export function intakeDrops(open: readonly AssetRequirement[], files: readonly DroppedFile[]): IntakeResult {
  const scored: DropMatch[] = [];
  for (const req of open) {
    for (const file of files) {
      const score = scoreMatch(req, file);
      if (score) scored.push({ requirement: req, file, confidence: score.confidence, why: score.why });
    }
  }

  scored.sort((a, b) => RANK[b.confidence] - RANK[a.confidence] || a.requirement.name.localeCompare(b.requirement.name));

  const takenFiles = new Set<string>();
  const takenReqs = new Set<string>();
  const matches: DropMatch[] = [];
  for (const candidate of scored) {
    if (takenFiles.has(candidate.file.path) || takenReqs.has(candidate.requirement.name)) continue;
    takenFiles.add(candidate.file.path);
    takenReqs.add(candidate.requirement.name);
    matches.push(candidate);
  }

  return {
    matches,
    unmatched: files.filter((f) => !takenFiles.has(f.path)),
    stillOpen: open.filter((r) => !takenReqs.has(r.name)),
  };
}

/** What intake did, for a human to confirm or correct. */
export function formatIntake(result: IntakeResult): string {
  const lines: string[] = [];

  if (result.matches.length === 0) lines.push("Nothing matched an open requirement.");
  for (const m of result.matches) {
    const mark = m.confidence === "exact" ? "ok  " : m.confidence === "likely" ? "?   " : "??  ";
    lines.push(`${mark}${m.file.name} -> ${m.requirement.name}  (${m.confidence}: ${m.why})`);
  }

  const needsConfirming = result.matches.filter((m) => m.confidence !== "exact");
  if (needsConfirming.length > 0) {
    lines.push("");
    lines.push(`${needsConfirming.length} match${needsConfirming.length === 1 ? "" : "es"} need confirming before use — a wrong asset fills the slot and passes every later gate.`);
  }

  if (result.unmatched.length > 0) {
    lines.push("");
    lines.push(`Unused: ${result.unmatched.map((f) => f.name).join(", ")}`);
  }

  return lines.join("\n");
}
