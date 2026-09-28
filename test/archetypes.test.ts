import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectComposition } from "../src/render/project.js";

/*
 * The fast half of `npm run archetypes:check`: no rendering, just the shape a render would only
 * discover by freezing. The library shipped with six experiment ids (`sc-00` …) under descriptive
 * filenames, and a copied archetype renders frozen at t=0 if the id and the timeline key disagree.
 */
const library = path.resolve(import.meta.dirname, "../skills/reelcut/assets/archetypes");
const files = readdirSync(library).filter((f) => f.endsWith(".html"));

describe("archetype library", () => {
  it("has the six type archetypes and the five non-type ones", () => {
    expect(files.length).toBeGreaterThanOrEqual(11);
  });

  for (const file of files) {
    const id = file.replace(/\.html$/, "");
    const html = readFileSync(path.join(library, file), "utf8");

    it(`${id}: composition id and timeline key are the filename`, () => {
      const shape = inspectComposition(html);
      expect(shape.hasTemplate).toBe(true);
      expect(shape.compositionId).toBe(id);
      expect(shape.timelineKey).toBe(id);
      expect([shape.width, shape.height]).toEqual([1080, 1080]);
    });

    it(`${id}: declares how long it runs`, () => {
      const seconds = Number(/<!--\s*archetype seconds=([\d.]+)\s*-->/.exec(html)?.[1]);
      expect(seconds).toBeGreaterThan(0);
    });

    it(`${id}: no clocks, no randomness, no infinite repeats`, () => {
      expect(html).not.toMatch(/Math\.random|Date\.now|performance\.now|repeat:\s*-1/);
    });
  }
});
