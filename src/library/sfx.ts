import type { LibraryAsset } from "./schema.js";
import { isPackId, packSoundPath, PACK_PREFIX, type SfxPack } from "./sfxpack.js";

/**
 * Sound effects from your own library: finding the right one for a moment, and proposing where a
 * reel's moments are.
 *
 * Two sources: the user's own approved sounds, and the bundled CC0 pack (`sfxpack.ts`, `pack:<id>`), which is
 * ready to use. On a tie the user's own sound wins. Nothing is placed without being asked for: a proposal becomes
 * a cue in `reel.json` only when `npm run sfx -- suggest --apply` is run, and a cue is only heard when the reel is
 * rendered with `--sfx`. A library sound must be approved: an unreviewed file is somebody's guess about a sound.
 */

/** The words that make a sound right for each kind of moment, best first. */
export const EVENT_TAGS: Record<string, string[]> = {
  click: ["click", "tick", "pop", "tap"],
  type: ["type", "typing", "keyboard", "tick"],
  // One key going down: typing is placed as a strike per few letters, each its own short sound.
  keystroke: ["keystroke", "key", "typewriter"],
  count: ["count", "tick", "blip", "counter"],
  roll: ["tick", "roll", "slide", "swipe"],
  pop: ["pop", "bubble", "blip", "click"],
  reveal: ["whoosh", "swoosh", "swipe", "riser", "swell"],
  whoosh: ["whoosh", "swoosh", "swipe", "riser"],
  hit: ["hit", "impact", "thud", "boom", "slam"],
  cut: ["hit", "whoosh", "impact", "thud"],
  // Placed by hand (`sfx find --event …`), for moments the helpers do not record.
  ding: ["ding", "chime", "notification", "bell"],
  success: ["success", "chime", "sparkle", "powerup", "ding"],
  error: ["error", "buzz", "wrong"],
  glitch: ["glitch", "digital", "zap"],
  shimmer: ["shimmer", "sparkle", "powerup", "fizz"],
  riser: ["riser", "swell", "build"],
  slide: ["slide", "swipe", "swoosh"],
  boom: ["boom", "sub", "impact"],
  toggle: ["toggle", "switch", "click"],
};

/** How long a sound for each moment is allowed to be, in seconds. */
const MAX_SECONDS: Record<string, number> = { keystroke: 0.7, click: 0.5, type: 3.5, count: 2, roll: 0.8, pop: 0.8, reveal: 2.5, whoosh: 2.5, hit: 3, cut: 3, ding: 2, success: 2.5, error: 1.5, glitch: 1.5, shimmer: 2.5, riser: 3.5, slide: 1.2, boom: 3, toggle: 0.5 };

export interface SfxQuery {
  event?: string;
  tags?: readonly string[];
  maxSeconds?: number;
  /** Sound ids already used in this reel, which are passed over unless nothing else fits. */
  avoid?: ReadonlySet<string>;
  /** How long the moment lasts (a typing run): a sound about that long is preferred. */
  wantSeconds?: number;
}

export interface SfxMatch {
  asset: LibraryAsset;
  score: number;
  why: string;
}

/** A sound a reel may use: audio, active, approved. */
export function isUsableSound(a: LibraryAsset): boolean {
  // A track with a beat grid is a music bed, not a cue: a three-minute song is never a whoosh.
  return a.mediaType === "audio" && a.status === "active" && a.review.state === "approved" && !a.analysis.music && !a.tags.includes("music");
}

