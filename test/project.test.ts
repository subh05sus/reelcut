import { describe, expect, it } from "vitest";
import { ProjectError, SFX_DEFAULT_VOLUME, assertComposition, buildProject, inspectComposition, placeBeats, type ProjectBeat } from "../src/render/project.js";

const OPTIONS = { width: 1080, height: 1080, fps: 30 };

function composition(id: string, over: { rootId?: string; key?: string; template?: boolean; width?: number } = {}): string {
  const body = `<style>#root { position: absolute; inset: 0; }</style>
<div id="root" data-composition-id="${over.rootId ?? id}" data-width="${over.width ?? 1080}" data-height="1080"><h1>x</h1></div>
<script>(function(){ const tl = gsap.timeline({ paused: true }); window.__timelines["${over.key ?? id}"] = tl; })();</script>`;
  return `<!doctype html><html><head></head><body>${over.template === false ? body : `<template>${body}</template>`}</body></html>`;
}

function beat(id: string, durationSeconds: number, extra: Partial<ProjectBeat> = {}): ProjectBeat {
  return { id, durationSeconds, compositionHtml: composition(id), ...extra };
}

describe("inspectComposition", () => {
  it("reads the three things that have to agree", () => {
    const info = inspectComposition(composition("beat-03"));
    expect(info).toMatchObject({ hasTemplate: true, compositionId: "beat-03", timelineKey: "beat-03", width: 1080, height: 1080 });
  });
});

describe("assertComposition", () => {
  it("accepts a composition whose ids agree", () => {
    expect(() => assertComposition(beat("beat-03", 2), OPTIONS)).not.toThrow();
  });

  /*
   * The failure this exists for. With two or more timelines registered, HyperFrames binds a
   * sub-composition by id and a mismatch does not error — the render stays frozen at t=0, and
   * `check` can report a clean layout for the still frame.
   */
  it("refuses a timeline registered under the wrong key", () => {
    const bad = beat("beat-03", 2, { compositionHtml: composition("beat-03", { key: "beat-3" }) });
    expect(() => assertComposition(bad, OPTIONS)).toThrow(/frozen at t=0/);
  });

  it("refuses a root id that does not match the beat", () => {
    const bad = beat("beat-03", 2, { compositionHtml: composition("beat-03", { rootId: "sc-03" }) });
    expect(() => assertComposition(bad, OPTIONS)).toThrow(/data-composition-id is "sc-03"/);
  });

  it("refuses a composition outside a <template>, whose contents would be discarded", () => {
    const bad = beat("beat-03", 2, { compositionHtml: composition("beat-03", { template: false }) });
    expect(() => assertComposition(bad, OPTIONS)).toThrow(/<template>/);
  });

  it("refuses a composition drawn for a different frame size", () => {
    const bad = beat("beat-03", 2, { compositionHtml: composition("beat-03", { width: 1920 }) });
    expect(() => assertComposition(bad, OPTIONS)).toThrow(/data-width is 1920/);
  });

  it("refuses an id the runtime would not accept", () => {
    expect(() => assertComposition({ ...beat("x", 2), id: "Beat 3" }, OPTIONS)).toThrow(/lowercase/);
  });
});

describe("placeBeats", () => {
  it("starts each beat where the last one ended, with no gap and no overlap", () => {
    const placed = placeBeats([{ id: "a", durationSeconds: 2.57 }, { id: "b", durationSeconds: 2.2 }, { id: "c", durationSeconds: 4.07 }], 30);
    for (let i = 1; i < placed.length; i++) expect(placed[i]!.startFrame).toBe(placed[i - 1]!.endFrame);
  });

  /*
   * Rounding each duration and summing drifts by up to half a frame per beat; over a long reel
   * that is several frames against anything timed to the script. Rounding each END on the
   * cumulative timeline bounds the error at half a frame at every boundary.
   */
  it("does not accumulate rounding error across a long reel", () => {
    const durations = Array.from({ length: 40 }, () => 2.23);
    const placed = placeBeats(durations.map((d, i) => ({ id: `b${i}`, durationSeconds: d })), 30);
    const exactEnd = durations.reduce((s, d) => s + d, 0) * 30;
    expect(Math.abs(placed[placed.length - 1]!.endFrame - exactEnd)).toBeLessThanOrEqual(0.5);

    // and the naive approach would have drifted
    const naive = durations.reduce((s, d) => s + Math.round(d * 30), 0);
    expect(Math.abs(naive - exactEnd)).toBeGreaterThan(1);
  });

  it("refuses a beat shorter than a frame, and a non-positive one", () => {
    expect(() => placeBeats([{ id: "a", durationSeconds: 0.01 }], 30)).toThrow(/shorter than one frame/);
    expect(() => placeBeats([{ id: "a", durationSeconds: 0 }], 30)).toThrow(/must be positive/);
  });
});

