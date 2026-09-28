/** Minimal, strict SubRip (.srt) parser. Fails loudly on a malformed timestamp line rather than
 * silently skipping a cue — a dropped cue would desync every beat timed after it. */

export interface SrtCue {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

const TIMESTAMP_LINE = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/;

function parseTimestamp(h: string, m: string, s: string, ms: string): number {
  return (Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000 + Number(ms);
}

export function parseSrt(srtText: string): SrtCue[] {
  const normalized = srtText.replace(/\r\n/g, "\n").replace(/﻿/, ""); // strip BOM
  const blocks = normalized.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);

  const cues: SrtCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 2) {
      throw new Error(`parseSrt: malformed cue block (fewer than 2 lines): '${block.slice(0, 80)}'`);
    }

    // First line is normally a numeric index, but some exports omit it — detect by trying the
    // timestamp regex against line 0 as well as line 1.
    let timestampLineIdx = 0;
    let indexValue = cues.length + 1;
    if (!TIMESTAMP_LINE.test(lines[0]!)) {
      const parsedIndex = Number(lines[0]);
      if (Number.isFinite(parsedIndex)) indexValue = parsedIndex;
      timestampLineIdx = 1;
    }

    const timestampLine = lines[timestampLineIdx];
    if (!timestampLine) {
      throw new Error(`parseSrt: missing timestamp line in cue block: '${block.slice(0, 80)}'`);
    }
    const match = TIMESTAMP_LINE.exec(timestampLine);
    if (!match) {
      throw new Error(`parseSrt: could not parse timestamp line '${timestampLine}' — expected 'HH:MM:SS,mmm --> HH:MM:SS,mmm'`);
    }

    const [, h1, m1, s1, ms1, h2, m2, s2, ms2] = match as unknown as [string, string, string, string, string, string, string, string, string];
    const startMs = parseTimestamp(h1, m1, s1, ms1);
    const endMs = parseTimestamp(h2, m2, s2, ms2);
    if (endMs <= startMs) {
      throw new Error(`parseSrt: cue ${indexValue} has endMs (${endMs}) <= startMs (${startMs})`);
    }

    const text = lines
      .slice(timestampLineIdx + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "") // strip basic formatting tags (<i>, <b>, ...)
      .replace(/\s+/g, " ")
      .trim();

    if (!text) {
      throw new Error(`parseSrt: cue ${indexValue} has no text`);
    }

    cues.push({ index: indexValue, startMs, endMs, text });
  }

  if (cues.length === 0) {
    throw new Error("parseSrt: no cues found in .srt file");
  }

  // Cues must be non-decreasing in time — an out-of-order .srt would break every downstream
  // frame-boundary computation that assumes a monotonic timeline.
  for (let i = 1; i < cues.length; i++) {
    if (cues[i]!.startMs < cues[i - 1]!.endMs) {
      throw new Error(`parseSrt: cue ${cues[i]!.index} starts (${cues[i]!.startMs}ms) before cue ${cues[i - 1]!.index} ends (${cues[i - 1]!.endMs}ms) — .srt is not time-ordered`);
    }
  }

  return cues;
}
