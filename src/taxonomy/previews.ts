import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { reelcutHome } from "../library/store.js";
import type { Personality } from "../personality/schema.js";
import { defaultPersonality } from "../personality/store.js";
import { styleById, type StyleSpec } from "../personality/styles.js";
import { TECHNIQUES } from "./catalog.js";
import type { TechniquePreviewOptions } from "./preview.js";

/**
 * Where the technique previews live and whether they are current. One set per personality (the default one is what
 * the studio shows), in ~/.reelcut/technique-previews/<personality id | "plain">/<technique>.mp4 + .jpg, with a stamp
 * of the personality version they were made from: when the personality changes, the set is out of date.
 */
export const PREVIEW_VERSION = 1;
export const previewRoot = (): string => path.join(reelcutHome(), "technique-previews");
export const previewKey = (p: Personality | undefined): string => p?.id ?? "plain";
export const previewDirFor = (p: Personality | undefined): string => path.join(previewRoot(), previewKey(p));

export interface PreviewStamp { personality: string; updatedAt: string; version: number }
export const stampFor = (p: Personality | undefined): PreviewStamp => ({ personality: previewKey(p), updatedAt: p?.updatedAt ?? "", version: PREVIEW_VERSION });

/** The look a personality's previews are made in: its lead style, palette, type, motion and texture. */
export function previewLook(p: Personality | undefined): { style: StyleSpec; options: Omit<TechniquePreviewOptions, "id"> } {
  const style = (p?.styles[0] && styleById(p.styles[0].id)) || styleById("flat-vector")!;
  if (!p) return { style, options: { palette: style.palettes[0]!, pairing: style.fonts.best[0]! } };
  const texture = p.texture.useStyle === false ? ({ ...style.texture, ...p.texture } as StyleSpec["texture"]) : style.texture;
  const cadence = p.motion.cadence === "smooth" ? "smooth" : p.motion.cadence === "stepped" ? "stepped-12" : style.motion.cadence;
  return { style, options: { palette: p.palettes[style.id] ?? style.palettes[0]!, pairing: p.fonts[style.id] ?? style.fonts.best[0]!, energy: p.motion.energy, cadence, texture } };
}

export interface PreviewStatus { key: string; have: string[]; total: number; stale: boolean; personality: string | null }
/** Which previews exist for the default personality, and whether they were made from its current version. */
export function previewStatus(p: Personality | undefined = defaultPersonality()): PreviewStatus {
  const dir = previewDirFor(p);
  const have = TECHNIQUES.filter((t) => existsSync(path.join(dir, `${t.id}.mp4`))).map((t) => t.id);
  let stale = have.length > 0;
  try {
    const st = JSON.parse(readFileSync(path.join(dir, "stamp.json"), "utf8")) as PreviewStamp;
    const want = stampFor(p);
    stale = st.updatedAt !== want.updatedAt || st.version !== want.version;
  } catch { /* no stamp: whatever is there is from before stamps */ }
  return { key: previewKey(p), have, total: TECHNIQUES.length, stale, personality: p?.name ?? null };
}
