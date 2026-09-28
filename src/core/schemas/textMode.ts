import { z } from "zod";

/**
 * Which layers of TEXT a finished reel carries.
 *
 * A reel prints words from three independent places, and until now only one of them had a control:
 *
 *   1. `visualMix` caps how many beats are text-LED scenes (`TEXT_LEAD_CAP`). It is about what a
 *      scene IS, not about whether words appear on it.
 *   2. Every scene gets a `typography_primary` headline, synthesised by the compiler from
 *      `plan.typography.displayText` whenever the composition declares the slot — unconditionally,
 *      with no way for anyone to say no.
 *   3. The master draws kinetic captions of the spoken line over the whole reel, always on, with
 *      no "none" member in `CAPTION_STYLES` and no boolean anywhere.
 *
 * So "I want a version with no text in the video" was not expressible, and the two uncontrolled
 * layers are also the two that can print the same sentence twice. This is the missing control, and
 * it is deliberately ONE three-way choice rather than two booleans: of the four combinations two
 * are ones nobody picks, and every gate that assumes a headline exists would have to reason about
 * both axes independently.
 *
 * Lives in core beside `visualMix` for the reason that file's header gives: core is the
 * browser-safe barrel, and the pickers are client components.
 */

export const TEXT_MODES = ["beides", "nur_untertitel", "nur_visuals"] as const;
export const TextModeSchema = z.enum(TEXT_MODES);
export type TextMode = z.infer<typeof TextModeSchema>;

/**
 * The default is what every existing reel already does, so an unset column and a deliberate
 * "beides" render identically. That is the same reasoning `reels.format` and `reels.visualMix`
 * document for being nullable with a read-time default rather than a column default.
 */
export const DEFAULT_TEXT_MODE: TextMode = "beides";

export function isTextMode(value: unknown): value is TextMode {
  return typeof value === "string" && (TEXT_MODES as readonly string[]).includes(value);
}

/** Does this mode draw the master's kinetic captions? */
export const TEXT_MODE_HAS_CAPTIONS: Record<TextMode, boolean> = {
  beides: true,
  nur_untertitel: true,
  nur_visuals: false,
};

/** Does this mode draw each scene's own synthesised headline? */
export const TEXT_MODE_HAS_HEADLINES: Record<TextMode, boolean> = {
  beides: true,
  // The captions are already speaking the line; this is the mode for a reel that wants subtitles
  // and nothing else competing with the picture.
  nur_untertitel: false,
  nur_visuals: false,
};

export const TEXT_MODE_LABELS: Record<TextMode, string> = {
  beides: "Untertitel + Überschriften",
  nur_untertitel: "Nur Untertitel",
  nur_visuals: "Nur Visuals",
};

export const TEXT_MODE_HINTS: Record<TextMode, string> = {
  beides: "Gesprochener Text als Untertitel, dazu die Überschrift jeder Szene.",
  nur_untertitel: "Nur die gesprochene Zeile als Untertitel — die Szenen bleiben bildlich.",
  nur_visuals: "Gar kein eingebrannter Text. Für Schnitte, die ihre eigenen Untertitel setzen.",
};
