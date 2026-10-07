import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { reelcutHome } from "../library/store.js";
import type { Settings } from "./manager.js";

/**
 * Recipes: saved starting points for a reel. Each prefills the composer's settings and gives Claude the shape to follow
 * (a beat outline and how to treat it). Six come built in; the owner saves their own from any composer.
 */
export interface Recipe {
  id: string;
  name: string;
  /** One line on the card. */
  line: string;
  builtIn?: boolean;
  settings: Partial<Settings>;
  /** How Claude should treat the reel. */
  instructions: string;
  /** The beats, in order, as Claude should plan them. */
  structure: string[];
  /** "write" starts in the script writer: the owner gives a topic, a link or notes. */
  mode?: "script" | "write";
  createdAt?: string;
}

export const BUILT_IN_RECIPES: readonly Recipe[] = [
  {
    id: "product-launch", name: "Product launch", line: "Problem, reveal, three features, proof, call to action", builtIn: true,
    settings: { format: "9:16", text: "key-lines", sfx: "on", music: "fits" },
    instructions: "A launch: the problem lands in the first second, the product is revealed as the answer, each feature is shown working in real UI (cursor, taps), and the end card names the product and where to get it. One earned moment: the reveal.",
    structure: ["Hook: the problem, in the viewer's words", "Reveal: the product's name and one-line promise", "Feature 1, shown working", "Feature 2, shown working", "Feature 3, shown working", "Proof: a number, a quote or a logo", "Call to action: where to get it"],
  },
  {
    id: "tutorial", name: "Tutorial", line: "The outcome first, then each step on screen", builtIn: true,
    settings: { format: "9:16", text: "key-lines", sfx: "on", music: "fits" },
    instructions: "A how-to: open on the finished result, then one beat per step with the real interface (cursor moves, clicks, typing), a step counter in the corner, and a recap card. Keep every step readable at phone size.",
    structure: ["Hook: the finished result", "Step 1", "Step 2", "Step 3 (add or remove steps to match the script)", "Recap: all steps on one card", "Call to action"],
  },
  {
    id: "fact-check", name: "Fact-check", line: "The claim, the evidence, the verdict and its source", builtIn: true,
    settings: { format: "9:16", text: "full", sfx: "on", music: "none" },
    instructions: "A fact-check: quote the claim exactly, show the evidence as data (charts with labelled sources), deliver a clear verdict stamp (True, False, Misleading), and end on the sources. Every figure needs a source on screen; never invent one, ask when it is missing.",
    structure: ["The claim, quoted", "Is it true?", "Evidence 1 (data)", "Evidence 2 (data)", "Verdict stamp", "Sources"],
  },
  {
    id: "before-after", name: "Before / after", line: "The pain, the turn, the result", builtIn: true,
    settings: { format: "9:16", text: "key-lines", sfx: "on", music: "snap" },
    instructions: "A transformation: the before is shown, not told (cluttered, slow, red numbers), a decisive transition (wipe or match cut) marks the turn, and the after mirrors the before's layout so the change reads instantly.",
    structure: ["Before: the pain, shown", "The turn: one transition", "After: the same frame, fixed", "How: the one thing that changed", "Call to action"],
  },
  {
    id: "listicle", name: "List", line: "N things, one beat each, a bonus at the end", builtIn: true,
    settings: { format: "9:16", text: "key-lines", sfx: "on", music: "snap" },
    instructions: "A list: the count is the hook (\"5 things…\"), every item gets one beat with a big number and one visual, cuts land on the music, and a bonus item rewards watching to the end.",
    structure: ["Hook: the count and the promise", "Item 1", "Item 2", "Item 3", "Item … (one beat per item in the script)", "Bonus", "Call to action"],
  },
  {
    id: "founder-story", name: "Founder story", line: "Why we built it, told in the first person", builtIn: true,
    settings: { format: "9:16", text: "minimal", sfx: "off", music: "fits" },
    instructions: "A story in the first person: calm pacing, editorial type, real photos or footage from the library where they exist, and space for a voiceover. The insight is the turning point; the product appears late and modestly.",
    structure: ["Hook: the moment it started", "The struggle", "The insight", "What we built", "The invitation"],
    mode: "write",
  },
];

const file = () => path.join(reelcutHome(), "recipes.json");
function loadOwn(): Recipe[] { try { return JSON.parse(readFileSync(file(), "utf8")) as Recipe[]; } catch { return []; } }
function saveOwn(list: Recipe[]): void { mkdirSync(path.dirname(file()), { recursive: true }); writeFileSync(file(), JSON.stringify(list, null, 1)); }

export function listRecipes(): Recipe[] { return [...loadOwn(), ...BUILT_IN_RECIPES]; }
export function getRecipe(id: string): Recipe | undefined { return listRecipes().find((r) => r.id === id); }

export function saveRecipe(input: Partial<Recipe> & { name: string }): Recipe {
  const own = loadOwn();
  const clean = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
  const r: Recipe = {
    id: input.id && own.some((x) => x.id === input.id) ? input.id : `r_${randomBytes(4).toString("hex")}`,
    name: clean(input.name, 60) || "My recipe",
    line: clean(input.line, 120),
    settings: Object.fromEntries(Object.entries(input.settings ?? {}).filter(([, v]) => typeof v === "string" && v)) as Partial<Settings>,
    instructions: clean(input.instructions, 4000),
    structure: (input.structure ?? []).map((x) => clean(x, 200)).filter(Boolean).slice(0, 30),
    ...(input.mode === "write" ? { mode: "write" as const } : {}),
    createdAt: new Date().toISOString(),
  };
  saveOwn([r, ...own.filter((x) => x.id !== r.id)]);
  return r;
}
export function removeRecipe(id: string): void {
  if (BUILT_IN_RECIPES.some((r) => r.id === id)) throw new Error("built-in recipes stay");
  saveOwn(loadOwn().filter((x) => x.id !== id));
}
export const recipesExist = (): boolean => existsSync(file());

/** The recipe as lines of the first prompt. */
export function recipePrompt(r: Recipe): string[] {
  return [
    `Follow the recipe "${r.name}". ${r.instructions}`.trim(),
    ...(r.structure.length ? ["Plan the beats on this shape (merge or split to fit the script, but keep the order):", ...r.structure.map((x, i) => `${i + 1}. ${x}`)] : []),
    "",
  ];
}
