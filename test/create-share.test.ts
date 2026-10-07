import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let home: string, reelPath: string;
beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), "rc-share-")); process.env.REELCUT_HOME = home;
  const dir = path.join(home, "out-x"); reelPath = path.join(dir, "reel.json");
  mkdirSync(dir, { recursive: true });
  writeFileSync(reelPath, JSON.stringify({ beats: [{ id: "beat-00", durationSeconds: 2 }, { id: "beat-01", durationSeconds: 3 }] }));
  writeFileSync(path.join(dir, "master.mp4"), Buffer.alloc(1000, 7));
});
afterEach(() => { delete process.env.REELCUT_HOME; rmSync(home, { recursive: true, force: true }); });

describe("share for review", () => {
  it("serves only live links' review pages, media and comments", async () => {
    const { createShare, revokeShare, startReviewServer } = await import("../src/create/share.js");
    const { loadComments } = await import("../src/create/edits.js");
    const heard: string[] = [];
    const server = await startReviewServer(0, { onComment: (_s, text, author) => heard.push(`${author}: ${text}`) });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const sh = createShare("c_1", "My reel", reelPath, 7);
      expect(sh.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect((await fetch(`${base}/r/${"x".repeat(32)}`)).status).toBe(404);
      expect((await fetch(`${base}/api/create`)).status).toBe(404);
      const page = await fetch(`${base}/r/${sh.token}`);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
      expect(await page.text()).toContain("<h1>My reel</h1>");
      const part = await fetch(`${base}/r/${sh.token}/master.mp4`, { headers: { Range: "bytes=0-99" } });
      expect(part.status).toBe(206);
      expect((await part.arrayBuffer()).byteLength).toBe(100);
      const post = (body: object) => fetch(`${base}/r/${sh.token}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      expect((await post({ t: 2.5, text: "Logo bigger", name: "Sam <b>" })).status).toBe(201);
      expect((await post({ t: 1, text: "x", name: "you" })).status).toBe(400);
      expect((await post({ text: "no time", name: "Sam" })).status).toBe(400);
      expect(loadComments("c_1")).toMatchObject([{ author: "Sam b", text: "Logo bigger", beat: "beat-01" }]);
      expect(heard).toEqual(["Sam b: Logo bigger"]);
      const data = await (await fetch(`${base}/r/${sh.token}/data`)).json() as { seconds: number; comments: { author: string }[] };
      expect(data.seconds).toBe(5);
      expect(data.comments[0]!.author).toBe("Sam b");
      revokeShare(sh.token);
      expect((await fetch(`${base}/r/${sh.token}`)).status).toBe(404);
    } finally { server.close(); }
  });
  it("expires links", async () => {
    const { createShare, findShare } = await import("../src/create/share.js");
    const sh = createShare("c_1", "r", reelPath, 1);
    expect(findShare(sh.token)).toBeDefined();
    expect(findShare(sh.token, Date.now() + 2 * 86_400_000)).toBeUndefined();
  });
});

describe("review daemon state", () => {
  it("is only believed while its process is alive", async () => {
    const { daemonState, writeDaemonState, reviewUrl } = await import("../src/create/share.js");
    writeDaemonState({ pid: process.pid, port: 1, startedAt: "", key: "k", url: "https://a.trycloudflare.com" });
    expect(reviewUrl()).toBe("https://a.trycloudflare.com");
    writeDaemonState({ pid: 999_999, port: 1, startedAt: "", key: "k", url: "https://b.trycloudflare.com" });
    expect(daemonState()).toBeUndefined();
    expect(reviewUrl()).toBeUndefined();
    writeDaemonState(undefined);
  });
});
