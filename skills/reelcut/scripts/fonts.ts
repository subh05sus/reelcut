import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { resolveBrowser } from "../../../src/capture/capture.js";
import {
  FAMILIES,
  FONT_KINDS,
  PAIRINGS,
  fontDataUrl,
  fontFaceCss,
  fontsDir,
  loadFontLibrary,
  pairingCss,
  slugOf,
  type FamilySpec,
  type FontEntry,
  type FontFace,
  type FontManifest,
} from "../../../src/fonts/index.js";

/**
 * The bundled type library.
 *
 *   npm run fonts -- list [--kind display] [--json]      the families, by kind
 *   npm run fonts -- pairings [--json]                   the pairings Step 0 offers
 *   npm run fonts -- sheet [--out out/fonts.png] [--pairings swiss,poster,editorial] [--text "…"]
 *                                                        a specimen of pairings (or --families) to show the user
 *   npm run fonts -- check                               every family renders ä ö ü ß „ “ € with its own glyphs
 *   npm run fonts -- fetch [--only "Anton,Caveat"]       (maintainers) download the families from Google Fonts
 *
 * A composition uses a pairing with `data-type="<id>"` on its root (or reel.json's `"type"` for every beat),
 * and any bundled family by name in its CSS. Only the fonts a clip uses are loaded into it. See references/kit.md.
 */

const GERMAN = "Größer, schöner, übermorgen. „Äpfel“ für 12 € – ÄÖÜ äöüß";

