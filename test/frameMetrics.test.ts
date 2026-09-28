import { describe, expect, it } from "vitest";
import { MIN_BOUNDARY_CONTRAST, backgroundLevel, blankPanels, edgeInk, flatRegions, frameDelta, gridInk, inkShare, type GreyFrame } from "../src/verify/frameMetrics.js";

const W = 120;
const H = 120;

function blank(level: number, width = W, height = H): GreyFrame {
  return { width, height, data: new Uint8Array(width * height).fill(level) };
}

function fillRect(frame: GreyFrame, x0: number, y0: number, x1: number, y1: number, level: number): GreyFrame {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) frame.data[y * frame.width + x] = level;
  }
  return frame;
}

/**
 * A line of type: vertical strokes with gaps, not a solid bar.
 *
 * Real glyphs do not fill their bounding box, and that matters — the first version of
 * `blankPanels` flagged a solid bar as an empty panel, because it is flat, bounded, rectangular
 * and has nothing inside it. A fixture that draws type as a filled rectangle is testing something
 * no renderer produces.
 */
function typeLine(frame: GreyFrame, x0: number, y0: number, x1: number, y1: number, level: number): GreyFrame {
  for (let x = x0; x < x1; x++) {
    if (x % 5 >= 3) continue; // the gap between strokes
    for (let y = y0; y < y1; y++) frame.data[y * frame.width + x] = level;
  }
  return frame;
}

/** A textured ground, so "flat" means something. Deterministic — never Math.random. */
function textured(base: number, frame = blank(base)): GreyFrame {
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      frame.data[y * frame.width + x] = (base + ((x * 7 + y * 13) % 60)) & 0xff;
    }
  }
  return frame;
}

describe("backgroundLevel", () => {
  it("returns the modal level, not the mean", () => {
    // 90% dark ground, 10% bright type. A mean would land between them and call both ink.
    const f = blank(20);
    fillRect(f, 0, 0, W, 12, 240);
    expect(backgroundLevel(f)).toBeLessThan(40);
  });
});

describe("inkShare", () => {
  it("counts only what departs from the ground", () => {
    const f = blank(20);
    fillRect(f, 0, 0, W, 12, 240); // 10% of the frame
    expect(inkShare(f)).toBeCloseTo(0.1, 2);
  });

  it("is near zero for an empty frame", () => {
    expect(inkShare(blank(200))).toBeCloseTo(0, 5);
  });
});

describe("blankPanels", () => {
  /*
   * The defect this module exists for: `/brag`'s own horse-tinder example at 15.0s-15.8s, where
   * the phone screen renders as an empty cream rectangle over a photograph.
   */
  it("finds a bounded empty rectangle sitting on a textured ground", () => {
    const f = textured(60);
    fillRect(f, 40, 30, 80, 95, 245); // a 'phone screen' that forgot its contents
    const panels = blankPanels(f);
    expect(panels.length).toBe(1);
    expect(panels[0]!.touchesEdge).toBe(false);
    expect(panels[0]!.rectFill).toBeGreaterThan(0.95);
    expect(panels[0]!.area).toBeCloseTo((40 * 65) / (W * H), 2);
  });

  /*
   * The case that makes this a discriminator rather than an emptiness meter, and the reason the
   * rule is "does not touch the edge".
   *
   * `/brag`'s hook frame is a full-bleed orange field with one line of type — about 5% ink, which
   * is *less* than some frames we would call too empty. It is deliberate and it is good. It must
   * not be a finding, and the only thing separating it from the phone screen above is that the
   * orange reaches all four edges.
   */
  it("does not flag a full-bleed ground, however empty", () => {
    const f = blank(120);
    typeLine(f, 10, 55, 110, 68, 20);
    expect(inkShare(f)).toBeLessThan(0.12); // genuinely sparse
    expect(blankPanels(f)).toEqual([]);
  });

  /*
   * The case that broke the first version, kept as a regression.
   *
   * A heavy display line at a small sample size can come back effectively solid, and then it
   * satisfies flat + bounded + rectangular + empty-inside. `minSide` is what rejects it: a
   * container is substantial on both axes, a line of type is a stripe.
   */
  it("does not flag a solid bar of type, which passes every other condition", () => {
    const f = blank(120);
    fillRect(f, 10, 55, 110, 68, 20);
    const solid = flatRegions(f, 0.03).find((r) => !r.touchesEdge);
    expect(solid?.rectFill).toBe(1);
    expect(solid?.interiorOther).toBe(0);
    expect(solid!.h).toBeLessThan(0.15); // a stripe, and that is the only thing that saves us
    expect(blankPanels(f)).toEqual([]);
  });

  it("does not flag a panel that has content on it", () => {
    const f = textured(60);
    fillRect(f, 40, 30, 80, 95, 245);
    fillRect(f, 45, 40, 75, 52, 30); // a headline inside the panel
    fillRect(f, 45, 58, 70, 66, 30); // and a second line
    expect(blankPanels(f)).toEqual([]);
  });

  it("does not flag a small flat patch", () => {
    const f = textured(60);
    fillRect(f, 50, 50, 58, 58, 245); // a button, not a surface
    expect(blankPanels(f)).toEqual([]);
  });

  it("does not flag a non-rectangular flat area", () => {
    // An L-shape: flat and large, but no UI surface is shaped like this.
    const f = textured(60);
    fillRect(f, 20, 20, 90, 45, 245);
    fillRect(f, 20, 45, 45, 100, 245);
    expect(blankPanels(f)).toEqual([]);
  });
});

