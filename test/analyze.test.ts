import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyzeFile, colourName, describeAudio, dominantFromRgba, gainFor, hasFfmpeg, imageSize, sniffBytes, svgInfo, wordsFrom } from "../src/library/analyze.js";

let work: string;
beforeEach(() => {
  work = mkdtempSync(path.join(os.tmpdir(), "reelcut-analyze-"));
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

const bytes = (...b: number[]): Buffer => Buffer.from(b);

describe("sniffBytes", () => {
  it("decides from the bytes, whatever the file is called", () => {
    expect(sniffBytes(Buffer.concat([bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), Buffer.alloc(16)]))).toMatchObject({ mediaType: "image", ext: "png" });
    expect(sniffBytes(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0))).toMatchObject({ ext: "jpg" });
    expect(sniffBytes(Buffer.from("RIFF\0\0\0\0WAVEfmt "))).toMatchObject({ mediaType: "audio", ext: "wav" });
    expect(sniffBytes(Buffer.from("\0\0\0\x20ftypisom\0\0\0\0"))).toMatchObject({ mediaType: "video", ext: "mp4" });
    expect(sniffBytes(Buffer.from("\0\0\0\x20ftypM4A \0\0\0\0"))).toMatchObject({ mediaType: "audio", ext: "m4a" });
    expect(sniffBytes(Buffer.from("OggS\0\x02\0\0"))).toMatchObject({ mediaType: "audio", ext: "ogg" });
    expect(sniffBytes(Buffer.from("%PDF-1.7"))).toMatchObject({ mediaType: "document", ext: "pdf" });
    expect(sniffBytes(Buffer.from("ID3\x03\0\0\0\0\0\0"))).toMatchObject({ mediaType: "audio", ext: "mp3" });
  });

  it("finds an SVG by its root element, with or without a prolog or a BOM", () => {
    expect(sniffBytes(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toMatchObject({ mediaType: "vector", ext: "svg" });
    expect(sniffBytes(Buffer.from('﻿<?xml version="1.0"?>\n<!-- x -->\n<svg viewBox="0 0 1 1"/>'))).toMatchObject({ ext: "svg" });
  });

  it("refuses what it does not recognise, including text that is not SVG", () => {
    expect(sniffBytes(Buffer.from("MZ\x90\0 this is a program"))).toBeUndefined();
    expect(sniffBytes(Buffer.from("<html><body>hello</body></html>"))).toBeUndefined();
    expect(sniffBytes(Buffer.from('<?xml version="1.0"?><note>no svg here</note>'))).toBeUndefined();
  });
});

describe("wordsFrom", () => {
  it("splits names into words and drops numbers and filler", () => {
    expect(wordsFrom("ClaudeLogo_final_v2 (3).png")).toEqual(["claude", "logo"]);
    expect(wordsFrom("Screenshot 2026-09-30 at 10.12.44.png")).toEqual(["at"]);
    expect(wordsFrom("IMG_4021.jpg")).toEqual([]);
    expect(wordsFrom("whoosh-fast-01.wav")).toEqual(["whoosh", "fast"]);
  });
});

describe("colours", () => {
  it("names the families", () => {
    expect(colourName(47, 91, 255)).toBe("blue");
    expect(colourName(226, 86, 42)).toBe("red");
    expect(colourName(10, 10, 12)).toBe("black");
    expect(colourName(250, 250, 250)).toBe("white");
    expect(colourName(120, 120, 124)).toBe("grey");
    expect(colourName(40, 180, 90)).toBe("green");
  });

  it("takes the dominant colours of raw pixels and skips what is transparent", () => {
    const px: number[] = [];
    for (let i = 0; i < 300; i++) px.push(47, 91, 255, 255);
    for (let i = 0; i < 120; i++) px.push(255, 255, 255, 255);
    for (let i = 0; i < 900; i++) px.push(0, 0, 0, 0); // a transparent background
    const { names, colors } = dominantFromRgba(Buffer.from(px));
    expect(names).toEqual(["blue", "white"]);
    expect(colors[0]).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("describeAudio", () => {
  const rate = 8000;
  /** Seeded noise (so the test is exact) shaped by an envelope. */
  function sound(seconds: number, shape: (t: number) => number, noisy: boolean): Float32Array {
    const n = Math.round(seconds * rate);
    const out = new Float32Array(n);
    let seed = 7;
    for (let i = 0; i < n; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const noise = (seed / 4294967296) * 2 - 1;
      const tone = Math.sin((2 * Math.PI * 180 * i) / rate);
      out[i] = (noisy ? noise : tone) * shape(i / n);
    }
    return out;
  }

  it("calls a very short sharp noise a tick or a click", () => {
    const shape = describeAudio(sound(0.08, (t) => Math.exp(-t * 6), true), rate);
    expect(shape.descriptors).toContain("transient");
    expect(shape.tags).toContain("tick");
  });

  it("calls a low thump with a long tail a hit", () => {
    const shape = describeAudio(sound(1.2, (t) => Math.exp(-t * 5), false), rate);
    expect(shape.tags).toContain("hit");
    expect(shape.descriptors).toContain("dark");
  });

  it("calls swelling noise a whoosh and a climbing one a riser", () => {
    const whoosh = describeAudio(sound(1.0, (t) => Math.sin(Math.PI * t), true), rate);
    expect(whoosh.tags).toContain("whoosh");
    const riser = describeAudio(sound(2.0, (t) => t * t, true), rate);
    expect(riser.tags).toContain("riser");
    expect(riser.tags).not.toContain("whoosh");
  });

  it("measures peak and loudness, and turns them into a gain that keeps headroom", () => {
    const loud = describeAudio(sound(0.5, () => 0.9, false), rate);
    expect(loud.peakDb).toBeGreaterThan(-1.5);
    expect(gainFor(loud)).toBeLessThanOrEqual(0.5);
    const quiet = describeAudio(sound(0.5, () => 0.02, false), rate);
    expect(gainFor(quiet)).toBeGreaterThan(0);
    // Never past +12 dB, however quiet.
    expect(gainFor({ peakDb: -80, lufs: -90 })).toBe(12);
  });
});

describe("images and vectors", () => {
  it("reads a PNG's size from its header", () => {
    const header = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
    header.writeUInt32BE(1080, 16);
    header.writeUInt32BE(720, 20);
    const file = path.join(work, "x.png");
    writeFileSync(file, header);
    expect(imageSize(file)).toEqual({ width: 1080, height: 720 });
  });

  it("pulls the title, text and viewBox out of an SVG, and notices a script", () => {
    const file = path.join(work, "mark.svg");
    writeFileSync(file, '<svg viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg"><title>Lumen mark</title><text>Light on demand</text><script>alert(1)</script></svg>');
    const info = svgInfo(file);
    expect(info).toMatchObject({ width: 120, height: 40, hasScript: true });
    expect(info.words).toEqual(expect.arrayContaining(["lumen", "mark", "light", "demand"]));
  });
});

const ffmpeg = hasFfmpeg();
describe.skipIf(!ffmpeg)("analyzeFile (needs ffmpeg)", () => {
  function make(name: string, args: string[]): string {
    const out = path.join(work, name);
    execFileSync("ffmpeg", ["-v", "error", "-y", ...args, out]);
    return out;
  }

  it("analyses an image: its type from the bytes, its size, a preview and its colours", async () => {
    // Saved with the wrong extension on purpose.
    const file = make("logo-final.dat.png", ["-f", "lavfi", "-i", "color=c=0x2f5bff:s=64x32:d=1", "-frames:v", "1"]);
    const result = await analyzeFile(file, { thumbOut: path.join(work, "thumbs", "a.png"), relPath: "brand-kit/logo-final.png" });
    if ("skipped" in result) throw new Error(result.skipped);
    expect(result).toMatchObject({ mediaType: "image", ext: "png" });
    expect(result.analysis).toMatchObject({ width: 64, height: 32 });
    expect(result.thumb && existsSync(result.thumb)).toBe(true);
    expect(result.autoTags).toEqual(expect.arrayContaining(["blue", "logo", "brand", "kit"]));
  });

  it("analyses a sound: duration, level, a gain, and cue guesses", async () => {
    const file = make("click-01.wav", ["-f", "lavfi", "-i", "anoisesrc=d=0.08:c=white:a=0.6", "-af", "afade=t=out:st=0:d=0.08"]);
    const result = await analyzeFile(file, { thumbOut: path.join(work, "thumbs", "s.png") });
    if ("skipped" in result) throw new Error(result.skipped);
    expect(result.mediaType).toBe("audio");
    expect(result.analysis.durationSeconds).toBeGreaterThan(0.05);
    expect(result.analysis.peakDb).toBeLessThan(0);
    expect(result.analysis.gainDb).toBeDefined();
    expect(result.autoTags).toEqual(expect.arrayContaining(["sfx", "click"]));
    expect(result.thumb && existsSync(result.thumb)).toBe(true);
  });

  it("skips a file it does not recognise, with a reason", async () => {
    const file = path.join(work, "program.png");
    writeFileSync(file, "MZ\x90\0not an image at all");
    expect(await analyzeFile(file)).toMatchObject({ skipped: expect.stringContaining("not a type") });
  });

  it("never suggests a tag a person has rejected", async () => {
    const file = make("logo.png", ["-f", "lavfi", "-i", "color=c=0xff0000:s=16x16:d=1", "-frames:v", "1"]);
    const result = await analyzeFile(file, { suppress: new Set(["red", "logo"]) });
    if ("skipped" in result) throw new Error(result.skipped);
    expect(result.autoTags).not.toContain("logo");
  });
});
