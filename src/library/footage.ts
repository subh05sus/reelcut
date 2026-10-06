import { randomBytes } from "node:crypto";
import path from "node:path";
import { legibilityVerdict, type LegibilityVerdict } from "../capture/legibility.js";
import { analyzeFile } from "./analyze.js";
import { STALE_CAPTURE_DAYS } from "./match.js";
import { FootageSchema, FOOTAGE_FORMATS, FocusSchema, normaliseTags, type Focus, type Footage, type LibraryAsset, type Moment } from "./schema.js";
import { blobPath, LibraryError, libraryRoot, loadIndex, mutateIndex } from "./store.js";

/**
 * Screen recordings and other footage, used as they were recorded.
 *
 * A recording is a library asset like a logo is: reviewed before it is used, dated, with where it came
 * from. What is different is what is *in* it — a recording of someone downloading Claude holds five
 * steps, and a script line wants one of them. So a person marks **moments** on it ("download Claude",
 * 0:12–0:19), and the matcher looks at moments, not files.
 *
 * Nothing here changes the file. A moment is a pair of times; a zoom is a region; a speed-up is a
 * playback rate on the element that shows it. What gets rendered is the recorded pixels.
 */

/** Fastest a moment is ever played. Faster than this stops reading as the same recording. */
export const MAX_SPEED = 2;

/** Moments one recording may carry. Claude's proposals are bounded too, so a queue cannot be flooded. */
export const MAX_MOMENTS = 60;

/** "12", "12.5", "0:12", "1:02.5" — seconds, or minutes and seconds. */
export function parseTime(text: string | undefined, name: string): number {
  if (text === undefined) throw new LibraryError(`${name} is required`);
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(text.trim());
  if (!m) throw new LibraryError(`${name} "${text}" is not a time: use seconds (12.5) or minutes:seconds (0:12.5)`);
  return Number(m[1] ?? 0) * 60 + Number(m[2]);
}