describe("boundaryContrast", () => {
  /*
   * The property the whole check rests on, and the one that stopped it rejecting good design.
   *
   * Measured on the corpus: the three real defects step 21, 38 and 44 levels across their
   * boundaries (`/brag`'s blank phone screen, and two broken screenshot panels in our own reel).
   * The three soft-light false positives step 1, 3 and 8 (radial glows behind title-card type in
   * horse-tinder and fish-flight-school). `MIN_BOUNDARY_CONTRAST` sits at 15, in the gap.
   */
  it("is high for a drawn surface and low for a glow", () => {
    const panel = textured(60);
    fillRect(panel, 40, 30, 80, 95, 245);
    const drawn = flatRegions(panel, 0.03).find((r) => !r.touchesEdge)!;
    expect(drawn.boundaryContrast).toBeGreaterThan(MIN_BOUNDARY_CONTRAST);

    // A radial falloff: quantising it yields concentric bands with no real edge anywhere.
    const glow = blank(30);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = Math.hypot(x - W / 2, y - H / 2) / (W / 2);
        glow.data[y * W + x] = Math.round(30 + 60 * Math.max(0, 1 - d));
      }
    }
    for (const band of flatRegions(glow, 0.03).filter((r) => !r.touchesEdge)) {
      expect(band.boundaryContrast).toBeLessThan(MIN_BOUNDARY_CONTRAST);
    }
    expect(blankPanels(glow)).toEqual([]);
  });
});

describe("flatRegions", () => {
  it("orders by area and marks the ground as edge-touching", () => {
    const f = blank(200);
    fillRect(f, 30, 30, 70, 70, 40);
    const regions = flatRegions(f);
    expect(regions.length).toBeGreaterThanOrEqual(2);
    expect(regions[0]!.touchesEdge).toBe(true);
    expect(regions[0]!.area).toBeGreaterThan(regions[1]!.area);
    expect(regions[1]!.touchesEdge).toBe(false);
  });
});

describe("gridInk", () => {
  it("locates a dead band", () => {
    // Content in the top third only — the shape of our reel at 34s.
    const f = blank(240);
    fillRect(f, 10, 5, 110, 35, 20);
    const grid = gridInk(f, 3, 3);
    expect(grid.slice(0, 3).every((v) => v > 0.3)).toBe(true);
    expect(grid.slice(6, 9).every((v) => v === 0)).toBe(true);
  });
});

describe("edgeInk", () => {
  it("is zero when everything sits inside the safe area", () => {
    const f = blank(240);
    fillRect(f, 30, 30, 90, 90, 20);
    expect(edgeInk(f)).toBe(0);
  });

  it("rises when content reaches the border", () => {
    const f = blank(240);
    fillRect(f, 0, 0, W, 10, 20);
    expect(edgeInk(f)).toBeGreaterThan(0.1);
  });
});

describe("frameDelta", () => {
  it("is zero for identical frames and positive otherwise", () => {
    const a = blank(100);
    const b = blank(100);
    expect(frameDelta(a, b)).toBe(0);
    expect(frameDelta(a, blank(110))).toBeCloseTo(10, 5);
  });

  it("refuses mismatched sizes rather than reading past the end", () => {
    expect(() => frameDelta(blank(0, 10, 10), blank(0, 12, 12))).toThrow(/mismatch/);
  });
});
