# Patterns — the moves, done properly

`assets/patterns/` holds sixteen finished compositions, each one a move that recurs across shipped
launch films, built on the kit and passing `hyperframes check`. Open the nearest one before
composing a beat of that kind: read how the timing, scale and motion are set, then compose *your*
beat for *its* sentence.

Not every pattern is equally typical. In the 809-film count, `word-build`, `agent-run`, `end-card`,
`cursor-demo`, `stat-count`, `constellation` and `brand-flood` show moves seen in a fifth to most
films; `one-word` (values rolling, 2%) and `strike-replace` (1%) show rare moves and are accents, not
staples. See the counts in [design-system.md](design-system.md#the-moves-counted).

They are references, not templates. A reel assembled by pouring script lines into these files would
be sixteen good-looking beats that say nothing in particular — the failure this skill exists to
replace, only prettier. Lift the move; recompose the frame.

When authoring genuinely fails, or a run is unattended, copying a pattern and adapting its text,
palette and timings is the fallback. It beats no clip. It does not beat a composed beat.

## The sixteen

| pattern | look | for a beat that | the move |
|---|---|---|---|
| `brand-flood` | flood | opens or signs off as a brand | point → mark draws → iris to brand colour → extended caps + serif line, HUD |
| `word-build` | paper | states the thesis | centred sentence resolves word by word; key word italic serif, underlined |
| `one-word` | ink | hits a rhythm of claims | one huge word rolls to the next over a breathing bloom |
| `statement-roll` | ink | claims ownership/choice | huge bottom-left statement; last word and a mono value roll in step; UI blurred behind |
| `agent-run` | paper | shows an AI product working | prompt types → sends → steps resolve → result card from depth |
| `cursor-demo` | sky | shows one action in the product | UI out of a 3D tilt; cursor curves, clicks; status flips, toast confirms; camera leans in |
| `stat-count` | paper | states a figure | number counts huge; trend line draws; pill says what it means |
| `bars-compare` | paper | compares on one measure | serif claim; muted bars, one accent bar grows last and tallest |
| `constellation` | ink | shows breadth or connection | centre label; tiles arrive from depth on a ring; links draw; ring turns |
| `device-flank` | paper | says the product does it | phone rises into the sentence: "Say [phone] it."; verb rolls; screen answers |
| `inline-ui` | paper | says anything can be changed | a real control sits inside the sentence and its value rolls |
| `strike-replace` | paper | turns from old to new | old claim, struck; new claim with serif key word |
| `code-focus` | ink | is about an API or install | code card settles from a 3D turn; lines write in; the key line lights; camera leans |
| `collage-poster` | poster | is a manifesto or campaign | condensed caps stamp in over ink blocks, halftone, sticker |
| `cinema-line` | cinema | is the emotional turn | letterboxed, grain, light leak; serif line resolves slowly |
| `end-card` | paper | closes | mark + name, tagline with serif word, URL pill; horizon glow; held |

## Render them

```bash
npm run render -- examples/patterns/reel.json --clips-only
```

`examples/patterns/reel.json` mounts all sixteen. Render it after changing the kit: if a helper
breaks, some pattern shows it.

## Adapting one

Copy it to `compositions/beat-NN.html`, change `data-composition-id` in the root **and** the
`window.__timelines[...]` key, then change the text, the accent, and the timings — and re-check the
reading floor by hand, because a pattern's timings were set for its own placeholder line.

"Lumen", its mark and its numbers are placeholders. A real reel replaces the mark with the brand's
sourced mark or none, and every figure with an approved datum.

## Adding one

When a move recurs in the films and none of these makes it. It must be built on the kit, lead its
first entrance with `lead: true`, pass `hyperframes check` with a non-zero sample count, render in
the pattern reel, and be named for what the beat does.
