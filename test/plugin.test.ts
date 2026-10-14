import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO = path.resolve(__dirname, "..");
const json = (file: string) => JSON.parse(readFileSync(path.join(REPO, file), "utf8"));

// Claude Code keeps one copy of an installed plugin per version, so a release only reaches installed
// users when plugin.json's version changes. package.json carries the same number.
describe("the plugin's version", () => {
  it("is the same in plugin.json, package.json and the lockfile", () => {
    const plugin = json(".claude-plugin/plugin.json").version, pkg = json("package.json"), lock = json("package-lock.json");
    expect(plugin).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.version, "package.json").toBe(plugin);
    expect(lock.version, "package-lock.json").toBe(plugin);
    expect(lock.packages[""].version, "package-lock.json root").toBe(plugin);
  });
  it("is not overridden by the marketplace entry", () => {
    for (const p of json(".claude-plugin/marketplace.json").plugins) expect(p.version, p.name).toBeUndefined();
  });
});
