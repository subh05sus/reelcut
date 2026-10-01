import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertComposition, buildProject, inspectComposition } from "../src/render/project.js";
import { buildMeasurePage, formatMeasureReport, parseMeasureArgs } from "../src/verify/measure.js";

/*
 * The pattern library is the product's reference for what a finished beat looks like, and it is
 * edited by hand and re-rendered rarely. These tests are the cheap half of keeping it honest: they
 * cannot see a frame, but they catch every way a pattern can rot without anyone noticing — an id
 * that no longer matches its timeline (which renders frozen at t=0 with a green gate), a helper
 * that was renamed in the kit, a look that no longer exists, a clock or a random number that makes
 * a frame depend on when it was rendered, a pattern nobody mounts in the example reel.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const patternsDir = path.join(root, "skills", "reelcut", "assets", "patterns");
const kitDir = path.join(root, "skills", "reelcut", "assets", "kit");

const kit = { css: readFileSync(path.join(kitDir, "kit.css"), "utf8"), js: readFileSync(path.join(kitDir, "kit.js"), "utf8") };
const files = readdirSync(patternsDir).filter((f) => f.endsWith(".html")).sort();
const patterns = files.map((f) => ({ id: f.replace(/\.html$/, ""), html: readFileSync(path.join(patternsDir, f), "utf8") }));
const reel = JSON.parse(readFileSync(path.join(root, "examples", "patterns", "reel.json"), "utf8")) as { beats: { id: string; composition: string; durationSeconds: number }[] };

/** Source without its comments: the kit's header says "no Math.random", and that must not trip the check for it. */
const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The names the kit exports on `window.RC`, read from its final object literal. */
function kitHelpers(): Set<string> {
  const literal = /window\.RC\s*=\s*\{([\s\S]*?)\n\s*\};/.exec(kit.js)?.[1] ?? "";
  return new Set(Array.from(literal.matchAll(/\b([a-zA-Z]+)\s*:/g)).map((m) => m[1]!));
}

describe("the design kit", () => {
  it("parses as a script", () => {
    expect(() => new Function(kit.js)).not.toThrow();
  });

  it("declares every look a pattern can ask for", () => {
    for (const look of ["paper", "ink", "flood", "sky", "cinema", "poster", "cool"]) {
      expect(kit.css, look).toContain(`[data-look="${look}"]`);
    }
  });

  it("exports the helpers the components are built from", () => {
    const helpers = kitHelpers();
    for (const name of ["words", "chars", "blurIn", "rise", "flyIn", "type", "count", "roll", "cursorEl", "cursor", "click", "camera", "drift", "draw", "glass", "scramble", "hold", "split", "rand"]) {
      expect(helpers.has(name), name).toBe(true);
    }
  });

  it("ships glass as a lens: a material class, its tokens, and the clear variant", () => {
    expect(kit.css).toContain(".rc-glass");
    expect(kit.css).toContain("--glass-tint");
    expect(kit.css).toContain(".rc-glass.rc-clear");
    expect(kit.js).toContain("feDisplacementMap");
  });

  it("is deterministic: no clock, no random numbers, no infinite repeats", () => {
    expect(code(kit.js)).not.toMatch(/Math\.random|Date\.now|new Date|performance\.now|repeat:\s*-1|setInterval|setTimeout/);
  });
});

describe("the patterns", () => {
  it("has patterns", () => {
    expect(patterns.length).toBeGreaterThanOrEqual(40);
  });

  for (const p of patterns) {
    describe(p.id, () => {
      it("agrees with itself about its id, its timeline and its frame", () => {
        expect(inspectComposition(p.html)).toMatchObject({ hasTemplate: true, compositionId: p.id, timelineKey: p.id, width: 1080, height: 1080 });
        expect(() => assertComposition({ id: p.id, durationSeconds: 4, compositionHtml: p.html }, { width: 1080, height: 1080, fps: 30 })).not.toThrow();
      });

      it("asks for a look the kit has", () => {
        const look = /data-look="([a-z]+)"/.exec(p.html)?.[1];
        expect(look, "no data-look on the root").toBeDefined();
        expect(kit.css).toContain(`[data-look="${look}"]`);
      });

      it("calls only helpers the kit exports", () => {
        const helpers = kitHelpers();
        for (const m of p.html.matchAll(/\bRC\.([a-zA-Z]+)\(/g)) expect(helpers.has(m[1]!), `RC.${m[1]}`).toBe(true);
      });

      it("is deterministic: a frame is a pure function of time", () => {
        expect(code(p.html)).not.toMatch(/Math\.random|Date\.now|new Date|performance\.now|repeat:\s*-1|setInterval|setTimeout|requestAnimationFrame/);
      });

      it("ends its timeline with a hold, so the clip is as long as the beat", () => {
        expect(p.html).toMatch(/RC\.hold\(tl,/);
      });

      it("is mounted in the example reel", () => {
        expect(reel.beats.some((b) => b.id === p.id && b.composition.endsWith(`/${p.id}.html`))).toBe(true);
      });
    });
  }
});

describe("the example reel", () => {
  it("mounts only patterns that exist, once each", () => {
    const ids = reel.beats.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of reel.beats) expect(files, b.id).toContain(`${b.id}.html`);
  });

  it("builds into a project with the kit in every clip", () => {
    const built = buildProject(
      reel.beats.map((b) => ({ id: b.id, durationSeconds: b.durationSeconds, compositionHtml: patterns.find((p) => p.id === b.id)!.html })),
      { width: 1080, height: 1080, fps: 30, kit },
    );
    for (const b of reel.beats) expect(built.clips[b.id]!.find((f) => f.path.endsWith(`${b.id}.html`))!.contents).toContain("data-rc-kit");
  });
});

describe("measure", () => {
  it("parses its arguments: file, times, flags and `||` lists", () => {
    const args = parseMeasureArgs(["a.html", "0.4,3.2", "--guides", "--scan", "--select", ".card||.row", "--bearings", ".rc-head .ln", "--no-camera"]);
    expect(args).toMatchObject({ file: "a.html", times: [0.4, 3.2], guides: true, scan: true, keepCamera: false, select: [".card", ".row"], bearings: [".rc-head .ln"] });
    expect(parseMeasureArgs(["a.html"])).toBeUndefined();
    expect(parseMeasureArgs(["a.html", "x"])).toBeUndefined();
  });

  it("builds a page that carries the kit, GSAP and the stage", () => {
    const page = buildMeasurePage(patterns[0]!.html, kit);
    expect(page).toContain("data-rc-kit");
    expect(page).toContain("gsap");
    expect(page).toContain('id="stage"');
  });

  it("reports rectangles and findings as text", () => {
    const text = formatMeasureReport({
      bearings: [{ selector: ".h", text: "One", char: "O", size: "92px", bearing: 2.88 }],
      samples: [{ at: 1, rects: { ".card": [{ x: 84, y: 336, w: 912, h: 660, r: 996, b: 996 }] }, baselines: {}, findings: [{ kind: "small-text", el: "sz", text: "2.4 MB", detail: "14px" }], screenshot: "out/a-1.png" }],
    });
    expect(text).toContain("--ox:-2.9px");
    expect(text).toContain("x 84 y 336 w 912 h 660");
    expect(text).toContain("small-text");
  });
});
