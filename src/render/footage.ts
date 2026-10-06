import { copyFileSync, linkSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { LIBRARY_ASSET_DIR } from "../library/refs.js";
import { fitGenerated, fitMoment, footageAgeDays, footageOf, isFootage, isGenerated, momentSeconds, type Fit } from "../library/footage.js";
import { isKeyed, keyOf, momentKeyView, wantsKey, type KeyView } from "../library/key.js";
import { STALE_CAPTURE_DAYS } from "../library/match.js";
import type { LibraryAsset, Moment } from "../library/schema.js";
import { formatSeconds, ProjectError } from "./project.js";

/**
 * Put recorded footage into a beat, exactly as it was recorded.
 *
 * A composition says *which* moment and *where*; this works out everything else. It writes
 *
 *     <div class="rc-footage" data-footage="<asset>:<moment>" data-at="0.4" data-for="2.6" data-frame="window"></div>
 *
 * into the `<video>` that plays that stretch of the recording — the trim as `data-media-start`, a
 * uniform speed-up as `data-playback-rate`, a held last frame when the recording ends before the beat —
 * so none of those numbers is ever typed by hand and none can disagree with the moment in the library.
 * The file is not opened, re-encoded or rewritten: what reaches the frame is the recorded pixels.
 *
 * It refuses, with the reason, anything that should not reach a reel: a rejected file, or a moment too
 * long for its slot to be played at a believable speed.
 */

export class FootageError extends ProjectError {}

export interface FootageContext {
  assets: readonly LibraryAsset[];
  /** The reel's format, e.g. "1:1": a moment's saved focus region is per format. */
  format: string;
  beat: { id: string; durationSeconds: number };
  now?: Date;
  /** How keyed copies are found; the library's own by default. Here so a test needs no files. */
  keyed?: { isKeyed: (asset: LibraryAsset) => boolean; view: (asset: LibraryAsset, moment: Moment) => KeyView | undefined };
}

/** One placement of a moment in a beat. */
export interface FootageUse {
  assetId: string;
  momentId: string;
  label: string;
  /** Seconds into the beat. */
  at: number;
  fit: Fit;
  /** Made by a model, not recorded: the report says so. */
  generated: boolean;
}

/** A still of a moment's last frame, shown after the recording ends. Made once per render from the library blob. */
export interface HoldFrame {
  /** Path inside the project, e.g. `assets/library/<id>-<moment>-hold.png`. */
  target: string;
  assetId: string;
  /** Seconds into the recording to take it from. */
  at: number;
  /** Take it from the keyed copy (which has transparency) instead of the recording. */
  keyed?: boolean;
}

export interface Expansion {
  html: string;
  uses: FootageUse[];
  holds: HoldFrame[];
  warnings: string[];
}

const REF = /^([0-9a-f]{16}):(m_[0-9a-f]{8})$/;
const OPEN = /<([a-z][a-z0-9]*)\b([^>]*?)\bdata-footage\s*=\s*["']([^"']*)["']([^>]*)>/gi;
const INNER = /^\s*<div\b[^>]*\bclass\s*=\s*["'][^"']*\brc-fv\b[^"']*["'][^>]*>/i;

export function usesFootage(html: string): boolean {
  return /\bdata-footage\s*=/.test(html);
}

function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(attrs)?.[1];
}

function number(attrs: string, name: string, fallback: number, where: string): number {
  const raw = attr(attrs, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new FootageError(`${where}: ${name}="${raw}" must be a number of seconds, 0 or more`);
  return value;
}

/** What stops a moment reaching a render, and what only needs saying. */
export function footageRenderProblems(asset: LibraryAsset, moment: Moment, now: Date): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const name = `"${moment.label}" (${asset.name})`;
  // No approval, confirmation or private-information tick is required: clips and Claude's moments apply by
  // themselves. Only a person's explicit rejection stops one.
  if (asset.review.state === "rejected") errors.push(`${name} was rejected`);
  if (isGenerated(asset)) {
    if (asset.status !== "active") warnings.push(`${name} is ${asset.status}`);
    return { errors, warnings };
  }
  if (asset.status !== "active") warnings.push(`${name} is ${asset.status}${asset.supersededBy ? ` by ${asset.supersededBy}` : ""}`);
  const age = footageAgeDays(asset, now);
  if (age === undefined) warnings.push(`${name}: the recording date is unknown, so it cannot be judged stale`);
  else if (age > STALE_CAPTURE_DAYS) warnings.push(`${name} was recorded ${Math.floor(age)} days ago — check the screen has not changed since`);
  return { errors, warnings };
}

/** Expand every `data-footage` placeholder in a composition. Unchanged when there are none. */
export function expandFootage(html: string, ctx: FootageContext): Expansion {
  const uses: FootageUse[] = [];
  const holds: HoldFrame[] = [];
  const warnings: string[] = [];
  if (!usesFootage(html)) return { html, uses, holds, warnings };

  const now = ctx.now ?? new Date();
  const where = ctx.beat.id;
  let out = "";
  let last = 0;
  let count = 0;
  const re = new RegExp(OPEN.source, "gi");

  for (let m = re.exec(html); m; m = re.exec(html)) {
    const [tag, name, before, ref, after] = m as unknown as [string, string, string, string, string];
    const parsed = REF.exec(ref);
    if (!parsed) throw new FootageError(`${where}: data-footage="${ref}" must be <asset id>:<moment id>, as \`npm run footage -- find\` prints it`);
    const [, assetId, momentId] = parsed as unknown as [string, string, string];
    const asset = ctx.assets.find((a) => a.id === assetId);
    if (!asset || !isFootage(asset)) throw new FootageError(`${where}: ${assetId} is not a recording in the library`);
    const moment = footageOf(asset).moments.find((x) => x.id === momentId);
    if (!moment) throw new FootageError(`${where}: no moment ${momentId} on ${asset.name} (${assetId}) — it may have been deleted in the studio`);

    const attrs = `${before}${after}`;
    const problems = footageRenderProblems(asset, moment, now);
    if (problems.errors.length) throw new FootageError(`${where}: ${problems.errors.join("; ")}`);
    warnings.push(...problems.warnings.map((w) => `${where}: ${w}`));

    const at = number(attrs, "data-at", 0, where);
    const slot = number(attrs, "data-for", ctx.beat.durationSeconds - at, where);
    if (at + slot > ctx.beat.durationSeconds + 0.02) throw new FootageError(`${where}: the footage is placed at ${at}s for ${slot}s, which runs past the end of the ${ctx.beat.durationSeconds}s beat`);
    const generated = isGenerated(asset);
    const fit = generated ? fitGenerated(moment, slot) : fitMoment(moment, slot);
    if (!fit.ok) {
      throw new FootageError(`${where}: "${moment.label}" is ${momentSeconds(moment).toFixed(1)}s and the slot is ${slot.toFixed(1)}s — more than ${fit.rate}x would be needed, so it was not cut or hurried.\n    Ways out:\n    - ${fit.options.join("\n    - ")}`);
    }
    warnings.push(...fit.notes.map((n) => `${where}: "${moment.label}": ${n}`));

    // A recording on a green screen is placed as its transparent copy. If it cannot be, the beat is refused:
    // a green square in a finished reel is worse than a beat that says what to do.
    const keyedCopy = !generated && (ctx.keyed?.isKeyed ?? isKeyed)(asset);
    if (!generated && !keyedCopy && wantsKey(asset)) {
      const why = keyOf(asset).error;
      throw new FootageError(`${where}: "${moment.label}" is on a green screen and has no keyed copy${why ? ` (${why})` : " yet"} — run: npm run footage -- key ${asset.id}, or turn keying off for it`);
    }
    const view = keyedCopy ? (ctx.keyed?.view ?? momentKeyView)(asset, moment) : undefined;

    count += 1;
    const id = `rcf-${where}-${count}`;
    const file = keyedCopy ? `${LIBRARY_ASSET_DIR}/${asset.id}-key.webm` : `${LIBRARY_ASSET_DIR}/${path.basename(asset.file)}`;
    const footage = footageOf(asset);
    if (keyedCopy && !footage.muted && asset.analysis.hasAudio === true) warnings.push(`${where}: "${moment.label}": the recording's sound is not carried into its keyed copy`);
    const hasSound = !keyedCopy && !footage.muted && asset.analysis.hasAudio === true;
    // The keyed copy is the whole frame; the box shows only where the subject is for this moment.
    const pct = (v: number): string => `${Math.round(v * 100000) / 1000}%`;
    const place = view ? ` style="position:absolute;right:auto;bottom:auto;left:${pct(-view.x / view.w)};top:${pct(-view.y / view.h)};width:${pct(1 / view.w)};height:${pct(1 / view.h)};object-fit:fill"` : "";
    const media = [
      `id="${id}"`,
      `src="${file}"`,
      `data-start="${formatSeconds(at)}"`,
      `data-duration="${formatSeconds(fit.playSeconds)}"`,
      // Where in the recording to start is a position in the file, not a frame-exact placement on the beat's
      // timeline: written a hair low it would land on the frame before the one the person marked.
      `data-media-start="${Math.round(moment.in * 1000) / 1000}"`,
      ...(fit.rate !== 1 ? [`data-playback-rate="${fit.rate}"`] : []),
      ...(hasSound ? ['data-has-audio="true"', 'data-volume="1"'] : ["muted"]),
      "playsinline",
      'preload="auto"',
    ].join(" ");
    let inner = `<video ${media}${place}></video>`;
    if (fit.holdSeconds > 0) {
      // A keyed hold frame is named for the settings it was made with, so changing them never reuses an old still.
      const target = `${LIBRARY_ASSET_DIR}/${asset.id}-${moment.id}-hold${keyedCopy ? `-${keyOf(asset).hash?.slice(0, 8) ?? "key"}` : ""}.png`;
      holds.push({ target, assetId: asset.id, at: Math.max(moment.in, moment.out - 0.05), ...(keyedCopy ? { keyed: true } : {}) });
      inner += `<img class="rc-fh" alt="" src="${target}" data-start="${formatSeconds(at + fit.playSeconds)}" data-duration="${formatSeconds(fit.holdSeconds)}"${place}>`;
    }
    uses.push({ assetId: asset.id, momentId: moment.id, label: moment.label, at, fit, generated });

    // The wrapper keeps what the author wrote, plus what only the library knows: the recording's shape.
    const focus = moment.focus[ctx.format];
    const vars = view ? `--fw:${view.px.w};--fh:${view.px.h};` : `--fw:${asset.analysis.width ?? 16};--fh:${asset.analysis.height ?? 9};`;
    let attrText = `${before}${after}`;
    // A cut-out sits on the reel's ground with nothing around it, unless the composition asks for a frame.
    if (keyedCopy) attrText += `${attr(attrs, "data-frame") === undefined ? ' data-frame="cutout"' : ""} data-keyed="true"`;
    attrText = /\bstyle\s*=\s*["']/i.test(attrText) ? attrText.replace(/\bstyle\s*=\s*(["'])/i, `style=$1${vars}`) : `${attrText} style="${vars}"`;
    if (focus) attrText += ` data-focus="${[focus.x, focus.y, focus.w, focus.h].map((n) => Math.round(n * 10000) / 10000).join(",")}"`;
    // The wrapper's own timing is not the video's: strip it so HyperFrames does not treat it as a clip.
    attrText = attrText.replace(/\sdata-(start|duration)\s*=\s*["'][^"']*["']/gi, "");
    const open = `<${name}${attrText.replace(/\s+$/, "")} data-footage="${ref}">`;

    out += html.slice(last, m.index) + open;
    const tail = html.slice(m.index + tag.length);
    const existing = INNER.exec(tail);
    if (existing) {
      out += tail.slice(0, existing[0].length) + inner;
      last = m.index + tag.length + existing[0].length;
    } else {
      out += `<div class="rc-fv">${inner}</div>`;
      last = m.index + tag.length;
    }
    re.lastIndex = last;
  }

  return { html: out + html.slice(last), uses, holds, warnings };
}

/** Videos at least this big are linked into a project instead of copied: a 2 GB recording is not duplicated per clip. */
export const LINK_FROM_BYTES = 32 * 1024 * 1024;

/**
 * Put a library blob into a render project. A big video is hardlinked, so it costs no disk and no copy time;
 * where a link cannot be made (another drive, a filesystem without links) it is copied. Either way the
 * library's own file is never opened for writing, and removing the project removes only the link.
 */
export function linkOrCopy(source: string, target: string, bytes: number, options: { threshold?: number; link?: (from: string, to: string) => void } = {}): "linked" | "copied" {
  mkdirSync(path.dirname(target), { recursive: true });
  if (bytes >= (options.threshold ?? LINK_FROM_BYTES)) {
    try {
      rmSync(target, { force: true });
      (options.link ?? linkSync)(source, target);
      return "linked";
    } catch {
      // fall through to a copy
    }
  }
  copyFileSync(source, target);
  return "copied";
}
