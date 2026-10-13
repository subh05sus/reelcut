import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ARTBOARD_NAMES, CLAWD_ORANGE, CLAWD_SOUNDS, claudeTopic, convertPose, kitPoses, loadClawdPrefs, MOVES, parsePackSvg, planClawd, setFavourite,
  sheetPage, shotComposition, synthesise, wav,
} from "../src/clawd/index.js";
import { IngestManager } from "../src/library/index.js";
import { EVENT_TAGS, proposeCues, searchSfx } from "../src/library/sfx.js";
import { loadSfxPack, packAsAssets, packSoundPath } from "../src/library/sfxpack.js";
import { PersonalitySchema } from "../src/personality/index.js";
import { readKitSources } from "../src/render/kit.js";
import { assertComposition, inspectComposition } from "../src/render/project.js";
import { createStudioServer } from "../src/studio/server.js";

/*
 * Clawd, the Claude mascot: the mascot pack's conversion onto the minimal Clawd, whether a script is about Claude, its
 * 8-bit sounds and where they are allowed, its moves as compositions, the studio's Clawd routes, and — in a browser,
 * when there is one — that a Clawd beat lands on the same picture whichever way it is seeked.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const kit = readKitSources();
const packJs = readFileSync(path.join(root, "skills", "reelcut", "assets", "kit", "ui", "82-clawd-pack.js"), "utf8");
const shipped = [...packJs.matchAll(/^ {4}"[\w-]+": (\{.*\})(?:,)?$/gm)].map((m) => JSON.parse(m[1]!) as {
  id: string; tags: string[]; expr: string; gaze: number[]; arms: Record<string, number[]>; legs: string; minis: number[][];
  layers: { x: number; y: number; rows: string[]; pal: string[]; kind: string; motion: string; z: string }[];
});

/** A pack-style SVG from rows of characters, one rect per pixel on the pack's ~42.84 px grid. */
function packSvg(rows: string[], colors: Record<string, string>): string {
  const rects: string[] = [];
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (colors[ch]) rects.push(`<rect x="${(600 + x * 42.84).toFixed(3)}" y="${(600 + y * 42.84).toFixed(3)}" width="43.55" height="43.55" fill="${colors[ch]}" />`);
  }));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000" viewBox="0 0 2000 2000">${rects.join("")}</svg>`;
}
const PACK = { "#": CLAWD_ORANGE, k: "#2f2f38", w: "#fff", y: "#ffbc00", s: "#ffffff" };
// The pack's Clawd with both arms up, a lightbulb over its head and two sparkles: a 14 × 9 body, dot eyes, a smile.
const IDEA = [
  "........yyyy........",
  ".......yyyyyy.......",
  "........yyyy........",
  "....................",
  "###..............###",
  "###......y.......###",
  "###..............###",
  "...##############...",
  "...##############...",
  "...##############...",
  "...##############...",
  "...###k######k###...",
  "...#####w##w#####...",
  "...######ww######...",
  "...##############...",
  "...##############...",
  "...#..#......#..#...",
  "...#..#......#..#...",
];

