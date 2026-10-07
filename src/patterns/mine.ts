import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { reelcutHome } from "../library/store.js";

/**
 * Your own patterns: beats you rated "Works", kept so the next reel can start from them.
 *
 * The built-in patterns (`assets/patterns/`) are what reelcut knows looks good. These are what *you* kept. A beat
 * rated up in the studio is saved here as it was composed, with its composition id renamed to the pattern's, and a
 * header listing its **slots**: the words, numbers, library assets and recordings that belong to that reel and
 * have to be replaced. The layout, motion and timing stay. Step 4 offers them beside the built-ins, best first.
 *
 * Rating the same beat down takes its pattern away again, unless you have renamed or tagged it since: then it
 * is yours on purpose.
 */

export const PatternSlotSchema = z.object({
  kind: z.enum(["text", "number", "asset", "footage"]),
  /** What it is now: the words, the number, or the library reference. */
  value: z.string().max(200),
});
export type PatternSlot = z.infer<typeof PatternSlotSchema>;

export const PersonalPatternSchema = z.object({
  id: z.string().regex(/^mine-[0-9a-f]{8}$/),
  name: z.string().min(1).max(80),
  tags: z.array(z.string()).default([]),
  from: z.object({ run: z.string(), beat: z.string(), outDir: z.string() }),
  look: z.string().optional(),
  type: z.string().optional(),
  /** The built-in pattern the beat was itself adapted from, if any. */
  basedOn: z.string().optional(),
  format: z.string().optional(),
  durationSeconds: z.number().positive().optional(),
  slots: z.array(PatternSlotSchema).default([]),
  savedAt: z.string(),
  /** A person renamed or tagged it: rating the source beat down no longer removes it. */
  kept: z.boolean().default(false),
  /** Reels that started from it, and how their beats were rated. Ranks it in Step 4. */
  uses: z.number().int().nonnegative().default(0),
  likes: z.number().int().nonnegative().default(0),
  dislikes: z.number().int().nonnegative().default(0),
});
export type PersonalPattern = z.infer<typeof PersonalPatternSchema>;

const IndexSchema = z.object({ version: z.literal(1), patterns: z.array(PersonalPatternSchema) });

export function patternsDir(): string {
  return path.join(reelcutHome(), "patterns");
}
const indexFile = () => path.join(patternsDir(), "index.json");
export const patternHtmlPath = (id: string): string => path.join(patternsDir(), `${id}.html`);
export const patternThumbPath = (id: string): string => path.join(patternsDir(), `${id}.jpg`);

export function loadPatterns(): PersonalPattern[] {
  try {
    return IndexSchema.parse(JSON.parse(readFileSync(indexFile(), "utf8"))).patterns;
  } catch {
    return [];
  }
}

function savePatterns(patterns: PersonalPattern[]): void {
  mkdirSync(patternsDir(), { recursive: true });
  const tmp = `${indexFile()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ version: 1, patterns }, null, 2)}\n`);
  renameSync(tmp, indexFile());
}

/** Best first: what your reels kept, then what they used, then the newest. */
export function rankPatterns(patterns: readonly PersonalPattern[]): PersonalPattern[] {
  return [...patterns].sort((a, b) => b.likes - b.dislikes - (a.likes - a.dislikes) || b.uses - a.uses || b.savedAt.localeCompare(a.savedAt));
}

/** A personal pattern's id is fixed by where it came from, so rating the same beat again updates it. */
export function patternIdFor(outDir: string, beat: string): string {
  return `mine-${createHash("sha256").update(`${path.resolve(outDir)}\0${beat}`).digest("hex").slice(0, 8)}`;
}

// ---------------------------------------------------------------- slots

const VISIBLE_TEXT = />([^<>]*[\p{L}\p{N}][^<>]*)</gu;

/**
 * What in a composition belongs to its reel: visible words and numbers (outside `<style>` and `<script>`), library
 * assets and recordings. Deduplicated, in the order they appear.
 */
