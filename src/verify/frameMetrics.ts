/**
 * What a rendered frame actually contains, measured from its pixels.
 *
 * ## Why this exists
 *
 * Phase X deletes the slot IR and lets the model author each beat directly. Every analytic gate
 * we had — `validateSceneBounds`, `motionQa`, `fitLayout` — read the compiled `ResolvedScene`, so
 * all of them go blind the moment nothing compiles a scene. That is not a hypothetical cost:
 * `/brag`, which authors exactly this way, ships a blank phone screen and a toast hanging outside
 * its bezel in `examples/horse-tinder/brag.mp4` at 15.0s–15.8s, in the file linked from its own
 * launch site.
 *
 * So the gate moves to the only place that still knows the truth after authoring is free: the
 * pixels. This module is deliberately engine-neutral — it reads a decoded frame and nothing else,
 * so it works on Remotion output today and Hyperframes output tomorrow, and it can be pointed at
 * someone else's mp4 to check that a detector fires on a defect we can see with our own eyes.
 *
 * ## The distinction this module is built around
 *
 * The hard part is **not** detecting emptiness. It is separating two things that are numerically
 * almost identical and aesthetically opposite:
 *
 * - `/brag` at 1.2s: a full-bleed orange field with one line of type. ~5% ink. **Deliberate.**
 * - ours at 20s: an off-white field with one centred line of type. ~5% ink. **Timid.**
 * - horse-tinder at 15.0s: a photograph with a cream rectangle where a UI should be. **Broken.**
 *
 * A naive ink-coverage threshold flags all three. The discriminator that actually works is
 * *boundedness*: a background reaches the edge of the frame, a blank panel does not. That single
 * property is what `blankPanels` keys on, and it is why this reports panels rather than coverage.
 *
 * Coverage still gets reported — as data, not as a gate. See `gridInk`.
 */

/** A decoded single-channel frame. `data.length` must be `width * height`. */
export interface GreyFrame {
  width: number;
  height: number;
  /** Luminance, one byte per pixel, row-major. */
  data: Uint8Array;
}

/**
 * How far a pixel must sit from the background level before it counts as ink.
 *
 * 12/255 ≈ 4.7%. Below that, JPEG ringing around large type and the gentle vignette on a
 * photographic backdrop both register as content and every frame looks busy.
 */
export const INK_THRESHOLD = 12;

/**
 * Luminance bucket width when grouping pixels into flat regions.
 *
 * A UI panel is filled with one declared colour and comes back within a point or two of it after
 * h264. A photograph's sky varies far more than this across any area worth calling a region, so
 * quantising at 10 splits gradients into slivers while keeping declared fills whole.
 */
export const FLAT_QUANT = 10;

/** A connected run of near-uniform pixels. All geometry is normalised to the frame, 0..1. */
export interface FlatRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Share of the whole frame this region's pixels occupy, 0..1. */
  area: number;
  /** Mean luminance, 0..255. */
  level: number;
  /** `area` as a share of the bounding box. 1.0 is a perfect rectangle. */
  rectFill: number;
  /** Whether any pixel of the region lies on the frame border. */
  touchesEdge: boolean;
  /** Share of the bounding box occupied by pixels that are NOT this region — i.e. content on it. */
  interiorOther: number;
  /**
   * The tallest run of bounding-box rows carrying essentially nothing but this region, as a share
   * of the bounding box height.
   *
   * This is the measure that separates an empty container from a working one, and `interiorOther`
   * is not. Measured on `/brag`'s horse-tinder example at 15.0s, the blank phone screen scores
   * `interiorOther = 0.186`; a synthetic panel with two lines of type on it scores 0.21. The two
   * are indistinguishable by that number, because a real panel's bounding box also contains its
   * header, its rounded corners and anything overlapping it.
   *
   * Where they differ is the distribution. The blank screen is uninterrupted from below its
   * header to above the toast — one clear band of roughly 78% of its height. The working panel's
   * largest gap is 45%, because its content is spread through its body.
   */
  largestEmptyBand: number;
  /**
   * Mean luminance step across the region's boundary, 0..255.
   *
   * The discriminator between a drawn surface and a lighting effect, and the one that stopped
   * this check flagging good design. A declared UI panel has a hard edge — cream screen against
   * a dark photograph steps about 200 levels. A radial glow behind a headline has no edge at all:
   * quantising it produces concentric bands that are large, roughly elliptical, enclosed, and
   * empty through the middle, so they satisfy every other condition here. Their boundaries step
   * by about one quantisation bucket.
   *
   * Both false positives this caught were title cards from `/brag` — horse-tinder at 3.5s and
   * fish-flight-school at 3.0s — and both are well composed. A gate that rejects those is worse
   * than no gate.
   */
  boundaryContrast: number;
}

