# Step 4 — Compose each beat

One HyperFrames sub-composition per beat. You write it: HTML, scoped CSS, one paused GSAP timeline.

**Read [design-system.md](design-system.md) first** — what 809 launch films actually look
like, and the grammar they share. Then [visual-vocabulary.md](visual-vocabulary.md), which decides
what register the beat is in. Build on the kit ([kit.md](kit.md)) — `data-look` on the root gets you
the fonts, grounds, texture, UI pieces and motion helpers — and open the pattern nearest your beat
in `assets/patterns/` ([patterns.md](patterns.md)) to see the moves done properly.

**Start from your own patterns first.** `npm run patterns -- list` puts the beats the user rated "Works" first,
best-rated first, then the built-in ones. `npm run patterns -- show <id>` gives the file and the slots to
replace (words, numbers, assets, recordings). Keep its layout, motion and timing; rename its composition id
and timeline key to the beat's id; write `"pattern": "<id>"` on the beat in `reel.json`, so the studio knows
which patterns keep working.

**Type comes from the pairing.** Set headlines with `.rc-head` or `.rc-display` (or
`font-family: var(--font-display)` with `var(--display-weight)`, `var(--display-tracking)` and
`var(--display-case)`), body in `var(--font-sans)`, the accent word in `em.rc` or `.rc-serif`, and code in
`.rc-mono`, so the reel's `"type"` pairing reaches every beat. A beat may name a bundled family directly
(`font-family: 'Caveat'`) for one element. Never load a font from the web: only bundled families exist
(`npm run fonts -- list`).

Then the HyperFrames skills. **`hyperframes-registry` before you hand-build any named visual**: a
chart, a terminal, a device frame, film grain, a shimmer sweep — roughly 400 are already written
and seek-safe, and search costs nothing. `hyperframes-core` for the composition contract and the
`data-*` attributes. `hyperframes-animation` for motion rules, blueprints, the transition catalog
and 24 named text effects.

This file owns the creative laws; those own the mechanics.

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

**Commit to the ground.** One of the kit's looks, held for the reel: paper, ink, flood, sky,
cinema, poster. Texture under it — grain always, mesh or bloom behind. A flat colour with a block
of type pinned to one corner is the look of a page that has not decided anything.

**Scale contrast is the hierarchy.** On a 1080 square a headline is 90–120px, a hero word 200px and
up, the supporting line 30–40px. Tracking tight (−0.04em and tighter) at display sizes. One word in
italic serif and the accent colour carries the meaning of the line.

**Centre one idea, with room.** Shipped films centre a single idea and leave half the frame empty.
Off-centre is a decision — a bottom-left statement, a headline above a chart — never a default
72px gutter with nothing on the right.

**Product surfaces are big and real.** A UI card spans 60–85% of the frame, has real labels and
numbers, depth from radius and shadow, and something happens in it. See
[design-system.md](design-system.md#product-surfaces--real-large-alive).

**Resolve, don't slide.** Entrances come out of blur (`RC.words`, `RC.blurIn`), 0.6–0.8s, on a
spring. And nothing is ever quite still: a camera push or a drift runs under every beat.

**Move like Apple.** Every tween you write names a spring or an Apple curve: `spring.snappy` (press,
toggle), `spring.default` (a panel, a thumb, a lens, a value), `spring.page` (a push, a big move),
`spring.gentle` (arrivals), `spring.soft` (far, large things), `apple.exit` (leaving, quicker than
arriving), `apple.glide` (a cursor, a pen), `apple.out` (fades). Never `expo`, `back`, `elastic` or
`power` eases; one `spring.reward` per reel at most. See [kit.md](kit.md#motion--apples-springs).

**Apple UI is in the kit.** iPhone controls and surfaces, the Mac, app mockups (Messages, Mail,
Calendar, Maps, Music, Photos, Wallet, the home screen) and feedback moments (a check that draws,
an odometer, Saved) are ready as classes and helpers, with a pattern for each in
`assets/patterns/apple/`. Open [apple-ui.md](apple-ui.md) before drawing any UI yourself.

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

**A generated clip is a plate, not a picture of the product.** Where Higgsfield made a background, it goes full-bleed
(`data-frame="plain" data-fit="cover"`) under a scrim, with all the meaning in HyperFrames type above it. Start
from `assets/patterns/footage/generated-backdrop.html`. See [generate.md](generate.md).

**A recording is placed, not recreated.** When the beat shows a real step and the library has a moment for
it, the composition holds a `.rc-footage` box with a `data-footage` reference and the render makes the
`<video>`. Frame it on the grid, enter it with a rise (never a blur: it is the product and is sharp from the
first frame), zoom into the part the line is about, ring the thing to look at. It is not drawn over, not
restyled, and not played faster than 2x. See [footage.md](footage.md).

**Every mark carries information.** A divider that divides is structure. A hairline with a label
next to it is decoration, and decoration reads as filler.

**One idea per frame.** If a frozen frame needs two sentences to explain, it is two beats.

**Every frozen frame postable.** Applied to any frame, not just the good one.

**Adjacent beats differ in structure**, not only in words. Two stacked-headline beats in a row read
as one long beat — and differ in *register* too, not just layout: type, then a product surface,
then a number, then type. See [visual-vocabulary.md](visual-vocabulary.md).

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

Then **measure it**. `check` finds what is broken; it cannot find what is 3px off, and that is what
separates a polished beat from a plausible one:

```bash
npm run measure -- compositions/beat-03.html 0.4,2.6,4.3 --guides --scan --bearings ".rc-head .ln"
```

It prints layout rectangles with the camera push off, flags anything outside the 84px safe area or
under 16px, and draws the grid over a screenshot in `out/measure/`. Read the screenshot with the
guides on: margins, the content region, the headline's ink flush with the left margin. See
[kit.md](kit.md#layout-discipline).

Then look at stills, mid-transition as well as settled. Every numeric gate here has been wrong at
least once; the rendered frame has not.

## When authoring fails

Fall back to [patterns.md](patterns.md): adapt the nearest pattern. An adapted pattern is worse than a composed beat and
much better than no clip.
