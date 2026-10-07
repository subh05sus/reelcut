/**
 * The twenty design styles a personality chooses from (up to three), each with what it is, what it is best at, how it
 * moves, the textures it wears, six curated colour schemes (every one contrast-checked by the tests) and the type
 * pairings that suit it, best first.
 *
 * `render` says how far the kit draws the style itself: "render" means the kit has the style's own look
 * (assets/kit/ui/70-styles.*: its shape material, world, textures, entrances and frame cadence, switched on with
 * data-style="<id>"); "direction" would mean a reel in it is composed on the existing looks, steered by the rest.
 * All twenty are rendered.
 */

export type StyleId =
  | "paper-cutout" | "claymation" | "stop-motion" | "hand-drawn" | "flat-vector" | "linear" | "kinetic-type" | "editorial"
  | "collage" | "brutalist" | "swiss" | "minimal" | "3d" | "isometric" | "liquid" | "ink-paint" | "ui-product" | "retro-vhs"
  | "glitch" | "cinematic";

export interface Palette {
  id: string;
  name: string;
  /** The page colour. */
  ground: string;
  /** Text and lines on the ground. */
  ink: string;
  /** The one colour that means something: the key word, the active state. Large text on the ground, so ≥ 3:1. */
  accent: string;
  /** A second colour for charts, a second object, a highlight. */
  accent2: string;
}

/** How strong the colours of a style want to be (OKLCH chroma of the accent). */
export type Chroma = "muted" | "soft" | "vivid" | "any";
/** What the ground wants to be. */
export type GroundPref = "light" | "dark" | "any";
/** How motion advances: smoothly at 60 fps, or on held frames like hand-made animation. */
export type Cadence = "smooth" | "stepped-12" | "stepped-8";
export type Camera = "still" | "slow-push" | "drift" | "handheld";
export type BeatKind = "hook" | "statement" | "data" | "product" | "quote" | "cta";

export interface Texture {
  grain: number;
  paper: number;
  halftone: number;
  leaks: number;
  vignette: number;
  glow: number;
  chroma: number;
  scanlines: number;
}

export interface StyleSpec {
  id: StyleId;
  name: string;
  /** One line: what it looks like. */
  blurb: string;
  /** What it does best, for the mixer and the showcase preview. */
  bestAt: string;
  /** The beat kinds it suits most, best first. */
  beats: BeatKind[];
  render: "direction" | "render";
  /** The nearest kit look today. */
  look: "paper" | "ink" | "flood" | "sky" | "cinema" | "poster" | "cool";
  ground: GroundPref;
  chroma: Chroma;
  /** Glowing, very bright saturated colours. */
  neon: boolean;
  /** How many distinct hues the style carries well. */
  hues: number;
  /** Why it wants that ground, that chroma, no neon: quoted in the warnings. */
  why: { ground?: string; chroma?: string; neon?: string; hues?: string };
  motion: { energy: "restrained" | "default" | "energetic"; cadence: Cadence; camera: Camera; overshoot: boolean; note: string };
  texture: Texture;
  /** whatships move tags it leans on and ones it avoids (see visual-vocabulary.md). */
  moves: { prefer: string[]; avoid: string[] };
  sound: string;
  palettes: Palette[];
  /** Type pairing ids (src/fonts/catalog.ts PAIRINGS), best first, and ones that fight it with the reason. */
  fonts: { best: string[]; avoid: string[]; why: string };
}

const T = (t: Partial<Texture>): Texture => ({ grain: 0, paper: 0, halftone: 0, leaks: 0, vignette: 0, glow: 0, chroma: 0, scanlines: 0, ...t });
const P = (id: string, name: string, ground: string, ink: string, accent: string, accent2: string): Palette => ({ id, name, ground, ink, accent, accent2 });