/** Seconds as m:ss.s. */
export function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}:${(seconds - m * 60).toFixed(1).padStart(4, "0")}`;
}

export function footageOf(asset: LibraryAsset): Footage {
  return asset.footage ?? FootageSchema.parse({});
}

export function isFootage(asset: LibraryAsset): boolean {
  return asset.mediaType === "video";
}

/** A clip a model made. Placed like footage, but it is not a recording of anything real. */
export function isGenerated(asset: LibraryAsset): boolean {
  return asset.provenance.source === "generated";
}

export function momentSeconds(m: Pick<Moment, "in" | "out">): number {
  return Math.round((m.out - m.in) * 1000) / 1000;
}

/** When the recording was made: what a person said, else what the file says. */
export function recordedAt(asset: LibraryAsset): string | undefined {
  return footageOf(asset).recordedAt ?? asset.analysis.createdAt;
}

/** Days since it was recorded, `undefined` when nobody knows — which is never treated as recent. */
export function footageAgeDays(asset: LibraryAsset, now: Date): number | undefined {
  const at = Date.parse(recordedAt(asset) ?? "");
  return Number.isNaN(at) ? undefined : Math.max(0, (now.getTime() - at) / 86_400_000);
}

export function findMoment(asset: LibraryAsset, momentId: string): Moment | undefined {
  return footageOf(asset).moments.find((m) => m.id === momentId);
}

// ---------------------------------------------------------------- changing a recording's record

export function requireVideo(asset: LibraryAsset | undefined, id: string): LibraryAsset {
  if (!asset) throw new LibraryError(`no asset ${id}`);
  if (!isFootage(asset)) throw new LibraryError(`${id} is not a video (it is ${asset.mediaType})`);
  return asset;
}

export interface FootagePatch {
  app?: string;
  platform?: Footage["platform"];
  recordedAt?: string;
  muted?: boolean;
  textPx?: number;
  /** `true` is a person saying they watched all of it for private information; `false` takes that back. */
  privateChecked?: boolean;
}

export function patchFootage(id: string, patch: FootagePatch): LibraryAsset {
  return mutateIndex((index) => {
    const asset = requireVideo(index.assets.find((a) => a.id === id), id);
    const now = new Date().toISOString();
    const next: Record<string, unknown> = { ...footageOf(asset) };
    if (patch.app !== undefined) next.app = patch.app.trim().slice(0, 80) || undefined;
    if (patch.platform !== undefined) next.platform = patch.platform;
    if (patch.recordedAt !== undefined) {
      if (patch.recordedAt && Number.isNaN(Date.parse(patch.recordedAt))) throw new LibraryError(`recordedAt must be a date, got "${patch.recordedAt}"`);
      next.recordedAt = patch.recordedAt ? new Date(patch.recordedAt).toISOString() : undefined;
    }
    if (patch.muted !== undefined) next.muted = patch.muted;
    if (patch.textPx !== undefined) next.textPx = patch.textPx;
    if (patch.privateChecked !== undefined) next.privateChecked = patch.privateChecked ? { by: "user", at: now } : undefined;
    const parsed = FootageSchema.safeParse(stripUndefined(next));
    if (!parsed.success) throw new LibraryError(parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; "));
    asset.footage = parsed.data;
    return asset;
  });
}

function stripUndefined(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

export interface MomentInput {
  label: string;
  in: number;
  out: number;
  tags?: readonly string[];
  focus?: Record<string, Focus>;
  note?: string;
}

function checkRange(asset: LibraryAsset, m: { in: number; out: number }): void {
  if (!Number.isFinite(m.in) || !Number.isFinite(m.out) || m.in < 0) throw new LibraryError("a moment starts at 0 or later");
  if (m.out - m.in < 0.3) throw new LibraryError("a moment is at least 0.3 seconds long");
  const length = asset.analysis.durationSeconds;
  if (length !== undefined && m.out > length + 0.05) throw new LibraryError(`the recording is ${length.toFixed(1)}s long; a moment cannot end at ${m.out}s`);
}

function cleanFocus(focus: Record<string, Focus> | undefined): Record<string, Focus> {
  const out: Record<string, Focus> = {};
  for (const [format, region] of Object.entries(focus ?? {})) {
    if (!(FOOTAGE_FORMATS as readonly string[]).includes(format)) throw new LibraryError(`no format "${format}" (use ${FOOTAGE_FORMATS.join(", ")})`);
    const parsed = FocusSchema.safeParse(region);
    if (!parsed.success) throw new LibraryError(`focus for ${format}: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    out[format] = parsed.data;
  }
  return out;
}

/**
 * Add a moment. Every moment is usable as soon as it is added, whoever marked it: Claude indexing a
 * recording from its filmstrip applies directly. `origin` still says who marked it, so the studio can show it.
 */
export function addMoment(id: string, input: MomentInput, by: "user" | "claude" | "generated" = "user"): { asset: LibraryAsset; moment: Moment } {
  return mutateIndex((index) => {
    const asset = requireVideo(index.assets.find((a) => a.id === id), id);
    checkRange(asset, input);
    const label = input.label.trim();
    if (!label) throw new LibraryError("a moment needs a label: what the viewer sees happen");
    const footage = footageOf(asset);
    if (footage.moments.length >= MAX_MOMENTS) throw new LibraryError(`this recording already has ${MAX_MOMENTS} moments`);
    const moment: Moment = {
      id: `m_${randomBytes(4).toString("hex")}`,
      label: label.slice(0, 120),
      in: Math.round(input.in * 1000) / 1000,
      out: Math.round(input.out * 1000) / 1000,
      tags: normaliseTags(input.tags ?? []),
      state: "confirmed",
      origin: by === "user" ? "user" : "claude",
      focus: cleanFocus(input.focus),
      ...(input.note ? { note: input.note.slice(0, 300) } : {}),
    };
    asset.footage = { ...footage, moments: [...footage.moments, moment] };
    return { asset, moment };
  });
}

export interface MomentPatch {
  label?: string;
  in?: number;
  out?: number;
  tags?: readonly string[];
  focus?: Record<string, Focus>;
  note?: string;
  /** A person confirming one of Claude's proposals. */
  confirm?: boolean;
}

