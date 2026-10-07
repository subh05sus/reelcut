/**
 * The bundled type library: which families ship with the skill, and the pairings a reel chooses from.
 *
 * Every family is open-licensed (SIL OFL or Apache 2.0, the licence file ships beside it), stored inside the
 * skill as Latin woff2 (which covers German entirely: ä ö ü ß, „ “ quotes, €, dashes), and loaded only by the
 * compositions that use it. `npm run fonts -- fetch` (re)downloads them from Google Fonts; nothing is fetched
 * when a reel renders, so a render is identical offline and a year from now.
 */

export const FONT_KINDS = ["sans", "display", "serif", "hand", "mono", "round"] as const;
export type FontKind = (typeof FONT_KINDS)[number];

export interface FamilySpec {
  family: string;
  kind: FontKind;
  /** Also bundle the italics (serifs, and the kit's default sans). */
  italic?: boolean;
  /** Set only in capitals: lowercase is drawn as small capitals, so headlines in it should be uppercase. */
  caps?: boolean;
  /** One line for Step 0 and the specimen sheet. */
  note: string;
}

export const FAMILIES: readonly FamilySpec[] = [
  // Grotesk and neo-grotesk: product type.
  { family: "Inter Tight", kind: "sans", italic: true, note: "the kit's default: tight, neutral, product" },
  { family: "Inter", kind: "sans", note: "the most readable UI sans" },
  { family: "Geist", kind: "sans", note: "Vercel's: crisp, technical, modern" },
  { family: "Manrope", kind: "sans", note: "geometric warmth, open shapes" },
  { family: "Space Grotesk", kind: "sans", note: "quirky grotesk with character" },
  { family: "Plus Jakarta Sans", kind: "sans", note: "friendly startup sans" },
  { family: "DM Sans", kind: "sans", note: "low-contrast geometric, calm" },
  { family: "Figtree", kind: "sans", note: "clean and friendly" },
  { family: "Onest", kind: "sans", note: "even, contemporary grotesk" },
  { family: "Schibsted Grotesk", kind: "sans", note: "newsroom grotesk, confident" },
  { family: "Hanken Grotesk", kind: "sans", note: "light-footed grotesk" },
  { family: "Instrument Sans", kind: "sans", note: "precise, with width axis" },
  { family: "Sora", kind: "sans", note: "techy geometric" },
  { family: "Outfit", kind: "sans", note: "rounded geometric, punchy" },
  { family: "Red Hat Display", kind: "sans", note: "corporate but human" },
  { family: "Rubik", kind: "sans", note: "softly rounded corners" },
  { family: "Familjen Grotesk", kind: "sans", note: "Scandinavian grotesk with ink traps" },
  { family: "Work Sans", kind: "sans", note: "workhorse grotesk" },
  { family: "Chivo", kind: "sans", note: "sturdy grotesk, strong at heavy weights" },
  // Display and condensed: hooks and headlines.
  { family: "Archivo", kind: "display", note: "width axis: condensed to extended caps (flood, poster)" },
  { family: "Anton", kind: "display", note: "tall condensed impact" },
  { family: "Bebas Neue", kind: "display", caps: true, note: "the classic condensed all-caps" },
  { family: "Oswald", kind: "display", note: "condensed gothic, many weights" },
  { family: "Archivo Black", kind: "display", note: "heavy and wide" },
  { family: "Big Shoulders", kind: "display", note: "Chicago condensed signage" },
  { family: "Unbounded", kind: "display", note: "wide, rounded, futuristic" },
  { family: "Syne", kind: "display", note: "art-school extended" },
  { family: "Bricolage Grotesque", kind: "display", note: "expressive grotesk with optical sizes" },
  { family: "League Gothic", kind: "display", note: "narrow American gothic" },
  { family: "Barlow Condensed", kind: "display", note: "road-sign condensed" },
  { family: "Darker Grotesque", kind: "display", note: "tall, tight, fashion" },
  { family: "Shrikhand", kind: "display", note: "fat italic, retro" },
  { family: "Dela Gothic One", kind: "display", note: "chunky, poster-weight" },
  { family: "Gabarito", kind: "display", note: "bold geometric, playful" },
  { family: "Righteous", kind: "display", note: "streamlined retro" },
  { family: "Bungee", kind: "display", caps: true, note: "vertical signage caps, heavy" },
  { family: "Climate Crisis", kind: "display", caps: true, note: "melting heavy caps, one-off" },
  // Editorial serifs: the accent word, the film line.
  { family: "Instrument Serif", kind: "serif", italic: true, note: "the kit's accent: condensed, elegant italic" },
  { family: "Fraunces", kind: "serif", italic: true, note: "soft, wonky old-style with optical sizes" },
  { family: "Playfair Display", kind: "serif", italic: true, note: "high-contrast didone" },
  { family: "DM Serif Display", kind: "serif", italic: true, note: "punchy display serif" },
  { family: "Newsreader", kind: "serif", italic: true, note: "reading serif with optical sizes" },
  { family: "Libre Caslon Text", kind: "serif", italic: true, note: "classic book Caslon" },
  { family: "Young Serif", kind: "serif", note: "heavy, warm display serif" },
  { family: "Libre Bodoni", kind: "serif", italic: true, note: "crisp Bodoni" },
  { family: "Cormorant Garamond", kind: "serif", italic: true, note: "airy luxury Garamond" },
  { family: "EB Garamond", kind: "serif", italic: true, note: "the scholarly Garamond" },
  { family: "Gloock", kind: "serif", note: "high-contrast display serif" },
  { family: "Bodoni Moda", kind: "serif", italic: true, note: "fashion Bodoni with optical sizes" },
  { family: "Hedvig Letters Serif", kind: "serif", note: "quirky contemporary serif" },
  // Handwritten.
  { family: "Caveat", kind: "hand", note: "quick marker handwriting" },
  { family: "Kalam", kind: "hand", note: "loose felt-pen" },
  { family: "Permanent Marker", kind: "hand", note: "thick marker caps" },
  { family: "Patrick Hand", kind: "hand", note: "neat print handwriting" },
  { family: "Reenie Beanie", kind: "hand", note: "scribbled ballpoint" },
  { family: "Gochi Hand", kind: "hand", note: "playful school hand" },
  // Monospace.
  { family: "JetBrains Mono", kind: "mono", note: "the kit's code and HUD mono" },
  { family: "Space Mono", kind: "mono", note: "retro-future mono" },
  { family: "IBM Plex Mono", kind: "mono", note: "corporate engineering mono" },
  { family: "Geist Mono", kind: "mono", note: "Vercel's mono" },
  { family: "DM Mono", kind: "mono", note: "light, friendly mono" },
  { family: "Fira Code", kind: "mono", note: "code mono" },
  { family: "Sometype Mono", kind: "mono", note: "typewriter-ish mono" },
  // Rounded and fun.
  { family: "Nunito", kind: "round", note: "rounded terminals, friendly" },
  { family: "Fredoka", kind: "round", note: "bubbly rounded" },
  { family: "Lexend", kind: "round", note: "made for reading ease" },
];

