import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getHiggsfieldSetting, IngestManager, isIngestPaused, recordRun, setIngestPaused } from "../src/library/index.js";
import { createStudioServer } from "../src/studio/server.js";

let home: string;
let server: http.Server;
let port: number;

interface Reply { status: number; json: <T = Record<string, unknown>>() => T }
function request(pathname: string, method = "GET", payload?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? undefined : Buffer.from(JSON.stringify(payload));
    const req = http.request({ host: "127.0.0.1", port, path: pathname, method, headers: { host: `127.0.0.1:${port}`, ...(body ? { "content-type": "application/json", "content-length": body.length } : {}), ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, json: <T,>() => JSON.parse(Buffer.concat(chunks).toString("utf8")) as T }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

beforeEach(async () => {
  home = mkdtempSync(path.join(os.tmpdir(), "reelcut-sg-"));
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

describe("the Higgsfield setting in the studio", () => {
  it("is ask until it is changed, and the page and the command line are the same switch", async () => {
    expect((await request("/api/settings")).json()).toMatchObject({ higgsfield: "ask", options: ["ask", "always", "never"] });
    const r = await request("/api/settings/higgsfield", "POST", { value: "never" });
    expect(r.status).toBe(200);
    expect(getHiggsfieldSetting()).toBe("never");
    expect((await request("/api/settings")).json()).toMatchObject({ higgsfield: "never" });
  });

  it("refuses anything that is not one of the three", async () => {
    expect((await request("/api/settings/higgsfield", "POST", { value: "sometimes" })).status).toBe(400);
    expect((await request("/api/settings/higgsfield", "POST", {})).status).toBe(400);
    expect(getHiggsfieldSetting()).toBe("ask");
  });

  it("does not undo the master pause", async () => {
    setIngestPaused(true);
    await request("/api/settings/higgsfield", "POST", { value: "always" });
    expect(isIngestPaused()).toBe(true);
  });

  it("refuses a change from another origin", async () => {
    expect((await request("/api/settings/higgsfield", "POST", { value: "never" }, { origin: "https://evil.example" })).status).toBe(403);
  });
});

describe("what happened to each beat, on a reel", () => {
  it("shows the generation log from the manifest, and nothing when there is none", async () => {
    const out = path.join(home, "out");
    mkdirSync(path.join(out, "clips"), { recursive: true });
    const manifest = path.join(out, "reel.json");
    writeFileSync(manifest, JSON.stringify({ beats: [{ id: "b1" }], generation: [{ beat: "b1", outcome: "fallback", reason: "Higgsfield timed out after 90s" }, { beat: "junk", outcome: "exploded" }] }));
    writeFileSync(path.join(out, "clips", "b1.mp4"), "x");
    const run = recordRun({ outDir: out, manifest, beats: ["b1"], clips: ["clips/b1.mp4"], libraryAssets: [] });
    const body = (await request(`/api/runs/${run.id}`)).json<{ generation: { beat: string; outcome: string }[] }>();
    expect(body.generation).toEqual([{ beat: "b1", outcome: "fallback", reason: "Higgsfield timed out after 90s" }]);

    writeFileSync(manifest, JSON.stringify({ beats: [{ id: "b1" }] }));
    expect((await request(`/api/runs/${run.id}`)).json<{ generation: unknown[] }>().generation).toEqual([]);
  });
});
