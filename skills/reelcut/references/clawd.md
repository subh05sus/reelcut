# Clawd — the Claude mascot, as the reel's host

Clawd is Anthropic's Claude mascot: the small orange pixel creature of Claude Code. The kit draws it and moves it
(`assets/kit/ui/80-clawd.*`, `81-clawd-acts.js`, `82-clawd-pack.js`), so a beat about Claude can have Clawd do the
thing the line says: plug the connector in, carry the skill over, tap Post, celebrate the payoff. Decisions behind it:
`docs/design/clawd-decisions.md`.

## When Clawd is in a reel

The personality's **Mascot** setting decides (`npm run personality -- brief` prints it): by default Clawd **hosts reels
about Claude** — Claude, Claude Code, its connectors, skills, MCP, subagents, scheduled tasks — and acts out their steps.

```bash
npm run clawd -- check script.txt     # about Claude? and a first idea of Clawd's part in each beat
npm run clawd -- brief                # the setting, the owner's starred moves and poses, what exists
```

In Step 0, say it in one line with the personality ("Clawd hosts this one: it is about Claude Code and MCP") and do
not ask. An answer the owner gives now still wins ("no Clawd this time"). Record it in `reel.json` as
`"mascot": { "character": "clawd", "role": "host" }`, and in `plan.md` list the beats Clawd is in and what it does.

`check` gives each beat a role — `hook` (Clawd arrives), `step` (it does the step), `payoff` (it celebrates), `cta` (it
holds up the word), `react`, or `rest` (it sits this one out) — and the acts and poses that fit the words. It is a
starting point: the director decides. **Clawd sits out beats that need the whole frame** (a dense recording, a chart,
a long quote). A host that is in every frame is wallpaper.

### Its role

The personality's `mascot.role` says how much of the reel is Clawd's:

- **host** (the default) — the hook, every step it can act out, the payoff and the CTA; it rests where the frame is full.
- **cameo** — the hook, one celebration, the CTA. Every other beat is made as it would be without it.
- **corner** — small (`size` 150–180), in the same corner of every beat (bottom right, feet on the 84 px margin),
  reacting rather than acting: a nod when a check lands, `react` "yay" at the payoff, `look` toward what moves. Its
  `life` runs across the whole beat, so it never looks frozen at a cut.
- **director** — no fixed part: Clawd is in the beats that get better with it, in whatever role fits.

