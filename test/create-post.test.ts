import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let home: string, dir: string, reelPath: string;
beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), "rc-post-")); process.env.REELCUT_HOME = home;
  dir = path.join(home, "out-x"); reelPath = path.join(dir, "reel.json");
  mkdirSync(path.join(dir, "compositions"), { recursive: true });
  writeFileSync(reelPath, JSON.stringify({ format: "9:16", beats: [{ id: "beat-00", durationSeconds: 2, composition: "compositions/beat-00.html" }, { id: "beat-01", durationSeconds: 3, text: "Reelcut renders 60 frames every second." }] }));
  writeFileSync(path.join(dir, "compositions/beat-00.html"), `<div id="root"><h1>I built</h1><b>R</b><b>e</b><b>e</b><b>l</b></div>`);
});
afterEach(() => { delete process.env.REELCUT_HOME; rmSync(home, { recursive: true, force: true }); });

describe("captions", () => {
  it("takes words from the screen without a voiceover, spread over each beat", async () => {
    const { captionWords } = await import("../src/create/captions.js");
    const { words, source } = captionWords(reelPath);
    expect(source).toBe("screen");
    expect(words.map((w) => w.w)).toEqual(["I", "built", "Reel", "Reelcut", "renders", "60", "frames", "every", "second."]);
    expect(words[0]!.start).toBeGreaterThan(0);
    expect(words[3]!.start).toBeGreaterThanOrEqual(2);
    expect(words.at(-1)!.end).toBeLessThanOrEqual(5);
    expect(words.filter((w) => w.key).map((w) => w.w)).toEqual(["Reel", "Reelcut", "renders", "60"]);
  });
  it("takes the voiceover's words when there is one, from where the first beat starts", async () => {
    const { captionWords } = await import("../src/create/captions.js");
    writeFileSync(path.join(dir, "voice.json"), JSON.stringify({ spans: [{ start: 0.5 }], words: [{ w: "Hello", start: 0.6, end: 0.9, beat: "beat-00" }, { w: "there.", start: 1, end: 1.3, beat: "beat-00" }] }));
    const { words, source } = captionWords(reelPath);
    expect(source).toBe("voice");
    expect(words[0]).toMatchObject({ w: "Hello" });
    expect(words[0]!.start).toBeCloseTo(0.1);
  });
  it("breaks lines at sentences, pauses, beats and length, and writes SRT and VTT", async () => {
    const { chunkWords, toSrt, toVtt } = await import("../src/create/captions.js");
    const w = (x: string, s: number, beat = "a") => ({ w: x, start: s, end: s + 0.3, beat });
    const chunks = chunkWords([w("One", 0), w("two.", 0.4), w("Three", 0.8), w("four", 2), w("five", 2.4, "b")]);
    expect(chunks.map((c) => c.words.map((x) => x.w).join(" "))).toEqual(["One two.", "Three", "four", "five"]);
    expect(chunks[0]!.end).toBeCloseTo(0.8);
    expect(toSrt(chunks).split("\n").slice(0, 3)).toEqual(["1", "00:00:00,000 --> 00:00:00,800", "One two."]);
    expect(toVtt(chunks).startsWith("WEBVTT\n\n00:00:00.000 --> 00:00:00.800\nOne two.")).toBe(true);
  });
  it("draws the captions over the master on one registered timeline", async () => {
    const { captionComposition } = await import("../src/create/captions.js");
    const html = captionComposition({ chunks: [{ start: 0, end: 1, words: [{ w: "Hi", start: 0, end: 0.5, beat: "a", key: true }] }], style: "key-words", format: "9:16", duration: 1, look: { ground: "#000000", ink: "#ffffff", accent: "#ff0000", look: "paper" } });
    expect(html).toContain('data-width="1080" data-height="1920"');
    expect(html).toContain('<video src="assets/master.mp4"');
    expect(html).toContain('class="w k"');
    expect(html).toContain('window.__timelines["captions"] = tl');
  });
  it("burns in only a voiced reel", async () => {
    const { burnCaptions } = await import("../src/create/captions.js");
    writeFileSync(path.join(dir, "master.mp4"), "");
    await expect(burnCaptions(reelPath, "karaoke")).rejects.toThrow(/no voiceover/);
  });
});

describe("post kit", () => {
  it("asks Claude for the platforms chosen, in the file the page reads", async () => {
    const { postKitPrompt } = await import("../src/create/postkit.js");
    const p = postKitPrompt(reelPath, ["instagram", "youtube"], "keep it short");
    expect(p).toContain(path.join(dir, "post-kit.json"));
    expect(p).toContain('"firstComment"');
    expect(p).toContain('"youtube"');
    expect(p).not.toContain('"tiktok"');
    expect(p).toContain("The owner adds: keep it short");
    expect(p).toContain("Never invent facts");
  });
  it("sets the cover title in the display type with the longest word accented", async () => {
    const { coverHtml } = await import("../src/create/postkit.js");
    const html = coverHtml({ frame: "data:,", title: "I built Reelcut", W: 1080, H: 1920, fit: "cover", look: { ground: "#000000", ink: "#ffffff", accent: "#ff0000", look: "paper", type: "crafted" } });
    expect(html).toContain('<em class="rc">Reelcut</em>');
    expect(html).toContain("data-rc-kit");
    expect(html).toContain('data-type="crafted"');
  });
});
