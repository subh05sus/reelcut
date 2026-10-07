import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { reelcutHome } from "../library/store.js";
import type { Settings } from "./manager.js";

/**
 * A series: episodes that share an intro, an outro, a personality and settings. Episode 1 makes the intro and outro;
 * every later episode copies them from the episode before, so they match frame for frame.
 */
export interface Series {
  id: string;
  name: string;
  /** What the intro shows ("the show's name, then 'Episode N: <title>'"). */
  intro: string;
  /** What the outro shows ("follow for part N+1"). */
  outro: string;
  settings: Partial<Settings>;
  /** Conversations, in episode order. */
  episodes: string[];
  createdAt: string;
}

const file = () => path.join(reelcutHome(), "create", "series.json");
export function listSeries(): Series[] { try { return JSON.parse(readFileSync(file(), "utf8")) as Series[]; } catch { return []; } }
function save(list: Series[]): void { mkdirSync(path.dirname(file()), { recursive: true }); writeFileSync(file(), JSON.stringify(list, null, 1)); }
export function getSeries(id: string): Series | undefined { return listSeries().find((s) => s.id === id); }

export function saveSeries(input: Partial<Series> & { name: string }): Series {
  const list = listSeries();
  const old = input.id ? list.find((s) => s.id === input.id) : undefined;
  const s: Series = {
    id: old?.id ?? `s_${randomBytes(4).toString("hex")}`,
    name: String(input.name).trim().slice(0, 60) || "My series",
    intro: String(input.intro ?? old?.intro ?? "").trim().slice(0, 600),
    outro: String(input.outro ?? old?.outro ?? "").trim().slice(0, 600),
    settings: Object.fromEntries(Object.entries(input.settings ?? old?.settings ?? {}).filter(([, v]) => typeof v === "string" && v)) as Partial<Settings>,
    episodes: old?.episodes ?? [],
    createdAt: old?.createdAt ?? new Date().toISOString(),
  };
  save([s, ...list.filter((x) => x.id !== s.id)]);
  return s;
}
export function removeSeries(id: string): void { save(listSeries().filter((s) => s.id !== id)); }

/** Adds a conversation as the next episode; returns its number. */
export function addEpisode(seriesId: string, conversation: string): number {
  const list = listSeries();
  const s = list.find((x) => x.id === seriesId);
  if (!s) throw new Error("no such series");
  if (!s.episodes.includes(conversation)) s.episodes.push(conversation);
  save(list);
  return s.episodes.indexOf(conversation) + 1;
}

/** The series as lines of an episode's first prompt; `previousReel` is the last episode's reel.json, when there is one. */
export function seriesPrompt(s: Series, episode: number, previousReel: string | undefined): string[] {
  const lines = [`This reel is episode ${episode} of the series "${s.name}". Every episode must feel like the same show.`];
  if (s.intro) lines.push(`- Intro (first beat, the same in every episode): ${s.intro}`);
  if (s.outro) lines.push(`- Outro (last beat, the same in every episode): ${s.outro}`);
  if (previousReel && existsSync(previousReel)) {
    lines.push(`- The previous episode is ${previousReel}. Copy its intro and outro compositions into this reel and change only`,
      "  the episode number and title in them; keep its personality, look, type and sound exactly.");
  } else if (episode > 1) {
    lines.push("- The previous episode has no reel yet: make the intro and outro as described, so later episodes can copy them.");
  } else {
    lines.push("- This is the first episode: make the intro and outro carefully, as reusable compositions (episode number and title as",
      "  plain text in one element each), because every later episode copies them.");
  }
  lines.push("");
  return lines;
}
