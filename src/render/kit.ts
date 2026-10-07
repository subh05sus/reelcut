import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fontDataUrl, loadFontLibrary } from "../fonts/index.js";
import type { Kit } from "./project.js";

/** Where a page gets its font files: copied into a render project, or inlined into a page with no server. */
export type FontDelivery = "project" | "inline";

/** Fonts inside a render project live here, copied per clip. */
export const PROJECT_FONT_DIR = "assets/fonts";

export const KIT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "skills", "reelcut", "assets", "kit");

/**
 * The kit's CSS and JS: `kit.css` and `kit.js` first, then each UI family in `ui/` (Apple's iPhone and Mac
 * components, the app mockups) in name order, so a family can build on the core and its springs.
 */
export function readKitSources(dir: string = KIT_DIR): { css: string; js: string } {
  const ui = path.join(dir, "ui");
  const family = (ext: string): string[] =>
    existsSync(ui) ? readdirSync(ui).filter((f) => f.endsWith(ext)).sort().map((f) => `/* ui/${f} */\n${readFileSync(path.join(ui, f), "utf8")}`) : [];
  return {
    css: [readFileSync(path.join(dir, "kit.css"), "utf8"), ...family(".css")].join("\n"),
    js: [readFileSync(path.join(dir, "kit.js"), "utf8"), ...family(".js")].join("\n"),
  };
}

/** The design kit (`skills/reelcut/assets/kit`) with the bundled fonts attached. */
export function loadKit(delivery: FontDelivery): Kit {
  const lib = loadFontLibrary();
  return {
    ...readKitSources(),
    ...(lib ? { fonts: { lib, url: delivery === "project" ? (file: string) => `${PROJECT_FONT_DIR}/${file}` : (file: string) => fontDataUrl(lib, file) } } : {}),
  };
}
