import type { LibraryAsset } from "../library/schema.js";
import { signalId } from "./store.js";
import { SubjectSchema, type Signal, type Subject, type SubjectType } from "./schema.js";

/**
 * Where signals come from. Each builder turns something that happened — a render, a thumb, an edit —
 * into typed facts, and drops anything that is not a plain value rather than storing it.
 */

export function subjectOf(type: SubjectType, value: string | undefined): Subject | undefined {
  if (value === undefined) return undefined;
  const v = type === "accent" ? value.trim().toLowerCase() : value.trim();
  const parsed = SubjectSchema.safeParse({ type, value: v });
  return parsed.success ? parsed.data : undefined;
}

export interface BeatUse {
  id: string;
  look?: string | undefined;
  accent?: string | undefined;
  pattern?: string | undefined;
  motion?: string | undefined;
}

/** The choices made in Step 0, as the render finds them in the manifest. */
export interface Choices {
  text?: string | undefined;
  motion?: string | undefined;
  format?: string | undefined;
  /** "effects" when the reel was rendered with sound effects, "silent" otherwise. */
  sound?: string | undefined;
  look?: string | undefined;
}

export function usedSignals(args: { reel: string; brand?: string | undefined; choices?: Choices | undefined; beats: readonly BeatUse[]; at: string }): Signal[] {
  const out: Signal[] = [];
  const base = { reel: args.reel, at: args.at, ...(args.brand ? { brand: args.brand.toLowerCase().slice(0, 60) } : {}) };
  const push = (type: Signal["type"], subject: Subject | undefined, beat?: string): void => {
    if (!subject) return;
    out.push({ ...base, id: signalId(type, args.reel, beat, subject.type, subject.value), type, subject, ...(beat ? { beat } : {}) });
  };
  for (const [key, value] of Object.entries(args.choices ?? {}) as [keyof Choices, string | undefined][]) {
    push("choice", subjectOf(key as SubjectType, value));
  }
  for (const b of args.beats) {
    push("used", subjectOf("look", b.look), b.id);
    push("used", subjectOf("accent", b.accent), b.id);
    push("used", subjectOf("pattern", b.pattern), b.id);
    push("used", subjectOf("motion", b.motion), b.id);
  }
  return out;
}

export function thumbSignal(args: { reel: string; beat: string; rating: "up" | "down"; note?: string | undefined; brand?: string | undefined; at: string }): Signal {
  return {
    id: signalId("thumb", args.reel, args.beat),
    type: "thumb",
    reel: args.reel,
    beat: args.beat,
    rating: args.rating,
    ...(args.note?.trim() ? { note: args.note.trim().slice(0, 500) } : {}),
    ...(args.brand ? { brand: args.brand.toLowerCase().slice(0, 60) } : {}),
    at: args.at,
  };
}

/** A note on its own, with no thumb: stored against the beat for the dashboard, and a candidate to promote. */
export function noteSignal(args: { reel: string; beat: string; note: string; at: string }): Signal {
  return { id: signalId("note", args.reel, args.beat), type: "thumb", reel: args.reel, beat: args.beat, note: args.note.trim().slice(0, 500), at: args.at };
}

export function rerenderSignal(args: { reel: string; beat: string; at: string }): Signal {
  return { id: signalId("rerender", args.reel, args.beat), type: "rerender", reel: args.reel, beat: args.beat, at: args.at };
}

/**
 * What a person did with machine-written tags on one asset.
 *
 * Approving keeps the machine's tags that are still there: each is an acceptance. Taking a tag away
 * that a machine wrote is a rejection. Tags the person typed say nothing about the machine.
 */
export function assetSignals(args: { before?: LibraryAsset | undefined; after: LibraryAsset; accepted?: readonly string[]; at: string }): Signal[] {
  const out: Signal[] = [];
  const machine = (a: LibraryAsset, t: string): boolean => (a.tagOrigin[t] ?? "user") !== "user";
  const push = (tag: string, outcome: "accepted" | "rejected"): void => {
    out.push({ id: signalId("asset", args.after.id, tag, outcome), type: "asset", tag: tag.slice(0, 40), outcome, at: args.at });
  };
  if (args.before) for (const t of args.before.tags) if (machine(args.before, t) && !args.after.tags.includes(t)) push(t, "rejected");
  for (const t of args.accepted ?? []) push(t, "accepted");
  return out;
}