describe("buildProject", () => {
  const beats = [beat("beat-00", 2.57), beat("beat-03", 2.2), beat("beat-07", 4.07)];

  it("mounts every beat in the master, in order, on hard cuts", () => {
    const built = buildProject(beats, OPTIONS);
    const index = built.master.find((f) => f.path === "index.html")!.contents;
    expect(index).toContain('data-composition-src="compositions/beat-00.html" data-start="0"');
    expect(index).toContain('data-composition-src="compositions/beat-03.html" data-start="2.5667"');
    expect(built.master.filter((f) => f.path.startsWith("compositions/"))).toHaveLength(3);
  });

  it("makes each clip a standalone project, so one failing beat fails alone", () => {
    const built = buildProject(beats, OPTIONS);
    expect(Object.keys(built.clips)).toEqual(["beat-00", "beat-03", "beat-07"]);
    for (const [id, files] of Object.entries(built.clips)) {
      const index = files.find((f) => f.path === "index.html")!.contents;
      expect(index).toContain(`data-composition-id="clip-${id}"`);
      expect(index).toContain(`data-composition-src="compositions/${id}.html" data-start="0"`);
      expect(files.map((f) => f.path)).toContain(`compositions/${id}.html`);
    }
  });

  it("gives the master a duration equal to the sum of its beats, in whole frames", () => {
    const built = buildProject(beats, OPTIONS);
    expect(built.totalSeconds * 30).toBe(Math.round((2.57 + 2.2 + 4.07) * 30));
    const clipTotal = built.placements.reduce((s, p) => s + (p.endFrame - p.startFrame), 0);
    expect(clipTotal).toBe(built.placements[built.placements.length - 1]!.endFrame);
  });

  it("registers a host timeline, without which nothing binds", () => {
    const index = buildProject(beats, OPTIONS).master.find((f) => f.path === "index.html")!.contents;
    expect(index).toContain('window.__timelines["reel"] = gsap.timeline({ paused: true })');
  });

  it("refuses duplicate ids", () => {
    expect(() => buildProject([beat("beat-00", 2), beat("beat-00", 2)], OPTIONS)).toThrow(/duplicate/);
  });

  it("refuses an empty reel", () => {
    expect(() => buildProject([], OPTIONS)).toThrow(ProjectError);
  });

  describe("sound effects", () => {
    const withCue = [
      beat("beat-00", 2.57, { sfx: [{ source: "sfx/whoosh.ogg", at: 0.2, durationSeconds: 0.6 }] }),
      beat("beat-03", 2.2, { sfx: [{ source: "sfx/whoosh.ogg", at: 0.1, durationSeconds: 0.6, volume: 0.2 }] }),
    ];

    it("stays silent unless --sfx is on, even when the briefs mention sounds", () => {
      const built = buildProject(withCue, OPTIONS, false);
      expect(built.master.find((f) => f.path === "index.html")!.contents).not.toContain("<audio");
      expect(built.assets).toEqual([]);
    });

    it("places a cue on the master timeline at the beat's start plus its offset", () => {
      const index = buildProject(withCue, OPTIONS, true).master.find((f) => f.path === "index.html")!.contents;
      expect(index).toContain('data-start="0.2"');
      expect(index).toContain('data-start="2.6667"'); // beat-03 starts at 77 frames = 2.5667s, + 0.1
    });

    it("keeps a cue beat-relative inside the beat's own clip", () => {
      const clip = buildProject(withCue, OPTIONS, true).clips["beat-03"]!.find((f) => f.path === "index.html")!.contents;
      expect(clip).toContain('data-start="0.1"');
    });

    it("gives every audio element an id, since an id-less one is silently dropped from the mix", () => {
      const index = buildProject(withCue, OPTIONS, true).master.find((f) => f.path === "index.html")!.contents;
      for (const tag of index.match(/<audio[^>]*>/g) ?? []) expect(tag).toMatch(/\bid="/);
    });

    it("sits under the voice by default", () => {
      const index = buildProject(withCue, OPTIONS, true).master.find((f) => f.path === "index.html")!.contents;
      expect(index).toContain(`data-volume="${SFX_DEFAULT_VOLUME}"`);
      expect(index).toContain('data-volume="0.2"');
    });

    it("copies a shared sound once, not once per use", () => {
      expect(buildProject(withCue, OPTIONS, true).assets).toEqual([{ source: "sfx/whoosh.ogg", target: "assets/sfx/whoosh.ogg" }]);
    });
  });
});