export const STYLES: readonly StyleSpec[] = [
  {
    id: "paper-cutout", name: "Paper Cutout", blurb: "Layered card shapes with soft cast shadows and torn edges, moved like pieces on a desk.",
    bestAt: "explainers and stories told with simple shapes", beats: ["statement", "hook", "quote"], render: "render", look: "paper",
    ground: "any", chroma: "soft", neon: false, hues: 4,
    why: { chroma: "paper is dyed, not lit: very strong colour reads as plastic, not card", neon: "card cannot glow; neon breaks the physical illusion" },
    motion: { energy: "default", cadence: "stepped-12", camera: "still", overshoot: true, note: "pieces slide and settle on held frames, a little overshoot like a hand placing them" },
    texture: T({ paper: 0.6, grain: 0.25, vignette: 0.15 }),
    moves: { prefer: ["obj", "ill", "icon", "big"], avoid: ["ui", "code", "hud"] }, sound: "paper slides, snips, soft taps",
    palettes: [P("kraft", "Kraft", "#e9dcc6", "#2b2420", "#b8461f", "#2f6b5e"), P("construction", "Construction", "#f3ead8", "#1f2a44", "#c23a44", "#c8701f"),
      P("nordic", "Nordic card", "#eef0ec", "#233040", "#2f6f99", "#c99a2e"), P("midnight-craft", "Midnight craft", "#1d2333", "#f1e9da", "#f2a65a", "#6cb4a4"),
      P("candy", "Candy", "#fbe8ec", "#3a1f2b", "#c93b67", "#3f86c4"), P("olive-press", "Olive press", "#ecebdc", "#2a2d22", "#6b7a2e", "#b8462f")],
    fonts: { best: ["crafted", "friendly", "chunky", "handmade", "startup"], avoid: ["luxe", "tabloid", "swiss"], why: "it wants type with a hand-cut warmth; razor-thin or hyper-technical faces feel printed, not cut" },
  },
  {
    id: "claymation", name: "Claymation", blurb: "Soft, bevelled, matte shapes with fingerprints of light; squash and stretch on held frames.",
    bestAt: "characters and playful product moments", beats: ["hook", "product", "cta"], render: "render", look: "paper",
    ground: "any", chroma: "soft", neon: false, hues: 4,
    why: { chroma: "plasticine is matte: soft, chalky colour, never electric", neon: "neon glows fight clay's soft matte light" },
    motion: { energy: "energetic", cadence: "stepped-12", camera: "still", overshoot: true, note: "squash and stretch, a bounce on landing, held frames at 12 per second" },
    texture: T({ grain: 0.35, vignette: 0.2 }),
    moves: { prefer: ["obj", "ill", "icon", "bub"], avoid: ["code", "hud", "ui"] }, sound: "soft squishes, pops, wooden knocks",
    palettes: [P("peach", "Peach studio", "#f6e3d4", "#3b2a24", "#c4533a", "#4f8a7a"), P("playroom", "Playroom", "#fdf1d6", "#2d2a4a", "#d64545", "#2f8f85"),
      P("mint-dough", "Mint dough", "#e3f1ea", "#22362e", "#c2560f", "#3e6fd1"), P("lavender", "Lavender", "#ece6f6", "#2e2547", "#c94f2a", "#5a50d8"),
      P("terracotta", "Terracotta", "#f1dfcf", "#3a2318", "#b4462f", "#3f6684"), P("night-clay", "Night clay", "#2a2536", "#f6eadf", "#ffb08a", "#8fd3c1")],
    fonts: { best: ["friendly", "chunky", "crafted", "startup"], avoid: ["luxe", "classic", "swiss", "tabloid"], why: "clay wants round, bouncy letters; hairline serifs and strict grotesks look stiff beside it" },
  },
  {
    id: "stop-motion", name: "Stop Motion", blurb: "Real-looking objects moved a frame at a time, with the tiny jitter of a hand between frames.",
    bestAt: "tactile product stories and making-of moments", beats: ["product", "statement", "hook"], render: "render", look: "paper",
    ground: "any", chroma: "soft", neon: false, hues: 3,
    why: { chroma: "objects under real light have natural, slightly dusty colour", neon: "nothing on a real desk glows like neon" },
    motion: { energy: "default", cadence: "stepped-8", camera: "still", overshoot: false, note: "8 to 12 frames a second, a half-pixel jitter on every held frame, objects arrive in a few steps" },
    texture: T({ grain: 0.4, vignette: 0.25, leaks: 0.1 }),
    moves: { prefer: ["obj", "foot", "ill"], avoid: ["hud", "mesh"] }, sound: "clicks, scrapes, small thuds",
    palettes: [P("desk", "Desk", "#efe7da", "#26211c", "#b8384b", "#2e7aa6"), P("workshop", "Workshop", "#e7e1d6", "#1f1d1a", "#b85a10", "#3c6e71"),
      P("felt", "Felt", "#f2e6d9", "#3a2c2a", "#a53b63", "#41806b"), P("darkroom", "Darkroom", "#1b1a17", "#efe8dc", "#e8b04a", "#d0654f"),
      P("toybox", "Toybox", "#f7efe2", "#22223b", "#bd4a62", "#117a9e"), P("linen", "Linen", "#f4f1ea", "#2f2f2f", "#8c5e3c", "#5f7a61")],
    fonts: { best: ["handmade", "crafted", "editorial", "friendly"], avoid: ["expressive", "tech"], why: "a hand-made world wants hand-set type; futuristic faces break the spell" },
  },
  {
    id: "hand-drawn", name: "Hand-Drawn", blurb: "Marker and pencil lines that draw themselves, wobbling slightly, arrows and circles around what matters.",
    bestAt: "tutorials, annotations, pointing at the one thing", beats: ["statement", "data", "quote"], render: "render", look: "paper",
    ground: "any", chroma: "any", neon: false, hues: 3,
    why: { neon: "ink and marker are pigment on paper; they cannot glow" },
    motion: { energy: "default", cadence: "stepped-12", camera: "still", overshoot: false, note: "strokes draw at hand speed (apple.glide), lines boil gently on held frames" },
    texture: T({ paper: 0.45, grain: 0.2 }),
    moves: { prefer: ["hl", "strike", "ill", "icon"], avoid: ["mesh", "hud"] }, sound: "marker squeaks, pencil scratches, page turns",
    palettes: [P("notebook", "Notebook", "#fbf8f1", "#22252b", "#2a63c9", "#d4502a"), P("whiteboard", "Whiteboard", "#fafafa", "#1c1c1c", "#d62f3c", "#1d70a2"),
      P("sketchbook", "Sketchbook", "#f3ecdf", "#2b2622", "#b13426", "#2e7aa0"), P("blueprint", "Blueprint", "#12355b", "#eaf2fb", "#ffd166", "#9ad1ff"),
      P("chalkboard", "Chalkboard", "#1f2b26", "#eef0ea", "#f6c85f", "#8fd3c1"), P("pink-marker", "Pink marker", "#fffdf4", "#1d1d1f", "#d63a72", "#2a7f62")],
    fonts: { best: ["handmade", "friendly", "crafted", "editorial"], avoid: ["luxe", "tabloid", "extended"], why: "drawn lines want a human hand in the type too; fashion and tabloid faces shout over them" },
  },
  {
    id: "flat-vector", name: "Flat Vector", blurb: "Clean geometric shapes in bold flat colour, no texture, smooth confident motion.",
    bestAt: "explaining a product simply, icons and diagrams", beats: ["statement", "product", "data"], render: "render", look: "paper",
    ground: "any", chroma: "vivid", neon: false, hues: 4,
    why: { chroma: "flat illustration lives on clear, saturated colour; greyed tones turn it dull", neon: "flat colour is printed, not lit; neon reads as a different style" },
    motion: { energy: "default", cadence: "smooth", camera: "slow-push", overshoot: false, note: "shapes morph and slide on springs, everything lands exactly" },
    texture: T({}),
    moves: { prefer: ["icon", "ill", "obj", "num"], avoid: ["foot", "mesh"] }, sound: "clean pops, soft whooshes, UI taps",
    palettes: [P("primary", "Primary", "#f5f3ee", "#1b1b1f", "#2f5bff", "#ff6b35"), P("sunny", "Sunny", "#fff4d6", "#23202b", "#e8443c", "#1f9bb0"),
      P("ocean", "Ocean", "#e7f0fb", "#0f1d33", "#1f5fd1", "#00a37a"), P("coral", "Coral", "#fff0ea", "#1f1414", "#e04a2f", "#1e6f7a"),
      P("grape", "Grape", "#2b1d4f", "#f6f1ff", "#ffc857", "#4ecdc4"), P("mono-pop", "Mono pop", "#ffffff", "#111111", "#e5332a", "#0a6fd8")],
    fonts: { best: ["startup", "friendly", "expressive", "chunky", "tech"], avoid: ["classic", "luxe", "handmade"], why: "geometric shapes want geometric type; old-style serifs and handwriting pull it somewhere else" },
  },
  {
    id: "linear", name: "Linear / Hairline", blurb: "Thin precise strokes, outlines and wireframes; restraint, one accent, lots of air.",
    bestAt: "tech and developer products, systems and diagrams", beats: ["product", "data", "statement"], render: "render", look: "ink",
    ground: "any", chroma: "soft", neon: true, hues: 2,
    why: { chroma: "hairlines carry little ink; strong fills overpower the drawing", hues: "a line drawing holds one accent, two at most" },
    motion: { energy: "restrained", cadence: "smooth", camera: "slow-push", overshoot: false, note: "lines draw on, outlines resolve, calm springs, nothing bounces" },
    texture: T({ grain: 0.1, glow: 0.15 }),
    moves: { prefer: ["dev", "ui", "hud", "code"], avoid: ["ill", "bub"] }, sound: "fine ticks, soft hums, data blips",
    palettes: [P("graphite", "Graphite", "#0b0b0d", "#ededf0", "#8b7bff", "#3ddc97"), P("blueprint-line", "Blueprint", "#0d1b2a", "#e0e8f0", "#4cc9f0", "#a3b8cc"),
      P("paper-line", "Paper", "#f5f4ef", "#151515", "#c2410c", "#6b675f"), P("ice", "Ice", "#eef3f7", "#0f1c2b", "#4a66cc", "#5f76c9"),
      P("mint-wire", "Mint wire", "#0c1412", "#e6f2ee", "#3ddc97", "#5ec2ff"), P("sepia", "Sepia", "#f3ede2", "#2b241c", "#9a4b25", "#6b675f")],
    fonts: { best: ["swiss", "tech", "studio", "fashion"], avoid: ["chunky", "handmade", "brutal", "friendly"], why: "hairline drawings want light, precise type; heavy or bouncy letters outweigh the lines" },
  },
  {
    id: "kinetic-type", name: "Kinetic Typography", blurb: "The words are the picture: huge type that slams, rolls, splits and stacks to the rhythm.",
    bestAt: "hooks, claims and anything said with conviction", beats: ["hook", "statement", "cta"], render: "render", look: "flood",
    ground: "any", chroma: "any", neon: true, hues: 2,
    why: { hues: "the type is the image; more than two colours turns a sentence into confetti" },
    motion: { energy: "energetic", cadence: "smooth", camera: "still", overshoot: true, note: "fast entrances, hard holds, words land on the beat; snappy springs" },
    texture: T({ grain: 0.15 }),
    moves: { prefer: ["kin", "big", "wb", "roll", "strike"], avoid: ["ill", "foot"] }, sound: "punches, swishes, bass hits on the downbeat",
    palettes: [P("bw-red", "Black, white, red", "#0a0a0a", "#fafafa", "#ff3b1f", "#ffd400"), P("paper-ink", "Paper and ink", "#f2efe9", "#111111", "#2437ff", "#d12c12"),
      P("acid", "Acid", "#111111", "#f2f2f2", "#c6ff00", "#ff2e93"), P("signal", "Signal", "#ffd400", "#111111", "#c2000b", "#111111"),
      P("cobalt", "Cobalt", "#e8ecf3", "#0f1420", "#2f5bff", "#e0434b"), P("flood-red", "Flood red", "#ef4b2d", "#111111", "#fff6e8", "#111111")],
    fonts: { best: ["poster", "extended", "tabloid", "expressive", "brutal", "chunky", "swiss"], avoid: ["handmade", "classic"], why: "kinetic type needs letters built for size and impact; delicate book faces and handwriting lose their punch huge" },
  },
  {
    id: "editorial", name: "Editorial", blurb: "Magazine pages: a confident serif, generous margins, photographs and a strict column grid.",
    bestAt: "stories, quotes, founders and considered launches", beats: ["quote", "statement", "hook"], render: "render", look: "paper",
    ground: "any", chroma: "soft", neon: false, hues: 2,
    why: { chroma: "print inks are deep and calm; bright colour cheapens the page", neon: "a magazine page cannot glow", hues: "one ink colour and black is the editorial habit" },
    motion: { energy: "restrained", cadence: "smooth", camera: "slow-push", overshoot: false, note: "lines rise out of their masks, slow pushes, long holds on the line that matters" },
    texture: T({ paper: 0.25, grain: 0.15 }),
    moves: { prefer: ["ser", "cap", "foot", "hl"], avoid: ["hud", "mesh", "bub"] }, sound: "paper, a soft typewriter, a page turn",
    palettes: [P("newsprint", "Newsprint", "#f4f1ea", "#161616", "#b3261e", "#6b675f"), P("gallery", "Gallery", "#fafaf7", "#1a1a1a", "#2b4c7e", "#7a7a7a"),
      P("sand", "Sand", "#efe6d8", "#2a241d", "#8c4a2f", "#5f6f52"), P("sage", "Sage", "#e9ece4", "#1f2a24", "#4f6d4a", "#a5583a"),
      P("rose-paper", "Rose paper", "#f6ece8", "#2b1f1d", "#a6463f", "#6e5c58"), P("ink-night", "Ink night", "#121212", "#ece6da", "#e8c26b", "#a0998c")],
    fonts: { best: ["editorial", "classic", "luxe", "fashion"], avoid: ["chunky", "friendly", "expressive", "handmade"], why: "editorial lives on a real serif and a calm sans; bubbly or futuristic faces make it an ad" },
  },
  {
    id: "collage", name: "Collage", blurb: "Cut photos, tape, halftone, torn paper and stickers layered with attitude.",
    bestAt: "campaigns, manifestos, culture and community", beats: ["hook", "statement", "cta"], render: "render", look: "poster",
    ground: "any", chroma: "vivid", neon: false, hues: 4,
    why: { chroma: "collage borrows the loud inks of posters and riso prints", neon: "printed scraps don't glow; neon reads as a screen, not a cut-out" },
    motion: { energy: "energetic", cadence: "stepped-12", camera: "still", overshoot: true, note: "pieces stamp in on held frames, slight rotations, a sticker lands last" },
    texture: T({ paper: 0.5, halftone: 0.5, grain: 0.3 }),
    moves: { prefer: ["big", "obj", "foot", "ill"], avoid: ["ui", "code"] }, sound: "tape rips, stamps, paper snaps",
    palettes: [P("zine", "Zine", "#f1ece2", "#121212", "#2437ff", "#e23b1f"), P("riso", "Riso", "#f7f3ea", "#1d1d1b", "#d62e93", "#0072b5"),
      P("sun-bleached", "Sun-bleached", "#efe3cf", "#2b2116", "#c4553a", "#3d405b"), P("night-market", "Night market", "#14110f", "#f4ece1", "#ffcf33", "#ff5a4f"),
      P("botanic", "Botanic", "#eef0e2", "#1d2a1f", "#cf4a24", "#2b8a44"), P("cyan-clash", "Cyan clash", "#e9f6f7", "#101820", "#d45d00", "#00828a")],
    fonts: { best: ["poster", "brutal", "tabloid", "handmade", "crafted"], avoid: ["luxe", "swiss"], why: "collage wants type that was cut out of something; refined fashion or strict grid faces look too clean" },
  },
  {
    id: "brutalist", name: "Brutalist", blurb: "Raw and blunt: system fonts, hard borders, full-strength colour, no polish on purpose.",
    bestAt: "developer tools, bold opinions, anti-marketing", beats: ["hook", "statement", "data"], render: "render", look: "poster",
    ground: "any", chroma: "any", neon: true, hues: 3,
    why: {},
    motion: { energy: "energetic", cadence: "smooth", camera: "still", overshoot: false, note: "hard cuts inside the beat, instant states, no easing showcase" },
    texture: T({}),
    moves: { prefer: ["big", "code", "kin", "strike"], avoid: ["mesh", "ill", "bub"] }, sound: "clicks, beeps, hard thuds",
    palettes: [P("concrete", "Concrete", "#d9d9d6", "#000000", "#d42400", "#0000ee"), P("terminal", "Terminal", "#000000", "#e8e8e8", "#00ff66", "#ffffff"),
      P("warning", "Warning", "#ffe600", "#000000", "#c80000", "#000000"), P("blue-raw", "Blue raw", "#0000ee", "#ffffff", "#ffff00", "#ffffff"),
      P("paper-raw", "Paper raw", "#ffffff", "#000000", "#0000ee", "#e00000"), P("pink-raw", "Pink raw", "#ff9ecb", "#000000", "#1d00c9", "#000000")],
    fonts: { best: ["brutal", "poster", "tabloid", "tech"], avoid: ["luxe", "classic", "friendly", "fashion"], why: "brutalism is honest and heavy; elegant or cute type pretends to be something else" },
  },
  {
    id: "swiss", name: "Swiss", blurb: "The international style: a strict grid, asymmetric layouts, a grotesk and one red.",
    bestAt: "data, systems, anything that should feel exact", beats: ["data", "statement", "product"], render: "render", look: "paper",
    ground: "any", chroma: "any", neon: false, hues: 2,
    why: { neon: "Swiss design is ink on paper, objective; neon is emotional", hues: "the Swiss grid carries black, white and one colour" },
    motion: { energy: "default", cadence: "smooth", camera: "still", overshoot: false, note: "elements slide along the grid on exact springs, no camera drama" },
    texture: T({ grain: 0.08 }),
    moves: { prefer: ["num", "big", "wb", "cap"], avoid: ["ill", "bub", "mesh"] }, sound: "dry clicks, paper, a metronome",
    palettes: [P("classic-red", "Classic red", "#f2f0ea", "#111111", "#d40511", "#6f6f6f"), P("black-grid", "Black grid", "#0a0a0a", "#f5f5f5", "#ff2b2b", "#8a8a8a"),
      P("blue", "Blue", "#eef0f2", "#0c0c0c", "#0050e6", "#6f6f6f"), P("orange", "Orange", "#f4f1e6", "#0d0d0d", "#d14e00", "#6f6f6f"),
      P("green", "Green", "#f0f2ee", "#0f0f0f", "#00813f", "#6f6f6f"), P("mono", "Mono", "#ffffff", "#000000", "#000000", "#767676")],
    fonts: { best: ["swiss", "studio", "tech", "signage"], avoid: ["handmade", "friendly", "chunky", "luxe"], why: "Swiss is a neutral grotesk on a grid; handwriting, bubbly or fashion didones break its objectivity" },
  },
  {
    id: "minimal", name: "Minimal", blurb: "Almost nothing on screen: one idea, one accent, lots of space and slow, soft motion.",
    bestAt: "premium products, calm brands, one strong line", beats: ["statement", "quote", "cta"], render: "render", look: "paper",
    ground: "any", chroma: "muted", neon: false, hues: 1,
    why: { chroma: "minimal lets space speak; strong colour shouts over it", neon: "neon is never quiet", hues: "minimal holds one accent; a second colour already feels busy" },
    motion: { energy: "restrained", cadence: "smooth", camera: "slow-push", overshoot: false, note: "gentle springs, long holds, one thing moves at a time" },
    texture: T({ grain: 0.06 }),
    moves: { prefer: ["wb", "ser", "big"], avoid: ["mesh", "hud", "bub", "kin"] }, sound: "near silence, soft tones",
    palettes: [P("bone", "Bone", "#f5f3ee", "#1a1a1a", "#7d7266", "#a39a8f"), P("fog", "Fog", "#eceef0", "#1d2125", "#4f6375", "#8a96a3"),
      P("night", "Night", "#0e0e10", "#e9e9ec", "#9aa3ad", "#6b737c"), P("sage-min", "Sage", "#eef0ea", "#1f2620", "#5c7a5f", "#8fa391"),
      P("blush", "Blush", "#f7efec", "#2a2120", "#9c6458", "#b9958c"), P("ink-min", "Ink", "#ffffff", "#111111", "#111111", "#8a8a8a")],
    fonts: { best: ["studio", "swiss", "luxe", "fashion", "classic"], avoid: ["chunky", "poster", "tabloid", "brutal", "handmade"], why: "minimal wants light, quiet type; heavy display faces fill the space minimal leaves empty" },
  },
  {
    id: "3d", name: "3D", blurb: "Rendered objects with soft studio light, glossy materials, depth of field and real perspective.",
    bestAt: "hardware, hero products, premium launches", beats: ["product", "hook", "cta"], render: "render", look: "ink",
    ground: "any", chroma: "any", neon: true, hues: 3,
    why: {},
    motion: { energy: "default", cadence: "smooth", camera: "drift", overshoot: false, note: "objects turn and float, the camera orbits slowly, depth of field shifts" },
    texture: T({ grain: 0.1, glow: 0.3, vignette: 0.2 }),
    moves: { prefer: ["obj", "tilt", "fly", "dev"], avoid: ["ill", "hl"] }, sound: "airy whooshes, glassy chimes, low swells",
    palettes: [P("studio-grey", "Studio grey", "#e8e9ec", "#121317", "#4b5cf0", "#e0613b"), P("candy-gloss", "Candy gloss", "#fbe9f0", "#2a1730", "#d43a86", "#6c5ce7"),
      P("midnight-chrome", "Midnight chrome", "#08090c", "#eceef2", "#7aa2ff", "#b48cff"), P("sunset", "Sunset", "#ffe9d6", "#2b1a14", "#d9541e", "#b8860b"),
      P("mint-3d", "Mint", "#e6f6f1", "#11241e", "#00876a", "#0770c2"), P("obsidian", "Obsidian neon", "#050507", "#f2f2f5", "#00e5ff", "#ff2bd6")],
    fonts: { best: ["expressive", "tech", "startup", "swiss", "studio"], avoid: ["handmade", "classic"], why: "rendered objects want modern type; handwriting and book serifs date it" },
  },
  {
    id: "isometric", name: "Isometric", blurb: "30° worlds: stacked slabs, little buildings, systems drawn as tidy diagrams.",
    bestAt: "architecture, infrastructure, how things fit together", beats: ["data", "product", "statement"], render: "render", look: "cool",
    ground: "any", chroma: "any", neon: true, hues: 3,
    why: { hues: "more than three hues and the layers stop reading as one system" },
    motion: { energy: "default", cadence: "smooth", camera: "still", overshoot: false, note: "slabs rise and separate on springs, leader lines draw" },
    texture: T({ grain: 0.08 }),
    moves: { prefer: ["obj", "dev", "hud", "icon"], avoid: ["foot", "ser"] }, sound: "soft clicks, blocks settling, data blips",
    palettes: [P("lab", "Lab", "#eef1f6", "#0f172a", "#2563eb", "#b45309"), P("dark-lab", "Dark lab", "#0b1020", "#e6ebf5", "#8b7bff", "#3ddc97"),
      P("pastel-blocks", "Pastel blocks", "#f4f1ff", "#24203a", "#6556e0", "#c9573a"), P("warm-stack", "Warm stack", "#f6efe6", "#2a221b", "#c4502f", "#21857a"),
      P("cyber", "Cyber", "#06070d", "#e8f0ff", "#00e0ff", "#ff3df2"), P("slate", "Slate", "#e9ecef", "#111418", "#3f4750", "#7c858f")],
    fonts: { best: ["tech", "swiss", "studio", "startup", "signage"], avoid: ["handmade", "luxe", "classic"], why: "isometric diagrams are engineered; type should be too" },
  },
  {
    id: "liquid", name: "Liquid", blurb: "Blobs, metaballs and flowing gradients that morph and melt into one another.",
    bestAt: "AI, wellness, anything fluid or transformative", beats: ["hook", "statement", "cta"], render: "render", look: "sky",
    ground: "any", chroma: "vivid", neon: true, hues: 3,
    why: { chroma: "liquid gradients need saturated colour to glow as they blend" },
    motion: { energy: "default", cadence: "smooth", camera: "drift", overshoot: true, note: "shapes morph on soft springs, a gentle wobble, colours flow" },
    texture: T({ grain: 0.12, glow: 0.4 }),
    moves: { prefer: ["mesh", "obj", "big"], avoid: ["code", "hud", "strike"] }, sound: "liquid swells, bubbles, soft synth pads",
    palettes: [P("aurora", "Aurora", "#0a0b14", "#eef0ff", "#7c5cff", "#00e0c6"), P("iris", "Iris", "#f3f0ff", "#1e1638", "#7a45e8", "#d4317a"),
      P("lagoon", "Lagoon", "#e6f7f8", "#0e2a30", "#00808f", "#4a73e8"), P("molten", "Molten", "#120a08", "#ffefe6", "#ff6a3d", "#ffb800"),
      P("pearl", "Pearl", "#f7f5f2", "#222222", "#8b57d1", "#2f8fc4"), P("ultraviolet", "Ultraviolet", "#0c0618", "#f1e9ff", "#b14cff", "#ff4fa3")],
    fonts: { best: ["expressive", "startup", "fashion", "luxe", "swiss"], avoid: ["brutal", "tabloid", "signage"], why: "liquid is smooth and continuous; blocky, condensed or raw type fights the flow" },
  },
  {
    id: "ink-paint", name: "Ink / Paint", blurb: "Brush strokes, sumi ink and watercolour bleeding into paper; organic reveals.",
    bestAt: "culture, craft, food, anything with soul", beats: ["quote", "statement", "hook"], render: "render", look: "paper",
    ground: "light", chroma: "soft", neon: false, hues: 2,
    why: { ground: "ink and watercolour need paper to bleed into", chroma: "pigment on paper is soft and transparent", neon: "paint cannot glow", hues: "brush work reads best with an ink and one colour" },
    motion: { energy: "restrained", cadence: "smooth", camera: "slow-push", overshoot: false, note: "strokes draw at brush speed, colour bleeds outward, slow reveals" },
    texture: T({ paper: 0.6, grain: 0.2 }),
    moves: { prefer: ["ser", "ill", "hl"], avoid: ["ui", "hud", "code"] }, sound: "brush sweeps, water, a temple bell",
    palettes: [P("sumi", "Sumi", "#f3efe6", "#141414", "#b3261e", "#6b675f"), P("indigo-dye", "Indigo dye", "#eef0f4", "#1b2440", "#2b4c9b", "#8a6f4e"),
      P("watercolor", "Watercolour", "#fbf7f1", "#2a2a35", "#b93a4c", "#3b8384"), P("moss", "Moss", "#eef0e6", "#1f2a1f", "#4e6d32", "#a35a1c"),
      P("rose-wash", "Rose wash", "#f8eeea", "#2b1f22", "#a84a62", "#577584"), P("persimmon", "Persimmon", "#f6efe4", "#1f1a17", "#b9472c", "#4b6a88")],
    fonts: { best: ["editorial", "classic", "handmade", "luxe", "crafted"], avoid: ["tech", "expressive", "chunky"], why: "brush work wants calligraphic or bookish type; techno faces feel pasted on" },
  },
  {
    id: "ui-product", name: "UI / Product", blurb: "Real product screens and Apple-like UI, glass controls, a cursor or a finger doing the thing.",
    bestAt: "software demos, features, before and after", beats: ["product", "data", "cta"], render: "render", look: "cool",
    ground: "any", chroma: "any", neon: false, hues: 2,
    why: { neon: "product UI uses calm system colours; neon reads as a gaming skin", hues: "an interface carries one tint and its system colours" },
    motion: { energy: "default", cadence: "smooth", camera: "slow-push", overshoot: false, note: "Apple's springs: presses, lenses, sheets; a 1.03 camera push" },
    texture: T({ grain: 0.05 }),
    moves: { prefer: ["ui", "cur", "chat", "num"], avoid: ["ill", "foot"] }, sound: "UI taps, soft keyboard, gentle confirmations",
    palettes: [P("cool", "Cool", "#e8ecf3", "#0f1420", "#2f5bff", "#5f76c9"), P("paper-ui", "Paper", "#f3f1ec", "#121212", "#c2410c", "#2f5bff"),
      P("ink-ui", "Ink", "#09090b", "#f4f2ee", "#8b7bff", "#3ddc97"), P("apple-light", "Apple light", "#f2f2f7", "#000000", "#0066cc", "#248a3d"),
      P("apple-dark", "Apple dark", "#000000", "#ffffff", "#0a84ff", "#30d158"), P("mint-saas", "Mint SaaS", "#eef7f3", "#0d1f18", "#087f5b", "#4f46e5")],
    fonts: { best: ["studio", "swiss", "tech", "startup"], avoid: ["handmade", "tabloid", "chunky", "luxe"], why: "interfaces are set in calm UI type; display, fashion or handwritten faces stop it looking like a real product" },
  },
  {
    id: "retro-vhs", name: "Retro / VHS", blurb: "Tape: scanlines, chroma bleed, tracking wobble, sunsets and chrome type from the 80s and 90s.",
    bestAt: "nostalgia, music, playful launches", beats: ["hook", "cta", "statement"], render: "render", look: "cinema",
    ground: "dark", chroma: "vivid", neon: true, hues: 3,
    why: { ground: "VHS glows out of a dark CRT; a light ground washes the scanlines out", chroma: "tape colour bleeds strong and warm" },
    motion: { energy: "energetic", cadence: "smooth", camera: "handheld", overshoot: false, note: "tracking jumps, a little wobble, a rewind blur between states" },
    texture: T({ scanlines: 0.6, chroma: 0.45, grain: 0.35, vignette: 0.35, glow: 0.3 }),
    moves: { prefer: ["big", "kin", "roll", "foot"], avoid: ["ui", "hl"] }, sound: "tape whir, VCR clunk, synth stabs",
    palettes: [P("synth", "Synth", "#120c1f", "#f8e9ff", "#ff3cac", "#2bd2ff"), P("tape", "Tape", "#1b1611", "#f3e3c3", "#ff7b00", "#ffd23f"),
      P("mall", "Mall", "#10131f", "#eaf2ff", "#ff4f81", "#4fffc2"), P("camcorder", "Camcorder", "#0b0b0b", "#f2f2f2", "#ff3b3b", "#3bff72"),
      P("sunset-grid", "Sunset grid", "#1a0b2e", "#ffe9f3", "#ff7a00", "#ff2fa0"), P("vhs-teal", "VHS teal", "#071a1c", "#e6fbf7", "#ff6b9a", "#2fd6c3")],
    fonts: { best: ["expressive", "chunky", "poster", "signage", "tech"], avoid: ["classic", "luxe", "fashion"], why: "VHS wants chrome, wide or blocky type of its era; refined serifs feel anachronistic" },
  },
  {
    id: "glitch", name: "Glitch", blurb: "Datamosh, RGB split, slices and noise: the screen breaking on purpose.",
    bestAt: "security, AI, disruption, a twist", beats: ["hook", "statement", "data"], render: "render", look: "ink",
    ground: "dark", chroma: "vivid", neon: true, hues: 3,
    why: { ground: "glitches are light breaking out of a dark screen", chroma: "RGB split needs pure, strong channels" },
    motion: { energy: "energetic", cadence: "smooth", camera: "handheld", overshoot: false, note: "hard slices, channel offsets, frames that stutter then snap clean" },
    texture: T({ chroma: 0.7, scanlines: 0.3, grain: 0.3, glow: 0.2 }),
    moves: { prefer: ["kin", "code", "hud", "big"], avoid: ["ill", "ser", "bub"] }, sound: "bit crush, static, digital stutters",
    palettes: [P("rgb", "RGB", "#050505", "#f0f0f0", "#ff0040", "#00e5ff"), P("acid-glitch", "Acid", "#0a0a0a", "#eaffea", "#39ff14", "#ff00e6"),
      P("corrupt", "Corrupt", "#101014", "#e8e8ee", "#8f78ff", "#ff453a"), P("magenta-noise", "Magenta noise", "#0c0710", "#f6e9ff", "#ff2bd6", "#2bd1ff"),
      P("amber-crt", "Amber CRT", "#0d0a05", "#ffd38a", "#ffb000", "#ff5a1f"), P("ice-glitch", "Ice", "#060b10", "#e6f6ff", "#00ffd5", "#8577ff")],
    fonts: { best: ["tech", "brutal", "expressive", "signage"], avoid: ["luxe", "classic", "friendly", "handmade"], why: "glitch is digital; warm, literary or hand-made type makes the break look accidental" },
  },
  {
    id: "cinematic", name: "Cinematic", blurb: "Film: letterbox, grain, light leaks, a slow camera and a serif line that lands like a title card.",
    bestAt: "the emotional turn, brand films, trailers", beats: ["quote", "hook", "statement"], render: "render", look: "cinema",
    ground: "dark", chroma: "muted", neon: false, hues: 2,
    why: { ground: "film lives in the dark of a cinema", chroma: "film is graded: colour is muted, never raw", neon: "neon breaks the grade", hues: "a grade carries two tones, a warm and a cool" },
    motion: { energy: "restrained", cadence: "smooth", camera: "slow-push", overshoot: false, note: "slow dolly pushes, long dissolves inside a beat, type fades up from black" },
    texture: T({ grain: 0.5, leaks: 0.35, vignette: 0.45 }),
    moves: { prefer: ["ser", "foot", "cap", "big"], avoid: ["bub", "ui", "kin"] }, sound: "low drones, deep booms, room tone",
    palettes: [P("noir", "Noir", "#070707", "#efe9df", "#e8c26b", "#a0998c"), P("teal-orange", "Teal and orange", "#0b1215", "#eae3d7", "#c7854c", "#4f9aa6"),
      P("dusk", "Dusk", "#0f0c14", "#ece4f2", "#c98bb9", "#e8c26b"), P("desert", "Desert", "#14100b", "#f1e6d3", "#d08c45", "#8a9a8a"),
      P("moonlight", "Moonlight", "#080b12", "#e3e9f2", "#9fb8d8", "#e8c26b"), P("ember", "Ember", "#100805", "#f3e7da", "#c47a4f", "#8a6b5a")],
    fonts: { best: ["editorial", "classic", "luxe", "fashion"], avoid: ["chunky", "friendly", "handmade", "tabloid"], why: "film titles are set in serifs or quiet grotesks; bubbly or tabloid type turns it into an ad" },
  },
];

