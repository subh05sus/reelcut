import { loadIndex } from "../library/store.js";
import { DOMAINS, OPERATIONS, TECHNIQUES, TIMINGS, techniqueById } from "./catalog.js";
import { operationWeights, suggest, type SuggestInput, type Suggestion } from "./paths.js";
import { patternsFor } from "./patterns.js";
import { PLAIN } from "./plain.js";
import { assetTechniques, loadTaxonomy, patternOverrides, patternTags, scoreTechniques, techniqueBeats, type BeatTechnique, type TechniqueScore } from "./store.js";

/**
 * Execution, the last level: for a technique, where it has actually been done. The built-in patterns that perform it,
 * the beats of your reels that named it (rated Works first), and the library assets tagged with it.
 */
export interface Examples {
  patterns: { id: string; state: "proposed" | "accepted"; by: "user" | "claude" }[];
  beats: BeatTechnique[];
  assets: { id: string; name: string; mediaType: string }[];
}

export function examplesFor(techniqueId: string, ctx = context()): Examples {
  const store = ctx.store;
  const patterns = patternsFor(techniqueId, patternOverrides(store)).map((id) => { const t = patternTags(id, store)!; return { id, state: t.state, by: t.by }; });
  const rank = (b: BeatTechnique) => (b.rating === "up" ? 0 : b.rating === undefined ? 1 : 2);
  const beats = ctx.beats.filter((b) => b.technique === techniqueId).sort((a, b) => rank(a) - rank(b));
  const assets = [...ctx.assetTags.entries()].filter(([, ts]) => ts.includes(techniqueId))
    .map(([id]) => ctx.assets.get(id)).filter((a): a is NonNullable<typeof a> => !!a && a.review.state !== "rejected")
    .map((a) => ({ id: a.id, name: a.name, mediaType: a.mediaType }));
  return { patterns, beats, assets };
}

/** Everything the examples need, read once. */
export function context() {
  const store = loadTaxonomy();
  const beats = techniqueBeats();
  return { store, beats, scores: scoreTechniques(beats), assetTags: assetTechniques(store), assets: new Map(loadIndex().assets.map((a) => [a.id, a])) };
}

/** The whole catalog with its examples and scores: what the studio's Techniques page draws. */
export function catalogJson() {
  const ctx = context();
  return {
    operations: OPERATIONS, domains: DOMAINS, timings: TIMINGS,
    techniques: TECHNIQUES.map((t) => {
      const ex = examplesFor(t.id, ctx);
      return { ...t, plain: PLAIN[t.id]?.plain ?? t.does, sample: PLAIN[t.id]?.sample ?? t.name, score: ctx.scores.get(t.id) ?? { uses: 0, up: 0, down: 0, score: 0 }, examples: ex };
    }),
    proposedPatterns: Object.keys(Object.fromEntries(TECHNIQUES.flatMap((t) => examplesFor(t.id, ctx).patterns.filter((p) => p.state === "proposed").map((p) => [p.id, 1])))).sort(),
    pins: ctx.store.pins.slice(0, 30),
    credit: "Inspired by Iris™, A Taxonomy of Visuals, by Modern Art Direction (visuals.modernartdirection.com). Our own catalog, in our own words.",
  };
}

export interface Idea { operation: string; why: string; suggestions: (Suggestion & { examples: Examples; learned?: TechniqueScore })[] }

/**
 * From a brief or a campaign's big idea to visual directions: the operations its words call for (or, with no
 * cue at all, a spread of Differentiate, Reveal and Transform), each with its best techniques and their examples.
 */
export function ideasFor(brief: string, input: Omit<SuggestInput, "text" | "kind"> = {}, perOperation = 2, operations = 3): Idea[] {
  const ctx = context();
  const weights = [...operationWeights({ text: brief }).entries()].sort((a, b) => b[1] - a[1]);
  const picked = weights.filter(([, w]) => w > 0).slice(0, operations).map(([op]) => op);
  for (const fill of ["differentiate", "reveal", "transform", "infer"] as const) if (picked.length < operations && !picked.includes(fill)) picked.push(fill);
  return picked.map((op) => {
    const all = suggest({ ...input, text: brief, focus: op, scores: new Map([...ctx.scores].map(([k, v]) => [k, v.score])) }, perOperation)
      .map((s) => ({ ...s, path: { ...s.path, operation: op }, examples: examplesFor(s.technique.id, ctx), ...(ctx.scores.get(s.technique.id) ? { learned: ctx.scores.get(s.technique.id)! } : {}) }));
    const def = OPERATIONS.find((o) => o.id === op)!;
    return { operation: op, why: (weights.find(([o]) => o === op)?.[1] ?? 0) > 0 ? `the brief asks to ${def.name.toLowerCase()}: ${def.does.toLowerCase()}` : `a direction worth trying: ${def.does.toLowerCase()}`, suggestions: all };
  });
}

export const describeTechnique = (id: string): string => {
  const t = techniqueById(id);
  if (!t) return `no technique ${id}`;
  return `${t.name} (${t.domain}; ${t.operations.join(", ")}; plays ${t.timing}): ${t.does} Use it for ${t.when}.`;
};
