import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyDefaultPairing, FAMILIES, familiesIn, fontCss, fontFilesFor, KIT_DEFAULT_FAMILIES, loadFontLibrary, PAIRINGS, pairingCss, pairingIn } from "../src/fonts/index.js";
import { injectKit } from "../src/render/project.js";
import { SubjectSchema } from "../src/learnings/schema.js";
import { usedSignals } from "../src/learnings/signals.js";

const lib = loadFontLibrary()!;
const comp = (root = "", body = "") => `<template><div id="root" data-look="paper" data-composition-id="b" ${root}>${body}</div></template>`;

describe("the bundled type library", () => {
  it("ships every family in the catalogue, with its files and a licence", () => {
    expect(lib.manifest.families.map((f) => f.family).sort()).toEqual(FAMILIES.map((f) => f.family).sort());
    for (const f of lib.manifest.families) {
      expect(f.faces.length, f.family).toBeGreaterThan(0);
      for (const face of f.faces) expect(existsSync(path.join(lib.dir, face.file)), face.file).toBe(true);
      expect(f.licenceFile && existsSync(path.join(lib.dir, f.licenceFile)), f.family).toBeTruthy();
    }
  });

  it("has at least sixty families across every kind", () => {
    expect(lib.manifest.families.length).toBeGreaterThanOrEqual(60);
    for (const kind of ["sans", "display", "serif", "hand", "mono", "round"]) expect(lib.manifest.families.some((f) => f.kind === kind), kind).toBe(true);
  });

  it("builds every pairing from bundled families", () => {
    for (const p of PAIRINGS) for (const f of [p.head, p.body, p.accent, p.mono]) expect(lib.byFamily.has(f), `${p.id}: ${f}`).toBe(true);
  });
});

describe("what a composition loads", () => {
  it("loads the kit's own families when it chose no pairing, and only those", () => {
    expect(familiesIn(comp(), lib).sort()).toEqual([...KIT_DEFAULT_FAMILIES].sort());
  });

  it("loads its pairing's four families, plus any family it names itself", () => {
    const html = comp('data-type="poster"', `<style>#root .x { font-family: 'Caveat'; }</style>`);
    expect(pairingIn(html)?.id).toBe("poster");
    expect(familiesIn(html, lib).sort()).toEqual(["Anton", "Caveat", "DM Serif Display", "Inter Tight", "Space Mono"].sort());
    expect(fontFilesFor(html, lib).every((f) => !f.includes("instrument-serif"))).toBe(true);
  });

  it("ignores a pairing that does not exist", () => {
    expect(pairingIn(comp('data-type="nope"'))).toBeUndefined();
  });

  it("gives a beat the reel's pairing unless it chose its own", () => {
    expect(pairingIn(applyDefaultPairing(comp(), "swiss"))?.id).toBe("swiss");
    expect(pairingIn(applyDefaultPairing(comp('data-type="luxe"'), "swiss"))?.id).toBe("luxe");
    expect(applyDefaultPairing(comp(), "nope")).toBe(comp());
  });

  it("writes faces for the served files and the pairing's settings, after the kit", () => {
    const html = comp('data-type="poster"');
    const css = fontCss(html, lib, (f) => `assets/fonts/${f}`);
    expect(css).toContain(`@font-face { font-family: 'Anton'`);
    expect(css).toContain('src: url("assets/fonts/anton/');
    expect(css).toContain('[data-look][data-type="poster"] .rc-head');
    expect(css).toContain("text-transform: uppercase");
    const injected = injectKit(html, { css: "/*kit*/", js: "", fonts: { lib, url: (f) => `assets/fonts/${f}` } });
    expect(injected.indexOf("data-rc-fonts")).toBeGreaterThan(injected.indexOf("/*kit*/"));
  });

  it("sets an accent family without italics upright, and keeps the accent's own case under capitals", () => {
    expect(pairingCss(PAIRINGS.find((p) => p.id === "crafted")!)).toContain("font-style: normal");
    expect(pairingCss(PAIRINGS.find((p) => p.id === "editorial")!)).not.toContain("font-style: normal");
    expect(pairingCss(PAIRINGS.find((p) => p.id === "poster")!)).toContain("em.rc { text-transform: none; }");
  });

  it("never fetches anything: no URL but the ones it was given", () => {
    expect(fontCss(comp('data-type="tech"'), lib, (f) => `x/${f}`)).not.toMatch(/https?:/);
  });
});

describe("the pairing in learnings", () => {
  it("is a subject only when it names a real pairing", () => {
    expect(SubjectSchema.safeParse({ type: "type", value: "editorial" }).success).toBe(true);
    expect(SubjectSchema.safeParse({ type: "type", value: "comic-sans" }).success).toBe(false);
  });

  it("is recorded from the reel's choice and from each beat", () => {
    const signals = usedSignals({ reel: "r1", choices: { type: "poster" }, beats: [{ id: "beat-00", type: "swiss" }], at: "2026-10-07T00:00:00Z" });
    expect(signals.map((s) => `${s.type}:${s.subject?.type}=${s.subject?.value}`)).toEqual(expect.arrayContaining(["choice:type=poster", "used:type=swiss"]));
  });
});
