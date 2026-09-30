---
name: reelcut
description: Turn a spoken script into a set of motion-graphics clips — one per beat, plus a master cut. Finds and verifies the assets the script needs, captures real product screens, sources data for charts, and composes each beat as HTML + GSAP. Use when someone says "/reelcut", gives you a script or an SRT and wants video out of it, or asks for clips for a reel.
---

# /reelcut

A script goes in. A folder of clips comes out, each one composed for what its line actually says.

## What this is not

It is not a template filler. There is no library of layouts to pick from and pour text into — that
approach is what the predecessor to this skill did for a year, and it is why its beats put content
on a quarter of the frame and read as generic. **You compose each beat.** The archetypes in
`assets/archetypes/` exist for when authoring fails or a run is unattended, not as the default.

## Invocation

```
/reelcut script.txt
/reelcut script.srt --format vertical --text minimal
/reelcut script.txt --short          # a 15-25s cut instead of the whole thing
/reelcut script.txt --assets ./logos # a folder to take assets from
/reelcut script.srt --text none --visuals "real product screens, no abstract shapes"
/reelcut script.txt --palette "#0a0a0a #f2efe9 #ff4b1f" make it feel like late-90s broadcast
```

| Option | Values | Default |
|---|---|---|
| `--format` | `1:1`, `9:16`, `16:9`, `4:5` | `1:1` |
| `--short` | flag — cut to 15–25s | whole script |
| `--assets <dir>` | where to look for files already provided | `assets/in/` |
| `--fps` | | 30 |
| `--no-data` | skip data sourcing and charts | data on |
| `--text` | `full`, `key-lines`, `minimal`, `none` | **depends on voiceover** |
| `--motion` | `restrained`, `default`, `energetic` | `default` |
| `--palette` | `"#ground #ink #accent"` | taken from the source |
| `--look` | freeform art direction | inferred |
| `--visuals` | freeform register steer | inferred |

**Anything else typed is kept as freeform direction** and carried into the plan verbatim.
"Make it feel like a museum exhibit" is real direction no flag will capture.

**`--text` defaults on whether there is a voiceover.** An `.srt` means spoken audio, so the
default is `key-lines` — putting every line on screen makes the viewer read what they are
already hearing. A plain `.txt` defaults to `full`, because then type is the only thing
speaking. Full detail, and what direction may never override:
[references/direction.md](references/direction.md).

Assets can also simply be handed over in the conversation. Anything dropped in is matched against
what the script needs before anything is searched for.

## Output

```
out/
  clips/beat-03.mp4 …   one per beat — the deliverable
  master.mp4            all of them, hard cuts
  poster.jpg
  plan.md               beats, briefs, what each one does
  report.md             every asset and every number, with where it came from
  project/              the HyperFrames project, kept so a beat can be re-rendered
```

Use a timestamped `out-YYYY-MM-DD-HHmmss/` when `out/` already exists.

`<skill-dir>` is the directory holding this file. Claude Code prints it as "Base directory for this
skill". Don't guess it — a plugin install, a `~/.claude/skills/` copy and this repo all differ.

---

## Step 0 — Ask before cutting

**Read:** [references/step-0-ask.md](references/step-0-ask.md)

Run `npm run beats` on the script first, then ask the user — with the AskUserQuestion tool, at most
two rounds — about everything the invocation left open: how much text goes on screen, the length,
the look and palette, motion, format, sound, and whether to open the studio. Options are tailored
to *this* script, the recommended one first. Never ask about what a flag or the freeform direction
already answered, and skip the questions when the run is unattended.

**Gate:** every open axis has an answer or a recorded default, and the studio question has been
answered, before any brief is written.

---

## Step 1 — Script to beats

**Read:** [references/step-1-script.md](references/step-1-script.md), and
[references/direction.md](references/direction.md) when direction was given — the briefs are
written under it, and `--text` changes what `mustRead` may contain.

Parse the script, segment it into beats, and write a `BeatBrief` for each. An `.srt` gives exact
timings; a `.txt` is estimated from words per minute.

You are the director. There is no model API in this pipeline — the brief is yours to write.

**Gate:** every beat has a brief that passes `validateBeatBrief`. That check enforces the reading
floor, so no line can be scheduled into less time than it takes to read.

---

## Step 2 — Acquire what the script needs

**Read:** [references/step-2-acquire.md](references/step-2-acquire.md) and
[references/sourcing.md](references/sourcing.md)

Each brief's `mustShow` becomes an `AssetRequirement`. Resolve in this order: the library
(`~/.reelcut/library`, what earlier reels already acquired and verified), files already
provided, then a capture of the real product screen, then the brand's own source for a mark, then
— only for `generic` requirements — draw it.

