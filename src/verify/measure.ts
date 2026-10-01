import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { resolveBrowser } from "../capture/capture.js";
import { GSAP_URL, injectKit, usesKit, type Kit } from "../render/project.js";

/**
 * Measure a composition the way a designer would with a ruler: where is everything, does it sit on
 * the grid, does anything leave the safe area, is anything too small to read.
 *
 * `hyperframes check` answers "is this broken" (overlap, contrast, a blank panel). It cannot answer
 * "is this *right*": whether the card is on the margin, whether the headline's first letter is
 * flush with it, whether two cards that should be 24px apart are 23 or 25. Those are the details
 * that separate a polished beat from a plausible one, and they are invisible in a contact sheet.
 * So this loads the composition in Chrome with the kit injected, seeks its timeline to chosen
 * times, and reports **layout rectangles with the camera neutralised** — the designed layout, not
 * the 3% push — plus an overlay of the grid, and optional scans.
 *
 * Seeking is exact because every composition is a paused timeline registered on
 * `window.__timelines`; a frame is a pure function of time.
 */

/** The frame is 1080 square; everything lives inside this margin. */
export const MARGIN = 84;
/** Where the content region starts (below a two-line headline) and ends. */
export const CONTENT_TOP = 336;
export const CONTENT_BOTTOM = 1080 - MARGIN;
/** Text under this size is not read at 1080. */
export const MIN_TEXT_PX = 16;

export interface Rect { x: number; y: number; w: number; h: number; r: number; b: number }

export interface LayoutFinding {
  kind: "outside-safe" | "overflow" | "small-text";
  /** The element's class list, trimmed. */
  el: string;
  text: string;
  detail: string;
}

export interface Bearing { selector: string; text: string; char: string; size: string; bearing: number }

export interface Sample {
  at: number;
  rects: Record<string, Rect[]>;
  baselines: Record<string, number[]>;
  findings: LayoutFinding[];
  screenshot: string;
}

export interface MeasureReport { samples: Sample[]; bearings: Bearing[] }

export interface MeasureOptions {
  file: string;
  times: number[];
  kit: Kit;
  outDir: string;
  /** Draw margin and content-region guides on the screenshot. */
  guides?: boolean;
  /** Report anything outside the safe area, overflowing its box, or set under `MIN_TEXT_PX`. */
  scan?: boolean;
  /** Leave the `.cam` push on in the screenshot. Measurements are always taken with it off. */
  keepCamera?: boolean;
  /** Selectors whose rectangles to report. */
  select?: string[];
  /** Selectors whose first text baseline (y) to report. */
  baselines?: string[];
  /** Selectors whose first glyph's left side bearing to report, for optical alignment. */
  bearings?: string[];
  /** Screenshot file stem. Defaults to the composition's file name. */
  name?: string;
  executablePath?: string;
}

/** The page: the template's contents, the kit, GSAP, and a stage exactly the size of the frame. */
export function buildMeasurePage(html: string, kit: Kit): string {
  const withKit = usesKit(html) ? injectKit(html, kit) : html;
  const match = /<template[^>]*>([\s\S]*)<\/template>/i.exec(withKit);
  if (!match) throw new Error("not a composition: no <template>");
  return `<!doctype html><html><head><meta charset="utf-8">
<script>window.__timelines = {};</script>
<script src="${GSAP_URL}"></script>
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:1080px;height:1080px;overflow:hidden;background:#111}#stage{position:relative;width:1080px;height:1080px}</style>
</head><body><div id="stage">${match[1]}</div></body></html>`;
}

