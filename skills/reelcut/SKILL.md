---
name: reelcut
description: Turn a spoken script into a set of motion-graphics clips — one per beat, plus a master cut. Finds and verifies the assets the script needs, captures real product screens, sources data for charts, and composes each beat as HTML + GSAP. Use when someone says "/reelcut", gives you a script or an SRT and wants video out of it, or asks for clips for a reel.
---

# /reelcut

A script goes in. A folder of clips comes out, each one composed for what its line actually says.

## What this is not

It is not a template filler. There is no library of layouts to pick from and pour text into — that
approach is what the predecessor to this skill did for a year, and it is why its beats put content
on a quarter of the frame and read as generic. **You compose each beat**, on the kit in
`assets/kit/`, looking at the patterns in `assets/patterns/` for how each move is done properly.

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

Run `npm run beats` on the script first, then read what the studio has learned
(`npm run learnings -- brief --script <script>`, see [references/learnings.md](references/learnings.md)),
then ask the user — with the AskUserQuestion tool, at most
two rounds — about everything the invocation left open: how much text goes on screen, the length,
the look and palette, motion, format, sound, and whether to open the studio. Options are tailored
to *this* script, the recommended one first. Never ask about what a flag or the freeform direction
already answered, and skip the questions when the run is unattended.

`npm run references -- brief` describes the films the user has kept as references (how they cut, what ground
they sit on, the moves in them) — use it to explain a recommendation; only a learned rule that is *on* steers
the reel. See [references/reference-videos.md](references/reference-videos.md).

**Higgsfield, when it can help.** Check whether the Higgsfield MCP is connected (search your tools for it). If
it is not, ask nothing and say so in one line: every beat is composed in HyperFrames. If it is, run
`npm run generate -- plan --beats … --connected yes` once the beats are known; when it says to ask, ask the one
question (below) with a credit estimate. See [references/generate.md](references/generate.md).

Learned rules shape the questions: the option a rule prefers goes first, marked `(Recommended)`, and
a question a rule already answers (a pinned look, a motion tempo) is not asked again but confirmed in
one line. An answer given now always beats a learned rule.

When the script has beats that show a real thing being done ("now download Claude", "add the MCP"),
run `npm run footage -- list` and say which steps already have a recording. For a step that has none,
tell the user a recording of it (Shift-Cmd-5 on a Mac) will be used exactly as recorded, where the
alternative is an animated stand-in. See [references/footage.md](references/footage.md).

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

Assets the user has dropped into the studio (or a watched folder) are in the library too. The ones
they have approved match like any other. The ones still `pending` are shown as proposals and never
applied by themselves: say so, and tell the user they can approve them in the studio's Review tab.

**Higgsfield (AI video) is for backgrounds and abstract ideas only**, and only when connected and agreed. A beat that
needs a real product, mark, screen or recorded step is never generated; a generated clip is generic, is used
as soon as it is registered (no approval step), is placed under HyperFrames type, and is labelled AI-generated in the
report. Any failure, timeout or missing connection falls back to composing that beat in HyperFrames, and is
logged (`npm run generate -- record`). See [references/generate.md](references/generate.md).

**Recorded steps are footage, not drawings.** A `mustShow` that is a real thing being done becomes a
requirement with `"form": "footage"` and the step as its name ("Download Claude"). It is answered by a
*moment* of a recording in the library (`npm run intake` and `npm run footage -- find` search them), shown
to the user as a proposal the first time and used as it was recorded: trimmed, framed, zoomed and at most
speeded up 2x, never redrawn. A step with no recording is a gap — record it, mark a moment in a recording
you have, or compose an animation as a stand-in. See [references/footage.md](references/footage.md).

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

**Read:** [references/design-system.md](references/design-system.md) — what 809 launch films look like
and the moves they share, counted. Then
[references/visual-vocabulary.md](references/visual-vocabulary.md) — what a beat can be made of —
and [references/step-4-compose.md](references/step-4-compose.md). Compose on the kit
([references/kit.md](references/kit.md): `data-look` on the root injects looks, UI pieces and
motion helpers) and open the nearest pattern ([references/patterns.md](references/patterns.md))
before you start a beat of its kind.

**Read the HyperFrames skills** — `hyperframes-registry` **first**, because roughly 400 blocks and
components already exist and searching is free; `hyperframes-core` for the composition contract and
the `data-*` timing attributes; `hyperframes-animation` for motion rules, blueprints, transitions
and the named text effects. This skill owns the story, the beats, the assets and the creative laws;
HyperFrames owns the composition mechanics and the render.

Where a beat shows a recorded step, **place the recording; do not recreate it**: a
`<div class="rc-footage" data-footage="<asset>:<moment>">` in the composition, framed on the grid, with
`RC.rise` (never a blur) and, where the text is small, `RC.zoomTo`. Start from
[`patterns/footage/footage-window.html`](assets/patterns/footage/footage-window.html). Check the box with
`npm run measure -- <beat.html> <t> --format <fmt>`: an ILLEGIBLE footage line is a failed beat. A recording
shot on a green screen is keyed to transparency by the render; place it with `data-frame="cutout"` and start from
[`patterns/footage/footage-cutout.html`](assets/patterns/footage/footage-cutout.html).

**Compose in parallel.** The beats are independent files, so split them across subagents, each owning only its own
`src/beat-NN.html` and `compositions/beat-NN.html`; then measure and render the whole reel once, not beat by beat.

