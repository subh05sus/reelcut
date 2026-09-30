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

## Write the manifest, then render

After composing, write `reel.json` beside the compositions:

```json
{
  "format": "1:1",
  "fps": 30,
  "ground": "#121a2b",
  "beats": [
    { "id": "beat-00", "durationSeconds": 6.667, "composition": "compositions/beat-00.html" },
    { "id": "beat-03", "durationSeconds": 4.066, "composition": "compositions/beat-03.html",
      "sfx": [{ "source": "sfx/whoosh.ogg", "at": 0.2 }] }
  ]
}
```

Durations come from the beats **verbatim** — never recomputed from word counts, or the cut drifts
against the voice. `"poster": <seconds>` is optional and overrides the automatic thumbnail.

```bash
npm run render -- out/reel.json [--sfx] [--clips-only] [--master-only]
```

This builds the project, renders every clip as its own project, renders the master, checks every
file, and bakes the thumbnail. It refuses the whole project up front if any composition's ids
disagree — a mismatched timeline key renders **frozen at t=0** without an error, so it is caught
before anything renders rather than after.

A worked, renderable example is in `examples/notiz-apps/`.

`--only beat-03` renders just that beat's clip. Compositions that refer to
`assets/library/<id>.<ext>` get those blobs copied into the project; a reference the library does
not have stops the render before anything runs. Every render is recorded in `~/.reelcut/runs.json`
and shows up in the studio:

```bash
npm run studio          # http://localhost:5198 — library, every reel, re-render one beat
```

### What it guarantees

- **Isolation.** Each beat is its own project directory. A beat that fails fails alone and is
  reported; every other clip still ships.
- **Exact frame counts.** Times are written a hair below each frame boundary, so the renderer lands
  on exactly the intended frame. Placement rounds each beat's *end* on the cumulative timeline, so
  error never accumulates past half a frame, however long the reel.
- **A real thumbnail.** Frame 0 is replaced by the fullest settled frame of the hook — the beat whose
  job is to say what the video is. Replaced, never added: an extra leading frame would shift every
  beat and every sound by one frame. The frame count is compared before and after, and the baked file
  is discarded if they differ.
- **Sound only when asked.** `--sfx` is opt-in. Effects sit at 0.35 under everything by default,
  every `<audio>` gets an id (an id-less one is silently dropped from the mix), and a cue is
  beat-relative inside a clip and shifted onto the master timeline in the master.

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

## Open the studio — or not

The user answered this in [Step 0](step-0-ask.md#the-studio-question); act on that answer and do
not ask again. Only if Step 0 was skipped with someone still present, ask now. Never start it
unasked: it is a server on the user's machine.

- **When the reel is done** — start it now, in the background (it keeps running after the turn).
- **Now** — it was started in the background at Step 0 with a plain `npm run studio`; run the
  command below anyway, which finds that server and opens it onto this reel.
- **No** — mention `npm run studio` once and leave it.

To start it, or bring an already-running one up on this reel:

```bash
npm run studio -- --reel <out dir>
```

It opens the browser on that reel. If a studio for this library is already running on 5198, the
command just opens the page and exits, so saying yes twice never starts two servers. Tell the user
the URL it printed, and that Ctrl+C in that terminal (or stopping the background task) ends it.