/** Edit a moment. A moment left over as `proposed` from before indexing applied by itself becomes confirmed when it is edited. */
export function updateMoment(id: string, momentId: string, patch: MomentPatch): { asset: LibraryAsset; moment: Moment } {
  return mutateIndex((index) => {
    const asset = requireVideo(index.assets.find((a) => a.id === id), id);
    const footage = footageOf(asset);
    const current = footage.moments.find((m) => m.id === momentId);
    if (!current) throw new LibraryError(`no moment ${momentId} on ${id}`);
    const next: Moment = { ...current };
    if (patch.label !== undefined) {
      if (!patch.label.trim()) throw new LibraryError("a moment needs a label");
      next.label = patch.label.trim().slice(0, 120);
    }
    if (patch.in !== undefined) next.in = Math.round(patch.in * 1000) / 1000;
    if (patch.out !== undefined) next.out = Math.round(patch.out * 1000) / 1000;
    checkRange(asset, next);
    if (patch.tags !== undefined) next.tags = normaliseTags(patch.tags);
    if (patch.focus !== undefined) next.focus = cleanFocus(patch.focus);
    if (patch.note !== undefined) {
      if (patch.note.trim()) next.note = patch.note.trim().slice(0, 300);
      else delete next.note;
    }
    // Moving the edges changes what was agreed to, so the "yes, use it" is asked for again.
    if ((patch.in !== undefined && patch.in !== current.in) || (patch.out !== undefined && patch.out !== current.out)) delete next.acceptedAt;
    if (patch.confirm) next.state = "confirmed";
    else if (current.state === "proposed" && (patch.label !== undefined || patch.in !== undefined || patch.out !== undefined)) next.state = "confirmed";
    asset.footage = { ...footage, moments: footage.moments.map((m) => (m.id === momentId ? next : m)) };
    return { asset, moment: next };
  });
}

export function removeMoment(id: string, momentId: string): LibraryAsset {
  return mutateIndex((index) => {
    const asset = requireVideo(index.assets.find((a) => a.id === id), id);
    const footage = footageOf(asset);
    if (!footage.moments.some((m) => m.id === momentId)) throw new LibraryError(`no moment ${momentId} on ${id}`);
    asset.footage = { ...footage, moments: footage.moments.filter((m) => m.id !== momentId) };
    return asset;
  });
}

/**
 * Record that a person said yes to using a moment. After this a fresh, exact match is used by itself;
 * before it, the match is shown and asked about once. A render does this for what it rendered.
 */
export function acceptMoments(refs: readonly { assetId: string; momentId: string }[]): void {
  if (refs.length === 0) return;
  const now = new Date().toISOString();
  mutateIndex((index) => {
    for (const { assetId, momentId } of refs) {
      const asset = index.assets.find((a) => a.id === assetId);
      const footage = asset?.footage;
      const moment = footage?.moments.find((m) => m.id === momentId);
      if (!asset || !footage || !moment || moment.acceptedAt) continue;
      moment.acceptedAt = now;
    }
  });
}

/**
 * Work out what the deterministic pass can say about a video that came in without it — one added with
 * `library add`, or before footage existed — and fill in the size, frame rate, creation time, preview
 * and filmstrip. Never touches what a person wrote.
 */
export async function refreshFootageAnalysis(id: string): Promise<LibraryAsset> {
  const before = loadIndex().assets.find((a) => a.id === id);
  if (!before) throw new LibraryError(`no asset ${id}`);
  const thumbOut = path.join(libraryRoot(), "thumbs", `${id}.png`);
  const filmstripOut = path.join(libraryRoot(), "thumbs", `${id}-strip.png`);
  const result = await analyzeFile(blobPath(before), { thumbOut, filmstripOut });
  if ("skipped" in result) throw new LibraryError(`${id}: ${result.skipped}`);
  return mutateIndex((index) => {
    const asset = index.assets.find((a) => a.id === id)!;
    if (asset.mediaType === "other" && result.mediaType !== "other") asset.mediaType = result.mediaType;
    // What a person already wrote (a description) wins; what was measured is refreshed.
    asset.analysis = { ...asset.analysis, ...result.analysis, ...(asset.analysis.description ? { description: asset.analysis.description } : {}), dominantColors: result.analysis.dominantColors.length ? result.analysis.dominantColors : asset.analysis.dominantColors, ...(result.filmstrip ? { filmstrip: `thumbs/${id}-strip.png` } : {}) };
    if (!asset.thumb && result.thumb) asset.thumb = `thumbs/${id}.png`;
    return asset;
  });
}

