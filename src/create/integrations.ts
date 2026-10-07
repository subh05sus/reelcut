import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The tools a reel is orchestrated with, and whether each is reachable right now: the MCP servers Claude Code has
 * (Higgsfield today; Adobe Premiere Pro and DaVinci Resolve next). Read from `claude mcp list`, which health-checks
 * every configured server, so the status is the real one, not a guess from the config.
 */

export type IntegrationState = "connected" | "needs-auth" | "pending" | "failed" | "not-added" | "planned" | "offline" | "off";
export interface Integration {
  id: string;
  name: string;
  /** What reelcut uses it for. */
  role: string;
  /** Recognises the server's name in `claude mcp list`. */
  match: RegExp;
  /** Not built into reelcut yet: shown so the bar is ready for it. */
  planned?: boolean;
  /** How to add it, when it is not there. */
  howTo: string;
}

export const INTEGRATIONS: readonly Integration[] = [
  { id: "higgsfield", name: "Higgsfield", role: "AI video for backgrounds and abstract ideas", match: /higgsfield/i,
    howTo: "Add the Higgsfield MCP to Claude Code (`claude mcp add …` with the server address from Higgsfield), then run `/mcp` in a Claude Code session to sign in." },
  { id: "premiere", name: "Premiere Pro", role: "the reel's timeline, captions and finishing in Adobe Premiere Pro", match: /premiere|adobe/i, planned: true,
    howTo: "Coming: reelcut will hand the reel's beats, sound and captions to Premiere Pro through its MCP." },
  { id: "resolve", name: "DaVinci Resolve", role: "grading, sound and finishing in DaVinci Resolve", match: /resolve|davinci/i, planned: true,
    howTo: "Coming: reelcut will build the reel as a Resolve timeline through its MCP." },
];

// ---- Claude in Chrome
//
// Not an MCP server in `claude mcp list`: Claude Code reaches the browser extension through a native messaging host.
// While Chrome is open with the extension connected, that host (`claude --chrome-native-host`) runs and listens on a
// socket in /tmp/claude-mcp-browser-bridge-<user>/<pid>.sock. Read from those, never by talking to the browser.

const NATIVE_HOST = "com.anthropic.claude_code_browser_extension.json";
const BROWSER_DIRS = ["Google/Chrome", "Google/Chrome Beta", "Google/Chrome Canary", "Chromium", "BraveSoftware/Brave-Browser", "Microsoft Edge", "Arc/User Data"];
export interface ChromeStatus { installed: boolean; enabled: boolean; live: boolean; paired?: string }
export function chromeStatus(home = os.homedir(), tmp = "/tmp", user = os.userInfo().username): ChromeStatus {
  const support = path.join(home, "Library", "Application Support");
  const installed = BROWSER_DIRS.some((d) => existsSync(path.join(support, d, "NativeMessagingHosts", NATIVE_HOST)))
    || existsSync(path.join(home, ".config", "google-chrome", "NativeMessagingHosts", NATIVE_HOST));
  let enabled = true, paired: string | undefined;
  try {
    const cfg = JSON.parse(readFileSync(path.join(home, ".claude.json"), "utf8")) as { claudeInChromeDefaultEnabled?: boolean; chromeExtension?: { pairedDeviceName?: string } };
    enabled = cfg.claudeInChromeDefaultEnabled !== false; paired = cfg.chromeExtension?.pairedDeviceName;
  } catch { /* no config yet */ }
  let live = false;
  try {
    const dir = path.join(tmp, `claude-mcp-browser-bridge-${user}`);
    live = readdirSync(dir).some((f) => { const pid = Number(/^(\d+)\.sock$/.exec(f)?.[1]); if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } });
  } catch { /* no bridge */ }
  return { installed, enabled, live, ...(paired ? { paired } : {}) };
}
function chromeIntegration(c: ChromeStatus): IntegrationStatus {
  const base = { id: "chrome", name: "Claude in Chrome", role: "real screenshots and recordings of a product's UI, from your own browser" };
  if (!c.installed) return { ...base, state: "not-added", detail: "not set up", howTo: "Install the Claude in Chrome extension from the Chrome Web Store, sign in, then run `/chrome` in a Claude Code session to connect it." };
  if (!c.enabled) return { ...base, state: "off", detail: "turned off", howTo: "It is turned off in Claude Code: run `/chrome` in a Claude Code session and turn it on." };
  if (!c.live) return { ...base, state: "offline", detail: "Chrome not connected", howTo: "Open Chrome (the extension connects by itself). Reels then capture real UI from it, asking you first for each page.", server: "claude-in-chrome" };
  return { ...base, state: "connected", detail: c.paired ? `connected (${c.paired})` : "connected", howTo: "", server: "claude-in-chrome" };
}

