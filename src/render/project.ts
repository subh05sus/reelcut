/**
 * Beats plus their compositions, in; a HyperFrames project, out.
 *
 * This is the seam that kept the skill from ever producing a video. Everything upstream — beats,
 * briefs, captures — was data; everything downstream — `check`, `render`, the frame checker — was
 * a tool waiting for a project. Nothing turned one into the other.
 *
 * It emits two shapes of the same content:
 *
 *   master/                  every beat mounted on hard cuts — the whole reel
 *   clips/beat-03/           one standalone project per beat — what goes into an edit
 *
 * Each clip is its own project directory on purpose. A beat that fails `check` or renders wrong
 * then fails *alone*: the other fourteen still ship. One shared project would let a single layout
 * collision take the whole reel down with it.
 *
 * Pure: it returns files as strings and never touches the disk, so every invariant below is
 * testable without a browser. `writeProject` in the script is the only thing that writes.
 */

export interface ProjectBeat {
  /** Stable id, e.g. "beat-03". Becomes the composition id, the host id and the timeline key. */
  id: string;
  durationSeconds: number;
  /** The sub-composition file's full text — a `<template>` whose root carries `data-composition-id`. */
  compositionHtml: string;
  /** Sound effects placed relative to the start of this beat. Only used when `--sfx` is on. */
  sfx?: readonly SfxCue[];
}

export interface SfxCue {
  /** Path to the audio file, copied into the project's `assets/sfx/`. */
  source: string;
  /** Seconds from the start of the beat. */
  at: number;
  /** Seconds the sound lasts. Probe the file; HyperFrames needs it on the element. */
  durationSeconds: number;
  /** 0..1. Effects sit under everything; see the note on `SFX_DEFAULT_VOLUME`. */
  volume?: number;
}

export interface ProjectOptions {
  width: number;
  height: number;
  fps: number;
  /** Colour behind everything, visible only if a beat fails to paint. */
  ground?: string;
  /** The design kit, injected into every composition that opts in with `data-look`. */
  kit?: Kit;
}

/** `skills/reelcut/assets/kit/`: shared CSS and motion helpers. */
export interface Kit {
  css: string;
  js: string;
}

/** A composition opts into the kit by choosing a look on its root. */
export function usesKit(html: string): boolean {
  return /<[^>]+\sdata-look\s*=/.test(html);
}

/**
 * Put the kit at the top of a composition's `<template>`.
 *
 * Inside the template, because a sub-composition's styles and scripts outside it are discarded;
 * first, so the helpers exist before the composition's own script runs and the font `@import` is
 * the stylesheet's first rule. A composition that already carries the kit is left alone.
 */
export function injectKit(html: string, kit: Kit): string {
  if (!usesKit(html) || html.includes("data-rc-kit")) return html;
  // `$` in the kit's text must not be read as a replacement pattern.
  return html.replace(/<template(\s[^>]*)?>/i, (open) => `${open}
<style data-rc-kit>
${kit.css}
</style>
<script data-rc-kit>
${kit.js}
</script>
`);
}

export interface ProjectFile {
  /** Path relative to the project root. */
  path: string;
  contents: string;
}

export interface BuiltProject {
  master: ProjectFile[];
  clips: Record<string, ProjectFile[]>;
  /** Every audio file the project references, with where it goes, so the caller can copy them. */
  assets: { source: string; target: string }[];
  totalSeconds: number;
  /** Each beat's frame-exact placement in the master. */
  placements: BeatPlacement[];
}

export interface BeatPlacement {
  id: string;
  startFrame: number;
  endFrame: number;
  startSeconds: number;
  durationSeconds: number;
}

/**
 * Effects sit well under a voiceover.
 *
 * A whoosh at full level on every cut is the fastest way to make a piece sound like a template.
 * The rule is the one a mix engineer would give: sounds support the motion, they do not announce it.
 */
export const SFX_DEFAULT_VOLUME = 0.35;

/** Pinned so a project re-renders identically months later. */
export const GSAP_URL = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js";

const HYPERFRAMES_JSON = `${JSON.stringify(
  {
    $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
    registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
    paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
    media: { autoProxy: true },
  },
  null,
  2,
)}\n`;

export class ProjectError extends Error {}

const ID = /^[a-z][a-z0-9-]*$/;

/**
 * What a sub-composition file declares about itself.
 *
 * Read with patterns rather than a DOM parser, because the checks are about three specific
 * attributes and a string key, and pulling in a parser to find them would be the only runtime
 * dependency this module had.
 */