// ---------------------------------------------------------------- finding the right moment

const STOP = new Set(["a", "an", "the", "to", "and", "of", "in", "on", "your", "you", "now", "then", "it", "this", "that", "with", "for", "is", "are", "step", "how", "our", "we", "my", "at", "by", "into", "up", "can", "will", "just", "so", "or", "from", "as"]);

/** Words a script and a person marking a moment use for the same thing. */
const SAME: readonly (readonly string[])[] = [
  ["download", "install", "get", "grab", "setup", "set"],
  ["add", "connect", "enable", "attach", "link"],
  ["upload", "import", "drop", "load"],
  ["open", "launch", "start", "run"],
  ["click", "press", "tap", "select", "hit"],
  ["sign", "login", "log", "signin"],
  ["create", "new", "make", "build"],
  ["settings", "preferences", "config", "configure", "options"],
  ["type", "write", "enter", "prompt"],
  ["skill", "plugin", "extension"],
];

function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

export function significantWords(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !STOP.has(w)).map(stem))];
}

function sameGroup(a: string, b: string): boolean {
  return SAME.some((g) => g.map(stem).includes(a) && g.map(stem).includes(b));
}

export type FootageConfidence = "exact" | "likely" | "guess";
const RANK: Record<FootageConfidence, number> = { exact: 3, likely: 2, guess: 1 };

export type FootageDecision = "auto" | "proposal";

export interface FootageMatch {
  asset: LibraryAsset;
  moment: Moment;
  confidence: FootageConfidence;
  decision: FootageDecision;
  score: number;
  /** Why it matched, and — for a proposal — why it was not applied. */
  why: string;
}

/**
 * Why a matched moment may not be used without asking, or `undefined` when it may.
 *
 * No approval, no confirmation and no private-information tick are needed: a recording and the moments
 * Claude indexes on it apply by themselves. What still makes a match a proposal is a weak match, a
 * recording that may be stale, and the first use of a moment, which is shown to the user once.
 */
export function footageBlockReason(asset: LibraryAsset, moment: Moment, confidence: FootageConfidence, now: Date): string | undefined {
  if (asset.review.state === "rejected") return "it was rejected";
  if (confidence !== "exact") return `${confidence} match`;
  if (asset.status !== "active") return `status is ${asset.status}`;
  const age = footageAgeDays(asset, now);
  if (age === undefined) return "the recording date is unknown — set it in the studio so staleness can be judged";
  if (age > STALE_CAPTURE_DAYS) return `recorded ${Math.floor(age)} days ago — confirm the screen has not changed`;
  if (!moment.acceptedAt) return "first use: show it to the user and ask once; after that it is used by itself";
  return undefined;
}

export interface FindOptions {
  now?: Date;
  /** Only recordings carrying every one of these tags. */
  tags?: readonly string[];
  /** Only recordings from this platform. */
  platform?: Footage["platform"];
}

