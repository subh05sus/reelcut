import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reelcutHome } from "../../../src/library/store.js";
import { DEFAULT_PORT, findRunningStudio } from "../../../src/studio/server.js";
import { openBrowser } from "../../../src/studio/open.js";
import { COMMAND_LINES, commandSkill } from "../../../src/create/commands.js";

/**
 * reelcut's commands: `/reelcut <command>` and `/reelcut:<command>` both run this.
 *
 *   npm run reelcut -- <command> [arguments]
 *
 * It talks to the studio (starting it when a command needs it) and never asks anything itself. When a decision is the
 * owner's, it prints one line and exits with a code the skill turns into a question card:
 *   exit 3  DECIDE {json}  a reel is being made: wait, stop now, or cancel
 *   exit 4  CHOOSE {json}  the name matches several reels, or none: pick one
 *   exit 5  CONFIRM {json} something to delete or change: pick what
 */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const cwd = process.env.INIT_CWD ?? process.cwd();
const PORT = Number(process.env.REELCUT_PORT) || DEFAULT_PORT;
const argv = process.argv.slice(2);
const command = (argv.shift() ?? "help").replace(/^\//, "").toLowerCase();
const take = (name: string): string | undefined => { const i = argv.indexOf(name); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const flag = (...names: string[]): boolean => { let on = false; for (const n of names) { const i = argv.indexOf(n); if (i >= 0) { argv.splice(i, 1); on = true; } } return on; };
const out = (s = "") => console.log(s);
const decide = (code: number, kind: string, data: unknown): never => { console.log(`${kind} ${JSON.stringify(data)}`); process.exit(code); };

// The checkout this runs from, and a launcher for it: the /reelcut:<command> skills run ~/.reelcut/bin/reelcut, so they
// reach this checkout (with its dependencies) from any folder, and can be allowed as one command.
try {
  mkdirSync(path.join(reelcutHome(), "bin"), { recursive: true });
  writeFileSync(path.join(reelcutHome(), "repo"), REPO);
  const launcher = path.join(reelcutHome(), "bin", "reelcut");
  const body = `#!/bin/sh\n# reelcut's commands, from the checkout at ${REPO}\nexec npm --prefix "${REPO}" run -s reelcut -- "$@"\n`;
  if (!existsSync(launcher) || readFileSync(launcher, "utf8") !== body) writeFileSync(launcher, body, { mode: 0o755 });
} catch { /* read-only home */ }

// ---------------------------------------------------------------- the studio

let base = "";
async function studio(start = true): Promise<string> {
  if (base) return base;
  const running = await findRunningStudio(PORT);
  if (running) return (base = running);
  if (!start) return "";
  const tsx = createRequire(import.meta.url).resolve("tsx/cli");
  const log = openSync(path.join(reelcutHome(), "studio.log"), "a");
  spawn(process.execPath, [tsx, path.join(HERE, "library.ts"), "serve", "--port", String(PORT)], { cwd: REPO, detached: true, stdio: ["ignore", log, log], env: process.env }).unref();
  for (let i = 0; i < 60; i++) { await sleep(500); const u = await findRunningStudio(PORT); if (u) return (base = u); }
  throw new Error(`the studio did not start; see ${path.join(reelcutHome(), "studio.log")}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api<T = any>(p: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const b = await studio();
  const res = await fetch(`${b}${p}`, init?.json !== undefined ? { ...init, method: init.method ?? "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.json) } : init);
  const body = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}

interface Meta { id: string; title: string; status: string; updatedAt: string; createdAt: string; reel?: string; batch?: string; queued?: { startAt?: string }; episode?: { n: number } }
const busy = (s: Meta) => s.status === "running" || s.status === "waiting";
const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const WORD: Record<string, string> = { done: "done", running: "making", waiting: "waiting for you", failed: "error", stopped: "stopped", idle: "draft", queued: "queued" };

async function sessions(): Promise<Meta[]> { return (await api<{ sessions: Meta[] }>("/api/create")).sessions; }

/** A reel by number (from `list`), by part of its title, by chat id, or the latest when no name is given. */
async function pick(name: string | undefined, needReel = true): Promise<Meta> {
  const all = (await sessions()).filter((s) => !needReel || s.reel);
  if (!all.length) throw new Error(needReel ? "no reel yet: make one first (`/reelcut` opens the studio)" : "no conversations yet");
  if (!name) return all[0]!;
  if (/^\d+$/.test(name) && Number(name) >= 1 && Number(name) <= all.length) return all[Number(name) - 1]!;
  const exact = all.find((s) => s.id === name);
  if (exact) return exact;
  const q = name.toLowerCase();
  const hits = all.filter((s) => s.title.toLowerCase().includes(q));
  if (hits.length === 1) return hits[0]!;
  return decide(4, "CHOOSE", { asked: name, reels: (hits.length ? hits : all).slice(0, 4).map((s) => ({ id: s.id, title: s.title, status: WORD[s.status] ?? s.status, updated: ago(s.updatedAt) })) });
}
const reelArg = () => take("--reel") ?? undefined;

// ---------------------------------------------------------------- commands

const commands: Record<string, { line: string; run: () => Promise<void> }> = {
  help: { line: COMMAND_LINES.help!, run: async () => help() },

  start: { line: COMMAND_LINES.start!, run: async () => {
    const was = await findRunningStudio(PORT);
    const b = await studio();
    out(was ? `The studio is already running: ${b}` : `Started the studio: ${b}`);
    if (!flag("--no-open")) openBrowser(`${b}/#create`);
  } },

  stop: { line: COMMAND_LINES.stop!, run: async () => stopOrRestart("stop") },
  restart: { line: COMMAND_LINES.restart!, run: async () => stopOrRestart("restart") },

  status: { line: COMMAND_LINES.status!, run: async () => {
    const b = await studio(false);
    if (!b) { out("The studio is not running. `/reelcut start` starts it."); return; }
    const all = await sessions();
    out(`Studio: running at ${b}`);
    const live = all.filter(busy);
    out(live.length ? "\nBeing made:" : "\nNothing is being made right now.");
    for (const s of live) {
      const pg = (await api<{ progress?: { line: string; pct: number } }>(`/api/create/${s.id}/reel`)).progress;
      out(`  ${s.title} — ${s.status === "waiting" ? "waiting for your answer" : pg?.line ?? "working"}${pg ? ` (${pg.pct}%)` : ""}  ${b}/#create/${s.id}`);
    }
    const q = all.filter((s) => s.status === "queued");
    if (q.length) { out("\nBatch:"); for (const s of q) out(`  ${s.title} — ${s.queued?.startAt && Date.parse(s.queued.startAt) > Date.now() ? `starts ${new Date(s.queued.startAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}` : "next in line"}`); }
    // A studio from before an update may not know the newer questions: skip what it cannot answer.
    const sh = await api<{ shares: { title: string; url: string | null; expiresAt: string }[] }>("/api/shares").catch(() => ({ shares: [] }));
    if (sh.shares.length) { out("\nReview links:"); for (const x of sh.shares) out(`  ${x.title} — ${x.url ?? "tunnel reconnecting"} (until ${new Date(x.expiresAt).toLocaleDateString([], { day: "numeric", month: "short" })})`); }
    const ints = await api<{ claude: string; integrations: { name: string; state: string; detail: string }[] }>("/api/integrations").catch(() => ({ claude: "", integrations: [] }));
    out(`\nTools: Claude Code ${ints.claude || "not found"}${ints.integrations.map((i) => ` · ${i.name}: ${i.detail}`).join("")}`);
  } },

  open: { line: COMMAND_LINES.open!, run: async () => {
    const what = argv.join(" ").trim();
    const pages = ["create", "library", "footage", "reels", "personality", "performance", "learnings", "review", "folders", "references", "sounds", "patterns", "jobs"];
    const b = await studio();
    let hash = "#create";
    if (what && pages.includes(what.toLowerCase())) hash = `#${what.toLowerCase()}`;
    else if (what) hash = `#create/${(await pick(what, false)).id}`;
    openBrowser(`${b}/${hash}`); out(`Opened ${b}/${hash}`);
  } },

  list: { line: COMMAND_LINES.list!, run: async () => {
    const all = await sessions();
    if (!all.length) { out("No reels yet. `/reelcut` opens the studio to make one."); return; }
    all.slice(0, Number(take("-n") ?? 15)).forEach((s, i) => out(`${String(i + 1).padStart(2)}. ${s.title} — ${WORD[s.status] ?? s.status}, ${ago(s.updatedAt)}${s.reel ? "" : " (no reel yet)"}  [${s.id}]`));
  } },

  continue: { line: COMMAND_LINES.continue!, run: async () => {
    const name = argv.length > 1 ? argv.shift() : argv.length === 1 && !/\s/.test(argv[0]!) ? argv.shift() : undefined;
    const s = await pick(name, false);
    const msg = argv.join(" ").trim() || "continue";
    if (!busy(s) || msg !== "continue") await api(`/api/create/${s.id}/message`, { json: { text: msg } });
    const b = await studio(); openBrowser(`${b}/#create/${s.id}`);
    out(`${busy(s) && msg === "continue" ? "Already being made" : `Sent "${msg}"`}: ${s.title} — ${b}/#create/${s.id}`);
  } },

  new: { line: COMMAND_LINES.new!, run: async () => {
    const r = spawnSync(process.execPath, [createRequire(import.meta.url).resolve("tsx/cli"), path.join(HERE, "dashboard.ts"), ...argv], { stdio: "inherit", cwd, env: { ...process.env, INIT_CWD: cwd } });
    process.exitCode = r.status ?? 1;
  } },

  batch: { line: COMMAND_LINES.batch!, run: async () => {
    const dir = argv.find((a) => !a.startsWith("--") && existsSync(path.resolve(cwd, a)) && statSync(path.resolve(cwd, a)).isDirectory());
    if (!dir) throw new Error("give a folder of .txt or .srt scripts");
    argv.splice(argv.indexOf(dir), 1);
    const tonight = flag("--tonight");
    const scripts = readdirSync(path.resolve(cwd, dir)).filter((f) => /\.(txt|srt|md)$/i.test(f)).sort();
    if (!scripts.length) throw new Error(`no .txt or .srt scripts in ${dir}`);
    const settings = settingsFrom();
    const { personalities } = await api<{ personalities: { id: string; isDefault: boolean }[] }>("/api/create");
    const def = personalities.find((p) => p.isDefault); if (def) settings.personality = def.id;
    const batch = `b_${Date.now().toString(36)}`;
    const startAt = tonight ? (() => { const t = new Date(); t.setHours(25, 0, 0, 0); return t.toISOString(); })() : undefined;
    const words = argv.join(" ").trim();
    for (const f of scripts) {
      const { session } = await api<{ session: { id: string } }>("/api/create", { json: { title: f.replace(/\.[a-z0-9]+$/i, ""), settings } });
      const file = await upload(session.id, path.resolve(cwd, dir, f), "script");
      await api(`/api/create/${session.id}/queue`, { json: { text: words, files: [file], batch, startAt } });
    }
    out(`Queued ${scripts.length} reel${scripts.length > 1 ? "s" : ""}${tonight ? " for tonight at 1 AM" : ", starting now"}, one at a time and unattended: ${scripts.join(", ")}`);
    out(`Follow them with /reelcut status, or in the studio: ${await studio()}/#create`);
  } },

  share: { line: COMMAND_LINES.share!, run: async () => {
    const days = Number(take("--days") ?? 7);
    const s = await pick(argv.join(" ").trim() || reelArg());
    out(`Starting the review link for "${s.title}"…`);
    const r = await api<{ share: { url?: string; expiresAt: string } }>(`/api/create/${s.id}/shares`, { json: { days } });
    if (!r.share.url) throw new Error("the tunnel did not come up; try again in a moment");
    if (process.platform === "darwin") spawnSync("pbcopy", { input: r.share.url });
    out(`${r.share.url}\n(copied; works until ${new Date(r.share.expiresAt).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} while this Mac is awake. Anyone with it can watch and comment.)`);
  } },

  shares: { line: COMMAND_LINES.shares!, run: async () => {
    const r = await api<{ shares: { title: string; url: string | null; expiresAt: string; token: string }[] }>("/api/shares");
    if (!r.shares.length) { out("No live review links."); return; }
    r.shares.forEach((x, i) => out(`${i + 1}. ${x.title} — ${x.url ?? "tunnel reconnecting"} (until ${new Date(x.expiresAt).toLocaleDateString()})`));
  } },

  unshare: { line: COMMAND_LINES.unshare!, run: async () => {
    const all = flag("--all");
    const r = await api<{ shares: { title: string; conversation: string; token: string }[] }>("/api/shares");
    let list = r.shares;
    if (!all) { const name = argv.join(" ").trim(); if (name || list.length > 1) { const s = await pick(name || undefined); list = list.filter((x) => x.conversation === s.id); } }
    if (!list.length) { out("No live link to turn off."); return; }
    for (const x of list) await api(`/api/create/${x.conversation}/shares/${x.token}`, { method: "DELETE" });
    out(`Turned off ${list.length} link${list.length > 1 ? "s" : ""}: ${[...new Set(list.map((x) => x.title))].join(", ")}`);
  } },

  edit: { line: COMMAND_LINES.edit!, run: async () => {
    const reel = reelArg();
    const beatWord = argv.shift();
    if (!beatWord) throw new Error("say which beat: edit 3 calmer");
    const words = argv.join(" ").trim();
    if (!words) throw new Error("say what to change: edit 3 calmer");
    const s = await pick(reel);
    const beat = await beatId(s.id, beatWord);
    const [w0, ...rest] = words.split(/\s+/);
    const restText = rest.join(" ").replace(/^["“]|["”]$/g, "");
    const action = /^(calmer|punchier)$/i.test(w0!) && !rest.length ? { kind: w0!.toLowerCase() }
      : /^(redo|again|retake)$/i.test(w0!) && !rest.length ? { kind: "redo" }
      : /^(remove|delete|drop)$/i.test(w0!) && !rest.length ? { kind: "remove" }
      : /^style$/i.test(w0!) && rest.length ? { kind: "style", style: rest.join("-").toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^(paper|ink|retro|ui|kinetic)$/, (m) => ({ paper: "paper-cutout", ink: "ink-paint", retro: "retro-vhs", ui: "ui-product", kinetic: "kinetic-type" })[m]!) }
      : /^text:?$/i.test(w0!) && rest.length ? { kind: "text", text: restText.replace(/\\n/g, "\n") }
      : /^move$/i.test(w0!) && /^\d+$/.test(rest.at(-1) ?? "") ? { kind: "move", to: Number(rest.at(-1)) - 1 }
      : { kind: "note", text: words };
    const r = await api<{ shown: string }>(`/api/create/${s.id}/edit`, { json: { beat, action } });
    out(`Sent to "${s.title}": ${r.shown}. Follow it in the studio: ${await studio()}/#create/${s.id}`);
  } },

  rerender: { line: COMMAND_LINES.rerender!, run: async () => {
    const reel = reelArg();
    const list = argv.join(",").split(/[,\s]+/).filter(Boolean);
    if (!list.length) throw new Error("say which beats: rerender 3,5");
    const s = await pick(reel);
    for (const w of list) { const beat = await beatId(s.id, w); await api(`/api/create/${s.id}/edit`, { json: { beat, action: { kind: "rerender" } } }); }
    out(`Asked "${s.title}" to render beat${list.length > 1 ? "s" : ""} ${list.join(", ")} again and rejoin the master. ${await studio()}/#create/${s.id}`);
  } },

  doctor: { line: COMMAND_LINES.doctor!, run: async () => doctor() },
  update: { line: COMMAND_LINES.update!, run: async () => update() },
  clean: { line: COMMAND_LINES.clean!, run: async () => clean() },
  logs: { line: COMMAND_LINES.logs!, run: async () => logs() },
};

// ---------------------------------------------------------------- helpers

function settingsFrom(): Record<string, string> {
  const s: Record<string, string> = {};
  const format = take("--format"); if (format) s.format = ({ vertical: "9:16", square: "1:1", landscape: "16:9", portrait: "4:5" } as Record<string, string>)[format] ?? format;
  if (flag("--short")) s.length = "short";
  if (flag("--4k")) s.resolution = "4k"; else if (flag("--hd")) s.resolution = "hd";
  const text = take("--text"); if (text) s.text = text;
  if (flag("--blur")) s.blur = "on"; else if (flag("--no-blur")) s.blur = "off";
  if (flag("--sfx")) s.sfx = "on";
  return s;
}
async function upload(id: string, file: string, kind: string): Promise<{ name: string; path: string; kind: string }> {
  const b = await studio();
  const res = await fetch(`${b}/api/create/${id}/files`, { method: "POST", body: readFileSync(file), headers: { "x-reelcut-name": encodeURIComponent(path.basename(file)), "x-reelcut-kind": kind } });
  const j = await res.json() as { file: { name: string; path: string; kind: string }; error?: string };
  if (!res.ok) throw new Error(j.error ?? res.statusText);
  return j.file;
}
/** "3", "03" or "beat-03" → the beat's id in that reel. */
async function beatId(conversation: string, word: string): Promise<string> {
  const { reel } = await api<{ reel: { beats: { id: string }[] } | null }>(`/api/create/${conversation}/reel`);
  if (!reel?.beats.length) throw new Error("that reel has no beats yet");
  const byId = reel.beats.find((b) => b.id === word);
  if (byId) return byId.id;
  const n = Number(word.replace(/^beat-?/i, ""));
  if (Number.isInteger(n) && n >= 1 && n <= reel.beats.length) return reel.beats[n - 1]!.id;
  throw new Error(`no beat "${word}": the reel has beats 1 to ${reel.beats.length}`);
}

async function stopOrRestart(what: "stop" | "restart"): Promise<void> {
  const now = flag("--now"), wait = flag("--wait"), detached = flag("--detached");
  const b = await studio(false);
  if (!b) { if (what === "restart") { out(`The studio was not running; started it: ${await studio()}`); } else out("The studio is not running."); return; }
  const live = (await sessions()).filter(busy);
  if (live.length && !now && !wait) {
    const items = await Promise.all(live.map(async (s) => ({ title: s.title, status: s.status, progress: (await api<{ progress?: { line: string; pct: number } }>(`/api/create/${s.id}/reel`)).progress })));
    decide(3, "DECIDE", { action: what, running: items.map((x) => `${x.title}: ${x.status === "waiting" ? "waiting for your answer" : `${x.progress?.line ?? "working"} (${x.progress?.pct ?? 0}%)`}`) });
  }
  if (live.length && wait && !detached) {
    // Wait in the background, so the terminal is free; it acts the moment nothing is being made.
    const tsx = createRequire(import.meta.url).resolve("tsx/cli");
    const log = openSync(path.join(reelcutHome(), "studio.log"), "a");
    spawn(process.execPath, [tsx, fileURLToPath(import.meta.url), what, "--wait", "--detached"], { cwd: REPO, detached: true, stdio: ["ignore", log, log], env: process.env }).unref();
    out(`Will ${what} the studio as soon as ${live.map((s) => `"${s.title}"`).join(" and ")} ${live.length > 1 ? "finish" : "finishes"}.`);
    return;
  }
  if (wait) while ((await sessions()).some(busy)) await sleep(15_000);
  await fetch(`${b}/api/shutdown`, { method: "POST" }).catch(() => undefined);
  for (let i = 0; i < 20 && (await findRunningStudio(PORT)); i++) await sleep(250);
  base = "";
  if (what === "stop") { out(`Stopped the studio${live.length ? ` (${live.map((s) => `"${s.title}"`).join(", ")} stopped; continue later with /reelcut continue)` : ""}. Review links keep working.`); return; }
  const nb = await studio();
  out(`Restarted the studio: ${nb}${live.length && now ? ` (${live.map((s) => `"${s.title}"`).join(", ")} stopped; /reelcut continue picks it up)` : ""}`);
}

function help(): void {
  out("reelcut — /reelcut <command> or /reelcut:<command>\n");
  out("  /reelcut                     open the studio's Create page");
  out("  /reelcut script.txt …        make a reel here, in this conversation (add --studio to hand it to the studio)\n");
  const ex: Record<string, string> = { open: "open performance", continue: "continue slop make the logo bigger", new: "new script.txt --format 9:16", batch: "batch ./scripts --tonight", share: "share slop --days 1", edit: "edit 3 calmer", rerender: "rerender 3,5", logs: "logs review" };
  for (const [k, c] of Object.entries(commands)) out(`  ${k.padEnd(9)} ${c.line}${ex[k] ? `\n            e.g. /reelcut ${ex[k]}` : ""}`);
  out("\nA reel is named by number (from list), by part of its title, or left out for the latest.");
}

async function doctor(): Promise<void> {
  const rows: [string, boolean | "warn", string][] = [];
  const has = (cmd: string, args = ["--version"]) => { const r = spawnSync(cmd, args, { encoding: "utf8" }); return r.status === 0 ? (r.stdout || r.stderr).trim().split("\n")[0]! : ""; };
  const node = process.versions.node; rows.push(["Node", Number(node.split(".")[0]) >= 20, `${node}${Number(node.split(".")[0]) >= 20 ? "" : " — needs 20 or newer"}`]);
  rows.push(["Dependencies", existsSync(path.join(REPO, "node_modules", "tsx")), existsSync(path.join(REPO, "node_modules", "tsx")) ? "installed" : "run `npm install` in the reelcut folder"]);
  const ff = has("ffmpeg", ["-version"]); rows.push(["ffmpeg", !!ff, ff ? ff.replace(/ Copyright.*/, "") : "install it: `brew install ffmpeg`"]);
  rows.push(["ffprobe", !!has("ffprobe", ["-version"]), has("ffprobe", ["-version"]) ? "found" : "comes with ffmpeg"]);
  // Renders run `npx hyperframes`: installed in the project, or in npx's cache after the first render.
  const npx = path.join(os.homedir(), ".npm", "_npx");
  const hf = [path.join(REPO, "node_modules", "hyperframes"), ...(existsSync(npx) ? readdirSync(npx).map((d) => path.join(npx, d, "node_modules", "hyperframes")) : [])]
    .map((d) => { try { return (JSON.parse(readFileSync(path.join(d, "package.json"), "utf8")) as { version: string }).version; } catch { return ""; } }).find(Boolean);
  rows.push(["HyperFrames", hf ? true : "warn", hf ? `${hf}` : "fetched by npx on the first render (needs the network once)"]);
  const chrome = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].find((p) => existsSync(p)) ?? (has("which", ["google-chrome"]) || "");
  rows.push(["Chrome (for measuring and covers)", !!chrome, chrome ? "found" : "install Google Chrome, or set PUPPETEER_EXECUTABLE_PATH"]);
  const claude = has("claude"); rows.push(["Claude Code", !!claude, claude || "install Claude Code: https://claude.com/claude-code"]);
  let login = false; try { login = !!(JSON.parse(readFileSync(path.join(os.homedir(), ".claude.json"), "utf8")) as { oauthAccount?: unknown }).oauthAccount; } catch { /* none */ }
  rows.push(["Claude login (Create runs on it)", login, login ? (process.env.ANTHROPIC_API_KEY ? "signed in (an ANTHROPIC_API_KEY is set; Create ignores it)" : "signed in") : "run `claude` once and sign in"]);
  const cf = has("cloudflared"); rows.push(["cloudflared (review links)", cf ? true : "warn", cf || "optional: `brew install cloudflared` to share reels for review"]);
  const fonts = path.join(REPO, "skills", "reelcut", "assets", "fonts"); rows.push(["Bundled fonts", existsSync(path.join(fonts, "manifest.json")), existsSync(path.join(fonts, "manifest.json")) ? "present" : "run `npm run fonts -- fetch`"]);
  const df = spawnSync("df", ["-k", REPO], { encoding: "utf8" }).stdout.trim().split("\n").at(-1)?.split(/\s+/);
  const freeGb = df ? Number(df[3]) / 1024 / 1024 : NaN;
  rows.push(["Disk space", Number.isNaN(freeGb) ? "warn" : freeGb > 10 ? true : "warn", Number.isNaN(freeGb) ? "unknown" : `${freeGb.toFixed(0)} GB free${freeGb > 10 ? "" : " — renders need room; /reelcut clean"}`]);
  const st = await findRunningStudio(PORT); rows.push(["Studio", st ? true : "warn", st ? `running at ${st}` : "not running: /reelcut start"]);
  const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: REPO, encoding: "utf8" }).stdout.trim();
  rows.push(["reelcut checkout", true, `${REPO}${dirty ? " (has local changes)" : ""}`]);
  for (const [k, ok, v] of rows) out(`${ok === true ? "✓" : ok === "warn" ? "!" : "✗"} ${k.padEnd(34)} ${v}`);
  const bad = rows.filter((r) => r[1] === false).length;
  out(bad ? `\n${bad} thing${bad > 1 ? "s" : ""} to fix.` : "\nEverything reelcut needs is here.");
  if (bad) process.exitCode = 1;
}

