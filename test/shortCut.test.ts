import { describe, expect, it } from "vitest";
import {
  SHORT_CUT_MAX_SECONDS,
  SHORT_CUT_MIN_SECONDS,
  planShortCut,
  validateShortCut,
  type CutBeat,
  type ShortCut,
  startsSentence,
} from "../src/planner/shortCut.js";

/** The real shape of reel 765c6d40: 14 directed beats over 55.8s. */
function reel(): CutBeat[] {
  const lines = [
    "Instagram-Agent Skills",
    "Zwei Werkzeuge, ein Ziel.",
    "Claude arbeitet mit Kontext.",
    "ChatGPT verfolgt einen anderen Ansatz.",
    "Und beim Programmieren?",
    "Beide haben klare Stärken.",
    "Nicht welcher besser ist.",
    "Welcher passt für deine Aufgabe?",
    "Viele Aufgaben? Vielseitiger Workflow?",
    "ChatGPT punktet mit Breite.",
    "Claude punktet mit Tiefe.",
    "Nutze einfach beide.",
  ];
  return lines.map((text, i) => ({ id: `beat_${String(i).padStart(2, "0")}`, index: i, text, durationMs: 4000 }));
}

function asCut(beats: CutBeat[], roles?: ("hook" | "highlight" | "payoff")[]): ShortCut {
  const chosen = beats.map((b, i) => ({
    ...b,
    role: roles?.[i] ?? (i === 0 ? ("hook" as const) : i === beats.length - 1 ? ("payoff" as const) : ("highlight" as const)),
    seconds: b.durationMs / 1000,
  }));
  return { beats: chosen, totalSeconds: Number(chosen.reduce((s, b) => s + b.seconds, 0).toFixed(3)) };
}

describe("planShortCut", () => {
  it("lands inside the postable window", () => {
    const cut = planShortCut(reel());
    expect("beats" in cut).toBe(true);
    if (!("beats" in cut)) throw new Error("expected a cut");
    expect(cut.totalSeconds).toBeGreaterThanOrEqual(SHORT_CUT_MIN_SECONDS);
    expect(cut.totalSeconds).toBeLessThanOrEqual(SHORT_CUT_MAX_SECONDS);
    expect(validateShortCut(cut)).toEqual([]);
  });

  it("keeps the reel's own first and last beats as hook and payoff", () => {
    const cut = planShortCut(reel());
    if (!("beats" in cut)) throw new Error("expected a cut");
    expect(cut.beats[0]!.id).toBe("beat_00");
    expect(cut.beats[0]!.role).toBe("hook");
    expect(cut.beats[cut.beats.length - 1]!.id).toBe("beat_11");
    expect(cut.beats[cut.beats.length - 1]!.role).toBe("payoff");
  });

  it("preserves source order", () => {
    const cut = planShortCut(reel());
    if (!("beats" in cut)) throw new Error("expected a cut");
    const indices = cut.beats.map((b) => b.index);
    expect([...indices].sort((a, b) => a - b)).toEqual(indices);
  });

  /*
   * A cut made of the first five beats is the reel's opening, not a summary of it. The middle is
   * taken from the centre outwards so the surviving beats span the argument.
   */
  it("spreads the middle across the reel instead of taking the front", () => {
    const cut = planShortCut(reel());
    if (!("beats" in cut)) throw new Error("expected a cut");
    const middle = cut.beats.slice(1, -1);
    expect(middle.length).toBeGreaterThan(0);
    expect(Math.max(...middle.map((b) => b.index))).toBeGreaterThan(4);
  });

  /*
   * The defect the first version shipped: sorting the middle by distance from the centre picked
   * beats 7, 8, 9 and 10 of the real reel — four consecutive beats. A contiguous slab out of the
   * middle is the same mistake as taking the front. It is an excerpt, not a summary.
   */
  it("does not take a contiguous slab out of the middle", () => {
    const cut = planShortCut(reel());
    if (!("beats" in cut)) throw new Error("expected a cut");
    const middle = cut.beats.slice(1, -1).map((b) => b.index);
    expect(middle.length).toBeGreaterThanOrEqual(2);
    const everyStepIsOne = middle.every((idx, i) => i === 0 || idx - middle[i - 1]! === 1);
    expect(everyStepIsOne).toBe(false);
    // and the sample should reach across the middle, not sit in one third of it
    expect(Math.max(...middle) - Math.min(...middle)).toBeGreaterThanOrEqual(middle.length);
  });

  it("drops a beat whose line cannot be read in its own duration rather than including it", () => {
    const beats = reel();
    beats[5] = { ...beats[5]!, text: "Ein sehr viel längerer Satz der unmöglich in dieser Zeit gelesen werden kann", durationMs: 900 };
    const cut = planShortCut(beats);
    if (!("beats" in cut)) throw new Error("expected a cut");
    expect(cut.beats.some((b) => b.id === "beat_05")).toBe(false);
    expect(validateShortCut(cut)).toEqual([]);
  });

  it("never compresses a beat below its reading floor", () => {
    const cut = planShortCut(reel());
    if (!("beats" in cut)) throw new Error("expected a cut");
    for (const beat of cut.beats) {
      expect(beat.seconds).toBeGreaterThanOrEqual(0.8);
    }
  });

  it("refuses when there is nothing readable to cut", () => {
    const result = planShortCut([{ id: "a", index: 0, text: "Viel zu viele Wörter für eine sehr kurze Zeit hier", durationMs: 300 }]);
    expect("issues" in result).toBe(true);
  });

  it("honours a lower target", () => {
    const cut = planShortCut(reel(), { targetSeconds: 16 });
    if (!("beats" in cut)) throw new Error("expected a cut");
    expect(cut.totalSeconds).toBeLessThanOrEqual(SHORT_CUT_MAX_SECONDS);
  });
});

