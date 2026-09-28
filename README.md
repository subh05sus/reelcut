# reelcut

**A script goes in. A folder of clips comes out.**

`reelcut` is a Claude Code skill. Give it a spoken script — plain text or an `.srt` — and it
segments it into beats, finds and verifies the assets each beat needs, captures real product
screens, sources data for any charts, composes every beat as HTML + GSAP, and renders one clip per
beat plus a master cut.

It is modelled on [`/brag`](https://github.com/latent-spaces/brag) and shares its central bet: the
quality comes from the model composing each beat against a few hard rules, not from pouring text
into templates. Rendering is [HyperFrames](https://hyperframes.heygen.com/).

There is no model API key. The agent running the skill is the director.

---

## Getting started

### 1. Check you have the prerequisites

```bash
node --version            # must be 22 or higher
ffmpeg -version           # must resolve
npx hyperframes doctor    # Node, FFmpeg, FFprobe and Chrome must all be green
```

`doctor` will also list optional things (whisper, Kokoro TTS, Docker). Those can stay red —
`reelcut` does not use them.

<details>
<summary>If something is missing</summary>

**Node 22** — easiest with a version manager:
```bash
nvm install 22 && nvm use 22          # nvm / nvm-windows
```

**FFmpeg**
```bash
choco install ffmpeg -y               # Windows, from an Administrator terminal
brew install ffmpeg                   # macOS
sudo apt install ffmpeg               # Debian/Ubuntu
```
On Windows, open a new terminal afterwards so `PATH` refreshes.

**Chrome for rendering** is downloaded on first use by `npx hyperframes browser ensure`.
</details>

### 2. Install the skill

```bash
/plugin marketplace add subh05sus/reelcut
/plugin install reelcut@reelcut
```

Restart Claude Code, then check it loaded by typing `/reelcut` — it should offer the command.

<details>
<summary>Other agents, or no plugin system</summary>

```bash
npx skills add https://github.com/subh05sus/reelcut --skill reelcut
```

Or copy `skills/reelcut/` into `~/.claude/skills/reelcut/` and restart.
</details>

### 3. Run it

Put your script somewhere and point the skill at it:

```text
/reelcut script.txt
```

That is the whole invocation. Everything else is optional:

```text
/reelcut script.srt --format vertical      # 9:16 for Reels/Shorts
/reelcut script.txt --short                # a 15-25s cut instead of the whole script
/reelcut script.txt --assets ./logos       # a folder of assets you already have
/reelcut script.txt --no-data              # skip charts entirely
```

An `.srt` gives exact beat timings. A `.txt` is estimated from words per minute — workable, but if
the voiceover already exists, use the SRT.

### 4. What happens

The skill walks five steps and stops at each gate rather than pushing through:

1. **Beats.** It segments the script and shows you the beats with their durations. Any beat whose
   line cannot be read in the time it has is marked `TIGHT` — that needs a decision from you, not a
   faster animation.
2. **Assets.** It matches anything you provided, captures real product screens, fetches brand marks
   from official sources. Anything it cannot get is reported with the ways out.
3. **Data.** Only if your script states a figure. It finds a source, quotes it verbatim, re-checks
   the quote is still live, and asks you to approve before it renders.
4. **Composition.** It writes each beat as HTML + GSAP, composed for what that beat says.
5. **Render.** One clip per beat, a master cut, and a report of where everything came from.

### 5. What you get

```
out/
  clips/beat-03.mp4 …   one per beat — drop these into your edit
  master.mp4            all of them, hard cuts
  poster.jpg
  plan.md               the beats, and what each one does
  report.md             every asset and every number, with its source
  project/              kept, so a single beat can be re-rendered in seconds
```

---

## Handing it assets

Three ways, in the order the skill tries them:

**Drop them in the conversation.** Paste or attach images. They get matched against what the script
needs before anything is searched for.

**Put them in a folder.** `--assets ./logos`, or the default `assets/in/`. Name files after what
they are — `claude-logo.svg` matches a requirement called "Claude Logo" exactly and is used without
asking. A vaguer name still matches, but as a proposal you confirm.

**Let it fetch them.** Brand marks come from the brand's own press page, with the licence recorded.
Product screens are captured live.

### When something is missing

It will not stall silently. You get a report like this:

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

Option 4 is always there, so a missing asset is never a dead end — worst case the beat is
recomposed as type.

A brand logo will **never** be drawn to fill a gap. A generated logo is a fabricated logo, and the
skill treats that the same as a fabricated statistic.

---

## Running the pieces yourself

The steps are ordinary scripts. Useful when debugging, or to sanity-check a script before you
commit to a full run:

```bash
git clone https://github.com/subh05sus/reelcut && cd reelcut
npm install

npm run beats -- examples/claude-vs-chatgpt.txt --short   # script → beats → a 15-25s cut
npm run check-video -- out/clips/beat-03.mp4              # the frame checker
npm test                                                  # 74 tests
```

`npm run beats` on the bundled example prints:

```
claude-vs-chatgpt.txt — 15 beats, 62.3s, durations ESTIMATED from words per minute

  #   secs  floor
   0  6.67  5.40        Claude oder ChatGPT? Wenn du heute nur eine KI für deine Arbeit…
   1  5.20  4.20        Beide sind extrem leistungsfähig, aber sie fühlen sich…
  …

short cut — 4 of 15 beats, 17.8s
  hook      # 0  6.67s  Claude oder ChatGPT? …
  payoff    #14  4.43s  Wenn du nur eines behalten dürftest…
```

---

## The rules it will not bend

- **Nothing is invented.** Not a statistic, not a logo, not a claim. If the script does not say it
  and no source supports it, it does not go on screen.
- **Nothing secret leaves a capture.** Real product screens hold real customer names, addresses and
  invoice numbers. Captures are scanned, masked or rejected, and the report says which.
- **A capture that cannot be read is a failed capture.** Measured, not eyeballed: the browser knows
  the smallest font size in what it captured, so whether it will be legible at its size in the
  frame is arithmetic.
- **The reading floor.** A label needs about 0.8s settled on screen; a sentence about 0.3s per word.
  The payoff gets the most time, not the least.
- **Every beat boundary is a hard cut.** A cross-fade between two compositions ghosts and a wipe
  cuts through type. This one is settled, not a preference.

---

## Layout

```
skills/reelcut/     the skill — SKILL.md, references, archetypes, scripts
src/                the engine — planner, brief, verify, render
examples/           a real script to try it on
```

`src/` is plain TypeScript with one runtime dependency (`zod`). It was ported out of a larger
Remotion pipeline; what came across is the part that was never engine-specific — the beat planner,
the brief contract and its validators, the asset-gap logic, and the frame checker.

## Credits

- Modelled on [`/brag`](https://github.com/latent-spaces/brag) by latent-spaces.
- Rendering by [HyperFrames](https://hyperframes.heygen.com/).
