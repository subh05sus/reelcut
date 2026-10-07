import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertComposition, buildProject, inspectComposition } from "../src/render/project.js";
import { buildMeasurePage, formatMeasureReport, parseMeasureArgs } from "../src/verify/measure.js";
import { readKitSources } from "../src/render/kit.js";

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

/** The kit as a composition receives it: kit.css and kit.js, then every family in ui/. */
const kit = readKitSources(kitDir);
const core = { js: readFileSync(path.join(kitDir, "kit.js"), "utf8") };
/** The built-in patterns: the moves at the top level, the Apple UI pieces in apple/. */
const files = [
  ...readdirSync(patternsDir).filter((f) => f.endsWith(".html")),
  ...readdirSync(path.join(patternsDir, "apple")).filter((f) => f.endsWith(".html")).map((f) => `apple/${f}`),
].sort();
const patterns = files.map((f) => ({ id: path.basename(f, ".html"), file: f, html: readFileSync(path.join(patternsDir, f), "utf8") }));
const reel = JSON.parse(readFileSync(path.join(root, "examples", "patterns", "reel.json"), "utf8")) as { beats: { id: string; composition: string; durationSeconds: number }[] };

/** Source without its comments: the kit's header says "no Math.random", and that must not trip the check for it. */
const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The names the kit exports on `window.RC`: kit.js's final object literal, and each ui/ family's `Object.assign(window.RC, { … })`. */
function kitHelpers(): Set<string> {
  const literals = [/window\.RC\s*=\s*\{([\s\S]*?)\n\s*\};/.exec(core.js)?.[1] ?? "", ...Array.from(kit.js.matchAll(/Object\.assign\(window\.RC,\s*\{([\s\S]*?)\}\);/g)).map((m) => m[1]!)];
  return new Set(literals.flatMap((l) => Array.from(l.matchAll(/\b([a-zA-Z]+)\s*:/g)).map((m) => m[1]!)));
}

describe("the design kit", () => {
  it("parses as a script", () => {
    expect(() => new Function(kit.js)).not.toThrow();
  });

  it("never lets a ui/ family replace a helper another part of the kit already exports", () => {
    const literals = [/window\.RC\s*=\s*\{([\s\S]*?)\n\s*\};/.exec(core.js)?.[1] ?? "", ...Array.from(kit.js.matchAll(/Object\.assign\(window\.RC,\s*\{([\s\S]*?)\}\);/g)).map((m) => m[1]!)];
    const seen = new Map<string, number>();
    literals.forEach((l, i) => {
      for (const m of l.matchAll(/\b([a-zA-Z]+)\s*:/g)) {
        expect(seen.has(m[1]!) ? `${m[1]} (exported by literal ${seen.get(m[1]!)} and ${i})` : "").toBe("");
        seen.set(m[1]!, i);
      }
    });
  });

  it("moves on Apple's springs: computed, registered as eases, and never overshooting by default", () => {
    const eases: Record<string, (p: number) => number> = {};
    const win: Record<string, unknown> = { gsap: { registerEase: (n: string, f: (p: number) => number) => (eases[n] = f) } };
    const doc = { querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}) };
    new Function("window", "document", kit.js)(win, doc);
    const RC = win.RC as { spring: (n: string, e?: string) => { ease: (p: number) => number; duration: number; zeta: number } };
    for (const n of ["snappy", "default", "page", "gentle", "soft", "reward", "apple.out", "apple.push", "apple.exit", "apple.glide"]) {
      const f = eases[n.includes(".") ? n : `spring.${n}`]!;
      expect(f, n).toBeTypeOf("function");
      expect(f(0), n).toBe(0);
      expect(f(1), n).toBe(1);
    }
    const peak = (f: (p: number) => number) => Math.max(...Array.from({ length: 401 }, (_, i) => f(i / 400)));
    for (const n of ["default", "page", "gentle", "soft"]) expect(peak(RC.spring(n).ease), n).toBeLessThanOrEqual(1.0005);
    expect(peak(RC.spring("reward").ease)).toBeGreaterThan(1.05);
    // From rest: the first 1% of the time covers well under 1% of the way (expo.out covers 6.7%).
    expect(RC.spring("gentle").ease(0.01)).toBeLessThan(0.01);
    expect(RC.spring("default", "restrained").duration).toBeGreaterThan(RC.spring("default").duration);
    expect(RC.spring("default", "energetic").duration).toBeLessThan(RC.spring("default").duration);
  });

  it("declares every look a pattern can ask for", () => {
    for (const look of ["paper", "ink", "flood", "sky", "cinema", "poster", "cool"]) {
      expect(kit.css, look).toContain(`[data-look="${look}"]`);
    }
  });

  it("exports the helpers the components are built from", () => {
    const helpers = kitHelpers();
    for (const name of ["words", "chars", "blurIn", "rise", "flyIn", "type", "count", "roll", "cursorEl", "cursor", "click", "camera", "drift", "draw", "glass", "scramble", "zoomTo", "spot", "hold", "split", "rand"]) {
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

describe.each(["footage-window", "footage-cutout", "generated-backdrop"])("the footage pattern %s", (name) => {
  const html = readFileSync(path.join(patternsDir, "footage", `${name}.html`), "utf8");

  it("agrees with itself about its id, its timeline and its frame", () => {
    expect(inspectComposition(html)).toMatchObject({ hasTemplate: true, compositionId: name, timelineKey: name, width: 1080, height: 1080 });
  });

  it("asks for a look the kit has, and for helpers the kit exports", () => {
    expect(kit.css).toContain(`[data-look="${/data-look="([a-z]+)"/.exec(html)![1]}"]`);
    const helpers = kitHelpers();
    for (const m of html.matchAll(/RC\.([a-zA-Z]+)\(/g)) expect(helpers.has(m[1]!), m[1]).toBe(true);
  });

  it("places the clip with a placeholder and draws nothing in it", () => {
    expect(html).toMatch(/class="rc-footage" data-footage="[0-9a-f]{16}:m_[0-9a-f]{8}"/);
    expect(html).not.toMatch(/<video|<img/);
  });

  it("keeps the clip sharp: it is never blurred in", () => {
    expect(html).not.toMatch(/blurIn\(tl, "#root \.rc-footage"/);
  });

  it("is deterministic", () => {
    expect(code(html)).not.toMatch(/Math\.random|Date\.now|new Date|performance\.now|repeat:\s*-1/);
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
        expect(reel.beats.some((b) => b.id === p.id && b.composition.endsWith(`/${p.file}`))).toBe(true);
      });
    });
  }
});

describe("the example reel", () => {
  it("mounts only patterns that exist, once each", () => {
    const ids = reel.beats.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of reel.beats) expect(patterns.map((p) => p.id), b.id).toContain(b.id);
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
