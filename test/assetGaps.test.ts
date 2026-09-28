import { describe, expect, it } from "vitest";
import { formatGapReport, isBlocking, reportAssetGaps, resolutionsFor } from "../src/brief/assetGaps.js";
import { formatIntake, intakeDrops, scoreMatch } from "../src/brief/assetIntake.js";
import type { AssetRequirement } from "../src/brief/assetRequirementTypes.js";

function req(overrides: Partial<AssetRequirement> = {}): AssetRequirement {
  return {
    name: "Claude Logo",
    reason: "The beat compares two named products",
    sceneUsage: "Shown beside the ChatGPT mark in the comparison beat",
    visualRole: "brand mark",
    acceptedFormats: ["svg", "png"],
    priority: "required",
    assetKind: "identity",
    ...overrides,
  };
}

const kinds = (r: AssetRequirement) => resolutionsFor(r).map((x) => x.kind);

describe("isBlocking", () => {
  /*
   * The split `assetRequirementTypes.ts` documents: a missing identity asset stops the reel
   * because there is no honest substitute for a specific real thing; a missing generic one never
   * does, because a drawn shape stands in.
   */
  it("blocks only on a required identity asset", () => {
    expect(isBlocking(req())).toBe(true);
    expect(isBlocking(req({ priority: "optional" }))).toBe(false);
    expect(isBlocking(req({ assetKind: "generic" }))).toBe(false);
    expect(isBlocking(req({ assetKind: "generic", priority: "optional" }))).toBe(false);
  });
});

describe("resolutionsFor", () => {
  /*
   * The rule that is not negotiable. A generated logo is a fabricated logo, and presenting one as
   * a real brand's mark is the invented-content failure this repo keeps fixing.
   */
  it("never offers to draw an identity asset", () => {
    expect(kinds(req())).not.toContain("generate");
    expect(kinds(req({ name: "ChatGPT screenshot", visualRole: "product UI" }))).not.toContain("generate");
  });

  it("offers to draw a generic one first, because no reel should stall for a conceptual shape", () => {
    expect(kinds(req({ assetKind: "generic", name: "connecting arrow", visualRole: "diagram element" }))[0]).toBe("generate");
  });

  it("offers a capture when the requirement names something that lives on a screen", () => {
    expect(kinds(req({ name: "Claude chat interface", visualRole: "product UI screenshot" }))).toContain("capture");
    expect(kinds(req({ name: "Founder portrait", visualRole: "photograph" }))).not.toContain("capture");
  });

  it("offers the brand's own source for a mark, and asks for the licence", () => {
    const brand = resolutionsFor(req()).find((r) => r.kind === "brand_source");
    expect(brand).toBeDefined();
    expect(brand!.needs).toMatch(/licence/i);
  });

  it("offers to omit only what is optional", () => {
    expect(kinds(req({ priority: "optional" }))).toContain("omit");
    expect(kinds(req({ priority: "required" }))).not.toContain("omit");
  });

  it("always leaves a way out, so nothing is ever just stuck", () => {
    for (const r of [req(), req({ assetKind: "generic" }), req({ priority: "optional" })]) {
      expect(resolutionsFor(r).length).toBeGreaterThan(0);
      expect(kinds(r)).toContain("recompose");
    }
  });

  it("names the accepted formats when asking for a file", () => {
    expect(resolutionsFor(req()).find((r) => r.kind === "provide")!.needs).toContain("svg");
    expect(resolutionsFor(req({ acceptedFormats: [] })).find((r) => r.kind === "provide")!.needs).toBe("the file");
  });
});

describe("reportAssetGaps", () => {
  it("puts the blocking gaps first", () => {
    const gaps = reportAssetGaps([
      { requirement: req({ name: "arrow", assetKind: "generic" }), status: "not_provided" },
      { requirement: req({ name: "Claude Logo" }), status: "not_provided" },
    ]);
    expect(gaps[0]!.requirement.name).toBe("Claude Logo");
    expect(gaps[0]!.blocking).toBe(true);
  });

  it("carries an acquisition failure through verbatim", () => {
    const gaps = reportAssetGaps([{ requirement: req(), status: "acquisition_failed", detail: "brand page returned 403" }]);
    expect(gaps[0]!.detail).toBe("brand page returned 403");
    expect(formatGapReport(gaps)).toContain("403");
  });
});

describe("formatGapReport", () => {
  it("says what is missing AND what can be done, never only the first", () => {
    const text = formatGapReport(reportAssetGaps([{ requirement: req(), status: "not_provided" }]));
    expect(text).toContain("Claude Logo");
    expect(text).toContain("BLOCKS");
    expect(text).toContain("needed for:");
    expect(text).toMatch(/1\. /);
    expect(text).toMatch(/2\. /);
  });

  it("says plainly when nothing stops the reel", () => {
    expect(formatGapReport(reportAssetGaps([{ requirement: req({ assetKind: "generic" }), status: "not_provided" }]))).toContain("None stop the reel");
  });

  it("handles having nothing to report", () => {
    expect(formatGapReport([])).toBe("No open asset requirements.");
  });
});

describe("intakeDrops", () => {
  const logo = req({ name: "Claude Logo" });
  const shot = req({ name: "ChatGPT chat screen", acceptedFormats: ["png"], visualRole: "product UI" });

  it("matches a well-named file exactly", () => {
    const result = intakeDrops([logo], [{ path: "/d/claude-logo.svg", name: "claude-logo.svg" }]);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.confidence).toBe("exact");
    expect(result.stillOpen).toHaveLength(0);
  });

  it("downgrades a full name match when the format is not one that was asked for", () => {
    const result = intakeDrops([logo], [{ path: "/d/claude-logo.webp", name: "claude-logo.webp" }]);
    expect(result.matches[0]!.confidence).toBe("likely");
    expect(result.matches[0]!.why).toMatch(/webp/);
  });

  it("ignores noise words so a generic filename does not score", () => {
    expect(scoreMatch(logo, { path: "/d/final-export-v2.png", name: "final-export-v2.png" })).toBeUndefined();
  });

  /*
   * A wrong match is worse than no match: it fills the slot, and every later gate passes because
   * the slot is filled. One file answers at most one requirement, and only `exact` is safe to
   * apply without asking.
   */
  it("never lets one file answer two requirements", () => {
    const result = intakeDrops([logo, shot], [{ path: "/d/claude.png", name: "claude.png" }]);
    expect(result.matches).toHaveLength(1);
    expect(result.stillOpen).toHaveLength(1);
  });

  it("gives the stronger match the file when two requirements compete", () => {
    const result = intakeDrops([logo, shot], [
      { path: "/d/claude-logo.svg", name: "claude-logo.svg" },
      { path: "/d/chatgpt-chat-screen.png", name: "chatgpt-chat-screen.png" },
    ]);
    expect(result.matches).toHaveLength(2);
    expect(result.matches.every((m) => m.confidence === "exact")).toBe(true);
    expect(result.unmatched).toHaveLength(0);
  });

  it("reports files that answered nothing", () => {
    const result = intakeDrops([logo], [{ path: "/d/holiday.jpg", name: "holiday.jpg" }]);
    expect(result.unmatched).toHaveLength(1);
    expect(result.stillOpen).toHaveLength(1);
  });

  it("warns when a match needs confirming", () => {
    const text = formatIntake(intakeDrops([logo], [{ path: "/d/claude-logo.webp", name: "claude-logo.webp" }]));
    expect(text).toMatch(/need.? confirming/);
  });
});