export interface McpServerStatus { name: string; target: string; state: IntegrationState; detail: string }
export interface IntegrationStatus { id: string; name: string; role: string; state: IntegrationState; detail: string; howTo: string; server?: string }

/** One line of `claude mcp list`: `name: target - ✔ Connected` (or ! Needs authentication, ⏸ Pending approval, ✗ Failed…). */
export function parseMcpList(out: string): McpServerStatus[] {
  const rows: McpServerStatus[] = [];
  for (const line of out.split("\n")) {
    const m = /^(.+?):\s+(.+)\s+-\s+(\S+)\s+(.+?)\s*$/.exec(line.trim());
    if (!m) continue;
    const status = m[4]!;
    const state: IntegrationState = /connected/i.test(status) && !/not/i.test(status) ? "connected"
      : /auth/i.test(status) ? "needs-auth" : /pending|approv/i.test(status) ? "pending" : "failed";
    rows.push({ name: m[1]!.trim(), target: m[2]!.trim(), state, detail: status });
  }
  return rows;
}

export function integrationStatus(servers: readonly McpServerStatus[], chrome: ChromeStatus = chromeStatus()): IntegrationStatus[] {
  return [chromeIntegration(chrome), ...INTEGRATIONS.map((i) => {
    const s = servers.find((x) => i.match.test(x.name) || i.match.test(x.target));
    if (s) return { id: i.id, name: i.name, role: i.role, state: s.state, detail: s.detail, howTo: s.state === "connected" ? "" : s.state === "needs-auth" ? "Run `/mcp` in a Claude Code session and sign in." : s.state === "pending" ? "Start `claude` in this project once and approve it." : i.howTo, server: s.name };
    return { id: i.id, name: i.name, role: i.role, state: i.planned ? "planned" : "not-added", detail: i.planned ? "coming" : "not added", howTo: i.howTo } as IntegrationStatus;
  })];
}

/** `claude mcp list` in the project (so project servers count), at most once a minute. */
let cache: { at: number; servers: McpServerStatus[]; claude: string } | undefined;
export async function readIntegrations(repo: string, maxAgeMs = 60_000, force = false): Promise<{ checkedAt: string; claude: string; servers: McpServerStatus[]; integrations: IntegrationStatus[] }> {
  if (!cache || force || Date.now() - cache.at > maxAgeMs) {
    const run = (args: string[]) => new Promise<string>((resolve) => {
      const env = { ...process.env }; delete env.ANTHROPIC_API_KEY;
      const p = spawn("claude", args, { cwd: path.resolve(repo), env });
      let out = "";
      p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { out += d; });
      const t = setTimeout(() => p.kill(), 45_000);
      p.on("close", () => { clearTimeout(t); resolve(out); });
      p.on("error", () => { clearTimeout(t); resolve(""); });
    });
    const [list, version] = await Promise.all([run(["mcp", "list"]), run(["--version"])]);
    cache = { at: Date.now(), servers: parseMcpList(list), claude: version.trim().split("\n")[0] ?? "" };
  }
  // Chrome's state is read fresh every time (it is a few file checks); the MCP list is cached.
  return { checkedAt: new Date(cache.at).toISOString(), claude: cache.claude, servers: cache.servers, integrations: integrationStatus(cache.servers) };
}
