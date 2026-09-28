# Step 4 — Compose each beat

One HyperFrames sub-composition per beat. You write it: HTML, scoped CSS, one paused GSAP timeline.

**Read `hyperframes-core` first** for the composition contract, and `hyperframes-animation` for
motion. This file owns the creative laws; those own the mechanics.

## The rule everything else serves

**Decide what the sentence does, then make the composition do it.**

A beat that says *"it is not about which is better"* and pays off with *"no winner"* is a
comparison refusing to produce one. So the field divides into two equal halves, and at the payoff
the division dissolves and the answer takes the space the comparison held. The layout carries the
meaning; the words confirm it.

The alternative — a headline strip, two logo boxes and a labelled divider — is what the predecessor
pipeline did through a slot vocabulary, and the meaning had to live entirely in the words. That
beat measured 6.7% mean ink. Composed for its own sentence, 29.6%.

## The creative laws

**Commit to the ground.** Full-bleed colour or full-bleed image. A tinted off-white with safe
margins and a hairline rule is the look of a page that has not decided anything.

**Type carries the composition.** Oversized, tight-tracked, cropped by the frame, asymmetric. On a
1080 square a headline is 90px and up, a payoff 140px and up. Medium-sized centred type with even
margins means nothing was designed.

**The reading floor**, counted from when the whole line is on screen and settled:

| | settled |
|---|---|
| label, 1–3 words | ~0.8s |
| sentence | ~0.3s/word, never under 1.2s |

Plan the floor first, then make everything else fast — entrances stay 0.3–0.6s. A line slams in and
holds. **The payoff gets the most time, not the least.**

**Out, then in.** Never crossfade two busy layouts; you get a double exposure. Clear the field
completely, *then* bring the next thing, with a real gap. `hyperframes check` catches the overlap
if you get it wrong — it reports two text blocks in one zone.

**Every mark carries information.** A divider that divides is structure. A hairline with a label
next to it is decoration, and decoration reads as filler.

**One idea per frame.** If a frozen frame needs two sentences to explain, it is two beats.

**Every frozen frame postable.** Applied to any frame, not just the good one.

**Adjacent beats differ in structure**, not only in words. Two stacked-headline beats in a row read
as one long beat.

## Frame 0 is legible

Opacity leads position: full opacity within a few frames while the move keeps easing. An entrance
from `opacity: 0` makes the first frame of a hard cut blank — and frame 0 of the first beat is the
thumbnail.

In a staggered entrance the **first item leads** at `opacity: 0.55`, and the rest start at 0.

This is not theory. Removing the inter-beat transition in the predecessor exposed 11 of 14 beats at
0–5% ink at frame 0, and every hard cut here lands on the incoming beat's frame 0.

## The HyperFrames contract — the parts that bite

- **One paused timeline** per composition on `window.__timelines["<data-composition-id>"]`,
  registered **after** the build completes. Register before an async build finishes and the render
  is blank.
- **`data-duration` on the root is read once at compile time.** A script cannot change it and
  neither can `--variables`. Beat length is written into the HTML, not passed in.
- **The visibility window is half-open**, `[start, start + duration)`. Land the last state slightly
  *before* `data-duration` or its final frame never renders.
- **Determinism**: no `Date.now()`, no `performance.now()`, no unseeded `Math.random()`, no
  render-time network, no `repeat: -1`. Finite repeats use `floor`, never `ceil`.
- Do not tween `display`, raw `visibility` or `autoAlpha` **on a clip element** — HyperFrames owns
  clip visibility. Put `data-start` on a wrapper and animate its children.
- Do not pair a CSS initial `transform` with a GSAP tween on the same property.
- A sub-composition wraps its root in `<template>`, and its `<style>` and `<script>` go **inside**
  the template. Anything outside is discarded. Style the root by `#root`, never by a class.

## German typography

Compounds run long and do not hyphenate politely — break headlines to two lines deliberately rather
than letting them wrap. Measured on this project's font metrics: **uppercase is under-measured by
~26%** and lowercase over-measured by ~16%, so an all-caps line that fits on paper overflows on
screen. `ß`, umlauts and `„…"` all render; do not substitute.

## Check it

```bash
npx hyperframes check --samples 24
```

**`0 sample(s)` is a failure, not a pass.** A lint *error* switches the layout and contrast audits
off and the report then reads clean because nothing ran. Confirm the sample count every time.

`check` also fails a 3s+ composition whose geometry never changes (`sweep_static`), and flags
transient overlaps as info — read those, they are usually a crossfade you meant to be a cut.

Then look at stills, mid-transition as well as settled. Every numeric gate here has been wrong at
least once; the rendered frame has not.

## When authoring fails

Fall back to [archetypes.md](archetypes.md). A filled archetype is worse than a composed beat and
much better than no clip.
