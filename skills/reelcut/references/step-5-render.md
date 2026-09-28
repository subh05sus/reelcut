# Step 5 — Render and deliver

## The project shape

One HyperFrames project, three kinds of file:

```
out/project/
  index.html                    the master — mounts every beat on hard cuts
  compositions/beat-03.html     one sub-composition per beat (a <template>)
  clip-beat-03/index.html       a standalone host mounting just that beat
```

The master's clip list is a direct serialisation of the beats — `data-start` is the running sum of
the durations before it, `data-duration` is the beat's own. No transitions, no overlap: every
boundary is a hard cut.

```html
<div id="beat-03" class="clip"
     data-composition-id="beat-03"
     data-composition-src="compositions/beat-03.html"
     data-start="2.57" data-duration="2.20"
     data-track-index="0" data-width="1080" data-height="1080"></div>
```

The host owns no motion of its own, but a host timeline still has to exist and be registered or the
runtime has nothing to bind:

```js
window.__timelines = window.__timelines || {};
window.__timelines["reel"] = gsap.timeline({ paused: true });
```

Give every host clip a stable `id` — without one, Studio cannot target it and `lint` warns.

## Render

```bash
npx hyperframes check --samples 34          # the gate. Non-zero samples, or it did not run.
npx hyperframes render --quality looks --output out/master.mp4
# then once per clip host
npx hyperframes render --quality looks --output out/clips/beat-03.mp4
```

Or through the connector, which runs the gate first and reads the report properly:

```ts
import { renderHyperframesProject } from "../../../src/render/hyperframes.js";
```

Two details in there worth not rediscovering: the CLI goes through a shell because `npx` on Windows
is `npx.cmd` and Node refuses to spawn a `.cmd` directly; and `layout.samples` is an array while
`motion.samples` is a number that is legitimately 0 without motion assertions, so a naive search
for "samples" reads a clean check as empty.

## Verify every clip

```bash
npm run check-video -- out/clips/*.mp4
```

Zero findings, or it does not ship. `blank_panel` is the only hard failure — a container that
forgot to draw its contents. Static holds and grid ink are reported, never gated: a long hold on a
payoff is the reading floor working, not a defect.

Watch the boundary frames too. Every beat's frame 0 should be legible; a blank one means an
entrance started from `opacity: 0`.

A render-time warning about a "suspect small frame" on a dark beat is usually a false alarm — the
heuristic is byte-size based and a flat dark ground compresses small whatever is on it. Check the
frame before believing it.

## Poster

Pull the strongest **settled** frame — text fully in, not mid-transition — to `out/poster.jpg`, and
bake it as frame 0 of the master so every platform's thumbnail shows it. Replace frame 0 rather than
adding one, so duration and audio sync are unchanged.

## Deliver

```
out/
  clips/beat-03.mp4 …     the deliverable — one per beat, ready to drop into an edit
  master.mp4              all of them, hard cuts
  poster.jpg
  plan.md                 the beats, their briefs, what each one does
  report.md               provenance for every asset and every number
  project/                kept, so any single beat can be re-rendered without redoing the rest
```

`report.md` is not optional. One line per acquired thing — where it came from, its licence, what was
masked, when a quote was verified. **An asset with no provenance line does not ship**, and that is
the last check before handing over.

Then say, in one or two sentences, what the creative angle was and which beats you would change
first. Offer to re-render a single beat — the project is kept precisely so that costs seconds.
