import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod/v3";
import { loadLearnings } from "../learnings/store.js";
import { listRuns } from "../library/runs.js";
import { loadIndex, reelcutHome } from "../library/store.js";
import { TECHNIQUES, techniqueById } from "./catalog.js";
import { parsePath } from "./paths.js";
import { PATTERN_TECHNIQUES } from "./patterns.js";

/**
 * What the owner decided about techniques, kept in ~/.reelcut/taxonomy/store.json:
 *
 * - **patterns**: a pattern's techniques as the owner set them, or Claude's built-in tags once accepted;
 * - **assets**: the techniques a library asset shows (an asset is tagged by Claude or a person);
 * - **pins**: techniques pinned to a Create conversation from the Techniques page.
 *
 * Every beat's own technique lives in its reel.json (`beats[].technique`); ratings live in the learnings. Scores are
 * worked out from those two whenever they are asked for, so nothing here can disagree with them.
 */

const TagSchema = z.object({ techniques: z.array(z.string()).max(12), by: z.enum(["user", "claude"]), state: z.enum(["proposed", "accepted"]).default("accepted"), at: z.string() });
const PinSchema = z.object({ path: z.string(), conversation: z.string().optional(), note: z.string().max(300).optional(), at: z.string() });
const StoreSchema = z.object({
  version: z.literal(1),
  patterns: z.record(TagSchema).default({}),
  assets: z.record(TagSchema).default({}),
  pins: z.array(PinSchema).default([]),
});
export type TaxonomyStore = z.infer<typeof StoreSchema>;
export type Tag = z.infer<typeof TagSchema>;

export class TaxonomyError extends Error {}

export const taxonomyDir = (): string => path.join(reelcutHome(), "taxonomy");
const storeFile = () => path.join(taxonomyDir(), "store.json");

