# Step 5 — Render and deliver

## The project shape

One HyperFrames project, three kinds of file:

```
out/project/clips/beat-03/
  index.html                    a standalone host mounting just that beat
  compositions/beat-03.html     the beat's sub-composition (a <template>)
```

There is no master project. The master is the rendered clips joined end to end (`ffmpeg` stream copy, hard
cuts, every boundary on a frame), after each clip's frame count is checked against its place in the reel. The
first version rendered a second, nested project: it doubled the render time, and in it a timeline driven from an
`onUpdate` (a counting number) was seeked with its events suppressed, so the master was not the video the beats
had been checked as. Joining the clips that passed is exactly what passed.

Each host still needs a registered timeline or the runtime has nothing to bind:

```js
window.__timelines = window.__timelines || {};
window.__timelines["clip-beat-03"] = gsap.timeline({ paused: true });
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

Optional fields that let the studio learn from the reel (see [learnings.md](learnings.md)):

```json
{
  "brand": "Notiz",
  "direction": { "text": "key-lines", "motion": "restrained", "look": "cool" },
  "appliedLearnings": ["r_1a2b3c4d", "u_9f8e7d6c"],
  "beats": [{ "id": "beat-02", "durationSeconds": 4.6, "composition": "compositions/beat-02.html", "pattern": "cursor-demo" }]
}
```

The render reads each beat's `data-look` and `--accent` itself; `pattern`, `brand`, `direction` and
`appliedLearnings` are yours to write. All of them are optional, and none changes the render.

### Generated clips and the generation log

A generated clip is placed with the same `data-footage` placeholder as a recording, but the render only
**trims** it (never speeds it up), requires that a person approved it (no private-information check: nothing real
is in it), and prints `[AI-generated]`. `reel.json` may carry `"generation": [{ "beat", "outcome":
"generated|fallback|skipped", "reason", "assetId" }]`, written by `npm run generate -- record`; the render leaves
it alone and the studio shows it on the reel. Put each generated clip in `report.md` with its model, job id,
credits and the line "AI-generated". A re-render uses the saved file and never calls Higgsfield.

### Recorded footage

A composition places a recording with `data-footage="<asset>:<moment>"` (see [footage.md](footage.md)). The
render expands each placeholder into the trimmed, retimed `<video>` and refuses the beat, with the reason, if
the recording is not approved, was never checked for private information, the moment is only a proposal, or
the moment cannot fit its slot at 2x. It pulls frames as PNG, hardlinks big recordings instead of copying
them, relaxes the frame checker's `blank_panel` for beats with footage, and records each moment as used so
the next match is not asked about again. It prints `footage: "download Claude" at 0.0s (1.48x)` for what it
placed; copy that, with the recording's date, into `report.md`.

### Sound effects from the library

A cue's `source` may be a file path, or `library:<id>` for a sound in the user's library. The render
resolves it, reads its duration, mixes it at the default level adjusted by the gain measured when
the sound was ingested (the file itself is never changed), clips a cue that would run past the end of
its beat, and records the use. Only sounds the user has approved should be used.

```bash
npm run sfx -- list                                   # the sounds, and which are approved
npm run sfx -- find --event click --json              # the best fit for a moment
npm run sfx -- suggest out/reel.json                  # propose cues from each beat's own moments
npm run sfx -- suggest out/reel.json --apply          # write them into reel.json
npm run render -- out/reel.json --sfx                 # and hear them
```

`suggest` loads every beat in Chrome and reads the moments the kit's helpers recorded (a click, a
typing run, a count, a reveal). It is deliberately quiet: at most three cues a beat, one cue for a
run of the same event, a different sound for each moment while the library has one. Silence is a
choice; the user's `--sfx` answer in Step 0 decides whether sound is on at all.

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
