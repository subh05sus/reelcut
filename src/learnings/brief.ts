import { SUBJECT_ORDER } from "./infer.js";
import { SCOPE_GLOBAL, type LearningsFile, type Rule } from "./schema.js";

/**
 * What Claude reads before it composes: the rules that are on, in a short list.
 *
 * Only `active` rules without a conflict are applied. Everything else is counted, not listed, so the
 * brief says how much is waiting for a decision without letting an unreviewed guess steer the reel.
 */

export interface Brief {
  applied: Rule[];
  proposed: number;
  conflicting: Rule[];
  /** The brands whose rules were included, from the flag and from names found in the script. */
  brands: string[];
}

export interface BriefOptions {
  brands?: readonly string[];
  /** The script's text: any brand that has rules and is named in it is included. */
  scriptText?: string;
}

const brandOf = (r: Rule): string | undefined => (r.scope.startsWith("brand:") ? r.scope.slice(6) : undefined);

export function buildBrief(file: LearningsFile, options: BriefOptions = {}): Brief {
  const wanted = new Set((options.brands ?? []).map((b) => b.trim().toLowerCase()).filter(Boolean));
  const script = (options.scriptText ?? "").toLowerCase();
  for (const r of file.rules) {
    const brand = brandOf(r);
    if (brand && script && new RegExp(`(^|[^a-z0-9])${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(script)) wanted.add(brand);
  }
  const inScope = (r: Rule): boolean => r.scope === SCOPE_GLOBAL || (brandOf(r) !== undefined && wanted.has(brandOf(r)!));
  const live = file.rules.filter(inScope);
  return {
    applied: live.filter((r) => r.status === "active" && r.conflictWith.length === 0),
    proposed: live.filter((r) => r.status === "proposed").length,
    conflicting: live.filter((r) => (r.status === "active" || r.status === "proposed") && r.conflictWith.length > 0),
    brands: [...wanted].sort(),
  };
}

const SECTIONS: { title: string; types: readonly (typeof SUBJECT_ORDER)[number][] }[] = [
  { title: "Look, type and palette", types: ["look", "type", "accent"] },
  { title: "Motion and sound", types: ["motion", "sound"] },
  { title: "Patterns and moves", types: ["pattern"] },
  { title: "Learned from your references", types: ["pacing", "ground", "move", "typestyle"] },
  { title: "Format and text", types: ["format", "text"] },
];

const MAX_LINES = 25;

export function formatBrief(brief: Brief): string {
  const lines: string[] = [];
  lines.push("Learned preferences. Apply them unless the invocation or the user says otherwise. They never override");
  lines.push("the reading floor, determinism, hard cuts, or the rules about identity assets.");
  const rank = (a: Rule, b: Rule): number => Number(b.pinned) - Number(a.pinned) || b.confidence - a.confidence;
  const shown = new Set<string>();
  const row = (r: Rule): string => `  ${r.id}  ${r.text}  (${r.scope === SCOPE_GLOBAL ? "everywhere" : `for ${r.scope.slice(6)}`}${r.origin === "user" ? ", yours" : `, ${r.confidence.toFixed(2)}`})`;
  const body: string[] = [];
  for (const section of SECTIONS) {
    const rules = brief.applied.filter((r) => r.subject && section.types.includes(r.subject.type)).sort(rank);
    if (rules.length === 0) continue;
    body.push(section.title);
    for (const r of rules) {
      body.push(row(r));
      shown.add(r.id);
    }
  }
  const notes = brief.applied.filter((r) => r.kind === "note" || !r.subject).sort(rank);
  if (notes.length > 0) {
    body.push("Your notes");
    for (const r of notes) {
      body.push(row(r));
      shown.add(r.id);
    }
  }
  if (body.length === 0) lines.push("", "Nothing learned yet: no active rules.");
  else {
    const room = MAX_LINES - lines.length;
    lines.push("", ...body.slice(0, room));
    if (body.length > room) lines.push(`  … ${body.length - room} more lines; run \`npm run learnings -- list\``);
  }
  const waiting: string[] = [];
  if (brief.proposed > 0) waiting.push(`${brief.proposed} proposed (review them in the studio)`);
  if (brief.conflicting.length > 0) waiting.push(`${brief.conflicting.length} in conflict (resolve in the studio)`);
  if (waiting.length > 0) lines.push("", `Not applied: ${waiting.join(", ")}.`);
  if (brief.applied.length > 0) lines.push("", 'Record the ids you applied in reel.json as "appliedLearnings": [...] and list them under "Applied learnings" in plan.md.');
  return lines.join("\n");
}
