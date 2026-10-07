import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { contrast, parseHex } from "../personality/color.js";
import { getPersonality, defaultPersonality } from "../personality/store.js";
import { STYLES, type StyleId } from "../personality/styles.js";
import { addAsset } from "../library/store.js";

/**
 * Assets Claude draws: when the library has nothing for a generic requirement (an icon, an illustration, an object, a
 * background shape), Claude draws it as SVG in the personality's style. Free, sharp at any size, editable, and in the
 * owner's colours. An SVG is checked before it is kept: nothing that runs or fetches, a viewBox, a sane size, and
 * colours from the personality's scheme. It goes into the library as `drawn` and pending, so the owner approves it
 * before other reels reuse it. Never for identity: a drawn logo is a fabricated logo.
 */

/** How each style draws, for the prompt and the reference. */
export const DRAWING: Record<StyleId, string> = {
  "paper-cutout": "flat paper shapes in 2–4 layers, each with a soft offset shadow (a darker copy shifted 4–8 units), slightly irregular edges, no strokes",
  claymation: "soft rounded blobs with radial gradients for volume (light top-left), a contact shadow ellipse below, thick rounded forms, no thin lines",
  "stop-motion": "chunky physical objects with flat fills and a hard shadow, slightly imperfect geometry, as if cut from card or felt",
  "hand-drawn": "a single-weight rough ink outline (stroke 3–5, round caps and joins), slightly wobbly paths, sparse flat fills offset from the outline",
  "flat-vector": "clean geometric shapes, flat fills from the scheme, no strokes or gradients, consistent corner radii",
  linear: "hairline strokes only (1.5–2 units), no fills, round caps, generous negative space, one accent stroke",
  "kinetic-type": "bold typographic shapes and simple geometric marks; the drawing supports type, so keep it a glyph-like symbol",
  editorial: "refined line illustration with a little cross-hatching or stipple for shade, restrained, one accent colour",
  collage: "cut-out pieces with torn or straight edges, a halftone-like dot pattern on one piece, tape strips, mixed scale",
  brutalist: "heavy black outlines (stroke 6+), raw rectangles, no rounding, one loud flat colour, deliberately blunt",
  swiss: "strict geometry on a grid: circles, squares, bars; flat fills; one red-ish accent; nothing decorative",
  minimal: "the fewest shapes that read: one or two forms, flat, lots of space, a single accent",
  "3d": "simple solids with three-tone shading (light, mid, dark faces) and a soft ground shadow, like a clean render",
  isometric: "isometric projection (30°), three flat face tones per object, crisp edges, no perspective",
  liquid: "smooth organic blobs with gentle gradients, no corners, shapes that look mid-flow",
  "ink-paint": "brush-like shapes: tapered strokes with varying width, a few splatter dots, ink on paper",
  "ui-product": "interface-like components: rounded rectangles (radius 12–20), toggles, cards, icons on a 24-unit grid, flat fills, subtle shadow",
  "retro-vhs": "80s geometry: sunset stripes, chrome-ish gradients, grid floors, bold outlines, warm neon accents",
  glitch: "sharp blocky shapes with offset colour channels (a red and a cyan copy shifted 3–6 units), scanline bars",
  cinematic: "silhouettes and strong light: dark shapes against a lit gradient, a glow, minimal detail",
};

export interface SvgCheck { ok: boolean; errors: string[]; warnings: string[]; colours: string[] }