describe("the mascot pack, re-cast onto the minimal Clawd", () => {
  it("reads the pack Clawd's eyes and raised arms, and keeps everything else as layers", () => {
    const pose = convertPose(packSvg(IDEA, PACK), "idea-test")!;
    expect(pose).not.toBeNull();
    expect(pose.expr).toBe("open");
    expect(pose.arms.l?.[1]).toBeLessThan(-2);           // raised: well above where an arm hangs
    expect(pose.arms.r?.[1]).toBeLessThan(-2);
    expect(pose.legs).toBe("straight");
    const bulb = pose.layers.find((l) => l.pal.includes("#ffbc00") && l.kind === "prop")!;
    expect(bulb.y).toBeLessThan(-8);                     // above the minimal Clawd's head, which tops out 8 units up
    expect(pose.layers.some((l) => l.pal.includes(CLAWD_ORANGE))).toBe(false);
  });

  it("puts rects drawn flipped with rotate(-180) back where they were", () => {
    const [r] = parsePackSvg(`<rect x="892.625" y="743.025" width="43.55" height="43.55" transform="translate(1828.8,1528.8) rotate(-180)" fill="#d97757" />`);
    // translate(1828.8, 1528.8) rotate(-180) maps (x, y, w, h) to (1828.8 - x - w, 1528.8 - y - h): the same pixel of the
    // grid, the pack's coordinates being rounded to tenths of a pixel.
    expect(r!.x).toBeCloseTo(892.625, 2);
    expect(r!.y).toBeCloseTo(742.225, 2);
    expect(r!.fill).toBe("#d97757");
  });

  it("names the pack's unnamed artboards by what they show", () => {
    expect(convertPose(packSvg(IDEA, PACK), "artboard-24cla")!.id).toBe("zen-om");
    expect(Object.values(ARTBOARD_NAMES)).toContain("with-minis");
  });

  it("ships its poses in the kit, each well formed", () => {
    expect(shipped.length).toBeGreaterThanOrEqual(60);
    expect(new Set(shipped.map((p) => p.id)).size).toBe(shipped.length);
    for (const p of shipped) {
      expect(p.tags.length, p.id).toBeGreaterThan(0);
      for (const l of p.layers) {
        expect(new Set(l.rows.map((r) => r.length)).size, `${p.id}: rows of one width`).toBe(1);
        const used = new Set(l.rows.join("").replace(/\./g, ""));
        for (const ch of used) expect(ch.charCodeAt(0) - 97, `${p.id}: colour ${ch}`).toBeLessThan(l.pal.length);
      }
    }
    expect(shipped.find((p) => p.id === "with-minis")!.minis.length).toBe(4);
    expect(kitPoses().map((p) => p.id)).toEqual(shipped.map((p) => p.id));
  });

  it("never draws the pack's own Clawd: no layer is a block of Clawd's orange", () => {
    for (const p of shipped) for (const l of p.layers) {
      const i = l.pal.indexOf(CLAWD_ORANGE);
      if (i < 0) continue;
      const n = l.rows.join("").split(String.fromCharCode(97 + i)).length - 1;
      expect(n, `${p.id}: ${n} orange pixels in one layer`).toBeLessThanOrEqual(24);
    }
  });
});

describe("whether a script is about Claude", () => {
  it("knows Claude, Claude Code and its tools, in English and German", () => {
    expect(claudeTopic("Claude, can you please post this video for me? First, you connect Composio to Claude as a connector.").about).toBe(true);
    expect(claudeTopic("Mit Claude Code baust du in zehn Minuten einen Skill.").mentions).toContain("Claude Code");
    expect(claudeTopic("Add the MCP server, then install the plugin.").about).toBe(true);
    expect(claudeTopic("Three pancakes, a little butter, and maple syrup.").about).toBe(false);
    expect(claudeTopic("Notara oder Kettlebrief? Welche Notiz-App ist besser?").about).toBe(false);
  });

  it("gives the hook, the steps, the payoff and the call to action their parts", () => {
    const plan = planClawd([
      { id: "b0", text: "Claude, can you please post this video for me at the best time?" },
      { id: "b1", text: "First, you connect Composio to Claude as a connector." },
      { id: "b2", text: "Then you give it my skill." },
      { id: "b3", text: "I try to post every day." },
      { id: "b4", text: "So yeah, Claude posts for you every day." },
      { id: "b5", text: "Comment POST, and I'll send you the skill." },
    ]);
    expect(plan.map((b) => b.role)).toEqual(["hook", "step", "step", "react", "payoff", "cta"]);
    expect(plan[1]!.acts).toContain("plug");
    expect(plan[2]!.acts).toContain("carry");
    expect(plan[5]!.acts[0]).toBe("sign");
  });

  it("only suggests poses the kit ships", () => {
    const source = readFileSync(path.join(root, "src", "clawd", "topic.ts"), "utf8");
    const named = [...source.matchAll(/poses: \[([^\]]*)\]/g)].flatMap((m) => [...m[1]!.matchAll(/"([\w-]+)"/g)].map((x) => x[1]!));
    const ids = new Set(shipped.map((p) => p.id));
    for (const n of new Set(named)) expect(ids.has(n), n).toBe(true);
  });
});

