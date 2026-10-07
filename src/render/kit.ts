import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fontDataUrl, loadFontLibrary } from "../fonts/index.js";
import type { Kit } from "./project.js";

/** Where a page gets its font files: copied into a render project, or inlined into a page with no server. */
export type FontDelivery = "project" | "inline";

/** Fonts inside a render project live here, copied per clip. */
export const PROJECT_FONT_DIR = "assets/fonts";

/** The design kit (`skills/reelcut/assets/kit`) with the bundled fonts attached. */
export function loadKit(delivery: FontDelivery): Kit {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "skills", "reelcut", "assets", "kit");
  const lib = loadFontLibrary();
  return {
    css: readFileSync(path.join(dir, "kit.css"), "utf8"),
    js: readFileSync(path.join(dir, "kit.js"), "utf8"),
    ...(lib ? { fonts: { lib, url: delivery === "project" ? (file: string) => `${PROJECT_FONT_DIR}/${file}` : (file: string) => fontDataUrl(lib, file) } } : {}),
  };
}