function flag(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

// ---------------------------------------------------------------- fetch (maintainers)

interface GfFamily {
  family: string;
  axes?: { tag: string; min: number; max: number }[];
  fonts: Record<string, unknown>;
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const KEEP_AXES = ["opsz", "wdth", "wght"];

/** The css2 query for one family: its variable axes as ranges, or up to four static weights. */
function query(spec: FamilySpec, meta: GfFamily): string {
  const name = spec.family.replace(/ /g, "+");
  const axes = (meta.axes ?? []).filter((a) => KEEP_AXES.includes(a.tag)).sort((a, b) => a.tag.localeCompare(b.tag));
  const variants = Object.keys(meta.fonts);
  const italic = spec.italic && variants.some((v) => v.endsWith("i"));
  if (axes.length) {
    const ranges = axes.map((a) => `${a.min}..${a.max}`).join(",");
    const tags = axes.map((a) => a.tag).join(",");
    return italic ? `${name}:ital,${tags}@0,${ranges};1,${ranges}` : `${name}:${tags}@${ranges}`;
  }
  const weights = [...new Set(variants.filter((v) => /^\d+$/.test(v)).map(Number))].filter((w) => w >= 300).sort((a, b) => a - b);
  const pick = weights.length <= 4 ? weights : [weights[0]!, 400, 700, weights[weights.length - 1]!].filter((w, i, a) => weights.includes(w) && a.indexOf(w) === i);
  if (pick.length <= 1 && !italic) return name;
  const ital = italic ? variants.filter((v) => v.endsWith("i")).map((v) => Number(v.slice(0, -1) || 400)) : [];
  const pairs = [...pick.map((w) => `0,${w}`), ...pick.filter((w) => ital.includes(w)).map((w) => `1,${w}`)];
  return `${name}:ital,wght@${pairs.join(";")}`;
}

async function licenceFor(family: string): Promise<{ text: string; name: string } | undefined> {
  const dir = family.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const [folder, name, file] of [["ofl", "SIL OFL 1.1", "OFL.txt"], ["apache", "Apache 2.0", "LICENSE.txt"], ["ufl", "Ubuntu Font Licence", "UFL.txt"]] as const) {
    const res = await fetch(`https://raw.githubusercontent.com/google/fonts/main/${folder}/${dir}/${file}`);
    if (res.ok) return { text: await res.text(), name };
  }
  return undefined;
}

async function fetchFonts(argv: string[]): Promise<void> {
  const only = flag(argv, "--only")?.split(",").map((s) => s.trim());
  const dir = fontsDir();
  const metaRes = await fetch("https://fonts.google.com/metadata/fonts");
  const metaText = await metaRes.text();
  const meta = JSON.parse(metaText.slice(metaText.indexOf("{"))) as { familyMetadataList: GfFamily[] };
  const byName = new Map(meta.familyMetadataList.map((f) => [f.family, f]));
  const previous = loadFontLibrary(dir);
  const entries: FontEntry[] = [];

  for (const spec of FAMILIES) {
    if (only && !only.includes(spec.family)) {
      const kept = previous?.byFamily.get(spec.family);
      if (kept) entries.push(kept);
      continue;
    }
    const m = byName.get(spec.family);
    if (!m) throw new Error(`${spec.family} is not on Google Fonts`);
    const slug = slugOf(spec.family);
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${query(spec, m)}&display=block`, { headers: { "User-Agent": UA } })).text();
    if (!css.includes("@font-face")) throw new Error(`${spec.family}: Google Fonts answered ${css.slice(0, 200)}`);
    rmSync(path.join(dir, slug), { recursive: true, force: true });
    mkdirSync(path.join(dir, slug), { recursive: true });
    const faces: FontFace[] = [];
    // Each block is preceded by its subset's name; only Latin is kept (it covers German entirely).
    for (const block of css.matchAll(/\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*{([^}]*)}/g)) {
      if (block[1] !== "latin") continue;
      const body = block[2]!;
      const style = /font-style:\s*(\w+)/.exec(body)?.[1] === "italic" ? "italic" : "normal";
      const weight = /font-weight:\s*([\d ]+);/.exec(body)?.[1]?.trim() ?? "400";
      const stretch = /font-stretch:\s*([\d.% ]+);/.exec(body)?.[1]?.trim();
      const src = /url\((https:[^)]+\.woff2)\)/.exec(body)?.[1];
      const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim();
      if (!src) continue;
      const file = `${slug}/${slug}-${style}${weight.includes(" ") ? "" : `-${weight}`}.woff2`;
      const bytes = Buffer.from(await (await fetch(src)).arrayBuffer());
      writeFileSync(path.join(dir, file), bytes);
      faces.push({ style, weight, ...(stretch ? { stretch } : {}), file, ...(range ? { unicodeRange: range } : {}) });
    }
    if (faces.length === 0) throw new Error(`${spec.family}: no Latin faces in the answer`);
    const licence = await licenceFor(spec.family);
    if (licence) writeFileSync(path.join(dir, slug, "LICENSE.txt"), licence.text);
    entries.push({ family: spec.family, slug, kind: spec.kind, ...(spec.caps ? { caps: true } : {}), note: spec.note, licence: licence?.name ?? "see Google Fonts", ...(licence ? { licenceFile: `${slug}/LICENSE.txt` } : {}), faces });
    console.log(`  ${spec.family.padEnd(22)} ${faces.length} face(s)${licence ? `  ${licence.name}` : "  (licence not found)"}`);
  }
  const manifest: FontManifest = { version: 1, fetchedAt: new Date().toISOString(), subset: "latin", families: entries };
  writeFileSync(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${entries.length} families in ${dir}`);
}

// ---------------------------------------------------------------- list, pairings

function requireLib() {
  const lib = loadFontLibrary();
  if (!lib) throw new Error("no fonts bundled: run `npm run fonts -- fetch`");
  return lib;
}

function list(argv: string[]): void {
  const lib = requireLib();
  const kind = flag(argv, "--kind");
  if (kind && !(FONT_KINDS as readonly string[]).includes(kind)) throw new Error(`--kind ${FONT_KINDS.join("|")}`);
  const fams = lib.manifest.families.filter((f) => !kind || f.kind === kind);
  if (argv.includes("--json")) return void console.log(JSON.stringify(fams.map(({ faces, ...f }) => ({ ...f, styles: [...new Set(faces.map((x) => x.style))], weights: [...new Set(faces.map((x) => x.weight))] })), null, 2));
  for (const k of FONT_KINDS) {
    const group = fams.filter((f) => f.kind === k);
    if (!group.length) continue;
    console.log(`${k}`);
    for (const f of group) console.log(`  ${f.family.padEnd(22)} ${[...new Set(f.faces.map((x) => x.weight))].join(", ").padEnd(14)} ${f.faces.some((x) => x.style === "italic") ? "italic " : "       "}${f.caps ? "caps " : ""}${f.note}`);
  }
}

function pairings(argv: string[]): void {
  if (argv.includes("--json")) return void console.log(JSON.stringify(PAIRINGS, null, 2));
  for (const p of PAIRINGS) console.log(`  ${p.id.padEnd(11)} ${p.name.padEnd(11)} ${p.head} / ${p.body} / ${p.accent} / ${p.mono}\n${" ".repeat(26)}${p.mood}`);
}

// ---------------------------------------------------------------- sheet and check (in Chrome)

async function withPage<T>(html: string, size: { width: number; height: number }, fn: (page: import("puppeteer-core").Page) => Promise<T>): Promise<T> {
  const browser = await puppeteer.launch({ executablePath: resolveBrowser(), headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ ...size, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate("document.fonts.ready");
    return await fn(page);
  } finally {
    await browser.close();
  }
}

async function sheet(argv: string[]): Promise<void> {
  const lib = requireLib();
  const base = process.env.INIT_CWD ?? process.cwd();
  const out = path.resolve(base, flag(argv, "--out") ?? path.join("out", "fonts.png"));
  const text = flag(argv, "--text") ?? "Größere Ideen für übermorgen";
  const wantPairings = flag(argv, "--pairings")?.split(",").map((s) => s.trim());
  const wantFamilies = flag(argv, "--families")?.split(",").map((s) => s.trim());
  const url = (file: string) => fontDataUrl(lib, file);
  let body: string;
  let families: string[];
  if (wantFamilies) {
    families = wantFamilies.filter((f) => lib.byFamily.has(f));
    body = families.map((f) => `<div class="fam"><b>${f}</b><span style="font-family:'${f}'">${text}</span></div>`).join("");
  } else {
    const chosen = PAIRINGS.filter((p) => !wantPairings || wantPairings.includes(p.id));
    families = [...new Set(chosen.flatMap((p) => [p.head, p.body, p.accent, p.mono]))];
    body = chosen.map((p) => `<div class="pair" data-look data-type="${p.id}"><small>${p.id} · ${p.head} / ${p.body} / ${p.accent}</small><div class="rc-head">${text.replace(/(\S+)$/, '<em class="rc">$1</em>')}</div><p>${p.mood}. ${GERMAN}</p><code>${p.mono}: 0123456789 → npm run render</code></div>`).join("");
  }
  const cols = wantFamilies ? 1 : Math.min(3, Math.max(1, (wantPairings?.length ?? PAIRINGS.length) >= 3 ? 3 : wantPairings?.length ?? 1));
  const html = `<!doctype html><meta charset="utf-8"><style>${fontFaceCss(families, lib, url)}
${PAIRINGS.map(pairingCss).join("\n")}
body{margin:0;padding:32px;background:#f4f1ea;color:#141414;font:15px system-ui;display:grid;grid-template-columns:repeat(${cols},1fr);gap:20px;width:${cols * 520}px}
.pair{background:#fff;border-radius:16px;padding:24px;box-shadow:0 1px 0 rgba(0,0,0,.06)}
.pair small{font:600 12px ui-monospace,monospace;color:#777}
.pair .rc-head{font-size:46px;line-height:1.02;margin:12px 0 10px}
.pair em.rc{font-family:var(--font-serif);font-style:italic;font-weight:400;color:#d4532b}
.pair p{font-family:var(--font-sans);margin:0 0 10px;color:#444;line-height:1.35}
.pair code{font-family:var(--font-mono);font-size:13px;color:#555}
.fam{display:grid;grid-template-columns:200px 1fr;align-items:baseline;gap:16px;padding:8px 0;border-bottom:1px solid #e3ded4}
.fam b{font:600 13px system-ui;color:#666}.fam span{font-size:34px}</style><body>${body}</body>`;
  await withPage(html, { width: cols * 520 + 64, height: 800 }, async (page) => {
    mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out as `${string}.png`, fullPage: true });
  });
  console.log(out);
}

