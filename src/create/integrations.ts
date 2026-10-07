import { spawn } from "node:child_process";
import path from "node:path";

/**
 * The tools a reel is orchestrated with, and whether each is reachable right now: the MCP servers Claude Code has
 * (Higgsfield today; Adobe Premiere Pro and DaVinci Resolve next). Read from `claude mcp list`, which health-checks
 * every configured server, so the status is the real one, not a guess from the config.
 */

export type IntegrationState = "connected" | "needs-auth" | "pending" | "failed" | "not-added" | "planned";
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

export function integrationStatus(servers: readonly McpServerStatus[]): IntegrationStatus[] {
  return INTEGRATIONS.map((i) => {
    const s = servers.find((x) => i.match.test(x.name) || i.match.test(x.target));
    if (s) return { id: i.id, name: i.name, role: i.role, state: s.state, detail: s.detail, howTo: s.state === "connected" ? "" : s.state === "needs-auth" ? "Run `/mcp` in a Claude Code session and sign in." : s.state === "pending" ? "Start `claude` in this project once and approve it." : i.howTo, server: s.name };
    return { id: i.id, name: i.name, role: i.role, state: i.planned ? "planned" : "not-added", detail: i.planned ? "coming" : "not added", howTo: i.howTo };
  });
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
  return { checkedAt: new Date(cache.at).toISOString(), claude: cache.claude, servers: cache.servers, integrations: integrationStatus(cache.servers) };
}
