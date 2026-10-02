import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { LibraryError, readValidated, reelcutHome, withLock, writeAtomic } from "../library/store.js";
import { inferRules, ruleKey, templateText } from "./infer.js";
import { LearningsFileSchema, RuleSchema, SCOPE_GLOBAL, SignalSchema, brandScope, type LearningsFile, type Rule, type RuleStatus, type Signal, type Subject } from "./schema.js";

/**
 * `~/.reelcut/learnings.json`: signals, rules, and the tag statistics.
 *
 * Written the way the library is — read, change, write under a lock, via a temp file — because a
 * render recording what it used and a person editing a rule in the dashboard are two writers on one
 * file, and a half-written file would lose every rule at once.
 */

export const MAX_SIGNALS = 5000;

function learningsPath(): string {
  return path.join(reelcutHome(), "learnings.json");
}

const empty = (): LearningsFile => ({ version: 1, signals: [], rules: [], tagStats: {} });

export function loadLearnings(): LearningsFile {
  return readValidated(learningsPath(), (raw) => LearningsFileSchema.safeParse(raw), empty());
}

/** Read-modify-write under the lock. */
export function mutateLearnings<T>(fn: (file: LearningsFile) => T): T {
  return withLock(`${learningsPath()}.lock`, () => {
    const file = loadLearnings();
    const result = fn(file);
    writeAtomic(learningsPath(), `${JSON.stringify(file, null, 2)}\n`);
    return result;
  });
}

/** A signal id that is the same for the same fact, so re-rendering a reel replaces what it said before. */
export function signalId(...parts: (string | undefined)[]): string {
  return `s_${createHash("sha256").update(parts.map((p) => p ?? "").join("|")).digest("hex").slice(0, 12)}`;
}

/**
 * Record signals, then recompute the rules from all of them.
 *
 * A signal with an id already present replaces the old one (a thumb changed, a beat re-rendered with a
 * different look). The oldest signals are dropped past the cap; a rule that loses all its evidence
 * that way expires on its own.
 */
export function recordSignals(signals: readonly Signal[], now = new Date()): LearningsFile {
  const clean = signals.map((s) => SignalSchema.parse(s));
  return mutateLearnings((file) => {
    const byId = new Map(file.signals.map((s) => [s.id, s]));
    for (const s of clean) {
      byId.set(s.id, s);
      if (s.type === "asset" && s.tag && s.outcome) {
        const stat = file.tagStats[s.tag] ?? { accepted: 0, rejected: 0 };
        if (s.outcome === "accepted") stat.accepted += 1;
        else stat.rejected += 1;
        file.tagStats[s.tag] = stat;
      }
    }
    file.signals = [...byId.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-MAX_SIGNALS);
    file.rules = inferRules(file.signals, file.rules, now).rules;
    return file;
  });
}

/**
 * Replace every reference signal with a fresh set, then recompute the rules.
 *
 * Reference signals are never typed or accumulated: they are a pure function of the references on file
 * (which are included, what was measured, what a person accepted). So when a reference is added, edited,
 * excluded or deleted, the whole set is rebuilt, and a reference that is gone leaves no evidence behind.
 */
export function syncReferenceSignals(signals: readonly Signal[], now = new Date()): LearningsFile {
  const clean = signals.map((s) => SignalSchema.parse(s));
  return mutateLearnings((file) => {
    file.signals = [...file.signals.filter((s) => s.type !== "reference"), ...clean].sort((a, b) => a.at.localeCompare(b.at)).slice(-MAX_SIGNALS);
    file.rules = inferRules(file.signals, file.rules, now).rules;
    return file;
  });
}

/** Recompute the rules from what is already recorded (decay moves with the clock, not with signals). */
export function reinfer(now = new Date()): LearningsFile {
  return mutateLearnings((file) => {
    file.rules = inferRules(file.signals, file.rules, now).rules;
    return file;
  });
}

/** Auto-tags a person has removed at least twice and never kept: not suggested again. */
export function suppressedTags(file = loadLearnings()): Set<string> {
  return new Set(Object.entries(file.tagStats).filter(([, s]) => s.rejected >= 2 && s.accepted === 0).map(([tag]) => tag));
}

// ---------------------------------------------------------------- what a person does to rules

const clip = (text: string): string => text.replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);

export interface NewRule {
  kind?: "prefer" | "avoid" | "note";
  subject?: Subject;
  scope?: string;
  text?: string;
  brand?: string;
}

/** A rule a person writes: live at once, never expired, whatever the evidence says. */
export function createRule(input: NewRule, now = new Date()): Rule {
  const kind = input.kind ?? (input.subject ? "prefer" : "note");
  const scope = input.brand ? brandScope(input.brand) : (input.scope ?? SCOPE_GLOBAL);
  const text = clip(input.text ?? (input.subject && kind !== "note" ? templateText(kind, input.subject) : ""));
  if (!text) throw new LibraryError("a rule needs some text");
  if (kind !== "note" && !input.subject) throw new LibraryError("a prefer or avoid rule needs a subject (a look, an accent, a pattern…)");
  const rule = RuleSchema.parse({
    id: `u_${randomBytes(4).toString("hex")}`,
    kind,
    ...(input.subject ? { subject: input.subject } : {}),
    scope,
    status: "active",
    pinned: false,
    origin: "user",
    text,
    evidence: [],
    confidence: 1,
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    conflictWith: [],
  });
  return mutateLearnings((file) => {
    if (rule.subject && file.rules.some((r) => ruleKey(r) === ruleKey(rule))) {
      // The inferred rule already exists: the person's decision adopts it rather than duplicating it.
      const existing = file.rules.find((r) => ruleKey(r) === ruleKey(rule))!;
      existing.origin = "user";
      existing.status = "active";
      existing.text = rule.text;
      file.rules = inferRules(file.signals, file.rules, now).rules;
      return file.rules.find((r) => r.id === existing.id)!;
    }
    file.rules.push(rule);
    file.rules = inferRules(file.signals, file.rules, now).rules;
    return file.rules.find((r) => r.id === rule.id)!;
  });
}

