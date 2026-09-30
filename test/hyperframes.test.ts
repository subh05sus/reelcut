import { describe, expect, it } from "vitest";
import { parseCheckReport } from "../src/render/hyperframes.js";

describe("parseCheckReport", () => {
  const report = {
    ok: false,
    lint: { ok: true, errorCount: 0, findings: [{ severity: "warning", code: "composition_file_too_large", selector: "x", message: "long" }] },
    layout: { ok: true, errorCount: 0, samples: new Array(24).fill(0), findings: [] },
    contrast: {
      ok: false,
      errorCount: 2,
      findings: [
        { severity: "error", code: "contrast_aa_failure", selector: ".kicker", message: "Contrast is 4.05:1; WCAG AA requires 4.5:1.", time: 0.8 },
        { severity: "error", code: "contrast_aa_failure", selector: ".kicker", message: "Contrast is 3.96:1; WCAG AA requires 4.5:1.", time: 1.68 },
      ],
    },
  };

  it("reads the verdict, the sample count and the error total", () => {
    const parsed = parseCheckReport(`[INFO] fonts fetched\n${JSON.stringify(report)}`);
    expect(parsed).toMatchObject({ ok: false, layoutSamples: 24, errors: 2 });
  });

  it("names each failure once, with every time it was seen, and skips warnings", () => {
    const { failures } = parseCheckReport(JSON.stringify(report));
    expect(failures).toHaveLength(1);
    expect(failures![0]).toContain("contrast contrast_aa_failure .kicker");
    expect(failures![0]).toContain("(at 0.8, 1.7s)");
  });
});
