import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PAIRINGS } from "../fonts/catalog.js";
import { reelcutHome } from "../library/store.js";
import { importBrand, type BrandFound } from "../personality/brand.js";
import { defaultPersonality, savePersonality } from "../personality/store.js";
import { styleById } from "../personality/styles.js";
import { brandPalette } from "../personality/suggest.js";
import type { Personality } from "../personality/schema.js";

/**
 * A personality from a website, in one go: the brand import the Personality wizard already has (colours, type, name),
 * each chosen style's scheme adapted from the brand's colours, the type matched to the nearest bundled pairing, and
 * the logo downloaded. The logo goes to the library's Review like anything dropped in, never straight in as a brand
 * mark. The draft is a copy of the default personality (its styles, motion and voice) in the brand's colours and
 * type, named after the site and never made the default: the owner opens it in the wizard and adjusts.
 */

const NEAR: [RegExp, string][] = [
  [/bodoni|didot|cormorant|canela|ogg/i, "luxe"],
  [/georgia|times|garamond|playfair|merriweather|lora|baskerville|tiempos|freight|caslon|fraunces|source serif|pt serif|newsreader/i, "editorial"],
  [/oswald|bebas|anton|league gothic|barlow condensed|impact|druk/i, "poster"],
  [/fredoka|nunito(?! sans)|quicksand|comfortaa|baloo|varela round/i, "friendly"],
  [/space grotesk|jetbrains|ibm plex mono|space mono|fira code|roboto mono/i, "tech"],
  [/archivo black|anybody|monument/i, "brutal"],
  [/unbounded|syne|clash|outfit|krona/i, "expressive"],
  [/bricolage|cabinet|general sans|satoshi/i, "crafted"],
  [/poppins|montserrat|plus jakarta|dm sans|manrope|nunito sans|work sans|avenir|circular|gilroy|lexend|figtree|rubik/i, "startup"],
  [/helvetica|arial|sf pro|roboto|inter|geist|söhne|sohne|neue|ibm plex sans|open sans|segoe|public sans/i, "swiss"],
];
/** The nearest bundled pairing: one that uses the site's font, else the one its kind of type is nearest to. */
export function nearestPairing(fonts: readonly string[]): { id: string; why: string } {
  // The site's fonts in the order it uses them: its main face decides, a decorative one further down does not.
  for (const f of fonts) {
    const exact = PAIRINGS.find((p) => [p.head, p.body].some((x) => x.toLowerCase() === f.toLowerCase()));
    if (exact) return { id: exact.id, why: `the site uses ${f}, which the ${exact.name} pairing has` };
    const near = NEAR.find(([re]) => re.test(f));
    if (near) { const p = PAIRINGS.find((x) => x.id === near[1])!; return { id: p.id, why: `the site's ${f} is nearest to ${p.name} (${p.head})` }; }
  }
  return { id: "studio", why: fonts.length ? `none of ${fonts.join(", ")} is close to a bundled pairing, so the neutral Studio` : "the site names no font, so the neutral Studio" };
}

