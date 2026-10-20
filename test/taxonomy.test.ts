import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasFfmpeg, IngestManager } from "../src/library/index.js";
import { MOVES } from "../src/references/vocab.js";
import { DOMAINS, OPERATIONS, TECHNIQUES, TIMINGS } from "../src/taxonomy/catalog.js";
import { checkPath, formatPath, parsePath, suggest } from "../src/taxonomy/paths.js";
import { PATTERN_TECHNIQUES, patternsFor } from "../src/taxonomy/patterns.js";

const REPO = path.resolve(__dirname, "..");
const PATTERNS = path.join(REPO, "skills", "reelcut", "assets", "patterns");

describe("the techniques catalog", () => {
  it("has six operations, nine domains, six timings and a few dozen techniques, each well formed", () => {
    expect(OPERATIONS.map((o) => o.id)).toEqual(["differentiate", "group", "sequence", "infer", "reveal", "transform"]);
    expect(DOMAINS).toHaveLength(9);
    expect(TIMINGS).toHaveLength(6);
    expect(TECHNIQUES.length).toBeGreaterThanOrEqual(60);
    const ids = TECHNIQUES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TECHNIQUES) {
      expect(DOMAINS.map((d) => d.id), t.id).toContain(t.domain);
      expect(TIMINGS.map((x) => x.id), t.id).toContain(t.timing);
      expect(t.operations.length, t.id).toBeGreaterThan(0);
      for (const op of t.operations) expect(OPERATIONS.map((o) => o.id), t.id).toContain(op);
      for (const m of t.moves) expect(MOVES as readonly string[], `${t.id} move ${m}`).toContain(m);
      expect(t.does.length, t.id).toBeGreaterThan(20);
    }
  });
  it("gives every domain techniques, and every operation at least five", () => {
    for (const d of DOMAINS) expect(TECHNIQUES.some((t) => t.domain === d.id), d.id).toBe(true);
    for (const o of OPERATIONS) expect(TECHNIQUES.filter((t) => t.operations.includes(o.id)).length, o.id).toBeGreaterThanOrEqual(5);
  });
  it("credits its inspiration and borrows nothing by name", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(path.join(REPO, "src", "taxonomy", "catalog.ts"), "utf8")).toContain("Modern Art Direction");
    for (const t of TECHNIQUES) expect(t.name.toLowerCase(), t.id).not.toContain("iris");
  });
});

describe("pattern tags", () => {
  const files = ["", "apple", "clawd", "footage", "styles"].flatMap((d) => readdirSync(path.join(PATTERNS, d)).filter((f) => f.endsWith(".html")).map((f) => path.basename(f, ".html")));
  it("tags every pattern file with real techniques", () => {
    for (const id of files) {
      expect(PATTERN_TECHNIQUES[id], `${id} has no techniques`).toBeDefined();
      for (const t of PATTERN_TECHNIQUES[id]!) expect(TECHNIQUES.some((x) => x.id === t), `${id}: ${t}`).toBe(true);
    }
    for (const id of Object.keys(PATTERN_TECHNIQUES)) expect(files, `${id} is tagged but has no file`).toContain(id);
  });
  it("finds the patterns for a technique, main move first", () => {
    expect(patternsFor("big-number")[0]).toBe("stat-count");
    expect(patternsFor("hierarchy-tree")).toContain("graph-tree");
    expect(patternsFor("hierarchy-tree", { "graph-tree": ["bloom"] })).not.toContain("graph-tree");
  });
});

describe("technique paths", () => {
  it("parses, fills in the timing, and prints", () => {
    expect(parsePath("differentiate/semantic/semantic-contrast")).toEqual({ operation: "differentiate", domain: "semantic", technique: "semantic-contrast", timing: "hold" });
    expect(formatPath(parsePath("Reveal/Space/From-Depth/build")!)).toBe("reveal/space/from-depth/build");
    expect(parsePath("just-a-word")).toBeUndefined();
  });
  it("refuses a wrong domain or an unknown technique, and warns about an unusual operation", () => {
    expect(checkPath("differentiate/semantic/semantic-contrast/hold")).toMatchObject({ ok: true, warnings: [] });
    expect(checkPath("differentiate/feature/semantic-contrast").errors[0]).toMatch(/semantic domain, not feature/);
    expect(checkPath("differentiate/feature/no-such-move").ok).toBe(false);
    expect(checkPath("sequence/semantic/semantic-contrast").warnings[0]).toMatch(/usually for differentiate/);
    expect(checkPath("differentiate/semantic/semantic-contrast/fast").errors[0]).toMatch(/no timing/);
  });
});

