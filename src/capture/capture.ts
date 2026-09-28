import { existsSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { legibilityVerdict, type FontSizeSample, type LegibilityVerdict } from "./legibility.js";
import { scanForSecrets, type SecretFinding } from "./secrets.js";

/**
 * Capture a real product surface, and refuse the capture when it is not usable.
 *
 * Four things can be wrong with a screenshot, and all four passed every gate in the predecessor
 * pipeline because a filled image slot looks identical to a good one:
 *
 * 1. **It is illegible** at the size it will appear. The measured defect — full browser windows at
 *    1512×792 in 35% of a 1080 frame, body text rendering at about 3.5px.
 * 2. **It shows the wrong thing** — a cookie wall, a sign-in page, a skeleton loader.
 * 3. **It contains someone's real data** — a customer name in a sidebar, an account email in a
 *    header, an invoice number.
 * 4. **It is the whole window** when the beat needed one card.
 *
 * So this captures the *element*, measures the page rather than guessing about it, and returns a
 * refusal with a reason rather than a file that looks fine.
 *
 * Judgement captures — signing in, dismissing an unusual overlay, deciding what the crop should
 * contain — belong to the Claude in Chrome extension, where a human-shaped agent can look at the
 * page. This is the unattended path: same target, same checks, repeatable.
 */

export interface CaptureOptions {
  url: string;
  /** CSS selector for the element to capture. The element, never the viewport. */
  selector: string;
  outputPath: string;
  /** How wide it will sit in the frame, as a fraction. Drives the legibility gate. */
  targetWidthFraction: number;
  frameWidth?: number;
  /** Viewport to render the page at before selecting the element. */
  viewport?: { width: number; height: number; deviceScaleFactor?: number };
  /** Text the capture must contain, so a sign-in page cannot pass as a dashboard. */
  mustContain?: readonly string[];
  /** Try to dismiss a consent banner before capturing. */
  dismissConsent?: boolean;
  /** Extra milliseconds to settle after load, for pages that animate in. */
  settleMs?: number;
  timeoutMs?: number;
  /** Explicit browser binary. Otherwise resolved from CHROME_PATH or the usual places. */
  executablePath?: string;
}

export interface CaptureMeasurement {
  elementWidth: number;
  elementHeight: number;
  fontSizes: FontSizeSample[];
  textLength: number;
}

export type CaptureRefusal =
  | "selector_not_found"
  | "element_empty"
  | "illegible"
  | "missing_required_text"
  | "consent_or_login"
  | "contains_secrets"
  | "navigation_failed";

export interface CaptureResult {
  ok: boolean;
  outputPath?: string;
  refusal?: CaptureRefusal;
  detail?: string;
  measurement?: CaptureMeasurement;
  legibility?: LegibilityVerdict;
  secrets?: SecretFinding[];
  /** Written beside the image: where it came from and what was checked. */
  provenance?: Record<string, unknown>;
}

const DEFAULT_VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };
const DEFAULT_TIMEOUT_MS = 45_000;

/**
 * Find a browser.
 *
 * `CHROME_PATH` first, then the `chrome-headless-shell` HyperFrames already downloads — which
 * means a machine set up to render is a machine set up to capture, with nothing extra installed.
 */
