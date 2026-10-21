import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let home: string;
beforeEach(() => { home = mkdtempSync(path.join(os.tmpdir(), "rc-starts-")); process.env.REELCUT_HOME = home; });
afterEach(() => { delete process.env.REELCUT_HOME; rmSync(home, { recursive: true, force: true }); });

describe("a personality from a website", () => {
  it("matches the site's main font to the nearest pairing, in the order the site uses them", async () => {
    const { nearestPairing } = await import("../src/create/brandsite.js");
    expect(nearestPairing(["Fraunces", "Inter"]).id).toBe("editorial");
    expect(nearestPairing(["NotionInter", "Permanent Marker"])).toEqual({ id: "swiss", why: "the site's NotionInter is nearest to Swiss (Geist)" });
    expect(nearestPairing(["Bebas Neue"]).id).toBe("poster");
    expect(nearestPairing([]).id).toBe("studio");
  });

  it("finds the site's own logo before the icons, and leaves out a wall of customers' logos and photos", async () => {
    const { logosIn } = await import("../src/create/brandsite.js");
    const svg = `<svg viewBox="0 0 60 25" aria-label="Acme logo"><path d="${"M0 0h10v10H0z".repeat(20)}"/></svg>`;
    const filler = "<p>words</p>".repeat(4000);
    const html = `<html><head><link rel="apple-touch-icon" href="/touch.png"><link rel="icon" href="/favicon.ico"><meta property="og:image" content="https://cdn.acme.com/og.jpg"></head>
      <body><header><a href="/">${svg}</a></header>${filler}<img src="/customers/bigco-logo.png" alt="BigCo logo"><img src="/hero.jpg" width="2460" alt="${"A long photo description that mentions the Acme logo shape in a street ".repeat(2)}"></body></html>`;
    const ls = logosIn(html, "https://acme.com/");
    expect(ls.map((l) => l.kind)).toEqual(["inline", "touch-icon", "og", "icon", "img"]);
    expect(ls[0]!.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(ls.at(-1)!.url).toBe("https://acme.com/customers/bigco-logo.png");
    expect(ls.some((l) => l.url.includes("hero"))).toBe(false);
  });

  it("drafts a personality in the brand's colours and type, never the default, with its logo saved", async () => {
    const { draftFromSite } = await import("../src/create/brandsite.js");
    const pages: Record<string, { body: string; type: string }> = {
      "https://acme.com/": { type: "text/html", body: `<html><head><title>Acme | Rockets</title><meta name="theme-color" content="#ff5a1f"><link rel="stylesheet" href="/a.css"><link rel="apple-touch-icon" href="/touch.png"></head><body></body></html>` },
      "https://acme.com/a.css": { type: "text/css", body: `:root{--brand:#ff5a1f;--accent:#1f6bff} body{font-family:"Playfair Display",serif;background:#fff;color:#111} a{color:#1f6bff}` },
      "https://acme.com/touch.png": { type: "image/png", body: "x".repeat(400) },
    };
    const fake = (async (u: string | URL) => { const p = pages[String(u)]; return new Response(p?.body ?? "", { status: p ? 200 : 404, headers: { "content-type": p?.type ?? "text/plain" } }); }) as typeof fetch;
    const { savePersonality, defaultPersonality } = await import("../src/personality/store.js");
    savePersonality({ name: "Mine", isDefault: true, styles: [{ id: "swiss", weight: 60 }, { id: "ui-product", weight: 40 }] } as never);
    const d = await draftFromSite("acme.com", fake);
    // A copy of the owner's default, in the brand's colours and type; the default stays theirs.
    expect(d.personality).toMatchObject({ name: "Acme", isDefault: false, styles: [{ id: "swiss", weight: 60 }, { id: "ui-product", weight: 40 }], brand: { url: "https://acme.com/", logo: "https://acme.com/touch.png" } });
    expect(defaultPersonality()!.name).toBe("Mine");
    expect(d.pairing.id).toBe("editorial");
    expect(Object.values(d.personality.fonts)).toEqual(["editorial", "editorial"]);
    expect(d.brand.colors.slice(0, 2)).toEqual(["#ff5a1f", "#1f6bff"]);
    expect(Object.values(d.personality.palettes)[0]!.accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(readFileSync(d.logo!.file, "utf8")).toHaveLength(400);
  });
});

describe("moments of a long video", () => {
  const w = (text: string, a: number, b: number) => ({ w: text, a, b, p: 0.9 });
  const tr = { model: "small", seconds: 1, via: "test", segments: [
    { a: 1.6, b: 3.4, text: "Today we talk about launches.", conf: 0.9, words: [w("Today", 1.6, 1.9), w("we", 1.9, 2.0), w("talk", 2.0, 2.3), w("about", 2.3, 2.6), w("launches.", 2.6, 3.4)] },
    { a: 3.4, b: 5.4, text: "Here is the thing.", conf: 0.9, words: [w("Here", 3.5, 3.7), w("is", 3.7, 3.8), w("the", 3.8, 3.9), w("thing.", 3.9, 4.6)] },
    { a: 5.4, b: 8.4, text: "71,000 signed up.", conf: 0.9, words: [w("71,000", 5.5, 6.4), w("signed", 6.5, 6.9), w("up.", 6.9, 7.3)] },
    { a: 12.4, b: 13.8, text: "That is all.", conf: 0.9, words: [w("That", 12.4, 12.7), w("is", 12.7, 12.8), w("all.", 12.8, 13.4)] },
  ] };
  it("cuts on word edges, never into a neighbouring word, with the spoken words as the script", async () => {
    const { cutPoints } = await import("../src/create/moments.js");
    const c = cutPoints(tr as never, 3.3, 8.4);
    expect(c).toEqual({ from: 3.4, to: 7.55, seconds: 4.15, script: "Here is the thing.\n71,000 signed up.", words: 7 });
    expect(() => cutPoints(tr as never, 8.5, 12)).toThrow(/nothing is said/);
  });
});

describe("a blog post or article", () => {
  it("keeps the page's own words, without its navigation, scripts or footer, and refuses a page with no text", async () => {
    const { articleFrom, readArticle, articleMarkdown } = await import("../src/create/article.js");
    const html = `<html><head><title>Site</title><meta property="og:title" content="We grew to 71.000 users"><meta name="author" content="Sam"><meta property="article:published_time" content="2026-09-01T10:00:00Z"></head>
      <body><nav><p>Home · Blog</p></nav><header><p>Sign up</p></header><main><article><h1>We grew to 71.000 users</h1><p>It took us <b>one</b> week &amp; no ads.</p><script>track()</script><ul><li>No ads</li><li>One video</li></ul><blockquote>Ship small.</blockquote></article></main><footer><p>© 2026</p></footer></body></html>`;
    const a = articleFrom("https://blog.example/grew", html);
    expect(a).toMatchObject({ title: "We grew to 71.000 users", byline: "Sam", published: "2026-09-01T10:00:00Z" });
    expect(a.markdown).toBe("## We grew to 71.000 users\n\nIt took us one week & no ads.\n\n- No ads\n\n- One video\n\n> Ship small.");
    expect(articleMarkdown(a)).toContain("Source: https://blog.example/grew · Sam · 2026-09-01");
    const fake = (async () => new Response("<html><body><p>Log in to see this post</p></body></html>", { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    await expect(readArticle("linkedin.com/posts/x", fake)).rejects.toThrow(/may need a login/);
  });
});
