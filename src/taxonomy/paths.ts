import type { BeatKind } from "../personality/styles.js";
import { OPERATIONS, TECHNIQUES, domainById, operationById, techniqueById, timingById, type OperationId, type Technique, type TimingId } from "./catalog.js";
import { PATTERN_TECHNIQUES } from "./patterns.js";

const PATTERN_COUNT = new Map<string, number>();
for (const ts of Object.values(PATTERN_TECHNIQUES)) for (const id of ts) PATTERN_COUNT.set(id, (PATTERN_COUNT.get(id) ?? 0) + 1);

/**
 * A technique path: `operation/domain/technique/timing`, e.g. `differentiate/semantic/semantic-contrast/hold`.
 * Every beat names one in plan.md and reel.json (`beats[].technique`), with why. The timing may be left off
 * (`differentiate/semantic/semantic-contrast`): the technique's own timing is then meant.
 */
export interface TechniquePath { operation: OperationId; domain: string; technique: string; timing: TimingId }

export function parsePath(s: string): TechniquePath | undefined {
  const [operation, domain, technique, timing] = s.trim().toLowerCase().split("/").map((x) => x.trim());
  if (!operation || !domain || !technique) return undefined;
  const tech = techniqueById(technique);
  return { operation: operation as OperationId, domain, technique, timing: (timing || tech?.timing || "build") as TimingId };
}

export const formatPath = (p: TechniquePath): string => `${p.operation}/${p.domain}/${p.technique}/${p.timing}`;

/** What is wrong with a path, if anything. A technique used for an operation it is not listed for is a warning, not an error. */
export function checkPath(s: string): { ok: boolean; errors: string[]; warnings: string[]; path?: TechniquePath } {
  const p = parsePath(s);
  if (!p) return { ok: false, errors: [`"${s}" is not operation/domain/technique[/timing]`], warnings: [] };
  const errors: string[] = [], warnings: string[] = [];
  if (!operationById(p.operation)) errors.push(`no operation "${p.operation}" (${OPERATIONS.map((o) => o.id).join(", ")})`);
  if (!domainById(p.domain)) errors.push(`no domain "${p.domain}"`);
  const tech = techniqueById(p.technique);
  if (!tech) errors.push(`no technique "${p.technique}" (npm run techniques -- list)`);
  else {
    if (tech.domain !== p.domain) errors.push(`"${tech.name}" is in the ${tech.domain} domain, not ${p.domain}`);
    if (!tech.operations.includes(p.operation)) warnings.push(`"${tech.name}" is usually for ${tech.operations.join(" / ")}, not ${p.operation}`);
  }
  if (!timingById(p.timing)) errors.push(`no timing "${p.timing}" (build, snap, hold, morph, rhythm, delay)`);
  return { ok: errors.length === 0, errors, warnings, path: p };
}

export const pathOf = (tech: Technique, operation?: OperationId): TechniquePath =>
  ({ operation: operation && tech.operations.includes(operation) ? operation : tech.operations[0]!, domain: tech.domain, technique: tech.id, timing: tech.timing });

// ── suggesting: what a line wants done, from its kind and its words (English and German)

