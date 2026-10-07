import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import http from "node:http";
import path from "node:path";
import { reelcutHome } from "../library/store.js";
import { addComment, loadComments, readReel } from "./edits.js";

/**
 * Share for review: a private link to one reel, for a client or a teammate.
 *
 * The link reaches a separate, tiny server on its own port (bound to this Mac only) that knows nothing but review
 * pages: the master, its poster, the beat timeline and the comments. A Cloudflare quick tunnel (`cloudflared`) makes
 * that port reachable from outside while the studio runs; the studio itself, its API and the library are never
 * exposed. Each link is a long random token, expires, and can be revoked. Reviewers' comments land in the
 * conversation's frame comments, so the owner sends them to Claude like their own.
 */

export interface Share {
  token: string;
  conversation: string;
  title: string;
  reel: string;
  createdAt: string;
  expiresAt: string;
  revoked?: boolean;
}

export const REVIEW_PORT = 5297;
const file = () => path.join(reelcutHome(), "create", "shares.json");
export function loadShares(): Share[] { try { return JSON.parse(readFileSync(file(), "utf8")) as Share[]; } catch { return []; } }
function saveShares(list: Share[]): void { mkdirSync(path.dirname(file()), { recursive: true }); writeFileSync(file(), JSON.stringify(list, null, 1)); }

export const liveShare = (s: Share, now = Date.now()) => !s.revoked && Date.parse(s.expiresAt) > now && existsSync(s.reel);
export function findShare(token: string, now = Date.now()): Share | undefined {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return undefined;
  const s = loadShares().find((x) => x.token === token);
  return s && liveShare(s, now) ? s : undefined;
}
export function createShare(conversation: string, title: string, reel: string, days = 7): Share {
  const s: Share = { token: randomBytes(24).toString("base64url"), conversation, title, reel, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + days * 86_400_000).toISOString() };
  saveShares([s, ...loadShares().filter((x) => liveShare(x))]);
  return s;
}
export function revokeShare(token: string): void { saveShares(loadShares().map((x) => (x.token === token ? { ...x, revoked: true } : x))); }
export function sharesFor(conversation: string): Share[] { return loadShares().filter((x) => x.conversation === conversation && liveShare(x)); }

// ---- the tunnel

let tunnel: { proc: ChildProcess; url?: string; waiting: Promise<string> } | undefined;
export function cloudflaredPath(): string | undefined {
  const r = spawnSync("sh", ["-c", "command -v cloudflared"], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : undefined;
}
export const tunnelUrl = (): string | undefined => tunnel?.url;

/** Starts a quick tunnel to the review port (once), and resolves with its public https address. */
export function ensureTunnel(port = REVIEW_PORT, onExit?: () => void): Promise<string> {
  if (tunnel && tunnel.proc.exitCode === null) return tunnel.waiting;
  const bin = cloudflaredPath();
  if (!bin) return Promise.reject(new Error("cloudflared is not installed: run `brew install cloudflared`, then share again"));
  const proc = spawn(bin, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
  const t: NonNullable<typeof tunnel> = { proc, waiting: Promise.resolve("") };
  t.waiting = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the tunnel did not start within 45 s")), 45_000);
    // cloudflared prints the address before its connection to Cloudflare is up. Hand it out only once a connection is
    // registered: a lookup made before the name exists is remembered as "no such host" by the Mac for a minute or more.
    let found: string | undefined, registered = false;
    const look = (d: Buffer) => {
      const text = d.toString();
      found ??= /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(text)?.[0];
      registered ||= /Registered tunnel connection/i.test(text);
      if (found && registered && !t.url) { t.url = found; clearTimeout(timer); setTimeout(() => resolve(found!), 1500); }
    };
    proc.stdout?.on("data", look); proc.stderr?.on("data", look);
    proc.on("exit", () => { clearTimeout(timer); if (!t.url) reject(new Error("cloudflared stopped before the tunnel was up")); if (tunnel === t) tunnel = undefined; onExit?.(); });
  });
  tunnel = t;
  return t.waiting;
}
export function stopTunnel(): void { tunnel?.proc.kill(); tunnel = undefined; }
process.on("exit", () => tunnel?.proc.kill());

// ---- the review daemon
//
// The review server and its tunnel run in their own background process, not inside the studio: restarting the studio
// (or closing its terminal) must not take a link down that a client is about to open. The daemon keeps cloudflared up
// (starting it again if it stops, which gives a new address), and quits by itself once no link is live.

