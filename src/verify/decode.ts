import { execFileSync } from "node:child_process";
import type { GreyFrame } from "./frameMetrics.js";

/**
 * Turning an mp4 into frames this module can measure.
 *
 * Two decisions worth stating, because both were arrived at the hard way:
 *
 * **One decode pass, not one seek per frame.** `masterContactSheet.ts` spawns ffmpeg once per
 * sample with `-ss`, which at 30fps over a 56-second master is ~1,700 process spawns. Decoding
 * straight through and slicing the stream is one spawn. `frameByFrame.ts` already learned this.
 *
 * **Raw greyscale, not PNG on disk.** Writing PNGs and decoding them again needs an image library
 * and a temp directory, and every frame makes two more syscalls than the measurement does work.
 * `-pix_fmt gray -f rawvideo` hands back exactly `width * height` bytes per frame, which is the
 * `GreyFrame` layout with no conversion at all.
 */

/**
 * ffmpeg, from `PATH`.
 *
 * HyperFrames requires ffmpeg on `PATH` and so does this skill, so there is nothing to fall back
 * to and nothing to resolve. The version this was ported from carried a second lookup into
 * `@remotion/compositor-*`, which existed only because that repo had Remotion installed; it is
 * dead weight here.
 *
 * Fails loudly rather than silently, because every measurement downstream depends on it.
 */
export function ffmpegBinary(): string {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  } catch {
    throw new Error("ffmpeg is not on PATH. Install it — `npx hyperframes doctor` checks for it too.");
  }
  return "ffmpeg";
}

export function ffprobeBinary(): string {
  ffmpegBinary();
  return "ffprobe";
}

export interface VideoInfo {
  width: number;
  height: number;
  durationSeconds: number;
  fps: number;
}

export function probeVideo(file: string): VideoInfo {
  const out = execFileSync(
    ffprobeBinary(),
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1", file],
    { encoding: "utf8" },
  );
  const read = (key: string): string | undefined => out.split(/\r?\n/).find((l) => l.startsWith(`${key}=`))?.split("=")[1];
  const width = Number(read("width"));
  const height = Number(read("height"));
  const duration = Number(read("duration"));
  const rate = read("r_frame_rate") ?? "30/1";
  const [num, den] = rate.split("/").map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`could not read dimensions from ${file}`);
  }
  return { width, height, durationSeconds: Number.isFinite(duration) ? duration : 0, fps: (num ?? 30) / (den || 1) };
}

export interface SampledFrame extends GreyFrame {
  /** Source timestamp in seconds. */
  at: number;
}

/**
 * Decode the whole file once at `samplesPerSecond`, scaled so the long edge is `longEdge`.
 *
 * Measuring at full resolution buys nothing: every threshold here is a share of an area, and a
 * flood fill over two million pixels to find a panel that is obvious at 160 is wasted work. The
 * default is small enough to be fast and large enough that a phone-sized UI surface is still a
 * few thousand pixels.
 */
export function sampleFrames(file: string, samplesPerSecond = 2, longEdge = 192): SampledFrame[] {
  const info = probeVideo(file);
  const scale = longEdge / Math.max(info.width, info.height);
  // Even dimensions: rawvideo with an odd width is a common source of off-by-one row shear.
  const width = Math.max(2, Math.round((info.width * scale) / 2) * 2);
  const height = Math.max(2, Math.round((info.height * scale) / 2) * 2);
  const frameBytes = width * height;

  const buffer = execFileSync(
    ffmpegBinary(),
    ["-v", "error", "-i", file, "-vf", `fps=${samplesPerSecond},scale=${width}:${height}`, "-pix_fmt", "gray", "-f", "rawvideo", "-"],
    { maxBuffer: 1024 * 1024 * 1024 },
  );

  const count = Math.floor(buffer.length / frameBytes);
  const frames: SampledFrame[] = [];
  for (let i = 0; i < count; i++) {
    frames.push({
      width,
      height,
      data: new Uint8Array(buffer.subarray(i * frameBytes, (i + 1) * frameBytes)),
      at: i / samplesPerSecond,
    });
  }
  return frames;
}
