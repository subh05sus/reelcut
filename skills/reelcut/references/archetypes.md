# Archetypes — the fallback, not the default

Read this when authoring a beat has failed, or when a run is unattended and nobody is there to
compose. **A filled archetype is worse than a composed beat and much better than no clip.**

If you reach for these because they are quicker, you have rebuilt the thing this skill exists to
replace. The predecessor pipeline picked from a vocabulary of layouts and poured text into them,
and its beats put content on a quarter of the frame.

## The eleven

All in `../assets/archetypes/`, all 1080×1080, all a `<template>` with scoped CSS and one paused
GSAP timeline, and each file's `data-composition-id` and timeline key are its filename. Each
declares the length it wants in a header comment, `<!-- archetype seconds=4.2 -->`.

### Type

| file | for a beat that | layout | motion signature |
|---|---|---|---|
| `hook-either-or.html` | poses an either/or | two names stacked around a hinge word, then a sub-line | names arrive in sequence, then a seam draws under them |
| `depth-list.html` | lists things about scale or depth | flex column against a growing vertical measure | first row leads; siblings stagger 0.11 on `x` |
| `breadth-field.html` | lists capabilities or breadth | grid 2×3 across the whole field | near-simultaneous, `stagger 0.055`, `back.out` on scale |
| `thesis-negation.html` | rejects something | one paragraph, the rejected word wrapped | entrance, then nothing until a strike draws at ~3.0s |
| `measure-extent.html` | claims extent or reach | one line, the noun accented | a rule opens to the full frame width |
| `payoff-bookend.html` | closes by reopening the question | flex row: name · mark · name | four staged reveals, rule draws centre-out |

### Not type

Five registers where the frame does something other than set words. Reach for these first when a
beat's claim is a structure, a number, an action or a product — a sentence about clicking once is
better *shown* clicking once than set in 96px.

| file | for a beat that | what it does |
|---|---|---|
| `diagram-links.html` | says one thing connects to many | nodes are already there; the new thing drops into the middle; links draw out, then across. Six nodes is the ceiling |
| `outline-nest.html` | is about depth, hierarchy or structure | indented rows arrive top-down with their connectors, then the level the sentence is about is picked out. Rows are abstract bars — invented titles would be content nobody wrote |
| `counter-resolves.html` | has one number as its point | each digit is a 0–9 strip rolled with `translateY` to its target, so every seeked frame shows an exact value. **Only with an approved Datum**, and the source line stays on the frame |
| `cursor-click.html` | says "one click and it's done" | cursor travels on an arc (different eases on x and y), hovers, presses, ripples — and the click visibly *causes* something: a row changes state and a confirmation arrives |
| `device-surface.html` | shows a product screen | a minimal bezel (no traffic lights, no URL bar) rises in, the camera pushes slowly toward the region that matters, a focus ring draws, the rest dims, one label names it. The screen is a slot: swap the placeholder for a capture that passed the legibility gate |

`cursor-click` and `device-surface` carry drawn placeholders so they render on their own. With a
real capture, the capture replaces the placeholder and the motion stays.

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
text, palette and timings. The render refuses the project if the two disagree — a mismatch would
otherwise render frozen at t=0 without an error.

Then check the reading floor by hand. An archetype's timings were written for the beat it came
from; a longer line in the same slot will need a longer hold, and the archetype will not tell you.

## Adding one

Only when a beat's shape recurs. An archetype earns its place by being needed twice, and a library
that grows faster than that is a template system wearing a different name.

A new one must: use the fixed constants above, lead its entrance at `opacity: 0.55`, carry its
`archetype seconds=` header, use its filename as its id, be named for **what the beat does** — not
for the beat it came from (`payoff-bookend`, not `sc-17`) — and pass

```bash
npm run archetypes:check -- <name>
```

which renders it alone through `hyperframes check`, the renderer and the frame checker. Then look
at the frames. Two traps the check caught on the non-type set, both worth knowing:

- **A timeline `fromTo` renders its FROM state from frame 0.** A ripple written as
  `fromTo({opacity: 0.4}, …, 1.97)` sat on screen as a stray dot for two seconds. Use `tl.set` at
  the start time, then `tl.to`.
- **A container on screen before its contents is a blank panel.** Bring a panel's rows in with it,
  and give every flat area in a placeholder marks down its whole length.
