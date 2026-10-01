import { createHash } from "node:crypto";
import { SCOPE_GLOBAL, brandScope, type Rule, type RuleKind, type Signal, type Subject, type SubjectType } from "./schema.js";

/**
 * From signals to proposed rules: counting, nothing cleverer.
 *
 * Every signal is a typed fact; a rule is proposed when the facts for one subject (a look, an accent,
 * a pattern…) in one scope (everywhere, or one brand) are strong enough that a person would nod at the
 * sentence. The thresholds are deliberately plain:
 *
 * - **prefer**: used in at least three different reels with no thumbs-down, or at least two thumbs-up
 *   that outnumber the thumbs-down two to one;
 * - **avoid**: at least two thumbs-down and no thumbs-up;
 * - a beat sent back for another render counts a quarter of a thumbs-down, and **can never create a
 *   rule on its own**;
 * - a use that nobody rated counts half a thumbs-up: people leave defaults alone, so a habit is weaker
 *   evidence than a choice.
 *
 * Confidence is the lower bound of a Wilson interval on how much of the evidence is positive (or
 * negative, for avoid), so three agreeing uses read as a hunch and ten as a habit. It halves for every
 * 90 days since the rule's newest evidence, and a rule nobody has reason to believe any more is marked
 * `expired` instead of quietly steering reels for ever. Rules a person wrote, or pinned, are never
 * expired and never have their state changed here; they only have their evidence refreshed.
 */

const HALF_LIFE_DAYS = 90;
const EXPIRE_BELOW = 0.1;
const EVIDENCE_CAP = 50;
/** Weights of the three kinds of evidence. */
const W_HABIT = 0.5;
const W_RERENDER = 0.25;

export function wilsonLower(p: number, n: number, z = 1.2816): number {
  if (n <= 0) return 0;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return Math.max(0, Math.min(1, (c - m) / d));
}

export function decay(confidence: number, lastSeenAt: string, now: Date): number {
  const days = Math.max(0, (now.getTime() - Date.parse(lastSeenAt)) / 86_400_000);
  return confidence * Math.pow(0.5, days / HALF_LIFE_DAYS);
}

export const ruleKey = (r: Pick<Rule, "scope" | "kind" | "subject">): string => `${r.scope}|${r.kind}|${r.subject?.type ?? "-"}|${r.subject?.value ?? "-"}`;

export function stableId(key: string): string {
  return `r_${createHash("sha256").update(key).digest("hex").slice(0, 8)}`;
}

/** The sentence an inferred rule says. Built only from typed values; nothing a person or a page wrote. */
export function templateText(kind: RuleKind, s: Subject): string {
  const v = s.value;
  const prefer = kind === "prefer";
  switch (s.type) {
    case "look": return prefer ? `Prefer the "${v}" look.` : `Avoid the "${v}" look.`;
    case "accent": return prefer ? `Prefer the accent colour ${v}.` : `Avoid the accent colour ${v}.`;
    case "motion": return prefer ? `Prefer ${v} motion.` : `Avoid ${v} motion.`;
    case "pattern": return prefer ? `Reach for the "${v}" pattern when a beat fits it.` : `Avoid the "${v}" pattern.`;
    case "text": return prefer ? `Prefer ${v} on-screen text.` : `Avoid ${v} on-screen text.`;
    case "format": return prefer ? `Prefer the ${v} format.` : `Avoid the ${v} format.`;
    case "sound": return prefer ? `Prefer ${v} for sound effects.` : `Avoid ${v} for sound effects.`;
  }
}

interface Tally {
  kind: RuleKind;
  scope: string;
  subject: Subject;
  reels: Set<string>;
  ups: number;
  downs: number;
  habit: number;
  rerenders: number;
  evidence: { id: string; at: string }[];
}

const subjectKey = (s: Subject): string => `${s.type}|${s.value}`;

/** The scopes a signal counts towards: everywhere, and its own brand when it has one. */
function scopesOf(s: Signal): string[] {
  return s.brand ? [SCOPE_GLOBAL, brandScope(s.brand)] : [SCOPE_GLOBAL];
}

interface ThumbIndex {
  beat: Map<string, "up" | "down">;
  reel: Map<string, "up" | "down" | "mixed">;
  reran: Set<string>;
  thumbIds: Map<string, string>;
}

function indexFeedback(signals: readonly Signal[]): ThumbIndex {
  const beat = new Map<string, "up" | "down">();
  const reel = new Map<string, "up" | "down" | "mixed">();
  const reran = new Set<string>();
  const thumbIds = new Map<string, string>();
  for (const s of signals) {
    if (!s.reel) continue;
    if (s.type === "thumb" && s.beat && s.rating) {
      beat.set(`${s.reel}|${s.beat}`, s.rating);
      thumbIds.set(`${s.reel}|${s.beat}`, s.id);
      const cur = reel.get(s.reel);
      reel.set(s.reel, !cur || cur === s.rating ? s.rating : "mixed");
    }
    if (s.type === "rerender" && s.beat) reran.add(`${s.reel}|${s.beat}`);
  }
  return { beat, reel, reran, thumbIds };
}