export const STYLE_IDS = STYLES.map((s) => s.id) as readonly StyleId[];
export function styleById(id: string): StyleSpec | undefined {
  return STYLES.find((s) => s.id === id);
}

/** Pairs of styles that pull in opposite directions. Combining them is allowed, with a word of warning. */
export const STYLE_TENSIONS: readonly { a: StyleId; b: StyleId; why: string }[] = [
  { a: "minimal", b: "brutalist", why: "Minimal wants quiet space; Brutalist fills it with raw weight. One will cancel the other." },
  { a: "minimal", b: "collage", why: "Collage layers everything; Minimal removes. Keep one for hooks and one for the rest, or pick one." },
  { a: "minimal", b: "glitch", why: "Glitch is noise; Minimal is silence." },
  { a: "cinematic", b: "flat-vector", why: "Cinematic is graded light and grain; Flat Vector has neither. Side by side, both look unfinished." },
  { a: "claymation", b: "glitch", why: "Clay is warm and handmade; Glitch is cold and digital." },
  { a: "swiss", b: "collage", why: "Swiss is a strict grid; Collage breaks every grid." },
  { a: "editorial", b: "retro-vhs", why: "Editorial is print; VHS is tape. They date the reel in two directions." },
  { a: "ink-paint", b: "glitch", why: "Brush and paper against digital noise rarely reads as one voice." },
  { a: "3d", b: "hand-drawn", why: "Rendered depth and flat pen lines sit on different planes; keep them on different beat kinds." },
];