export function resolveBrowser(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  const cache = path.join(homedir(), ".cache", "puppeteer", "chrome-headless-shell");
  if (existsSync(cache)) {
    for (const version of readdirSync(cache).sort().reverse()) {
      for (const leaf of ["chrome-headless-shell.exe", "chrome-headless-shell"]) {
        const candidate = path.join(cache, version, `chrome-headless-shell-${process.platform === "win32" ? "win64" : process.platform === "darwin" ? "mac-x64" : "linux64"}`, leaf);
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  const common =
    process.platform === "win32"
      ? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  for (const candidate of common) if (existsSync(candidate)) return candidate;

  throw new Error("no browser found — set CHROME_PATH, or run `npx hyperframes browser ensure`");
}

/** Consent and auth wording, in the two languages this project ships in. */
const CONSENT_PATTERNS = [
  /\b(accept|allow) (all )?cookies?\b/i,
  /\balle cookies akzeptieren\b/i,
  /\bcookie[- ]einstellungen\b/i,
  /\bwir verwenden cookies\b/i,
  /\bwe use cookies\b/i,
  /\bmanage (your )?preferences\b/i,
];
const AUTH_PATTERNS = [/\bsign in\b/i, /\blog ?in\b/i, /\banmelden\b/i, /\beinloggen\b/i, /\bpasswor[dt]\b/i, /\bcreate (an )?account\b/i];

/**
 * Measure the captured node from inside the page.
 *
 * Font sizes are counted by *characters set at that size*, not by element, because that is what
 * the legibility gate needs: one 8px footer and a page of 16px body must not weigh the same.
 * Hidden, zero-sized and fully transparent text is skipped — it is not going to be read.
 */
function measureExpression(selector: string): string {
  return `(() => {
  const selector = ${JSON.stringify(selector)};
  const root = document.querySelector(selector);
  if (!root) return { found: false };
  const rect = root.getBoundingClientRect();
  const sizes = new Map();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = "";
  let node;
  while ((node = walker.nextNode())) {
    const value = (node.nodeValue || "").trim();
    if (!value) continue;
    const el = node.parentElement;
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const px = Math.round(parseFloat(cs.fontSize));
    sizes.set(px, (sizes.get(px) || 0) + value.length);
    text += value + " ";
  }
  return {
    found: true,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    fontSizes: [...sizes.entries()].map(([px, chars]) => ({ px, chars })),
    text,
  };
})()`;
}

async function dismissConsent(page: Page): Promise<boolean> {
  return page.evaluate(`(() => {
    const words = ["accept", "akzeptieren", "zustimmen", "agree", "alle erlauben", "allow all", "got it", "verstanden"];
    const clickable = [...document.querySelectorAll("button, [role=button], a")];
    for (const el of clickable) {
      const label = (el.textContent || "").trim().toLowerCase();
      if (!label || label.length > 40) continue;
      if (words.some((w) => label.includes(w))) { el.click(); return true; }
    }
    return false;
  })()`) as Promise<boolean>;
}

export async function capture(options: CaptureOptions): Promise<CaptureResult> {
  const {
    url,
    selector,
    outputPath,
    targetWidthFraction,
    frameWidth = 1080,
    viewport = DEFAULT_VIEWPORT,
    mustContain = [],
    dismissConsent: wantDismiss = true,
    settleMs = 600,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    executablePath,
  } = options;

  let browser: Browser | undefined;
  try {
    browser = await puppeteer.launch({ executablePath: resolveBrowser(executablePath), headless: true, args: ["--hide-scrollbars"] });
    const page = await browser.newPage();
    await page.setViewport({ deviceScaleFactor: 2, ...viewport });

    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: timeoutMs });
    } catch (error) {
      return { ok: false, refusal: "navigation_failed", detail: error instanceof Error ? error.message : String(error) };
    }

    if (wantDismiss) {
      await dismissConsent(page).catch(() => false);
      await new Promise((r) => setTimeout(r, 250));
    }
    if (settleMs > 0) await new Promise((r) => setTimeout(r, settleMs));

    const measured = (await page.evaluate(measureExpression(selector))) as
      | { found: false }
      | { found: true; width: number; height: number; fontSizes: FontSizeSample[]; text: string };

    if (!measured.found) {
      return { ok: false, refusal: "selector_not_found", detail: `no element matched ${selector}` };
    }
    if (measured.width < 8 || measured.height < 8) {
      return { ok: false, refusal: "element_empty", detail: `${selector} measured ${measured.width}x${measured.height}` };
    }

    const measurement: CaptureMeasurement = {
      elementWidth: measured.width,
      elementHeight: measured.height,
      fontSizes: measured.fontSizes,
      textLength: measured.text.length,
    };

    /*
     * Order matters. Check what the capture IS before checking whether it is readable — being
     * told a sign-in page is illegible is a worse message than being told it is a sign-in page.
     */
    const pageText = await page.evaluate(`document.body.innerText || ""`) as string;
    const consentHit = CONSENT_PATTERNS.find((p) => p.test(pageText));
    const authHit = AUTH_PATTERNS.find((p) => p.test(measured.text));
    if (consentHit) {
      return { ok: false, refusal: "consent_or_login", detail: `page still shows a consent banner (${consentHit})`, measurement };
    }
    if (authHit && mustContain.length === 0) {
      return {
        ok: false,
        refusal: "consent_or_login",
        detail: `the captured element reads like a sign-in (${authHit}). If that is genuinely the target, pass --must-contain to say what proves it.`,
        measurement,
      };
    }

    const missing = mustContain.filter((needle) => !measured.text.toLowerCase().includes(needle.toLowerCase()));
    if (missing.length > 0) {
      return { ok: false, refusal: "missing_required_text", detail: `capture does not contain ${missing.map((m) => JSON.stringify(m)).join(", ")}`, measurement };
    }

    const secrets = scanForSecrets(measured.text);
    if (secrets.length > 0) {
      return {
        ok: false,
        refusal: "contains_secrets",
        detail: `${secrets.length} possible real-data match(es): ${secrets.map((s) => s.kind).join(", ")}. Mask them, crop them out, or recapture from a demo account.`,
        measurement,
        secrets,
      };
    }

    const legibility = legibilityVerdict({
      captureWidth: measured.width,
      targetWidthFraction,
      frameWidth,
      fontSizes: measured.fontSizes,
    });
    if (!legibility.ok) {
      return { ok: false, refusal: "illegible", detail: legibility.advice, measurement, legibility };
    }

    const element = await page.$(selector);
    if (!element) return { ok: false, refusal: "selector_not_found", detail: `${selector} vanished before capture`, measurement };

    await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
    await element.screenshot({ path: path.resolve(outputPath) as `${string}.png` });

    const provenance = {
      url,
      selector,
      capturedAt: new Date().toISOString(),
      elementWidth: measured.width,
      elementHeight: measured.height,
      bodyFontPx: legibility.bodyPx ?? null,
      rendersAtPx: legibility.renderedPx ?? null,
      targetWidthFraction,
      frameWidth,
      mustContain,
    };
    await writeFile(`${path.resolve(outputPath)}.json`, `${JSON.stringify(provenance, null, 2)}\n`, "utf8");

    return { ok: true, outputPath: path.resolve(outputPath), measurement, legibility, provenance };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
