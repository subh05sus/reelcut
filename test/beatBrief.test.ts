import { describe, expect, it } from "vitest";
import { MIN_ENTRANCE_SECONDS, colourDistance, parseBeatBrief, readingFloorSeconds, validateBeatBrief, type BeatBrief } from "../src/brief/beatBrief.js";

/** beat_11 of reel 765c6d40, as a brief. The beat the whole phase was diagnosed on. */
function beat11(overrides: Partial<BeatBrief> = {}): BeatBrief {
  return {
    intent: "Contrast two tools and refuse to name a winner",
    mustRead: ["Nicht welcher besser ist.", "Kein Sieger"],
    emphasis: ["Nicht", "besser", "Kein"],
    mustShow: ["the ChatGPT wordmark", "the Claude wordmark"],
    composition: "The field divides into two equal halves; at the payoff the division dissolves and the answer takes the space the comparison held.",
    phases: [
      { at: 0, does: "the claim arrives and the field divides" },
      { at: 0.6, does: "the first case settles" },
      { at: 0.95, does: "the second case settles, equal weight" },
      { at: 2.2, does: "the division dissolves and the field clears" },
      { at: 2.66, does: "the answer lands and holds" },
    ],
    palette: { ground: "#ede9e3", ink: "#14110e", accent: "#d02d1c" },
    durationSeconds: 4.07,
    ...overrides,
  };
}

describe("readingFloorSeconds", () => {
  it("gives a short label the label floor", () => {
    expect(readingFloorSeconds("Kein Sieger")).toBe(0.8);
    expect(readingFloorSeconds("Stärken")).toBe(0.8);
  });

  it("scales a sentence by word count but never below the sentence minimum", () => {
    // Four words would be 1.2 by rate and 1.2 by floor — the boundary case.
    expect(readingFloorSeconds("Nicht welcher besser ist.")).toBeCloseTo(1.2, 5);
    expect(readingFloorSeconds("Welcher passt für deine Aufgabe wirklich am besten?")).toBeCloseTo(2.4, 5);
  });

  it("is zero for nothing, rather than NaN", () => {
    expect(readingFloorSeconds("   ")).toBe(0);
  });
});

