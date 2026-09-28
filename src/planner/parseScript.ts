/**
 * Script parsing — spec Phase 1: "split on sentence/clause boundaries suitable for beat
 * segmentation, not naive line breaks."
 *
 * Two-pass approach:
 *  1. Split into sentences on [.!?] followed by whitespace + an uppercase/quote/digit start —
 *     a heuristic, not a full NLP sentence boundary detector (documented limitation: it will
 *     mis-split some abbreviations like "Dr. Müller" or "z.B. Claude", since German has no
 *     reliable punctuation-only signal to distinguish those from real sentence ends).
 *  2. Any sentence longer than CLAUSE_SPLIT_THRESHOLD words gets sub-split on clause connectors
 *     (comma + conjunction, colon, em-dash) so a single beat never has to carry an entire
 *     multi-clause sentence.
 *
 * Edge case ("script with no clear beat boundaries, rare, but a run-on paragraph"): if sentence
 * splitting finds only one sentence across a script long enough that this is implausible, fall
 * back to fixed-duration word chunking and report low confidence — never throw, never produce
 * a single beat spanning the whole Reel.
 */

export interface ScriptSegment {
  text: string;
  wordCount: number;
}

const CLAUSE_SPLIT_THRESHOLD = 16; // words
const FALLBACK_CHUNK_WORDS = 8;
const RUN_ON_WORD_THRESHOLD = 14; // above this with only 1 sentence detected => fallback

const CLAUSE_CONNECTOR_REGEX = /,\s+(?:und|aber|oder|denn|weil|während|sondern|obwohl|damit)\s+|[:;]\s+|\s+[–—]\s+/gi;

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function splitSentences(normalized: string): string[] {
  // Lookbehind for a sentence terminator, split before an uppercase/quote/digit start of the
  // next sentence. Node 20's V8 supports lookbehind natively.
  return normalized
    .split(/(?<=[.!?])\s+(?=["„A-ZÄÖÜ0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitLongSentenceIntoClauses(sentence: string): string[] {
  if (countWords(sentence) <= CLAUSE_SPLIT_THRESHOLD) return [sentence];
  const parts = sentence
    .split(CLAUSE_CONNECTOR_REGEX)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts : [sentence];
}

function chunkByWords(text: string, chunkSize: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize).join(" "));
  }
  return chunks;
}

export interface ParseScriptResult {
  segments: ScriptSegment[];
  /** True when sentence-boundary detection failed and fixed-duration chunking was used instead. */
  lowConfidenceSegmentation: boolean;
}

export function parseScript(scriptText: string): ParseScriptResult {
  const normalized = scriptText.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    throw new Error("parseScript: script is empty after normalization — nothing to plan");
  }

  const sentences = splitSentences(normalized);
  const totalWords = countWords(normalized);

  let rawSegments: string[];
  let lowConfidenceSegmentation = false;

  if (sentences.length <= 1 && totalWords > RUN_ON_WORD_THRESHOLD) {
    // Run-on paragraph: no punctuation gave us anything to split on. Fixed-duration chunking is
    // the documented, flagged fallback rather than one giant beat or a thrown error.
    rawSegments = chunkByWords(normalized, FALLBACK_CHUNK_WORDS);
    lowConfidenceSegmentation = true;
  } else {
    rawSegments = sentences.flatMap(splitLongSentenceIntoClauses);
  }

  const segments: ScriptSegment[] = rawSegments
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ text, wordCount: countWords(text) }));

  if (segments.length === 0) {
    throw new Error("parseScript: produced zero segments from non-empty input — this should be unreachable");
  }

  return { segments, lowConfidenceSegmentation };
}