export function loadTaxonomy(): TaxonomyStore {
  try { return StoreSchema.parse(JSON.parse(readFileSync(storeFile(), "utf8"))); } catch { return { version: 1, patterns: {}, assets: {}, pins: [] }; }
}
function saveTaxonomy(s: TaxonomyStore): void {
  mkdirSync(taxonomyDir(), { recursive: true });
  const tmp = `${storeFile()}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 1));
  renameSync(tmp, storeFile());
}

function cleanTechniques(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of ids) {
    const id = raw.trim().toLowerCase();
    if (!id) continue;
    if (!techniqueById(id)) throw new TaxonomyError(`no technique "${id}" (npm run techniques -- list)`);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** A pattern's techniques and where they came from: the owner's, accepted, or Claude's proposal. */
export function patternTags(pattern: string, store = loadTaxonomy()): { techniques: string[]; by: "user" | "claude"; state: "proposed" | "accepted" } | undefined {
  const own = store.patterns[pattern];
  if (own) return { techniques: own.techniques, by: own.by, state: own.state };
  const built = PATTERN_TECHNIQUES[pattern];
  return built ? { techniques: [...built], by: "claude", state: "proposed" } : undefined;
}

/** The patterns' techniques with the owner's changes applied, for `patternsFor`. */
export function patternOverrides(store = loadTaxonomy()): Record<string, string[]> {
  return Object.fromEntries(Object.entries(store.patterns).map(([k, v]) => [k, v.techniques]));
}

export function setPatternTags(pattern: string, techniques: readonly string[], by: "user" | "claude" = "user"): Tag {
  const s = loadTaxonomy();
  const tag: Tag = { techniques: cleanTechniques(techniques), by, state: "accepted", at: new Date().toISOString() };
  s.patterns[pattern] = tag;
  saveTaxonomy(s);
  return tag;
}

/** Accept Claude's built-in tags for a pattern (or every pattern still proposed). */
export function acceptPatternTags(pattern?: string): number {
  const s = loadTaxonomy();
  const ids = pattern ? [pattern] : Object.keys(PATTERN_TECHNIQUES).filter((p) => !s.patterns[p]);
  let n = 0;
  for (const id of ids) {
    const built = PATTERN_TECHNIQUES[id];
    if (!built || s.patterns[id]) continue;
    s.patterns[id] = { techniques: [...built], by: "claude", state: "accepted", at: new Date().toISOString() };
    n++;
  }
  saveTaxonomy(s);
  return n;
}

export function setAssetTags(assetId: string, techniques: readonly string[], by: "user" | "claude"): Tag {
  if (!loadIndex().assets.some((a) => a.id === assetId)) throw new TaxonomyError(`no library asset ${assetId}`);
  const s = loadTaxonomy();
  const tag: Tag = { techniques: cleanTechniques(techniques), by, state: "accepted", at: new Date().toISOString() };
  if (tag.techniques.length) s.assets[assetId] = tag; else delete s.assets[assetId];
  saveTaxonomy(s);
  return tag;
}

export function pinTechnique(pathText: string, conversation?: string, note?: string): void {
  const p = parsePath(pathText);
  if (!p || !techniqueById(p.technique)) throw new TaxonomyError(`not a technique path: ${pathText}`);
  const s = loadTaxonomy();
  s.pins.unshift({ path: `${p.operation}/${p.domain}/${p.technique}/${p.timing}`, ...(conversation ? { conversation } : {}), ...(note ? { note } : {}), at: new Date().toISOString() });
  s.pins = s.pins.slice(0, 200);
  saveTaxonomy(s);
}

// ── beats, ratings and scores

export interface BeatTechnique { run: string; outDir: string; beat: string; technique: string; path: string; why?: string; frame?: string; clip?: string; rating?: "up" | "down" }

/** Every rendered beat that names a technique, with its rating if it has one. Newest runs first. */
export function techniqueBeats(): BeatTechnique[] {
  const ratings = new Map<string, "up" | "down">();
  for (const s of loadLearnings().signals) if (s.type === "thumb" && s.reel && s.beat && s.rating) ratings.set(`${s.reel}|${s.beat}`, s.rating);
  const out: BeatTechnique[] = [];
  for (const run of listRuns()) {
    if (run.missing) continue;
    let beats: { id: string; technique?: string; techniqueWhy?: string }[] = [];
    try { beats = (JSON.parse(readFileSync(run.manifest, "utf8")) as { beats?: typeof beats }).beats ?? []; } catch { continue; }
    const measure = path.join(run.outDir, "measure");
    const shots = existsSync(measure) ? readdirSync(measure).filter((f) => /\.(png|jpe?g)$/.test(f)) : [];
    for (const b of beats) {
      const p = b.technique ? parsePath(b.technique) : undefined;
      if (!p || !techniqueById(p.technique)) continue;
      const frame = shots.filter((f) => f.startsWith(b.id)).sort().at(-1);
      const clip = path.join(run.outDir, "clips", `${b.id}.mp4`);
      out.push({
        run: run.id, outDir: run.outDir, beat: b.id, technique: p.technique, path: b.technique!,
        ...(b.techniqueWhy ? { why: b.techniqueWhy } : {}),
        ...(frame ? { frame: path.join(measure, frame) } : {}),
        ...(existsSync(clip) ? { clip } : {}),
        ...(ratings.has(`${run.id}|${b.id}`) ? { rating: ratings.get(`${run.id}|${b.id}`)! } : {}),
      });
    }
  }
  return out;
}

export interface TechniqueScore { uses: number; up: number; down: number; score: number }

/** Per technique: how often it was used, rated Works and rated down. `score` = up − down. */
export function scoreTechniques(beats = techniqueBeats()): Map<string, TechniqueScore> {
  const out = new Map<string, TechniqueScore>();
  for (const b of beats) {
    const s = out.get(b.technique) ?? { uses: 0, up: 0, down: 0, score: 0 };
    s.uses++;
    if (b.rating === "up") s.up++;
    if (b.rating === "down") s.down++;
    s.score = s.up - s.down;
    out.set(b.technique, s);
  }
  return out;
}

/** The techniques each library asset shows. */
export function assetTechniques(store = loadTaxonomy()): Map<string, string[]> {
  return new Map(Object.entries(store.assets).map(([id, t]) => [id, t.techniques]));
}

export const allTechniqueIds = (): string[] => TECHNIQUES.map((x) => x.id);
