import type { VideoReport } from "../verify/checkVideo.js";

/**
 * Which frame should be the thumbnail.
 *
 * Frame 0 of a reel is its thumbnail on every platform, and frame 0 is the worst possible choice:
 * by design it is the first instant of an entrance — legible, because opacity leads position, but
 * one word at 55% opacity on an otherwise empty field. The reel this was built against had exactly
 * that: "Notara" in grey on beige, as the image everyone would see before pressing play.
 *
 * The rule is two conditions, in order:
 *
 * 1. **Settled.** A frame inside a hold, not mid-transition. A thumbnail caught halfway through an
 *    entrance shows half-faded type and elements in flight, which reads as a glitch. The frame
 *    checker already finds the holds.
 * 2. **Fullest.** Among settled frames, the one with the most on screen. Not a perfect proxy for
 *    "strongest", but a settled frame with more ink is nearly always the finished composition
 *    rather than its opening.
 *
 * An explicit time in the manifest overrides both, because the strongest frame is ultimately a
 * judgement, and when someone has made it the machine should not second-guess it.
 *
 * ## Search the hook first
 *
 * "Fullest settled frame across the whole reel" was the first rule, and on the first real render it
 * chose a frame from the middle of the argument — an abstract nested outline about research
 * projects, picked because its bars carried the most ink. As a thumbnail it said nothing about
 * what the video was. The hook, a few seconds earlier, named both products in their own colours.
 *
 * Ink is not meaning. The hook is, by construction, the beat whose job is to say what the video is
 * about, so when its span is known the search is confined to it, and only falls back to the whole
 * reel if the hook has nothing settled in it.
 */

/** Frames this close to the start are the entrance the poster exists to replace. */
export const POSTER_MIN_SECONDS = 0.5;

export interface PosterChoice {
  at: number;
  reason: "override" | "hook_settled" | "settled_fullest" | "fullest";
  ink?: number;
}

export interface PosterWindow {
  from: number;
  to: number;
}

export function choosePosterTime(report: VideoReport, override?: number, hook?: PosterWindow): PosterChoice {
  if (override !== undefined && override >= 0) return { at: override, reason: "override" };

  const inHoldAt = (at: number): boolean => report.staticRuns.some((run) => at >= run.from && at <= run.to);

  if (hook) {
    const inHook = report.frames.filter((f) => f.at >= Math.max(POSTER_MIN_SECONDS, hook.from) && f.at < hook.to && inHoldAt(f.at));
    if (inHook.length > 0) {
      const best = inHook.reduce((a, f) => (f.ink > a.ink ? f : a), inHook[0]!);
      return { at: best.at, reason: "hook_settled", ink: best.ink };
    }
  }

  const usable = report.frames.filter((f) => f.at >= POSTER_MIN_SECONDS);
  const pool = usable.length > 0 ? usable : report.frames;

  const inHold = (at: number): boolean => report.staticRuns.some((run) => at >= run.from && at <= run.to);
  const settled = pool.filter((f) => inHold(f.at));

  const pick = (frames: typeof pool) =>
    frames.reduce((best, f) => (f.ink > best.ink ? f : best), frames[0]!);

  if (settled.length > 0) {
    const best = pick(settled);
    return { at: best.at, reason: "settled_fullest", ink: best.ink };
  }
  const best = pick(pool);
  return { at: best.at, reason: "fullest", ink: best.ink };
}