export function inspectComposition(html: string): { compositionId?: string; timelineKey?: string; hasTemplate: boolean; width?: number; height?: number } {
  const root = /<[a-z]+[^>]*\bid=["']root["'][^>]*>/i.exec(html)?.[0] ?? "";
  const attr = (name: string): string | undefined => new RegExp(`\\b${name}=["']([^"']+)["']`, "i").exec(root)?.[1];
  const timelineKey = /window\.__timelines\s*\[\s*["']([^"']+)["']\s*\]\s*=/.exec(html)?.[1];
  const width = attr("data-width");
  const height = attr("data-height");
  return {
    hasTemplate: /<template[\s>]/i.test(html),
    ...(attr("data-composition-id") ? { compositionId: attr("data-composition-id")! } : {}),
    ...(timelineKey ? { timelineKey } : {}),
    ...(width ? { width: Number(width) } : {}),
    ...(height ? { height: Number(height) } : {}),
  };
}

/**
 * The invariant that fails silently if it is wrong, checked loudly here.
 *
 * HyperFrames binds a sub-composition by matching the host's `data-composition-id` to the key the
 * file registers its timeline under. With two or more timelines registered, a mismatch does not
 * error — it leaves the render **frozen at t=0**, and `check` can still report a clean layout for
 * the still frame. So a typo in an id produces a green gate and a still video. This refuses the
 * project instead.
 */
export function assertComposition(beat: ProjectBeat, options: ProjectOptions): void {
  if (!ID.test(beat.id)) throw new ProjectError(`${beat.id}: ids must be lowercase letters, digits and hyphens, starting with a letter`);

  const info = inspectComposition(beat.compositionHtml);
  const problems: string[] = [];
  if (!info.hasTemplate) problems.push("no <template> — a sub-composition's contents must be inside one or the runtime discards them");
  if (info.compositionId !== beat.id) problems.push(`root data-composition-id is ${JSON.stringify(info.compositionId)}, expected "${beat.id}"`);
  if (info.timelineKey !== beat.id) problems.push(`timeline registered as ${JSON.stringify(info.timelineKey)}, expected window.__timelines["${beat.id}"]`);
  if (info.width !== undefined && info.width !== options.width) problems.push(`data-width is ${info.width}, the reel is ${options.width}`);
  if (info.height !== undefined && info.height !== options.height) problems.push(`data-height is ${info.height}, the reel is ${options.height}`);

  if (problems.length > 0) {
    throw new ProjectError(`${beat.id}: ${problems.join("; ")}. A mismatched id renders frozen at t=0 without an error, so this is refused rather than rendered.`);
  }
}

/**
 * Frame-exact placement, with rounding error that cannot accumulate.
 *
 * The obvious approach — round each beat's duration to whole frames, then sum — is wrong: every
 * beat contributes up to half a frame of error, and across fifteen beats the cut drifts by several
 * frames against anything timed to the script. Rounding each beat's *end* on the cumulative
 * timeline instead bounds the error at half a frame at every boundary, forever.
 */
export function placeBeats(beats: readonly { id: string; durationSeconds: number }[], fps: number): BeatPlacement[] {
  const out: BeatPlacement[] = [];
  let elapsed = 0;
  let startFrame = 0;
  for (const beat of beats) {
    if (!(beat.durationSeconds > 0)) throw new ProjectError(`${beat.id}: duration must be positive, got ${beat.durationSeconds}`);
    elapsed += beat.durationSeconds;
    const endFrame = Math.round(elapsed * fps);
    if (endFrame <= startFrame) throw new ProjectError(`${beat.id}: ${beat.durationSeconds}s is shorter than one frame at ${fps}fps`);
    out.push({ id: beat.id, startFrame, endFrame, startSeconds: startFrame / fps, durationSeconds: (endFrame - startFrame) / fps });
    startFrame = endFrame;
  }
  return out;
}

/**
 * A time in seconds, written so the renderer lands on exactly the frame intended.
 *
 * Rounded DOWN at six decimals, never to nearest. The first version rounded to four, which wrote
 * 122 frames at 30fps as `4.0667` — that is 122.001 frames, and the renderer rounds up, so the clip
 * came out 123 frames long. Worse, it was intermittent: `6.6667` is also 200.001 frames and rendered
 * correctly, because whether float noise tips a value over the boundary depends on the value. Every
 * placement here is a whole number of frames, so writing each a hair below its boundary makes the
 * frame count exact regardless of how the renderer rounds.
 */
export function formatSeconds(value: number): string {
  if (value <= 0) return "0";
  /*
   * Floor alone is not enough. When the true value is a clean decimal — 7 frames at 25fps is
   * exactly 0.28 — flooring changes nothing, and 0.28 × 25 in floating point is 7.000000000000001:
   * one unit over the boundary, which is the very failure this exists to prevent. Found by the
   * exhaustive test over 1–3000 frames at four frame rates. Subtracting a micro-unit before
   * flooring puts every value clearly below its frame, never on it.
   */
  return (Math.floor(value * 1e6 - 1e-6) / 1e6).toString();
}
const seconds = formatSeconds;

function audioElements(cues: readonly SfxCue[], offsetSeconds: number, idPrefix: string, assets: BuiltProject["assets"]): string {
  return cues
    .map((cue, i) => {
      const file = cue.source.replace(/\\/g, "/").split("/").pop()!;
      const target = `assets/sfx/${file}`;
      if (!assets.some((a) => a.target === target)) assets.push({ source: cue.source, target });
      // An <audio> with no id is never picked up by the mixer, and the render is silent.
      return `      <audio id="${idPrefix}-sfx-${i}" src="${target}" data-start="${seconds(offsetSeconds + cue.at)}" data-duration="${seconds(cue.durationSeconds)}" data-volume="${cue.volume ?? SFX_DEFAULT_VOLUME}" data-track-index="1"></audio>`;
    })
    .join("\n");
}

function hostHtml(args: {
  id: string;
  totalSeconds: number;
  options: ProjectOptions;
  clips: string;
  audio: string;
}): string {
  const { id, totalSeconds, options, clips, audio } = args;
  const ground = options.ground ?? "#111111";
  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${options.width}, height=${options.height}" />
    <script src="${GSAP_URL}"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${options.width}px; height: ${options.height}px; overflow: hidden; background: ${ground}; }
      #root { width: 100%; height: 100%; position: relative; background: ${ground}; }
    </style>
  </head>
  <body>
    <!-- Generated by reelcut. Every boundary is a hard cut: nothing here overlaps. -->
    <div id="root" data-composition-id="${id}" data-start="0" data-duration="${seconds(totalSeconds)}" data-width="${options.width}" data-height="${options.height}" data-fps="${options.fps}">
${clips}${audio ? `\n${audio}` : ""}
    </div>
    <script>
      // The host owns no motion, but a registered timeline must exist or nothing binds.
      window.__timelines = window.__timelines || {};
      window.__timelines["${id}"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;
}

function clipElement(id: string, start: number, duration: number, options: ProjectOptions): string {
  return `      <div id="${id}" class="clip" data-composition-id="${id}" data-composition-src="compositions/${id}.html" data-start="${seconds(start)}" data-duration="${seconds(duration)}" data-track-index="0" data-width="${options.width}" data-height="${options.height}"></div>`;
}

/**
 * Build the master and one standalone project per beat.
 *
 * `sfx` is only honoured when `withSfx` is true — sound is opt-in, so a run without `--sfx` renders
 * silent even if the briefs mentioned sounds.
 */
export function buildProject(beats: readonly ProjectBeat[], options: ProjectOptions, withSfx = false): BuiltProject {
  if (beats.length === 0) throw new ProjectError("no beats to build");
  const seen = new Set<string>();
  for (const beat of beats) {
    if (seen.has(beat.id)) throw new ProjectError(`duplicate beat id ${beat.id}`);
    seen.add(beat.id);
    assertComposition(beat, options);
  }

  if (options.kit) {
    const kit = options.kit;
    beats = beats.map((beat) => ({ ...beat, compositionHtml: injectKit(beat.compositionHtml, kit) }));
  }

  const placements = placeBeats(beats, options.fps);
  const totalSeconds = placements[placements.length - 1]!.endFrame / options.fps;
  const assets: BuiltProject["assets"] = [];

  const masterClips = placements.map((p) => clipElement(p.id, p.startSeconds, p.durationSeconds, options)).join("\n");
  const masterAudio = withSfx
    ? beats
        .map((beat, i) => audioElements(beat.sfx ?? [], placements[i]!.startSeconds, beat.id, assets))
        .filter(Boolean)
        .join("\n")
    : "";

  const master: ProjectFile[] = [
    { path: "index.html", contents: hostHtml({ id: "reel", totalSeconds, options, clips: masterClips, audio: masterAudio }) },
    { path: "hyperframes.json", contents: HYPERFRAMES_JSON },
    ...beats.map((beat) => ({ path: `compositions/${beat.id}.html`, contents: beat.compositionHtml })),
  ];

  const clips: Record<string, ProjectFile[]> = {};
  beats.forEach((beat, i) => {
    const placement = placements[i]!;
    const clipAssets: BuiltProject["assets"] = [];
    const audio = withSfx ? audioElements(beat.sfx ?? [], 0, beat.id, clipAssets) : "";
    for (const a of clipAssets) if (!assets.some((x) => x.target === a.target)) assets.push(a);
    clips[beat.id] = [
      {
        path: "index.html",
        contents: hostHtml({
          id: `clip-${beat.id}`,
          totalSeconds: placement.durationSeconds,
          options,
          clips: clipElement(beat.id, 0, placement.durationSeconds, options),
          audio,
        }),
      },
      { path: "hyperframes.json", contents: HYPERFRAMES_JSON },
      { path: `compositions/${beat.id}.html`, contents: beat.compositionHtml },
    ];
  });

  return { master, clips, assets, totalSeconds, placements };
}
