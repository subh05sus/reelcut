import { z } from "zod";
import { GROUNDS, MOVES, PACING, TEXT_STYLES } from "../references/vocab.js";

/**
 * What the studio remembers about your taste.
 *
 * There is no model to train here. What makes a reel better the tenth time is that Claude starts it
 * already knowing what you kept, what you sent back and what you said, in a form you can read and
 * correct. So the unit is a **rule** — one sentence, a scope, a state, and the evidence behind it —
 * and a rule only reaches Claude once it is `active`.
 *
 * ## Why signals are structured and rules are templated
 *
 * A signal is a fact with a typed subject: "reel R, beat 3, used the `cool` look", "thumbs up on reel R,
 * beat 3". The text of an inferred rule is a template filled with those typed values, and a value that
 * is not a plain word is dropped. Free text — a script line, a page title, a note someone typed — is
 * never promoted into a rule on its own. That is what keeps a sentence found in an untrusted place from
 * becoming an instruction Claude follows in every later reel. A person can write any rule they like,
 * because a person wrote it.
 */

export const SubjectTypeSchema = z.enum(["look", "accent", "motion", "pattern", "text", "format", "sound", "pacing", "ground", "move", "typestyle"]);
export type SubjectType = z.infer<typeof SubjectTypeSchema>;

/** Values are plain tokens — no spaces, nothing that can carry a sentence. */
export const SubjectValueSchema = z.string().min(1).max(40).regex(/^[A-Za-z0-9#][A-Za-z0-9#._:/+-]*$/);

/** What each kind of subject may be. A value outside its list is not a fact about taste; it is noise or an attack. */
const ALLOWED: Record<SubjectType, (v: string) => boolean> = {
  look: (v) => ["paper", "ink", "flood", "sky", "cinema", "poster", "cool"].includes(v),
  accent: (v) => /^#[0-9a-f]{3,8}$/.test(v),
  motion: (v) => ["restrained", "default", "energetic"].includes(v),
  text: (v) => ["full", "key-lines", "minimal", "none"].includes(v),
  format: (v) => ["1:1", "9:16", "16:9", "4:5"].includes(v),
  sound: (v) => ["effects", "silent"].includes(v),
  pattern: (v) => /^[a-z][a-z0-9-]{1,40}$/.test(v),
  // What references teach. Each is one of a short fixed list, so a word found in somebody's film cannot become one.
  pacing: (v) => (PACING as readonly string[]).includes(v),
  ground: (v) => (GROUNDS as readonly string[]).includes(v),
  move: (v) => (MOVES as readonly string[]).includes(v),
  typestyle: (v) => (TEXT_STYLES as readonly string[]).includes(v),
};

export const SubjectSchema = z
  .object({ type: SubjectTypeSchema, value: SubjectValueSchema })
  .refine((s) => ALLOWED[s.type](s.value), { message: "that value is not one this kind of subject can have" });
export type Subject = { type: SubjectType; value: string };

export const SignalTypeSchema = z.enum([
  /** What a beat was made with: look, accent, pattern, motion. Recorded by the render. */
  "used",
  /** A reel-level choice from Step 0: text density, format, motion, sound. */
  "choice",
  /** A thumb on a beat, from the dashboard. */
  "thumb",
  /** A beat sent back for another render. A weak "not quite". */
  "rerender",
  /** What a person did with a machine-written tag: accepted it by approving the asset, or removed it. */
  "asset",
  /** A fact measured from, or reviewed on, a reference video. Recomputed from the references, never typed. */
  "reference",
]);
export type SignalType = z.infer<typeof SignalTypeSchema>;

export const SignalSchema = z.object({
  id: z.string(),
  type: SignalTypeSchema,
  subject: SubjectSchema.optional(),
  /** Lowercased brand or product the reel was about; scopes a rule to it. */
  brand: z.string().max(60).optional(),
  reel: z.string().optional(),
  beat: z.string().optional(),
  /** For `reference` signals: the reference it came from. */
  reference: z.string().max(40).optional(),
  rating: z.enum(["up", "down"]).optional(),
  /** What a person wrote about a beat. Shown in the dashboard, never turned into a rule by itself. */
  note: z.string().max(500).optional(),
  /** For `asset` signals. */
  tag: z.string().max(40).optional(),
  outcome: z.enum(["accepted", "rejected"]).optional(),
  at: z.string(),
});
export type Signal = z.infer<typeof SignalSchema>;

export const RuleKindSchema = z.enum([
  "prefer",
  "avoid",
  /** Free guidance a person wrote: "never more than two accent colours". Only ever user-origin. */
  "note",
]);
export type RuleKind = z.infer<typeof RuleKindSchema>;

/** `proposed` is not read by Claude. `active` is. */
export const RuleStatusSchema = z.enum(["proposed", "active", "disabled", "expired"]);
export type RuleStatus = z.infer<typeof RuleStatusSchema>;

export const RuleSchema = z.object({
  id: z.string(),
  kind: RuleKindSchema,
  subject: SubjectSchema.optional(),
  /** `global`, or `brand:<name>`. */
  scope: z.string().regex(/^(global|brand:[a-z0-9][a-z0-9 ._-]{0,59})$/),
  status: RuleStatusSchema,
  pinned: z.boolean().default(false),
  origin: z.enum(["inferred", "user"]),
  text: z.string().min(1).max(240),
  /** Signal ids, newest first. May name signals that have since been dropped from the cap. */
  evidence: z.array(z.string()).default([]),
  /** 0 to 1. A Wilson lower bound on how sure the evidence is, halved every 90 days it is not seen again. */
  confidence: z.number().min(0).max(1).default(0),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  /** Other rules, in the same scope, that say the opposite. Neither is applied until a person resolves it. */
  conflictWith: z.array(z.string()).default([]),
});
export type Rule = z.infer<typeof RuleSchema>;

export const TagStatSchema = z.object({ accepted: z.number().int().default(0), rejected: z.number().int().default(0) });
export type TagStat = z.infer<typeof TagStatSchema>;

export const LearningsFileSchema = z.object({
  version: z.literal(1),
  signals: z.array(SignalSchema).default([]),
  rules: z.array(RuleSchema).default([]),
  /** Per tag: how often a person kept a machine's suggestion, and how often they removed it. */
  tagStats: z.record(TagStatSchema).default({}),
});
export type LearningsFile = z.infer<typeof LearningsFileSchema>;

export const SCOPE_GLOBAL = "global";
export const brandScope = (brand: string): string => `brand:${brand.trim().toLowerCase().replace(/[^a-z0-9 ._-]+/g, "").slice(0, 60)}`;
