import { randomBytes } from "node:crypto";
import { daemonState, ensureTunnel, liveShare, loadShares, REVIEW_PORT, startReviewServer, stopTunnel, writeDaemonState, type DaemonState } from "../../../src/create/share.js";

/**
 * The review daemon: the review server and its Cloudflare quick tunnel, in their own process so a studio restart never
 * takes a shared link down. Started by the studio when a reel is shared (or when it starts and links are live); keeps
 * cloudflared running, starting it again if it stops; tells the studio about reviewers' comments; and quits once no
 * link is live. Its state (pid, address) is in ~/.reelcut/create/review-daemon.json.
 */
if (daemonState()) { console.log("a review daemon is already running"); process.exit(0); }
const state: DaemonState = { pid: process.pid, port: REVIEW_PORT, startedAt: new Date().toISOString(), key: randomBytes(16).toString("hex") };
writeDaemonState(state);
const STUDIO_PORT = Number(process.env.REELCUT_STUDIO_PORT) || 5198;
const log = (s: string) => console.log(`${new Date().toISOString()} ${s}`);

// The port can be held for a moment by a review server that is just stopping: try for a few seconds before giving up.
async function listen(tries = 10): Promise<Awaited<ReturnType<typeof startReviewServer>>> {
  for (let i = 1; ; i++) {
    try { return await startReviewServer(REVIEW_PORT, hooks); }
    catch (error) { if (i >= tries || (error as { code?: string }).code !== "EADDRINUSE") throw error; await new Promise((r) => setTimeout(r, 1000)); }
  }
}
const hooks: Parameters<typeof startReviewServer>[1] = {
  // The studio may be restarting; a comment is saved either way, only the chat line would be missed.
  onComment: (sh, text, author, t) => {
    const at = `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
    void fetch(`http://127.0.0.1:${STUDIO_PORT}/api/create/${sh.conversation}/review-note`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-reelcut-key": state.key },
      body: JSON.stringify({ text: `${author} left a review comment at ${at}: “${text.slice(0, 140)}”` }),
    }).catch(() => log("studio not reachable for a comment note"));
  },
};
const server = await listen().catch((error) => { log(`review server could not start: ${(error as Error).message}`); if (daemonState()?.pid === process.pid) writeDaemonState(undefined); process.exit(1); });

let stopping = false, wait = 2000;
async function tunnel(): Promise<void> {
  while (!stopping) {
    try {
      const url = await ensureTunnel(REVIEW_PORT, () => {
        if (stopping) return;
        log("cloudflared stopped; starting it again");
        delete state.url; writeDaemonState(state);
        setTimeout(() => void tunnel(), wait); wait = Math.min(60_000, wait * 2);
      });
      state.url = url; state.urlSince = new Date().toISOString(); writeDaemonState(state);
      log(`tunnel up: ${url}`); wait = 2000;
      return;
    } catch (error) {
      log(`tunnel failed: ${(error as Error).message}`);
      await new Promise((r) => setTimeout(r, wait)); wait = Math.min(60_000, wait * 2);
    }
  }
}
function shutdown(why: string): void {
  if (stopping) return; stopping = true;
  log(`stopping: ${why}`);
  stopTunnel(); server.close();
  if (daemonState()?.pid === process.pid) writeDaemonState(undefined);
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("asked to"));
process.on("SIGINT", () => shutdown("interrupted"));
setInterval(() => { if (!loadShares().some((x) => liveShare(x))) shutdown("no live links"); }, 60_000);
void tunnel();
