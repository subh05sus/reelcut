import { describe, expect, it } from "vitest";
import { POSTER_MIN_SECONDS, choosePosterTime } from "../src/render/poster.js";
import type { VideoReport } from "../src/verify/checkVideo.js";

function report(frames: [number, number][], holds: [number, number][] = []): VideoReport {
  return {
    file: "x.mp4",
    info: { width: 1080, height: 1080, durationSeconds: 10, fps: 30 },
    samplesPerSecond: 2,
    frames: frames.map(([at, ink]) => ({ at, ink, edgeInk: 0, grid: [] })),
    findings: [],
    relaxed: [],
    staticRuns: holds.map(([from, to]) => ({ from, to, seconds: to - from })),
    deadCells: [],
  };
}

describe("choosePosterTime", () => {
  /*
   * The reason this exists: frame 0 is the first instant of an entrance, and the reel it was built
   * against had one grey word on beige as its thumbnail.
   */
  it("never picks the opening entrance", () => {
    const choice = choosePosterTime(report([[0, 0.9], [1, 0.3], [2, 0.4]], [[1, 2]]));
    expect(choice.at).toBeGreaterThanOrEqual(POSTER_MIN_SECONDS);
  });

  it("prefers a settled frame over a fuller one caught mid-transition", () => {
    // 3.0 has the most ink but is not inside a hold; 5.0 is settled.
    const choice = choosePosterTime(report([[1, 0.1], [3, 0.5], [5, 0.3], [7, 0.2]], [[4.5, 6]]));
    expect(choice.at).toBe(5);
    expect(choice.reason).toBe("settled_fullest");
  });

  it("takes the fullest of the settled frames", () => {
    const choice = choosePosterTime(report([[1, 0.2], [2, 0.3], [5, 0.25], [6, 0.35]], [[1, 2], [5, 6]]));
    expect(choice.at).toBe(6);
  });

  it("falls back to the fullest frame when nothing ever holds", () => {
    const choice = choosePosterTime(report([[1, 0.2], [2, 0.6], [3, 0.4]]));
    expect(choice.at).toBe(2);
    expect(choice.reason).toBe("fullest");
  });

  /*
   * The strongest frame is ultimately a judgement. When someone has made it, the machine should not
   * second-guess it.
   */
  it("honours an explicit override", () => {
    expect(choosePosterTime(report([[1, 0.9]], [[1, 2]]), 4.6)).toEqual({ at: 4.6, reason: "override" });
  });

  it("uses frame 0 only when the reel is shorter than the entrance window", () => {
    const choice = choosePosterTime(report([[0, 0.3], [0.25, 0.4]]));
    expect(choice.at).toBe(0.25);
  });

  /*
   * The first real render chose an abstract mid-argument diagram because it carried the most ink.
   * The hook, which named both products, was the right thumbnail. Ink is not meaning.
   */
  it("prefers a settled frame from the hook over a fuller one later in the reel", () => {
    const r = report([[1, 0.1], [4, 0.2], [12, 0.6]], [[0.5, 6], [11, 13]]);
    const choice = choosePosterTime(r, undefined, { from: 0, to: 6.667 });
    expect(choice.at).toBe(4);
    expect(choice.reason).toBe("hook_settled");
  });

  it("falls back to the whole reel when nothing in the hook holds", () => {
    const r = report([[1, 0.1], [4, 0.2], [12, 0.6]], [[11, 13]]);
    expect(choosePosterTime(r, undefined, { from: 0, to: 6.667 }).at).toBe(12);
  });

  it("lets an override beat the hook", () => {
    const r = report([[4, 0.2]], [[0.5, 6]]);
    expect(choosePosterTime(r, 9, { from: 0, to: 6.667 })).toEqual({ at: 9, reason: "override" });
  });
});
