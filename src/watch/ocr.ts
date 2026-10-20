import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { reelcutHome } from "../library/store.js";
import { WatchError } from "./time.js";

/**
 * Reading the text on screen: macOS Vision through a small Swift helper (built once into ~/.reelcut/bin), or
 * tesseract where Vision is not there. Boxes are fractions of the image, origin at the top left.
 */

export interface TextLine { text: string; conf?: number; box?: [number, number, number, number] }

const SRC = path.join(path.dirname(new URL(import.meta.url).pathname), "vision.swift");

function visionHelper(): string | undefined {
  if (process.platform !== "darwin") return undefined;
  const out = path.join(reelcutHome(), "bin", "reelcut-vision");
  if (existsSync(out) && statSync(out).mtimeMs >= statSync(SRC).mtimeMs) return out;
  if (spawnSync("/usr/bin/which", ["swiftc"]).status !== 0) return undefined;
  mkdirSync(path.dirname(out), { recursive: true });
  process.stderr.write("watch: building the macOS Vision text reader once …\n");
  return spawnSync("swiftc", ["-O", SRC, "-o", out]).status === 0 ? out : undefined;
}

export function textReaderAvailable(): string | undefined {
  return visionHelper() ?? (spawnSync("/usr/bin/which", ["tesseract"]).status === 0 ? "tesseract" : undefined);
}

export function readText(files: readonly string[]): Map<string, TextLine[]> {
  const out = new Map<string, TextLine[]>();
  if (!files.length) return out;
  const helper = visionHelper();
  if (helper) {
    for (let i = 0; i < files.length; i += 200) {
      const r = spawnSync(helper, files.slice(i, i + 200), { maxBuffer: 64 << 20 });
      for (const line of r.stdout.toString().split("\n")) {
        if (!line.trim()) continue;
        const rec = JSON.parse(line) as { path: string; lines?: TextLine[] };
        out.set(rec.path, rec.lines ?? []);
      }
    }
    return out;
  }
  if (spawnSync("/usr/bin/which", ["tesseract"]).status === 0) {
    for (const f of files) {
      const r = spawnSync("tesseract", [f, "-", "--psm", "11"]);
      out.set(f, r.stdout.toString().split("\n").map((l) => l.trim()).filter(Boolean).map((text) => ({ text })));
    }
    return out;
  }
  throw new WatchError("no text reader: on macOS install the Xcode command line tools (xcode-select --install) for Vision, elsewhere tesseract. Or zoom and read the frame yourself.");
}

export function where(box: [number, number, number, number]): string {
  const [x, y, w, h] = box, cx = x + w / 2, cy = y + h / 2;
  return `${cy < 0.33 ? "top" : cy < 0.66 ? "middle" : "bottom"}-${cx < 0.33 ? "left" : cx < 0.66 ? "center" : "right"}`;
}

export const REGIONS: Record<string, [number, number, number, number]> = {
  full: [0, 0, 1, 1], top: [0, 0, 1, 0.34], middle: [0, 0.33, 1, 0.34], bottom: [0, 0.66, 1, 0.34],
  left: [0, 0, 0.5, 1], right: [0.5, 0, 0.5, 1], center: [0.25, 0.25, 0.5, 0.5],
  "top-left": [0, 0, 0.5, 0.5], "top-right": [0.5, 0, 0.5, 0.5], "bottom-left": [0, 0.5, 0.5, 0.5], "bottom-right": [0.5, 0.5, 0.5, 0.5],
};

export function region(s: string | undefined): [number, number, number, number] {
  if (!s) return REGIONS.full!;
  if (REGIONS[s]) return REGIONS[s]!;
  const n = s.split(",").map(Number);
  if (n.length !== 4 || n.some((x) => !Number.isFinite(x))) throw new WatchError(`region \`${s}\`: use one of ${Object.keys(REGIONS).join(", ")} or x,y,w,h as fractions (0.5,0,0.5,0.3)`);
  const [x, y, w, h] = n as [number, number, number, number];
  return [x, y, Math.min(w, 1 - x), Math.min(h, 1 - y)];
}
