import type { Move } from "../references/vocab.js";

/**
 * The techniques catalog: what a beat has to *do*, through which channel, by which move, played how.
 *
 *   Operation → Domain → Technique → Timing → Execution
 *
 * Classified by mechanism, never by aesthetic: "Semantic contrast" is a technique whatever style it is drawn in.
 * The framework is inspired by Iris™, *A Taxonomy of Visuals*, by Modern Art Direction
 * (https://visuals.modernartdirection.com). Nothing of theirs is used: the operations, domains, techniques and
 * every definition here are written in our own words from public visual-communication principles (Gestalt grouping,
 * figure and ground, semiotics) and reelcut's own moves and patterns. Timing, and the Reveal and Transform
 * operations, exist because a reel moves and a still does not.
 *
 * Execution is not listed here: it is what the catalog points at (the patterns, the beats you rated, library assets,
 * references), see `src/taxonomy/examples.ts`.
 */

export const OPERATIONS = [
  { id: "differentiate", name: "Differentiate", does: "Make one thing stand apart from everything around it.", when: "a key figure, the winner, the one word that matters, the product among the noise" },
  { id: "group", name: "Group", does: "Make several things read as one set.", when: "a list, a family of features or tools, an ecosystem, 'everything in one place'" },
  { id: "sequence", name: "Sequence", does: "Lead the eye through things in an order.", when: "steps, a process, a timeline, a cause and its effect" },
  { id: "infer", name: "Infer", does: "Let the viewer work out a meaning that is never stated.", when: "an argument made by an image, wit, a metaphor, a claim too big to say plainly" },
  { id: "reveal", name: "Reveal", does: "Withhold something, then show it.", when: "a hook, a payoff, a twist, the answer to a question the reel asked" },
  { id: "transform", name: "Transform", does: "Turn one state into another before the viewer's eyes.", when: "before and after, old to new, problem to solution, A becomes B" },
] as const;

export const DOMAINS = [
  { id: "feature", name: "Feature", does: "Visible properties: colour, value, size, shape, texture, focus." },
  { id: "grouping", name: "Grouping", does: "How parts belong together: nearness, likeness, enclosure, connection, structure." },
  { id: "space", name: "Space", does: "Where things sit and how we see them: position, depth, framing, the camera." },
  { id: "social", name: "Social", does: "People and characters: faces, gaze, gestures, a host acting things out." },
  { id: "semantic", name: "Semantic", does: "What things mean: opposites, associations, symbols, cause and effect." },
  { id: "cultural", name: "Cultural", does: "Shared references: genres, formats, famous images, brand codes." },
  { id: "typographic", name: "Typographic", does: "Type as the picture: scale, weight, emphasis, how words arrive." },
  { id: "interface", name: "Interface", does: "The vocabulary of screens: real UI, cursor, prompts, notifications, controls." },
  { id: "sound", name: "Sound", does: "Hits, silence and rhythm doing the work." },
] as const;

export const TIMINGS = [
  { id: "build", name: "Build", does: "Arrives piece by piece, so the order is part of the message." },
  { id: "snap", name: "Snap", does: "Changes at once, on a beat: the difference is the event." },
  { id: "hold", name: "Hold", does: "Stays still long enough to be read: the stillness is the move." },
  { id: "morph", name: "Morph", does: "One form flows into another, so they are seen to be related." },
  { id: "rhythm", name: "Rhythm", does: "Repeats on a pulse; the repetition carries the meaning." },
  { id: "delay", name: "Delay", does: "A pause before the payoff: the wait is felt, then paid." },
] as const;

export type OperationId = (typeof OPERATIONS)[number]["id"];
export type DomainId = (typeof DOMAINS)[number]["id"];
export type TimingId = (typeof TIMINGS)[number]["id"];

export interface Technique {
  id: string;
  name: string;
  domain: DomainId;
  /** The operations it serves, the one it serves best first. */
  operations: OperationId[];
  /** What it is, in one sentence. */
  does: string;
  /** When to reach for it. */
  when: string;
  /** The move tags (visual-vocabulary) it is usually made of. */
  moves: Move[];
  /** How it usually plays. */
  timing: TimingId;
}

const t = (id: string, name: string, domain: DomainId, operations: OperationId[], timing: TimingId, moves: Move[], does: string, when: string): Technique =>
  ({ id, name, domain, operations, does, when, moves, timing });