describe("Clawd's sounds", () => {
  it("are synthesised the same way every time, peaking at -1 dBFS", () => {
    for (const s of CLAWD_SOUNDS) {
      const a = synthesise(s), b = synthesise(s);
      expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer)), s.id).toBe(true);
      const peak = a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      expect(20 * Math.log10(peak), s.id).toBeCloseTo(-1, 1);
    }
    const w = wav(synthesise(CLAWD_SOUNDS[0]!));
    expect(w.subarray(0, 4).toString()).toBe("RIFF");
    expect(w.subarray(8, 12).toString()).toBe("WAVE");
  });

  it("ship in the pack, one per act, each tagged for its act", () => {
    const pack = loadSfxPack()!;
    for (const s of CLAWD_SOUNDS) {
      const entry = pack.byId.get(s.id)!;
      expect(entry, s.id).toBeDefined();
      expect(existsSync(packSoundPath(pack, entry)), s.id).toBe(true);
      expect(entry.tags).toContain("clawd");
      expect(Object.keys(EVENT_TAGS)).toContain(s.event);
    }
  });

  it("are only ever offered for Clawd: an ordinary pop or click never gets an 8-bit blip", () => {
    const assets = packAsAssets(loadSfxPack());
    for (const event of ["pop", "click", "success", "hit", "keystroke"]) {
      for (const m of searchSfx(assets, { event })) expect(m.asset.tags, `${event}: ${m.asset.id}`).not.toContain("clawd");
    }
  });

  it("have a budget of their own, so a walk's footsteps never push out a click", () => {
    const assets = packAsAssets(loadSfxPack());
    const steps = Array.from({ length: 12 }, (_, i) => ({ type: "clawd-step", at: 0.2 + i * 0.15 }));
    const cues = proposeCues([{ id: "b", durationSeconds: 4, events: [{ type: "click", at: 1 }, { type: "pop", at: 2.2 }, { type: "clawd-land", at: 2.5 }, ...steps] }], assets, { seed: "t" });
    const clawd = cues.filter((c) => c.event.startsWith("clawd-")), rest = cues.filter((c) => !c.event.startsWith("clawd-"));
    expect(rest.map((c) => c.event)).toEqual(["click", "pop"]);
    expect(clawd.length).toBeLessThanOrEqual(8);
    expect(clawd.some((c) => c.event === "clawd-land" && c.soundId === "pack:clawd-land")).toBe(true);
    const stepTimes = clawd.filter((c) => c.event === "clawd-step").map((c) => c.at);
    for (let i = 1; i < stepTimes.length; i++) expect(stepTimes[i]! - stepTimes[i - 1]!).toBeGreaterThanOrEqual(0.28);
  });
});