export interface DaemonState { pid: number; port: number; startedAt: string; key: string; url?: string; urlSince?: string }
const daemonFile = () => path.join(reelcutHome(), "create", "review-daemon.json");
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
export function daemonState(): DaemonState | undefined {
  try { const d = JSON.parse(readFileSync(daemonFile(), "utf8")) as DaemonState; return alive(d.pid) ? d : undefined; } catch { return undefined; }
}
export function writeDaemonState(d: DaemonState | undefined): void {
  if (!d) { rmSync(daemonFile(), { force: true }); return; }
  mkdirSync(path.dirname(daemonFile()), { recursive: true }); writeFileSync(daemonFile(), JSON.stringify(d));
}
/** The public address of the review pages right now, if the daemon has a tunnel up. */
export const reviewUrl = (): string | undefined => daemonState()?.url;

/** Starts the daemon when it is not running, and waits until its tunnel has an address. */
export async function ensureReviewDaemon(timeoutMs = 60_000): Promise<string> {
  if (!cloudflaredPath()) throw new Error("cloudflared is not installed: run `brew install cloudflared`, then share again");
  if (!daemonState()) {
    const tsx = createRequire(import.meta.url).resolve("tsx/cli");
    const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "skills", "reelcut", "scripts", "review-daemon.ts");
    mkdirSync(path.dirname(daemonFile()), { recursive: true });
    const log = openSync(path.join(path.dirname(daemonFile()), "review-daemon.log"), "a");
    spawn(process.execPath, [tsx, script], { detached: true, stdio: ["ignore", log, log], env: { ...process.env, REELCUT_HOME: reelcutHome() } }).unref();
  }
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const d = daemonState();
    if (d?.url) return d.url;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("the review tunnel did not come up within a minute; check your connection and try again");
}
export function stopReviewDaemon(): void { const d = daemonState(); if (d) try { process.kill(d.pid, "SIGTERM"); } catch { /* already gone */ } }

// ---- the review server

const PAGE_SECURITY = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" };
const sent = new Map<string, number[]>();
/** At most 30 comments an hour on one link. */
function allowComment(token: string, now = Date.now()): boolean {
  const recent = (sent.get(token) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= 30) return false;
  recent.push(now); sent.set(token, recent); return true;
}

export interface ReviewHooks { onComment?: (share: Share, text: string, author: string, t: number) => void }

export function startReviewServer(port = REVIEW_PORT, hooks: ReviewHooks = {}): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const fail = (code: number, text: string) => { res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8", ...PAGE_SECURITY }); res.end(text); };
    try {
      const url = new URL(req.url ?? "/", "http://review");
      const m = /^\/r\/([A-Za-z0-9_-]{32})(?:\/(master\.mp4|poster\.jpg|comments|data))?$/.exec(url.pathname);
      const share = m ? findShare(m[1]!) : undefined;
      if (!m || !share) return fail(404, "This review link has expired or was turned off.");
      const dir = path.dirname(share.reel);
      const what = m[2];
      if (!what && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...PAGE_SECURITY, "Content-Security-Policy": "default-src 'none'; media-src 'self'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'" });
        return res.end(reviewPage(share));
      }
      if ((what === "master.mp4" || what === "poster.jpg") && req.method === "GET") return sendMedia(req, res, path.join(dir, what));
      if (what === "data" && req.method === "GET") {
        const reel = readReel(share.reel);
        let start = 0;
        const beats = reel.beats.map((b, i) => { const x = { n: i + 1, start, seconds: b.durationSeconds ?? 0 }; start += x.seconds; return x; });
        const comments = loadComments(share.conversation).filter((c) => c.author !== "you").map((c) => ({ t: c.t, x: c.x, y: c.y, text: c.text, author: c.author, beat: c.beatIndex + 1, status: c.status }));
        res.writeHead(200, { "Content-Type": "application/json", ...PAGE_SECURITY });
        return res.end(JSON.stringify({ title: share.title, seconds: start, beats, comments, hasPoster: existsSync(path.join(dir, "poster.jpg")) }));
      }
      if (what === "comments" && req.method === "POST") {
        let body = "";
        req.on("data", (d) => { body += d; if (body.length > 4096) req.destroy(); });
        req.on("end", () => {
          try {
            const b = JSON.parse(body) as { t?: number; x?: number; y?: number; text?: string; name?: string };
            const text = String(b.text ?? "").trim().slice(0, 1000), author = String(b.name ?? "").trim().replace(/[<>]/g, "").slice(0, 40) || "Reviewer";
            if (typeof b.t !== "number" || !Number.isFinite(b.t) || !text) return fail(400, "A comment needs a moment and some words.");
            if (author.toLowerCase() === "you") return fail(400, "Choose a name.");
            if (!allowComment(share.token)) return fail(429, "That is a lot of comments; try again in a while.");
            addComment(share.conversation, share.reel, { t: b.t, x: typeof b.x === "number" ? b.x : undefined, y: typeof b.y === "number" ? b.y : undefined, text, author });
            hooks.onComment?.(share, text, author, b.t);
            res.writeHead(201, { "Content-Type": "application/json", ...PAGE_SECURITY }); res.end("{\"ok\":true}");
          } catch { fail(400, "That did not arrive whole."); }
        });
        return;
      }
      return fail(405, "Not here.");
    } catch { return fail(500, "Something went wrong."); }
  });
  return new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", () => resolve(server)); });
}

