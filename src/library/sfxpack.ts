import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LibraryAsset } from "./schema.js";

/**
 * The bundled motion-graphics sound pack: about 270 CC0 sounds (whooshes, risers, clicks, typing, dings, pops,
 * hits, booms, glitches, shimmers) that ship with the skill and are ready to use without anyone approving them.
 *
 * They sit beside the user's own approved sounds in the cue picker. A cue names one as `pack:<id>`. On a tie
 * the user's own sound wins: the pack is a floor, not a replacement for a library someone curated.
 */

export const SFX_CATEGORIES = ["transition", "ui", "pop", "hit", "texture"] as const;
export type SfxCategory = (typeof SFX_CATEGORIES)[number];

export interface PackSound {
  /** e.g. `whoosh-bamboo-03`. A cue names it as `pack:whoosh-bamboo-03`. */
  id: string;
  name: string;
  /** Relative to the pack directory. */
  file: string;
  category: SfxCategory;
  tags: string[];
  durationSeconds: number;
  /** The gain that brings it to the mix's target loudness, as for a library sound. */
  gainDb: number;
  lufs: number;
  peakDb: number;
  source: { pack: string; author: string; url: string; licence: "CC0 1.0" };
  /** For a sound made from another (reversed, slowed, layered): what it was made from. */
  derivedFrom?: string;
}

export interface PackManifest {
  version: 1;
  builtAt: string;
  licence: string;
  sounds: PackSound[];
}

export interface SfxPack {
  dir: string;
  sounds: PackSound[];
  byId: Map<string, PackSound>;
}

export const PACK_PREFIX = "pack:";

/** `skills/reelcut/assets/sfx`. */
export function packDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "skills", "reelcut", "assets", "sfx");
}

let cached: SfxPack | null | undefined;
export function loadSfxPack(dir = packDir()): SfxPack | undefined {
  if (cached !== undefined && dir === packDir()) return cached ?? undefined;
  const file = path.join(dir, "manifest.json");
  const pack = existsSync(file)
    ? (() => {
        const m = JSON.parse(readFileSync(file, "utf8")) as PackManifest;
        return { dir, sounds: m.sounds, byId: new Map(m.sounds.map((s) => [s.id, s])) };
      })()
    : null;
  if (dir === packDir()) cached = pack;
  return pack ?? undefined;
}

export function packSoundPath(pack: SfxPack, sound: PackSound): string {
  return path.join(pack.dir, sound.file);
}

/**
 * The pack's sounds in the shape the picker reads: active, approved audio with person-level tags. The id carries
 * the `pack:` prefix, so a proposal names it the way a cue does and it never collides with a library id.
 */
export function packAsAssets(pack: SfxPack | undefined): LibraryAsset[] {
  if (!pack) return [];
  return pack.sounds.map((s): LibraryAsset => ({
    id: `${PACK_PREFIX}${s.id}`,
    name: s.name,
    file: s.file,
    ext: "ogg",
    bytes: 0,
    sha256: "0".repeat(64),
    assetKind: "generic",
    tags: s.tags,
    tagOrigin: {},
    provenance: { source: "user", licence: s.source.licence, url: s.source.url, note: `${s.source.pack} by ${s.source.author}${s.derivedFrom ? `; ${s.derivedFrom}` : ""}` },
    addedAt: "2026-10-07T00:00:00.000Z",
    usedIn: [],
    status: "active",
    mediaType: "audio",
    analysis: { dominantColors: [], descriptors: [], durationSeconds: s.durationSeconds, gainDb: s.gainDb, lufs: s.lufs, peakDb: s.peakDb },
    review: { state: "approved", by: "legacy" },
    private: false,
  }));
}

export function isPackId(id: string): boolean {
  return id.startsWith(PACK_PREFIX);
}
