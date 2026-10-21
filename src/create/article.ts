/**
 * A blog post or an article as plain text, the page's own words: so a reel written from it quotes it exactly and
 * every figure in it can be traced back to the page. The main text is the page's <article>, else its <main>, else
 * the body without its navigation, header, footer and asides; headings, paragraphs, list items and quotes become
 * Markdown lines. A page behind a login (most social posts) has no text to read: say so, and ask for it pasted.
 */

export interface Article { url: string; title: string; byline?: string; published?: string; description?: string; markdown: string; words: number }

const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const text = (s: string) => decode(s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
const meta = (html: string, key: string) => new RegExp(`<meta\\b[^>]*(?:name|property)\\s*=\\s*["']${key}["'][^>]*content\\s*=\\s*["']([^"']*)["']`, "i").exec(html)?.[1] ?? new RegExp(`<meta\\b[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*(?:name|property)\\s*=\\s*["']${key}["']`, "i").exec(html)?.[1];

/** The longest of the page's <article> blocks, else <main>, else the body without its chrome. */
function mainOf(html: string): string {
  const clean = html.replace(/<(script|style|noscript|template|svg|iframe|form)\b[\s\S]*?<\/\1>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  const pick = (tag: string) => [...clean.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))].map((m) => m[1]!).sort((a, b) => text(b).length - text(a).length)[0];
  const body = pick("article") ?? pick("main") ?? /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(clean)?.[1] ?? clean;
  return body.replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, "");
}

export function articleFrom(url: string, html: string): Article {
  const body = mainOf(html);
  const lines: string[] = [];
  for (const m of body.matchAll(/<(h[1-4]|p|li|blockquote|figcaption|pre)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const t = text(m[2]!);
    if (!t || t.length < 2) continue;
    const tag = m[1]!.toLowerCase();
    lines.push(tag.startsWith("h") ? `${"#".repeat(Math.min(4, Number(tag[1]) + 1))} ${t}` : tag === "li" ? `- ${t}` : tag === "blockquote" ? `> ${t}` : t);
  }
  const deduped = lines.filter((l, i) => l !== lines[i - 1]);
  const title = text(meta(html, "og:title") ?? /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? url);
  const markdown = deduped.join("\n\n");
  const byline = meta(html, "author") ?? meta(html, "article:author");
  const published = meta(html, "article:published_time") ?? /<time\b[^>]*datetime\s*=\s*["']([^"']+)["']/i.exec(html)?.[1];
  const description = meta(html, "og:description") ?? meta(html, "description");
  return { url, title, ...(byline ? { byline: decode(byline) } : {}), ...(published ? { published } : {}), ...(description ? { description: decode(description) } : {}), markdown, words: markdown.split(/\s+/).filter(Boolean).length };
}

export async function readArticle(raw: string, fetchImpl: typeof fetch = fetch): Promise<Article> {
  const url = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  const r = await fetchImpl(url, { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36", accept: "text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  const a = articleFrom(r.url || url, await r.text());
  if (a.words < 60) throw new Error(`${url} has almost no text to read (${a.words} words): it may need a login. Ask the owner to paste the post.`);
  return a;
}

export function articleMarkdown(a: Article): string {
  return [`# ${a.title}`, "", `Source: ${a.url}${a.byline ? ` · ${a.byline}` : ""}${a.published ? ` · ${a.published.slice(0, 10)}` : ""}`, ...(a.description ? ["", `> ${a.description}`] : []), "", a.markdown, ""].join("\n");
}
