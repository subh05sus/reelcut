/**
 * Clawd's sounds: little 8-bit blips, synthesised here from square waves and noise, so they belong to reelcut and are
 * released CC0 with the bundled pack (owner's decision, 2026-10-13). One per thing Clawd does — a step, a hop, a
 * landing, a tap, a pop, a cheer, confetti, a plug going in, a key, a crack, a hatch, Z's, a sparkle, a lift, a stomp,
 * a drop, a done — each tagged `clawd-<event>`, the event the kit records for it.
 *
 * Deterministic: the noise is seeded, so a rebuild writes the same samples.
 */

export const SAMPLE_RATE = 44100;

/** One voice of a sound: a square wave (duty 0..1) or noise, a pitch glide, an envelope, a start offset. */
export interface Voice {
  wave: "square" | "noise" | "triangle";
  /** Hz at the start and the end (exponential glide); for noise, how often it is resampled (its "pitch"). */
  from: number;
  to?: number;
  duty?: number;
  at?: number;
  /** Seconds. */
  dur: number;
  attack?: number;
  /** 0..1. */
  gain?: number;
  /** Notes played in turn across the voice (an arpeggio), in Hz; each gets dur / notes.length. */
  notes?: number[];
  /** Vibrato depth (fraction of the pitch) and rate (Hz). */
  vibrato?: [number, number];
}

export interface ClawdSound {
  id: string;
  event: string;
  name: string;
  category: "transition" | "ui" | "pop" | "hit" | "texture";
  tags: string[];
  voices: Voice[];
}

const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5, E6 = 1318.5, G6 = 1568, G4 = 392, A5 = 880, D6 = 1174.7, C7 = 2093;

export const CLAWD_SOUNDS: ClawdSound[] = [
  { id: "clawd-step", event: "clawd-step", name: "Clawd step", category: "ui", tags: ["step", "blip", "tiny"], voices: [{ wave: "square", from: 540, to: 420, duty: 0.25, dur: 0.035, gain: 0.45 }] },
  { id: "clawd-hop", event: "clawd-hop", name: "Clawd hop", category: "pop", tags: ["hop", "jump", "boing"], voices: [{ wave: "square", from: 300, to: 980, duty: 0.5, dur: 0.13, gain: 0.6 }] },
  { id: "clawd-land", event: "clawd-land", name: "Clawd landing", category: "hit", tags: ["land", "thud", "soft"], voices: [{ wave: "square", from: 170, to: 70, duty: 0.5, dur: 0.09, gain: 0.7 }, { wave: "noise", from: 3000, dur: 0.05, gain: 0.25 }] },
  { id: "clawd-tap", event: "clawd-tap", name: "Clawd tap", category: "ui", tags: ["tap", "click", "press"], voices: [{ wave: "square", from: 1250, to: 1800, duty: 0.25, dur: 0.04, gain: 0.5 }] },
  { id: "clawd-pop", event: "clawd-pop", name: "Clawd pop", category: "pop", tags: ["pop", "appear"], voices: [{ wave: "square", from: 380, to: 1250, duty: 0.5, dur: 0.07, gain: 0.55 }] },
  { id: "clawd-cheer", event: "clawd-cheer", name: "Clawd cheer", category: "pop", tags: ["cheer", "yay", "success"], voices: [{ wave: "square", from: C5, duty: 0.5, dur: 0.28, gain: 0.5, notes: [C5, E5, G5, C6] }] },
  { id: "clawd-confetti", event: "clawd-confetti", name: "Clawd confetti", category: "texture", tags: ["confetti", "party", "sparkle"], voices: [{ wave: "noise", from: 9000, dur: 0.3, gain: 0.22, attack: 0.01 }, { wave: "square", from: G5, duty: 0.25, dur: 0.32, gain: 0.4, notes: [G5, C6, E6, G6] }] },
  { id: "clawd-plug", event: "clawd-plug", name: "Clawd plugs in", category: "ui", tags: ["plug", "connect", "zap"], voices: [{ wave: "noise", from: 6000, dur: 0.06, gain: 0.3 }, { wave: "square", from: 200, to: 1600, duty: 0.25, dur: 0.08, gain: 0.35 }, { wave: "square", from: A5, at: 0.1, duty: 0.5, dur: 0.16, gain: 0.45, notes: [A5, E6] }] },
  { id: "clawd-key", event: "clawd-key", name: "Clawd keystroke", category: "ui", tags: ["key", "keystroke", "tick"], voices: [{ wave: "square", from: 2100, to: 1700, duty: 0.2, dur: 0.022, gain: 0.35 }] },
  { id: "clawd-crack", event: "clawd-crack", name: "Egg crack", category: "hit", tags: ["crack", "egg", "break"], voices: [{ wave: "noise", from: 2200, dur: 0.06, gain: 0.55 }, { wave: "square", from: 220, to: 140, duty: 0.25, dur: 0.05, gain: 0.3 }] },
  { id: "clawd-hatch", event: "clawd-hatch", name: "Clawd hatches", category: "pop", tags: ["hatch", "tada", "reveal"], voices: [{ wave: "noise", from: 3000, dur: 0.07, gain: 0.4 }, { wave: "square", from: G4, at: 0.05, duty: 0.5, dur: 0.36, gain: 0.5, notes: [G4, C5, E5, G5, C6] }] },
  { id: "clawd-zz", event: "clawd-zz", name: "Clawd snoozing", category: "texture", tags: ["sleep", "snore", "zz"], voices: [{ wave: "triangle", from: 520, to: 260, dur: 0.45, gain: 0.35, attack: 0.05, vibrato: [0.03, 7] }] },
  { id: "clawd-sparkle", event: "clawd-sparkle", name: "Clawd sparkle", category: "texture", tags: ["sparkle", "twinkle", "shimmer"], voices: [{ wave: "square", from: G6, duty: 0.25, dur: 0.18, gain: 0.3, notes: [G6, C7, E6, C7] }] },
  { id: "clawd-lift", event: "clawd-lift", name: "Clawd lifts", category: "hit", tags: ["lift", "effort", "grunt"], voices: [{ wave: "square", from: 120, to: 95, duty: 0.4, dur: 0.14, gain: 0.55, vibrato: [0.04, 18] }] },
  { id: "clawd-stomp", event: "clawd-stomp", name: "Clawd stomp", category: "hit", tags: ["stomp", "thud", "step"], voices: [{ wave: "square", from: 130, to: 60, duty: 0.5, dur: 0.07, gain: 0.6 }] },
  { id: "clawd-drop", event: "clawd-drop", name: "Clawd drops it in", category: "pop", tags: ["drop", "toss", "whistle"], voices: [{ wave: "square", from: 1300, to: 420, duty: 0.25, dur: 0.17, gain: 0.4 }, { wave: "square", from: 200, to: 120, at: 0.16, duty: 0.5, dur: 0.05, gain: 0.45 }] },
  { id: "clawd-done", event: "clawd-done", name: "Clawd done", category: "ui", tags: ["done", "success", "check"], voices: [{ wave: "square", from: C6, duty: 0.5, dur: 0.18, gain: 0.45, notes: [C6, G6] }] },
  { id: "clawd-wave", event: "clawd-wave", name: "Clawd says hi", category: "ui", tags: ["hi", "hello", "wave"], voices: [{ wave: "square", from: E6, duty: 0.25, dur: 0.14, gain: 0.35, notes: [E6, D6] }] },
];

