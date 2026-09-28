# Archetypes — the fallback, not the default

Read this when authoring a beat has failed, or when a run is unattended and nobody is there to
compose. **A filled archetype is worse than a composed beat and much better than no clip.**

If you reach for these because they are quicker, you have rebuilt the thing this skill exists to
replace. The predecessor pipeline picked from a vocabulary of layouts and poured text into them,
and its beats put content on a quarter of the frame.

## The six

All in `../assets/archetypes/`, all 1080×1080, all a `<template>` with scoped CSS and one paused
GSAP timeline.

| file | for a beat that | layout | motion signature |
|---|---|---|---|
| `hook-either-or.html` | poses an either/or | two names stacked around a hinge word, then a sub-line | names arrive in sequence, then a seam draws under them |
| `depth-list.html` | lists things about scale or depth | flex column against a growing vertical measure | first row leads; siblings stagger 0.11 on `x` |
| `breadth-field.html` | lists capabilities or breadth | grid 2×3 across the whole field | near-simultaneous, `stagger 0.055`, `back.out` on scale |
| `thesis-negation.html` | rejects something | one paragraph, the rejected word wrapped | entrance, then nothing until a strike draws at ~3.0s |
| `measure-extent.html` | claims extent or reach | one line, the noun accented | a rule opens to the full frame width |
| `payoff-bookend.html` | closes by reopening the question | flex row: name · mark · name | four staged reveals, rule draws centre-out |

`depth-list` and `breadth-field` are deliberate opposites — one column that accumulates versus a
field that fills at once. If a script contrasts depth against breadth, using both is the point.

## What you may change

- **`palette`** — ground, ink, accent, and one muted tone. Two grounds are provided: paper
  (`#ede9e3` / `#14110e` / `#d02d1c`) and ink (`#14110e` / `#f2efe9` / `#f0a58f`). Pick per beat so
  the palette carries the argument — in the reel these came from, one product's beats are paper and
  the other's are ink, so the viewer knows whose side they are on without being told.
- **`lines`** — the text, and the role of each line: `display`, `body`, `label`, `mark`.
- **`emphasis`** — which word takes the accent. One mechanism everywhere: a `<span class="accent">`.
- **`rule`** — orientation, length, thickness, `transform-origin`, when it draws and for how long.
  Nullable; `breadth-field` has none.
- **`topOffset`** — the one number that is genuinely hand-tuned per beat, because it is vertical
  optical centring against a variable number of lines.
- **`lateAccent`** — `thesis-negation` only: a mark that lands *after* the reading floor rather
  than instead of it.
- **`durationSeconds`** — written into `data-duration`, which is read once at compile time.

## What you may not change

These are not style settings. Each is load-bearing:

- **The 72px gutter.** Every positioned block sits at `left: 72px; width: 936px`.
- **`font-weight: 700`**, and negative letter-spacing that tightens as size grows.
- **Opacity leads position.** The first element of any entrance starts at `opacity: 0.55`, never 0,
  so the frame at the hard cut into this beat is never blank.
- **One paused timeline**, registered after the build, keyed to the root's `data-composition-id`.
- **Hard cuts only.** No transition between beats, ever.
- **No `Math.random`, no clocks, no `repeat: -1`.**

## Filling one

Copy the file into `out/project/compositions/beat-NN.html`, change `data-composition-id` to the
beat's id in **both** the root element and the `window.__timelines[...]` key, then substitute the
text, palette and timings.

Then check the reading floor by hand. An archetype's timings were written for the beat it came
from; a longer line in the same slot will need a longer hold, and the archetype will not tell you.

## Adding one

Only when a beat's shape recurs. An archetype earns its place by being needed twice, and a library
that grows faster than that is a template system wearing a different name.

A new one must: use the fixed constants above, lead its entrance at `opacity: 0.55`, pass
`hyperframes check` with a non-zero sample count on its own, and be named for **what the beat does**
— not for the beat it came from. `payoff-bookend`, not `sc-17`.
