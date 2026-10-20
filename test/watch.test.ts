import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasFfmpeg, IngestManager } from "../src/library/index.js";
import { Img, labelPrec } from "../src/watch/image.js";
import { fmt, norm, parseTime } from "../src/watch/time.js";
import { hallucination } from "../src/watch/video.js";

describe("watch: times and words", () => {
  it("reads every way a time is written", () => {
    expect(parseTime("83.5")).toBe(83.5);
    expect(parseTime("1:23.5")).toBe(83.5);
    expect(parseTime("1:02:03")).toBe(3723);
    expect(parseTime("end", 60)).toBe(60);
    expect(parseTime("-5", 60)).toBe(55);
    expect(fmt(83.46)).toBe("1:23.5");
    expect(fmt(83.456, false, 2)).toBe("1:23.46");
    expect(fmt(3723, true)).toBe("1:02:03.0");
    expect(() => parseTime("soon")).toThrow(/cannot read time/);
  });
  it("labels a 4 fps look to the quarter second", () => {
    expect(labelPrec([0, 0.5, 1])).toBe(1);
    expect(labelPrec([0, 0.25, 0.5])).toBe(2);
  });
  it("searches past case and accents", () => {
    expect(norm("Größe, BITTE!")).toBe("grosse bitte");
    expect(norm("Café")).toBe("cafe");
  });
  it("drops whisper's inventions over music, keeps real speech", () => {
    expect(hallucination("ლლლლლლლლ")).toBe(true);
    expect(hallucination("Untertitel im Auftrag des ZDF, 2021")).toBe(true);
    expect(hallucination("Then we look at pricing.")).toBe(false);
  });
  it("stamps labels and tiles frames without an imaging library", () => {
    const img = new Img(40, 20, undefined, [200, 200, 200]);
    img.label("1:0", 1);
    expect([...img.data.subarray(0, 3)]).toEqual([0, 0, 0]);
    const grid = new Img(100, 30);
    grid.paste(img, 10, 5);
    const o = (5 * 100 + 10) * 3;
    expect([...grid.data.subarray(o, o + 3)]).toEqual([0, 0, 0]);
    const back = Img.fromPpm(grid.toPpm());
    expect([back.w, back.h]).toEqual([100, 30]);
    expect(back.data.equals(grid.data)).toBe(true);
  });
});

