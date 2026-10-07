import { toHex, toOklch } from "./color.js";

/**
 * Brand import: read a website and pull out what makes it the brand — its theme colour, its most-used saturated
 * colours, its type families, its name and an icon. A suggestion only: the owner confirms every value in the wizard.
 */
export interface BrandFound { name: string; colors: string[]; fonts: string[]; logo: string; url: string }

const HEX = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi;
const RGB = /rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/gi;
const GENERIC = new Set(["sans-serif", "serif", "monospace", "system-ui", "inherit", "initial", "-apple-system", "blinkmacsystemfont", "ui-sans-serif", "ui-monospace", "ui-serif", "arial", "helvetica", "helvetica neue", "segoe ui", "roboto", "times new roman", "apple color emoji", "segoe ui emoji", "noto color emoji", "var"]);

function norm(hex: string): string {
  const h = hex.toLowerCase();
  return h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h;
}

/** Colours by how often they appear, saturated ones only (greys and near-white/black say nothing about a brand). */
export function brandColors(css: string, theme?: string): string[] {
  const count = new Map<string, number>();
  const bump = (h: string, n = 1) => count.set(h, (count.get(h) ?? 0) + n);
  for (const m of css.matchAll(HEX)) bump(norm(m[0]));
  for (const m of css.matchAll(RGB)) bump(toHex([Number(m[1]), Number(m[2]), Number(m[3])]));
  if (theme && /^#[0-9a-f]{3,6}$/i.test(theme)) bump(norm(theme), 50);
  const picked: string[] = [];
  for (const [h] of [...count.entries()].sort((a, b) => b[1] - a[1])) {
    const o = toOklch(h);
    if (o.c < 0.05 || o.l > 0.97 || o.l < 0.12) continue;
    // Skip near-duplicates of a colour already picked.
    if (picked.some((p) => { const q = toOklch(p); return Math.abs(q.l - o.l) < 0.06 && Math.abs(q.c - o.c) < 0.04 && Math.min(Math.abs(q.h - o.h), 360 - Math.abs(q.h - o.h)) < 14; })) continue;
    picked.push(h);
    if (picked.length === 5) break;
  }
  return picked;
}

export function brandFonts(text: string): string[] {
  const out: string[] = [];
  const add = (f: string) => { const n = f.trim().replace(/^['"]|['"]$/g, "").replace(/\+/g, " "); if (n && !GENERIC.has(n.toLowerCase()) && !/^var\(|^--/.test(n) && !out.includes(n)) out.push(n); };
  for (const m of text.matchAll(/fonts\.googleapis\.com\/css2?\?([^"' )]+)/g)) for (const fam of m[1]!.matchAll(/family=([^:&;]+)/g)) add(decodeURIComponent(fam[1]!));
  for (const m of text.matchAll(/font-family\s*:\s*([^;}]+)/gi)) add(m[1]!.split(",")[0]!);
  return out.slice(0, 6);
}

const attr = (html: string, re: RegExp): string | undefined => re.exec(html)?.[1];

export async function importBrand(url: string, fetchImpl: typeof fetch = fetch): Promise<BrandFound> {
  const page = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  const get = async (u: string) => { const r = await fetchImpl(u, { headers: { "user-agent": "reelcut-brand-import/1.0" }, signal: AbortSignal.timeout(8000) }); return r.ok ? r.text() : ""; };
  const html = await get(page.href);
  if (!html) throw new Error(`could not read ${page.href}`);
  const sheets = [...html.matchAll(/<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi)].map((m) => attr(m[0], /href=["']([^"']+)["']/i)).filter((h): h is string => !!h).slice(0, 3);
  const css = [html, ...(await Promise.all(sheets.map((h) => get(new URL(h, page).href).catch(() => ""))))].join("\n").slice(0, 2_000_000);
  const theme = attr(html, /<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i) ?? attr(html, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']theme-color["']/i);
  const name = attr(html, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i) ?? attr(html, /<title>([^<|–-]+)/i)?.trim() ?? page.hostname;
  const icon = attr(html, /<link[^>]+rel=["'](?:apple-touch-icon|icon|shortcut icon)["'][^>]+href=["']([^"']+)["']/i) ?? attr(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  return { name: name.slice(0, 60), colors: brandColors(css, theme), fonts: brandFonts(css), logo: icon ? new URL(icon, page).href : "", url: page.href };
}