describe("validateShortCut", () => {
  it("rejects an empty cut", () => {
    expect(validateShortCut({ beats: [], totalSeconds: 0 })[0]!.message).toMatch(/empty/);
  });

  it("rejects a cut that is too short to say anything", () => {
    const cut = asCut(reel().slice(0, 2));
    expect(validateShortCut(cut).some((i) => /under the 15s floor/.test(i.message))).toBe(true);
  });

  it("rejects a cut that has stopped being postable", () => {
    const cut = asCut(reel());
    expect(validateShortCut(cut).some((i) => /over the 25s ceiling/.test(i.message))).toBe(true);
  });

  it("rejects a cut that does not open on a hook", () => {
    const cut = asCut(reel().slice(0, 5), ["highlight", "highlight", "highlight", "highlight", "payoff"]);
    expect(validateShortCut(cut).some((i) => /must be the hook/.test(i.message))).toBe(true);
  });

  it("rejects a cut that stops rather than lands", () => {
    const cut = asCut(reel().slice(0, 5), ["hook", "highlight", "highlight", "highlight", "highlight"]);
    expect(validateShortCut(cut).some((i) => /must be the payoff/.test(i.message))).toBe(true);
  });

  it("rejects reordered beats", () => {
    const beats = reel().slice(0, 5);
    const swapped = [beats[0]!, beats[3]!, beats[2]!, beats[1]!, beats[4]!];
    expect(validateShortCut(asCut(swapped)).some((i) => /out of source order/.test(i.message))).toBe(true);
  });

  it("rejects a beat squeezed under its reading floor", () => {
    const cut = asCut(reel().slice(0, 5));
    cut.beats[2]!.seconds = 0.4;
    cut.totalSeconds = Number(cut.beats.reduce((s, b) => s + b.seconds, 0).toFixed(3));
    expect(validateShortCut(cut).some((i) => /drop the beat rather than outrunning it/.test(i.message))).toBe(true);
  });

  it("catches a totalSeconds that disagrees with the beats", () => {
    const cut = asCut(reel().slice(0, 5));
    cut.totalSeconds = 99;
    expect(validateShortCut(cut).some((i) => /beats sum to/.test(i.message))).toBe(true);
  });
});

describe("sentence fragments", () => {
  it("knows a continuation from a start", () => {
    expect(startsSentence("es verliert den Faden nicht.")).toBe(false);
    expect(startsSentence("Kettlebrief ist der Allrounder.")).toBe(true);
    expect(startsSentence("„Nicht welcher besser ist.")).toBe(true);
    expect(startsSentence("…und dann")).toBe(false);
  });

  /*
   * The defect found by running the planner on the example script: it chose "es verliert den
   * Faden nicht" as a highlight — the tail of a sentence whose head was a different beat.
   */
  it("never picks a fragment as a highlight when a standalone beat exists", () => {
    const beats = reel();
    beats[4] = { ...beats[4]!, text: "es verliert den Faden nicht und bleibt dabei." };
    beats[6] = { ...beats[6]!, text: "und genau darum geht es hier am Ende." };
    const cut = planShortCut(beats);
    if (!("beats" in cut)) throw new Error("expected a cut");
    for (const b of cut.beats.slice(1, -1)) expect(startsSentence(b.text)).toBe(true);
  });

  it("still produces a cut when every middle beat is a fragment", () => {
    const beats = reel().map((b, i) => (i === 0 || i === 11 ? b : { ...b, text: `und ${b.text.toLowerCase()}` }));
    const cut = planShortCut(beats);
    expect("beats" in cut).toBe(true);
  });
});