describe("suggesting", () => {
  const top = (s: ReturnType<typeof suggest>) => s.map((x) => x.technique.id);
  it("reads what a line asks for, in English and German", () => {
    expect(top(suggest({ kind: "data", text: "Über 71.000 Follower in sechs Monaten" }, 3))).toContain("big-number");
    expect(top(suggest({ kind: "product", text: "Zuerst hängst du Composio einmal als Connector in Claude rein" }, 1))).toEqual(["real-ui-demo"]);
    expect(top(suggest({ kind: "statement", text: "Früher drei Tools, jetzt nur noch eins" }, 1))).toEqual(["before-after"]);
    expect(suggest({ kind: "hook", text: "Why does nobody do this?" }, 3).every((x) => x.path.operation === "reveal" || x.technique.operations.includes("reveal"))).toBe(true);
  });
  it("never suggests a banned technique, ranks a favoured one up, and keeps away from the neighbour's", () => {
    const line = { kind: "data" as const, text: "Über 71.000 Follower" };
    expect(top(suggest({ ...line, ban: ["big-number"] }, 10))).not.toContain("big-number");
    expect(top(suggest({ ...line, favour: ["colour-isolation"] }, 1))).toEqual(["colour-isolation"]);
    expect(top(suggest({ ...line, recent: ["big-number"] }, 1))).not.toEqual(["big-number"]);
    expect(top(suggest({ ...line, scores: new Map([["highlighter", 4]]) }, 1))).toEqual(["highlighter"]);
  });
  it("can look only at one operation, for ideas", () => {
    expect(suggest({ text: "anything", focus: "transform" }, 5).every((x) => x.technique.operations.includes("transform") && x.path.operation === "transform")).toBe(true);
  });
});

