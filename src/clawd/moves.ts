/**
 * Clawd's moves, each a short, self-contained score on the kit's RC.clawd: what the studio's Clawd page plays on loop,
 * what `npm run clawd -- overlay` renders as a transparent clip for the owner's own editor, and the vocabulary a beat
 * is composed from. `stage` is the scenery a move needs (a button to tap, a socket to plug into), drawn in the
 * composition around Clawd; `score` schedules the move on `tl` for the rig `c`, which stands at the layer's centre.
 */

export interface ClawdMove {
  id: string;
  name: string;
  tags: string[];
  /** How long one play lasts, in seconds. */
  seconds: number;
  /** Scenery the move acts on: HTML inside the stage, positioned in the stage's own px (see `stageCss`). */
  stage?: string;
  /** JavaScript: schedule the move on `tl` for the rig `c`. `W` and `H` are the stage's size. */
  score: string;
}

/** The scenery's look: a card, a button, a socket, a chat box, sized for a 1080 stage and scaled with it. */
export const STAGE_CSS = `
.cw-st-card { position: absolute; border-radius: 28px; background: var(--card); box-shadow: var(--shadow); }
.cw-st-btn { position: absolute; padding: 0 30px; height: 64px; border-radius: 32px; background: var(--accent); color: var(--accent-ink, #fff);
  font: 650 28px var(--font-sans); display: flex; align-items: center; }
.cw-st-socket { position: absolute; width: 28px; height: 64px; border-radius: 7px; background: #2a2a2e; }
.cw-st-chip { position: absolute; padding: 12px 22px; border-radius: 18px; background: var(--card); box-shadow: var(--shadow); font: 600 26px var(--font-sans); color: var(--card-ink); }
`;

