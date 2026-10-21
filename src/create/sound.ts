import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { blobPath, isUsableSound, loadIndex, loadSfxPack } from "../library/index.js";
import { planMusic } from "../library/music.js";
import { streamInfo } from "../render/assemble.js";
import { resolveMusic, type MusicSpec } from "../render/music.js";

/**
 * A finished reel's sound, for the studio's Sound section: the music bed and how the cuts sit on its beat, and the
 * sound cues per beat, whose they are (the owner's own approved sounds, or the bundled CC0 pack).
 *
 * Putting the cuts on the beat moves them (by at most 0.15 s each), which changes beat lengths, so it goes to Claude:
 * compositions are timed against their lengths. Adding cues only changes the mix: the cues are proposed from each
 * beat's own moments and the master is re-mixed, with every clip getting its new slice, without rendering a frame.
 */

interface Manifest { beats: { id: string; durationSeconds: number; sfx?: { source: string }[] }[]; music?: MusicSpec; voiceover?: unknown; sfx?: unknown }

export interface SoundState {
  hasSound: boolean;
  music?: { name: string; bpm: number; confidence: number; sync: "fit" | "snap"; cuts: number; onBeat: number; voiced: boolean; snap?: { onBeat: number; moved: number; maxShift: number } };
  musicError?: string;
  cues: { total: number; beats: number; mine: number; pack: number };
  ownSounds: number;
  packSounds: number;
}

export function soundState(reelPath: string): SoundState {
  const m = JSON.parse(readFileSync(reelPath, "utf8")) as Manifest;
  const base = path.dirname(reelPath), master = path.join(base, "master.mp4");
  const cues = m.beats.flatMap((b) => b.sfx ?? []);
  const index = loadIndex();
  const out: SoundState = {
    hasSound: existsSync(master) && streamInfo(master).hasAudio,
    cues: { total: cues.length, beats: m.beats.filter((b) => b.sfx?.length).length, mine: cues.filter((c) => c.source.startsWith("library:")).length, pack: cues.filter((c) => c.source.startsWith("pack:")).length },
    ownSounds: index.assets.filter(isUsableSound).length,
    packSounds: loadSfxPack()?.sounds.length ?? 0,
  };
  if (m.music) {
    try {
      const r = resolveMusic(m.music, base, index.assets, blobPath);
      const d = m.beats.map((b) => b.durationSeconds), length = d.reduce((a, b) => a + b, 0);
      const cuts = d.slice(0, -1).map((_, i) => d.slice(0, i + 1).reduce((a, b) => a + b, 0));
      const sync = m.music.sync ?? "fit";
      const now = planMusic(r.analysis, cuts, length, sync, m.music.start !== undefined ? { start: m.music.start } : {});
      const voiced = !!m.voiceover;
      const snap = sync === "fit" && !voiced ? planMusic(r.analysis, cuts, length, "snap") : undefined;
      const moved = snap?.moved.filter((x) => x !== 0) ?? [];
      out.music = {
        name: r.name, bpm: Math.round(r.analysis.bpm), confidence: r.analysis.confidence, sync, cuts: cuts.length, onBeat: now.onBeat, voiced,
        ...(snap ? { snap: { onBeat: snap.onBeat, moved: moved.length, maxShift: Math.max(0, ...moved.map(Math.abs)) } } : {}),
      };
    } catch (error) { out.musicError = (error as Error).message; }
  }
  return out;
}

/** The instruction Claude gets from "Put the cuts on the beat". */
export function snapPrompt(reelPath: string, s: SoundState = soundState(reelPath)): { shown: string; prompt: string } {
  if (!s.music) throw new Error("this reel has no music bed");
  if (s.music.voiced) throw new Error("the voiceover sets this reel's cuts; the music fits under it");
  if (s.music.sync === "snap") throw new Error("the cuts are on the beat already");
  return {
    shown: "Put the cuts on the music's beat",
    prompt: [
      `Put the cuts of the reel at ${reelPath} on the music's beat: set "music": { …, "sync": "snap" } in reel.json. "${s.music.name}" is ${s.music.bpm} BPM; ${s.music.onBeat} of ${s.music.cuts} cuts are on a beat now, and snapping would put ${s.music.snap?.onBeat ?? "more"} on one, moving ${s.music.snap?.moved ?? "some"} cut${s.music.snap?.moved === 1 ? "" : "s"} by at most ${(s.music.snap?.maxShift ?? 0.15).toFixed(2)} s.`,
      `The render moves the cuts and writes the new lengths into reel.json. Run \`npm run render -- ${reelPath} --preflight\` first and see which beats change length; for each, check that its composition still lands its moves and holds its last line for its reading floor in the new length (adjust its timeline if not).`,
      `Then render: \`npm run render -- ${reelPath}${s.cues.total ? " --sfx" : ""}\` (every beat whose length changed renders again; the rest are reused). Reply in two lines: how many cuts are on the beat now, and anything you adjusted.`,
    ].join("\n"),
  };
}