async function update(): Promise<void> {
  const git = (...a: string[]) => spawnSync("git", a, { cwd: REPO, encoding: "utf8" });
  if (git("status", "--porcelain").stdout.trim()) throw new Error(`the reelcut folder has local changes (${REPO}); commit or set them aside first, so an update cannot overwrite them`);
  const before = git("rev-parse", "--short", "HEAD").stdout.trim();
  const pull = git("pull", "--ff-only");
  if (pull.status !== 0) throw new Error(`git pull failed: ${(pull.stderr || pull.stdout).trim().split("\n").at(-1)}`);
  const after = git("rev-parse", "--short", "HEAD").stdout.trim();
  if (before === after) { out(`Already up to date (${after}).`); return; }
  out(`Updated ${before} → ${after}:`); out(git("log", "--oneline", `${before}..${after}`).stdout.trim().split("\n").map((l) => `  ${l}`).join("\n"));
  out("Installing dependencies…");
  const inst = spawnSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: REPO, encoding: "utf8" });
  if (inst.status !== 0) throw new Error(`npm install failed: ${inst.stderr.trim().split("\n").at(-1)}`);
  out("Running the tests…");
  const test = spawnSync("npm", ["test", "--silent"], { cwd: REPO, encoding: "utf8" });
  const line = (test.stdout + test.stderr).split("\n").find((l) => /Tests\s/.test(l))?.trim() ?? "";
  out(`  ${line || (test.status === 0 ? "passed" : "failed")}`);
  if (test.status !== 0) { out("The tests fail on this version: not restarting the studio. Tell Claude what /reelcut update printed."); process.exitCode = 1; return; }
  const b = await studio(false);
  if (!b) { out("Done. The studio is not running; /reelcut start starts it."); return; }
  if ((await sessions()).some(busy)) { out("Done. A reel is being made, so the studio keeps the old version until /reelcut restart."); return; }
  await fetch(`${b}/api/shutdown`, { method: "POST" }).catch(() => undefined);
  for (let i = 0; i < 20 && (await findRunningStudio(PORT)); i++) await sleep(250);
  base = ""; out(`Done, and restarted the studio on the new version: ${await studio()}`);
}

