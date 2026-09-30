# Direction — steering the look without breaking the rules

Direction is given at invocation, in flags or in plain language, and both reach the plan.

```
/reelcut script.srt --text minimal --look "Swiss print annual report"
/reelcut script.txt --palette "#0a0a0a #f2efe9 #ff4b1f" --motion restrained
/reelcut script.srt --text none --visuals "real product screens, no abstract shapes"
/reelcut script.txt make it feel like a late-90s broadcast package
```

Anything not matched by a flag is kept as freeform direction and carried into the plan **verbatim**.
"Make it feel like a museum exhibit" is real direction that no flag will ever capture.

## The axes

### `--text` — how much of the script appears on screen

| | |
|---|---|
| `full` | every line on screen; type carries the piece |
| `key-lines` | only the turns of the argument — the hook, the claim, the payoff |
| `minimal` | a label per beat at most, three words or fewer |
| `none` | no text at all; the voiceover carries every word |

**The default depends on whether there is a voiceover.** An `.srt` means there is spoken audio, so
the default is `key-lines`; a plain `.txt` with no voiceover defaults to `full`.

This is the axis most worth thinking about, and the one `/brag` has no equivalent for — `/brag`
makes silent videos, so type has to carry everything. These reels have a voice. Putting every line
on screen makes the viewer read the sentence they are already hearing, and spends the whole frame
doing it.

`none` is not a gimmick. With the words handled by the voice, the frame is free for the product,
the data and the motion — and the reading floor stops applying, because there is nothing to read,
so the cut can move considerably faster. It asks more of the visuals, which is the point.

### `--motion` — how much moves

`restrained` · `default` · `energetic`

Affects entrance durations, stagger spacing, how many elements move at once, and how much
secondary motion a beat carries. It does **not** affect how long a line stays on screen.

### `--palette "#ground #ink #accent"`

Three hex values, in that order. When given, every beat must use them — a beat that quietly picks
its own is a finding, not a variation. On the kit they become `--ground`, `--ink` and `--accent` on
each beat's `#root`.

### `--look` and `--visuals`

`--look` names one of the kit's looks — `paper`, `ink`, `flood`, `sky`, `cinema`, `poster` (what each
is for: [design-system.md](design-system.md#grounds--commit-to-one-per-reel)) — or is freeform art
direction ("warm editorial", "Swiss print annual report", "late-90s broadcast") that you translate
into the nearest look plus overrides. `--visuals` steers the register ("lots of real product screens", "data-forward",
"typographic only") — see [visual-vocabulary.md](visual-vocabulary.md).

## What direction may never do

It sets register, palette, density and energy. It does not touch:

- **the reading floor** — "fast and punchy" is a legitimate instruction and does not mean a line
  may be pulled away before it can be read. Pace comes from motion and cuts.
- **determinism** — no clocks, no unseeded random, no `repeat: -1`, whatever the look.
- **hard cuts** at every boundary.
- **the rules against inventing content** — no direction authorises a drawn logo or an unsourced
  figure.

This is enforced, not just stated: `checkBriefAgainstDirection` only ever *adds* issues. There is
no setting that makes a brief legal which `validateBeatBrief` rejected.

## Applying it

Record the direction at the top of `plan.md` — `describeDirection` formats it — so it sits beside
the beats and can be argued with.

Then check every brief against it before composing:

```ts
import { checkBriefAgainstDirection, checkReelAgainstDirection } from "../../../src/direction/direction.js";
```

Per beat: `none` refuses any on-screen text, `minimal` holds a line to three words, and a given
palette must actually be used.

Across the reel: `key-lines` is about proportion and cannot be judged one beat at a time. One beat
with text is the point; every beat with text is `full` wearing a different name. The check fires
above 60%.

## When direction and script disagree

A script full of quotable one-liners under `--text none`, or a dense argument under `--text
minimal`, is a real tension and not something to resolve silently.

Say so, name the two options — change the direction, or cut the copy — and let the user pick. What
you must not do is split the difference by shrinking a line's time on screen until it technically
fits.