function quantise(v: number): number {
  return Math.floor(v / FLAT_QUANT);
}

/**
 * The frame's background luminance: the most common quantised level.
 *
 * Modal rather than mean, because a mean sits between a dark ground and bright type and then
 * everything reads as ink.
 */
export function backgroundLevel(frame: GreyFrame): number {
  const buckets = new Uint32Array(Math.ceil(256 / FLAT_QUANT));
  for (let i = 0; i < frame.data.length; i++) buckets[quantise(frame.data[i]!)]! += 1;
  let best = 0;
  for (let b = 1; b < buckets.length; b++) if (buckets[b]! > buckets[best]!) best = b;
  return best * FLAT_QUANT + FLAT_QUANT / 2;
}

/** Share of pixels that differ from the background by more than `INK_THRESHOLD`. */
export function inkShare(frame: GreyFrame, background = backgroundLevel(frame)): number {
  let ink = 0;
  for (let i = 0; i < frame.data.length; i++) {
    if (Math.abs(frame.data[i]! - background) > INK_THRESHOLD) ink += 1;
  }
  return ink / frame.data.length;
}

/**
 * Ink share per cell of a `cols x rows` grid, row-major.
 *
 * Reported, never gated. The defect this was built to describe — our own reel at 34s, where the
 * bottom 40% of the frame is the unused rows of a layout grid — is real, but "a large empty band"
 * is also what a deliberate asymmetric composition looks like, and a gate that cannot tell them
 * apart is the jitter detector with its 346 false positives all over again. Print the distribution
 * and let a human read it until there is enough corpus to justify a threshold.
 */
export function gridInk(frame: GreyFrame, cols: number, rows: number, background = backgroundLevel(frame)): number[] {
  const out = new Array<number>(cols * rows).fill(0);
  const counts = new Array<number>(cols * rows).fill(0);
  for (let y = 0; y < frame.height; y++) {
    const row = Math.min(rows - 1, Math.floor((y / frame.height) * rows));
    for (let x = 0; x < frame.width; x++) {
      const col = Math.min(cols - 1, Math.floor((x / frame.width) * cols));
      const cell = row * cols + col;
      counts[cell]! += 1;
      if (Math.abs(frame.data[y * frame.width + x]! - background) > INK_THRESHOLD) out[cell]! += 1;
    }
  }
  return out.map((n, i) => (counts[i]! === 0 ? 0 : n / counts[i]!));
}

/**
 * Every connected region of near-uniform luminance, largest first.
 *
 * Four-connected flood fill over quantised levels, iterative rather than recursive because a
 * full-bleed background on a 1080-wide frame is a single component of a million pixels and a
 * recursive fill blows the stack long before it finishes.
 */