function sizeOf(p: string): number {
  const r = spawnSync("du", ["-sk", p], { encoding: "utf8" });
  return r.status === 0 ? Number(r.stdout.split(/\s/)[0]) * 1024 : 0;
}
const mb = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`;

async function clean(): Promise<void> {
  const yes = take("--yes");
  const titles = new Map<string, string>();
  try { for (const s of await sessions()) if (s.reel) titles.set(path.basename(path.dirname(s.reel)), s.title); } catch { /* studio off: names only */ }
  const reels = readdirSync(REPO).filter((d) => /^out(-|$)/.test(d) && statSync(path.join(REPO, d)).isDirectory()).map((d) => {
    const dir = path.join(REPO, d);
    const projects = ["project", "captions-project"].map((p) => path.join(dir, p)).filter((p) => existsSync(p));
    return { name: d, dir, title: titles.get(d), age: Math.round((Date.now() - statSync(dir).mtimeMs) / 86_400_000), size: sizeOf(dir), projectSize: projects.reduce((a, p) => a + sizeOf(p), 0), projects };
  }).sort((a, b) => b.size - a.size);
  if (!yes) {
    if (!reels.length) { out("No reels in the project folder."); return; }
    const total = reels.reduce((a, r) => a + r.size, 0), proj = reels.reduce((a, r) => a + r.projectSize, 0);
    out(`${reels.length} reel folders, ${mb(total)}; render projects inside them (rebuilt on the next render): ${mb(proj)}.`);
    for (const r of reels) out(`  ${r.name}${r.title ? ` "${r.title}"` : ""} — ${mb(r.size)}, ${r.age} d old${r.projectSize ? ` (render project ${mb(r.projectSize)})` : ""}`);
    decide(5, "CONFIRM", {
      action: "clean", hint: "projects:<name> deletes only a reel's render project (the clips and master stay); reel:<name> deletes the whole reel folder",
      options: [...(proj ? [{ id: "projects:all", label: `Render projects of every reel (${mb(proj)})` }] : []), ...reels.filter((r) => r.age >= 7).slice(0, 6).map((r) => ({ id: `reel:${r.name}`, label: `${r.title ?? r.name} (${mb(r.size)}, ${r.age} d old)` }))],
    });
  }
  let freed = 0;
  for (const pickWord of yes!.split(",").map((x) => x.trim()).filter(Boolean)) {
    const [kind, name] = pickWord.split(":");
    const targets = kind === "projects" ? (name === "all" ? reels : reels.filter((r) => r.name === name)) : reels.filter((r) => r.name === name);
    if (!targets.length) { out(`  nothing called ${pickWord}`); continue; }
    for (const r of targets) {
      if (kind === "projects") { for (const p of r.projects) rmSync(p, { recursive: true, force: true }); freed += r.projectSize; out(`  removed the render project of ${r.name}`); }
      else if (kind === "reel") { rmSync(r.dir, { recursive: true, force: true }); freed += r.size; out(`  deleted ${r.name}${r.title ? ` "${r.title}"` : ""}`); }
    }
  }
  out(`Freed ${mb(freed)}.`);
}

function logs(): void {
  const which = (argv.find((a) => !a.startsWith("-")) ?? "studio").toLowerCase();
  const n = Number(take("-n") ?? 40);
  let file: string | undefined;
  if (which === "review") file = path.join(reelcutHome(), "create", "review-daemon.log");
  else if (which === "render") {
    const outs = readdirSync(REPO).filter((d) => /^out(-|$)/.test(d)).map((d) => path.join(REPO, d)).filter((d) => readdirSync(d).some((f) => /^render\d*\.log$/.test(f)));
    const latest = outs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
    const logFile = latest && readdirSync(latest).filter((f) => /^render\d*\.log$/.test(f)).map((f) => path.join(latest, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
    file = logFile;
  } else file = [path.join(reelcutHome(), "studio.log"), "/tmp/reelcut-studio-5198.log"].filter((f) => existsSync(f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  if (!file || !existsSync(file)) { out(`No ${which} log yet.`); return; }
  out(`${file} (last ${n} lines):`);
  out(readFileSync(file, "utf8").trimEnd().split("\n").slice(-n).join("\n"));
}

// ---------------------------------------------------------------- run

if (command === "_skills") {
  const root = path.join(REPO, "skills");
  for (const [name, c] of Object.entries(commands)) {
    mkdirSync(path.join(root, name), { recursive: true });
    writeFileSync(path.join(root, name, "SKILL.md"), commandSkill(name, c.line));
  }
  out(`wrote ${Object.keys(commands).length} command skills in ${root}`);
  process.exit(0);
}

const cmd = commands[command];
if (!cmd) { console.error(`No command "${command}". /reelcut help lists them.`); process.exit(2); }
try { await cmd.run(); }
catch (error) { console.error(`reelcut ${command}: ${(error as Error).message}`); process.exit(1); }