Report everything still open with its ways out. Never stall silently. Once an identity asset is
accepted, add it to the library with its source so the next reel does not acquire it again.

**Gate:** no `identity` requirement is satisfied by a drawn asset. Ever.

---

## Step 3 — Data and charts

**Read:** [references/step-3-data.md](references/step-3-data.md)

Only when the script states a figure. Find it, record the source and a verbatim quote, re-fetch to
confirm the quote is still there, and put the whole lot in front of the user before it renders.

**Gate:** every number on screen traces to an approved datum. Axis labels are read from it, never
retyped.

---

## Step 4 — Compose each beat

**Read:** [references/visual-vocabulary.md](references/visual-vocabulary.md) — what a beat can be
made of, and why type alone is not a motion-graphics video. Then
[references/step-4-compose.md](references/step-4-compose.md).
[references/archetypes.md](references/archetypes.md) only if authoring fails.

**Read the HyperFrames skills** — `hyperframes-registry` **first**, because roughly 400 blocks and
components already exist and searching is free; `hyperframes-core` for the composition contract and
the `data-*` timing attributes; `hyperframes-animation` for motion rules, blueprints, transitions
and the named text effects. This skill owns the story, the beats, the assets and the creative laws;
HyperFrames owns the composition mechanics and the render.

**Gate:** `npx hyperframes check --samples 24` passes **with a non-zero sample count**. See the
hard rules below — a clean-looking report with zero samples means nothing ran.

---

## Step 5 — Render and deliver

**Read:** [references/step-5-render.md](references/step-5-render.md)

Write `reel.json`, then `npm run render -- reel.json`. It renders each beat as its own clip and a
master that mounts them all, checks every file, and bakes the hook's strongest settled frame in as
the thumbnail. Add `--sfx` for sound effects. Write the report. The run is recorded; open the studio
(http://localhost:5198) or not, as the user chose in Step 0.

**Gate:** every clip passes `checkVideo.ts` with zero findings, and `report.md` has a provenance
line for every asset and every number.

---

## Hard rules

These are not style preferences. Each one is here because its absence produced a defect that
shipped.

**Nothing is invented.** Not a statistic, not a logo, not a testimonial, not a claim. If the script
does not say it and no source supports it, it does not go on screen. A generated logo is a
fabricated logo.

**Nothing secret leaves the capture step.** You are photographing real product screens, which hold
real customer names, addresses, invoice numbers and internal hostnames. Everything captured can end
up in a video that gets posted. Scan captures for those shapes; mask or reject, and say which in
the report.

**A capture that cannot be read is a failed capture.** Compute it, don't eyeball it: the browser
knows the smallest computed `font-size` in the node you captured, so
`renderedPx = minFontSizePx × (targetWidthInFrame ÷ captureWidth)`. Below 11px, refuse the capture
and say what crop it needs. The predecessor's screenshots were full browser windows at 1512×792
landing at 35% of a 1080 frame — body text rendered at about three pixels.

**`check` reporting `0 sample(s)` is a failure, not a pass.** A lint *error* switches the layout and
contrast audits off entirely, and the report then reads clean because nothing ran. Confirm the
sample count every time.

**Every beat boundary is a hard cut.** This is settled, not a preference. A cross-fade between two
compositions ghosts; a wipe cuts through type — eight clipped boundaries the last time one was
tried. Continuity comes from matching the outgoing exit direction to the incoming entry edge.

**Frame 0 of every beat is legible.** Opacity leads position: full opacity within a few frames while
the move keeps easing. An entrance from `opacity: 0` makes the first frame of a hard cut blank, and
frame 0 of the first beat is the thumbnail.

**Determinism.** No `Date.now()`, no `performance.now()`, no unseeded `Math.random()`, no
render-time network, no `repeat: -1`. Every frame must be reproducible from its time alone.

---

## The reading floor

The one number this skill will not bend on, because pace comes from motion and cuts — never from
pulling text away before it can be read.

| | settled on screen |
|---|---|
| a label, 1–3 words | ~0.8s |
| a sentence | ~0.3s per word, never under 1.2s |

Counted from when the *whole line* is visible and settled, not from when it starts entering. An
entrance is not reading time.

Plan that floor first, then make everything else fast — entrances stay 0.3–0.6s. A line slams in
and then holds; that reads as punchy *and* legible. **The payoff gets the most time, not the least.**
The commonest defect in the predecessor's output was a punchline scheduled into the last 25 frames
of a beat, so it arrived and left inside 0.83 seconds.

---

## Requirements

- Node 22+
- FFmpeg on `PATH`
- `npx hyperframes` (check with `npx hyperframes doctor`)
- For captures that need judgement: the Claude in Chrome extension. Puppeteer handles unattended
  re-captures of the same target.