describe.skipIf(!hasFfmpeg())("watch: a synthetic video (moving, still, moving)", () => {
  let home: string, video: string;
  let w: typeof import("../src/watch/index.js");
  beforeAll(async () => {
    home = mkdtempSync(path.join(os.tmpdir(), "rc-watch-"));
    process.env.REELCUT_HOME = home;
    process.env.REELCUT_CONVERSATION = "c_watch01";
    video = path.join(home, "three-shots.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=4",
      "-f", "lavfi", "-i", "color=c=0x2050c0:size=640x360:rate=30:duration=4",
      "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=4",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=12",
      "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]", "-map", "3:a",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", video]);
    w = await import("../src/watch/index.js");
  }, 60_000);
  afterAll(() => { delete process.env.REELCUT_HOME; delete process.env.REELCUT_CONVERSATION; rmSync(home, { recursive: true, force: true }); });

  it("maps it: two cuts, the still middle shot, a storyboard", async () => {
    const out = await w.overview([video], { noTranscript: true, depth: "quick" });
    expect(out).toContain("2 cuts");
    expect(out).toMatch(/STILL PARTS[^\n]*0:0[45]/);
    expect(out).toContain("STORYBOARD");
    const v = w.resolveVideo(video);
    const cuts = v.visual().cuts;
    expect(cuts).toHaveLength(2);
    expect(cuts[0]).toBeCloseTo(4, 0);
    expect(cuts[1]).toBeCloseTo(8, 0);
    const grid = /STORYBOARD[^\n]*\n\s+(\S+\.jpg)/.exec(out)![1]!;
    expect(existsSync(grid)).toBe(true);
  }, 60_000);

  it("looks at any fps, logs why, and refuses past the budget", async () => {
    const out = await w.frames(video, { from: "0", to: "2", fps: 4, why: "how it moves" });
    expect(out).toContain("0:00.00 | 0:00.25");
    expect(out).toMatch(/4 fps over 0:00\.0–0:02\.0 · budget \d+\/40/);
    await expect(w.frames(video, { from: "0", to: "10", fps: 4 })).rejects.toMatchObject({ code: 3 });
    await expect(w.frames(video, { from: "0", to: "12", fps: 4 })).rejects.toThrow(/too many/);
    const look = w.resolveVideo(video).readLog().find((l) => l.kind === "frames")!;
    expect(look.why).toBe("how it moves");
    expect(look.fps).toBe(4);
  }, 60_000);

  it("zooms, remembers, finds its notes, reports, clips and forgets", async () => {
    await w.overview([video], { noTranscript: true, noStoryboard: true, question: "what is in it" });
    expect(existsSync((await w.zoom(video, { at: "1", region: "top-right" })).split("\n")[0]!)).toBe(true);
    // A tone has no words: an empty transcript stands in, so the test never fetches a model.
    w.resolveVideo(video).save("transcript.json", { model: "small", segments: [], seconds: 0, via: "test" });
    expect(w.note(video, "the blue still shot is the middle", "6")).toContain("1 notes");
    expect(await w.search(video, ["blue still"], { noOcr: true })).toContain("noted");
    expect(w.motion(video, {})).toContain("cuts (2)");
    expect(w.audio(video, {})).toContain("LOUDNESS");
    const page = w.writeReport([video], { out: path.join(home, "r.html") });
    expect(readFileSync(page, "utf8")).toContain("data:image/jpeg;base64");
    const clip = w.clip(video, { from: "3", to: "5", out: path.join(home, "c.mp4") });
    expect(existsSync(clip)).toBe(true);
    // The studio's Watch panel finds it through the conversation that watched it.
    const seen = w.watchedIn("c_watch01");
    expect(seen.map((x) => x.id)).toContain(w.resolveVideo(video).id);
    expect(seen[0]!.looks.some((l) => l.kind === "zoom")).toBe(true);
    expect(w.watchedIn("c_someone_else")).toHaveLength(0);
    expect(w.forget(video)).toMatch(/^forgot/);
    expect(w.watchedIn("c_watch01")).toHaveLength(0);
  }, 60_000);

  it("lines the timeline up with a reel's beats", async () => {
    const reel = path.join(home, "reel.json");
    writeFileSync(reel, JSON.stringify({ beats: [{ id: "beat-00", kind: "hook", durationSeconds: 4, text: "Moving first" }, { id: "beat-01", durationSeconds: 4, text: "Then still" }, { id: "beat-02", durationSeconds: 4 }] }));
    const out = await w.overview([video], { noTranscript: true, noStoryboard: true, beats: reel });
    expect(out).toContain("3 beats from reel.json");
    expect(out).toMatch(/beat-00 hook/);
    expect(out).toContain("script: “Then still”");
  }, 60_000);
});

describe("watch in the studio", () => {
  let home: string, server: http.Server, port: number;
  beforeAll(async () => {
    home = mkdtempSync(path.join(os.tmpdir(), "rc-watch-studio-"));
    process.env.REELCUT_HOME = home;
    const { createStudioServer } = await import("../src/studio/server.js");
    server = createStudioServer({ ingest: new IngestManager({ watch: false }) });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => { await new Promise((r) => server.close(r)); delete process.env.REELCUT_HOME; rmSync(home, { recursive: true, force: true }); });
  const get = (p: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: p, headers: { host: `127.0.0.1:${port}` } }, (res) => {
      let body = ""; res.on("data", (c) => (body += c)); res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    }).on("error", reject);
  });

  it("asks Claude to watch, not to make a reel, in an Ask-about-a-video chat", async () => {
    const { CreateManager } = await import("../src/create/manager.js");
    const cm = new CreateManager({ queryFn: (() => (async function* () {})()) as never });
    const s = cm.create("x", { mode: "watch", depth: "deep" });
    const p = cm.firstPrompt(s, { text: "When does he click Pay?", files: [{ name: "demo.mov", path: "/tmp/demo.mov", kind: "video" }], settings: s.settings });
    expect(p.startsWith("/reelcut")).toBe(false);
    expect(p).toContain("skills/reelcut/references/watch.md");
    expect(p).toContain("--depth deep");
    expect(p).toContain("When does he click Pay?");
    expect(p).toContain("The video: /tmp/demo.mov");
    expect(p).toContain("Never make a reel unless the owner asks for one");
  });

  it("serves the Watch panel's state, and only videos that were watched", async () => {
    const created = await new Promise<{ session: { id: string } }>((resolve, reject) => {
      const body = JSON.stringify({ title: "w", settings: { mode: "watch" } });
      const req = http.request({ host: "127.0.0.1", port, path: "/api/create", method: "POST", headers: { host: `127.0.0.1:${port}`, "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, (res) => {
        let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => resolve(JSON.parse(t)));
      });
      req.on("error", reject); req.end(body);
    });
    const r = await get(`/api/create/${created.session.id}/watch`);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ videos: [] });
    expect((await get("/files/watch-video/0123456789ab")).status).toBe(404);
    expect((await get("/files/watch-video/..%2f..%2fetc")).status).toBe(404);
  });
});
