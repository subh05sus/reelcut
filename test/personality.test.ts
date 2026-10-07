import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PAIRINGS } from "../src/fonts/catalog.js";
import {
  STYLES, assignBeats, brandColors, brandFonts, brandPalette, checkFont, checkPalette, checkPersonality, contrast, defaultPersonality, deletePersonality,
  fromOklch, loadPersonalities, rollProblems, savePersonality, setDefaultPersonality, styleById, surprise, toOklch, type Palette,
} from "../src/personality/index.js";

describe("the style catalog", () => {
  it("has the twenty styles, each with six curated schemes and real type pairings", () => {
    expect(STYLES).toHaveLength(20);
    for (const s of STYLES) {
      expect(s.palettes.length, s.id).toBe(6);
      for (const id of [...s.fonts.best, ...s.fonts.avoid]) expect(PAIRINGS.some((p) => p.id === id), `${s.id}: ${id}`).toBe(true);
      expect(s.fonts.best.some((id) => s.fonts.avoid.includes(id)), s.id).toBe(false);
    }
  });

  it("curates only schemes that pass their own style: readable, and no warning of any kind", () => {
    for (const s of STYLES) for (const p of s.palettes) {
      expect(contrast(p.ink, p.ground), `${s.id}/${p.id} text`).toBeGreaterThanOrEqual(4.5);
      expect(checkPalette(s, p), `${s.id}/${p.id}`).toEqual([]);
    }
  });

  it("recommends no type pairing it would then warn about", () => {
    for (const s of STYLES) for (const id of s.fonts.best) expect(checkFont(s, id), `${s.id}/${id}`).toEqual([]);
  });
});

describe("the compatibility checks", () => {
  const clay = styleById("claymation")!;
  const neon: Palette = { id: "x", name: "Neon", ground: "#f6e3d4", ink: "#3b2a24", accent: "#ff2bd6", accent2: "#39ff14" };

  it("warns about neon on clay, says why, and fixes it without changing the hue", () => {
    const f = checkPalette(clay, neon).find((x) => x.code === "neon")!;
    expect(f.level).toBe("warn");
    expect(f.message).toMatch(/matte/);
    const fixed = f.fix!.patch.palette!.value;
    expect(Math.abs(toOklch(fixed.accent).h - toOklch(neon.accent).h)).toBeLessThan(6);
    expect(checkPalette(clay, fixed).filter((x) => x.code === "neon")).toEqual([]);
  });

  it("blocks unreadable text, and its fix makes it readable", () => {
    const grey: Palette = { id: "g", name: "Grey", ground: "#f5f5f5", ink: "#bbbbbb", accent: "#d0d0d0", accent2: "#999999" };
    const errs = checkPalette(styleById("minimal")!, grey).filter((x) => x.level === "error");
    expect(errs.map((e) => e.code).sort()).toEqual(["contrast-accent", "contrast-ink"]);
    const ink = errs.find((e) => e.code === "contrast-ink")!.fix!.patch.palette!.value.ink;
    expect(contrast(ink, grey.ground)).toBeGreaterThanOrEqual(4.5);
  });

  it("warns about a pairing that fights the style and offers the style's first choice", () => {
    const f = checkFont(styleById("swiss")!, "handmade");
    expect(f[0]!.code).toBe("font-fights");
    expect(f[0]!.fix!.patch.font!.value).toBe("swiss");
  });

  it("names styles that pull against each other, and banned colours as errors", () => {
    const now = new Date().toISOString();
    const findings = checkPersonality({
      id: "p", name: "t", isDefault: true, styles: [{ id: "minimal", weight: 60 }, { id: "brutalist", weight: 40 }], beatStyles: {},
      palettes: { minimal: styleById("minimal")!.palettes[0]! }, fonts: {}, motion: {} as never, texture: {}, signature: {} as never, copy: {} as never, sound: {} as never,
      pacing: {} as never, guardrails: { bannedColors: ["#f5f3ee"], bannedFonts: [], bannedMoves: [], maxFonts: 3, contrast: 4.5, noGlass: false, noConfetti: false, notes: "" },
      brand: {} as never, done: [], createdAt: now, updatedAt: now,
    });
    expect(findings.some((f) => f.code === "tension")).toBe(true);
    expect(findings.some((f) => f.code === "banned-colour" && f.level === "error")).toBe(true);
  });
});