function tallyAll(signals: readonly Signal[]): Map<string, Tally> {
  const fb = indexFeedback(signals);
  const tallies = new Map<string, Tally>();
  const seenUnit = new Set<string>();
  const get = (scope: string, subject: Subject, kind: RuleKind): Tally => {
    const key = `${scope}|${kind}|${subjectKey(subject)}`;
    let t = tallies.get(key);
    if (!t) {
      t = { kind, scope, subject, reels: new Set(), ups: 0, downs: 0, habit: 0, rerenders: 0, evidence: [] };
      tallies.set(key, t);
    }
    return t;
  };

  for (const s of signals) {
    if ((s.type !== "used" && s.type !== "choice") || !s.subject || !s.reel) continue;
    const unit = s.beat ? `${s.reel}|${s.beat}` : `${s.reel}|*`;
    const verdict = s.beat ? fb.beat.get(unit) : (() => { const r = fb.reel.get(s.reel!); return r === "mixed" ? undefined : r; })();
    const reran = s.beat ? fb.reran.has(unit) : false;
    for (const scope of scopesOf(s)) {
      const dedupe = `${scope}|${subjectKey(s.subject)}|${unit}`;
      if (seenUnit.has(dedupe)) continue;
      seenUnit.add(dedupe);
      // Each unit is evidence for "prefer"; an avoid tally is built from the same units' thumbs-down.
      const prefer = get(scope, s.subject, "prefer");
      prefer.reels.add(s.reel);
      prefer.evidence.push({ id: s.id, at: s.at });
      const rated = s.beat ? fb.thumbIds.get(unit) : undefined;
      if (rated) prefer.evidence.push({ id: rated, at: s.at });
      if (verdict === "up") prefer.ups += 1;
      else if (verdict === "down") prefer.downs += 1;
      else prefer.habit += 1;
      if (reran) prefer.rerenders += 1;
    }
  }
  return tallies;
}

export interface InferResult {
  rules: Rule[];
}

/**
 * Recompute the rules from the signals, keeping what a person decided.
 *
 * `existing` is the current rule list. Rules a person wrote, pinned, disabled or resolved are
 * returned as they were (only their evidence and confidence move); inferred ones are created,
 * refreshed, expired or dropped to match the evidence.
 */
export function inferRules(signals: readonly Signal[], existing: readonly Rule[], now = new Date()): InferResult {
  const nowIso = now.toISOString();
  const byKey = new Map<string, Rule>();
  for (const r of existing) if (r.subject) byKey.set(ruleKey(r), r);
  const next = new Map<string, Rule>();
  const touched = new Set<string>();

  for (const t of tallyAll(signals).values()) {
    const prefersOk = (t.reels.size >= 3 && t.downs === 0) || (t.ups >= 2 && t.ups >= 2 * t.downs);
    const avoidOk = t.downs >= 2 && t.ups === 0;
    const candidates: { kind: RuleKind; p: number; n: number }[] = [];
    const pos = t.ups + W_HABIT * t.habit;
    const neg = t.downs + W_RERENDER * t.rerenders;
    if (prefersOk) candidates.push({ kind: "prefer", p: pos / (pos + neg), n: pos + neg });
    if (avoidOk) candidates.push({ kind: "avoid", p: neg / (pos + neg), n: pos + neg });

    for (const c of candidates) {
      const key = `${t.scope}|${c.kind}|${subjectKey(t.subject)}`;
      touched.add(key);
      const evidence = [...t.evidence].sort((a, b) => b.at.localeCompare(a.at));
      const lastSeenAt = evidence[0]?.at ?? nowIso;
      const confidence = decay(wilsonLower(c.p, c.n), lastSeenAt, now);
      const ids = [...new Set(evidence.map((e) => e.id))].slice(0, EVIDENCE_CAP);
      const prior = byKey.get(key);
      if (prior) {
        const keep = prior.origin === "user" || prior.pinned || prior.status === "disabled";
        const status = keep ? prior.status : confidence < EXPIRE_BELOW ? "expired" : prior.status === "expired" ? "proposed" : prior.status;
        next.set(key, { ...prior, evidence: ids, confidence: round(confidence), lastSeenAt, status });
      } else if (confidence >= EXPIRE_BELOW) {
        next.set(key, {
          id: stableId(key), kind: c.kind, subject: t.subject, scope: t.scope, status: "proposed", pinned: false, origin: "inferred",
          text: templateText(c.kind, t.subject), evidence: ids, confidence: round(confidence), createdAt: nowIso, lastSeenAt, conflictWith: [],
        });
      }
    }
  }

  // Everything that is not backed by this round of evidence.
  const result: Rule[] = [...next.values()];
  for (const r of existing) {
    const key = r.subject ? ruleKey(r) : undefined;
    if (key && touched.has(key)) continue;
    if (r.origin === "user" || r.pinned || r.status === "disabled") {
      result.push(r);
    } else if (r.status === "proposed") {
      continue; // the evidence went away: so does the proposal
    } else {
      const confidence = decay(r.confidence, r.lastSeenAt, now);
      result.push({ ...r, confidence: round(confidence), status: confidence < EXPIRE_BELOW ? "expired" : r.status });
    }
  }

  // Conflicts: the same subject, preferred and avoided, in the same scope.
  const live = result.filter((r) => r.subject && (r.status === "proposed" || r.status === "active"));
  const groups = new Map<string, Rule[]>();
  for (const r of live) groups.set(`${r.scope}|${subjectKey(r.subject!)}`, [...(groups.get(`${r.scope}|${subjectKey(r.subject!)}`) ?? []), r]);
  for (const r of result) r.conflictWith = [];
  for (const group of groups.values()) {
    const kinds = new Set(group.map((r) => r.kind));
    if (kinds.has("prefer") && kinds.has("avoid")) for (const r of group) r.conflictWith = group.filter((o) => o.id !== r.id && o.kind !== r.kind).map((o) => o.id);
  }

  result.sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
  return { rules: result };
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

export const SUBJECT_ORDER: SubjectType[] = ["look", "accent", "motion", "pattern", "text", "format", "sound"];