/** Seeded noise, the same samples on every build. */
function noise(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1; };
}

/** Render a sound's voices into one mono buffer, peak-normalised to -1 dBFS. */
export function synthesise(sound: ClawdSound, rate = SAMPLE_RATE): Float32Array {
  const length = Math.ceil(Math.max(...sound.voices.map((v) => (v.at ?? 0) + v.dur)) * rate) + Math.round(rate * 0.01);
  const out = new Float32Array(length);
  sound.voices.forEach((v, vi) => {
    const start = Math.round((v.at ?? 0) * rate), n = Math.round(v.dur * rate), rnd = noise(7919 * (vi + 1) + sound.id.length);
    let phase = 0, held = 0, holdLeft = 0;
    for (let i = 0; i < n; i++) {
      const t = i / rate, p = i / n;
      const note = v.notes ? v.notes[Math.min(v.notes.length - 1, Math.floor(p * v.notes.length))]! : null;
      let f = note ?? v.from * Math.pow((v.to ?? v.from) / v.from, p);
      if (v.vibrato) f *= 1 + v.vibrato[0] * Math.sin(2 * Math.PI * v.vibrato[1] * t);
      // A chiptune envelope: a click-free attack, then a decay that keeps a little body to the end.
      const attack = v.attack ?? 0.004, env = (t < attack ? t / attack : 1) * Math.pow(1 - p, 1.6) * (v.notes ? 0.65 + 0.35 * (1 - ((p * v.notes.length) % 1)) : 1);
      let s: number;
      if (v.wave === "noise") {
        if (holdLeft <= 0) { held = rnd(); holdLeft = rate / f; }
        holdLeft--; s = held;
      } else {
        phase = (phase + f / rate) % 1;
        s = v.wave === "triangle" ? 1 - 4 * Math.abs(phase - 0.5) : phase < (v.duty ?? 0.5) ? 1 : -1;
      }
      out[start + i]! += s * env * (v.gain ?? 0.5);
    }
  });
  let peak = 0;
  for (const s of out) peak = Math.max(peak, Math.abs(s));
  const k = peak > 0 ? Math.pow(10, -1 / 20) / peak : 1;
  for (let i = 0; i < out.length; i++) out[i]! *= k;
  return out;
}

/** A 16-bit PCM mono WAV of `samples`. */
export function wav(samples: Float32Array, rate = SAMPLE_RATE): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * 32767))), i * 2));
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVE", 8);
  head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write("data", 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