const CUES: Record<OperationId, RegExp[]> = {
  differentiate: [/\d/, /%|€|\$/, /\b(only|best|first|most|unlike|never|fastest|biggest|stand(s)? out|apart|unique|competitors?|nur|einzig\w*|beste\w*|erste\w*|meiste\w*|schnellste\w*|größte\w*|hervorheben|abheben|konkurren\w*)\b/i],
  group: [/,[^,]+,/, /\b(all|every|together|everything|tools?|features?|integrations?|alle\w*|alles|zusammen|sowie|werkzeuge?|funktionen)\b/i],
  sequence: [/\b(first|then|next|step|after that|finally|once|zuerst|dann|danach|schritt|zum schluss|anschließend|einmal)\b/i, /^\s*\d+[.)]/m],
  infer: [/\b(like a|as if|imagine|feels like|wie ein\w*|stell dir vor|als ob)\b/i],
  reveal: [/\?/, /\b(secret|nobody|no one|here'?s|the trick|turns out|but|niemand|geheim\w*|der trick|aber|fast niemand)\b/i],
  transform: [/\b(instead|no longer|anymore|before|after|old|new|used to|now|replace\w*|from .{1,30} to|statt|nicht mehr|vorher|nachher|früher|jetzt|ersetz\w*|alt\w*|neu\w*|von .{1,30} (zu|bis))\b/i],
};

/** Words that point at one technique in particular (English and German). Each hit adds to it. */
const TECHNIQUE_CUES: Record<string, RegExp> = {
  "real-ui-demo": /\b(app|connector|connect|settings?|dashboard|feature|screen|einstellung\w*|verbind\w*|funktion\w*|oberfläche)\b/i,
  "code-reveal": /\b(code|api|sdk|install\w*|terminal|npm|cli|command|befehl)\b/i,
  "prompt-answer": /\b(ask|prompt|chat|claude|chatgpt|reply|answer|frag\w*|antwort\w*|sag\w*)\b/i,
  "cursor-path": /\b(click|tap|drag|klick\w*|tipp\w*|zieh\w*)\b/i,
  "big-number": /\d[\d.,]*\s*(k|m|%|€|\$|x|follower|users?|kunden|nutzer)?/i,
  "before-after": /\b(before|after|vorher|nachher|früher|jetzt)\b/i,
  "strike-replace": /\b(instead|not .{1,20} but|no longer|statt|nicht mehr|sondern)\b/i,
  "semantic-contrast": /\b(yes|no|vs\.?|versus|old|new|ja|nein|alt|neu)\b/i,
  "rolling-values": /\b(or|any|every|oder|jede\w*|beliebig\w*)\b/i,
  "word-by-word": /\b(why|because|the truth|warum|weil|ehrlich)\b/i,
  "notification-arrival": /\b(post(s|ed|et)?|notif\w*|alert|scheduled|gepostet|benachrichtig\w*|geplant\w*)\b/i,
  "state-toggle": /\b(on|off|switch|toggle|turn on|an|aus|einschalt\w*)\b/i,
  "familiar-format": /\b(top \d|ranking|checklist|countdown|vs|platz \d|liste)\b/i,
  "hub-and-spokes": /\b(integrat\w*|ecosystem|platform|everything|tools|plattform|alles)\b/i,
  "hierarchy-tree": /\b(categor\w*|taxonom\w*|levels?|types of|kategori\w*|ebenen?|arten)\b/i,
  "abundance-wall": /\b(hundreds|thousands|library|collection|hunderte|tausende|sammlung|bibliothek)\b/i,
  "brand-code": /\b(brand|logo|marke)\b/i,
  "odd-one-out": /\b(stand(s)? out|competitors?|crowd|among|unlike|apart|konkurren\w*|abheben|unter vielen)\b/i,
  "colour-isolation": /\b(stand(s)? out|the one|only one|highlight|hervorheben|die eine|nur eine?)\b/i,
  "character-host": /\b(claude|clawd|assistant|agent|helfer)\b/i,
};

const KIND_PRIOR: Record<BeatKind, Partial<Record<OperationId, number>>> = {
  hook: { reveal: 2, differentiate: 1 },
  statement: { infer: 1, differentiate: 1, transform: 0.5 },
  data: { differentiate: 2, group: 0.5 },
  product: { sequence: 2, transform: 0.5 },
  quote: { infer: 1.5, differentiate: 0.5 },
  cta: { differentiate: 2, reveal: 0.5 },
};
const KIND_DOMAINS: Record<BeatKind, string[]> = {
  hook: ["typographic", "semantic", "space"], statement: ["typographic", "semantic"], data: ["typographic", "feature"],
  product: ["interface", "social"], quote: ["cultural", "typographic", "social"], cta: ["cultural", "typographic", "social"],
};

export interface SuggestInput {
  kind?: BeatKind;
  text?: string;
  /** Technique ids the personality prefers, and ones it never uses. */
  favour?: readonly string[];
  ban?: readonly string[];
  /** Learned scores per technique id (positive: rated Works), from `scoreTechniques`. */
  scores?: ReadonlyMap<string, number>;
  /** Techniques used on neighbouring beats: lightly avoided, so a reel varies. */
  recent?: readonly string[];
  /** Only techniques serving this operation, scored as if the line asked for it. */
  focus?: OperationId;
}

export interface Suggestion { path: TechniquePath; technique: Technique; score: number; why: string[] }

export function operationWeights(input: Pick<SuggestInput, "kind" | "text">): Map<OperationId, number> {
  const w = new Map<OperationId, number>(OPERATIONS.map((o) => [o.id, 0]));
  for (const [op, v] of Object.entries(input.kind ? KIND_PRIOR[input.kind] : {})) w.set(op as OperationId, (w.get(op as OperationId) ?? 0) + v);
  const text = input.text ?? "";
  for (const [op, cues] of Object.entries(CUES) as [OperationId, RegExp[]][]) for (const re of cues) if (re.test(text)) w.set(op, (w.get(op) ?? 0) + 1);
  return w;
}

export function suggest(input: SuggestInput, limit = 5): Suggestion[] {
  const weights = operationWeights(input);
  const banned = new Set(input.ban ?? []), favoured = new Set(input.favour ?? []), recent = new Set(input.recent ?? []);
  const domains = input.kind ? KIND_DOMAINS[input.kind] : [];
  const out: Suggestion[] = [];
  for (const tech of TECHNIQUES) {
    if (banned.has(tech.id)) continue;
    const why: string[] = [];
    let best: OperationId = tech.operations[0]!, opScore = -1;
    if (input.focus) {
      const i = tech.operations.indexOf(input.focus);
      if (i < 0) continue;
      best = input.focus; opScore = (i === 0 ? 2.5 : 1.2) + (weights.get(input.focus) ?? 0) * 0.5;
    } else tech.operations.forEach((op, i) => { const s = (weights.get(op) ?? 0) * (i === 0 ? 1 : 0.6); if (s > opScore) { opScore = s; best = op; } });
    let score = opScore;
    if (opScore > 0) why.push(`the line wants to ${operationById(best)!.name.toLowerCase()}`);
    const cue = TECHNIQUE_CUES[tech.id];
    if (cue && input.text && cue.test(input.text)) { score += 0.9; why.push("its words point at it"); }
    score += Math.min(0.2, (PATTERN_COUNT.get(tech.id) ?? 0) * 0.04); // a technique reelcut has patterns for is easier to do well
    const d = domains.indexOf(tech.domain);
    if (d >= 0) { score += 0.6 - d * 0.15; why.push(`${tech.domain} suits a ${input.kind} beat`); }
    if (favoured.has(tech.id)) { score += 1.5; why.push("the personality favours it"); }
    const learned = input.scores?.get(tech.id) ?? 0;
    if (learned) { score += Math.max(-1.5, Math.min(1.5, learned * 0.5)); why.push(learned > 0 ? "rated Works before" : "rated down before"); }
    if (recent.has(tech.id)) { score -= 1.5; why.push("used on a neighbouring beat"); }
    if (score <= 0) continue;
    out.push({ path: pathOf(tech, best), technique: tech, score: Math.round(score * 100) / 100, why });
  }
  return out.sort((a, b) => b.score - a.score || a.technique.id.localeCompare(b.technique.id)).slice(0, limit);
}