/** The moments that answer a phrase like "download Claude", best first. */
export function findMoments(assets: readonly LibraryAsset[], phrase: string, options: FindOptions = {}): FootageMatch[] {
  const wanted = significantWords(phrase);
  if (wanted.length === 0) return [];
  const now = options.now ?? new Date();
  const need = normaliseTags(options.tags ?? []);
  const out: FootageMatch[] = [];

  for (const asset of assets) {
    // A generated clip is never the answer to "download Claude": it shows nothing that happened.
    if (!isFootage(asset) || isGenerated(asset) || asset.status !== "active" || asset.review.state === "rejected") continue;
    const footage = footageOf(asset);
    if (options.platform && footage.platform && footage.platform !== options.platform) continue;
    if (need.length && !need.every((t) => asset.tags.includes(t))) continue;
    // What describes the recording as a whole: the app on screen, and its own tags and name.
    const around = new Set(significantWords(`${footage.app ?? ""} ${asset.name} ${asset.tags.join(" ")} ${asset.analysis.description ?? ""}`));

    for (const moment of footage.moments) {
      const ofMoment = new Set(significantWords(`${moment.label} ${moment.tags.join(" ")}`));
      let direct = 0;
      let score = 0;
      const hits: string[] = [];
      for (const w of wanted) {
        if (ofMoment.has(w)) {
          direct += 1;
          score += 1;
          hits.push(w);
        } else if (around.has(w)) {
          // The product name is on the recording, not the moment: "claude" is the app, "download" is the step.
          direct += 1;
          score += 0.8;
          hits.push(w);
        } else if ([...ofMoment].some((m) => sameGroup(w, m))) {
          score += 0.6;
          hits.push(`${w}~`);
        }
      }
      const coverage = score / wanted.length;
      // The step itself has to be in the moment: an app match alone is a recording, not a moment.
      const stepWords = wanted.filter((w) => ofMoment.has(w) || [...ofMoment].some((m) => sameGroup(w, m)));
      if (stepWords.length === 0 || coverage < 0.34) continue;
      const confidence: FootageConfidence = direct === wanted.length && stepWords.length >= Math.ceil(wanted.length / 2) ? "exact" : coverage >= 0.6 ? "likely" : "guess";
      const blocked = footageBlockReason(asset, moment, confidence, now);
      out.push({
        asset,
        moment,
        confidence,
        decision: blocked ? "proposal" : "auto",
        score: Math.round(coverage * 100) / 100,
        why: blocked ? `${confidence}: ${hits.join(", ")}; not applied: ${blocked}` : `${confidence}: ${hits.join(", ")}`,
      });
    }
  }

  return out.sort(
    (a, b) =>
      RANK[b.confidence] - RANK[a.confidence] ||
      Number(b.decision === "auto") - Number(a.decision === "auto") ||
      b.score - a.score ||
      (recordedAt(b.asset) ?? "").localeCompare(recordedAt(a.asset) ?? "") ||
      a.moment.id.localeCompare(b.moment.id),
  );
}

// ---------------------------------------------------------------- fitting a moment to a beat

export interface Fit {
  ok: boolean;
  /** Playback rate: 1 unless the moment is longer than the slot. */
  rate: number;
  /** Seconds of the slot the recording is on screen. */
  playSeconds: number;
  /** Seconds after it ends that the last frame is held, when the moment is shorter than the slot. */
  holdSeconds: number;
  notes: string[];
  /** When it does not fit: the ways out, in the order to try them. */
  options: string[];
}

/**
 * How a moment fits a slot in a beat.
 *
 * The beat is as long as the voiceover says; the recording adapts, and only in two directions that keep
 * it honest. Longer than the slot, it is played faster — one even rate, never more than `MAX_SPEED`, so
 * every step still happens in order. Shorter, it ends and its last frame is held — that frame is the
 * result the viewer has to read. It is never slowed down and never looped. Past the limit it does not
 * fit, and that is reported with what to do about it rather than quietly cut.
 */
