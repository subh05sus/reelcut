import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addAsset, addMoment, footageOf, IngestManager, loadIndex } from "../src/library/index.js";
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
  home = mkdtempSync(path.join(os.tmpdir(), "reelcut-sf-"));
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

function video(): string {
  const file = path.join(home, "rec.mp4");
  writeFileSync(file, "pretend this is a recording");
  return addAsset(file, { name: "install claude", assetKind: "identity", provenance: { source: "user" }, mediaType: "video", analysis: { dominantColors: [], descriptors: [], width: 1920, height: 1200, durationSeconds: 12 } }).asset.id;
}

describe("the Footage tab's routes", () => {
  it("lists recordings with the count the badge shows", async () => {
    video();
    const r = await request("/api/assets?type=video");
    expect(r.json<{ assets: unknown[]; counts: { footage: number } }>()).toMatchObject({ assets: [{ mediaType: "video" }], counts: { footage: 1 } });
  });

  it("saves what a person says about a recording, and the check for private information", async () => {
    const id = video();
    const r = await request(`/api/assets/${id}/footage`, "PATCH", { app: "Claude", platform: "mac", recordedAt: "2026-09-30", muted: false, privateChecked: true });
    expect(r.status).toBe(200);
    expect(footageOf(loadIndex().assets[0]!)).toMatchObject({ app: "Claude", platform: "mac", muted: false, privateChecked: { by: "user" } });
    expect((await request(`/api/assets/${id}/footage`, "PATCH", { platform: "amiga" })).status).toBe(400);
    expect((await request(`/api/assets/${id}/footage`, "PATCH", { privateChecked: "yes" })).status).toBe(400);
    expect((await request(`/api/assets/${id}/footage`, "PATCH", { recordedAt: "last tuesday-ish" })).status).toBe(400);
  });

  it("adds, edits, confirms and deletes moments", async () => {
    const id = video();
    const made = await request(`/api/assets/${id}/moments`, "POST", { label: "download Claude", in: 2, out: 8.5, tags: ["mac"], focus: { "1:1": { x: 0.1, y: 0.2, w: 0.5, h: 0.5 } } });
    expect(made.status).toBe(201);
    const moment = made.json<{ moment: { id: string; state: string; origin: string } }>().moment;
    expect(moment).toMatchObject({ state: "confirmed", origin: "user" });

    const edited = await request(`/api/assets/${id}/moments/${moment.id}`, "PATCH", { out: 9 });
    expect(edited.json<{ moment: { out: number } }>().moment.out).toBe(9);
    expect((await request(`/api/assets/${id}/moments/${moment.id}`, "PATCH", { out: 99 })).status).toBe(400);

    expect((await request(`/api/assets/${id}/moments/${moment.id}`, "DELETE")).status).toBe(200);
    expect(footageOf(loadIndex().assets[0]!).moments).toEqual([]);
  });

  it("confirms a proposal from Claude when a person says so", async () => {
    const id = video();
    const { moment } = addMoment(id, { label: "open the app", in: 8, out: 11 }, "claude");
    expect(footageOf(loadIndex().assets[0]!).moments[0]!.state).toBe("proposed");
    await request(`/api/assets/${id}/moments/${moment.id}`, "PATCH", { confirm: true });
    expect(footageOf(loadIndex().assets[0]!).moments[0]).toMatchObject({ state: "confirmed", origin: "claude" });
  });

  it("does not let a request make a moment look like a person's, or set its own yes", async () => {
    const id = video();
    const made = await request(`/api/assets/${id}/moments`, "POST", { label: "download Claude", in: 2, out: 6, origin: "claude", state: "proposed", acceptedAt: "2026-01-01T00:00:00Z" });
    const moment = made.json<{ moment: { state: string; origin: string; acceptedAt?: string } }>().moment;
    expect(moment).toMatchObject({ state: "confirmed", origin: "user" });
    expect(moment.acceptedAt).toBeUndefined();
  });

  it("rejects malformed moments", async () => {
    const id = video();
    expect((await request(`/api/assets/${id}/moments`, "POST", { label: "x" })).status).toBe(400);
    expect((await request(`/api/assets/${id}/moments`, "POST", { label: "x", in: "2", out: 4 })).status).toBe(400);
    expect((await request(`/api/assets/${id}/moments`, "POST", { label: "x y", in: 2, out: 4, tags: "mac" })).status).toBe(400);
    expect((await request(`/api/assets/${id}/moments`, "POST", { label: "x y", in: 2, out: 4, focus: [] })).status).toBe(400);
    expect((await request(`/api/assets/nope/moments`, "POST", { label: "x y", in: 2, out: 4 })).status).toBe(400);
  });

  it("finds a moment from a phrase, with the reason it was or was not offered", async () => {
    const id = video();
    addMoment(id, { label: "download Claude", in: 2, out: 8 });
    const r = await request("/api/footage/find?q=download%20Claude");
    const [match] = r.json<{ matches: { ref: string; decision: string; why: string }[] }>().matches;
    expect(match).toMatchObject({ decision: "proposal" });
    expect(match!.why).toMatch(/private information|not reviewed|date is unknown/);
  });

  it("refuses a write from another origin, like every other route", async () => {
    const id = video();
    const r = await request(`/api/assets/${id}/footage`, "PATCH", { app: "x" }, { origin: "https://evil.example" });
    expect(r.status).toBe(403);
  });
});
