import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reelcutHome } from "../../../src/library/store.js";
import { DEFAULT_PORT, findRunningStudio } from "../../../src/studio/server.js";
import { openBrowser } from "../../../src/studio/open.js";

/**
 * `/reelcut` with nothing after it: open the studio's Create page, where reels are made by chatting with Claude.
 * The studio is started in the background when it is not running (and keeps running after this exits).
 *
 *   npm run dashboard                                   open Create
 *   npm run dashboard -- script.txt --format 9:16 …     hand the script and its options to a new Create chat, and open it
 *   npm run dashboard -- --no-open                      just make sure the studio runs, and print its address
 *
 * Options a script takes: --format, --short, --4k/--hd, --text, --blur/--no-blur, --voiceover <audio>,
 * --assets <dir>; anything else (--motion, --look, freeform words…) goes to Claude as the owner's direction.
 */
const cwd = process.env.INIT_CWD ?? process.cwd();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const take = (name: string): string | undefined => { const i = argv.indexOf(name); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const flag = (name: string): boolean => { const i = argv.indexOf(name); if (i < 0) return false; argv.splice(i, 1); return true; };

async function ensureStudio(port: number): Promise<string> {
  const running = await findRunningStudio(port);
  if (running) return running;
  const tsx = createRequire(import.meta.url).resolve("tsx/cli");
  mkdirSync(reelcutHome(), { recursive: true });
  const log = openSync(path.join(reelcutHome(), "studio.log"), "a");
  spawn(process.execPath, [tsx, path.join(HERE, "library.ts"), "serve", "--port", String(port)], { cwd: path.resolve(HERE, "..", "..", ".."), detached: true, stdio: ["ignore", log, log], env: process.env }).unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const url = await findRunningStudio(port);
    if (url) return url;
  }
  throw new Error(`the studio did not start; see ${path.join(reelcutHome(), "studio.log")}`);
}

async function api<T>(base: string, p: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${p}`, init);
  const body = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}
async function upload(base: string, id: string, file: string, kind: string): Promise<{ name: string; path: string; kind: string }> {
  const r = await api<{ file: { name: string; path: string; kind: string } }>(base, `/api/create/${id}/files`, {
    method: "POST", body: readFileSync(file), headers: { "x-reelcut-name": encodeURIComponent(path.basename(file)), "x-reelcut-kind": kind },
  });
  return r.file;
}

const port = Number(take("--port") ?? DEFAULT_PORT);
const noOpen = flag("--no-open");
const base = await ensureStudio(port);
const script = argv.find((a) => !a.startsWith("--") && /\.(txt|srt|md)$/i.test(a) && existsSync(path.resolve(cwd, a)));

if (!script) {
  console.log(`reelcut studio: ${base}/#create`);
  if (!noOpen) openBrowser(`${base}/#create`);
  process.exit(0);
}

// A script: a new Create chat with the options the command line gave, started at once.
argv.splice(argv.indexOf(script), 1);
const settings: Record<string, string> = {};
const format = take("--format"); if (format) settings.format = ({ vertical: "9:16", square: "1:1", landscape: "16:9", portrait: "4:5" } as Record<string, string>)[format] ?? format;
if (flag("--short")) settings.length = "short";
if (flag("--4k")) settings.resolution = "4k"; else if (flag("--hd")) settings.resolution = "hd";
const text = take("--text"); if (text) settings.text = text;
if (flag("--blur")) settings.blur = "on"; else if (flag("--no-blur")) settings.blur = "off";
const voiceover = take("--voiceover"), assets = take("--assets");
const list = await api<{ personalities: { id: string; isDefault: boolean }[] }>(base, "/api/create");
const def = list.personalities.find((p) => p.isDefault);
if (def) settings.personality = def.id;
const title = path.basename(script).replace(/\.[a-z0-9]+$/i, "");
const { session } = await api<{ session: { id: string } }>(base, "/api/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, settings }) });
const files = [await upload(base, session.id, path.resolve(cwd, script), "script")];
if (voiceover) files.push(await upload(base, session.id, path.resolve(cwd, voiceover), "voiceover"));
if (assets) {
  const dir = path.resolve(cwd, assets);
  for (const f of readdirSync(dir).filter((x) => !x.startsWith(".")).slice(0, 60)) if (statSync(path.join(dir, f)).isFile()) files.push(await upload(base, session.id, path.join(dir, f), "asset"));
}
// Whatever else was typed is the owner's direction, word for word.
const direction = argv.join(" ").trim();
await api(base, `/api/create/${session.id}/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: direction, files }) });
console.log(`handed to the studio: ${base}/#create/${session.id}`);
if (!noOpen) openBrowser(`${base}/#create/${session.id}`);
