import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BeatIntent, VisualType } from "../core/index.js";

/**
 * Visual type classification — INVENTED (see LEARNINGS.md: `reel-visual-planner` did not exist
 * on this machine to port judgment from). Rules live entirely in `rules/classifier.json` so a
 * real ruleset can be dropped in later without touching this file — see plan file, "Missing
 * skills" decision.
 */

interface ClassifierRule {
  visualType: VisualType;
  priority: number;
  descriptionPrefix: string;
  keywords: string[];
}

interface ClassifierRules {
  rules: ClassifierRule[];
  defaultVisualType: VisualType;
  defaultDescription: string;
}

let cachedRules: ClassifierRules | undefined;

export function loadClassifierRules(): ClassifierRules {
  if (cachedRules) return cachedRules;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const rulesPath = path.join(here, "..", "rules", "classifier.json");
  const raw = readFileSync(rulesPath, "utf-8");
  const parsed = JSON.parse(raw) as ClassifierRules & { _comment?: string };
  cachedRules = {
    rules: [...parsed.rules].sort((a, b) => b.priority - a.priority),
    defaultVisualType: parsed.defaultVisualType,
    defaultDescription: parsed.defaultDescription,
  };
  return cachedRules;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

function detectProduct(normalizedText: string): string | undefined {
  if (normalizedText.includes("claude")) return "Claude";
  if (normalizedText.includes("chatgpt") || normalizedText.includes(" gpt")) return "ChatGPT";
  if (normalizedText.includes("cursor")) return "Cursor";
  if (normalizedText.includes("lovable")) return "Lovable";
  return undefined;
}

/**
 * Phase L4: a beat's description — the brief the scene director reads. It is the spoken sentence,
 * prefixed only with the product the sentence itself names (`Claude: …`), so that whatever a
 * model echoes back as on-screen copy is real copy about this beat. `validateScenePlan` rejects
 * the old template shapes outright; this is the other half of that fix, at the source.
 */
export function buildDescription(product: string | undefined, sourceText: string): string {
  const text = sourceText.trim();
  return product ? `${product}: ${text}` : text;
}

/** Phase L: a small keyword read of what the sentence DOES — refined per reel by the Gemini
 * intent pass (L4); this is the offline default. */
const INTENT_KEYWORDS: readonly [BeatIntent, readonly string[]][] = [
  ["cta", ["jetzt bist du dran", "kommentier", "folg", "abonnier", "schreib mir", "link in", "teil", "speicher dir", "wuerdest du", "würdest du"]],
  ["comparison", ["oder", "vergleich", "unterschied", "dagegen", "statt", "versus", " vs "]],
  ["number", ["prozent", "%", "millionen", "tausend", "zahl", "doppelt", "dreimal", "sekunden schneller"]],
  ["process", ["schritt", "zuerst", "danach", "dann ", "prozess", "workflow", "ablauf", "so funktioniert"]],
  ["hook", ["stell dir vor", "wusstest du", "die meisten", "viele leute", "was waere wenn", "was wäre wenn", "kennst du"]],
  ["product_ui", ["claude", "chatgpt", "cursor", "lovable", "app", "chat", "tippt", "eingabefeld", "oberflaeche", "oberfläche"]],
  ["claim", ["besonders", "extrem", "am besten", "stark", "wichtig", "bedeutet", "merke", "kurz gesagt"]],
];

export function classifyBeatIntent(sourceText: string): BeatIntent {
  const text = ` ${sourceText.toLowerCase()} `;
  for (const [intent, keywords] of INTENT_KEYWORDS) {
    if (keywords.some((kw) => text.includes(kw))) return intent;
  }
  return "transition";
}

export interface ClassificationResult {
  visualType: VisualType;
  description: string;
  /** Phase L: see `BEAT_INTENTS`. */
  beatIntent: BeatIntent;
  /** Which rule fired, for debuggability — undefined when the default (no match) applied. */
  matchedRule?: { visualType: VisualType; keyword: string };
}

export function classifyVisualType(sourceText: string, rulesOverride?: ClassifierRules): ClassificationResult {
  const rules = rulesOverride ?? loadClassifierRules();
  const normalizedText = normalize(sourceText);

  for (const rule of rules.rules) {
    const matchedKeyword = rule.keywords.find((kw) => normalizedText.includes(normalize(kw)));
    if (matchedKeyword) {
      const product = rule.visualType === "ui_simulation" ? detectProduct(normalizedText) : undefined;
      return {
        visualType: rule.visualType,
        // Phase L4: the description is the SPOKEN SENTENCE (optionally prefixed with the product
        // it names) — never a routing template. It used to read `Claude UI simulation — "…"`,
        // which a real rendered beat printed verbatim on screen under a logo, because the
        // description is handed to the scene director as the brief and echoed back as copy.
        // The routing information it used to carry is already in `visualType`; duplicating it as
        // prose only created a string that looked like copy without being any.
        description: buildDescription(product, sourceText),
        beatIntent: classifyBeatIntent(sourceText),
        matchedRule: { visualType: rule.visualType, keyword: matchedKeyword },
      };
    }
  }

  // Phase L4: even the no-match default is the sentence itself. `assignContinuations` turns a
  // `none` classification into a continuation of the previous scene (or a text lead) and rewrites
  // the description to the sentence anyway — carrying "No visual planned — deliberate breathing
  // room." this far only risked it reaching a renderer.
  return { visualType: rules.defaultVisualType, description: buildDescription(undefined, sourceText), beatIntent: classifyBeatIntent(sourceText) };
}
