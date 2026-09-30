import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addAsset, recordRun } from "../src/library/index.js";
import { containedPath, createStudioServer, findRunningStudio } from "../src/studio/server.js";

let home: string;
let work: string;
let server: http.Server;
let port: number;
let runId: string;

/** Raw request, so paths like `..` reach the server exactly as written. */
function request(pathname: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: pathname, method: init.method ?? "GET", headers: { host: `127.0.0.1:${port}`, ...init.headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

beforeEach(async () => {
  home = mkdtempSync(path.join(os.tmpdir(), "reelcut-home-"));
  work = mkdtempSync(path.join(os.tmpdir(), "reelcut-work-"));
  process.env.REELCUT_HOME = home;

  const out = path.join(work, "out");
  mkdirSync(path.join(out, "clips"), { recursive: true });
  writeFileSync(path.join(out, "reel.json"), "{}");
  writeFileSync(path.join(out, "clips", "beat-00.mp4"), "0123456789");
  writeFileSync(path.join(work, "secret.txt"), "do not serve");
  runId = recordRun({ outDir: out, manifest: path.join(out, "reel.json"), beats: ["beat-00"], clips: ["clips/beat-00.mp4"], libraryAssets: [] }).id;

  server = createStudioServer({
    spawnRender: () => spawn(process.execPath, ["-e", "setTimeout(() => console.log('rendered'), 300)"]),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  delete process.env.REELCUT_HOME;
  rmSync(home, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

describe("containedPath", () => {
  it("rejects anything that resolves outside the root", () => {
    expect(containedPath("/a/b", "clips/x.mp4")).toBe(path.resolve("/a/b/clips/x.mp4"));
    expect(containedPath("/a/b", "../c")).toBeUndefined();
    expect(containedPath("/a/b", "")).toBeUndefined();
  });
});

describe("the studio server", () => {
  it("serves the page", async () => {
    const res = await request("/");
    expect(res.status).toBe(200);
    expect(res.body).toContain("reelcut");
  });

  it("is found by a second start for the same library, and not for another", async () => {
    expect(await findRunningStudio(port)).toBe(`http://localhost:${port}`);

    // A studio serving some other library is not this one.
    const other = http.createServer((_req, res) => res.end(JSON.stringify({ studio: "reelcut", library: "/elsewhere" })));
    await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
    try {
      expect(await findRunningStudio((other.address() as AddressInfo).port)).toBeUndefined();
    } finally {
      other.closeAllConnections();
      await new Promise((resolve) => other.close(resolve));
    }
  });

  it("refuses a request addressed to another host", async () => {
    const res = await request("/api/runs", { headers: { host: "evil.example:80" } });
    expect(res.status).toBe(403);
  });

  it("refuses a traversal out of a run folder, plain or encoded", async () => {
    expect((await request(`/files/run/${runId}/../secret.txt`)).status).not.toBe(200);
    expect((await request(`/files/run/${runId}/..%2Fsecret.txt`)).status).toBe(403);
    expect((await request(`/files/run/${runId}/clips%2F..%2F..%2Fsecret.txt`)).status).toBe(403);
  });

  it("answers a byte range with 206 and exactly those bytes", async () => {
    const res = await request(`/files/run/${runId}/clips/beat-00.mp4`, { headers: { range: "bytes=2-5" } });
    expect(res.status).toBe(206);
    expect(res.headers["content-range"]).toBe("bytes 2-5/10");
    expect(res.body).toBe("2345");
    expect((await request(`/files/run/${runId}/clips/beat-00.mp4`, { headers: { range: "bytes=50-" } })).status).toBe(416);
  });

  it("filters assets by tag and saves a tag edit", async () => {
    const f = path.join(work, "gpt.svg");
    writeFileSync(f, "<svg/>");
    const { asset } = addAsset(f, { name: "ChatGPT Logo", assetKind: "identity", tags: ["chatgpt"], provenance: { source: "user" } });

    const tagged = JSON.parse((await request("/api/assets?tags=chatgpt")).body) as { assets: unknown[] };
    expect(tagged.assets).toHaveLength(1);
    expect(JSON.parse((await request("/api/assets?tags=claude")).body).assets).toHaveLength(0);

    const origin = `http://127.0.0.1:${port}`;
    const saved = await request(`/api/assets/${asset.id}`, { method: "PATCH", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ addTags: ["openai"] }) });
    expect(saved.status).toBe(200);
    expect(JSON.parse(saved.body).asset.tags).toEqual(["chatgpt", "openai"]);

    const served = await request(`/files/asset/${asset.id}`);
    expect(served.headers["content-type"]).toBe("image/svg+xml");
    expect(served.headers["content-security-policy"]).toBe("sandbox");
  });

  it("refuses a write from another origin", async () => {
    const res = await request(`/api/runs/${runId}/render`, { method: "POST", headers: { origin: "https://evil.example" }, body: JSON.stringify({ beat: "beat-00" }) });
    expect(res.status).toBe(403);
  });

  it("runs one re-render at a time", async () => {
    const start = () => request(`/api/runs/${runId}/render`, { method: "POST", body: JSON.stringify({ beat: "beat-00" }) });
    const first = await start();
    expect(first.status).toBe(202);
    expect((await start()).status).toBe(409);
    expect((await request(`/api/runs/${runId}/render`, { method: "POST", body: JSON.stringify({ beat: "nope" }) })).status).toBe(400);

    const id = JSON.parse(first.body).job.id as string;
    let job: { status: string; log: string[] } = { status: "running", log: [] };
    for (let i = 0; i < 100 && job.status === "running"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      job = JSON.parse((await request(`/api/jobs/${id}`)).body).job;
    }
    expect(job.status).toBe("ok");
    expect(job.log).toContain("rendered");
  });
});
