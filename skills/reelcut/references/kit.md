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

`data-look`: `paper` · `ink` · `flood` · `sky` · `cinema` · `poster` — what each is for is in
[design-system.md](design-system.md#grounds--commit-to-one-per-reel).

Tokens: `--ground --ink --muted --faint --accent --accent-2 --accent-ink --card --card-ink
--card-muted --line --shadow --glow --radius --grain --font-sans --font-serif --font-mono
--font-display`. Muted tones are set to pass WCAG AA on their own ground — keep it that way if you
override them, or `hyperframes check` fails the beat on contrast.

## Classes

| | |
|---|---|
| Grounds | `.rc-mesh` (hue-family blobs; `--mesh-1/2/3`, `--m1x/--m1y`) · `.rc-bloom` · `.rc-horizon` · `.rc-dots` · `.rc-grid` · `.rc-vignette` · `.rc-grain` (always last) |
| Type | `.rc-display` · `.rc-sans` · `.rc-serif` / `em.rc` · `.rc-mono` · `.rc-kicker` · `.rc-accent` · `.rc-muted` |
| Marks on words | `.rc-hl > .rc-mark` (highlighter; `.rc-hl.rc-sel` for a text selection — tween the text to white as it lands) · `.rc-strike > .rc-rule` · `.rc-box` (ink box) · `.rc-outline-pill` · `.rc-caret` |
| Lines | `.rc-line > .rc-in` for masked line reveals |
| UI | `.rc-card` · `.rc-glass` · `.rc-window > .rc-bar + .rc-body` · `.rc-prompt` (`.rc-plus .rc-text .rc-send`) · `.rc-bubble(.rc-user)` · `.rc-step(.rc-done) > .rc-dot` · `.rc-chip > .rc-ico` · `.rc-btn` · `.rc-badge` · `.rc-toast > .rc-check` · `.rc-avatar` · `.rc-row` · `.rc-skel` · `.rc-phone > .rc-screen` · `.rc-code` (`.k .s .f .c .n`, `.rc-hlline`) · `.rc-tile` · `.rc-bars > div(.rc-on) > b` |
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
| `RC.hold(tl, seconds)` | make the timeline this long — every beat ends with it | |
| `RC.rand(seed)` | seeded PRNG — the only randomness allowed | |

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
