import { framesToMs, msToFrames, type PlanningLogEntry, type PlanWarning } from "../core/index.js";
import { WORDS_PER_SECOND_ESTIMATE } from "../core/index.js";
import type { ScriptSegment } from "./parseScript.js";
import type { SrtCue } from "./parseSrt.js";

/** Timing-only beat shell — visualType/description are filled in later by the classifier. */
export interface BeatTiming {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  startFrame: number;
  endFrame: number;
  sourceText: string;
}

export interface SegmentationResult {
  timings: BeatTiming[];
  totalDurationMs: number;
  totalDurationFrames: number;
  pacingSource: "estimated_wpm" | "srt_exact";
  planningLog: PlanningLogEntry[];
  warnings: PlanWarning[];
}

function beatId(index: number): string {
  return `beat_${String(index).padStart(2, "0")}`;
}

/**
 * Estimated pacing (no .srt): ~2.7 words/second, frame-quantized once here (never re-rounded
 * downstream — see LEARNINGS.md "frames are authoritative"). Each segment's frame boundary is
 * derived from the running cursor, not computed independently, so contiguity holds by
 * construction rather than by coincidence.
 */
function computeEstimatedTimings(segments: ScriptSegment[], fps: number): { timings: BeatTiming[]; totalDurationFrames: number } {
  const timings: BeatTiming[] = [];
  let frameCursor = 0;

  segments.forEach((segment, i) => {
    const durationMs = (segment.wordCount / WORDS_PER_SECOND_ESTIMATE) * 1000;
    const durationFrames = Math.max(1, Math.round((durationMs / 1000) * fps));
    const startFrame = frameCursor;
    const endFrame = startFrame + durationFrames;
    timings.push({
      id: beatId(i),
      index: i,
      startFrame,
      endFrame,
      startMs: framesToMs(startFrame, fps),
      endMs: framesToMs(endFrame, fps),
      sourceText: segment.text,
    });
    frameCursor = endFrame;
  });

  return { timings, totalDurationFrames: frameCursor };
}

/** One word of an SRT cue, with its interpolated start-ms boundary within that cue. Cues don't
 * carry per-word timestamps, so each word is given an equal slice of its cue's duration — an
 * approximation, not a transcript-level alignment. */
export function buildSrtWordTimeline(cues: SrtCue[]): { boundaries: number[]; words: string[] } {
  const boundaries: number[] = [];
  const words: string[] = [];
  for (const cue of cues) {
    const cueWords = cue.text.split(/\s+/).filter(Boolean);
    cueWords.forEach((word, i) => {
      const ms = cue.startMs + (i / cueWords.length) * (cue.endMs - cue.startMs);
      boundaries.push(ms);
      words.push(word);
    });
  }
  boundaries.push(cues[cues.length - 1]!.endMs); // sentinel end boundary
  return { boundaries, words };
}