describe("the store: tags, pins, scores", () => {
  let home: string;
  beforeEach(() => { home = mkdtempSync(path.join(os.tmpdir(), "rc-tax-")); process.env.REELCUT_HOME = home; });
  afterEach(() => { delete process.env.REELCUT_HOME; rmSync(home, { recursive: true, force: true }); });

  it("keeps Claude's pattern tags proposed until accepted, and the owner's own tags win", async () => {
    const t = await import("../src/taxonomy/store.js");
    expect(t.patternTags("stat-count")).toMatchObject({ by: "claude", state: "proposed" });
    expect(t.acceptPatternTags("stat-count")).toBe(1);
    expect(t.patternTags("stat-count")).toMatchObject({ by: "claude", state: "accepted" });
    t.setPatternTags("stat-count", ["highlighter"]);
    expect(t.patternTags("stat-count")).toMatchObject({ techniques: ["highlighter"], by: "user" });
    expect(() => t.setPatternTags("stat-count", ["not-a-technique"])).toThrow(/no technique/);
    expect(t.acceptPatternTags()).toBeGreaterThan(50);
  });

  it("scores a technique by how its beats were rated", async () => {
    const out = path.join(home, "out-a");
    mkdirSync(out, { recursive: true });
    const manifest = path.join(out, "reel.json");
    writeFileSync(manifest, JSON.stringify({ beats: [
      { id: "beat-00", durationSeconds: 3, composition: "c.html", technique: "differentiate/typographic/big-number/build", techniqueWhy: "the figure is the claim" },
      { id: "beat-01", durationSeconds: 3, composition: "c.html", technique: "differentiate/typographic/big-number" },
      { id: "beat-02", durationSeconds: 3, composition: "c.html" },
    ] }));
    const { recordRun } = await import("../src/library/runs.js");
    const run = recordRun({ outDir: out, manifest, beats: ["beat-00", "beat-01", "beat-02"], clips: [], libraryAssets: [] });
    const { recordSignals } = await import("../src/learnings/store.js");
    const { thumbSignal } = await import("../src/learnings/signals.js");
    recordSignals([thumbSignal({ reel: run.id, beat: "beat-00", rating: "up", at: new Date().toISOString() }), thumbSignal({ reel: run.id, beat: "beat-01", rating: "down", at: new Date().toISOString() })]);
    const t = await import("../src/taxonomy/store.js");
    const beats = t.techniqueBeats();
    expect(beats).toHaveLength(2);
    expect(beats[0]).toMatchObject({ beat: "beat-00", technique: "big-number", rating: "up", why: "the figure is the claim" });
    expect(t.scoreTechniques(beats).get("big-number")).toEqual({ uses: 2, up: 1, down: 1, score: 0 });
    const { examplesFor } = await import("../src/taxonomy/examples.js");
    expect(examplesFor("big-number").beats[0]!.rating).toBe("up");
  });

  it("pins only real paths", async () => {
    const t = await import("../src/taxonomy/store.js");
    t.pinTechnique("reveal/space/from-depth", "c_x", "for the hook");
    expect(t.loadTaxonomy().pins[0]).toMatchObject({ path: "reveal/space/from-depth/build", conversation: "c_x", note: "for the hook" });
    expect(() => t.pinTechnique("reveal/space/nothing")).toThrow();
  });

  it("turns a brief into directions, one operation each", async () => {
    const { ideasFor } = await import("../src/taxonomy/examples.js");
    const ideas = ideasFor("Make our product stand out from the competitors: it replaces three old tools");
    expect(ideas.map((i) => i.operation)).toContain("differentiate");
    expect(ideas.map((i) => i.operation)).toContain("transform");
    for (const idea of ideas) for (const s of idea.suggestions) expect(s.technique.operations).toContain(idea.operation);
  });
});

