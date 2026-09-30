/**
 * How a composition uses a library asset: by referring to it as `assets/library/<id>.<ext>`.
 *
 * The render finds those references, copies the blobs into the project, and records the use —
 * so the only thing a composition needs to know is the asset's id, and the library can show
 * which reels a logo went into.
 */

export const LIBRARY_ASSET_DIR = "assets/library";

const REF = /assets\/library\/([0-9a-f]{16})(\.[a-z0-9]{1,5})?/gi;

/** Distinct library ids referenced in a composition, in order of first appearance. */
export function libraryRefsIn(html: string): string[] {
  const ids: string[] = [];
  for (const match of html.matchAll(REF)) {
    const id = match[1]!.toLowerCase();
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}