export interface LogoCandidate { url: string; kind: "inline" | "svg" | "img" | "touch-icon" | "icon" | "og"; /** An inline SVG's markup. */ svg?: string }
/** Logo candidates, best first: an image or SVG marked as the logo, then the touch icon, an SVG icon, the Open Graph image, the icon. */
export function logosIn(html: string, base: string): LogoCandidate[] {
  const abs = (u: string) => { try { return new URL(u.replace(/&amp;/g, "&"), base).href; } catch { return undefined; } };
  const out: LogoCandidate[] = [];
  const push = (u: string | undefined, kind: LogoCandidate["kind"]) => { const a = u && abs(u); if (a && /^https?:/.test(a) && !out.some((o) => o.url === a)) out.push({ url: a, kind }); };
  // An image marked as a logo counts as the site's own when it is near the top of the page or named after the site;
  // further down it is usually a customer's, on a wall of logos, and comes after the icons.
  const stem = new URL(base).hostname.replace(/^www\./, "").split(".")[0]!.toLowerCase();
  // A logo drawn inline near the top (in the header, or labelled as the logo or the site) is the site's own mark.
  const top = html.slice(0, Math.max(20_000, Math.round(html.length * 0.12)));
  for (const m of top.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)) {
    const open = /<svg\b[^>]*>/i.exec(m[0])![0], before = top.slice(Math.max(0, (m.index ?? 0) - 300), m.index);
    const named = new RegExp(`logo|${stem}`, "i").test(open) || /<a\b[^>]*href\s*=\s*["'](\/|https?:\/\/[^"']*\/?)["'][^>]*>\s*$/i.test(before) || /logo/i.test(before.slice(-120));
    if (named && m[0].length > 200 && m[0].length < 60_000 && !out.some((o) => o.kind === "inline")) out.push({ url: `${base}#logo`, kind: "inline", svg: m[0].includes("xmlns") ? m[0] : m[0].replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"') });
  }
  // A photo that merely mentions a logo in its description is not one.
  const marked = [...html.matchAll(/<img\b[^>]*>/gi)].filter((m) => /logo/i.test(m[0]) && !(Number(/\bwidth\s*=\s*["']?(\d+)/i.exec(m[0])?.[1] ?? 0) > 1200) && ((/\balt\s*=\s*["']([^"']*)["']/i.exec(m[0])?.[1] ?? "").length <= 80)).map((m) => ({ tag: m[0], own: m[0].toLowerCase().includes(stem) || (m.index ?? 0) < html.length * 0.12 }));
  const img = (t: string) => push(/\bsrc\s*=\s*["']([^"']+)["']/i.exec(t)?.[1], /\.svg(\?|["'\s]|$)/i.test(t) ? "svg" : "img");
  for (const m of marked.filter((x) => x.own)) img(m.tag);
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => ({ rel: /\brel\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1] ?? "", href: /\bhref\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1] }));
  for (const l of links) if (/apple-touch-icon/i.test(l.rel)) push(l.href, "touch-icon");
  for (const l of links) if (/\bicon\b/i.test(l.rel) && /\.svg(\?|$)/i.test(l.href ?? "")) push(l.href, "svg");
  push(/<meta\b[^>]*property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']+)["']/i.exec(html)?.[1] ?? /<meta\b[^>]*content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:image["']/i.exec(html)?.[1], "og");
  for (const l of links) if (/\bicon\b/i.test(l.rel)) push(l.href, "icon");
  for (const m of marked.filter((x) => !x.own).slice(0, 2)) img(m.tag);
  return out.slice(0, 6);
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
/** Downloads the first candidate that really is an image (100 B to 2 MB), into the studio's home. */
export async function fetchLogo(candidates: readonly LogoCandidate[], host: string, fetchImpl: typeof fetch = fetch): Promise<{ file: string; url: string } | undefined> {
  const dir = path.join(reelcutHome(), "create", "brand-sites", host.replace(/[^a-z0-9.-]/gi, "_"));
  for (const l of candidates) {
    if (l.kind === "inline" && l.svg) { mkdirSync(dir, { recursive: true }); const file = path.join(dir, "logo.svg"); writeFileSync(file, l.svg); return { file, url: l.url }; }
    try {
      const r = await fetchImpl(l.url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) });
      const type = r.headers.get("content-type") ?? "";
      const ext = /svg/.test(type) || (/\.svg(\?|$)/i.test(l.url) && !/html/.test(type)) ? ".svg" : /png/.test(type) ? ".png" : /jpe?g/.test(type) ? ".jpg" : /webp/.test(type) ? ".webp" : undefined;
      if (!r.ok || !ext) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 2 << 20 || buf.length < 100) continue;
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `logo${ext}`);
      writeFileSync(file, buf);
      return { file, url: l.url };
    } catch { /* the next one */ }
  }
  return undefined;
}

export interface SiteDraft { personality: Personality; brand: BrandFound; pairing: { id: string; why: string }; logos: LogoCandidate[]; logo?: { file: string; url: string } }

/** Reads the site and saves the draft personality; the caller sends the logo file to the library's Review. */
export async function draftFromSite(url: string, fetchImpl: typeof fetch = fetch): Promise<SiteDraft> {
  const page = new URL(/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
  const html = await (await fetchImpl(page.href, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) })).text().catch(() => "");
  const brand = await importBrand(page.href, fetchImpl);
  const logos = logosIn(html, page.href);
  if (brand.logo && !logos.some((l) => l.url === brand.logo)) logos.push({ url: brand.logo, kind: "icon" });
  const pairing = nearestPairing(brand.fonts);
  const base = defaultPersonality();
  const styles = base?.styles.length ? base.styles : [{ id: "ui-product", weight: 100 }];
  const palettes = Object.fromEntries(styles.flatMap((s) => { const st = styleById(s.id); const pal = st && brand.colors.length ? brandPalette(st, brand.colors) : undefined; return pal ? [[s.id, pal]] : base?.palettes[s.id] ? [[s.id, base.palettes[s.id]]] : []; }));
  const logo = await fetchLogo(logos, page.hostname, fetchImpl);
  const { id: _i, createdAt: _c, updatedAt: _u, isDefault: _d, ...rest } = (base ?? {}) as Partial<Personality>;
  const personality = savePersonality({
    ...(rest as object),
    name: (brand.name || page.hostname).slice(0, 60),
    isDefault: false,
    styles,
    palettes,
    fonts: Object.fromEntries(styles.map((s) => [s.id, pairing.id])),
    brand: { name: brand.name.slice(0, 60), url: brand.url, colors: brand.colors.slice(0, 8), fonts: brand.fonts.slice(0, 6), logo: logo?.url ?? brand.logo ?? "" },
  } as never);
  return { personality, brand, pairing, logos, ...(logo ? { logo } : {}) };
}
