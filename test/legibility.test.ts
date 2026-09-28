import { describe, expect, it } from "vitest";
import { BODY_COVERAGE, MIN_LEGIBLE_PX, bodyFontSizePx, formatLegibility, legibilityVerdict, type FontSizeSample } from "../src/capture/legibility.js";

/** The real defect: a full browser window shrunk into a third of a square frame. */
const PREDECESSOR = {
  captureWidth: 1512,
  targetWidthFraction: 0.35,
  frameWidth: 1080,
  fontSizes: [{ px: 14, chars: 900 }] as FontSizeSample[],
};

describe("bodyFontSizePx", () => {
  it("is the only size when the text is uniform", () => {
    expect(bodyFontSizePx([{ px: 16, chars: 500 }])).toBe(16);
  });

  /*
   * The false positive this avoids. A single 8px legal footer must not fail an otherwise perfect
   * capture — a gate that fires on captures people can obviously read is a gate people switch off.
   */
  it("ignores a small footer that carries almost no text", () => {
    expect(bodyFontSizePx([{ px: 16, chars: 950 }, { px: 8, chars: 30 }])).toBe(16);
  });

  it("does not ignore small text once it IS the content", () => {
    expect(bodyFontSizePx([{ px: 16, chars: 400 }, { px: 9, chars: 600 }])).toBe(9);
  });

  it("walks down from the largest until it has covered enough", () => {
    // 40 + 300 = 340 of 1000 at 32/20px; only adding the 14px band clears 90%.
    expect(bodyFontSizePx([{ px: 32, chars: 40 }, { px: 20, chars: 300 }, { px: 14, chars: 660 }])).toBe(14);
  });

  it("returns nothing when there is no text at all", () => {
    expect(bodyFontSizePx([])).toBeUndefined();
    expect(bodyFontSizePx([{ px: 16, chars: 0 }])).toBeUndefined();
  });

  it("honours a stricter coverage requirement", () => {
    const samples = [{ px: 16, chars: 950 }, { px: 8, chars: 50 }];
    expect(bodyFontSizePx(samples, BODY_COVERAGE)).toBe(16);
    expect(bodyFontSizePx(samples, 1)).toBe(8);
  });
});

describe("legibilityVerdict", () => {
  /*
   * The measurement this module was built from: 14px body in a 1512px capture at 35% of a 1080
   * frame is an effective scale of 0.25, so the text renders at about 3.5px.
   */
  it("refuses the predecessor's screenshot problem, with the numbers", () => {
    const v = legibilityVerdict(PREDECESSOR);
    expect(v.ok).toBe(false);
    expect(v.effectiveScale).toBeCloseTo(0.25, 2);
    expect(v.renderedPx).toBeCloseTo(3.5, 1);
    expect(v.advice).toMatch(/crop to at most/);
  });

  it("offers both remedies, and each one actually works", () => {
    const v = legibilityVerdict(PREDECESSOR);

    const cropped = legibilityVerdict({ ...PREDECESSOR, captureWidth: v.maxCaptureWidth! });
    expect(cropped.ok).toBe(true);

    const bigger = legibilityVerdict({ ...PREDECESSOR, targetWidthFraction: v.minTargetWidthFraction! });
    expect(bigger.ok).toBe(true);
  });

  it("says plainly when cropping is the only way out", () => {
    // 10px text in a very wide capture cannot be rescued by size alone: it would need more than
    // the whole frame.
    const v = legibilityVerdict({ captureWidth: 3000, targetWidthFraction: 0.5, frameWidth: 1080, fontSizes: [{ px: 10, chars: 500 }] });
    expect(v.ok).toBe(false);
    expect(v.minTargetWidthFraction!).toBeGreaterThan(1);
    expect(v.advice).toMatch(/cropping is the only option/);
  });

  it("passes a properly cropped detail", () => {
    // A 640px crop of a card, placed across 80% of the frame: 16px text lands at 21.6px.
    const v = legibilityVerdict({ captureWidth: 640, targetWidthFraction: 0.8, frameWidth: 1080, fontSizes: [{ px: 16, chars: 300 }] });
    expect(v.ok).toBe(true);
    expect(v.renderedPx!).toBeGreaterThan(MIN_LEGIBLE_PX);
  });

  /*
   * The boundary, tested from both sides against the module's own advice.
   *
   * `maxCaptureWidth` floors rather than rounds, and it has to: rounding up makes the text
   * SMALLER, so a rounded boundary lands at 10.998px and the advice would be wrong by one pixel
   * of capture width. This test was written with Math.round and caught it.
   */
  it("gives a maxCaptureWidth that passes, and fails one pixel wider", () => {
    const base = { targetWidthFraction: 0.8, frameWidth: 1080, fontSizes: [{ px: 16, chars: 300 }] };
    const advised = legibilityVerdict({ ...base, captureWidth: 4000 }).maxCaptureWidth!;

    expect(legibilityVerdict({ ...base, captureWidth: advised }).ok).toBe(true);
    expect(legibilityVerdict({ ...base, captureWidth: advised + 1 }).ok).toBe(false);
    expect(legibilityVerdict({ ...base, captureWidth: advised }).renderedPx!).toBeGreaterThanOrEqual(MIN_LEGIBLE_PX);
  });

  /*
   * A photograph, a chart or a logo has nothing to read. Failing it for illegibility would be
   * nonsense, and would make the gate untrustworthy everywhere else.
   */
  it("passes a capture with no text rather than failing it for having none", () => {
    const v = legibilityVerdict({ ...PREDECESSOR, fontSizes: [] });
    expect(v.ok).toBe(true);
    expect(v.bodyPx).toBeUndefined();
    expect(v.advice).toBe("");
  });

  it("reports the smallest text even when the body size passed", () => {
    const v = legibilityVerdict({ captureWidth: 640, targetWidthFraction: 0.8, frameWidth: 1080, fontSizes: [{ px: 16, chars: 950 }, { px: 9, chars: 30 }] });
    expect(v.ok).toBe(true);
    expect(v.bodyPx).toBe(16);
    expect(v.smallestPx).toBe(9);
    expect(formatLegibility(v)).toMatch(/smallest text present is 9px/);
  });

  it("rejects nonsense inputs instead of dividing by zero", () => {
    expect(legibilityVerdict({ ...PREDECESSOR, captureWidth: 0 }).ok).toBe(false);
    expect(legibilityVerdict({ ...PREDECESSOR, frameWidth: 0 }).ok).toBe(false);
    expect(legibilityVerdict({ ...PREDECESSOR, targetWidthFraction: 0 }).ok).toBe(false);
  });
});

describe("formatLegibility", () => {
  it("says there is nothing to read when there is nothing to read", () => {
    expect(formatLegibility(legibilityVerdict({ ...PREDECESSOR, fontSizes: [] }))).toMatch(/no text to read/);
  });

  it("puts the advice on its own line when it fails", () => {
    const text = formatLegibility(legibilityVerdict(PREDECESSOR));
    expect(text).toMatch(/^ILLEGIBLE/);
    expect(text.split("\n")).toHaveLength(2);
  });
});