/** Everything the page is asked, as one expression, so the Node side needs no DOM types. */
export function measureExpression(args: { select: string[]; baselines: string[]; scan: boolean }): string {
  return `(() => {
  const args = ${JSON.stringify(args)};
  const MARGIN = ${MARGIN}, MIN = ${MIN_TEXT_PX};
  document.querySelectorAll(".cam").forEach((e) => { e.style.transform = "none"; });
  const R = (b) => ({ x: +b.left.toFixed(1), y: +b.top.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1) });
  const out = { rects: {}, baselines: {}, findings: [] };
  args.select.forEach((s) => { out.rects[s] = Array.from(document.querySelectorAll(s)).map((el) => R(el.getBoundingClientRect())); });
  args.baselines.forEach((s) => {
    out.baselines[s] = Array.from(document.querySelectorAll(s)).map((el) => {
      const probe = document.createElement("span");
      probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
      el.insertBefore(probe, el.firstChild);
      const y = probe.getBoundingClientRect().bottom;
      probe.remove();
      return +y.toFixed(1);
    });
  });
  if (args.scan) {
    const SKIP = ".rc-mesh,.rc-grain,.rc-dots,.rc-bloom,.rc-horizon,.rc-vignette,.rc-grid,.rc-fill,.rc-hud,svg defs";
    const cls = (el) => String((el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || el.tagName).trim().slice(0, 40);
    document.querySelectorAll("#root *").forEach((el) => {
      if (el.closest(SKIP)) return;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.05) return;
      const b = el.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) return;
      const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3 && n.textContent.trim());
      const card = el.classList.contains("rc-card") || el.classList.contains("rc-window") || el.classList.contains("rc-glass");
      const label = (el.textContent || "").trim().slice(0, 24);
      // A text node is measured by its own ink box, not by its (often full-width) element.
      let outside = null;
      own.forEach((n) => {
        const rg = document.createRange(); rg.selectNodeContents(n);
        const rb = rg.getBoundingClientRect();
        if (rb.width > 0 && (rb.left < MARGIN - 0.5 || rb.right > 1080 - MARGIN + 0.5 || rb.top < MARGIN - 0.5 || rb.bottom > 1080 - MARGIN + 0.5)) outside = outside || rb;
      });
      if (card && (b.left < MARGIN - 0.5 || b.right > 1080 - MARGIN + 0.5 || b.top < MARGIN - 0.5 || b.bottom > 1080 - MARGIN + 0.5)) outside = outside || b;
      // The headline is pulled left by its first glyph's side bearing on purpose, so its boxes leave the margin by a few px.
      if (outside && !el.closest(".rc-head")) out.findings.push({ kind: "outside-safe", el: cls(el), text: label, detail: "x " + outside.left.toFixed(1) + ".." + outside.right.toFixed(1) + "  y " + outside.top.toFixed(1) + ".." + outside.bottom.toFixed(1) });
      if (own.length && el.scrollWidth > el.clientWidth + 1 && cs.overflow !== "visible") out.findings.push({ kind: "overflow", el: cls(el), text: label, detail: "content " + el.scrollWidth + "px in a " + el.clientWidth + "px box" });
      if (own.length && parseFloat(cs.fontSize) < MIN) out.findings.push({ kind: "small-text", el: cls(el), text: label, detail: cs.fontSize });
    });
  }
  return out;
})()`;
}

/** The left side bearing of each first glyph, in px at its own size: how far the ink sits inside its box. */
export function bearingExpression(selectors: string[]): string {
  return `(() => {
  const cv = document.createElement("canvas").getContext("2d");
  const K = 10;
  const rows = [];
  ${JSON.stringify(selectors)}.forEach((selector) => {
    Array.from(document.querySelectorAll(selector)).forEach((el) => {
      const text = (el.textContent || "").trim();
      if (!text) return;
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n, host = el;
      while ((n = w.nextNode())) { if (n.textContent.trim()) { host = n.parentElement; break; } }
      const cs = getComputedStyle(host);
      cv.font = cs.fontStyle + " " + cs.fontWeight + " " + (parseFloat(cs.fontSize) * K) + "px " + cs.fontFamily;
      const m = cv.measureText(text[0]);
      rows.push({ selector, text: text.slice(0, 24), char: text[0], size: cs.fontSize, bearing: +(-m.actualBoundingBoxLeft / K).toFixed(2) });
    });
  });
  return rows;
})()`;
}

const GUIDES_EXPRESSION = `(() => {
  const g = document.createElement("div");
  g.id = "rc-guides";
  const v = [${MARGIN}, 540, ${1080 - MARGIN}].map((x) => "linear-gradient(90deg,transparent " + (x - 0.5) + "px,rgba(255,0,170,.75) " + (x - 0.5) + "px,rgba(255,0,170,.75) " + (x + 0.5) + "px,transparent " + (x + 0.5) + "px)");
  const h = [${MARGIN}, ${CONTENT_TOP}, ${CONTENT_BOTTOM}].map((y) => "linear-gradient(180deg,transparent " + (y - 0.5) + "px,rgba(0,170,255,.75) " + (y - 0.5) + "px,rgba(0,170,255,.75) " + (y + 0.5) + "px,transparent " + (y + 0.5) + "px)");
  g.style.cssText = "position:absolute;inset:0;z-index:99999;pointer-events:none;background:" + v.concat(h).join(",");
  document.querySelector("#stage").appendChild(g);
})()`;

const SEEK_EXPRESSION = (t: number): string => `(() => {
  const root = document.querySelector("[data-composition-id]");
  const tl = window.__timelines[root.dataset.compositionId];
  if (!tl) throw new Error("no timeline registered for " + root.dataset.compositionId);
  tl.pause(); tl.time(${t}, false);
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
})()`;