`mascot.size` maps to `size`: small 180, medium 260, large 360 on the 1080 grid (scale with the format's short side).
`mascot.wear`, when set, is worn in every beat: `RC.clawd.wear(c, "<it>")` right after building the rig.

## The one rule

Clawd is the one character reelcut draws although it is someone else's: the kit draws it from one fixed spec,
Anthropic's minimal Clawd — an 8 × 6 body, two square eyes, a 1 × 2 arm each side at mid-height, four legs, no mouth,
`#d97757`. **Pose it, animate it, dress it, light it; never redraw, recolour or reshape it**, and never draw any other
mascot or logo the way Clawd is drawn. Its material follows the beat's style (below); its silhouette and orange never
change.

## Building it

```js
const c = RC.clawd("#root .cam", { x: 760, y: 920, size: 260 });
```

| option | |
|---|---|
| `x`, `y` | where its **feet** stand, in the layer's px. Put it on a ground line inside the content region (feet at 880–960 on the 1080 grid) |
| `size` | its width with the arms, px; height is 0.8 × that. Small 180–220 (beside UI), medium 240–300 (host), large 320–420 (alone with a headline) |
| `material` | default: the style's (see below). Force one with `"clay"`, `"paper"`, `"line"`… |
| `expr` | the eyes it starts with |
| `hidden` | start invisible; an entrance shows it |
| `before` | an element to sit behind (default: on top of the layer) |
| `outline` | an ink outline; on by itself when the ground is too close to Clawd's orange (a `flood` look) |

Put it in the **camera layer** with everything else, so the push carries it. Keep its head clear of the headline
(the head is `size × 0.8` above the feet) and keep what it reaches for at its arm's height or below.

## Scheduling: a score

Every act is `RC.clawd.<act>(tl, c, at, options)`. Schedule one rig's acts **in time order**: each starts from where
the last left Clawd. `c.free` is when it is free again; `c.marks` holds when a moment landed (`c.marks.plug`,
`.tap`, `.drop`, `.hatch`, `.land`) so the UI around it answers on that frame:

```js
RC.clawd.plug(tl, c, 0.6, { from: "#root .svc", to: "#root .socket" });
tl.fromTo("#root .row .ok", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "spring.default" }, c.marks.plug);
RC.clawd.life(tl, c, 0, 4.6);          // last: breathing, seeded blinks, glances in the gaps
RC.hold(tl, 4.6);
```

`RC.clawd.life` goes **after** the acts: it reads them to keep blinks and glances out of the way.

## Motion

Clawd moves the way Anthropic's own Clawd clips do (owner's decision): a 0.1 s crouch before a hop, a gravity arc (up
on `sine.out`, down on `power3.in`), legs that swing from the hips in pairs, hands that overshoot on a landing, poses
that hold. **Only Clawd** moves this way; everything around it stays on Apple's springs, and the reel's one
`spring.reward` is still the one earned overshoot (Clawd's bounce is character, not that overshoot). On a stepped style
(Claymation, Paper Cutout, Stop Motion…) register `RC.cadence(tl, "#root")` as usual and Clawd steps on its held frames
with everything else.

## Every act

**Moving** — `enter` (`from: "left" | "right" | "top" | "pop"`, `to`), `exit` (`to: "left" | "right" | "top" | "poof"`),
`walk` (`to`, `speed` in widths a second, default 1.1), `hop` (`to`, `y` to land higher or lower, `height`, `cheer`),
`jump` (`cheer: true` for joy), `crouch`, `place` (a cut: where it is, at once).

**Looking and the face** — `look` (`at`: an element, `[x, y]`, `"left" | "right" | "up" | "down" | "center"`; a side
look leans the body, `back: s` returns), `face` (`open`, `happy` ^ ^, `content` ◡ ◡, `closed`, `squint`, `wide`,
`small`, `x`, `angry`, `sad`, `heart`), `blink`, `gaze` (`gx`, `gy` within the face).

**Arms** — `arms` (`{ l: "up", r: { x, y, r } }`; poses `down up cheer out hold high low front`), `wave` (`arm`,
`times`), `point` (`at`, `hold`).

**On the UI** — `tap` (`at`: walks beside it and presses it; out of reach above, it **jumps and taps at the top of the
jump**), `plug` (`from` the service, `to` the socket: a cable that stays), `carry` (`prop`, `label`, `to`: carried
overhead and tossed in), `hold` / `drop` (a prop in a hand; `drop` with `to` flies it there), `type` (on a laptop held
low).

**Words** — `say` (a pixel speech bubble, `text`, held at least the reading floor), `sign` (a board held overhead with
one word), `think` (Claude Code's spinner ✻ over its head, optional `label: "Thinking…"`). Clawd's words obey the
reading floor like every other line.

**The voice** — `onWord(tl, c, "Claude", "jump")` (an act on the spoken word; its `fallback` without a voiceover),
`talk(tl, c, from, to)` (bobs with the voice's loudness, a hand gesturing on the peaks), `follow(tl, c, at, points)`
(eyes follow a cursor path given as RC.cursor's points), `nod`, `shake`.

**Big moments** — `confetti` (the stomp: eight held poses, bursts from the raised hands), `flag` (`text`), `workout`
(the power-up), `sleep(tl, c, from, until)` and `wake`, `react` (`yay wow oops hmm love yes no angry sad dizzy`),
`sparkles`, `hearts`, `sweat`, `zzz`, `mark` (`!` or `?`), `burst` (confetti from a point).

**Costumes and props** — `wear(c, name)` from the start, `dress(tl, c, at, name)` / `undress`: `party-hat santa crown
cap beanie wizard chef grad-cap hard-hat headset shades bow bandana badge star flower leaf heart ribbon blush antenna`
(`RC.clawd.WEARS`). Props for `hold` / `carry` (`RC.clawd.PROPS`): `phone laptop plug file scroll calendar clock coffee
dumbbell puzzle terminal key gear lightbulb rocket trophy envelope star check heart gift magnifier wrench pencil box
folder bolt megaphone`. The personality can name one thing Clawd always wears (`mascot.wear`).

**Subagents** — `minis(tl, c, at, { n, work, spread, props })` pops `n` small Clawds out, sends them to a fan of spots
to work (a spinner each, or a prop), and brings them back; it returns them, so `RC.clawd.done(tl, mini,
mini.marks.worked - 0.2)` puts a check over each as it finishes.

**Something new** — `hatch(tl, c, at)`: a pixel egg wobbles, cracks three times, and Clawd pops out with sparkles.

**The pack's poses** — `pose(tl, c, at, id, { dur, keep })` plays one of the 70 poses of the mascot pack, re-cast onto
the minimal Clawd: its eyes, gaze, arms and legs, plus the pose's props and effects (a lightbulb that pulses, Z's that
rise, an alert that flashes, a loop that spins, small Clawds). `npm run clawd -- poses --tag sleep` lists them; good
ones for these reels: `idea-lightbulb`, `thinking-pixel-bubble`, `writing-software-code`, `disconnected-plug`,
`rocket-launch-success`, `with-success-checkmark`, `sleeping-soundly`, `bugs-attack`, `shield-protect`,
`welcome-pixel-banner`, `hello-languages`, `with-minis`.

## Any style, any look

The material follows `data-style` on the root: **clay** (Claymation, Stop Motion) · **paper** (Paper Cutout) ·
**collage** · **sketch** (Hand-Drawn) · **line** (Linear) · **ink** (Ink / Paint) · **brutal** · **voxel** (3D) · **iso**
(Isometric) · **liquid** · **vhs** · **glitch** · **cine** (Cinematic) · **print** (Editorial) · **flat** (every other
style). Props, hats and the pack's layers take the same material. On any look the eyes stay readable; on a ground too
close to its orange it gets an ink outline by itself.

## Across the cuts

Every boundary is still a hard cut. Continuity comes from Clawd itself: the **same size and ground line** from beat to
beat, the **same thing worn**, and an **exit matched to the next entry** — it walks off right in beat 3 and walks in
from the left in beat 4, or hops off the top and drops in from the top. Never let it be mid-act at a cut (`c.free`
before the beat's end).

## Recipes for reels about Claude's tools

| the line | Clawd |
|---|---|
| the hook ("Claude can now post for you") | `enter` under the headline, `look` up at it, `jump` with `cheer`, `wave` |
| "connect X to Claude" | `plug` from the service's chip to the app's socket; the row flips to Connected on `c.marks.plug` |
| "give it my skill" / "upload SKILL.md" | `carry` the `file` labelled `SKILL.md` into the chat; the chat answers on `c.marks.drop` |
| "tell it which video to post" | `type`, then `tap` the send button |
| "it schedules it for 5 pm" | `hold` the `calendar` or `clock`, `point` at the time |
| "while you sleep" / "on the go" | `sleep` beside the phone while the UI does the work, `wake` on the result |
| "five agents at once" | `minis` with a `done` check over each |
| "it's new" / a launch | `hatch`, then `dress` a `party-hat` |
| the payoff | `confetti`, or `react` `yay` beside the result |
| the call to action ("Comment POST") | `sign` with the word, then `wave` |
| something fails / "the old way" | `react` `oops`, `sweat`, or `pose` `bugs-attack` |

Start from `assets/patterns/clawd/`: `clawd-hook` (in a Claymation style, on its held frames), `clawd-connector`,
`clawd-skill`, `clawd-payoff` (on `flood`, outlined by itself), `clawd-cta`, `clawd-subagents`, `clawd-hatch`.

## Sound

Every act records what it did (`clawd-step`, `clawd-hop`, `clawd-land`, `clawd-tap`, `clawd-plug`, `clawd-drop`,
`clawd-confetti`, `clawd-cheer`, `clawd-hatch`…), and `npm run sfx -- suggest reel.json` gives each Clawd's own 8-bit
blip from the bundled pack (synthesised for reelcut, CC0), with a budget of its own so footsteps never crowd out a click.
They are never offered for anything but Clawd.

## Outside a reel

- **The studio's Clawd page** (`/reelcut open clawd`): every move and pose playing live in any style and look; the owner
  stars favourites, and `npm run clawd -- brief` lists them first. Reach for starred ones when they fit.
- **Overlay clips** for the owner's own editor: `npm run clawd -- overlay wave --style claymation --format mov`
  (ProRes 4444 with alpha; `webm` for VP9 with alpha; `all` for every move; `pose:<id>` for a pose).