describe("helpers", () => {
  it("Surprise me always rolls a combination that passes, and keeps what is locked", () => {
    for (let seed = 1; seed <= 300; seed++) expect(rollProblems(surprise(seed)), `seed ${seed}`).toBe(0);
    const locked = surprise(7, { styles: ["swiss"], count: 2 });
    expect(locked.styles[0]!.id).toBe("swiss");
    expect(locked.styles).toHaveLength(2);
    expect(surprise(42)).toEqual(surprise(42));
  });

  it("gives each beat kind to the style that suits it", () => {
    expect(assignBeats(["swiss", "kinetic-type"])).toMatchObject({ data: "swiss", hook: "kinetic-type" });
  });

  it("reads brand colours and fonts from a page's CSS, ignoring greys", () => {
    const css = `:root{--b:#ff6a00;color:#111;background:#fff} .x{color:#ff6a00;border:#eee} .y{fill:rgb(31,91,255)} body{font-family:"Inter Tight",sans-serif}`;
    expect(brandColors(css)).toEqual(["#ff6a00", "#1f5bff"]);
    expect(brandFonts(css + `<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@400&family=DM+Sans">`)).toEqual(["Fraunces", "DM Sans", "Inter Tight"]);
  });

  it("adapts a brand colour to each style, keeping its hue and passing contrast", () => {
    for (const s of STYLES) {
      const p = brandPalette(s, ["#ff6a00", "#1f5bff"])!;
      expect(contrast(p.accent, p.ground), s.id).toBeGreaterThanOrEqual(3);
      expect(contrast(p.ink, p.ground), s.id).toBeGreaterThanOrEqual(4.5);
      expect(Math.abs(toOklch(p.accent).h - toOklch("#ff6a00").h), s.id).toBeLessThan(10);
    }
  });

  it("round-trips OKLCH", () => {
    for (const h of ["#ff6a00", "#1f5bff", "#30d158", "#121212"]) expect(fromOklch(toOklch(h))).toBe(h);
  });
});

describe("the store", () => {
  let home: string;
  beforeEach(() => { home = mkdtempSync(path.join(os.tmpdir(), "rc-pers-")); process.env.REELCUT_HOME = home; });
  afterEach(() => { delete process.env.REELCUT_HOME; rmSync(home, { recursive: true, force: true }); });

  it("keeps exactly one default", () => {
    const a = savePersonality({ name: "gptmarlon" });
    const b = savePersonality({ name: "Client" });
    expect(defaultPersonality()!.id).toBe(a.id);
    setDefaultPersonality(b.id);
    expect(loadPersonalities().filter((p) => p.isDefault).map((p) => p.id)).toEqual([b.id]);
    deletePersonality(b.id);
    expect(defaultPersonality()!.id).toBe(a.id);
    expect(savePersonality({ ...a, name: "renamed" }).createdAt).toBe(a.createdAt);
  });
});

describe("the style previews", () => {
  it("are valid, deterministic compositions for every style and kind", async () => {
    const { inspectComposition } = await import("../src/render/project.js");
    const { previewComposition } = await import("../src/personality/index.js");
    for (const s of STYLES) for (const kind of ["sample", "showcase"] as const) {
      const id = `${s.id}-${kind}`;
      const html = previewComposition(s, kind, { id, palette: s.palettes[0]!, pairing: s.fonts.best[0]! });
      expect(inspectComposition(html), id).toMatchObject({ hasTemplate: true, compositionId: id, timelineKey: id, width: 1080, height: 1080 });
      expect(html.replace(/\/\*[\s\S]*?\*\//g, ""), id).not.toMatch(/Math\.random|Date\.now|performance\.now|repeat:\s*-1|setTimeout/);
      expect(html, id).toMatch(/RC\.hold\(tl,/);
    }
  });
});