export function flatRegions(frame: GreyFrame, minArea = 0.01): FlatRegion[] {
  const { width, height, data } = frame;
  const total = width * height;
  const seen = new Uint8Array(total);
  const regions: FlatRegion[] = [];
  const stack: number[] = [];


  for (let start = 0; start < total; start++) {
    if (seen[start]) continue;
    const level = quantise(data[start]!);
    seen[start] = 1;

    stack.length = 0;
    stack.push(start);

    let count = 0;
    let sum = 0;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    let edge = false;
    let boundarySum = 0;
    let boundaryCount = 0;

    /*
     * A neighbour in a different quantisation bucket is outside this region: two same-level
     * regions cannot touch, or the fill would have merged them. So boundary contrast can be
     * accumulated during the fill without tracking membership separately.
     */
    const step = (idx: number, n: number): void => {
      const d = Math.abs(data[idx]! - data[n]!);
      boundarySum += d;
      boundaryCount += 1;
    };

    while (stack.length > 0) {
      const idx = stack.pop()!;
      const x = idx % width;
      const y = (idx - x) / width;
      count += 1;
      sum += data[idx]!;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edge = true;

      if (x > 0) { const n = idx - 1; if (quantise(data[n]!) !== level) step(idx, n); else if (!seen[n]) { seen[n] = 1; stack.push(n); } }
      if (x < width - 1) { const n = idx + 1; if (quantise(data[n]!) !== level) step(idx, n); else if (!seen[n]) { seen[n] = 1; stack.push(n); } }
      if (y > 0) { const n = idx - width; if (quantise(data[n]!) !== level) step(idx, n); else if (!seen[n]) { seen[n] = 1; stack.push(n); } }
      if (y < height - 1) { const n = idx + width; if (quantise(data[n]!) !== level) step(idx, n); else if (!seen[n]) { seen[n] = 1; stack.push(n); } }
    }

    const area = count / total;
    if (area < minArea) continue;

    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const bboxArea = bw * bh;
    regions.push({
      x: x0 / width,
      y: y0 / height,
      w: bw / width,
      h: bh / height,
      area,
      level: sum / count,
      rectFill: count / bboxArea,
      touchesEdge: edge,
      interiorOther: (bboxArea - count) / bboxArea,
      largestEmptyBand: largestEmptyBand(data, width, sum / count, x0, y0, x1, y1),
      boundaryContrast: boundaryCount === 0 ? 0 : boundarySum / boundaryCount,
    });
  }

  return regions.sort((a, b) => b.area - a.area);
}

/**
 * How much of a row may be something other than the region and still read as clear.
 *
 * The absolute floor is not decoration. Sampling at a 192px long edge puts a phone-sized panel at
 * about 33px wide, and the antialiased transition pixel at each end of every row is then 6.1% of
 * that row — just over a 6% share, so a completely empty screen scored zero clear rows and the
 * blank panel in `/brag`'s horse-tinder example went undetected. Two pixels of slack at any scale
 * absorbs the boundary without admitting real content.
 */
const ROW_OTHER_SHARE = 0.06;
const ROW_OTHER_FLOOR = 2;

/**
 * The tallest run of rows inside the bounding box carrying nothing but this region's own colour.
 *
 * Rows rather than a full largest-empty-rectangle search: a UI surface is interrupted by
 * horizontal things — a header, a toolbar, a toast across the bottom — so a horizontal band is
 * the shape the interruption actually takes, and finding the maximal band is linear instead of
 * quadratic.
 *
 * Measured on **luminance**, not on connected-component membership, and that distinction is
 * load-bearing. The first version compared each pixel's component label against the region's and
 * scored `/brag`'s blank phone screen at 0.20, because the screen carries a faint gradient: it
 * fragments across quantisation buckets and its own neighbouring slivers counted as content.
 * Asking whether a pixel *looks* like the region answers the question actually being posed —
 * is anything drawn on this row.
 */
