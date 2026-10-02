import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadLearnings } from "../src/learnings/index.js";
import { hasFfmpeg, IngestManager, loadIndex } from "../src/library/index.js";
import { loadReferences } from "../src/references/index.js";
import { createStudioServer } from "../src/studio/server.js";

let home: string;
let server: http.Server;
let port: number;

interface Reply { status: number; text: string; json: <T = Record<string, unknown>>() => T }
function request(pathname: string, init: { method?: string; headers?: Record<string, string | number>; body?: Buffer | string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const body = typeof init.body === "string" ? Buffer.from(init.body) : init.body;
    const req = http.request({ host: "127.0.0.1", port, path: pathname, method: init.method ?? "GET", headers: { host: `127.0.0.1:${port}`, ...(body ? { "content-length": body.length } : {}), ...init.headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode ?? 0, text, json: <T,>() => JSON.parse(text) as T });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
const send = (p: string, method: string, payload?: unknown, headers: Record<string, string> = {}): Promise<Reply> =>
  request(p, { method, headers: { "content-type": "application/json", ...headers }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });

beforeEach(async () => {
  home = mkdtempSync(path.join(os.tmpdir(), "reelcut-sr-"));
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

function clip(name: string, colors: string[]): Buffer {
  const out = path.join(home, name);
  const inputs = colors.flatMap((c) => ["-f", "lavfi", "-i", `color=c=${c}:s=320x180:r=30:d=1.5`]);
  execFileSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", `${colors.map((_, i) => `[${i}:v]`).join("")}concat=n=${colors.length}:v=1:a=0[v]`, "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", out]);
  return readFileSync(out);
}
const upload = (body: Buffer, name = "film.mp4"): Promise<Reply> => request("/api/references/upload", { method: "POST", headers: { "x-reelcut-name": encodeURIComponent(name) }, body });

describe.runIf(hasFfmpeg())("the References tab's routes", { timeout: 60_000 }, () => {
  it("takes a film, measures it, and keeps it out of the library", async () => {
    const r = await upload(clip("a.mp4", ["red", "blue"]), "Launch Film_v2.mp4");
    expect(r.status).toBe(201);
    const body = r.json<{ outcome: { state: string }; reference: { id: string; name: string; analysis: { shots: number }; thumbUrl: string; sheetUrl: string; videoUrl: string } }>();
    expect(body.outcome.state).toBe("added");
    expect(body.reference).toMatchObject({ name: "Launch Film v2", analysis: { shots: 2 } });

    const list = (await request("/api/references")).json<{ references: unknown[]; counts: { all: number; queue: number }; brief: { included: number } }>();
    expect(list.counts).toMatchObject({ all: 1, queue: 1 });
    expect(list.brief.included).toBe(1);
    expect(loadIndex().assets).toEqual([]);

    expect((await request(body.reference.thumbUrl)).status).toBe(200);
    expect((await request(body.reference.sheetUrl)).status).toBe(200);
    const video = await request(body.reference.videoUrl, { headers: { range: "bytes=0-99" } });
    expect(video.status).toBe(206);
  });

  it("says a repeat is a repeat, and refuses what is not a film", async () => {
    const film = clip("a.mp4", ["red", "blue"]);
    expect((await upload(film)).status).toBe(201);
    expect((await upload(film, "again.mp4")).status).toBe(200);
    expect((await upload(Buffer.from("just some words, not a film at all"))).status).toBe(422);
    expect((await request("/api/references/upload", { method: "POST", body: undefined })).status).toBe(411);
    expect(loadReferences().references).toHaveLength(1);
  });

  it("lets a person switch a reference off, tag it in the fixed words, accept tags, and delete it", async () => {
    const id = (await upload(clip("a.mp4", ["red", "blue"]))).json<{ reference: { id: string } }>().reference.id;

    expect((await send(`/api/references/${id}`, "PATCH", { include: false })).status).toBe(200);
    expect(loadReferences().references[0]!.include).toBe(false);
    await send(`/api/references/${id}`, "PATCH", { include: true });

    const bad = await send(`/api/references/${id}`, "PATCH", { moves: ["ui", "swoosh"] });
    expect(bad.status).toBe(400);
    expect(bad.json<{ error: string }>().error).toMatch(/not a move: swoosh/);

    const tagged = await send(`/api/references/${id}`, "PATCH", { moves: ["ui", "kin"], textStyle: "kinetic", note: "great hook" });
    expect(tagged.json<{ reference: { annotation: { by: string; reviewed: boolean; moves: string[] } } }>().reference.annotation).toMatchObject({ by: "user", reviewed: true, moves: ["ui", "kin"] });
    expect(loadLearnings().signals.filter((s) => s.type === "reference" && s.subject?.type === "move").map((s) => s.subject!.value).sort()).toEqual(["kin", "ui"]);

    expect((await send(`/api/references/${id}`, "PATCH", { name: 5 })).status).toBe(400);
    expect((await send(`/api/references/${"0".repeat(16)}`, "PATCH", { include: false })).status).toBe(404);

    expect((await send(`/api/references/${id}`, "DELETE")).status).toBe(200);
    expect(loadReferences().references).toEqual([]);
    expect(loadLearnings().signals.filter((s) => s.type === "reference")).toEqual([]);
    expect((await send(`/api/references/${id}`, "DELETE")).status).toBe(404);
  });

  it("only serves a file by a reference's own id, never by a path", async () => {
    expect((await request("/files/reference/..%2F..%2Fsettings.json")).status).toBe(404);
    expect((await request("/files/reference-sheet/nope")).status).toBe(404);
  });

  it("refuses a write from another origin, like every other route", async () => {
    const r = await send("/api/references/" + "0".repeat(16), "PATCH", { include: false }, { origin: "https://evil.example" });
    expect(r.status).toBe(403);
  });
});
