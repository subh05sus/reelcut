import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_KEY, detectGreen, Keyer, keyVideo, unionBounds, type KeyParams, type SmallFrame } from "../src/library/chroma.js";
import { hasFfmpeg } from "../src/library/index.js";

const GREEN: [number, number, number] = [0, 246, 0];
const W = 60;
const H = 40;

type Paint = (x: number, y: number) => [number, number, number] | undefined;

/** A frame filled with the backdrop, with `paint` drawing over it wherever it returns a colour. */
function frame(paint: Paint, w = W, h = H): Uint8Array {
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = paint(x, y) ?? GREEN;
      data.set(c, (y * w + x) * 3);
    }
  }
  return data;
}

const params = (over: Partial<KeyParams> = {}): KeyParams => ({ color: "#00f600", ...DEFAULT_KEY, ...over });

function key(data: Uint8Array, over: Partial<KeyParams> = {}, w = W, h = H) {
  const keyer = new Keyer(w, h, params(over));
  const out = new Uint8Array(w * h * 4);
  const result = keyer.frame(data, out);
  const px = (x: number, y: number) => Array.from(out.subarray((y * w + x) * 4, (y * w + x) * 4 + 4));
  return { result, px };
}

const card = (x: number, y: number): [number, number, number] | undefined => (x >= 20 && x < 40 && y >= 10 && y < 30 ? [255, 255, 255] : undefined);

describe("keying one frame", () => {
  it("makes the backdrop transparent and keeps a white subject exactly", () => {
    const { px, result } = key(frame(card));
    expect(px(2, 2)).toEqual([0, 0, 0, 0]);
    expect(px(30, 20)).toEqual([255, 255, 255, 255]);
    expect(result.bounds).toEqual({ x0: 20, y0: 10, x1: 40, y1: 30 });
  });

  it("keeps a black subject, which has no green to confuse it with", () => {
    const { px } = key(frame((x, y) => (card(x, y) ? [0, 0, 0] : undefined)));
    expect(px(30, 20)).toEqual([0, 0, 0, 255]);
  });

  it("turns an anti-aliased edge into partial alpha with the green taken back out", () => {
    // One column half way between white and the backdrop: 0.5·white + 0.5·green.
    const edge: [number, number, number] = [128, 251, 128];
    const { px } = key(frame((x, y) => (x === 19 && y >= 10 && y < 30 ? edge : card(x, y))));
    const [r, g, b, a] = px(19, 20);
    expect(a).toBeGreaterThan(100);
    expect(a).toBeLessThan(160);
    // Unmixed back to the white it was blended from: no green cast left.
    expect(r).toBeGreaterThan(240);
    expect(b).toBeGreaterThan(240);
    expect(g! - Math.max(r!, b!)).toBeLessThanOrEqual(2);
  });

  it("does not let compression noise on the backdrop through", () => {
    const noisy = frame((x, y) => card(x, y) ?? [(x * 7) % 9, 246 - ((y * 5) % 8), (x + y) % 7]);
    const { px } = key(noisy);
    for (const [x, y] of [[1, 1], [10, 35], [55, 5], [58, 38]] as const) expect(px(x, y)[3]).toBe(0);
    expect(px(30, 20)[3]).toBe(255);
  });

  it("leaves green inside the subject alone, because it is not connected to the backdrop", () => {
    const lime: [number, number, number] = [200, 255, 0];
    const { px } = key(frame((x, y) => (x >= 28 && x < 32 && y >= 18 && y < 22 ? lime : card(x, y))));
    expect(px(30, 20)).toEqual([200, 255, 0, 255]);
  });

  describe("a soft shadow on the backdrop", () => {
    // A black shadow at 55% strength just right of the card: (0, 0.45·246, 0).
    const shadow: [number, number, number] = [0, 111, 0];
    const painted = frame((x, y) => (x >= 40 && x < 46 && y >= 12 && y < 32 ? shadow : card(x, y)));

    it("is kept as black with the matching alpha", () => {
      const { px, result } = key(painted, { shadows: "keep" });
      const [r, g, b, a] = px(42, 20);
      expect([r, g, b]).toEqual([0, 0, 0]);
      expect(a).toBeGreaterThan(120);
      expect(a).toBeLessThan(150);
      // The crop includes it.
      expect(result.bounds!.x1).toBe(46);
    });

    it("is removed when the recording says so", () => {
      const { px, result } = key(painted, { shadows: "drop" });
      expect(px(42, 20)[3]).toBe(0);
      expect(result.bounds).toEqual({ x0: 20, y0: 10, x1: 40, y1: 30 });
    });
  });

  it("cuts a hard edge when softness is 0", () => {
    const edge: [number, number, number] = [128, 251, 128];
    const { px } = key(frame((x, y) => (x === 19 && y >= 10 && y < 30 ? edge : card(x, y))), { softness: 0 });
    expect([0, 255]).toContain(px(19, 20)[3]);
  });

  it("eats into the matte by the choke", () => {
    const { px } = key(frame(card), { choke: 1 });
    expect(px(20, 20)[3]).toBe(0);
    expect(px(21, 20)[3]).toBe(255);
  });

  it("finds nothing to key in a frame with no backdrop at the border", () => {
    const { px, result } = key(frame(() => [255, 255, 255]));
    expect(px(5, 5)).toEqual([255, 255, 255, 255]);
    expect(result.backdrop).toBe(0);
  });
});