function sendMedia(req: http.IncomingMessage, res: http.ServerResponse, file: string): void {
  if (!existsSync(file)) { res.writeHead(404, PAGE_SECURITY); res.end(); return; }
  const size = statSync(file).size;
  const type = file.endsWith(".mp4") ? "video/mp4" : "image/jpeg";
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
    if (start > end || start >= size) { res.writeHead(416, { "Content-Range": `bytes */${size}` }); res.end(); return; }
    res.writeHead(206, { "Content-Type": type, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes", ...PAGE_SECURITY });
    createReadStream(file, { start, end }).pipe(res); return;
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes", ...PAGE_SECURITY });
  createReadStream(file).pipe(res);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The review page: the reel, its beats as a timeline, comments pinned to frames. Dark, Apple-like, self-contained. */
export function reviewPage(share: Share): string {
  const base = `/r/${share.token}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex"><title>${esc(share.title)} · review</title>
<style>
:root { color-scheme: dark; --bg: #000; --cell: #1c1c1e; --elev: #2c2c2e; --label: #fff; --label-2: rgb(235 235 245 / .6); --label-3: rgb(235 235 245 / .3); --fill: rgb(118 118 128 / .24); --fill-2: rgb(118 118 128 / .18); --accent: #ff9230; --sep: rgb(84 84 88 / .6); --ease: cubic-bezier(.2,0,0,1); }
* { box-sizing: border-box; } body { margin: 0; background: var(--bg); color: var(--label); font: 15px/20px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
main { max-width: 1040px; margin: 0 auto; padding: 24px 16px 64px; display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 24px; align-items: start; }
@media (max-width: 860px) { main { grid-template-columns: 1fr; } }
header { grid-column: 1 / -1; } h1 { margin: 0; font-size: 28px; line-height: 34px; letter-spacing: -.01em; } .sub { color: var(--label-2); font-size: 13px; margin-top: 4px; }
.stage { position: relative; background: #111; border-radius: 16px; overflow: hidden; } video { display: block; width: 100%; max-height: 75vh; background: #000; }
.catch { position: absolute; inset: 0; cursor: crosshair; display: none; } .aim .catch { display: block; } .aim { box-shadow: 0 0 0 2px var(--accent); }
.pin { position: absolute; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 3px #fff, 0 2px 8px rgb(0 0 0 / .5); pointer-events: none; }
.tl { position: relative; display: flex; gap: 2px; height: 22px; margin-top: 10px; border-radius: 6px; overflow: hidden; cursor: pointer; } .tl i { background: var(--fill); } .tl i:nth-child(even) { background: var(--fill-2); }
.tl .ph { position: absolute; top: 0; bottom: 0; width: 2px; background: #fff; } .tl .mk { position: absolute; top: 50%; width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 50%; background: var(--accent); }
button { font: inherit; border: 0; border-radius: 999px; height: 36px; padding: 0 16px; background: var(--fill); color: var(--label); cursor: pointer; transition: transform 150ms var(--ease); } button:active { transform: scale(.97); }
button.primary { background: var(--accent); color: #000; font-weight: 600; } button:disabled { opacity: .4; }
.bar { display: flex; gap: 8px; align-items: center; margin-top: 12px; flex-wrap: wrap; } .bar .hint { color: var(--label-2); font-size: 13px; }
aside { background: var(--cell); border-radius: 16px; padding: 16px; } aside h2 { margin: 0 0 12px; font-size: 17px; }
input, textarea { font: inherit; font-size: 16px; width: 100%; color: var(--label); background: var(--elev); border: 1px solid transparent; border-radius: 10px; padding: 10px 12px; } textarea { resize: vertical; min-height: 72px; }
input:focus, textarea:focus { outline: none; border-color: var(--accent); } .f { display: grid; gap: 8px; margin-bottom: 16px; } .when { font-size: 13px; color: var(--label-2); }
.c { padding: 10px 0; border-top: 1px solid var(--sep); } .c b { font-weight: 600; } .c .m { font-size: 12px; color: var(--label-2); } .c .tc { color: var(--accent); cursor: pointer; background: none; height: auto; padding: 0; }
.empty { color: var(--label-2); font-size: 13px; } .toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); background: var(--elev); padding: 10px 16px; border-radius: 999px; font-size: 14px; opacity: 0; transition: opacity .2s; } .toast.on { opacity: 1; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style></head><body>
<main><header><h1>${esc(share.title)}</h1><div class="sub">A reel for review. Pause anywhere and leave a comment on the frame.</div></header>
<section><div class="stage" id="stage"><video id="v" src="${base}/master.mp4" controls playsinline preload="metadata"></video><div class="catch" id="catch"></div><div id="pins"></div></div>
<div class="tl" id="tl"></div>
<div class="bar"><button id="aim">Comment on a spot</button><span class="hint" id="hint">or just write below: it is pinned to the moment you are on.</span></div></section>
<aside><h2>Comments</h2>
<div class="f"><input id="name" placeholder="Your name" maxlength="40" autocomplete="name"><textarea id="text" placeholder="What should change at this moment?" maxlength="1000"></textarea>
<div class="when" id="when">At 0:00.0</div><button class="primary" id="send" disabled>Add comment</button></div>
<div id="list"></div></aside></main><div class="toast" id="toast"></div>
<script>
(function () {
  var base = ${JSON.stringify(base)}, v = document.getElementById("v"), data = null, spot = null;
  var $ = function (id) { return document.getElementById(id); };
  var clock = function (t) { return Math.floor(t / 60) + ":" + (t % 60).toFixed(1).padStart(4, "0"); };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  try { $("name").value = localStorage.getItem("rc-review-name") || ""; } catch (e) {}
  function toast(t) { var el = $("toast"); el.textContent = t; el.classList.add("on"); setTimeout(function () { el.classList.remove("on"); }, 2600); }
  function load() { fetch(base + "/data").then(function (r) { return r.json(); }).then(function (d) { data = d; paint(); }); }
  function paint() {
    var tl = $("tl"), total = data.seconds || 1;
    tl.innerHTML = data.beats.map(function (b) { return '<i style="flex:' + (b.seconds || 1) + '" title="Beat ' + b.n + '"></i>'; }).join("") + '<span class="ph" id="ph"></span>' + data.comments.map(function (c) { return '<span class="mk" style="left:' + (c.t / total * 100) + '%"></span>'; }).join("");
    $("list").innerHTML = data.comments.length ? data.comments.slice().sort(function (a, b) { return a.t - b.t; }).map(function (c) { return '<div class="c"><button class="tc" data-t="' + c.t + '">' + clock(c.t) + '</button> · <b>' + esc(c.author) + '</b><div>' + esc(c.text) + '</div><div class="m">Beat ' + c.beat + (c.status === "resolved" ? " · resolved" : "") + '</div></div>'; }).join("") : '<p class="empty">No comments yet.</p>';
    Array.prototype.forEach.call(document.querySelectorAll("[data-t]"), function (b) { b.onclick = function () { v.pause(); v.currentTime = +b.dataset.t; }; });
    sync();
  }
  function sync() { if (!data) return; var ph = $("ph"); if (ph) ph.style.left = Math.min(100, v.currentTime / (data.seconds || 1) * 100) + "%"; $("when").textContent = "At " + clock(v.currentTime) + (spot ? " · the spot you picked" : ""); }
  v.addEventListener("timeupdate", sync); v.addEventListener("seeked", sync);
  $("tl").onclick = function (e) { var r = this.getBoundingClientRect(); v.currentTime = (e.clientX - r.left) / r.width * (data ? data.seconds : 0); };
  $("aim").onclick = function () { v.pause(); $("stage").classList.add("aim"); $("hint").textContent = "Click the spot on the frame."; };
  $("catch").onclick = function (e) { var r = this.getBoundingClientRect(); spot = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; $("stage").classList.remove("aim"); $("pins").innerHTML = '<span class="pin" style="left:' + spot.x * 100 + '%;top:' + spot.y * 100 + '%"></span>'; $("hint").textContent = "Spot picked."; sync(); $("text").focus(); };
  var check = function () { $("send").disabled = !$("text").value.trim() || !$("name").value.trim(); };
  $("text").oninput = check; $("name").oninput = check;
  $("send").onclick = function () {
    var body = { t: v.currentTime, text: $("text").value, name: $("name").value };
    if (spot) { body.x = spot.x; body.y = spot.y; }
    try { localStorage.setItem("rc-review-name", body.name); } catch (e) {}
    $("send").disabled = true;
    fetch(base + "/comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(function (r) { return r.ok ? null : r.text(); }).then(function (err) {
      if (err) { toast(err); check(); return; }
      $("text").value = ""; spot = null; $("pins").innerHTML = ""; toast("Sent. Thank you."); load(); check();
    }).catch(function () { toast("Could not send; try again."); check(); });
  };
  load();
})();
</script></body></html>`;
}
