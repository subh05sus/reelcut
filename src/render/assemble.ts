import { execFile, execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);

/**
 * Putting rendered clips together: how many render at once, the master as a join of the clips, the
 * poster baked into it, and contact sheets to look at instead of a browser preview.
 *
 * ## Why the master is a join, not a render
 *
 * The master used to be a second HyperFrames project mounting every beat as a sub-composition, so a
 * 60 s reel was rendered twice. Worse, it was not the same video: nested, some timelines are seeked with
 * their events suppressed, and a beat whose count runs from an `onUpdate` stayed at its first value
 * (Higgsfield test reel, 2026-10-06). Joining the clips that were rendered and checked takes seconds and
 * is, frame for frame, what passed.
 */

// ---------------------------------------------------------------- how many at once

export interface Machine {
  cpus: number;
  totalMemBytes: number;
}

export interface JobPlan {
  /** Clips rendering at the same time. */
  jobs: number;
  /** HyperFrames workers (Chrome processes) each of those renders gets. */
  workersPerJob: number;
}

const GB = 1024 ** 3;

/**
 * How many clips to render in parallel, and how many workers each gets.
 *
 * HyperFrames already spreads one render over several Chrome workers, so running clips side by side
 * only pays when the cores are shared out rather than oversubscribed: about three cores a clip, never
 * more than four clips, and no more clips than there are 4 GB of memory for (a worker is ~256 MB, the
 * `check` before it boots its own Chrome).
 */
export function planJobs(machine: Machine = { cpus: os.cpus().length, totalMemBytes: os.totalmem() }, requested?: number): JobPlan {
  const cpus = Math.max(1, machine.cpus);
  const byCpu = Math.max(1, Math.floor(cpus / 3));
  const byMem = Math.max(1, Math.floor(machine.totalMemBytes / (4 * GB)));
  const jobs = requested && requested > 0 ? Math.floor(requested) : Math.min(4, byCpu, byMem);
  return { jobs, workersPerJob: Math.max(1, Math.floor(cpus / jobs)) };
}

/** Run `fn` over `items`, at most `jobs` at a time, keeping results in input order. */
export async function runPool<T, R>(items: readonly T[], jobs: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, items.length)) }, lane));
  return results;
}

// ---------------------------------------------------------------- reading a file

export interface StreamInfo {
  frames: number;
  hasAudio: boolean;
  /** Audio sample rate, when there is audio. */
  sampleRate?: number;
  durationSeconds: number;
}

/**
 * Frame count without decoding: packets, not frames. For the H.264 HyperFrames writes, one packet is
 * one frame, and counting packets reads only the container.
 */
export function streamInfo(file: string): StreamInfo {
  const out = execFileSync("ffprobe", ["-v", "error", "-count_packets", "-show_entries", "stream=codec_type,nb_read_packets,sample_rate", "-show_entries", "format=duration", "-of", "json", file], { encoding: "utf8" });
  const parsed = JSON.parse(out) as { streams?: { codec_type?: string; nb_read_packets?: string; sample_rate?: string }[]; format?: { duration?: string } };
  const video = parsed.streams?.find((s) => s.codec_type === "video");
  const audio = parsed.streams?.find((s) => s.codec_type === "audio");
  return {
    frames: Number(video?.nb_read_packets ?? 0),
    hasAudio: Boolean(audio),
    ...(audio?.sample_rate ? { sampleRate: Number(audio.sample_rate) } : {}),
    durationSeconds: Number(parsed.format?.duration ?? 0),
  };
}

/** Decoded frame count: the slow, exact one, for checking a re-encode did not add or drop a frame. */
export function decodedFrameCount(file: string): number {
  const out = execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "default=noprint_wrappers=1:nokey=1", file], { encoding: "utf8" });
  return Number(out.trim());
}

// ---------------------------------------------------------------- the master

export interface JoinClip {
  file: string;
  /** Frames this clip must have: its placement in the reel. A clip with a different count is stale. */
  frames: number;
  fps: number;
}

export interface JoinResult {
  ok: boolean;
  detail: string;
  frames?: number;
}

/**
 * Join clips into the master, in order, on hard cuts.
 *
 * The video is stream-copied (every clip comes from the same encoder settings), so the master is the
 * clips' own frames. Audio is rebuilt: a clip without sound effects has no audio track at all, and a
 * concat of mixed clips would drop or misalign it, so each clip's audio — or silence of its exact
 * length — is laid end to end and encoded once.
 *
 * Every clip's frame count is checked against its placement first: a clip left over from an earlier
 * cut with different timings would shift every beat after it.
 */