describe.skipIf(!hasFfmpeg())("graph atlases", () => {
  let home: string;
  beforeEach(() => { home = mkdtempSync(path.join(os.tmpdir(), "rc-atlas-")); process.env.REELCUT_HOME = home; });
  afterEach(() => { delete process.env.REELCUT_HOME; rmSync(home, { recursive: true, force: true }); });

  it("packs images into one atlas, and refuses reference frames without the reel's opt-in", async () => {
    const files = ["red", "blue", "green"].map((c) => {
      const f = path.join(home, `${c}.png`);
      execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${c}:size=200x150`, "-frames:v", "1", f]);
      return f;
    });
    const a = await import("../src/graph/atlas.js");
    const meta = a.buildAtlas(files.map((f) => ({ kind: "file", file: f, label: path.basename(f) })), [40, 50]);
    expect(meta.cells).toHaveLength(3);
    expect(meta.atlas).toMatch(/^assets\/graph\/[0-9a-f]{16}\.jpg$/);
    expect(a.buildAtlas(files.map((f) => ({ kind: "file", file: f, label: path.basename(f) })), [40, 50]).sha).toBe(meta.sha);
    const html = `node.image = { atlas: "${meta.atlas}" }`;
    expect(a.graphRefsIn(html)).toEqual([meta.sha]);
    expect(a.checkGraphRefs(html, {})).toEqual([]);
    const withRef = a.buildAtlas([{ kind: "reference", file: files[0]!, label: "Someone's film", id: "r_1", at: 3.5 }, { kind: "file", file: files[1]!, label: "mine" }], [40, 50]);
    const refHtml = `"${withRef.atlas}"`;
    expect(a.checkGraphRefs(refHtml, {})[0]).toMatch(/did not opt in/);
    expect(a.checkGraphRefs(refHtml, { referenceThumbnails: true })).toEqual([]);
    expect(a.graphProvenance([{ id: "beat-02", html: refHtml }])).toMatch(/Someone's film at 3\.5s/);
    expect(a.checkGraphRefs(`"assets/graph/0123456789abcdef.jpg"`, {})[0]).toMatch(/not in ~\/\.reelcut\/graph/);
    const dir = path.join(home, "clip");
    a.copyGraphAssets(dir, [meta.sha]);
    expect(readdirSync(path.join(dir, "assets", "graph"))).toEqual([`${meta.sha}.jpg`]);
  });
});

describe("techniques in the studio", () => {
  let home: string, server: http.Server, port: number;
  beforeAll(async () => {
    home = mkdtempSync(path.join(os.tmpdir(), "rc-tax-studio-"));
    process.env.REELCUT_HOME = home;
    const { createStudioServer } = await import("../src/studio/server.js");
    server = createStudioServer({ ingest: new IngestManager({ watch: false }) });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => { await new Promise((r) => server.close(r)); delete process.env.REELCUT_HOME; rmSync(home, { recursive: true, force: true }); });
  const call = (p: string, method = "GET", body?: unknown) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port, path: p, method, headers: { host: `127.0.0.1:${port}`, ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } }, (res) => {
      let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => resolve({ status: res.statusCode ?? 0, body: t }));
    });
    req.on("error", reject); req.end(data);
  });

  it("serves the catalog with examples, scores and the credit", async () => {
    const r = await call("/api/techniques");
    expect(r.status).toBe(200);
    const j = JSON.parse(r.body);
    expect(j.techniques.length).toBeGreaterThanOrEqual(60);
    expect(j.techniques.find((t: { id: string }) => t.id === "big-number").examples.patterns.map((p: { id: string }) => p.id)).toContain("stat-count");
    expect(j.credit).toMatch(/Modern Art Direction/);
    expect(j.proposedPatterns.length).toBeGreaterThan(50);
  });
  it("draws the live graph with the kit's engine", async () => {
    const r = await call("/techniques/graph?look=ink");
    expect(r.status).toBe(200);
    expect(r.body).toContain("RC.graph(");
    expect(r.body).toContain('data-look="ink"');
    expect(r.body).toContain("Differentiate");
  });
  it("accepts tags, refuses bad ones, and refuses a bad pin", async () => {
    expect(JSON.parse((await call("/api/techniques/accept", "POST", {})).body).accepted).toBeGreaterThan(50);
    expect((await call("/api/techniques/tag", "POST", { kind: "pattern", id: "stat-count", techniques: ["nope"] })).status).toBe(400);
    expect((await call("/api/techniques/tag", "POST", { kind: "pattern", id: "stat-count", techniques: ["big-number"] })).status).toBe(200);
    expect((await call("/api/techniques/pin", "POST", { path: "x/y" })).status).toBe(400);
    expect((await call("/api/techniques/pin", "POST", { path: "reveal/space/from-depth", conversation: "c_none" })).status).toBe(404);
  });
  it("starts a From-a-brief chat with directions to choose, then the script", async () => {
    const { CreateManager } = await import("../src/create/manager.js");
    const cm = new CreateManager({ queryFn: (() => (async function* () {})()) as never });
    const s = cm.create("x", { mode: "brief", target: "30" });
    const p = cm.firstPrompt(s, { text: "Launch our scheduler", settings: s.settings });
    expect(p.startsWith("/reelcut")).toBe(false);
    expect(p).toContain("npm run techniques -- ideas");
    expect(p).toContain('header "Direction", multiSelect');
    expect(p).toContain("beats[].technique");
  });
});

describe("technique previews", () => {
  it("every technique has a plain line and a sample, and a preview composition that obeys the contract", async () => {
    const { PLAIN } = await import("../src/taxonomy/plain.js");
    const { techniquePreviewComposition } = await import("../src/taxonomy/preview.js");
    const { styleById } = await import("../src/personality/styles.js");
    const st = styleById("flat-vector")!;
    for (const t of TECHNIQUES) {
      expect(PLAIN[t.id]?.plain, t.id).toBeTruthy();
      expect(PLAIN[t.id]!.sample.length, t.id).toBeLessThanOrEqual(30);
      const html = techniquePreviewComposition(t.id, st, { id: `tq-${t.id}`, palette: st.palettes[0]!, pairing: st.fonts.best[0]! });
      expect(html, t.id).toContain(`data-composition-id="tq-${t.id}"`);
      expect(html, t.id).toContain(`window.__timelines["tq-${t.id}"]`);
      expect(html, t.id).toContain("RC.hold(tl, 3.4)");
      expect(html, t.id).not.toMatch(/Math\.random|Date\.now/);
      // The generated script parses.
      const js = html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
      expect(() => new Function(js), t.id).not.toThrow();
    }
  });
  it("knows which previews exist for the default personality and when they are out of date", async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "rc-pv-"));
    process.env.REELCUT_HOME = home;
    try {
      const { previewStatus, previewDirFor, stampFor } = await import("../src/taxonomy/previews.js");
      expect(previewStatus(undefined)).toMatchObject({ key: "plain", have: [], stale: false });
      const dir = previewDirFor(undefined);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "big-number.mp4"), "x");
      expect(previewStatus(undefined)).toMatchObject({ have: ["big-number"], stale: true });
      writeFileSync(path.join(dir, "stamp.json"), JSON.stringify(stampFor(undefined)));
      expect(previewStatus(undefined).stale).toBe(false);
      const p = { id: "p_1", name: "Mine", updatedAt: "2026-10-20T10:00:00.000Z" } as never;
      mkdirSync(previewDirFor(p), { recursive: true });
      writeFileSync(path.join(previewDirFor(p), "ripple.mp4"), "x");
      writeFileSync(path.join(previewDirFor(p), "stamp.json"), JSON.stringify({ ...stampFor(p), updatedAt: "older" }));
      expect(previewStatus(p)).toMatchObject({ key: "p_1", have: ["ripple"], stale: true, personality: "Mine" });
    } finally { delete process.env.REELCUT_HOME; rmSync(home, { recursive: true, force: true }); }
  });
});

describe("sketches: the owner's line in a technique", () => {
  it("draws the line in place of the sample, with its own number and at most four slams", async () => {
    const { techniquePreviewComposition } = await import("../src/taxonomy/preview.js");
    const { styleById } = await import("../src/personality/styles.js");
    const st = styleById("flat-vector")!;
    const make = (id: string, text: string) => techniquePreviewComposition(id, st, { id: "tq-x", palette: st.palettes[0]!, pairing: st.fonts.best[0]!, text });
    const big = make("big-number", "Über 71.000 Follower in sechs Monaten");
    expect(big).toContain('to: 71000, decimals: 0, locale: "de-DE"');
    expect(big).toContain("Über Follower in sechs Monaten");
    expect(make("big-number", "3.2x faster")).toContain('to: 3.2, decimals: 1, locale: "en-US"');
    expect(make("big-number", "3,2-mal schneller")).toContain('to: 3.2, decimals: 1, locale: "de-DE"');
    const slam = make("kinetic-slam", "one two three four five six seven eight");
    expect(slam.match(/class="sl"/g)).toHaveLength(4);
    const hl = make("colour-isolation", "A much longer line that the headline has to fit into two lines at most");
    expect(hl).toMatch(/class="rc-hl hl" style="font-size:52px"/);
    expect(make("strike-replace", "Stunden → Minuten")).toContain('<span class="nw">Minuten</span>');
    for (const id of ["highlighter", "rolling-values", "type-as-image", "genre-quotation", "word-by-word"]) {
      const html = make(id, "Für Creator, Coder, Teams");
      expect(() => new Function(html.match(/<script>([\s\S]*?)<\/script>/)![1]!), id).not.toThrow();
    }
  });
  it("keys a sketch by the line, the techniques and the personality version", async () => {
    const { sketchKey } = await import("../src/taxonomy/previews.js");
    const a = sketchKey("Ship it today", ["big-number", "ripple"], undefined);
    expect(a).toMatch(/^[0-9a-f]{10}$/);
    expect(sketchKey(" Ship   it today ", ["ripple", "big-number"], undefined)).toBe(a);
    expect(sketchKey("Ship it today", ["big-number"], undefined)).not.toBe(a);
    expect(sketchKey("Ship it today", ["big-number", "ripple"], { id: "p_1", updatedAt: "x" } as never)).not.toBe(a);
  });
});