export const TECHNIQUES: readonly Technique[] = [
  // ── Feature
  t("colour-isolation", "Colour isolation", "feature", ["differentiate"], "snap", ["hl"], "One element carries the accent colour; everything else is muted.", "one bar, one word, one product must win the frame"),
  t("complementary-pairing", "Complementary pairing", "feature", ["differentiate", "group"], "hold", [], "Two opposite hues side by side, so each reads stronger.", "two sides of a choice, a brand and its counterpart"),
  t("scale-disparity", "Scale disparity", "feature", ["differentiate"], "snap", ["big", "num"], "One thing is far larger (or smaller) than the rest.", "a figure, a claim, the one word to remember"),
  t("value-contrast", "Light against dark", "feature", ["differentiate", "reveal"], "hold", [], "The lit thing is the subject; the dark around it falls away.", "an emotional turn, a hero line, a product reveal"),
  t("odd-one-out", "Odd one out", "feature", ["differentiate"], "snap", ["icon"], "Among many identical things, one differs in shape or colour.", "standing out in a crowded market, the exception"),
  t("texture-against-flat", "Texture against flat", "feature", ["differentiate"], "hold", ["obj"], "A tactile subject on a flat ground, or a flat one on a busy ground.", "a real object, craft, the physical among the digital"),
  t("silhouette", "Silhouette", "feature", ["differentiate", "infer"], "hold", ["ill"], "The subject as one solid shape against light: read by outline alone.", "an icon-like moment, a mood, a figure that stands for many"),
  t("selective-focus", "Selective focus", "feature", ["differentiate"], "build", [], "One thing sharp, the rest blurred or dimmed behind it.", "a dialog over an app, the line that matters in a page"),
  t("saturation-drop", "Desaturate the rest", "feature", ["differentiate", "reveal"], "snap", [], "The world drains to grey and only the subject keeps its colour.", "the one that matters appears out of the crowd"),

  // ── Grouping
  t("proximity-cluster", "Proximity cluster", "grouping", ["group"], "build", [], "Things placed close together read as belonging together.", "a feature set, a team, a bundle"),
  t("similarity-set", "Similarity set", "grouping", ["group"], "build", ["icon"], "Same shape, colour or size makes a family, whatever the items are.", "a range of options, integrations, a product line"),
  t("enclosure", "Enclosure", "grouping", ["group"], "build", [], "A card, box or region holds its members as one.", "a plan, a dashboard, 'all of this in one place'"),
  t("connection-lines", "Connection lines", "grouping", ["group", "sequence"], "build", [], "Lines drawn between things make them one system.", "how things connect, a workflow, an ecosystem"),
  t("hub-and-spokes", "Hub and spokes", "grouping", ["group", "differentiate"], "build", ["fly"], "One centre with many satellites: the centre is what ties them.", "a platform and its integrations, a topic and its parts"),
  t("depth-stack", "Depth stack", "grouping", ["group", "differentiate"], "build", ["tilt"], "Many layered in depth reads as many; the one in front is current.", "a queue, notifications, versions, layers of a system"),
  t("convergence", "Convergence", "grouping", ["group", "transform"], "morph", [], "Scattered parts gather into one form.", "many-into-one, bringing tools together, consolidation"),
  t("abundance-wall", "Abundance wall", "grouping", ["group"], "build", [], "A regular grid that fills: many examples read as a body of work.", "breadth, a library, 'hundreds of…'"),
  t("hierarchy-tree", "Hierarchy tree", "grouping", ["group", "sequence"], "build", [], "Levels branching from a root show how a whole is organised.", "a taxonomy, an org chart, categories and their members"),
  t("branch-highlight", "Branch highlight", "grouping", ["differentiate", "sequence"], "build", [], "One path through a structure lights up while the rest dims.", "the route to an answer, picking one option out of a system"),
  t("bloom", "Bloom", "grouping", ["group", "reveal"], "build", ["fly"], "Members burst out of their source along its links, then settle.", "examples of a thing, what a category contains"),
  t("ripple", "Ripple", "grouping", ["group", "reveal"], "build", [], "A wave travels out from one point and lights everything it reaches, in that point's colour.", "everything here comes from this one idea; influence spreading; a system coming alive"),

  // ── Space
  t("centre-placement", "Centre placement", "space", ["differentiate"], "hold", [], "The subject alone at the optical centre.", "a thesis, a name, an end card"),
  t("isolation-in-void", "Isolation in void", "space", ["differentiate", "infer"], "hold", [], "One thing in a lot of empty space: the emptiness gives it weight.", "a serious line, a premium product, a pause"),
  t("frame-within-frame", "Frame within a frame", "space", ["differentiate"], "hold", ["dev", "sr"], "A window, device or doorway inside the frame tells the eye where to look.", "a product on a device, a recording in a window"),
  t("crop-at-edge", "Crop at the edge", "space", ["infer"], "hold", [], "The subject is cut by the frame: there is more than we see.", "scale, energy, intimacy, something too big to fit"),
  t("leading-lines", "Leading lines", "space", ["sequence", "differentiate"], "build", [], "Lines, paths and routes that carry the eye to the subject.", "a journey, delivery, from here to there"),
  t("from-depth", "Arrival from depth", "space", ["reveal"], "build", ["fly"], "Things travel from far away to near, sharpening as they come.", "a result arriving, something new, an answer"),
  t("camera-push", "Camera push", "space", ["differentiate", "reveal"], "build", [], "The camera moves in on what matters.", "the key line of code, the click that changes things"),
  t("pull-back", "Pull-back reveal", "space", ["reveal", "group"], "morph", [], "The camera pulls away and the one thing turns out to be part of something huge.", "'this is just one of hundreds', context, the big picture"),
  t("tilt-into-space", "Tilt into space", "space", ["differentiate", "reveal"], "build", ["tilt"], "A flat thing tilted in 3D becomes an object you can hold.", "a screen, a card, a document made physical"),
  t("forced-perspective", "Forced perspective", "space", ["infer"], "hold", ["obj"], "Near and far composed so that scale lies, and the lie is the point.", "small effort, big result; a giant problem"),

  // ── Social
  t("gaze-cue", "Gaze cue", "social", ["sequence", "differentiate"], "build", [], "A face or character looks at the subject, and we look where it looks.", "pointing the viewer at a claim without an arrow"),
  t("face-first", "Face first", "social", ["differentiate"], "hold", [], "A face draws the eye before anything else in the frame.", "testimony, trust, a human behind the product"),
  t("pointing-gesture", "Pointing gesture", "social", ["sequence"], "build", ["cur"], "A hand, finger, pen or cursor points the way.", "this one, here, do this"),
  t("character-host", "Character host", "social", ["sequence", "infer"], "build", ["ill"], "A character acts the steps out, so the abstract becomes a story.", "a process, a tool that does work for you"),
  t("anthropomorphism", "Anthropomorphism", "social", ["infer"], "build", ["ill"], "A thing is given a face or a behaviour, and its character transfers.", "a product that helps, waits, celebrates"),
  t("crowd-and-one", "Crowd and one", "social", ["differentiate", "group"], "build", [], "Many figures, one of them different or doing the work.", "you among many, parallel helpers, the one who acts"),

  // ── Semantic
  t("semantic-contrast", "Semantic contrast", "semantic", ["differentiate", "infer"], "hold", [], "Things with opposite meanings placed together, so each sharpens the other.", "yes/no, old/new, problem against promise"),
  t("visual-metaphor", "Visual metaphor", "semantic", ["infer"], "morph", ["ill", "obj"], "Show A as B, so B's quality passes to A.", "sending as flight, noise to signal, growth as a plant"),
  t("form-substitution", "Form substitution", "semantic", ["infer"], "morph", [], "Part of a thing is replaced by something that shares its shape.", "a clever hook, two ideas fused into one image"),
  t("juxtaposition", "Juxtaposition", "semantic", ["infer"], "hold", [], "Two unrelated things side by side make a third meaning.", "an argument without words, irony"),
  t("double-reading", "Double reading", "semantic", ["infer", "reveal"], "morph", [], "One image that can be read two ways, and the second reading lands late.", "wit, a twist, a hook that rewards a second look"),
  t("symbol-shortcut", "Symbol shortcut", "semantic", ["group", "infer"], "snap", ["icon"], "An icon stands in for a whole idea.", "covering many ideas fast, a list of benefits"),
  t("before-after", "Before and after", "semantic", ["transform"], "snap", [], "The same thing in two states, the change is the message.", "results, improvement, the product's effect"),
  t("cause-effect", "Cause and effect", "semantic", ["sequence", "transform"], "build", ["cur"], "An action and its result shown in one move.", "a click and what it changes, a setting and its outcome"),
  t("exaggeration", "Exaggeration", "semantic", ["differentiate", "infer"], "snap", ["big"], "A property pushed past reality, so it cannot be missed.", "a huge number, a shout, emphasis that is the joke"),

  // ── Cultural
  t("genre-quotation", "Genre quotation", "cultural", ["infer"], "hold", [], "Borrow the look of a known genre (film titles, a receipt, a terminal, a protest poster) and its meaning comes with it.", "drama, proof, hacker credibility, a manifesto"),
  t("famous-image", "Famous image", "cultural", ["infer"], "hold", [], "Quote an image everyone knows, changed just enough.", "a hook with instant recognition"),
  t("familiar-format", "Familiar format", "cultural", ["sequence", "differentiate"], "build", [], "Use a format the viewer already reads: ranking, versus, countdown, checklist.", "comparisons, top lists, progress"),
  t("brand-code", "Brand code", "cultural", ["differentiate"], "snap", ["logo"], "A brand's colour, shape or mark recognised in an instant.", "openings, sign-offs, 'this is us'"),

  // ── Typographic
  t("word-by-word", "Word-by-word build", "typographic", ["sequence", "reveal"], "build", ["wb"], "A sentence arrives one word at a time, read at the pace it is said.", "a thesis, a quote, a line the voice speaks"),
  t("serif-accent", "Serif accent", "typographic", ["differentiate"], "snap", ["ser"], "One word set in an italic serif among a sans line.", "the key word of a sentence"),
  t("highlighter", "Highlighter mark", "typographic", ["differentiate"], "build", ["hl"], "A marker stroke or box drawn behind or around the words that matter.", "the phrase to remember, a correction"),
  t("strike-replace", "Strike and replace", "typographic", ["transform", "differentiate"], "snap", ["strike"], "The old word is struck through and the new one takes its place.", "old way vs new, myth vs fact"),
  t("kinetic-slam", "Kinetic slam", "typographic", ["differentiate", "sequence"], "rhythm", ["kin", "big"], "Words stamp in on the beat, huge.", "a shout, a list of claims, a release"),
  t("rolling-values", "Rolling values", "typographic", ["transform", "group"], "rhythm", ["roll", "wheel"], "A word or value rolls through options in place.", "'for X, Y and Z', anything can be changed"),
  t("big-number", "Big number", "typographic", ["differentiate"], "build", ["num"], "A figure counts up huge, with what it means beside it.", "a statistic, a price, a result"),
  t("type-as-image", "Type as image", "typographic", ["infer", "differentiate"], "morph", ["big", "kin"], "The letterforms themselves carry the meaning.", "craft, motion, an idea that lives in a word"),

  // ── Interface
  t("real-ui-demo", "Real UI demo", "interface", ["sequence"], "build", ["ui"], "The product's own screen does the thing.", "how it works, the feature in action"),
  t("cursor-path", "Cursor path", "interface", ["sequence"], "build", ["cur"], "A cursor travels on a curve and clicks.", "one action in the product, 'just click'"),
  t("prompt-answer", "Prompt and answer", "interface", ["sequence", "reveal"], "build", ["chat"], "A prompt is typed, sent, and the answer streams back.", "an AI product, asking and getting"),
  t("notification-arrival", "Notification arrival", "interface", ["reveal", "group"], "build", ["ui"], "System notifications arrive as the news.", "something happened, results coming in, quiet until it matters"),
  t("state-toggle", "State toggle", "interface", ["transform"], "snap", ["ui"], "A control flips and the world around it changes.", "control, settings, monthly to yearly"),
  t("code-reveal", "Code reveal", "interface", ["sequence", "differentiate"], "build", ["code"], "Code writes in and the key line lights.", "an API, an install, a developer claim"),
  t("path-card", "Path card", "interface", ["sequence", "differentiate"], "build", [], "A breadcrumb card whose rows stack in and roll when the choice changes.", "a decision path, a configuration, the levels of a system"),

  // ── Sound
  t("hit-on-cut", "Hit on the cut", "sound", ["differentiate"], "snap", [], "A sound hit lands exactly on the arrival or the cut.", "punctuation, a reveal, emphasis without more pixels"),
  t("silence-before", "Silence before the payoff", "sound", ["reveal"], "delay", [], "The sound drops away just before the reveal.", "a twist, the big number, the end card"),
  t("cut-on-beat", "Cut on the beat", "sound", ["sequence", "group"], "rhythm", [], "Cuts and arrivals fall on the music's beat.", "a montage, a list, energy"),
  t("keystroke-texture", "Keystroke texture", "sound", ["sequence"], "build", [], "Typing and clicks are heard, so the work feels done in real time.", "typing a prompt, a terminal, a form"),
];

export const operationIds = OPERATIONS.map((o) => o.id) as OperationId[];
export const domainIds = DOMAINS.map((d) => d.id) as DomainId[];
export const timingIds = TIMINGS.map((x) => x.id) as TimingId[];

export const techniqueById = (id: string): Technique | undefined => TECHNIQUES.find((x) => x.id === id);
export const operationById = (id: string) => OPERATIONS.find((o) => o.id === id);
export const domainById = (id: string) => DOMAINS.find((d) => d.id === id);
export const timingById = (id: string) => TIMINGS.find((x) => x.id === id);