const FORBIDDEN: [RegExp, string][] = [
  [/<script\b/i, "a <script> element"], [/<foreignObject\b/i, "a <foreignObject> element"], [/\son[a-z]+\s*=/i, "an event handler attribute"],
  [/javascript:/i, "a javascript: URL"], [/(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/)/i, "a link to an outside file"], [/@import/i, "a CSS @import"],
  [/url\(\s*["']?\s*(?:https?:|\/\/)/i, "a CSS url() to an outside file"], [/<!ENTITY/i, "an XML entity"], [/<iframe\b|<embed\b|<object\b/i, "an embedded document"],
];

/** Every colour an SVG uses, as lowercase 6-digit hex. */
export function svgColours(svg: string): string[] {
  const out = new Set<string>();
  for (const m of svg.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const h = m[1]!.toLowerCase();
    out.add(`#${h.length === 3 ? h.split("").map((c) => c + c).join("") : h}`);
  }
  return [...out];
}

/** Checks an SVG before it is kept. `scheme` is the personality's colours for the style it was drawn in. */
export function checkSvg(svg: string, scheme?: { ground: string; ink: string; accent: string; accent2: string }): SvgCheck {
  const errors: string[] = [], warnings: string[] = [];
  if (!/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg\b/i.test(svg)) errors.push("it is not an SVG (it must start with <svg>)");
  if (Buffer.byteLength(svg) > 300 * 1024) errors.push("it is over 300 KB: simplify the paths");
  for (const [re, what] of FORBIDDEN) if (re.test(svg)) errors.push(`it contains ${what}`);
  if (!/<svg\b[^>]*\sviewBox\s*=/i.test(svg)) errors.push("the <svg> has no viewBox, so it cannot scale");
  if (/<text\b/i.test(svg)) warnings.push("it contains <text>: words belong in the composition, in the reel's type, not inside the drawing");
  if ((svg.match(/<[a-z]/gi) ?? []).length > 800) warnings.push("it has over 800 elements: heavy to animate");
  const colours = svgColours(svg);
  if (scheme) {
    const allowed = [scheme.ground, scheme.ink, scheme.accent, scheme.accent2].map((c) => c.toLowerCase());
    // Shades count: a colour is "from the scheme" when its hue sits close to one of the scheme's (0–255 per channel).
    const near = (c: string) => allowed.some((a) => { const x = parseHex(a), y = parseHex(c); return !!x && !!y && Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]) < 90; });
    const neutral = (c: string) => { const y = parseHex(c); return !!y && Math.max(...y) - Math.min(...y) < 16; };
    const off = colours.filter((c) => !near(c) && !neutral(c));
    if (off.length > 2) warnings.push(`${off.length} colours are outside the scheme (${off.slice(0, 4).join(", ")}): use the scheme's ground, ink, accent and accent 2, or shades of them`);
    if (allowed.length && !colours.some((c) => near(c))) warnings.push("none of its colours come from the scheme");
    const inkOnGround = contrast(scheme.ink, scheme.ground);
    if (inkOnGround < 3) warnings.push(`the scheme's ink on its ground is only ${inkOnGround.toFixed(1)}:1; keep line art in the ink anyway`);
  }
  return { ok: errors.length === 0, errors, warnings, colours };
}

/** The scheme a drawing should use: the style's palette in the personality, or the style's first curated one. */
export function schemeFor(style: StyleId | undefined, personalityId?: string): { style: StyleId; scheme: { ground: string; ink: string; accent: string; accent2: string } } | undefined {
  const p = personalityId ? getPersonality(personalityId) : defaultPersonality();
  const id = (style ?? p?.styles[0]?.id) as StyleId | undefined;
  const st = id ? STYLES.find((s) => s.id === id) : undefined;
  if (!st) return undefined;
  const pal = p?.palettes[st.id] ?? st.palettes[0]!;
  return { style: st.id, scheme: { ground: pal.ground, ink: pal.ink, accent: pal.accent, accent2: pal.accent2 } };
}

/** Checks the SVG and adds it to the library as a pending, drawn, generic image. */
export function keepDrawing(file: string, o: { name: string; tags?: string[]; style?: StyleId; personality?: string; describe?: string }): { id: string; check: SvgCheck; existed: boolean } {
  const svg = readFileSync(file, "utf8");
  const sc = schemeFor(o.style, o.personality);
  const check = checkSvg(svg, sc?.scheme);
  if (!check.ok) throw Object.assign(new Error(`the drawing was not kept: ${check.errors.join("; ")}`), { check });
  // A drawing keeps its own file name in the library only through its name; the bytes are what they are.
  const clean = path.join(path.dirname(file), `${path.basename(file, ".svg")}.svg`);
  if (clean !== file) writeFileSync(clean, svg);
  const tags = [...new Set([...(o.tags ?? []), "drawn", ...(sc ? [sc.style] : [])].map((t) => t.toLowerCase().replace(/[^a-z0-9-]+/g, "-")).filter(Boolean))];
  const r = addAsset(clean, {
    name: o.name, assetKind: "generic", tags, tagOrigin: Object.fromEntries(tags.map((t) => [t, "claude" as const])), mediaType: "image",
    provenance: { source: "drawn", note: `Drawn by Claude as SVG${sc ? ` in the ${sc.style} style` : ""}${o.describe ? `: ${o.describe}` : ""}` },
    analysis: { dominantColors: check.colours.slice(0, 5), descriptors: o.describe ? [o.describe] : [] },
    review: { state: "pending", at: new Date().toISOString() },
  });
  return { id: r.asset.id, check, existed: r.existed };
}

/** The instruction for a drawing the owner asks for from the studio. */
export function drawPrompt(o: { what: string; beat?: string; reelPath?: string; style?: StyleId; personality?: string }): string {
  const sc = schemeFor(o.style, o.personality);
  const dir = o.reelPath ? path.join(path.dirname(o.reelPath), "drawn") : "an out-*/drawn/ folder";
  return [
    `Draw this as an SVG: ${o.what}.`,
    ...(sc ? [`- Style: ${STYLES.find((s) => s.id === sc.style)!.name}: ${DRAWING[sc.style]}.`, `- Colours: only the scheme: ground ${sc.scheme.ground}, ink ${sc.scheme.ink}, accent ${sc.scheme.accent}, accent 2 ${sc.scheme.accent2} (and tints of them).`] : []),
    "- A viewBox, no text inside it, no scripts or outside links; group the parts that should move separately (`<g id=\"…\">`), so a composition can animate them.",
    `- Save it in ${dir}/ with a short kebab-case name, then keep it: \`npm run draw -- <file.svg> --name "<what it is>" --tags a,b${sc ? ` --style ${sc.style}` : ""}\`. Fix whatever the check reports and run it again.`,
    ...(o.beat && o.reelPath ? [`- Then use it in ${o.beat} of ${o.reelPath} in place of what it shows now, re-render only that beat (\`--only ${o.beat} --clips-only\`) and rejoin the master (\`--master-only\`).`] : ["- Then show it: say its library id; it waits in Review until I approve it for other reels."]),
    "- Never draw a logo, a product screenshot or a real person: those must be the real thing.",
    "Reply in one or two lines.",
  ].join("\n");
}
