# reelcut

**A script goes in. A folder of motion-graphics clips comes out.**

<p align="center">
  <img src="examples/notiz-apps/poster.jpg" width="420" alt="The thumbnail reelcut chose for its example reel: the hook frame, two product names in their own colours around the word oder, with the question beneath." />
  <br />
  <sub>The thumbnail reelcut picked for <a href="examples/notiz-apps">its example reel</a> — the hook, fully settled, chosen and baked in automatically.</sub>
</p>

`reelcut` is a Claude Code skill. Give it a spoken script — plain text or an `.srt` — and it
segments it into beats, finds and verifies the assets each beat needs, captures real product
screens, sources data for any charts, composes every beat as HTML + GSAP, and renders one clip per
beat plus a master cut.

Its central bet: the quality comes from the model composing each beat against a few hard rules,
not from pouring text into templates. Rendering is [HyperFrames](https://hyperframes.heygen.com/).

**There is no model API key.** The agent running the skill is the director.

> **Status.** The pipeline runs end to end: a script becomes beats, composed beats become a
> HyperFrames project, and the project renders to per-beat clips and a master with an automatic
> thumbnail. Data sourcing and charts are specified but not built. See
> [What works today](#what-works-today).

---

## Contents

- [Getting started](#getting-started)
- [Invocation and every option](#invocation-and-every-option)
- [Creative direction](#creative-direction)
- [The five steps](#the-five-steps)
- [Handing it assets](#handing-it-assets)
- [The gates](#the-gates)
- [Running the pieces yourself](#running-the-pieces-yourself)
- [The rules it will not bend](#the-rules-it-will-not-bend)
- [What works today](#what-works-today)
- [Layout](#layout)

---

## Getting started

### 1. Prerequisites

```bash
node --version            # 22 or higher
ffmpeg -version           # must resolve
npx hyperframes doctor    # Node, FFmpeg, FFprobe and Chrome must be green
```

`doctor` also lists optional things (whisper, Kokoro TTS, MusicGen, Docker). Those can stay red —
`reelcut` does not use them.

<details>
<summary>Installing what is missing</summary>

**Node 22**
```bash
nvm install 22 && nvm use 22          # nvm / nvm-windows
```

**FFmpeg**
```bash
choco install ffmpeg -y               # Windows, from an Administrator terminal
brew install ffmpeg                   # macOS
sudo apt install ffmpeg               # Debian/Ubuntu
```
Open a new terminal afterwards so `PATH` refreshes.

**Chrome** — `npx hyperframes browser ensure` downloads `chrome-headless-shell`. Capture reuses it,
so a machine set up to render is set up to capture.
</details>

### 2. Install the skill

```bash
/plugin marketplace add subh05sus/reelcut
/plugin install reelcut@reelcut
```

Restart Claude Code, then type `/reelcut` to confirm it loaded.

<details>
<summary>Other agents, or no plugin system</summary>

```bash
npx skills add https://github.com/subh05sus/reelcut --skill reelcut
```

Or copy `skills/reelcut/` into `~/.claude/skills/reelcut/` and restart. The repo also ships
`.claude/skills/reelcut` and `.agents/skills/reelcut` symlinks for agents that scan those paths.
</details>

### 3. Run it

```text
/reelcut script.txt
```

That is the whole invocation. Everything else is optional.

---

## Invocation and every option

```text
/reelcut script.srt --format vertical --text minimal
/reelcut script.txt --short --look "Swiss print annual report"
/reelcut script.srt --text none --visuals "real product screens, no abstract shapes"
/reelcut script.txt --palette "#0a0a0a #f2efe9 #ff4b1f" make it feel like a late-90s broadcast
```

| Option | Values | Default |
|---|---|---|
| `--format` | `1:1`, `9:16`, `16:9`, `4:5` | `1:1` |
| `--short` | flag — cut to 15–25s instead of the whole script | whole script |
| `--fps` | | `30` |
| `--assets <dir>` | where to look for files you already have | `assets/in/` |
| `--no-data` | skip data sourcing and charts entirely | data on |
| `--sfx` | add sound effects from the bundled set | silent |
| `--text` | `full`, `key-lines`, `minimal`, `none` | depends on voiceover |
| `--motion` | `restrained`, `default`, `energetic` | `default` |
| `--palette` | `"#ground #ink #accent"` | taken from the source |
| `--look` | freeform art direction | inferred |
| `--visuals` | freeform register steer | inferred |

**Anything else you type is kept as freeform direction** and carried into the plan verbatim.
*"Make it feel like a museum exhibit"* is real direction that no flag will ever capture.

**Input.** An `.srt` gives exact beat timings. A `.txt` is estimated from words per minute —
workable, but if the voiceover already exists, use the SRT.

---

## Creative direction

### `--text` — how much of the script appears on screen

| | |
|---|---|
| `full` | every line on screen; type carries the piece |
| `key-lines` | only the turns of the argument — hook, claim, payoff |
| `minimal` | a label per beat at most, three words or fewer |
| `none` | no text at all; the voiceover carries every word |

**The default depends on whether there is a voiceover.** An `.srt` means spoken audio, so the
default is `key-lines`. A plain `.txt` defaults to `full`.

This is the axis most worth thinking about. A silent video has no choice — type must carry
everything. These reels have a voice, so putting every line on screen makes the viewer read the
sentence they are already hearing, and spends the whole frame doing it.

`none` is not a gimmick. With the words handled by the voice, the frame is free for the product,
the data and the motion — and the reading floor stops applying, because there is nothing to read,
so the cut can move considerably faster. It asks more of the visuals, which is the point.

### `--motion` — how much moves

`restrained` · `default` · `energetic`. Affects entrance durations, stagger spacing, how many
elements move at once, and how much secondary motion a beat carries. It does **not** affect how
long a line stays on screen.

### `--palette`, `--look`, `--visuals`

`--palette` takes three hex values in order. When given, every beat must use them — a beat that
quietly picks its own is a finding, not a variation.

`--look` is art direction ("warm editorial", "late-90s broadcast"). `--visuals` steers the register
("lots of real product screens", "data-forward", "typographic only").

### Direction is enforced, not suggested

`checkBriefAgainstDirection` only ever *adds* constraints. There is no setting that makes a brief
legal which the base validator rejected — "fast and punchy" is not permission to pull a line off
screen before it can be read.

---

## The five steps

The skill stops at each gate rather than pushing through.

### 1 · Script to beats

Parses and segments the script, then writes a `BeatBrief` per beat — intent, the verbatim lines,
emphasis, what must be shown, the composition idea, phases, palette.

Every brief is validated: emphasis may only quote words the script actually says, every line must
fit its reading floor inside its beat, phases must be ordered and start near zero so no beat opens
on a still frame, and ink must be legible on ground.

Beats whose line cannot be read in the time available are marked `TIGHT` — a decision for you, not
a faster animation.

### 2 · Acquire

`mustShow` becomes asset requirements, resolved in order: files you already provided → a capture
of the real product screen → the brand's own source for a mark → drawn, but only if it is generic.

`assetKind` decides what is allowed. **identity** is a specific real thing — a named company's
logo, a real UI — and can never be drawn. **generic** is conceptual and never stalls the reel.

### 3 · Data and charts

Only when the script states a figure. Finds a source, quotes it verbatim, re-fetches to confirm the
quote is still live, and presents claim + source + quote + check result for your approval.

A chart renders from approved data only, and prints its source on the frame.

### 4 · Compose

One HyperFrames sub-composition per beat — HTML, scoped CSS, one paused GSAP timeline — written for
what that beat says rather than picked from a layout menu.

The registers available: type, a real product surface, a simulated interaction, a number that
resolves, a diagram that builds, footage, a logo moment. Plus the structural half — depth, masking,
scale change within the beat, texture.

The [HyperFrames registry](https://hyperframes.heygen.com/) has roughly 400 ready blocks and
components — charts, terminals, device frames, maps, film grain, glitch, shimmer sweeps — and the
skill searches it before hand-building anything named.

### 5 · Render and deliver

```
out/
  clips/beat-03.mp4 …   one per beat — drop these into your edit
  master.mp4            all of them, hard cuts
  poster.jpg            the strongest settled frame, baked as frame 0
  plan.md               the beats, the direction, what each beat does
  report.md             every asset and every number, with its source
  project/              kept, so a single beat can be re-rendered in seconds
```

---

## Handing it assets

Three ways, in the order the skill tries them.

**Drop them in the conversation.** Paste or attach. Matched against what the script needs before
anything is searched for.

**Put them in a folder.** `--assets ./logos`, or the default `assets/in/`. Name files after what
they are — `claude-logo.svg` matches a requirement called "Claude Logo" exactly and is used without
asking. A vaguer name still matches, but as a proposal you confirm. One file answers at most one
requirement, so a single PNG cannot quietly fill two slots.

**Let it fetch them.** Brand marks come from the brand's own press page with the licence recorded.
Product screens are captured live.

### When something is missing

It will not stall silently:

```
1 open requirement, 1 of which stops the reel.

BLOCKS  ChatGPT chat screen — could not be acquired (login wall)
        needed for: The breadth beat
        A specific real thing — it cannot be drawn.
        1. Capture it from the live product — needs a URL, and a sign-in
        2. Drop the file in — needs a file in png
        3. Use another library asset in the same role
        4. Compose the beat without it
```

Option 4 is always present, so a gap is never a dead end. A brand logo will **never** be drawn to
fill one.

---

## The gates

Each one exists because its absence produced a defect that shipped.

| gate | what it refuses |
|---|---|
| **Reading floor** | a line scheduled into less time than it takes to read |
| **Brief validation** | invented emphasis, unordered phases, a beat opening on a still frame, illegible ink |
| **Legibility** | a capture that will render below 11px at the size it appears |
| **Secrets scan** | a capture holding a real email, IBAN, card number, private host or API key |
| **Consent / login** | a cookie wall or sign-in page passing as a product screen |
| **Required text** | a capture that does not contain what it was supposed to show |
| **`hyperframes check`** | runtime errors, layout collisions, WCAG contrast failures, a frozen composition |
| **Frame checker** | a blank panel — a container that forgot to draw its contents |
| **Provenance** | an asset or a number with no recorded source |

**The legibility gate is arithmetic, not judgement.** The browser knows the smallest computed
`font-size` in what it captured, so:

```
renderedPx = bodyFontPx × (targetWidthInFrame ÷ captureWidth)
```

Below 11px it refuses, and says both ways out — crop to at most N px, or give it at least M% of the
frame. Real output:

```
ILLEGIBLE: body 16px renders at 7.0px (scale 0.44)
  body text is 16px in an 864px capture, which renders at 7.0px at 35% of a 1080px frame —
  below the 11px floor. Either crop to at most 549px wide, or give it at least 55% of the frame.
```

It runs on the **body** size — the smallest that still covers 90% of visible characters — so an 8px
legal footer cannot fail an otherwise perfect capture. A capture with no text passes: a photograph
is not illegible, it has nothing to read.

---

## Running the pieces yourself

Every step is an ordinary script. Useful for debugging, or to sanity-check a script before
committing to a full run.

```bash
git clone https://github.com/subh05sus/reelcut && cd reelcut
npm install
```

### `npm run beats` — script → beats → cut

```bash
npm run beats -- examples/notiz-apps.txt --short
```
```
notiz-apps.txt — 14 beats, 59.6s, durations ESTIMATED from words per minute

  #   secs  floor
   0  6.67  5.40        Notara oder Kettlebrief? Wenn du heute nur eine Notiz-App für deine…
   1  4.80  3.90        Beide sind erstaunlich gut, aber sie fühlen sich beim Arbeiten völlig…
  …

short cut — 4 of 14 beats, 18.2s
  hook      # 0  6.67s  Notara oder Kettlebrief? …
  payoff    #13  4.43s  Wenn du nur eine behalten dürftest, würdest du Notara oder…
```

The example is a fictional comparison of two invented note apps. It has the shape of a real
reel — comparison, contrast, thesis, payoff — without being anyone's actual script.

### `npm run capture` — a product surface, with all four gates

```bash
npm run capture -- https://example.com \
  --selector "body > div" --target-width 0.8 \
  --out assets/in/card.png --must-contain "Example Domain"
```

Writes the PNG plus a `.json` sidecar carrying url, selector, timestamp, element size, body font
size and what it renders at — which is what `report.md` is built from. Exits non-zero on a refusal.

### `npm run intake` — match what you have against what is needed

```bash
npm run intake -- --dir assets/in --requirements out/requirements.json
```

Reports matches with a confidence and everything still open with its ways out. Exits non-zero only
when a gap actually blocks the reel. Reports only — it never moves or renames a file.

### `npm run render` — beats to clips, a master and a thumbnail

```bash
npm run render -- examples/notiz-apps/reel.json [--sfx] [--clips-only] [--master-only]
```

`reel.json` lists the beats, their durations and their compositions. Every beat renders as its own
project, so one broken beat fails alone and the rest still ship. Each file then goes through the
frame checker, and only files that rendered **and** passed are reported as delivered.

```
4 beats, 18.13s, 1080x1080 @ 30fps, silent
  beat-00 … ok
  beat-03 … ok
  beat-10 … ok
  beat-13 … ok
  master … ok
  poster … 6.25s (hook_settled), baked as frame 0 — 544 frames, unchanged

5 of 5 rendered and passed.
```

Three things it checks that would otherwise fail silently:

- **Ids.** A sub-composition whose timeline key does not match its host renders **frozen at t=0**
  with no error. The project is refused instead.
- **Frame count.** Times are written a hair below each frame boundary, so the renderer lands on
  exactly the frame intended. The first version wrote 122 frames as `4.0667` and got 123.
- **The thumbnail.** Frame 0 is replaced — never added to, which would shift every beat — by the
  fullest settled frame of the **hook**, the beat whose job is to say what the video is. Override
  with `"poster": <seconds>` in the manifest.

`--sfx` adds sound effects placed in the manifest, mixed at 0.35 by default. Off unless asked for.

### Sound effects

Seven effects ship in `skills/reelcut/assets/sfx/` — whoosh, swipe, tick, pop, thud, rise and
chime. They are **synthesised, not recorded**: each is a formula in `tools/generate-sfx.ts`, so the
set is original, carries no licence, regenerates byte-identical, and is 45KB in total. Every one is
normalised to the same −3 dBFS peak, so a single volume setting behaves the same across all of them.

```bash
npm run sfx:generate      # rebuild the set
```

Rendered with `--sfx`, the example reel's three effects land within ~5ms of where they were placed
— under one frame. See [sound.md](skills/reelcut/references/sound.md) for what goes under what, and
why three sounds in 18 seconds is about right.

### `npm run check-video` — the frame checker

```bash
npm run check-video -- out/clips/*.mp4
```

Blank panels are the only hard failure. Static holds and grid ink are reported, never gated: a long
hold on a payoff is the reading floor working, not a defect.

### `npm test`

```bash
npm test          # 168 tests
npm run typecheck
```

---

## The rules it will not bend

- **Nothing is invented.** Not a statistic, not a logo, not a claim. If the script does not say it
  and no source supports it, it does not go on screen. A generated logo is a fabricated logo.
- **Nothing secret leaves a capture.** Real product screens hold real customer names, addresses and
  invoice numbers. Captures are scanned, masked or rejected, and the report says which.
- **A capture that cannot be read is a failed capture.** Measured, not eyeballed.
- **The reading floor.** A label needs ~0.8s settled on screen; a sentence ~0.3s per word, never
  under 1.2s, counted from when the whole line is visible. The payoff gets the most time, not the
  least.
- **Every beat boundary is a hard cut.** A cross-fade between two compositions ghosts and a wipe
  cuts through type. Settled, not a preference.
- **Frame 0 of every beat is legible.** Opacity leads position, so a hard cut never lands on a
  blank frame.
- **Determinism.** No clocks, no unseeded random, no infinite repeats. Every frame reproducible
  from its time alone.

---

## What works today

| | |
|---|---|
| Script → beats → short cut | ✅ verified on a 14-beat German script |
| Brief contract and validation | ✅ tested |
| Creative direction | ✅ tested |
| Asset intake and gap reporting | ✅ tested, verified end to end |
| Capture with all four gates | ✅ tested, verified against a live page |
| Beats → HyperFrames project | ✅ tested, including the frozen-render and drift invariants |
| Render → clips, master, thumbnail | ✅ **produced a real 18s reel**, every frame count exact |
| Frame checker | ✅ tested, catches a real blank panel in a third-party video |
| Sound effects (`--sfx`) | ✅ seven synthesised effects; verified landing within 5ms in a real render |
| Data sourcing and charts | ⚠️ specified, not built |

---

## Layout

```
skills/reelcut/
  SKILL.md              the router: five steps and the hard rules
  references/           direction, the five steps, visual vocabulary, sourcing, archetypes
  assets/archetypes/    six seed compositions — the fallback, not the default
  scripts/              beats, intake, capture, render, check-video
src/
  core/                 reading floor, frame sizes, the Beat schema
  planner/              parse, segment, merge, density, short cut
  brief/                BeatBrief + validators, asset gaps, asset intake
  capture/              legibility gate, secrets scan, Puppeteer capture
  direction/            creative direction and its enforcement
  verify/               the frame checker
  render/               project builder, poster choice, the HyperFrames render route
examples/               a script to try it on, and a composed, renderable reel from it
```

`src/` is plain TypeScript with two runtime dependencies (`zod`, `puppeteer-core`). It was ported
out of a larger Remotion pipeline; what came across is the part that was never engine-specific.

## Credits

- Rendering by [HyperFrames](https://hyperframes.heygen.com/).