export function fitMoment(moment: Pick<Moment, "in" | "out">, slotSeconds: number, maxSpeed = MAX_SPEED): Fit {
  const length = momentSeconds(moment);
  const notes: string[] = [];
  if (!(slotSeconds > 0)) return { ok: false, rate: 1, playSeconds: 0, holdSeconds: 0, notes, options: ["give the footage a slot longer than zero"] };

  if (length <= slotSeconds + 0.05) {
    const hold = Math.max(0, Math.round((slotSeconds - length) * 1000) / 1000);
    if (hold > 1.5 && hold > slotSeconds * 0.35) notes.push(`the recording ends ${hold.toFixed(1)}s before the beat does, and its last frame is held for that long`);
    return { ok: true, rate: 1, playSeconds: Math.min(length, slotSeconds), holdSeconds: hold > 0.05 ? hold : 0, notes, options: [] };
  }

  const rate = length / slotSeconds;
  if (rate <= maxSpeed + 1e-9) {
    const rounded = Math.round(rate * 10000) / 10000;
    if (rounded > 1.5) notes.push(`played at ${rounded.toFixed(2)}x: fast, but every step still happens in order`);
    return { ok: true, rate: rounded, playSeconds: slotSeconds, holdSeconds: 0, notes, options: [] };
  }

  return {
    ok: false,
    rate: maxSpeed,
    playSeconds: slotSeconds,
    holdSeconds: 0,
    notes,
    options: [
      `mark a tighter moment: at most ${(slotSeconds * maxSpeed).toFixed(1)}s (it is ${length.toFixed(1)}s)`,
      `give the beat at least ${(length / maxSpeed).toFixed(1)}s so it plays at ${maxSpeed}x`,
      "split the beat in two, one step each",
      "compose the beat as an animation or as type instead — a stand-in, not the real recording",
    ],
  };
}

/**
 * How a generated clip fits a beat. It has no steps to keep in order, so it is never sped up: longer than
 * the slot it is cut at the tail; shorter, its last frame is held. Its length is chosen when it is made, to
 * match the beat, so this is the edge case.
 */
export function fitGenerated(moment: Pick<Moment, "in" | "out">, slotSeconds: number): Fit {
  const length = momentSeconds(moment);
  if (!(slotSeconds > 0)) return { ok: false, rate: 1, playSeconds: 0, holdSeconds: 0, notes: [], options: ["give the clip a slot longer than zero"] };
  if (length <= slotSeconds + 0.05) {
    const hold = Math.max(0, Math.round((slotSeconds - length) * 1000) / 1000);
    return { ok: true, rate: 1, playSeconds: Math.min(length, slotSeconds), holdSeconds: hold > 0.05 ? hold : 0, notes: hold > 0.8 ? [`the generated clip is ${length.toFixed(1)}s and the beat is ${slotSeconds.toFixed(1)}s: its last frame is held for ${hold.toFixed(1)}s`] : [], options: [] };
  }
  const cut = Math.round((length - slotSeconds) * 1000) / 1000;
  return { ok: true, rate: 1, playSeconds: slotSeconds, holdSeconds: 0, notes: [`the generated clip is cut ${cut.toFixed(1)}s short at the end (it is never sped up)`], options: [] };
}

// ---------------------------------------------------------------- will it be readable

/** A reasonable guess at body UI text as recorded: a Retina capture holds it at about twice the size. */
export function estimatedTextPx(asset: LibraryAsset): number {
  return footageOf(asset).textPx ?? ((asset.analysis.width ?? 0) >= 2200 ? 26 : 14);
}

export interface LegibilityBox {
  /** The size of the box it is shown in, in frame pixels. */
  boxWidth: number;
  boxHeight: number;
  frameWidth: number;
  format: string;
}

/**
 * Whether the text in a moment will be readable at the size it is shown, using the same floor as a
 * capture. A saved focus region for the reel's format is counted: zooming in is how it becomes legible.
 */
export function footageLegibility(asset: LibraryAsset, moment: Moment, box: LegibilityBox): LegibilityVerdict | undefined {
  const width = asset.analysis.width;
  const height = asset.analysis.height;
  if (!width || !height) return undefined;
  const region = moment.focus[box.format];
  const shownW = width * (region?.w ?? 1);
  const shownH = height * (region?.h ?? 1);
  // The region is fitted inside the box, never stretched, so the tighter side sets the scale.
  const scale = Math.min(box.boxWidth / shownW, box.boxHeight / shownH);
  return legibilityVerdict({
    captureWidth: shownW,
    targetWidthFraction: (shownW * scale) / box.frameWidth,
    frameWidth: box.frameWidth,
    fontSizes: [{ px: estimatedTextPx(asset), chars: 1 }],
  });
}