describe("Clawd's moves", () => {
  /** What RC.clawd carries: the keys of `Object.assign(clawd, { … })` in 80-clawd.js and `Object.assign(K, { … })` in 81. */
  const exported = new Set([...kit.js.matchAll(/Object\.assign\((?:clawd|K), \{([\s\S]*?)\}\);/g)].flatMap((m) => [...m[1]!.matchAll(/\b([a-zA-Z]+):/g)].map((x) => x[1]!)));

  it("each makes a composition that agrees with itself, for any style", () => {
    for (const m of MOVES) {
      const id = `clawd-move-${m.id}`;
      const { html, seconds } = shotComposition(id, { what: `move:${m.id}`, style: "claymation", transparent: true });
      expect(inspectComposition(html)).toMatchObject({ hasTemplate: true, compositionId: id, timelineKey: id, width: 1080, height: 1080 });
      expect(() => assertComposition({ id, durationSeconds: seconds, compositionHtml: html }, { width: 1080, height: 1080, fps: 60 })).not.toThrow();
    }
    expect(() => shotComposition("x", { what: "move:moonwalk" })).toThrow(/no Clawd move/);
  });

  it("calls only acts the kit has, as do the patterns", () => {
    const patterns = path.join(root, "skills", "reelcut", "assets", "patterns", "clawd");
    const sources = [...MOVES.map((m) => m.score), ...["clawd-hook", "clawd-connector", "clawd-skill", "clawd-payoff", "clawd-cta", "clawd-subagents", "clawd-hatch"].map((p) => readFileSync(path.join(patterns, `${p}.html`), "utf8"))];
    for (const src of sources) for (const m of src.matchAll(/RC\.clawd\.([a-zA-Z]+)\(/g)) expect(exported.has(m[1]!), `RC.clawd.${m[1]}`).toBe(true);
  });

  it("plays on a sheet in the studio: one looping scene per move, each with its star", () => {
    const page = sheetPage({ shots: MOVES.slice(0, 3).map((m, i) => ({ what: `move:${m.id}`, label: m.name, starred: i === 0 })), style: "linear", look: "ink", kitCss: "", kitJs: "", gsapUrl: "gsap.js" });
    expect(page.match(/class="cell/g)!.length).toBe(3);
    expect(page).toContain('class="cell on"');
    expect(page).toContain('data-style="linear"');
  });
});

describe("the personality's mascot", () => {
  it("defaults to Clawd hosting the reels about Claude", () => {
    const now = new Date().toISOString();
    const p = PersonalitySchema.parse({ id: "p", name: "t", createdAt: now, updatedAt: now });
    expect(p.mascot).toEqual({ character: "clawd", when: "claude", role: "host", size: "medium", wear: "" });
  });
});

describe("the studio's Clawd routes", () => {
  let home: string, server: http.Server, port: number;
  beforeEach(async () => {
    home = mkdtempSync(path.join(os.tmpdir(), "reelcut-clawd-"));
    process.env.REELCUT_HOME = home;
    server = createStudioServer({ ingest: new IngestManager({ watch: false }) });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    delete process.env.REELCUT_HOME;
    rmSync(home, { recursive: true, force: true });
  });
  const call = (p: string, method = "GET", body?: unknown): Promise<{ status: number; text: string }> => new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: "127.0.0.1", port, path: p, method, headers: { host: `127.0.0.1:${port}`, "content-type": "application/json", ...(data ? { "content-length": data.length } : {}) } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });

  it("lists the moves and poses, stars one, and refuses what is not a move or a pose", async () => {
    const cat = JSON.parse((await call("/api/clawd")).text) as { moves: unknown[]; poses: unknown[]; favourites: string[] };
    expect(cat.moves.length).toBe(MOVES.length);
    expect(cat.poses.length).toBe(shipped.length);
    expect(cat.favourites).toEqual([]);
    const r = await call("/api/clawd/favourites", "POST", { id: "pose:idea-lightbulb", star: true });
    expect(JSON.parse(r.text).favourites).toEqual(["pose:idea-lightbulb"]);
    expect(loadClawdPrefs().favourites).toEqual(["pose:idea-lightbulb"]);
    expect((await call("/api/clawd/favourites", "POST", { id: "../etc", star: true })).status).toBe(400);
    expect(() => setFavourite("nope", true)).toThrow();
  });

  it("serves the sheet for a kind, a style, a look and a filter, and refuses a style that does not exist", async () => {
    const r = await call("/clawd/sheet?kind=poses&style=claymation&look=ink&tag=sleep");
    expect(r.status).toBe(200);
    expect(r.text).toContain("pose:sleeping-soundly");
    expect(r.text).not.toContain("pose:rocket-launch-success");
    expect((await call("/clawd/sheet?style=watercolour")).status).toBe(400);
  });
});

/*
 * In a browser: a Clawd beat seeked forwards, backwards and straight to a time shows the same rig, attribute for
 * attribute. Needs Chrome and GSAP from its CDN; skipped without them.
 */
describe.skipIf(!process.env.REELCUT_BROWSER_TESTS)("a Clawd beat in a browser (REELCUT_BROWSER_TESTS=1)", { timeout: 60_000 }, () => {
  it("lands on the same picture whichever way it is seeked", async () => {
    const { resolveBrowser } = await import("../src/capture/capture.js");
    const { buildMeasurePage } = await import("../src/verify/measure.js");
    const { loadKit } = await import("../src/render/kit.js");
    const puppeteer = (await import("puppeteer-core")).default;
    const html = readFileSync(path.join(root, "skills", "reelcut", "assets", "patterns", "clawd", "clawd-connector.html"), "utf8");
    const page = buildMeasurePage(html, loadKit("inline"));
    const browser = await puppeteer.launch({ executablePath: resolveBrowser(), headless: true, args: ["--no-sandbox"] });
    try {
      const state = async (times: number[]): Promise<string> => {
        const tab = await browser.newPage();
        await tab.setContent(page, { waitUntil: "load" });
        // The page's own code, as a string: this repo compiles without the DOM's types.
        const out = (await tab.evaluate(`(() => {
          const tl = window.__timelines["clawd-connector"];
          tl.pause();
          for (const t of ${JSON.stringify(times)}) tl.time(t, false);
          return [...document.querySelectorAll("svg.rc-clawd")].map((s) => s.outerHTML).join("\\n");
        })()`)) as string;
        await tab.close();
        return out;
      };
      const straight = await state([2.4]);
      expect(await state([0.5, 1.3, 3.9, 4.5, 2.4])).toBe(straight);
      expect(await state([4.5, 0.1, 2.4])).toBe(straight);
    } finally {
      await browser.close();
    }
  });
});
