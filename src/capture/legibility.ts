/**
 * Will this capture be readable once it is in the frame?
 *
 * ## Why this is arithmetic and not judgement
 *
 * The defect this exists to kill, measured in the predecessor's reels: screenshots were captured
 * as full browser windows at 1512×792 and placed into roughly 35% of a 1080² frame. That is an
 * effective scale of about 0.25, so 14px body text rendered at around three and a half pixels.
 * Every layout gate passed — the image was in bounds, it was the right aspect, nothing collided —
 * and the result was an unreadable grey smear that shipped.
 *
 * Nothing about that needs a human eye. A browser knows the computed `font-size` of everything it
 * just captured, so the rendered size is a multiplication:
 *
 *   effectiveScale = (targetWidthFraction × frameWidth) ÷ captureWidth
 *   renderedPx     = fontSizePx × effectiveScale
 *
 * ## Which font size
 *
 * Not the smallest one. A single 8px legal footer would fail an otherwise perfect capture, and a
 * gate that fires on captures people can obviously read is a gate people switch off — the same
 * lesson as the jitter detector's 346 false positives.
 *
 * So the gate runs on the **body size**: the smallest size that, together with everything larger,
 * still accounts for most of the visible characters. Micro-text below that is reported and does
 * not fail the capture, because it is almost always a footer, a tooltip or a disclaimer that the
 * beat is not asking anyone to read.
 */

/** Rendered height below which text is not readable at normal viewing distance. */
export const MIN_LEGIBLE_PX = 11;

/**
 * Share of characters the "body" size must cover.
 *
 * At 0.9, a page whose text is 90% at 16px and 10% at 8px has a body size of 16 — the footer is
 * noted, not fatal. A page that is half 16px and half 9px has a body size of 9, because at that
 * point the small text is the content.
 */
export const BODY_COVERAGE = 0.9;

/** One distinct computed font size in a capture, and how much text is set in it. */
export interface FontSizeSample {
  px: number;
  /** Visible characters set at this size. */
  chars: number;
}

/**
 * The size the gate runs on: the smallest that, with everything larger, covers `BODY_COVERAGE`.
 *
 * Returns `undefined` when there is no text at all — a capture of a chart or a photograph is not
 * illegible, it simply has nothing to read, and must not be failed for it.
 */
export function bodyFontSizePx(samples: readonly FontSizeSample[], coverage = BODY_COVERAGE): number | undefined {
  const withText = samples.filter((s) => s.chars > 0 && s.px > 0);
  if (withText.length === 0) return undefined;

  const total = withText.reduce((sum, s) => sum + s.chars, 0);
  const largestFirst = [...withText].sort((a, b) => b.px - a.px);

  let covered = 0;
  for (const sample of largestFirst) {
    covered += sample.chars;
    if (covered / total >= coverage) return sample.px;
  }
  return largestFirst[largestFirst.length - 1]!.px;
}

export interface LegibilityInput {
  /** Width in pixels of the image actually captured. */
  captureWidth: number;
  /** How wide it will be in the frame, as a fraction of frame width. 0.8 = 80%. */
  targetWidthFraction: number;
  /** The frame it is going into. 1080 for a square reel. */
  frameWidth: number;
  /** Every distinct computed font size in the captured node, with its character count. */
  fontSizes: readonly FontSizeSample[];
}

export interface LegibilityVerdict {
  ok: boolean;
  /** How much the capture is scaled down on its way into the frame. */
  effectiveScale: number;
  /** The size the gate ran on, or `undefined` when the capture has no text. */
  bodyPx?: number;
  /** What the body text will actually measure in the rendered frame. */
  renderedPx?: number;
  /** The smallest size present, reported even when it did not decide the verdict. */
  smallestPx?: number;
  /** Widest the capture may be and still be legible at this target size. */
  maxCaptureWidth?: number;
  /** Smallest share of the frame this capture may occupy and still be legible. */
  minTargetWidthFraction?: number;
  /** What to do about it, in words. Empty when `ok`. */
  advice: string;
}

/**
 * Judge a capture against the size it will be shown at.
 *
 * Two remedies are always offered, because either is legitimate and the right one depends on the
 * beat: crop tighter, or give it more of the frame.
 */
export function legibilityVerdict(input: LegibilityInput): LegibilityVerdict {
  const { captureWidth, targetWidthFraction, frameWidth, fontSizes } = input;

  if (captureWidth <= 0 || frameWidth <= 0 || targetWidthFraction <= 0) {
    return { ok: false, effectiveScale: 0, advice: "capture width, frame width and target fraction must all be positive" };
  }

  const targetPx = targetWidthFraction * frameWidth;
  const effectiveScale = targetPx / captureWidth;
  const bodyPx = bodyFontSizePx(fontSizes);
  const smallestPx = fontSizes.filter((s) => s.chars > 0 && s.px > 0).reduce<number | undefined>((min, s) => (min === undefined || s.px < min ? s.px : min), undefined);

  // No text is not a failure. A photograph, a chart, a logo: nothing to read, nothing to fail.
  if (bodyPx === undefined) {
    return { ok: true, effectiveScale, advice: "" };
  }

  const renderedPx = bodyPx * effectiveScale;
  const maxCaptureWidth = Math.floor((bodyPx * targetPx) / MIN_LEGIBLE_PX);
  const minTargetWidthFraction = (MIN_LEGIBLE_PX * captureWidth) / (bodyPx * frameWidth);

  const base = {
    effectiveScale,
    bodyPx,
    renderedPx,
    ...(smallestPx === undefined ? {} : { smallestPx }),
    maxCaptureWidth,
    minTargetWidthFraction,
  };

  if (renderedPx >= MIN_LEGIBLE_PX) {
    return { ok: true, ...base, advice: "" };
  }

  return {
    ok: false,
    ...base,
    advice:
      `body text is ${bodyPx.toFixed(0)}px in a ${captureWidth}px capture, which renders at ` +
      `${renderedPx.toFixed(1)}px at ${(targetWidthFraction * 100).toFixed(0)}% of a ${frameWidth}px frame — ` +
      `below the ${MIN_LEGIBLE_PX}px floor. Either crop to at most ${maxCaptureWidth}px wide, ` +
      `or give it at least ${(minTargetWidthFraction * 100).toFixed(0)}% of the frame` +
      (minTargetWidthFraction > 1 ? " — which is wider than the frame, so cropping is the only option here." : "."),
  };
}

/** One line for a report. */
export function formatLegibility(verdict: LegibilityVerdict): string {
  if (verdict.bodyPx === undefined) return "legible: no text to read";
  const head = `${verdict.ok ? "legible" : "ILLEGIBLE"}: body ${verdict.bodyPx.toFixed(0)}px renders at ${verdict.renderedPx!.toFixed(1)}px (scale ${verdict.effectiveScale.toFixed(2)})`;
  const tail = verdict.smallestPx !== undefined && verdict.smallestPx < verdict.bodyPx ? `; smallest text present is ${verdict.smallestPx.toFixed(0)}px` : "";
  return verdict.ok ? head + tail : `${head}${tail}\n  ${verdict.advice}`;
}