function largestEmptyBand(data: Uint8Array, width: number, level: number, x0: number, y0: number, x1: number, y1: number): number {
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  let best = 0;
  let run = 0;
  for (let y = y0; y <= y1; y++) {
    let other = 0;
    for (let x = x0; x <= x1; x++) if (Math.abs(data[y * width + x]! - level) > INK_THRESHOLD) other += 1;
    if (other <= Math.max(ROW_OTHER_FLOOR, bw * ROW_OTHER_SHARE)) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best / bh;
}

export interface BlankPanelOptions {
  /** Smallest share of the frame worth calling a panel. */
  minArea?: number;
  /** How rectangular it must be. A UI surface is a rectangle; a patch of sky is not. */
  minRectFill?: number;
  /** Upper bound on how much of the bounding box may be something else. A sanity bound, not the gate. */
  maxInteriorOther?: number;
  /** Smallest the shorter side may be, as a share of that axis. A container is not a stripe. */
  minSide?: number;
  /** How much of the panel's height must be uninterrupted before it counts as empty. */
  minEmptyBand?: number;
  /** Minimum luminance step across the boundary. Separates a drawn surface from a lighting effect. */
  minBoundaryContrast?: number;
}

/**
 * Regions that look like a container which should be holding something and is not.
 *
 * Four conditions, and the second is the one doing the real work:
 *
 * 1. **Big enough to read as a surface** — a small flat patch is a shadow or a button.
 * 2. **Does not touch the frame edge** — this is what separates a broken panel from a deliberate
 *    full-bleed ground. `/brag`'s solid orange hook frame and our timid cream one are both single
 *    flat regions covering most of the frame, and both reach all four edges. The horse-tinder
 *    phone screen does not reach any.
 * 3. **Substantial on both axes** — a container is not a stripe. This rule exists because the
 *    first version of this function flagged a line of type: a solid bar of ink is flat, bounded,
 *    rectangular and empty inside, and satisfies every other condition here. Real glyphs also
 *    fail `minRectFill` because letters do not fill their bounding box, but that is a property of
 *    typefaces rather than of the check, and a heavy display line at small sample sizes can come
 *    close to solid. Requiring both sides to be substantial is the rule that does not depend on
 *    how the type happens to render.
 * 4. **Rectangular** — declared UI surfaces are boxes. Loose, because rounded corners and an
 *    element overlapping the panel both eat into this.
 * 5. **Hard-edged** — see `boundaryContrast`. Separates a drawn surface from a glow.
 * 6. **Clear through its body** — see `largestEmptyBand`. A panel with type spread through it is
 *    a panel doing its job; a panel that is uninterrupted from below its header to its footer is
 *    one that forgot to draw its contents.
 *
 * This deliberately says nothing about whether the composition is *good*. It answers one question:
 * is there a box on screen that forgot to draw its contents.
 */
export function blankPanels(frame: GreyFrame, options: BlankPanelOptions = {}): FlatRegion[] {
  const {
    minArea = 0.03,
    minRectFill = 0.7,
    maxInteriorOther = 0.35,
    minSide = 0.15,
    minEmptyBand = 0.55,
    minBoundaryContrast = MIN_BOUNDARY_CONTRAST,
  } = options;
  return flatRegions(frame, minArea).filter(
    (r) =>
      !r.touchesEdge &&
      r.rectFill >= minRectFill &&
      r.interiorOther <= maxInteriorOther &&
      r.w >= minSide &&
      r.h >= minSide &&
      r.largestEmptyBand >= minEmptyBand &&
      r.boundaryContrast >= minBoundaryContrast,
  );
}

/**
 * Ink share inside the outer `inset` band, where nothing should be resting.
 *
 * `SAFE_INSET` is carried over from `scene-spec/src/sceneBounds.ts`, which is being retired. The
 * threshold outlived its call site.
 */
export const SAFE_INSET = 0.05;

export function edgeInk(frame: GreyFrame, inset = SAFE_INSET, background = backgroundLevel(frame)): number {
  const { width, height, data } = frame;
  const mx = Math.floor(width * inset);
  const my = Math.floor(height * inset);
  let ink = 0;
  let count = 0;
  for (let y = 0; y < height; y++) {
    const outsideY = y < my || y >= height - my;
    for (let x = 0; x < width; x++) {
      if (!outsideY && x >= mx && x < width - mx) continue;
      count += 1;
      if (Math.abs(data[y * width + x]! - background) > INK_THRESHOLD) ink += 1;
    }
  }
  return count === 0 ? 0 : ink / count;
}

/** Mean absolute per-pixel difference between two same-sized frames, 0..255. */
export function frameDelta(a: GreyFrame, b: GreyFrame): number {
  if (a.data.length !== b.data.length) throw new Error(`frame size mismatch: ${a.data.length} vs ${b.data.length}`);
  let sum = 0;
  for (let i = 0; i < a.data.length; i++) sum += Math.abs(a.data[i]! - b.data[i]!);
  return sum / a.data.length;
}

/**
 * Smallest boundary step that marks a region as a drawn surface rather than a lighting effect.
 *
 * Calibrated against seven hand-checked candidates across six videos, which is a small corpus and
 * worth saying out loud. The separation it rests on is nonetheless wide: the three real defects
 * step 21, 38 and 44 levels across their boundaries, and the three soft-light false positives
 * step 1, 3 and 8. Fifteen sits in a gap with no observations in it.
 */
export const MIN_BOUNDARY_CONTRAST = 15;