export function findSlots(html: string): PatternSlot[] {
  const out: PatternSlot[] = [];
  const seen = new Set<string>();
  const add = (kind: PatternSlot["kind"], value: string) => {
    const v = value.replace(/\s+/g, " ").trim().slice(0, 200);
    const key = `${kind}\0${v}`;
    if (!v || seen.has(key)) return;
    seen.add(key);
    out.push({ kind, value: v });
  };
  const markup = html.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  for (const m of markup.matchAll(VISIBLE_TEXT)) {
    const text = m[1]!.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
    if (!text) continue;
    add(/^[-+]?[\d.,]+\s*[%€$kKmMxX+]?$/.test(text) ? "number" : "text", text);
  }
  // Numbers a script writes in: RC.count(tl, el, at, { to: 20 }) and the like.
  for (const m of html.matchAll(/\b(?:to|from|value)\s*:\s*(-?\d+(?:\.\d+)?)/g)) add("number", m[1]!);
  for (const m of html.matchAll(/assets\/library\/([0-9a-f]{16}(?:\.[a-z0-9]+)?)/gi)) add("asset", `assets/library/${m[1]}`);
  for (const m of html.matchAll(/data-footage\s*=\s*["']([^"']+)["']/gi)) add("footage", m[1]!);
  return out;
}

/** The composition as a pattern: its id renamed, and a header saying what it is and what to replace. */
export function asPattern(html: string, beat: string, p: Pick<PersonalPattern, "id" | "name" | "from" | "slots" | "basedOn">): string {
  const re = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const renamed = html
    .replace(new RegExp(`(data-composition-id\\s*=\\s*["'])${re(beat)}(["'])`, "g"), `$1${p.id}$2`)
    .replace(new RegExp(`(__timelines\\s*\\[\\s*["'])${re(beat)}(["']\\s*\\])`, "g"), `$1${p.id}$2`);
  const slotLines = p.slots.map((s) => `  - ${s.kind.padEnd(7)} ${s.value.replace(/--/g, "- -")}`).join("\n");
  const header = `<!--
  YOUR PATTERN: "${p.name.replace(/--/g, "- -")}" (${p.id}). Rated "Works" in reel ${p.from.run}, beat ${p.from.beat}${p.basedOn ? `, itself adapted from ${p.basedOn}` : ""}.
  Keep the layout, the motion and the timing; replace what belongs to that reel. Rename the composition id and the
  timeline key from ${p.id} to the new beat's id. Slots:
${slotLines || "  (none found)"}
-->
`;
  return /<template[\s>]/i.test(renamed) ? renamed.replace(/<template/i, `${header}<template`) : `${header}${renamed}`;
}

// ---------------------------------------------------------------- saving and removing

export interface SaveInput {
  run: string;
  outDir: string;
  beat: string;
  html: string;
  /** The rendered clip, for the thumbnail. */
  clip?: string;
  look?: string;
  type?: string;
  basedOn?: string;
  format?: string;
  durationSeconds?: number;
}

/** A readable default name: the beat's first line of words, else the look and beat. */
function defaultName(slots: readonly PatternSlot[], beat: string, look?: string): string {
  // The first lines of words and numbers, until there is enough to recognise the beat by ("über 30 Modelle").
  let name = "";
  for (const s of slots) {
    if (s.kind !== "text" && s.kind !== "number") continue;
    if (/^\d+(\.\d+)?$/.test(s.value) && name.includes(s.value)) continue;
    name = name ? `${name} ${s.value}` : s.value;
    if (name.length >= 18) break;
  }
  return (name ? name.slice(0, 60) : `${look ?? "beat"} ${beat}`).trim();
}

