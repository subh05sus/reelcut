import { describe, expect, it } from "vitest";
import {
  checkBriefAgainstDirection,
  checkReelAgainstDirection,
  defaultTextDensity,
  describeDirection,
  maxWordsPerLine,
  parseDirection,
  type Direction,
} from "../src/direction/direction.js";
import { validateBeatBrief, type BeatBrief } from "../src/brief/beatBrief.js";

function brief(overrides: Partial<BeatBrief> = {}): BeatBrief {
  return {
    intent: "Contrast two tools and refuse to name a winner",
    mustRead: ["Nicht welcher besser ist."],
    emphasis: ["Nicht"],
    mustShow: [],
    composition: "The field divides into two equal halves and the division dissolves at the payoff.",
    phases: [
      { at: 0, does: "the claim arrives" },
      { at: 2.2, does: "the division dissolves" },
    ],
    palette: { ground: "#ede9e3", ink: "#14110e", accent: "#d02d1c" },
    durationSeconds: 4.07,
    ...overrides,
  };
}

const plain = (over: Partial<Direction> = {}): Direction => ({ textDensity: "full", motion: "default", ...over });

describe("defaultTextDensity", () => {
  /*
   * The decision this module exists for. These reels have a voiceover, so putting every line on
   * screen makes the viewer read the sentence they are already hearing, and leaves the frame no
   * room for anything else. /brag has no equivalent axis because /brag's videos are silent.
   */
  it("holds text back when there is a voiceover, and not otherwise", () => {
    expect(defaultTextDensity(true)).toBe("key-lines");
    expect(defaultTextDensity(false)).toBe("full");
  });
});

describe("maxWordsPerLine", () => {
  it("is zero for none and three for minimal, unlimited above", () => {
    expect(maxWordsPerLine("none")).toBe(0);
    expect(maxWordsPerLine("minimal")).toBe(3);
    expect(maxWordsPerLine("key-lines")).toBeUndefined();
    expect(maxWordsPerLine("full")).toBeUndefined();
  });
});

