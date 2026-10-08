import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COMMAND_LINES, commandSkill } from "../src/create/commands.js";

const REPO = path.resolve(__dirname, "..");
const run = (...args: string[]) => {
  const home = mkdtempSync(path.join(os.tmpdir(), "rc-cmd-"));
  try {
    return spawnSync(process.execPath, [createRequire(import.meta.url).resolve("tsx/cli"), path.join(REPO, "skills/reelcut/scripts/cmd.ts"), ...args], { encoding: "utf8", env: { ...process.env, REELCUT_HOME: home, REELCUT_PORT: "5999" } });
  } finally { rmSync(home, { recursive: true, force: true }); }
};

describe("reelcut commands", () => {
  it("has a /reelcut:<command> skill for every command, exactly as the generator writes it", () => {
    for (const [name, line] of Object.entries(COMMAND_LINES)) {
      expect(readFileSync(path.join(REPO, "skills", name, "SKILL.md"), "utf8"), name).toBe(commandSkill(name, line));
    }
    const dirs = readdirSync(path.join(REPO, "skills")).filter((d) => d !== "reelcut");
    expect(dirs.sort()).toEqual(Object.keys(COMMAND_LINES).sort());
  });
  it("every command skill runs the tool with the owner's arguments and keeps decisions with the owner", () => {
    const s = commandSkill("stop", COMMAND_LINES.stop!);
    expect(s).toContain("~/.reelcut/bin/reelcut stop $ARGUMENTS");
    expect(s).toContain("allowed-tools: Bash(~/.reelcut/bin/reelcut:*)");
    expect(s).toContain("disable-model-invocation: true");
    expect(s).toMatch(/Never pass `--yes` without the owner's choice/);
  });
  it("lists every command in help, and refuses an unknown one", () => {
    const help = run("help");
    expect(help.status).toBe(0);
    for (const name of Object.keys(COMMAND_LINES)) expect(help.stdout).toMatch(new RegExp(`^  ${name}\\s`, "m"));
    const bad = run("explode");
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("/reelcut help lists them");
  });
  it("reports a studio that is not running instead of starting one for status", () => {
    const r = run("status");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("The studio is not running");
  });
});