export function savePatternFromBeat(input: SaveInput): PersonalPattern {
  const id = patternIdFor(input.outDir, input.beat);
  const patterns = loadPatterns();
  const existing = patterns.find((p) => p.id === id);
  const slots = findSlots(input.html);
  const pattern = PersonalPatternSchema.parse({
    ...(existing ?? {}),
    id,
    name: existing?.kept ? existing.name : defaultName(slots, input.beat, input.look),
    from: { run: input.run, beat: input.beat, outDir: path.resolve(input.outDir) },
    ...(input.look ? { look: input.look } : {}),
    ...(input.type ? { type: input.type } : {}),
    ...(input.basedOn ? { basedOn: input.basedOn } : {}),
    ...(input.format ? { format: input.format } : {}),
    ...(input.durationSeconds ? { durationSeconds: input.durationSeconds } : {}),
    slots: slots.slice(0, 40),
    savedAt: new Date().toISOString(),
  });
  mkdirSync(patternsDir(), { recursive: true });
  writeFileSync(patternHtmlPath(id), asPattern(input.html, input.beat, pattern));
  if (input.clip && existsSync(input.clip)) {
    try {
      // The settled middle of the clip, as a picture of what the pattern does.
      execFileSync("ffmpeg", ["-v", "error", "-y", "-sseof", "-1.2", "-i", input.clip, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", patternThumbPath(id)]);
    } catch {
      // a pattern without a picture is still a pattern
    }
  }
  savePatterns([...patterns.filter((p) => p.id !== id), pattern]);
  return pattern;
}

/** Rating the source beat down takes its pattern away, unless a person has made it theirs since. */
export function unsaveFromBeat(outDir: string, beat: string): boolean {
  const id = patternIdFor(outDir, beat);
  const patterns = loadPatterns();
  const p = patterns.find((x) => x.id === id);
  if (!p || p.kept) return false;
  removePattern(id);
  return true;
}

export function removePattern(id: string): void {
  const patterns = loadPatterns();
  if (!patterns.some((p) => p.id === id)) throw new Error(`no pattern ${id}`);
  rmSync(patternHtmlPath(id), { force: true });
  rmSync(patternThumbPath(id), { force: true });
  savePatterns(patterns.filter((p) => p.id !== id));
}

export function editPattern(id: string, patch: { name?: string; tags?: readonly string[] }): PersonalPattern {
  const patterns = loadPatterns();
  const p = patterns.find((x) => x.id === id);
  if (!p) throw new Error(`no pattern ${id}`);
  const next = PersonalPatternSchema.parse({
    ...p,
    ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, 80) || p.name } : {}),
    ...(patch.tags !== undefined ? { tags: [...new Set(patch.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].sort() } : {}),
    kept: true,
  });
  // The header names the pattern; keep it in step with the name.
  if (patch.name !== undefined && existsSync(patternHtmlPath(id))) {
    const html = readFileSync(patternHtmlPath(id), "utf8").replace(/YOUR PATTERN: "[^"]*"/, `YOUR PATTERN: "${next.name.replace(/--/g, "- -")}"`);
    writeFileSync(patternHtmlPath(id), html);
  }
  savePatterns(patterns.map((x) => (x.id === id ? next : x)));
  return next;
}

/** A reel that rendered beats from personal patterns counts a use for each. */
export function recordPatternUses(ids: readonly string[]): void {
  if (ids.length === 0) return;
  const patterns = loadPatterns();
  let changed = false;
  for (const p of patterns) {
    const n = ids.filter((id) => id === p.id).length;
    if (n) { p.uses += n; changed = true; }
  }
  if (changed) savePatterns(patterns);
}

/** A beat that started from a personal pattern was rated: that pattern climbs or sinks. */
export function ratePatternUse(id: string, rating: "up" | "down"): void {
  const patterns = loadPatterns();
  const p = patterns.find((x) => x.id === id);
  if (!p) return;
  if (rating === "up") p.likes += 1; else p.dislikes += 1;
  savePatterns(patterns);
}