export function searchSfx(assets: readonly LibraryAsset[], query: SfxQuery): SfxMatch[] {
  const wanted = [...(query.event ? (EVENT_TAGS[query.event] ?? [query.event]) : []), ...(query.tags ?? []).map((t) => t.toLowerCase())];
  if (wanted.length === 0) return [];
  const max = query.maxSeconds ?? (query.event ? MAX_SECONDS[query.event] : undefined);
  const out: SfxMatch[] = [];
  for (const asset of assets) {
    if (!isUsableSound(asset)) continue;
    const seconds = asset.analysis.durationSeconds;
    if (max !== undefined && seconds !== undefined && seconds > max) continue;
    // The first words of the list are the best fit: a "click" for a click, a "tick" as a second choice.
    let score = 0;
    const hits: string[] = [];
    wanted.forEach((w, i) => {
      if (asset.tags.includes(w)) {
        score += Math.max(1, 4 - i);
        hits.push(w);
      }
    });
    if (score === 0) continue;
    // A sound that was only ever a machine's guess about itself is worth less than one a person tagged.
    if (hits.every((h) => (asset.tagOrigin[h] ?? "user") !== "user")) score *= 0.6;
    // Variety: the sound used last, or most, is the one to pass over.
    score -= Math.min(2, asset.usedIn.length * 0.2);
    if (query.avoid?.has(asset.id)) score -= 5;
    // A moment with a length (a typing run) wants a sound of about that length, not one keystroke.
    if (query.wantSeconds && seconds) score += 2 * Math.max(0, 1 - Math.abs(seconds - query.wantSeconds) / query.wantSeconds);
    // The bundled pack is a floor under the user's own sounds: on a tie, theirs wins.
    if (isPackId(asset.id)) score -= 0.15;
    out.push({ asset, score: Math.round(score * 100) / 100, why: `tagged ${hits.map((h) => `#${h}`).join(" ")}` });
  }
  return out.sort((a, b) => b.score - a.score || a.asset.id.localeCompare(b.asset.id));
}

export interface RcEvent {
  type: string;
  at: number;
  duration?: number;
  /** For typing: the text typed, so strikes follow its words. */
  text?: string;
}

/**
 * Typing as keystrokes: about one strike per 2.6 letters, inside the first three quarters of each word (a typist
 * hits a word's letters in a burst and pauses at the space), each strike nudged earlier or later by a stable swing
 * so the rhythm is human. Returns seconds relative to the start of the typing.
 */
export function keystrokeTimes(text: string, duration: number): number[] {
  const n = text.length;
  if (n === 0 || duration <= 0) return [];
  const perChar = duration / n;
  const out: number[] = [];
  for (const m of text.matchAll(/\S+/g)) {
    const a = m.index!, len = m[0].length;
    const strikes = Math.max(1, Math.round(len / 2.6));
    for (let k = 0; k < strikes; k++) {
      const i = out.length;
      const swing = (((i * 7919) % 101) / 50 - 1) * 0.18 * perChar;
      out.push(Math.max(0, Math.min(duration, (a + (0.75 * len * k) / strikes) * perChar + swing)));
    }
  }
  return out.sort((x, y) => x - y).map((t) => Math.round(t * 1000) / 1000);
}

export interface CueProposal {
  beat: string;
  at: number;
  event: string;
  soundId: string;
  /** What to write as the cue's source: `library:<id>` or `pack:<id>`. */
  source: string;
  name: string;
  gainDb?: number;
  durationSeconds?: number;
  pan?: number;
  rate?: number;
  why: string;
}

export interface ProposeOptions {
  /** Most cues in one beat. Silence is a choice too. */
  perBeat?: number;
  /** Events closer than this, of the same type, are one moment. */
  spacing?: number;
  /** Also propose a sound for the hard cut at the start of each beat after the first. */
  cuts?: boolean;
  /**
   * Chooses among sounds that fit equally well (the pack has several clicks that fit a click). The same seed always
   * picks the same sounds; a different reel gets different ones. Usually the reel's folder name.
   */
  seed?: string;
  /** Typing as a strike per few letters (the default when the text is known), not one long typing sound. */
  keystrokes?: boolean;
}

/** A small stable hash, for choosing among equals without randomness. */
function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Turn each beat's events into cue proposals.
 *
 * Quiet by design: at most three cues a beat, a run of rolling digits or ticking counts is one cue at
 * its start rather than one per step, and the same sound is not reused for a second moment while
 * another fits. A person can always ask for more.
 */
export function proposeCues(beats: readonly { id: string; durationSeconds: number; events: readonly RcEvent[] }[], assets: readonly LibraryAsset[], options: ProposeOptions = {}): CueProposal[] {
  const perBeat = options.perBeat ?? 3;
  const spacing = options.spacing ?? 1;
  const used = new Set<string>();
  const out: CueProposal[] = [];

  beats.forEach((beat, index) => {
    const events: RcEvent[] = [...beat.events].filter((e) => e.at >= 0 && e.at < beat.durationSeconds - 0.1);
    if (options.cuts && index > 0) events.push({ type: "cut", at: 0 });
    events.sort((a, b) => a.at - b.at);
    const picked: RcEvent[] = [];
    for (const e of events) {
      if (picked.some((p) => p.type === e.type && e.at - p.at < spacing)) continue;
      picked.push(e);
    }
    // A clicked moment outranks a counted one: keep the strongest few, then put them back in time order.
    const rank = (t: string): number => ["cut", "click", "reveal", "whoosh", "hit", "pop", "type", "count", "roll"].indexOf(t);
    const kept = [...picked].sort((a, b) => rank(a.type) - rank(b.type) || a.at - b.at).slice(0, perBeat).sort((a, b) => a.at - b.at);

    for (const e of kept) {
      const typed = e.text;
      if (e.type === "type" && typed && e.duration && options.keystrokes !== false) {
        const keys = searchSfx(assets, { event: "keystroke" });
        const top = keys.filter((m) => keys[0] && m.score >= keys[0].score - 0.01);
        if (top.length > 0) {
          const times = keystrokeTimes(typed, e.duration);
          const offset = hashOf(`${options.seed ?? ""}\0${beat.id}\0${e.at}`) % top.length;
          times.forEach((t, k) => {
            // Never the same key twice running, a little pitch and pan each strike: a hand on a keyboard, not a loop.
            const pick = top[(offset + k * 5) % top.length]!;
            const at = Math.round((e.at + t) * 1000) / 1000;
            if (at >= beat.durationSeconds - 0.05) return;
            out.push({
              beat: beat.id, at, event: "keystroke", soundId: pick.asset.id,
              source: isPackId(pick.asset.id) ? pick.asset.id : `library:${pick.asset.id}`,
              name: pick.asset.name,
              ...(pick.asset.analysis.gainDb !== undefined ? { gainDb: pick.asset.analysis.gainDb } : {}),
              pan: Math.round((((k * 37) % 9) - 4) * 0.04 * 100) / 100,
              rate: Math.round((1 + 0.05 * ((((k * 7919) % 101) / 50) - 1)) * 1000) / 1000,
              why: `keystroke ${k + 1} of ${times.length} typing "${typed.length > 24 ? `${typed.slice(0, 24)}…` : typed}"`,
            });
          });
          continue;
        }
      }
      const found = searchSfx(assets, { event: e.type, avoid: used, ...(e.duration ? { wantSeconds: e.duration } : {}) });
      const ties = found.filter((m) => found[0] && m.score >= found[0].score - 0.01);
      const best = ties.length > 1 && options.seed ? ties[hashOf(`${options.seed}\0${beat.id}\0${e.type}\0${e.at}`) % ties.length] : found[0];
      if (!best) continue;
      used.add(best.asset.id);
      out.push({
        beat: beat.id,
        at: e.at,
        event: e.type,
        soundId: best.asset.id,
        source: isPackId(best.asset.id) ? best.asset.id : `library:${best.asset.id}`,
        name: best.asset.name,
        ...(best.asset.analysis.gainDb !== undefined ? { gainDb: best.asset.analysis.gainDb } : {}),
        ...(e.type === "type" && e.duration && best.asset.analysis.durationSeconds ? { durationSeconds: Math.min(e.duration, best.asset.analysis.durationSeconds) } : {}),
        why: `${e.type} at ${e.at}s: ${best.why}`,
      });
    }
  });
  return out;
}

// ---------------------------------------------------------------- resolving a cue at render time

export interface RawCue {
  source: string;
  at: number;
  durationSeconds?: number;
  volume?: number;
  /** -1 (left) .. 1 (right). */
  pan?: number;
  /** Playback rate: a touch above or below 1 varies a repeated sound. */
  rate?: number;
  /** Which point of the sound lands on `at`; by default from what the sound is (whooshes peak, risers end). */
  align?: "onset" | "peak" | "end" | "raw";
}

export interface ResolvedCue {
  source: string;
  at: number;
  durationSeconds: number;
  volume?: number;
  pan?: number;
  rate?: number;
  align: "onset" | "peak" | "end" | "raw";
  /** Set when the cue named a library sound, so the render can record its use. */
  libraryId?: string;
  warnings: string[];
}

export interface CueDeps {
  assets: readonly LibraryAsset[];
  /** Where a library asset's bytes are. */
  blobPath: (asset: LibraryAsset) => string;
  exists: (file: string) => boolean;
  /** A file path in the manifest, made absolute. */
  resolveFile: (source: string) => string;
  /** Read a file's duration, for a cue that has none. */
  probe: (file: string) => number;
  /** The level a cue plays at when it names none. */
  defaultVolume: number;
  /** The bundled sound pack, for `pack:<id>` cues. */
  pack?: SfxPack;
}

/**
 * One manifest cue, made ready to mix.
 *
 * A `library:<id>` source resolves to the sound's bytes and plays at the default level adjusted by the
 * gain measured when the sound was ingested — the file is never changed. A cue never runs past the end
 * of its beat: at a hard cut it would bleed into the next beat. Returns `null` when the cue has no room
 * left at all. Throws for a cue that names something that cannot be used — not in the library, not a
 * sound, or rejected — because a silent reel with a missing sound is a worse surprise than a refusal.
 */
export function resolveCue(cue: RawCue, beat: { id: string; durationSeconds: number }, deps: CueDeps): ResolvedCue | null {
  const warnings: string[] = [];
  const named = /^library:([0-9a-f]{16})$/i.exec(cue.source);
  const packed = cue.source.startsWith(PACK_PREFIX) ? cue.source.slice(PACK_PREFIX.length) : undefined;
  let source: string;
  let volume = cue.volume;
  let natural: number | undefined;
  let libraryId: string | undefined;
  let tags: readonly string[] = [];
  if (packed !== undefined) {
    const sound = deps.pack?.byId.get(packed);
    if (!sound || !deps.exists(packSoundPath(deps.pack!, sound))) throw new Error(`${beat.id}: ${cue.source} is not a sound in the bundled pack (npm run sfx -- list --pack)`);
    source = packSoundPath(deps.pack!, sound);
    natural = sound.durationSeconds;
    tags = sound.tags;
    if (volume === undefined) volume = Math.min(1, Math.max(0.05, deps.defaultVolume * 10 ** (sound.gainDb / 20)));
  } else if (named) {
    const asset = deps.assets.find((a) => a.id === named[1]!.toLowerCase());
    if (!asset || asset.mediaType !== "audio" || !deps.exists(deps.blobPath(asset))) throw new Error(`${beat.id}: ${cue.source} is not a sound in the library`);
    if (asset.review.state === "rejected") throw new Error(`${beat.id}: ${cue.source} (${asset.name}) was rejected`);
    if (asset.review.state === "pending") warnings.push(`sound ${asset.id} (${asset.name}) has not been reviewed`);
    if (asset.status !== "active") warnings.push(`sound ${asset.id} (${asset.name}) is ${asset.status}`);
    source = deps.blobPath(asset);
    natural = asset.analysis.durationSeconds;
    libraryId = asset.id;
    tags = asset.tags;
    if (volume === undefined && asset.analysis.gainDb !== undefined) volume = Math.min(1, Math.max(0.05, deps.defaultVolume * 10 ** (asset.analysis.gainDb / 20)));
  } else {
    source = deps.resolveFile(cue.source);
  }
  const length = Math.min(cue.durationSeconds ?? natural ?? deps.probe(source), beat.durationSeconds - cue.at);
  if (!(length >= 0.05)) return null;
  const align = cue.align ?? (tags.some((t) => ["riser", "swell", "reverse", "build"].includes(t)) ? "end" : tags.some((t) => ["whoosh", "swoosh", "swish", "swipe", "slide"].includes(t)) ? "peak" : "onset");
  return { source, at: cue.at, durationSeconds: length, align, ...(volume === undefined ? {} : { volume }), ...(cue.pan !== undefined ? { pan: cue.pan } : {}), ...(cue.rate !== undefined ? { rate: cue.rate } : {}), ...(libraryId ? { libraryId } : {}), warnings };
}
