/**
 * The fixed words a reference can be described with.
 *
 * Everything the studio learns from a reference is one of these tokens or a number, never a sentence.
 * That is what stops a title, a caption or a note found in someone else's film from becoming an
 * instruction Claude follows in every later reel: a value outside these lists is not a fact about
 * taste, so it is dropped.
 */

/** How fast a film cuts, from its median shot length. */
export const PACING = ["fast", "medium", "slow"] as const;
export type Pacing = (typeof PACING)[number];

/** Median shot at or under this many seconds is `fast`; at or under `MEDIUM_SHOT_SECONDS`, `medium`; else `slow`. */
export const FAST_SHOT_SECONDS = 1.6;
export const MEDIUM_SHOT_SECONDS = 3.5;

export function pacingOf(medianShotSeconds: number): Pacing {
  return medianShotSeconds <= FAST_SHOT_SECONDS ? "fast" : medianShotSeconds <= MEDIUM_SHOT_SECONDS ? "medium" : "slow";
}

/** What the ground of the film is: mostly light, mostly dark, a saturated brand colour, or no one thing. */
export const GROUNDS = ["light", "dark", "brand", "mixed"] as const;
export type Ground = (typeof GROUNDS)[number];

/**
 * The moves a designed film is made of: the same tags `whatships-tally.tsv` uses, so what is seen in a
 * reference and what is counted in the 809 films are the same words.
 */
export const MOVES = [
  "wb", // text builds word by word
  "big", // huge type
  "kin", // kinetic type
  "ser", // italic serif accent
  "hl", // highlighter or box
  "strike", // strike-through
  "roll", // values rolling
  "wheel", // wheel of values
  "ui", // real product UI
  "cur", // cursor
  "chat", // prompt or chat
  "code", // code
  "dev", // device frame
  "tilt", // 3D-tilted card
  "fly", // arrival from depth or collage
  "num", // big number
  "mesh", // gradient ground
  "hud", // viewfinder corners
  "obj", // 3D or photographed object
  "ill", // illustration
  "icon", // icon set
  "bub", // bubbles
  "logo", // logo moment
  "foot", // footage
  "sr", // screen recording inside a designed film
  "cap", // captions
] as const;
export type Move = (typeof MOVES)[number];

/** How type arrives and sits in the film. */
export const TEXT_STYLES = ["kinetic", "key-lines", "minimal", "none"] as const;
export type TextStyle = (typeof TEXT_STYLES)[number];

export const isMove = (v: string): v is Move => (MOVES as readonly string[]).includes(v);
export const isTextStyle = (v: string): v is TextStyle => (TEXT_STYLES as readonly string[]).includes(v);
