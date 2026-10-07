# Step 1 — Script to beats

## Segment it

```bash
npm run beats -- <script.txt|script.srt> [--fps 60] [--short]
```

An `.srt` carries exact timings. A `.txt` is estimated from words per minute, and the output says
so — every duration downstream inherits that estimate, so if the real voiceover exists, use the SRT.

Read the output before going further. Two things in it matter:

- **`TIGHT`** on a beat means the line's reading floor is longer than the beat. That is not a
  warning to wave through. Cut the copy or split the beat; never speed it up.
- **`no sentence punctuation found`** means segmentation fell back to fixed-duration chunking and
  the boundaries are arbitrary. Fix the script's punctuation rather than living with it.

`--short` additionally proposes a 15–25s cut: hook, two or three highlights, payoff, in source
order, with no beat compressed below its floor.

## Then answer these, before composing anything

Write the answers down. They are what the briefs are built from.

```
1.  What is this script arguing?
    One sentence. Not the topic — the claim.

2.  Who is it for, and what do they already believe?
    The beat that changes their mind is the one that matters.

3.  What is the hook?
    The first two seconds decide whether anyone watches the rest. Which beat is it,
    and does it earn the next fifteen seconds?

4.  What is the payoff?
    The line the viewer leaves with. It gets the MOST time in the cut, not the least.

5.  Which beats carry a real thing?
    A product screen, a mark, a figure. Those become AssetRequirements in step 2.
    Everything else is type.

6.  Which beats state a number?
    Those go to step 3 and cannot render until their source is approved.

7.  What is the visual identity?
    Ground, ink, accent. Taken from the product or the brand if there is one.
    "Commit to the ground" is a rule, so pick a real colour, not an almost-white.

8.  What does each beat DO?
    Reveal, contrast, escalate, resolve, demonstrate. This is the field that decides
    the composition in step 4, so it is the one worth arguing with yourself about.

9.  Where are the hard cuts going to hurt?
    Two busy beats in a row, or two that look alike. Adjacent beats should differ in
    structure, not just in words.
```

## Write a brief per beat

A `BeatBrief` is the contract between this step and step 4. Nothing in it names a template, a slot
or a behaviour — those do not exist here.

```ts
{
  intent: "Contrast two tools and refuse to name a winner",
  mustRead: ["Nicht welcher besser ist.", "Kein Sieger"],   // verbatim from the script
  emphasis: ["Nicht", "besser", "Kein"],                     // must occur in mustRead
  mustShow: ["the ChatGPT wordmark", "the Claude wordmark"],
  composition: "The field divides into two equal halves; at the payoff the division
                dissolves and the answer takes the space the comparison held.",
  phases: [{ at: 0, does: "the claim arrives and the field divides" }, …],
  palette: { ground: "#ede9e3", ink: "#14110e", accent: "#d02d1c" },
  durationSeconds: 4.07,
}
```

Validate every one:

```ts
import { parseBeatBrief } from "../../../src/brief/beatBrief.js";
```

`validateBeatBrief` enforces what cannot be argued with — emphasis may only quote words the script
actually says; every line must fit its own reading floor inside the beat; phases must be ordered,
inside the beat, and start near zero so no beat opens on a still frame; ink must be legible on
ground and accent distinguishable from ink.

If you have no direction at all for a beat, `deterministicBeatBrief(input)` produces an honest
minimum — one line, held, on a committed ground, with no invented emphasis. It is a floor, not a
target.

## The field that does the work

`composition` is the one that decides whether the beat is any good. Everything else is transcription.

Work out what the sentence *does*, then describe a layout that does the same thing:

- a beat that refuses to choose → the field divides, then the division dissolves
- a beat about scale → things accumulate down a growing measure
- a beat about breadth → things spread across the whole field and arrive together
- a beat that negates → the word being rejected is struck through, after it has been read
- a beat that narrows → start wide, close in

Write it in plain language. Never name a template.