Apply the learned rules you read in Step 0 where they fit the beat, record their ids in `reel.json`
as `appliedLearnings`, list them under **Applied learnings** in `plan.md`, and put the pattern a beat
was adapted from in its `pattern` field, so the studio can learn which patterns are kept.

**Gate:** `npx hyperframes check --samples 24` passes **with a non-zero sample count**. See the
hard rules below — a clean-looking report with zero samples means nothing ran.
Then measure the whole reel once: `npm run measure -- --all reel.json` measures every beat in one Chrome session
(entrance, middle, settled end; guides and scan on) and writes `measure/reel-sheet.jpg` and one list of findings.
**At most two measure rounds per beat.** After the second, ship it, or fall back to the nearest pattern, and say
so in `report.md`; more rounds are where the hour goes. For one beat in detail,
`npm run measure -- <beat.html> <times> --guides --scan` puts the beat on the grid
([references/kit.md](references/kit.md#layout-discipline): 84px margins, a 336–996 content region,
the headline's ink flush with the margin) and flags anything outside the safe area or under 16px.
`check` says a beat is not broken; `measure` says it is exact.

---

## Step 5 — Render and deliver

**Read:** [references/step-5-render.md](references/step-5-render.md)

Write `reel.json`, run `npm run render -- reel.json --preflight` (a second: it lists every beat that cannot
render yet, and why, without rendering), then `npm run render -- reel.json`. It renders the clips several at a
time, checks every file, joins the passing clips into the master (no second render: the master is exactly the
clips that passed) and bakes the hook's strongest settled frame in as the thumbnail. A blocked beat does not
hold up the others; render it later with `--only`, and the master is joined then. Look at `contact.jpg` (a row
of five frames per beat) instead of re-opening compositions in a browser. Add `--sfx` for sound effects: `npm run sfx -- suggest reel.json --apply` proposes cues
from the user's own approved sounds (see [references/step-5-render.md](references/step-5-render.md)).
Write the report. The run is recorded; open the studio
(http://localhost:5198) or not, as the user chose in Step 0.

**Gate:** every clip passes `checkVideo.ts` with zero findings, and `report.md` has a provenance
line for every asset and every number.

---

## Mode — `/reelcut tag-assets`

The studio's Review tab shows a count of assets "waiting for Claude". Those are images, vectors and
videos that were dropped in, previewed and given machine-written tags, but that nobody has looked at.
This mode is how Claude looks.

```bash
npm run library -- queue --json          # id, name, view (a preview file), tags, where it came from
```

For each item, **view the `view` path** (with the Read tool: it is a small image) and write what it
actually shows:

```bash
npm run library -- annotate <id> --tags claude,logo,orange --describe "an orange starburst mark on white"
```

Tags are lowercase words a script or a requirement would use: the brand or product, what it is (logo,
screenshot, icon, photo, chart, texture), the dominant colour. The description is one plain sentence.

**Never** approve anything, and never set an asset's kind: `annotate` cannot, on purpose. Whether a
file is a real brand mark or a real product screen is the user's decision, made in the Review tab. A
mis-tagged file must never become somebody's logo. Skip anything in a private folder (it is not in the
queue). When done, tell the user how many were annotated and that they are waiting for approval.

---

## Mode — `/reelcut study-references`

The studio's References tab holds films the user admires. Each is measured automatically; this mode is how
Claude adds what a measurement cannot see.

```bash
npm run references -- queue --json     # id, name, sheet (a 24-frame contact sheet image), pacing, ground
```

For each, **view the `sheet`** (Read tool) and tag what you see in the fixed words only:

```bash
npm run references -- annotate <id> --moves ui,cur,num --text key-lines --note "product demo, then a counter"
```

`moves` are the whatships tags (`wb big kin ser hl strike roll wheel ui cur chat code dev tilt fly num mesh hud
obj ill icon bub logo foot sr cap`); `--text` is `kinetic`, `key-lines`, `minimal` or `none`. A word outside
the list is refused. These are **suggestions**: they teach the studio nothing until the user accepts them in
the References tab. **Never** accept tags, switch a reference on or off, or delete one, and never describe a
reference's content beyond the note. Tell the user how many were tagged and that they need accepting.

---

## Mode — `/reelcut tag-footage`

Screen recordings that were dropped in but have no moments marked on them are **unmarked**; the Footage tab
lists them. This mode is how Claude helps.

```bash
npm run footage -- queue --json      # unmarked recordings: id, length, a filmstrip image, tags
```

For each, **view the filmstrip** (Read tool: eight frames across the recording) and index the steps you can see:

```bash
npm run footage -- propose <asset> --label "download Claude" --in 2 --out 8.5 --tags claude,download,mac
```

A label is what the viewer sees happen, in the words a script would use for it. The boundaries are coarse —
eight frames — and that is fine: the user can tighten them in the Footage tab. What you index applies at once;
there is nothing for anyone to confirm. If a filmstrip shows something that looks private (a tab strip,
a notification, an email), say so in the report: nothing checks for it any more.

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

**A generated clip is never the real thing.** Higgsfield output is atmosphere under real type: never a product
screen, a logo or lettering, never `identity`, always labelled
AI-generated, and never regenerated by a re-render.

**A recording is used as recorded.** Trim, frame, zoom, speed up to 2x, hold its last frame, annotate over
it. Never re-create it as an animation when a recording exists, never edit what is inside it. Nothing can be
masked in a recording, so a private detail in one (a tab strip, a notification) is only ever flagged in the report.
A green screen is keyed out by the render and never left in the picture.

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