export const MOVES: ClawdMove[] = [
  { id: "idle", name: "Idle", tags: ["life", "breathe", "blink"], seconds: 4, score: `RC.clawd.look(tl, c, 1.4, { at: "left", back: 0.7 });` },
  { id: "walk-in", name: "Walk in", tags: ["enter", "walk"], seconds: 2.6, score: `RC.clawd.enter(tl, c, 0.1, { from: "left" });` },
  { id: "walk-out", name: "Walk off", tags: ["exit", "walk"], seconds: 2.6, score: `RC.clawd.exit(tl, c, 0.4, { to: "right" });` },
  { id: "drop-in", name: "Drop in", tags: ["enter", "fall", "land"], seconds: 1.8, score: `RC.clawd.enter(tl, c, 0.2, { from: "top" });` },
  { id: "pop-in", name: "Pop in", tags: ["enter", "appear"], seconds: 1.6, score: `RC.clawd.enter(tl, c, 0.2, { from: "pop" }); RC.clawd.sparkles(tl, c, 0.25, { n: 4 });` },
  { id: "hop", name: "Hop across", tags: ["hop", "jump", "move"], seconds: 2.8, score: `RC.clawd.hop(tl, c, 0.3, { to: W / 2 - c.size * 0.9 }); RC.clawd.hop(tl, c, 1.4, { to: W / 2 + c.size * 0.2 });` },
  { id: "yay", name: "Yay", tags: ["jump", "cheer", "happy", "celebrate"], seconds: 2, score: `RC.clawd.react(tl, c, 0.3, "yay");` },
  { id: "wave", name: "Wave", tags: ["hello", "hi", "greet", "bye"], seconds: 2.2, score: `RC.clawd.wave(tl, c, 0.3);` },
  { id: "look-around", name: "Look around", tags: ["look", "curious", "lean"], seconds: 3, score: `RC.clawd.look(tl, c, 0.3, "left"); RC.clawd.look(tl, c, 1.2, "right"); RC.clawd.look(tl, c, 2.1, "center");` },
  { id: "point", name: "Point", tags: ["point", "present", "show"], seconds: 2.4,
    stage: `<div class="cw-st-card" style="left:90px;top:330px;width:300px;height:220px"></div>`,
    score: `RC.clawd.place(tl, c, null, { x: W * 0.62 }); RC.clawd.point(tl, c, 0.3, { at: "#root .cw-st-card", hold: 1.2 });` },
  { id: "tap", name: "Tap a button", tags: ["tap", "click", "press", "ui"], seconds: 2.6,
    stage: `<div class="cw-st-btn" style="left:120px;top:640px">Connect</div>`,
    score: `RC.clawd.place(tl, c, null, { x: W * 0.72 }); RC.clawd.tap(tl, c, 0.2, { at: "#root .cw-st-btn", then: "jump" });` },
  { id: "jump-tap", name: "Jump to tap", tags: ["tap", "jump", "reach", "ui"], seconds: 2.2,
    stage: `<div class="cw-st-btn" style="left:430px;top:300px">Post</div>`,
    score: `RC.clawd.tap(tl, c, 0.3, { at: "#root .cw-st-btn" });` },
  { id: "plug", name: "Plug in a connector", tags: ["plug", "connect", "connector", "mcp", "integration"], seconds: 3.8,
    stage: `<div class="cw-st-chip" style="left:640px;top:150px">Connector</div><div class="cw-st-card" style="left:80px;top:360px;width:260px;height:420px"></div><div class="cw-st-socket" style="left:336px;top:640px"></div>`,
    score: `RC.clawd.place(tl, c, null, { x: W * 0.68 }); RC.clawd.plug(tl, c, 0.2, { from: "#root .cw-st-chip", to: "#root .cw-st-socket" });` },
  { id: "carry-file", name: "Carry a file in", tags: ["carry", "skill", "file", "upload", "drop"], seconds: 3.4,
    stage: `<div class="cw-st-card" style="left:80px;top:380px;width:300px;height:360px"></div>`,
    score: `RC.clawd.place(tl, c, null, { x: W * 0.72 }); RC.clawd.carry(tl, c, 0.2, { prop: "file", label: "SKILL.md", to: "#root .cw-st-card" });` },
  { id: "type", name: "Type on a laptop", tags: ["type", "work", "laptop", "code"], seconds: 2.4, score: `RC.clawd.type(tl, c, 0.2, { dur: 1.8 });` },
  { id: "think", name: "Think", tags: ["think", "spinner", "working"], seconds: 2.4, score: `RC.clawd.think(tl, c, 0.2, { dur: 1.9, label: "Thinking…" });` },
  { id: "say", name: "Say a word", tags: ["say", "bubble", "talk"], seconds: 2.4, score: `RC.clawd.say(tl, c, 0.2, { text: "Hi!", dur: 1.6 });` },
  { id: "sign", name: "Hold up a sign", tags: ["sign", "word", "cta"], seconds: 2.4, score: `RC.clawd.sign(tl, c, 0.2, { text: "POST", dur: 1.6 });` },
  { id: "flag", name: "Wave a flag", tags: ["flag", "go", "start"], seconds: 2.6, score: `RC.clawd.flag(tl, c, 0.2, { text: "GO", dur: 2.1 });` },
  { id: "confetti", name: "Confetti stomp", tags: ["confetti", "party", "celebrate", "payoff"], seconds: 2.6, score: `RC.clawd.confetti(tl, c, 0.2);` },
  { id: "workout", name: "Power up", tags: ["workout", "lift", "strong", "power"], seconds: 3.6, score: `RC.clawd.workout(tl, c, 0.2);` },
  { id: "sleep-wake", name: "Sleep, then wake", tags: ["sleep", "wake", "rest", "overnight"], seconds: 3.6, score: `RC.clawd.sleep(tl, c, 0.1, 2.2); RC.clawd.wake(tl, c, 2.3);` },
  { id: "wow", name: "Wow", tags: ["react", "surprise", "wow"], seconds: 1.8, score: `RC.clawd.react(tl, c, 0.3, "wow");` },
  { id: "oops", name: "Oops", tags: ["react", "error", "fail", "oops"], seconds: 1.8, score: `RC.clawd.react(tl, c, 0.3, "oops");` },
  { id: "hmm", name: "Hmm", tags: ["react", "question", "think"], seconds: 1.8, score: `RC.clawd.react(tl, c, 0.3, "hmm");` },
  { id: "love", name: "Love", tags: ["react", "love", "heart"], seconds: 2, score: `RC.clawd.react(tl, c, 0.3, "love");` },
  { id: "yes", name: "Nod yes", tags: ["react", "yes", "agree"], seconds: 1.4, score: `RC.clawd.react(tl, c, 0.3, "yes");` },
  { id: "no", name: "Shake no", tags: ["react", "no", "disagree"], seconds: 1.4, score: `RC.clawd.react(tl, c, 0.3, "no");` },
  { id: "hatch", name: "Hatch", tags: ["hatch", "egg", "new", "launch"], seconds: 2.8, score: `RC.clawd.hatch(tl, c, 0.1);` },
  { id: "subagents", name: "Subagents", tags: ["minis", "subagents", "parallel", "team"], seconds: 4.4, score: `RC.clawd.minis(tl, c, 0.3, { n: 4, work: 1.2 });` },
  { id: "party-hat", name: "Put on a party hat", tags: ["wear", "hat", "party"], seconds: 1.8, score: `RC.clawd.dress(tl, c, 0.4, "party-hat"); RC.clawd.react(tl, c, 0.6, "yay");` },
];

export function moveById(id: string): ClawdMove | undefined {
  return MOVES.find((m) => m.id === id);
}