describe("validateBeatBrief", () => {
  it("accepts the beat_11 brief", () => {
    expect(validateBeatBrief(beat11())).toEqual([]);
  });

  /*
   * The defect this gate exists for.
   *
   * The compiled beat_11 scheduled "Kein Sieger" into frames 97-122 of 122 — 0.83s including its
   * own entrance. No gate in the old pipeline could see that, because the slot was filled, the
   * bounds were legal and the motion score was fine. Stated as a brief, it is arithmetic.
   */
  it("rejects a payoff that cannot be read in the time it has", () => {
    const issues = validateBeatBrief(beat11({ durationSeconds: 1.0 }));
    expect(issues.some((i) => i.field === "mustRead" && /Nicht welcher besser ist/.test(i.message))).toBe(true);
  });

  it("lets a short label live in a short beat", () => {
    const shortPhases = [
      { at: 0, does: "the label arrives" },
      { at: 0.35, does: "and holds" },
    ];
    const issues = validateBeatBrief(beat11({ mustRead: ["Kein Sieger"], emphasis: ["Kein"], durationSeconds: 1.2, phases: shortPhases }));
    expect(issues).toEqual([]);
    expect(0.8 + MIN_ENTRANCE_SECONDS).toBeLessThanOrEqual(1.2);
  });

  it("rejects emphasis on a word the script never says", () => {
    const issues = validateBeatBrief(beat11({ emphasis: ["Gewinner"] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.field).toBe("emphasis");
    expect(issues[0]!.message).toMatch(/does not occur/);
  });

  /*
   * German emphasis lands on inflected forms and inside compounds. Requiring exact token equality
   * would reject legitimate accents, so the match is substring-on-normalised-text.
   */
  it("accepts emphasis on an inflected form or a compound part", () => {
    const brief = beat11({ mustRead: ["Der bessere Workflow gewinnt."], emphasis: ["besser", "Workflow"] });
    expect(validateBeatBrief(brief)).toEqual([]);
  });

  it("ignores case and punctuation when matching emphasis", () => {
    const phases = [
      { at: 0, does: "the label arrives" },
      { at: 0.5, does: "and holds" },
    ];
    expect(validateBeatBrief(beat11({ mustRead: ["Kein Sieger!"], emphasis: ["kein sieger"], durationSeconds: 2, phases }))).toEqual([]);
  });

  it("rejects a beat that opens on a still frame", () => {
    const issues = validateBeatBrief(beat11({ phases: [{ at: 2.0, does: "something finally happens" }, { at: 3.0, does: "and again" }] }));
    expect(issues.some((i) => i.field === "phases" && /still frame/.test(i.message))).toBe(true);
  });

  it("rejects phases out of order", () => {
    const issues = validateBeatBrief(
      beat11({ phases: [{ at: 0, does: "first" }, { at: 2.0, does: "third" }, { at: 1.0, does: "second" }] }),
    );
    expect(issues.some((i) => /must be ordered/.test(i.message))).toBe(true);
  });

  it("rejects a phase past the end of the beat", () => {
    const issues = validateBeatBrief(beat11({ phases: [{ at: 0, does: "start" }, { at: 99, does: "never" }] }));
    expect(issues.some((i) => /past the end/.test(i.message))).toBe(true);
  });

  it("rejects an accent that cannot be told from the ink", () => {
    const issues = validateBeatBrief(beat11({ palette: { ground: "#ede9e3", ink: "#14110e", accent: "#1a1614" } }));
    expect(issues.some((i) => i.field === "palette" && /accent/.test(i.message))).toBe(true);
  });

  it("rejects ink that cannot be told from the ground", () => {
    const issues = validateBeatBrief(beat11({ palette: { ground: "#ede9e3", ink: "#e0dcd6", accent: "#d02d1c" } }));
    expect(issues.some((i) => i.field === "palette" && /ink/.test(i.message))).toBe(true);
  });

  it("does not police the accent when nothing is emphasised", () => {
    const issues = validateBeatBrief(beat11({ emphasis: [], palette: { ground: "#ede9e3", ink: "#14110e", accent: "#1a1614" } }));
    expect(issues).toEqual([]);
  });

  it("rejects more reading than the lines can share", () => {
    const issues = validateBeatBrief(
      beat11({
        mustRead: ["Ein ziemlich langer erster Satz hier", "Ein ziemlich langer zweiter Satz hier", "Ein ziemlich langer dritter Satz hier"],
        emphasis: [],
        durationSeconds: 2.5,
      }),
    );
    expect(issues.some((i) => /more than they can share/.test(i.message))).toBe(true);
  });
});

describe("parseBeatBrief", () => {
  it("returns the brief when it is usable", () => {
    const result = parseBeatBrief(beat11());
    expect("brief" in result).toBe(true);
  });

  it("reports schema problems with their field path", () => {
    const result = parseBeatBrief({ ...beat11(), palette: { ground: "not-a-colour", ink: "#14110e", accent: "#d02d1c" } });
    expect("issues" in result).toBe(true);
    if (!("issues" in result)) throw new Error("expected issues");
    expect(result.issues[0]!.field).toBe("palette.ground");
  });

  it("rejects unknown fields rather than silently dropping them", () => {
    // A model that returns `composition_id` is still thinking in slots, and we want to know.
    const result = parseBeatBrief({ ...beat11(), composition_id: "logo_face_off" });
    expect("issues" in result).toBe(true);
  });

  it("rejects an empty mustRead — a beat with nothing to read is not a brief", () => {
    expect("issues" in parseBeatBrief({ ...beat11(), mustRead: [] })).toBe(true);
  });
});

describe("colourDistance", () => {
  it("is zero for the same colour and large across the paper/ink pair", () => {
    expect(colourDistance("#ede9e3", "#ede9e3")).toBe(0);
    expect(colourDistance("#ede9e3", "#14110e")).toBeGreaterThan(200);
  });
});
