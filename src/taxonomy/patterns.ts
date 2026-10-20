import { TECHNIQUES, type Technique } from "./catalog.js";

/**
 * Which techniques each built-in pattern performs (`skills/reelcut/assets/patterns/`), best first: the catalog's
 * built-in executions. Tagged once, by hand, by reading what each pattern does; a test keeps every pattern file
 * tagged and every tag a real technique. The owner's own changes live in the taxonomy store and win over these.
 */
export const PATTERN_TECHNIQUES: Readonly<Record<string, readonly string[]>> = {
  // the moves
  "agent-run": ["prompt-answer", "from-depth", "keystroke-texture"],
  "bars-compare": ["colour-isolation", "familiar-format", "scale-disparity"],
  "brand-flood": ["brand-code", "complementary-pairing", "hit-on-cut"],
  "calendar-booking": ["cause-effect", "real-ui-demo", "depth-stack"],
  "chat-thread": ["prompt-answer", "enclosure"],
  "cinema-line": ["genre-quotation", "value-contrast", "isolation-in-void"],
  "code-focus": ["code-reveal", "tilt-into-space", "camera-push"],
  "collage-poster": ["genre-quotation", "texture-against-flat", "kinetic-slam"],
  "command-palette": ["selective-focus", "real-ui-demo", "branch-highlight"],
  constellation: ["hub-and-spokes", "connection-lines", "from-depth"],
  "cursor-demo": ["cursor-path", "cause-effect", "tilt-into-space", "camera-push"],
  "dashboard-tiles": ["enclosure", "proximity-cluster", "big-number"],
  "device-flank": ["frame-within-frame", "rolling-values"],
  "end-card": ["centre-placement", "brand-code", "serif-accent"],
  "flat-scene": ["visual-metaphor", "silhouette"],
  "flow-diagram": ["connection-lines", "leading-lines", "cause-effect"],
  "glyph-swarm": ["convergence", "odd-one-out", "colour-isolation"],
  "hand-doodle": ["highlighter", "pointing-gesture"],
  "inline-ui": ["rolling-values", "state-toggle"],
  "isometric-stack": ["hierarchy-tree", "depth-stack"],
  "kanban-drag": ["real-ui-demo", "cursor-path", "tilt-into-space"],
  "line-chart-scrub": ["big-number", "cursor-path", "familiar-format"],
  "line-waves": ["visual-metaphor", "convergence"],
  "mascot-hop": ["anthropomorphism", "character-host"],
  "notification-stack": ["notification-arrival", "depth-stack"],
  "one-word": ["rolling-values", "scale-disparity", "kinetic-slam"],
  "paper-plane": ["visual-metaphor", "leading-lines"],
  "pricing-toggle": ["state-toggle", "big-number", "colour-isolation"],
  "ranking-race": ["familiar-format", "colour-isolation"],
  "settings-switches": ["state-toggle", "cause-effect", "enclosure"],
  "shape-morph": ["convergence", "similarity-set", "symbol-shortcut"],
  "stat-count": ["big-number", "scale-disparity"],
  "statement-roll": ["rolling-values", "selective-focus", "scale-disparity"],
  "strike-replace": ["strike-replace", "semantic-contrast", "before-after"],
  "terminal-type-in": ["code-reveal", "genre-quotation", "keystroke-texture"],
  testimonial: ["face-first", "word-by-word", "serif-accent"],
  "text-effect-wall": ["abundance-wall", "type-as-image"],
  "type-slam": ["kinetic-slam", "exaggeration", "cut-on-beat"],
  "upload-done": ["convergence", "cause-effect"],
  "word-build": ["word-by-word", "serif-accent", "centre-placement"],
  "wordmark-handles": ["brand-code", "cursor-path"],
  // the graph engine's moves
  "graph-world": ["pull-back", "hub-and-spokes", "connection-lines", "abundance-wall"],
  "graph-tree": ["hierarchy-tree", "branch-highlight"],
  "graph-path-card": ["path-card", "branch-highlight", "rolling-values"],
  "graph-bloom": ["bloom", "abundance-wall", "hub-and-spokes"],
  "graph-pulse": ["ripple", "connection-lines", "colour-isolation"],
  // footage
  "footage-window": ["frame-within-frame", "real-ui-demo", "pointing-gesture"],
  "footage-cutout": ["face-first", "frame-within-frame"],
  "generated-backdrop": ["texture-against-flat", "isolation-in-void"],
  // Apple UI
  "app-calendar": ["real-ui-demo", "cause-effect"],
  "app-maps": ["leading-lines", "real-ui-demo"],
  "app-messages": ["prompt-answer", "real-ui-demo"],
  "app-music": ["real-ui-demo", "camera-push"],
  "fx-checklist-shine": ["cause-effect", "familiar-format"],
  "fx-odometer-pay": ["big-number", "rolling-values", "genre-quotation"],
  "ios-context-menu": ["selective-focus", "tilt-into-space"],
  "ios-controls-board": ["state-toggle", "pointing-gesture"],
  "ios-home": ["from-depth", "frame-within-frame"],
  "ios-island": ["notification-arrival", "state-toggle"],
  "ios-island-alert": ["notification-arrival", "silence-before"],
  "ios-notification": ["notification-arrival", "depth-stack"],
  "ios-push-swipe": ["real-ui-demo", "pointing-gesture"],
  "ios-search-keyboard": ["real-ui-demo", "keystroke-texture"],
  "ios-sheet": ["real-ui-demo", "depth-stack"],
  "ios-tabbar": ["state-toggle", "similarity-set"],
  "mac-dock-window": ["frame-within-frame", "cursor-path"],
  "mac-menu": ["branch-highlight", "cursor-path"],
  // Clawd
  "clawd-connector": ["character-host", "cause-effect"],
  "clawd-cta": ["character-host", "pointing-gesture"],
  "clawd-hatch": ["anthropomorphism", "from-depth"],
  "clawd-hook": ["character-host", "gaze-cue", "word-by-word"],
  "clawd-payoff": ["anthropomorphism", "exaggeration", "brand-code"],
  "clawd-skill": ["character-host", "cause-effect"],
  "clawd-subagents": ["crowd-and-one", "character-host"],
  // style showcases: what each style does best
  "3d": ["tilt-into-space", "texture-against-flat"],
  brutalist: ["exaggeration", "kinetic-slam"],
  cinematic: ["genre-quotation", "value-contrast"],
  claymation: ["texture-against-flat", "anthropomorphism"],
  collage: ["juxtaposition", "texture-against-flat"],
  editorial: ["serif-accent", "isolation-in-void"],
  "flat-vector": ["symbol-shortcut", "similarity-set"],
  glitch: ["exaggeration", "hit-on-cut"],
  "hand-drawn": ["highlighter", "pointing-gesture"],
  "ink-paint": ["visual-metaphor", "texture-against-flat"],
  isometric: ["hierarchy-tree", "depth-stack"],
  "kinetic-type": ["kinetic-slam", "type-as-image"],
  linear: ["connection-lines", "isolation-in-void"],
  liquid: ["convergence", "visual-metaphor"],
  minimal: ["isolation-in-void", "centre-placement"],
  "paper-cutout": ["depth-stack", "texture-against-flat"],
  "retro-vhs": ["genre-quotation", "famous-image"],
  "stop-motion": ["texture-against-flat", "character-host"],
  swiss: ["scale-disparity", "proximity-cluster"],
  "ui-product": ["real-ui-demo", "frame-within-frame"],
  atlas: ["hierarchy-tree", "connection-lines", "abundance-wall"],
};

/** The patterns that perform a technique, the ones where it is the main move first. */
export function patternsFor(techniqueId: string, overrides: Readonly<Record<string, readonly string[]>> = {}): string[] {
  const all = { ...PATTERN_TECHNIQUES, ...overrides };
  return Object.entries(all)
    .filter(([, ts]) => ts.includes(techniqueId))
    // Where it is the main move first; between equals, the more focused pattern (fewer techniques) first.
    .sort((a, b) => a[1].indexOf(techniqueId) - b[1].indexOf(techniqueId) || a[1].length - b[1].length)
    .map(([p]) => p);
}

export function techniquesOfPattern(pattern: string, overrides: Readonly<Record<string, readonly string[]>> = {}): Technique[] {
  const ids = overrides[pattern] ?? PATTERN_TECHNIQUES[pattern] ?? [];
  return ids.map((id) => TECHNIQUES.find((x) => x.id === id)).filter((x): x is Technique => !!x);
}
