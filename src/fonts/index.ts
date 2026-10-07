import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FALLBACK, FAMILIES, KIT_DEFAULT_FAMILIES, PAIRINGS, type FontKind, type Pairing } from "./catalog.js";

export * from "./catalog.js";

/**
 * Fonts at render time: which bundled families a composition uses, and the CSS that loads exactly those.
 *
 * A composition never names a URL. It names families (in its own CSS, or through a pairing on its root,
 * `data-type="editorial"`), and `fontCss` turns that into `@font-face` rules pointing at the bundled files
 * plus the pairing's variables. The render copies only those files into the clip's project; the measure
 * page inlines them. Nothing is fetched from the network.
 */

export interface FontFace {
  style: "normal" | "italic";
  /** "400", or a range for a variable font: "100 900". */
  weight: string;
  /** A width range for a variable width axis: "62% 125%". */
  stretch?: string;
  /** Relative to the fonts directory, e.g. `inter-tight/inter-tight-normal.woff2`. */
  file: string;
  unicodeRange?: string;
}

export interface FontEntry {
  family: string;
  slug: string;
  kind: FontKind;
  caps?: boolean;
  note: string;
  licence: string;
  licenceFile?: string;
  faces: FontFace[];
}

export interface FontManifest {
  version: 1;
  fetchedAt: string;
  subset: string;
  families: FontEntry[];
}

export interface FontLibrary {
  dir: string;
  manifest: FontManifest;
  byFamily: Map<string, FontEntry>;
}

/** Where the bundled fonts live: `skills/reelcut/assets/fonts`. */
export function fontsDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "skills", "reelcut", "assets", "fonts");
}

export function loadFontLibrary(dir = fontsDir()): FontLibrary | undefined {
  const file = path.join(dir, "manifest.json");
  if (!existsSync(file)) return undefined;
  const manifest = JSON.parse(readFileSync(file, "utf8")) as FontManifest;
  return { dir, manifest, byFamily: new Map(manifest.families.map((f) => [f.family, f])) };
}

export function pairingById(id: string | undefined): Pairing | undefined {
  return id ? PAIRINGS.find((p) => p.id === id) : undefined;
}

/** The root element's opening tag. */
function rootTag(html: string): string | undefined {
  return /<[a-z]+[^>]*\bid=["']root["'][^>]*>/i.exec(html)?.[0];
}

/** The pairing a composition asked for on its root, if any. */
export function pairingIn(html: string): Pairing | undefined {
  const root = rootTag(html);
  const id = root ? /\bdata-type\s*=\s*["']([a-z0-9-]+)["']/i.exec(root)?.[1] : undefined;
  return pairingById(id);
}

/** Give a composition the reel's pairing unless it chose its own. Unchanged when it has one, or has no root. */
export function applyDefaultPairing(html: string, id: string | undefined): string {
  if (!id || !pairingById(id)) return html;
  const root = rootTag(html);
  if (!root || /\bdata-type\s*=/.test(root)) return html;
  return html.replace(root, root.replace(/>$/, ` data-type="${id}">`));
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The bundled families a composition uses: its pairing's four, plus any family it names itself in quotes
 * (`font-family: 'Anton'`, `--font-display: "Caveat"`). Without a pairing, the kit's own defaults too, since
 * the looks name them.
 */
export function familiesIn(html: string, lib: FontLibrary): string[] {
  const out = new Set<string>();
  const pairing = pairingIn(html);
  if (pairing) [pairing.head, pairing.body, pairing.accent, pairing.mono].forEach((f) => out.add(f));
  else KIT_DEFAULT_FAMILIES.forEach((f) => out.add(f));
  for (const family of lib.byFamily.keys()) {
    if (new RegExp(`['"]${escapeRe(family)}['"]`).test(html)) out.add(family);
  }
  return [...out].filter((f) => lib.byFamily.has(f));
}

/** Every file a composition needs, relative to the fonts directory. */
export function fontFilesFor(html: string, lib: FontLibrary): string[] {
  return familiesIn(html, lib).flatMap((f) => lib.byFamily.get(f)!.faces.map((face) => face.file));
}

const stack = (family: string): string => {
  const kind = FAMILIES.find((f) => f.family === family)?.kind ?? "sans";
  return `'${family}', ${FALLBACK[kind]}`;
};

/** `@font-face` rules for these families, with `url(file)` for where each file is served from. */
export function fontFaceCss(families: readonly string[], lib: FontLibrary, url: (file: string) => string): string {
  const rules: string[] = [];
  for (const family of families) {
    const entry = lib.byFamily.get(family);
    if (!entry) continue;
    for (const face of entry.faces) {
      rules.push(
        `@font-face { font-family: '${family}'; font-style: ${face.style}; font-weight: ${face.weight};${face.stretch ? ` font-stretch: ${face.stretch};` : ""} font-display: block; src: url("${url(face.file)}") format("woff2");${face.unicodeRange ? ` unicode-range: ${face.unicodeRange};` : ""} }`,
      );
    }
  }
  return rules.join("\n");
}

function hasItalic(family: string): boolean {
  return Boolean(FAMILIES.find((f) => f.family === family)?.italic);
}

/** The variables and headline setting a pairing applies to a composition that chose it. */
export function pairingCss(p: Pairing): string {
  const sel = `[data-look][data-type="${p.id}"]`;
  const vars = [
    `--font-sans: ${stack(p.body)};`,
    `--font-display: ${stack(p.head)};`,
    `--font-serif: ${stack(p.accent)};`,
    `--font-mono: ${stack(p.mono)};`,
    `--display-weight: ${p.headWeight};`,
    `--display-tracking: ${p.headTracking}em;`,
    `--display-case: ${p.headCase ?? "none"};`,
    ...(p.headStretch ? [`--display-stretch: ${p.headStretch}%;`, `--display-wdth: ${p.headStretch};`] : []),
  ].join(" ");
  const head = [
    "font-family: var(--font-display);",
    `font-weight: ${p.headWeight};`,
    `letter-spacing: ${p.headTracking}em;`,
    `text-transform: ${p.headCase ?? "none"};`,
    ...(p.headStretch ? [`font-stretch: ${p.headStretch}%;`] : []),
    ...(p.headLeading ? [`line-height: ${p.headLeading};`] : []),
  ].join(" ");
  // An accent family without italics is set upright: a faked italic is the cheapest-looking thing type can do.
  const upright = hasItalic(p.accent) ? "" : `\n${sel} em.rc, ${sel} .rc-serif { font-style: normal; }`;
  // Against capitals, the accent word keeps its own case: a lowercase italic beside condensed caps is the poster move.
  const accentCase = p.headCase ? `\n${sel} .rc-head em.rc, ${sel} .rc-display em.rc { text-transform: none; }` : "";
  return `${sel} { ${vars} font-family: var(--font-sans); }\n${sel} .rc-head { ${head} }${upright}${accentCase}`;
}

/** Everything a composition needs: its faces, and its pairing if it has one. */
export function fontCss(html: string, lib: FontLibrary, url: (file: string) => string): string {
  const pairing = pairingIn(html);
  return [fontFaceCss(familiesIn(html, lib), lib, url), pairing ? pairingCss(pairing) : ""].filter(Boolean).join("\n");
}

/** A data URL for a font file, for pages that are loaded without a server (the measure page). */
export function fontDataUrl(lib: FontLibrary, file: string): string {
  return `data:font/woff2;base64,${readFileSync(path.join(lib.dir, file)).toString("base64")}`;
}
