import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let home: string;
beforeEach(() => { home = mkdtempSync(path.join(os.tmpdir(), "rc-draw-")); process.env.REELCUT_HOME = home; });
afterEach(() => { delete process.env.REELCUT_HOME; rmSync(home, { recursive: true, force: true }); });
const scheme = { ground: "#f3ead8", ink: "#1d1b18", accent: "#c8402a", accent2: "#2f6f62" };

describe("drawn assets", () => {
  it("refuses an SVG that runs, fetches or cannot scale", async () => {
    const { checkSvg } = await import("../src/create/draw.js");
    expect(checkSvg('<svg viewBox="0 0 10 10"><circle r="4" fill="#c8402a"/></svg>', scheme)).toMatchObject({ ok: true, errors: [] });
    for (const bad of ['<svg viewBox="0 0 1 1"><script>x</script></svg>', '<svg viewBox="0 0 1 1" onload="x()"></svg>', '<svg viewBox="0 0 1 1"><image href="https://x.y/a.png"/></svg>',
      '<svg viewBox="0 0 1 1"><foreignObject/></svg>', '<svg width="10"></svg>', "<div></div>", '<svg viewBox="0 0 1 1"><a href="javascript:alert(1)"/></svg>']) {
      expect(checkSvg(bad).ok, bad).toBe(false);
    }
  });
  it("warns about text and colours outside the scheme, and counts shades and greys as in it", async () => {
    const { checkSvg, svgColours } = await import("../src/create/draw.js");
    expect(svgColours('<svg fill="#ABC" stroke="#c8402a">')).toEqual(["#aabbcc", "#c8402a"]);
    const ok = checkSvg('<svg viewBox="0 0 1 1"><path fill="#c04030"/><path fill="#888888"/><path fill="#1d1b18"/></svg>', scheme);
    expect(ok.warnings).toEqual([]);
    const off = checkSvg('<svg viewBox="0 0 1 1"><text>Hi</text><path fill="#00ff00"/><path fill="#ff00ff"/><path fill="#0000ff"/></svg>', scheme);
    expect(off.warnings.join(" ")).toMatch(/<text>/);
    expect(off.warnings.join(" ")).toMatch(/3 colours are outside the scheme/);
  });
  it("keeps a drawing in the library as drawn, generic and pending", async () => {
    const { keepDrawing } = await import("../src/create/draw.js");
    const { loadIndex } = await import("../src/library/store.js");
    const f = path.join(home, "rocket.svg");
    writeFileSync(f, '<svg viewBox="0 0 10 10"><g id="body"><rect width="4" height="8" fill="#c8402a"/></g></svg>');
    const r = keepDrawing(f, { name: "A paper rocket", tags: ["Rocket"], style: "paper-cutout" });
    const a = loadIndex().assets.find((x) => x.id === r.id)!;
    expect(a).toMatchObject({ name: "A paper rocket", assetKind: "generic", mediaType: "image", review: { state: "pending" }, provenance: { source: "drawn" } });
    expect(a.tags).toEqual(expect.arrayContaining(["rocket", "drawn", "paper-cutout"]));
    writeFileSync(f, '<svg viewBox="0 0 1 1"><script/></svg>');
    expect(() => keepDrawing(f, { name: "x" })).toThrow(/not kept/);
  });
  it("asks for the style's way of drawing, its colours and a beat re-render", async () => {
    const { drawPrompt, DRAWING } = await import("../src/create/draw.js");
    const { STYLE_IDS } = await import("../src/personality/styles.js");
    expect(Object.keys(DRAWING).sort()).toEqual([...STYLE_IDS].sort());
    const p = drawPrompt({ what: "a rocket", beat: "beat-02", reelPath: "/r/out-1/reel.json", style: "isometric" });
    expect(p).toContain("Isometric: isometric projection");
    expect(p).toContain("npm run draw -- <file.svg>");
    expect(p).toContain("/r/out-1/drawn/");
    expect(p).toContain("--only beat-02 --clips-only");
    expect(p).toContain("Never draw a logo");
  });
});