describe("detecting a green screen", () => {
  const small = (data: Uint8Array): SmallFrame => ({ width: W, height: H, data });

  it("finds a flat green backdrop, and its colour", () => {
    const found = detectGreen([small(frame(card)), small(frame(card))]);
    expect(found.detected).toBe(true);
    expect(found.color).toBe("#00f600");
    expect(found.coverage).toBeGreaterThan(0.7);
    expect(found.border).toBeGreaterThan(0.9);
  });

  it("finds one that only fills part of the frame, like a window in a corner", () => {
    const window = (x: number, y: number): [number, number, number] | undefined => (x < 36 && y < 24 ? [250, 248, 243] : undefined);
    expect(detectGreen([small(frame(window))]).detected).toBe(true);
  });

  it("is not fooled by a white page with a green button", () => {
    const page = frame((x, y) => (x >= 25 && x < 35 && y >= 15 && y < 22 ? GREEN : [250, 250, 250]));
    expect(detectGreen([small(page)]).detected).toBe(false);
  });

  it("is not fooled by a green gradient", () => {
    const gradient = frame((x, y) => [0, 120 + Math.round((x / W) * 135), 0]);
    expect(detectGreen([small(gradient)]).detected).toBe(false);
  });

  it("says no for an ordinary screen recording and for no frames", () => {
    expect(detectGreen([small(frame(() => [30, 30, 40]))]).detected).toBe(false);
    expect(detectGreen([]).detected).toBe(false);
  });
});

describe("where the subject is", () => {
  const b = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
  const size = { width: 100, height: 100 };

  it("is the union over the frames of the moment, with room around it", () => {
    const frames = [b(10, 10, 20, 20), b(30, 10, 40, 20), b(80, 80, 90, 90)];
    expect(unionBounds(frames, 1, 0, 1, size, 2)).toEqual(b(8, 8, 42, 22));
    expect(unionBounds(frames, 1, 2, 2, size, 0)).toEqual(b(80, 80, 90, 90));
  });

  it("skips empty frames, and says nothing when all are empty or the subject fills the frame", () => {
    expect(unionBounds([null, b(10, 10, 20, 20), null], 1, 0, 2, size, 0)).toEqual(b(10, 10, 20, 20));
    expect(unionBounds([null, null], 1, 0, 1, size)).toBeUndefined();
    expect(unionBounds([b(0, 0, 100, 100)], 1, 0, 0, size)).toBeUndefined();
  });
});

describe.runIf(hasFfmpeg())("keying a real video", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "rc-key-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("writes a WebM with an alpha channel, and reports where the subject is in each frame", async () => {
    const src = path.join(dir, "green.mp4");
    // 1 s of a white card sliding right across a green backdrop.
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x00f600:s=160x96:r=15:d=1", "-f", "lavfi", "-i", "color=c=white:s=40x30:r=15:d=1", "-filter_complex", "[0][1]overlay=x=10+t*40:y=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "12", src]);
    const out = path.join(dir, "keyed.webm");
    const result = await keyVideo(src, out, params(), { width: 160, height: 96, fps: 15 });
    expect(existsSync(out)).toBe(true);
    expect(result.frames).toBe(15);
    expect(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream_tags=alpha_mode", "-of", "csv=p=0", out], { encoding: "utf8" }).trim()).toBe("1");

    const first = result.bounds[0]!;
    const last = result.bounds[14]!;
    expect(first.x0).toBeGreaterThanOrEqual(8);
    expect(first.x0).toBeLessThanOrEqual(12);
    expect(last.x0).toBeGreaterThan(first.x0 + 30);
    expect(first.y1 - first.y0).toBeGreaterThanOrEqual(28);

    // Decoded with the VP9 decoder that keeps alpha: the backdrop corner is clear, the card is solid.
    const raw = execFileSync("ffmpeg", ["-v", "error", "-c:v", "libvpx-vp9", "-i", out, "-vf", "select=eq(n\\,0)", "-frames:v", "1", "-pix_fmt", "rgba", "-f", "rawvideo", "-"], { maxBuffer: 1 << 24 });
    const at = (x: number, y: number) => raw[(y * 160 + x) * 4 + 3]!;
    expect(at(2, 2)).toBe(0);
    expect(at(30, 45)).toBeGreaterThan(240);
  }, 60_000);

  it("refuses a file that is not a video, without leaving a half-written output", async () => {
    const out = path.join(dir, "never.webm");
    await expect(keyVideo(path.join(dir, "missing.mp4"), out, params(), { width: 16, height: 16, fps: 15 })).rejects.toThrow();
    expect(existsSync(out)).toBe(false);
    expect(existsSync(`${out}.part.webm`)).toBe(false);
  }, 30_000);
});
