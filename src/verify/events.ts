import puppeteer from "puppeteer-core";
import { resolveBrowser } from "../capture/capture.js";
import type { RcEvent } from "../library/sfx.js";
import { buildMeasurePage } from "./measure.js";
import type { Kit } from "../render/project.js";

/**
 * Load each composition in Chrome with the kit and read the moments the kit's helpers recorded.
 *
 * A composition's timeline is built when its script runs, so the events are all there once the page
 * has loaded: no seeking, no playing, and the same list every time. Compositions that do not use the
 * kit (no `data-look`) have no events, and say so by returning an empty list.
 */
export async function collectEvents(beats: readonly { id: string; html: string }[], kit: Kit, executablePath?: string): Promise<Record<string, RcEvent[]>> {
  const browser = await puppeteer.launch({ executablePath: resolveBrowser(executablePath), headless: true, args: ["--no-sandbox", "--hide-scrollbars"] });
  const out: Record<string, RcEvent[]> = {};
  try {
    for (const beat of beats) {
      const tab = await browser.newPage();
      try {
        await tab.setViewport({ width: 1080, height: 1080 });
        await tab.setContent(buildMeasurePage(beat.html, kit), { waitUntil: "load", timeout: 60_000 });
        out[beat.id] = JSON.parse((await tab.evaluate(`JSON.stringify(window.__rcEvents || [])`)) as string) as RcEvent[];
      } finally {
        await tab.close();
      }
    }
  } finally {
    await browser.close();
  }
  return out;
}
