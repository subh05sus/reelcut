import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { soundSpans, type Span } from "./timeline.js";
import { WatchVideo, watchHome, type LogEntry, type Meta, type Note, type Session } from "./video.js";

/**
 * What the studio's Watch panel shows for a video: the video, the timeline lanes (motion, cuts, speech, music) and
 * every look Claude took (where, at what fps, why, and the evidence images). Built from the cache only: reading it
 * never measures anything.
 */
export interface WatchState {
  id: string; meta: Meta; session: Session;
  cuts: number[]; motion: number[]; bin: number;
  speech: Span[]; sound: Span[];
  looks: LogEntry[]; notes: Note[];
  updatedAt: number;
}

export function watchStateOf(v: WatchVideo): WatchState {
  const vis = v.load<{ cuts: number[]; motion: number[]; bin: number }>("visual.json") ?? { cuts: [], motion: [], bin: 0.5 };
  const snd = soundSpans(v.load("audio.json"), v.load("transcript.json"));
  const log = path.join(v.dir, "log.jsonl");
  return {
    id: v.id, meta: v.meta, session: v.session(), cuts: vis.cuts, motion: vis.motion, bin: vis.bin,
    speech: snd.speech, sound: snd.sound, looks: v.readLog(), notes: v.notes(),
    updatedAt: existsSync(log) ? statSync(log).mtimeMs : 0,
  };
}

/** Every video a Create conversation watched (the session records it), newest first. */
export function watchedIn(conversation: string): WatchState[] {
  const root = path.join(watchHome(), "videos");
  if (!existsSync(root)) return [];
  const out: WatchState[] = [];
  for (const id of readdirSync(root)) {
    try {
      const s = JSON.parse(readFileSync(path.join(root, id, "session.json"), "utf8")) as Session;
      if (s.conversation !== conversation) continue;
      const m = JSON.parse(readFileSync(path.join(root, id, "meta.json"), "utf8")) as Meta;
      if (!existsSync(m.path)) continue;
      out.push(watchStateOf(new WatchVideo(m.path)));
    } catch { /* half-written, or not a watched video */ }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}