describe("parseDirection", () => {
  it("reads the flags", () => {
    const { direction, issues } = parseDirection(
      ["--text", "minimal", "--motion", "restrained", "--look", "Swiss print annual report", "--visuals", "data-forward"],
      { hasVoiceover: false },
    );
    expect(issues).toEqual([]);
    expect(direction.textDensity).toBe("minimal");
    expect(direction.motion).toBe("restrained");
    expect(direction.look).toBe("Swiss print annual report");
    expect(direction.visuals).toBe("data-forward");
  });

  it("reads a three-colour palette", () => {
    const { direction, issues } = parseDirection(["--palette", "#0a0a0a #f2efe9 #ff4b1f"], { hasVoiceover: false });
    expect(issues).toEqual([]);
    expect(direction.palette).toEqual({ ground: "#0a0a0a", ink: "#f2efe9", accent: "#ff4b1f" });
  });

  it("rejects a palette that is not three hex colours", () => {
    expect(parseDirection(["--palette", "#0a0a0a #f2efe9"], { hasVoiceover: false }).issues[0]).toMatch(/exactly three/);
    expect(parseDirection(["--palette", "black white red"], { hasVoiceover: false }).issues[0]).toMatch(/#rrggbb/);
  });

  it("rejects an unknown density or energy rather than ignoring it", () => {
    expect(parseDirection(["--text", "lots"], { hasVoiceover: false }).issues[0]).toMatch(/--text must be one of/);
    expect(parseDirection(["--motion", "wild"], { hasVoiceover: false }).issues[0]).toMatch(/--motion must be one of/);
  });

  /*
   * "make it feel like a museum exhibit" is real direction that no flag will ever capture, and it
   * has to reach the plan intact rather than being dropped on the floor.
   */
  it("keeps whatever else was typed, verbatim", () => {
    const { direction } = parseDirection(["make", "it", "feel", "like", "a", "museum", "exhibit"], { hasVoiceover: false });
    expect(direction.freeform).toBe("make it feel like a museum exhibit");
  });

  it("keeps freeform alongside flags", () => {
    const { direction } = parseDirection(["--text", "none", "barely", "any", "motion"], { hasVoiceover: false });
    expect(direction.textDensity).toBe("none");
    expect(direction.freeform).toBe("barely any motion");
  });

  it("falls back to the voiceover-aware default when --text is absent", () => {
    expect(parseDirection([], { hasVoiceover: true }).direction.textDensity).toBe("key-lines");
    expect(parseDirection([], { hasVoiceover: false }).direction.textDensity).toBe("full");
  });
});

describe("checkBriefAgainstDirection", () => {
  it("passes a brief that agrees with its direction", () => {
    expect(checkBriefAgainstDirection(brief(), plain())).toEqual([]);
  });

  it("refuses any on-screen text under --text none", () => {
    const issues = checkBriefAgainstDirection(brief(), plain({ textDensity: "none" }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/voiceover carries the words/);
  });

  it("accepts a textless beat under --text none", () => {
    expect(checkBriefAgainstDirection(brief({ mustRead: [], emphasis: [] }), plain({ textDensity: "none" }))).toEqual([]);
  });

  it("holds a line to three words under --text minimal", () => {
    expect(checkBriefAgainstDirection(brief({ mustRead: ["Kein Sieger"], emphasis: ["Kein"] }), plain({ textDensity: "minimal" }))).toEqual([]);
    const issues = checkBriefAgainstDirection(brief(), plain({ textDensity: "minimal" }));
    expect(issues[0]).toMatch(/allows 3 words on screen, and .* has 4/);
  });

  it("notices a beat that ignored the given palette", () => {
    const direction = plain({ palette: { ground: "#000000", ink: "#ffffff", accent: "#ff0000" } });
    expect(checkBriefAgainstDirection(brief(), direction)[0]).toMatch(/--palette was given as/);
    expect(checkBriefAgainstDirection(brief({ palette: { ground: "#000000", ink: "#ffffff", accent: "#ff0000" } }), direction)).toEqual([]);
  });

  /*
   * The guard that keeps direction from being a loophole. A brief that fails the reading floor
   * fails it under every setting — "make it punchy" is not permission to outrun the reader.
   */
  it("never makes a brief legal that validateBeatBrief rejected", () => {
    const tooTight = brief({ durationSeconds: 1.0 });
    expect(validateBeatBrief(tooTight).length).toBeGreaterThan(0);
    for (const textDensity of ["full", "key-lines", "minimal", "none"] as const) {
      for (const motion of ["restrained", "default", "energetic"] as const) {
        expect(validateBeatBrief(tooTight).length).toBeGreaterThan(0);
        // direction only ever ADDS issues; it cannot clear the ones the brief already has
        const added = checkBriefAgainstDirection(tooTight, plain({ textDensity, motion }));
        expect(Array.isArray(added)).toBe(true);
      }
    }
  });
});

describe("checkReelAgainstDirection", () => {
  /*
   * key-lines is about proportion, not per-beat limits: one beat with text is the point, every
   * beat with text is `full` wearing a different name.
   */
  it("complains when key-lines put text on nearly every beat", () => {
    const briefs = Array.from({ length: 10 }, () => brief());
    const issues = checkReelAgainstDirection(briefs, plain({ textDensity: "key-lines" }));
    expect(issues[0]).toMatch(/10 of 10 beats carry text/);
  });

  it("accepts text on the turns of the argument", () => {
    const briefs = [brief(), brief({ mustRead: [], emphasis: [] }), brief({ mustRead: [], emphasis: [] }), brief()];
    expect(checkReelAgainstDirection(briefs, plain({ textDensity: "key-lines" }))).toEqual([]);
  });

  it("says nothing for the other densities, which are checked per beat", () => {
    const briefs = Array.from({ length: 10 }, () => brief());
    for (const d of ["full", "minimal", "none"] as const) {
      expect(checkReelAgainstDirection(briefs, plain({ textDensity: d }))).toEqual([]);
    }
  });

  it("handles an empty reel without dividing by zero", () => {
    expect(checkReelAgainstDirection([], plain({ textDensity: "key-lines" }))).toEqual([]);
  });
});

describe("describeDirection", () => {
  it("names the voiceover consequence when there is no text", () => {
    expect(describeDirection(plain({ textDensity: "none" }))).toMatch(/voiceover carries every word/);
  });

  it("carries the freeform direction into the plan", () => {
    expect(describeDirection(plain({ freeform: "like a museum exhibit" }))).toMatch(/verbatim: like a museum exhibit/);
  });

  it("omits what was not given", () => {
    const text = describeDirection(plain());
    expect(text).not.toMatch(/Look:/);
    expect(text).not.toMatch(/Palette:/);
  });
});
