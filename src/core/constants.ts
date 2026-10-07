/**
 * Reel format constants. 1080x1920 (9:16) confirmed with the user 2026-09-15; 60fps since 2026-10-07, so a spring
 * that settles in 0.4 s is drawn in 24 frames rather than 12 (Apple's motion only reads as smooth at 60).
 * These are the DEFAULTS a run falls back to when the CLI isn't given explicit --fps/--format
 * flags — they are not hardcoded into any renderer or template, which always take format/fps as
 * props (per the "never hardcode one aspect ratio into a template" non-negotiable).
 */

export const DEFAULT_FPS = 60;

export const WORDS_PER_SECOND_ESTIMATE = 2.7;

/** Density target: visuals per 30 seconds of Reel. */
export const DENSITY_TARGET = {
  windowMs: 30_000,
  min: 5,
  max: 8,
} as const;

/**
 * Every shape a reel can be delivered in.
 *
 * Widened in Phase T4 from the original three. It stays a closed union rather than a
 * `{width,height}` pair for the reason `ids.ts` gives about slots: the `Record<OutputFormat, …>`
 * maps below and in `compositions.ts` turn a new member into a build error everywhere a decision
 * has to be made about it, which is the only mechanism in this repo that reliably survives someone
 * adding a member and forgetting a consumer.
 *
 * `overlay` is not an aspect ratio — it is "render this with an alpha channel at whatever box the
 * frame needs", which is why it is excluded from `RESOLUTIONS`.
 */
export const OUTPUT_FORMATS = ["9:16", "4:5", "1:1", "5:4", "4:3", "16:9", "overlay"] as const;

export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** The formats that describe a real canvas — everything except `overlay`. */
export type FrameFormat = Exclude<OutputFormat, "overlay">;

export const RESOLUTIONS: Record<FrameFormat, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "4:5": { width: 1080, height: 1350 },
  "1:1": { width: 1080, height: 1080 },
  "5:4": { width: 1350, height: 1080 },
  "4:3": { width: 1440, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
};

/** What each format is actually for, in the user's terms — shown beside the picker. */
export const FORMAT_LABELS: Record<OutputFormat, string> = {
  "9:16": "Reels · TikTok · Shorts",
  "4:5": "Instagram-Feed",
  "1:1": "Quadratisch",
  "5:4": "Feed, liegend",
  "4:3": "Klassisch",
  "16:9": "YouTube · LinkedIn",
  overlay: "Overlay mit Alpha",
};

/**
 * How much bigger or smaller type has to be in each format to read the same.
 *
 * `tokens.type.*` are percentages of frame HEIGHT, and roughly a hundred primitives consume them as
 * `(tokens.type.body / 100) * frameHeight`. That was exactly right while every frame was 1920 tall
 * and silently wrong the moment one was not: at 16:9 the frame is 1080 tall, so the same percentage
 * yields 56% of the pixels on a frame 1.8× wider, and every headline reads as a caption.
 *
 * Nothing would have caught it. `textFit.ts` asks whether text FITS, not whether it is big enough,
 * so a uniformly shrunken frame passes every fitter; `grade.ts`'s hierarchy rules are proportional,
 * so they pass too. It would have shipped looking plausible in a contact sheet and been unreadable
 * on a phone.
 *
 * The rule: type is sized against the frame's GEOMETRIC MEAN (√(w·h)) rather than its height, so a
 * headline occupies the same share of the frame's area whatever its shape. Expressed here as a
 * multiplier on the existing height-relative number, so no primitive has to change:
 *
 *     multiplier = (H₉ₓ₁₆ / √(A₉ₓ₁₆)) · √(w·h) / h
 *
 * `9:16` is pinned at exactly 1 by construction, which is what keeps the frozen hero reference at
 * 0.00 drift. The rotations (`9:16`↔`16:9`, `4:5`↔`5:4`) land on identical pixel sizes, because a
 * rotated frame has the same area.
 *
 * Hand-tuning an entry after looking at a render is expected and allowed — `formatTypeScale.test.ts`
 * bounds how far an entry may drift from the rule, rather than asserting the rule itself.
 */
export const FORMAT_TYPE_SCALE: Record<OutputFormat, number> = {
  "9:16": 1,
  "4:5": 1.1926,
  "1:1": 1.3333,
  "5:4": 1.4907,
  "4:3": 1.5396,
  "16:9": 1.7778,
  // An overlay has no canvas of its own — it is composited over footage at the host frame's size,
  // and `OVERLAY_DEFAULT_MAX` is 9:16, so it inherits 9:16's scale.
  overlay: 1,
};

/** Overlay assets render at whatever box the frame needs — no fixed resolution. */
export const OVERLAY_DEFAULT_MAX = { width: 1080, height: 1920 } as const;

/**
 * Is this unknown value one of the formats?
 *
 * Exists so no caller has to restate the membership test. Three hand-written comparisons in
 * `resolveFormat` were what would have made a beat carrying `"16:9"` fall through to the 9:16
 * default and render at the wrong shape with nothing reporting a problem.
 */
export function isOutputFormat(value: unknown): value is OutputFormat {
  return typeof value === "string" && (OUTPUT_FORMATS as readonly string[]).includes(value);
}

/** The canvas a format renders on, with `overlay` falling back to its default box. */
export function frameSizeFor(format: OutputFormat): { width: number; height: number } {
  return format === "overlay" ? { ...OVERLAY_DEFAULT_MAX } : RESOLUTIONS[format];
}

/**
 * Overlay (alpha-channel) assets render BOTH codecs until the editor confirms which their NLE takes
 * natively (user decision 2026-09-15: "render both"). Full-frame assets never use alpha.
 */
export const OVERLAY_CODECS = ["prores4444", "vp9-alpha"] as const;
export type OverlayCodec = (typeof OVERLAY_CODECS)[number];

export const FULL_FRAME_CODEC = "h264" as const;

/** Extensions the naming convention accepts, keyed by what produced them. */
export const CODEC_EXTENSION: Record<OverlayCodec | typeof FULL_FRAME_CODEC, string> = {
  prores4444: "mov",
  "vp9-alpha": "webm",
  h264: "mp4",
};
