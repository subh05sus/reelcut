import { execFileSync } from "node:child_process";

/**
 * Motion blur, the way a camera makes it: each output frame is the average of the sub-frames its shutter was open
 * for. The beat is rendered at `samples` times the frame rate; frame i averages the first `samples × shutter` of its
 * sub-frames (a 180° shutter at 0.5), so a fast move smears along its path and a still one stays sharp. It costs
 * `samples` times the render, so it is a choice made per reel.
 */

/** HyperFrames resolution presets at 2x: the same layout, four times the pixels. */
export const SCALE_PRESET: Record<string, string> = { "1:1": "square-4k", "9:16": "portrait-4k", "16:9": "landscape-4k" };

export function blurFrames(samples: number, shutter = 0.5): number {
  return Math.max(1, Math.min(samples, Math.round(samples * shutter)));
}

/** Blend a render made at `fps × samples` down to `fps`. Keeps the frame count exact and the colour tags. */
export function applyMotionBlur(input: string, output: string, options: { fps: number; samples: number; shutter?: number; crf?: number }): void {
  const s = Math.max(2, Math.round(options.samples));
  const k = blurFrames(s, options.shutter);
  // tmix averages the current sub-frame with the k-1 before it; keep the sub-frame that closes each shutter.
  const vf = `tmix=frames=${k},select='eq(mod(n\\,${s})\\,${k - 1})',setpts=N/(${options.fps}*TB)`;
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", input, "-vf", vf, "-r", String(options.fps), "-an", "-c:v", "libx264", "-crf", String(options.crf ?? 16), "-preset", "medium", "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", output]);
}