export interface RulePatch {
  status?: RuleStatus;
  pinned?: boolean;
  /** Editing the text makes the rule the person's own. */
  text?: string;
  scope?: string;
}

export function updateRule(id: string, patch: RulePatch, now = new Date()): Rule {
  return mutateLearnings((file) => {
    const rule = file.rules.find((r) => r.id === id);
    if (!rule) throw new LibraryError(`no rule ${id}`);
    if (patch.status !== undefined) rule.status = patch.status;
    if (patch.pinned !== undefined) rule.pinned = patch.pinned;
    if (patch.scope !== undefined) {
      if (!/^(global|brand:[a-z0-9][a-z0-9 ._-]{0,59})$/.test(patch.scope)) throw new LibraryError("scope must be global or brand:<name>");
      rule.scope = patch.scope;
    }
    if (patch.text !== undefined) {
      const text = clip(patch.text);
      if (!text) throw new LibraryError("a rule needs some text");
      rule.text = text;
      rule.origin = "user";
    }
    file.rules = inferRules(file.signals, file.rules, now).rules;
    return file.rules.find((r) => r.id === id)!;
  });
}

export function deleteRule(id: string): void {
  mutateLearnings((file) => {
    const at = file.rules.findIndex((r) => r.id === id);
    if (at < 0) throw new LibraryError(`no rule ${id}`);
    file.rules.splice(at, 1);
  });
}

/** Turn something a person wrote on a beat into a rule — with their words, which they can edit first. */
export function promoteNote(signalIdValue: string, text: string | undefined, brand?: string): Rule {
  const signal = loadLearnings().signals.find((s) => s.id === signalIdValue);
  if (!signal?.note) throw new LibraryError("that signal has no note to promote");
  return createRule({ kind: "note", text: text ?? signal.note, ...(brand ? { brand } : {}) });
}

// ---------------------------------------------------------------- moving them between machines

export interface Exported {
  version: 1;
  exportedAt: string;
  rules: Rule[];
  tagStats: LearningsFile["tagStats"];
}

/** Rules and tag statistics only: the raw signals, with their notes and reel ids, stay on this machine. */
export function exportLearnings(now = new Date()): Exported {
  const file = loadLearnings();
  return { version: 1, exportedAt: now.toISOString(), rules: file.rules, tagStats: file.tagStats };
}

/**
 * Bring rules in from a file.
 *
 * A file is somebody's text, so nothing in it is trusted: every rule is validated, its text
 * re-cleaned, inferred rules arrive as `proposed` (to be read before they apply) and only rules a
 * person wrote keep an `active` state — and even those only when the file says so about a rule that
 * has `origin: user`. Ids that already exist here are replaced, not duplicated.
 */
export function importLearnings(data: unknown, mode: "merge" | "replace" = "merge", now = new Date()): { added: number; replaced: number; skipped: number } {
  const incoming = typeof data === "object" && data !== null ? (data as { rules?: unknown; tagStats?: unknown }) : {};
  if (!Array.isArray(incoming.rules)) throw new LibraryError("not a reelcut learnings export: no rules");
  let skipped = 0;
  const rules: Rule[] = [];
  for (const raw of incoming.rules.slice(0, 500)) {
    const parsed = RuleSchema.safeParse(raw);
    if (!parsed.success) {
      skipped += 1;
      continue;
    }
    const r = parsed.data;
    rules.push({ ...r, text: clip(r.text), status: r.origin === "user" ? r.status : r.status === "disabled" ? "disabled" : "proposed", conflictWith: [] });
  }
  return mutateLearnings((file) => {
    let added = 0;
    let replaced = 0;
    if (mode === "replace") file.rules = [];
    for (const r of rules) {
      const at = file.rules.findIndex((x) => x.id === r.id);
      if (at >= 0) {
        file.rules[at] = r;
        replaced += 1;
      } else {
        file.rules.push(r);
        added += 1;
      }
    }
    const stats = incoming.tagStats;
    if (typeof stats === "object" && stats !== null) {
      for (const [tag, v] of Object.entries(stats as Record<string, { accepted?: number; rejected?: number }>).slice(0, 2000)) {
        const cur = file.tagStats[tag] ?? { accepted: 0, rejected: 0 };
        file.tagStats[tag] = { accepted: cur.accepted + Math.max(0, Math.floor(v.accepted ?? 0)), rejected: cur.rejected + Math.max(0, Math.floor(v.rejected ?? 0)) };
      }
    }
    file.rules = inferRules(file.signals, file.rules, now).rules;
    return { added, replaced, skipped };
  });
}