function normalizeForOverlap(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-zäöüß0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

const ALIGNMENT_OVERLAP_THRESHOLD = 0.4;
const DURATION_MISMATCH_THRESHOLD = 0.1; // 10%

/**
 * SRT-exact pacing: proportionally maps each script segment's word-index range onto the SRT's
 * word-index timeline. This does NOT require the script and the spoken/transcribed .srt text to
 * match word-for-word (people deviate from a script when speaking) — it assumes they track the
 * same overall structure and length, which is what "contiguous span of cues" means in practice.
 * Per-beat alignment quality is checked separately (word overlap) and flagged, never silently
 * trusted.
 */
function computeSrtTimings(
  segments: ScriptSegment[],
  cues: SrtCue[],
  fps: number,
): { timings: BeatTiming[]; totalDurationFrames: number; warnings: PlanWarning[] } {
  const { boundaries, words: srtWords } = buildSrtWordTimeline(cues);
  const totalSrtWords = srtWords.length;
  const totalSrtDurationMs = cues[cues.length - 1]!.endMs;

  const totalScriptWords = segments.reduce((sum, s) => sum + s.wordCount, 0);
  const estimatedDurationMs = (totalScriptWords / WORDS_PER_SECOND_ESTIMATE) * 1000;

  const warnings: PlanWarning[] = [];
  const relativeDiff = Math.abs(estimatedDurationMs - totalSrtDurationMs) / totalSrtDurationMs;
  if (relativeDiff > DURATION_MISMATCH_THRESHOLD) {
    warnings.push({
      code: "srt_duration_mismatch",
      message: `Estimated script duration (${Math.round(estimatedDurationMs)}ms @ ${WORDS_PER_SECOND_ESTIMATE} words/s) differs from .srt total duration (${totalSrtDurationMs}ms) by ${(relativeDiff * 100).toFixed(1)}% — using .srt timing as authoritative (pacingSource: srt_exact), but the mismatch itself is not silently ignored.`,
    });
  }

  function msForScriptWordIndex(wordIdx: number): number {
    const srtIdx = Math.round((wordIdx / totalScriptWords) * totalSrtWords);
    const clamped = Math.min(Math.max(srtIdx, 0), boundaries.length - 1);
    return boundaries[clamped]!;
  }

  const timings: BeatTiming[] = [];
  let cumulativeWords = 0;
  let frameCursor = 0;
  const totalDurationFramesTarget = msToFrames(totalSrtDurationMs, fps);

  segments.forEach((segment, i) => {
    const wStart = cumulativeWords;
    cumulativeWords += segment.wordCount;
    const wEnd = cumulativeWords;
    const isLast = i === segments.length - 1;

    const rawStartMs = msForScriptWordIndex(wStart);
    const rawEndMs = isLast ? totalSrtDurationMs : msForScriptWordIndex(wEnd);

    let startFrame = frameCursor;
    let endFrame = isLast ? totalDurationFramesTarget : msToFrames(rawEndMs, fps);
    if (endFrame <= startFrame) endFrame = startFrame + 1; // guarantee monotonic, non-zero duration

    // Alignment check: does the segment's own text share meaningful words with the SRT words
    // that fall inside its assigned time span?
    const spanWords = srtWords.filter((_, wi) => wi >= wStart && wi < wEnd);
    const segTokens = normalizeForOverlap(segment.text);
    const spanTokens = normalizeForOverlap(spanWords.join(" "));
    const overlap = [...segTokens].filter((t) => spanTokens.has(t)).length;
    const overlapRatio = segTokens.size === 0 ? 1 : overlap / segTokens.size;
    if (overlapRatio < ALIGNMENT_OVERLAP_THRESHOLD) {
      warnings.push({
        code: "srt_beat_alignment_mismatch",
        message: `${beatId(i)}: script text does not cleanly align with its mapped .srt span (word overlap ${(overlapRatio * 100).toFixed(0)}%) — timing was proportionally mapped, not silently forced; verify against the .srt manually. Segment: "${segment.text.slice(0, 60)}..."`,
      });
    }

    timings.push({
      id: beatId(i),
      index: i,
      startFrame,
      endFrame,
      startMs: framesToMs(startFrame, fps),
      endMs: framesToMs(endFrame, fps),
      sourceText: segment.text,
    });
    frameCursor = endFrame;
    void rawStartMs;
  });

  // The last beat must land exactly on totalDurationFrames per the BeatPlan schema invariant.
  // If per-segment monotonic bumps pushed the cursor past the SRT-derived target, the target
  // grows to match rather than violating contiguity.
  const totalDurationFrames = Math.max(frameCursor, totalDurationFramesTarget);
  if (timings.length > 0 && timings[timings.length - 1]!.endFrame !== totalDurationFrames) {
    const last = timings[timings.length - 1]!;
    last.endFrame = totalDurationFrames;
    last.endMs = framesToMs(totalDurationFrames, fps);
  }

  return { timings, totalDurationFrames, warnings };
}

export interface SegmentBeatsOptions {
  segments: ScriptSegment[];
  srtCues?: SrtCue[];
  fps: number;
  lowConfidenceSegmentation: boolean;
}

export function segmentBeats(options: SegmentBeatsOptions): SegmentationResult {
  const { segments, srtCues, fps, lowConfidenceSegmentation } = options;
  const planningLog: PlanningLogEntry[] = [];
  const warnings: PlanWarning[] = [];

  if (lowConfidenceSegmentation) {
    planningLog.push({
      type: "low_confidence_segmentation",
      message: "No sentence-ending punctuation found in a script long enough to expect it — fell back to fixed-duration word chunking. Segmentation quality for this plan should be spot-checked.",
    });
  }

  if (srtCues && srtCues.length > 0) {
    const { timings, totalDurationFrames, warnings: srtWarnings } = computeSrtTimings(segments, srtCues, fps);
    return {
      timings,
      totalDurationFrames,
      totalDurationMs: framesToMs(totalDurationFrames, fps),
      pacingSource: "srt_exact",
      planningLog,
      warnings: [...warnings, ...srtWarnings],
    };
  }

  const { timings, totalDurationFrames } = computeEstimatedTimings(segments, fps);
  const totalDurationMs = framesToMs(totalDurationFrames, fps);

  if (totalDurationMs < 10_000) {
    warnings.push({
      code: "short_script_density_not_applicable",
      message: `Estimated duration is ${totalDurationMs}ms (<10s) — the 5-8 visuals/30s density target may not fully apply to a Reel this short; density enforcement will be skipped.`,
    });
  }

  return {
    timings,
    totalDurationFrames,
    totalDurationMs,
    pacingSource: "estimated_wpm",
    planningLog,
    warnings,
  };
}
