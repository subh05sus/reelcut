import type { GenerationMode } from "./eligibility.js";

/**
 * The prompt for a generated clip.
 *
 * A model asked for "a Claude download screen" invents one. So the prompt is built from a fixed frame, the
 * beat's idea in a few plain words, and a suffix that always says what must not appear: text, interface,
 * logos, real people. Lettering is the thing video models get most visibly wrong, and type is drawn over
 * the clip by HyperFrames anyway, where it is exact.
 */

/** Always the last words of the prompt. */
export const NEVER = "No text, no letters or numbers, no logos, no user interface, no screens or devices showing software, and no real people's faces or likeness.";

export const MIN_SECONDS = 3;
export const MAX_SECONDS = 10;

/** The idea, made safe to put in a prompt: one line, plain words, no links, no braces, bounded. */
export function cleanSubject(text: string, max = 240): string {
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[{}<>`\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

/** A generated clip is a few seconds: the beat's length, kept inside what a model can make. */
export function clipSeconds(beatSeconds: number): number {
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.ceil(beatSeconds)));
}

export interface PromptInput {
  mode: GenerationMode;
  /** What the beat is about, in a few plain words. */
  subject: string;
  mood?: string;
  beatSeconds: number;
}

export interface BuiltPrompt {
  prompt: string;
  seconds: number;
}

export function buildPrompt(input: PromptInput): BuiltPrompt {
  const subject = cleanSubject(input.subject);
  if (!subject) throw new Error("a prompt needs the beat's idea in a few plain words");
  const mood = input.mood ? cleanSubject(input.mood, 80) : "";
  const seconds = clipSeconds(input.beatSeconds);
  const frame: Record<GenerationMode, string> = {
    atmosphere: `A slow, soft, abstract background of moving light and colour, evoking: ${subject}. Calm, non-distracting motion with plenty of empty space in the frame for type to sit over it.`,
    "whole-beat": `A short abstract motion piece that expresses the idea: ${subject}. Graphic and clean, one clear movement, nothing literal.`,
    "animate-still": `Animate the supplied image with a gentle, subtle motion, in the spirit of: ${subject}. Keep the subject, composition and shapes unchanged and add no new elements.`,
  };
  return { prompt: [frame[input.mode], mood ? `Mood: ${mood}.` : "", `About ${seconds} seconds.`, NEVER].filter(Boolean).join(" "), seconds };
}
