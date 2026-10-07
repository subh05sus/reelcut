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

## Motion — Apple's springs

Every helper moves on Apple's motion, not on GSAP's stock curves (owner's decision, 2026-10-07). The kit solves the
real damped spring and registers each preset as a GSAP ease, so your own tweens can name them too:

| ease | stiffness / damping | for |
|---|---|---|
| `spring.snappy` | 520 / 40 (~0.38 s) | presses, toggles, small state changes |
| `spring.default` | 380 / 38 (~0.44 s) | panels, sheets, cards, a thumb or lens sliding, a value changing |
| `spring.page` | 300 / 34 (~0.5 s) | a full-screen push, a big move |
| `spring.gentle` | 200 / 28 (~0.63 s) | words and objects arriving in a film frame (the default entrance) |
| `spring.soft` | 120 / 22 (~0.85 s) | large or far things, arrivals from depth, a map or a zoom easing in |
| `spring.reward` | 320 / 22 (8.7% overshoot) | the one earned moment of a reel; nothing else bounces |
| `spring.island` | 230 / 24 (1.7% overshoot) | the Dynamic Island's morph |
| `apple.out` | `cubic-bezier(.2, 0, 0, 1)` | fades and colour paired with a spring (also the default for a tween that names no ease) |
| `apple.push` | `cubic-bezier(.32, .72, 0, 1)` | the iOS push and pop, the keyboard |
| `apple.exit` | `cubic-bezier(.4, 0, 1, 1)` | leaving: accelerating away, about 2/3 the length of the arrival |
| `apple.glide` | minimum jerk | a hand moving a cursor or a finger, a pen drawing, a playhead dragged |

Why it reads as calm: a spring released from rest eases off the start (the first 1% of the time covers 0.4% of the way;
`expo.out` covers 6.7%, a jolt on frame one), reaches its speed in the first tenth and settles on a long, even
deceleration with no bounce. Never use `expo`, `back`, `elastic`, `power` or `bounce` eases; keep `sine.inOut` for slow
ambient camera and drift, `none` for typing and things scrubbed against time. A spring stretched to a longer duration is
a softer spring of the same damping, so passing `duration` keeps the feel. `RC.spring("default")` gives `{ ease,
duration }`; `RC.spring({ stiffness, damping })` makes your own.

`data-motion` on the root (`restrained` · `default` · `energetic`, written by the render from `direction.motion` in
`reel.json`) retunes every spring: restrained is slower and fully damped, energetic is quicker and lets presses and
pops overshoot ~2%. Reels render at **60 fps** by default (`DEFAULT_FPS`); a 0.4 s spring is 24 frames, not 12.

## Apple UI

iPhone controls and surfaces, the Dynamic Island, the Mac, app mockups (Messages, Calendar, Maps, Music, the home
screen) and feedback moments live in `assets/kit/ui/` and load with the kit: [apple-ui.md](apple-ui.md).

## Styles — the twenty personality styles

`data-style="<id>"` on the root (beside `data-look` and `data-type`) draws a beat in one of the twenty styles of
[personality.md](personality.md): Paper Cutout, Claymation, Stop Motion, Hand-Drawn, Flat Vector, Linear, Kinetic
Typography, Editorial, Collage, Brutalist, Swiss, Minimal, 3D, Isometric, Liquid, Ink / Paint, UI / Product,
Retro / VHS, Glitch, Cinematic (`assets/kit/ui/70-styles.*`). Set the scheme as `--ground --ink --accent --accent-2`.

| | |
|---|---|
| `.rc-shape` (+ `.rc-circle` `.rc-square` `.rc-pill`, `.rc-c2` `.rc-ink`) | a shape in the style's material: cut card, clay, outline, brush, block, sphere, slab (in `.rc-iso`), blob (in `.rc-goo`) |
| `.rc-hl > .ln + em` | the style's headline treatment (RGB split on Glitch and VHS, mono on Brutalist…) |
| `RC.styleWorld(root)` | its world: Swiss grid, Linear hairlines, Cinematic letterbox, VHS sun, floor and OSD, Glitch slices; the wobble, rough and goo filters |
| `RC.styleFinish(root, { texture })` | its textures on top: paper, grain, halftone, light leaks, vignette, scanlines |
| `RC.styleWords(tl, el, at)` · `RC.styleEnter(tl, els, at)` | its entrances: slam, bounce and squash, slide, trace, float, glitch, rise |
| `RC.styleGlitch(tl, root, at)` | a glitch burst |
| `RC.cadence(tl, "#root")`, registered as the beat's timeline | held frames for the stepped styles (12 fps; Stop Motion 8 with a jitter), the timeline as it is for the rest |

`assets/patterns/styles/<id>.html` is each style's showcase, made by the same generator as the Personality page's
previews (`npm run personality -- patterns` rewrites them). Open it before composing a beat in that style.

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
| `RC.words(tl, el, at, o)` | split into words, each resolves from blur on `spring.gentle` | `lead`, `stagger` .06, `blur` 12, `y` 18, `duration` (the spring's own) |
| `RC.chars(tl, el, at, o)` | same, per character | `stagger` .022 |
| `RC.blurIn / blurOut` | resolve (or dissolve) any elements | as above |
| `RC.lines(tl, el, at, o)` | masked line rise for `.rc-line > .rc-in` | `stagger` .09 |
| `RC.rise` | opacity + y, for objects | `y` 40 |
| `RC.flyIn` | arrive from depth: small, blurred → sharp | `from` .72, `blur` 18, `stagger` |
| `RC.pop` | grow from 0.4 on a snappy spring, no wobble | `reward: true` for the reel's one earned overshoot |
| `RC.type(tl, el, at, o)` | type text, caret solid while typing, blinking either side; records the text, so `sfx suggest` places a keystroke per few letters | `text`, `cps` 24 |
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
| `RC.word(q, nth?, fallback?)` | when the voiceover says `q` in this beat (seconds), or `fallback` | see The voiceover |
| `RC.wordEnd(q, nth?, fallback?)` | when it has been said | |
| `RC.voice(t)` | the voice's loudness at `t`, 0..1 | |
| `RC.voiceDrive(tl, el, at, dur, props)` | move with the speaker: `{ scale: [1, 1.08] }` from quiet to loud | sampled 30× a second |

## The voiceover

With `"voiceover"` in `reel.json`, the render gives every composition its own words and the voice's loudness, in
the beat's time (0 = its first frame). Put a moment on the word that names it rather than on a guessed second:

```js
RC.words(tl, "#root .claim", RC.word("Claude", 0, 0.4));          // the claim resolves as "Claude" is said
RC.type(tl, "#root .ty", RC.word("Higgsfield", 0, 0.25), { text: "Higgsfield", cps: 18 });
RC.pop(tl, "#root .badge", RC.wordEnd("Rabatt", 0, 2.1));         // the badge lands as the word ends
RC.voiceDrive(tl, "#root .orb", 0, 2.4, { scale: [1, 1.08], opacity: [0.7, 1] });
```

Words match ignoring case and punctuation (`"Claude"` finds `Claude,`); `nth` picks a later occurrence. The
fallback is what renders without a voiceover, so a beat still works without one: give the time you would have
written anyway. `voice.json` beside `reel.json` lists every word's time (`npm run voice -- reel.json`).

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
whatever the font does.

## Type

66 open-licensed families ship with the skill in `assets/fonts` (sans, display, serif, handwritten, mono,
rounded), all drawing German with their own glyphs (`npm run fonts -- check`). Nothing is fetched while rendering:
a clip carries only the fonts it uses.

A **pairing** sets the headline, body, accent and mono together, plus how the headline is set (weight,
tracking, capitals). Put `data-type="<id>"` on a beat's root, or `"type"` in `reel.json` for every beat:
`studio` (the default), `swiss`, `editorial`, `poster`, `tabloid`, `tech`, `startup`, `luxe`, `friendly`,
`brutal`, `expressive`, `crafted`, `handmade`, `signage`, `classic`, `chunky`, `extended`, `fashion`
(`npm run fonts -- pairings`, and `npm run fonts -- sheet` to see them). It reaches `.rc-head`, `.rc-display`,
`em.rc`, `.rc-serif` and `.rc-mono`, and anything set in `var(--font-display)`, `var(--font-sans)`,
`var(--font-serif)` or `var(--font-mono)`. A headline set in its own class with no font variable keeps the
body font. Under a caps pairing the accent word keeps its own case; an accent family with no italics is set upright. Measure from the pixels, not the boxes: the ink of a wordmark is not its box.

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
blur on a non-overshooting ease even when you pass an overshooting spring — an ease past 1 drives `blur()` below
zero, which is invalid, and the element flickers sharp-then-soft.

They cannot keep: the reading floor (you schedule it), hard cuts (never add a transition *between*
beats), and one `fromTo` per property per element — a second `fromTo` on the same property stamps
its start state over frame 0. After the first entrance, move an element with `tl.to`. The same goes
for your own tweens: give `scale` a `spring.snappy` if you like, but put `filter` and `opacity` on a
separate tween with `apple.out` or `spring.gentle`, and never animate an element's `scale` if something else draws it
with `scaleX`.
