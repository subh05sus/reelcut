import { readFileSync } from "node:fs";
import path from "node:path";
import { KIT_DIR } from "../render/kit.js";
import { STYLES } from "../personality/styles.js";
import { MOVES } from "./moves.js";
import { loadClawdPrefs } from "./store.js";

/** The pack's poses as the kit ships them, read from the generated file, so a listing and a render always agree. */
export function kitPoses(dir: string = KIT_DIR): { id: string; tags: string[]; expr: string; minis: unknown[] }[] {
  let text: string;
  try { text = readFileSync(path.join(dir, "ui", "82-clawd-pack.js"), "utf8"); } catch { return []; }
  return [...text.matchAll(/^ {4}"[\w-]+": (\{.*\})(?:,)?$/gm)].map((m) => {
    const p = JSON.parse(m[1]!) as { id: string; tags: string[]; expr: string; minis: unknown[] };
    return { id: p.id, tags: p.tags, expr: p.expr, minis: p.minis };
  });
}

/** Everything the studio's Clawd page lists: the moves, the poses, the styles to see them in, and what is starred. */
export function clawdCatalog(): { moves: { id: string; name: string; tags: string[]; seconds: number }[]; poses: { id: string; tags: string[] }[]; styles: { id: string; name: string }[]; favourites: string[] } {
  return {
    moves: MOVES.map((m) => ({ id: m.id, name: m.name, tags: m.tags, seconds: m.seconds })),
    poses: kitPoses().map((p) => ({ id: p.id, tags: p.tags })),
    styles: STYLES.map((s) => ({ id: s.id, name: s.name })),
    favourites: loadClawdPrefs().favourites,
  };
}
