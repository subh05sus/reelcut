import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { reelcutHome } from "../library/store.js";

/**
 * What the owner has said about Clawd outside a personality: the moves and poses they starred on the studio's Clawd
 * page, which a beat reaches for first. `~/.reelcut/clawd.json`.
 */

export interface ClawdPrefs {
  /** "move:<id>" or "pose:<id>", most recently starred first. */
  favourites: string[];
}

function file(): string { return path.join(reelcutHome(), "clawd.json"); }

export function loadClawdPrefs(): ClawdPrefs {
  try {
    const raw = JSON.parse(readFileSync(file(), "utf8")) as Partial<ClawdPrefs>;
    return { favourites: Array.isArray(raw.favourites) ? raw.favourites.filter((f): f is string => typeof f === "string" && /^(move|pose):[\w-]+$/.test(f)) : [] };
  } catch {
    return { favourites: [] };
  }
}

function save(prefs: ClawdPrefs): void {
  mkdirSync(reelcutHome(), { recursive: true });
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, JSON.stringify(prefs, null, 2));
  renameSync(tmp, file());
}

/** Star or unstar a move or pose ("move:wave", "pose:idea-lightbulb"); returns the favourites. */
export function setFavourite(id: string, star: boolean): string[] {
  if (!/^(move|pose):[\w-]+$/.test(id)) throw new Error(`not a Clawd move or pose: ${id} (move:<id> or pose:<id>)`);
  const prefs = loadClawdPrefs();
  const rest = prefs.favourites.filter((f) => f !== id);
  prefs.favourites = star ? [id, ...rest] : rest;
  save(prefs);
  return prefs.favourites;
}

export function hasClawdPrefs(): boolean { return existsSync(file()); }