export function joinClips(clips: readonly JoinClip[], outFile: string, workDir: string): JoinResult {
  if (clips.length === 0) return { ok: false, detail: "no clips to join" };
  const infos = clips.map((c) => ({ clip: c, info: streamInfo(c.file) }));
  const stale = infos.filter(({ clip, info }) => info.frames !== clip.frames);
  if (stale.length > 0) {
    return { ok: false, detail: `frame count differs from the reel's timing: ${stale.map(({ clip, info }) => `${path.basename(clip.file)} has ${info.frames}, needs ${clip.frames}`).join("; ")} — re-render ${stale.length === 1 ? "it" : "them"}` };
  }

  mkdirSync(workDir, { recursive: true });
  const list = path.join(workDir, "concat.txt");
  writeFileSync(list, clips.map((c) => `file '${path.resolve(c.file).replace(/'/g, "'\\''")}'`).join("\n") + "\n", "utf8");
  const videoOnly = path.join(workDir, "video.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-map", "0:v", "-c", "copy", "-an", videoOnly]);

  const withAudio = infos.filter(({ info }) => info.hasAudio);
  if (withAudio.length === 0) {
    rmSync(outFile, { force: true });
    mkdirSync(path.dirname(outFile), { recursive: true });
    copyFileSync(videoOnly, outFile);
  } else {
    const rate = withAudio[0]!.info.sampleRate ?? 48000;
    const inputs: string[] = [];
    const parts: string[] = [];
    infos.forEach(({ clip, info }, i) => {
      const seconds = (clip.frames / clip.fps).toFixed(6);
      inputs.push("-i", clip.file);
      parts.push(
        info.hasAudio
          ? `[${i}:a]aresample=${rate},aformat=channel_layouts=stereo,apad,atrim=0:${seconds},asetpts=N/SR/TB[a${i}]`
          : `anullsrc=r=${rate}:cl=stereo,atrim=0:${seconds},asetpts=N/SR/TB[a${i}]`,
      );
    });
    const graph = `${parts.join(";")};${infos.map((_, i) => `[a${i}]`).join("")}concat=n=${infos.length}:v=0:a=1[a]`;
    execFileSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-i", videoOnly, "-filter_complex", graph, "-map", `${infos.length}:v`, "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", outFile]);
  }
  rmSync(list, { force: true });
  rmSync(videoOnly, { force: true });

  const expected = clips.reduce((n, c) => n + c.frames, 0);
  const got = streamInfo(outFile).frames;
  if (got !== expected) return { ok: false, detail: `joined ${got} frames, expected ${expected}`, frames: got };
  return { ok: true, detail: `${clips.length} clips, ${got} frames${withAudio.length ? ", with sound" : ""}`, frames: got };
}

/**
 * Extract the chosen frame as poster.jpg, then bake it in as frame 0 of the master.
 *
 * Frame 0 is REPLACED, never added: an extra leading frame would shift every beat, every sound
 * effect and any voiceover laid against the cut by one frame. The frame count is checked before
 * and after, and the baked file is only kept if they match.
 */
export function bakePoster(master: string, at: number, posterPath: string): { ok: boolean; detail: string } {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(at), "-i", master, "-frames:v", "1", "-q:v", "2", posterPath]);

  const baked = master.replace(/\.mp4$/, ".baked.mp4");
  execFileSync("ffmpeg", [
    "-v", "error", "-y",
    "-i", master,
    "-i", posterPath,
    "-filter_complex", "[0:v][1:v]overlay=0:0:enable='eq(n\\,0)'[v]",
    "-map", "[v]", "-map", "0:a?",
    "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "copy",
    baked,
  ]);

  const before = decodedFrameCount(master);
  const after = decodedFrameCount(baked);
  if (before !== after) {
    rmSync(baked, { force: true });
    return { ok: false, detail: `frame count changed ${before} -> ${after}; kept the original` };
  }
  rmSync(master, { force: true });
  copyFileSync(baked, master);
  rmSync(baked, { force: true });
  return { ok: true, detail: `${after} frames, unchanged` };
}

// ---------------------------------------------------------------- looking at what rendered

/** Where in a clip the contact sheet looks: the entrance, the build, the middle, the settle, the last frame. */
export const SHEET_AT = [0.04, 0.25, 0.5, 0.75, 0.97] as const;

/** Frame numbers for the contact sheet of a clip with `frames` frames. */
export function sheetFrames(frames: number, at: readonly number[] = SHEET_AT): number[] {
  return at.map((f) => Math.min(frames - 1, Math.max(0, Math.round(f * (frames - 1)))));
}

/**
 * One row of frames from a rendered clip, in one decode pass: what to look at instead of opening the
 * composition in a browser again. The frames are at `SHEET_AT` of the clip's length.
 */
export async function contactSheet(file: string, outFile: string, options: { frames?: number; cellWidth?: number } = {}): Promise<string> {
  const frames = options.frames ?? streamInfo(file).frames;
  const picks = sheetFrames(frames);
  const select = picks.map((n) => `eq(n\\,${n})`).join("+");
  mkdirSync(path.dirname(outFile), { recursive: true });
  await runFile("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", `select='${select}',scale=${options.cellWidth ?? 216}:-2,tile=${picks.length}x1:padding=4:color=white`, "-frames:v", "1", "-q:v", "3", outFile]);
  return outFile;
}

/** Stack each clip's row into one sheet for the whole reel, top to bottom in reel order. */
export function stackSheets(rows: readonly string[], outFile: string): string | undefined {
  if (rows.length === 0) return undefined;
  if (rows.length === 1) {
    copyFileSync(rows[0]!, outFile);
    return outFile;
  }
  const inputs = rows.flatMap((r) => ["-i", r]);
  execFileSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", `${rows.map((_, i) => `[${i}:v]`).join("")}vstack=inputs=${rows.length}`, "-q:v", "3", outFile]);
  return outFile;
}
