# The kit — shared looks, UI pieces and motion helpers

`assets/kit/kit.css` and `assets/kit/kit.js`. The render step injects both into every composition
whose root carries `data-look`, so a beat opts in with one attribute and gets fonts, grounds,
texture, real-looking UI primitives and a set of seek-safe motion helpers.

Why it exists: every beat composed from scratch re-derived the same shadows, fonts and easing, and
got most of them slightly wrong. The kit holds the parts that should be the same everywhere so the
composing can go into the parts that should differ.

## Opt in

```html
<template>
<style> #root { --accent: #e2562a; }  #root .h { … } </style>
<div id="root" data-look="paper" data-composition-id="beat-03" data-width="1080" data-height="1080">
  <div class="rc-mesh"></div>
  … the beat …
  <div class="rc-grain"></div>
</div>
<script>
(function () {
  const tl = gsap.timeline({ paused: true });
  RC.words(tl, "#root .h", 0, { lead: true });
  RC.camera(tl, "#root .stage", 0, { duration: 4 });
  RC.hold(tl, 3.95);
  window.__timelines["beat-03"] = tl;
})();
</script>
</template>
```

The root is sized and grounded by the look. Override any token on `#root`.

## Looks and tokens

`data-look`: `paper` · `ink` · `flood` · `sky` · `cinema` · `poster` · `cool` — what each is for is in
[design-system.md](design-system.md#grounds--commit-to-one-per-reel). `cool` is `paper` on a colder ground
(grey-blue, cobalt accent): for dashboards, data and anything that should read as product rather than film.

Tokens: `--ground --ink --muted --faint --accent --accent-2 --accent-ink --card --card-ink
--card-muted --line --shadow --glow --radius --grain --font-sans --font-serif --font-mono
--font-display --glass-tint --glass-blur --glass-sat --glass-bright --glass-ink --glass-shadow`. Muted tones are set to pass WCAG AA on their own ground — keep it that way if you
override them, or `hyperframes check` fails the beat on contrast.

## Classes

| | |
|---|---|
| Grounds | `.rc-mesh` (hue-family blobs; `--mesh-1/2/3`, `--m1x/--m1y`) · `.rc-bloom` · `.rc-horizon` · `.rc-dots` · `.rc-grid` · `.rc-vignette` · `.rc-grain` (always last) |
| Type | `.rc-display` · `.rc-sans` · `.rc-serif` / `em.rc` · `.rc-mono` · `.rc-kicker` · `.rc-accent` · `.rc-muted` |
| Marks on words | `.rc-hl > .rc-mark` (highlighter; `.rc-hl.rc-sel` for a text selection — tween the text to white as it lands) · `.rc-strike > .rc-rule` · `.rc-box` (ink box) · `.rc-outline-pill` · `.rc-caret` |
| Lines | `.rc-line > .rc-in` for masked line reveals |
| Headline | `.rc-head > .ln` · `em.rc` — the beat's one line, on the margin (see Layout discipline) |
| UI | `.rc-card` · `.rc-glass` (+ `.rc-clear`, `.rc-dim`) · `.rc-window > .rc-bar + .rc-body` · `.rc-prompt` (`.rc-plus .rc-text .rc-send`) · `.rc-bubble(.rc-user)` · `.rc-step(.rc-done) > .rc-dot` · `.rc-chip > .rc-ico` · `.rc-btn` · `.rc-badge` · `.rc-toast > .rc-check` · `.rc-avatar` · `.rc-row` · `.rc-skel` · `.rc-phone > .rc-screen` · `.rc-code` (`.k .s .f .c .n`, `.rc-hlline`) · `.rc-tile` · `.rc-bars > div(.rc-on) > b` |
| More UI parts | `.rc-switch > .rc-fill + .rc-thumb` · `.rc-seg > .rc-thumb + span…` (segmented control) · `.rc-kbd` (key cap) · `.rc-avatars` · `.rc-label` (tinted, `--c`) · `.rc-progress > i` · `.rc-ring` (`circle.t`/`circle.v`) · `.rc-tip` · `.rc-axis` / `.rc-rule-line` (chart text and rules) |
| Frame | `.rc-hud` (built by `RC.hud`) · `.rc-cursor` (built by `RC.cursorEl`) |

## Helpers

All take `(tl, target, at, options)` and return `tl`. `target` is a selector or elements. `at` is
absolute seconds in the beat.

| helper | does | key options |
|---|---|---|
| `RC.words(tl, el, at, o)` | split into words, each resolves from blur | `lead`, `stagger` .075, `blur` 14, `y` 22, `duration` .7 |
| `RC.chars(tl, el, at, o)` | same, per character | `stagger` .022 |
| `RC.blurIn / blurOut` | resolve (or dissolve) any elements | as above |
| `RC.lines(tl, el, at, o)` | masked line rise for `.rc-line > .rc-in` | `stagger` .09 |
| `RC.rise` | opacity + y, for objects | `y` 40 |
| `RC.flyIn` | arrive from depth: small, blurred → sharp | `from` .72, `blur` 18, `stagger` |
| `RC.pop` | scale from 0 with overshoot | |
| `RC.type(tl, el, at, o)` | type text, caret solid while typing, blinking either side | `text`, `cps` 24 |
| `RC.count(tl, el, at, o)` | count a number, formatted, tabular | `from`, `to`, `decimals`, `prefix`, `suffix`, `locale` |
| `RC.roll(tl, el, at, o)` | slot-reel through values in place | `values`, `each` .5 |
| `RC.wheel(tl, el, at, o)` | vertical list, current sharp, neighbours faded | `values`, `each` .6 |
| `RC.mark(tl, el, at)` | draw a highlighter or strike rule | |
| `RC.cursorEl(root)` / `RC.cursor(tl, cur, at, [[x,y,sec]…])` | a cursor on a curved, eased path | first point with 0 sec = start |
| `RC.click(tl, cur, at, o)` | press, ripple at the hotspot, target depresses | `target` |
| `RC.camera(tl, layer, at, o)` | slow push/tilt on a layer | `from`, `to` {scale 1.06}, `duration` |
| `RC.drift` | ambient motion for a background layer | `x`, `y`, `scale`, `duration` |
| `RC.iris` / `RC.wipe` | in-beat reveal: circle / along a direction | `from`, `dir` |
| `RC.smear` | directional motion blur while something moves fast | `amount`, `axis` |
| `RC.draw` | draw an SVG stroke | |
| `RC.hud(root, {tl,tr,bl,br})` | viewfinder corners with mono labels | |
| `RC.glass(sel?, o)` | turn `.rc-glass` into Liquid Glass: a lens that bends what is behind it (see Glass). Call once, after layout | `bezel`, `strength`, `blur`, `chroma`, `light`, `ior` |
| `RC.scramble(tl, el, at, o)` | text resolves out of seeded noise, left to right; best in mono | `text`, `duration`, `tail`, `glyphs`, `seed` |
| `RC.zoomTo(tl, box, at, o)` | move a recording inside its `.rc-footage` box to frame a region, never stretching it; the view stays inside the recording | `region` [x,y,w,h] fractions, or the moment's saved focus; `duration` 1.1 |
| `RC.spot(tl, ring, at, o)` | bring a `.rc-spot` ring onto the part of a recording it points at | `out` |
| `RC.hold(tl, seconds)` | make the timeline this long — every beat ends with it | |
| `RC.rand(seed)` | seeded PRNG — the only randomness allowed | |

## Glass

`.rc-glass` is Apple's Liquid Glass, built the way Aave builds it for the web. Without a call it is a
good frosted pane (CSS only: blur, saturation, tint, a rim). `RC.glass()` turns it into a **lens**: an
SVG filter, used as a `backdrop-filter`, blurs what is behind the element a little and then pushes it
through a displacement map generated from the element's own size and corner radius — a convex bezel,
Snell's law at the top face (index 1.5), so the background *bends* along the rim — with a faint
chromatic fringe on the bend, a specular rim lit from the top left, and a soft inner glow. It is a
pure function of the element, so a seek always shows the same glass.

Use it the way Apple says to ([Materials](https://developer.apple.com/design/human-interface-guidelines/materials)):

- **Glass is the functional layer, never the content.** A control, a palette, a receipt, a count, a
  tooltip: things that float over content and are operated or read in passing. A card full of data is
  content, and is soft paper.
- **Sparingly.** One or two pieces per beat; a lens that is everywhere is a lens that is nowhere.
- **Never glass on glass.** A selection inside a glass palette is a flat tint, not a second lens.
- **Regular for anything with words** (it blurs and lifts what is behind, so text stays legible).
  `.rc-clear` is nearly transparent, for small controls over rich backgrounds; add `.rc-dim` to put
  a 35% dark layer behind it when what is beneath is bright.
- **It needs something behind it.** Over a flat fill glass is a grey pill. Put it where it straddles
  an edge or floats over a card, a mesh or a busy layer — the receipt on the lower edge of the
  calendar, the palette over a dimmed app.
- **Small controls bend gently** (`strength` .45), panels more (.85). The fill under a switch thumb
  has to stay readable as a value, not just register as a highlight.

Never blur or filter an ancestor of a glass element: a `filter` on a parent makes it a new backdrop
root and the glass loses what it was bending. Fade glass in with `opacity` and `transform`, and put
the soft-focus entrance on the glass element itself.

The segmented control and the switch ship with a milky glass thumb (`--glass-tint .66`, a light
blur): a frosted white pill under crisp labels, so the selected word is always the clearest thing in
the control.

## Layout discipline

A beat is exact or it is not polished, and the eye finds an inexact beat before it can say why. Every
component in `assets/patterns/` is built on one grid, and a new beat should be too:

| | |
|---|---|
| Frame | 1080 square. **Margins 84** on all four sides: nothing readable outside 84 to 996. |
| Headline | `.rc-head`, top-left at (84, 96): two lines of 92px bold sans with one italic-serif accent word at 1.1em. It fills 96 to about 293. |
| Content region | 336 to 996 vertically, 912 wide. One object, centred in it, or a grid that fills it. |
| Gutters | 24 between cards, 20 between columns inside a card. |
| Inner padding | 36 to 40 inside a card; rows 78 to 110 tall on a regular pitch. |
| Radii | cards 32 to 40, tiles and rows 20 to 28, pills fully round. Inner radius = outer radius minus the padding. |
| Type | headline 92 · figure 72–88 · row title 28–38 · label 20–24 mono. Nothing under 16. |

**Optical alignment.** A big glyph's box edge is not its ink edge: an "O" at 92px sits 2.9px inside
its box, an italic "N" at 101px sticks out 4.7px. Set `--ox` on each `.ln` to the negative of the
first glyph's left side bearing so the *ink* lands on the 84px margin. `npm run measure` prints the
exact value (`--bearings ".rc-head .ln"`).

**Fixed pixels, not flow.** Anything a pen, a cursor, a handle or a leader line has to land on is laid
out on fixed pixels (`position: absolute`, a height on every row), so its coordinates are exact
whatever the font does. Measure from the pixels, not the boxes: the ink of a wordmark is not its box.

**The camera carries everything.** Put the headline *inside* the `.cam` layer with the objects, so
the push of 1.03–1.06 moves them together and their edges stay flush the whole way.

### `npm run measure`

```bash
npm run measure -- skills/reelcut/assets/patterns/pricing-toggle.html 4.3   --guides --scan --select ".rc-head||.plan" --baselines ".p1 .pr" --bearings ".rc-head .ln"
```

Loads the beat in Chrome with the kit injected, seeks its timeline to each time, and prints layout
rectangles taken with the camera push off (the designed layout), text baselines, first-glyph side
bearings, and — with `--scan` — everything outside the 84px safe area, overflowing its box, or set
under 16px. `--guides` draws the margins (magenta) and the content region (cyan) over the screenshot,
written to `out/measure/`. It reports and never fixes; it complements `hyperframes check`, which says
whether a beat is broken, where this says whether it is exact.

## Footage

`.rc-footage` is the box a recorded screen sits in (`data-frame="window"` or `"plain"`), taking the recording's
own shape from `--fw` and `--fh`, which the render writes. Inside it, `.rc-fv` is the layer that zooms, and
`.rc-spot` (with `--x --y --w --h` as fractions of the recording) is a ring that stays on what it points at.
`data-fit="cover"` fills the box and crops, for a generated background plate — never for a recording, which is always
shown whole. `.rc-fstep` is the step pill — a number in an accent disc and a word — a control-layer label, so it is glass.
How to place a recording, and what may be done to one, is [footage.md](footage.md).

## What the helpers record

As they schedule, `click`, `type`, `count`, `roll`, `pop`, `iris`, `wipe` and `smear` append
`{ type, at, duration? }` to `window.__rcEvents`. Nothing reads a clock, so it is the same list on every
load. `npm run sfx -- suggest` reads it to propose sound-effect cues; a composition that does not use
the kit records nothing and gets no suggestions.

## Rules the helpers keep for you — and the ones they cannot

They keep: determinism (no clocks, no `Math.random`, finite loops), a legible frame 0 when you pass
`lead: true` to the first entrance, ripples placed from the scheduled path rather than the DOM.

They also keep: an empty element inside a line (an underline, a strike rule, a marker) out of the
word split, so it is drawn once by its own tween instead of blurring in with the text first; and
blur on a non-overshooting ease even when you pass `back.out` — an ease past 1 drives `blur()` below
zero, which is invalid, and the element flickers sharp-then-soft.

They cannot keep: the reading floor (you schedule it), hard cuts (never add a transition *between*
beats), and one `fromTo` per property per element — a second `fromTo` on the same property stamps
its start state over frame 0. After the first entrance, move an element with `tl.to`. The same goes
for your own tweens: give `scale` a `back.out` if you like, but put `filter` and `opacity` on a
separate tween with `expo.out`, and never animate an element's `scale` if something else draws it
with `scaleX`.