/**
 * Does each family draw German with its own glyphs? A character a family lacks falls back to the next font in the
 * stack, so it measures the same against two very different fallbacks only when the family itself drew it.
 */
async function check(): Promise<void> {
  const lib = requireLib();
  const chars = [..."ÄÖÜäöüß„“€–"];
  const families = lib.manifest.families.map((f) => f.family);
  const html = `<!doctype html><meta charset="utf-8"><style>${fontFaceCss(families, lib, (f) => fontDataUrl(lib, f))}</style><body>${families.map((f) => `<span style="font-family:'${f}'">x</span>`).join("")}</body>`;
  // As a string: tsx compiles functions with helpers that do not exist inside the page.
  const probe = `(async () => {
    const fams = ${JSON.stringify(families)}, cs = ${JSON.stringify(chars)};
    await Promise.all(fams.map((f) => document.fonts.load("32px '" + f + "'")));
    const ctx = document.createElement("canvas").getContext("2d");
    const width = (font, ch) => { ctx.font = font; return ctx.measureText(ch).width; };
    const out = {};
    for (const f of fams) {
      const lacks = cs.filter((ch) => Math.abs(width("32px '" + f + "', monospace", ch) - width("32px '" + f + "', serif", ch)) > 0.01);
      if (lacks.length) out[f] = lacks;
    }
    return out;
  })()`;
  const missing = await withPage(html, { width: 800, height: 600 }, (page) => page.evaluate(probe) as Promise<Record<string, string[]>>);
  for (const f of families) console.log(`  ${missing[f] ? "✗" : "✓"} ${f}${missing[f] ? `  lacks ${missing[f]!.join(" ")}` : ""}`);
  const n = Object.keys(missing).length;
  console.log(n ? `${n} famil${n === 1 ? "y lacks" : "ies lack"} German characters` : `All ${families.length} families draw German with their own glyphs.`);
  if (n) process.exitCode = 1;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "list":
      return list(rest);
    case "pairings":
      return pairings(rest);
    case "sheet":
      return sheet(rest);
    case "check":
      return check();
    case "fetch":
      return fetchFonts(rest);
    default:
      console.error("usage: fonts list|pairings|sheet|check|fetch (see the header of scripts/fonts.ts)");
      process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