export async function measureComposition(options: MeasureOptions): Promise<MeasureReport> {
  const html = readFileSync(options.file, "utf8");
  const page = buildMeasurePage(html, options.kit);
  mkdirSync(options.outDir, { recursive: true });
  const name = options.name ?? path.basename(options.file, ".html");

  const browser = await puppeteer.launch({
    executablePath: resolveBrowser(options.executablePath),
    headless: true,
    args: ["--no-sandbox", "--hide-scrollbars", "--force-device-scale-factor=1"],
  });
  try {
    const tab = await browser.newPage();
    await tab.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });
    await tab.setContent(page, { waitUntil: "load", timeout: 60_000 });
    await tab.evaluate(`document.fonts.ready`);
    await new Promise((resolve) => setTimeout(resolve, 400));

    const bearings = options.bearings?.length ? ((await tab.evaluate(bearingExpression(options.bearings))) as Bearing[]) : [];
    const samples: Sample[] = [];
    for (const at of options.times) {
      await tab.evaluate(SEEK_EXPRESSION(at));
      const measured = (await tab.evaluate(
        measureExpression({ select: options.select ?? [], baselines: options.baselines ?? [], scan: options.scan ?? false }),
      )) as { rects: Record<string, Rect[]>; baselines: Record<string, number[]>; findings: LayoutFinding[] };
      // The picture is taken from the same instant, with the camera restored unless asked otherwise.
      await tab.evaluate(SEEK_EXPRESSION(at + 0.0003));
      if (options.keepCamera === false) await tab.evaluate(`document.querySelectorAll(".cam").forEach((e) => { e.style.transform = "none"; })`);
      if (options.guides) await tab.evaluate(GUIDES_EXPRESSION);
      const screenshot = path.join(options.outDir, `${name}-${at}.png`);
      await tab.screenshot({ path: screenshot as `${string}.png`, clip: { x: 0, y: 0, width: 1080, height: 1080 } });
      if (options.guides) await tab.evaluate(`document.getElementById("rc-guides")?.remove()`);
      samples.push({ at, ...measured, screenshot });
    }
    return { samples, bearings };
  } finally {
    await browser.close();
  }
}

/** The report as text, one block per time. */
export function formatMeasureReport(report: MeasureReport): string {
  const lines: string[] = [];
  for (const b of report.bearings) lines.push(`bearing  ${JSON.stringify(b.text)}  "${b.char}" at ${b.size}  ${b.bearing > 0 ? "+" : ""}${b.bearing}px  → set --ox:${(-b.bearing).toFixed(1)}px`);
  for (const s of report.samples) {
    lines.push(`--- t=${s.at}  ${path.basename(s.screenshot)}`);
    for (const [sel, rects] of Object.entries(s.rects)) lines.push(`  ${sel}  ${rects.map((r) => `[x ${r.x} y ${r.y} w ${r.w} h ${r.h}  →  r ${r.r} b ${r.b}]`).join("  ")}`);
    for (const [sel, ys] of Object.entries(s.baselines)) lines.push(`  baseline ${sel}  ${ys.join(", ")}`);
    if (s.findings.length) {
      lines.push(`  ${s.findings.length} to look at:`);
      for (const f of s.findings) lines.push(`    ${f.kind}  ${f.el}  "${f.text}"  ${f.detail}`);
    } else if (s.rects && Object.keys(s.rects).length === 0 && Object.keys(s.baselines).length === 0) {
      lines.push("  nothing selected or scanned");
    }
  }
  return lines.join("\n");
}

/** Command-line arguments for `measure`: `<file> <t1,t2,…> [--flags]`. */
export interface MeasureArgs {
  file: string;
  times: number[];
  guides: boolean;
  scan: boolean;
  keepCamera: boolean;
  select: string[];
  baselines: string[];
  bearings: string[];
  outDir: string;
  name?: string;
}

const splitList = (value: string | undefined): string[] => (value ?? "").split("||").map((s) => s.trim()).filter(Boolean);

export function parseMeasureArgs(argv: readonly string[]): MeasureArgs | undefined {
  const [file, timesArg, ...rest] = argv;
  if (!file || !timesArg) return undefined;
  const times = timesArg.split(",").map(Number);
  if (times.some((t) => !Number.isFinite(t) || t < 0)) return undefined;
  const flag = (n: string): boolean => rest.includes(n);
  const value = (n: string): string | undefined => {
    const i = rest.indexOf(n);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const name = value("--name");
  return {
    file,
    times,
    guides: flag("--guides"),
    scan: flag("--scan"),
    keepCamera: !flag("--no-camera"),
    select: splitList(value("--select")),
    baselines: splitList(value("--baselines")),
    bearings: splitList(value("--bearings")),
    outDir: value("--out") ?? path.join("out", "measure"),
    ...(name ? { name } : {}),
  };
}