/**
 * A pairing: what the headline, body, accent (italic word) and mono are set in, and how the headline is set.
 * A composition opts in with `data-type="<id>"` on its root (or the reel's `"type"` in reel.json).
 */
export interface Pairing {
  id: string;
  name: string;
  /** What it suits, for Step 0. */
  mood: string;
  head: string;
  body: string;
  accent: string;
  mono: string;
  headWeight: number;
  /** Letter-spacing for the headline, in em. */
  headTracking: number;
  headCase?: "uppercase";
  /** Width axis value for families that have one (Archivo, Instrument Sans). */
  headStretch?: number;
  headLeading?: number;
}

export const PAIRINGS: readonly Pairing[] = [
  { id: "studio", name: "Studio", mood: "the kit's own: neutral product type with a serif accent", head: "Inter Tight", body: "Inter Tight", accent: "Instrument Serif", mono: "JetBrains Mono", headWeight: 650, headTracking: -0.045 },
  { id: "swiss", name: "Swiss", mood: "clean, technical, developer tools", head: "Geist", body: "Geist", accent: "Instrument Serif", mono: "Geist Mono", headWeight: 600, headTracking: -0.04 },
  { id: "editorial", name: "Editorial", mood: "magazine, considered, storytelling", head: "Fraunces", body: "Inter", accent: "Fraunces", mono: "IBM Plex Mono", headWeight: 500, headTracking: -0.03 },
  { id: "poster", name: "Poster", mood: "loud hooks, tall condensed impact", head: "Anton", body: "Inter Tight", accent: "DM Serif Display", mono: "Space Mono", headWeight: 400, headTracking: -0.005, headCase: "uppercase", headLeading: 0.98 },
  { id: "tabloid", name: "Tabloid", mood: "news energy, narrow gothic caps", head: "League Gothic", body: "Work Sans", accent: "Playfair Display", mono: "DM Mono", headWeight: 400, headTracking: 0.005, headCase: "uppercase", headLeading: 0.95 },
  { id: "tech", name: "Tech", mood: "quirky engineering, AI products", head: "Space Grotesk", body: "Space Grotesk", accent: "Newsreader", mono: "Space Mono", headWeight: 600, headTracking: -0.04 },
  { id: "startup", name: "Startup", mood: "friendly SaaS, approachable", head: "Plus Jakarta Sans", body: "Plus Jakarta Sans", accent: "Fraunces", mono: "JetBrains Mono", headWeight: 750, headTracking: -0.04 },
  { id: "luxe", name: "Luxe", mood: "fashion, premium, calm", head: "Bodoni Moda", body: "Manrope", accent: "Cormorant Garamond", mono: "DM Mono", headWeight: 500, headTracking: -0.02 },
  { id: "friendly", name: "Friendly", mood: "consumer apps, playful and warm", head: "Fredoka", body: "Nunito", accent: "Caveat", mono: "DM Mono", headWeight: 600, headTracking: -0.02 },
  { id: "brutal", name: "Brutal", mood: "heavy, blunt, zine", head: "Archivo Black", body: "Archivo", accent: "Instrument Serif", mono: "Space Mono", headWeight: 400, headTracking: -0.03 },
  { id: "expressive", name: "Expressive", mood: "wide and futuristic, launches", head: "Unbounded", body: "Outfit", accent: "Instrument Serif", mono: "Geist Mono", headWeight: 700, headTracking: -0.035 },
  { id: "crafted", name: "Crafted", mood: "creative tools, characterful", head: "Bricolage Grotesque", body: "DM Sans", accent: "Young Serif", mono: "Fira Code", headWeight: 700, headTracking: -0.04 },
  { id: "handmade", name: "Handmade", mood: "personal, tutorial, behind the scenes", head: "Permanent Marker", body: "Figtree", accent: "Caveat", mono: "IBM Plex Mono", headWeight: 400, headTracking: -0.01 },
  { id: "signage", name: "Signage", mood: "condensed and civic, data and numbers", head: "Big Shoulders", body: "Hanken Grotesk", accent: "Libre Caslon Text", mono: "JetBrains Mono", headWeight: 800, headTracking: -0.01, headCase: "uppercase", headLeading: 0.96 },
  { id: "classic", name: "Classic", mood: "literary, trustworthy, finance", head: "EB Garamond", body: "Schibsted Grotesk", accent: "EB Garamond", mono: "IBM Plex Mono", headWeight: 500, headTracking: -0.02 },
  { id: "chunky", name: "Chunky", mood: "bold and bouncy, youth", head: "Dela Gothic One", body: "Rubik", accent: "Gloock", mono: "Sometype Mono", headWeight: 400, headTracking: -0.02 },
  { id: "extended", name: "Extended", mood: "brand flood: extended heavy caps", head: "Archivo", body: "Inter Tight", accent: "Instrument Serif", mono: "JetBrains Mono", headWeight: 900, headTracking: -0.02, headCase: "uppercase", headStretch: 125, headLeading: 0.94 },
  { id: "fashion", name: "Fashion", mood: "tall and tight, lifestyle", head: "Darker Grotesque", body: "Instrument Sans", accent: "Bodoni Moda", mono: "DM Mono", headWeight: 700, headTracking: -0.02, headLeading: 0.9 },
];

export const FALLBACK: Record<FontKind, string> = {
  sans: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  display: "system-ui, sans-serif",
  serif: "'Times New Roman', serif",
  hand: "'Comic Sans MS', cursive",
  mono: "ui-monospace, Menlo, monospace",
  round: "system-ui, sans-serif",
};

/** The families the kit's looks name by themselves (no pairing chosen). */
export const KIT_DEFAULT_FAMILIES = ["Inter Tight", "Instrument Serif", "JetBrains Mono", "Archivo"] as const;

export function slugOf(family: string): string {
  return family.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
