# Design system — how shipped launch films actually look

Read this **before composing any beat**. It is built from a review of **809 launch films** on
[whatships.com](https://whatships.com): every film as a 25-frame contact sheet, each one labelled
for what it is made of (`whatships-tally.tsv`, one row per film), plus a handful of films read frame
by frame for motion timing. It replaces guesswork about "what looks professional" with what the
films that shipped actually do.

**How solid the numbers are.** Labels are one reviewer's read of contact sheets, so treat each
percentage as good to within a few points, not exact. About 15 of the 809 were labelled from an
earlier look or the title rather than re-viewed. Motion *timing* (easing, durations, camera pushes)
was read from only a few films and is **not counted** — those parts say "observed", not "X%".

The kit (`assets/kit/`) implements it; the patterns (`assets/patterns/`) demonstrate it. Neither is
a template. This file is the *why*.

## What the field looks like

| kind of film | films | share |
|---|---|---|
| Designed motion graphics (type, UI, illustration, brand) | 431 | 53% |
| Live action — founders talking, product in hand | 234 | 29% |
| Screen recording of the product | 144 | 18% |

reelcut makes the first kind, and borrows from the third through captures. The rest of this file is
about the 431 designed films.

**Grounds (of those 431):** light 45% · dark 36% · a brand colour 12% · mixed 7%. Light is the
commonest, and dark is not far behind — neither is "the" default.

## The moves, counted

Share of the 431 designed films that use each move at least once.

| move | films | kit / pattern | pattern exists? |
|---|---|---|---|
| A brand mark or logo (usually the ending) | 88% | `end-card`, `brand-flood`, `wordmark-handles` | yes |
| Real-looking product UI on screen | 76% | `.rc-card`, `.rc-window`, `.rc-glass`, and eight UI components (`notification-stack`, `command-palette`, `kanban-drag`, `pricing-toggle`, `chat-thread`, `calendar-booking`, `upload-done`, `settings-switches`) | yes |
| Text that builds word by word | 62% | `RC.words`, `word-build` | yes |
| Huge type owning the frame | 42% | `one-word`, `statement-roll`, `collage-poster` | yes |
| Things arriving from depth, collage-style | 25% | `RC.flyIn`, `constellation` | yes |
| A 3D or photographed product object | 24% | — | **no** — needs real assets or a 3D scene |
| Kinetic type (type that moves as a graphic) | 23% | `RC.chars`, `RC.scramble`, `collage-poster`, `type-slam`, `text-effect-wall`, `terminal-type-in` | yes |
| A cursor moving and clicking | 22% | `RC.cursor/click`, `cursor-demo` | yes |
| Illustration or hand-drawn art | 20% | `hand-doodle`, `isometric-stack`, `flat-scene`, `glyph-swarm`, `mascot-hop`, `shape-morph`, `paper-plane`, `line-waves` | **partly** — drawn in SVG/CSS; a brand's own mark or mascot has to be sourced |
| A big number or stat | 18% | `RC.count`, `stat-count`, `dashboard-tiles`, `line-chart-scrub`, `ranking-race` | yes |
| An italic serif accent word | 17% | `em.rc` | yes |
| A soft gradient mesh ground | 15% | `.rc-mesh` | yes |
| A chat or prompt with steps | 15% | `.rc-prompt`, `agent-run` | yes |
| A device frame (phone, laptop) | 14% | `.rc-phone`, `device-flank` | yes |
| Code on screen | 13% | `.rc-code`, `code-focus` | yes |
| Live footage inside the designed film | 13% | — | no — needs footage |
| Cards tilted in 3D | 8% | `rotationX` on `.rc-window` | yes |
| A highlighter or box on a word | 7% | `.rc-hl`, `.rc-box` | yes |
| Viewfinder HUD corners | 4% | `RC.hud`, `brand-flood` | yes |
| A value rolling in place | 2% | `RC.roll`, `one-word` | yes — **rare** |
| A strike through a word | 1% | `.rc-strike`, `strike-replace` | yes — **rare** |
| A wheel of values | under 1% | `RC.wheel` | helper only — **rare** |

Read it two ways. **What to lean on:** a logo ending, real UI, and text that builds are in most
films; huge type, arrivals from depth, kinetic type and a cursor are in a fifth to two-fifths.
**What to treat as an accent, not a staple:** roll, strike and wheel are moves from one or two
films each — the patterns for them (`one-word`, `strike-replace`) are single-move showpieces, and
building a reel out of them would be unlike almost every real launch film.

**Not yet covered:** 3D objects (24%) have no pattern, and illustration is covered only by
procedural vector drawing (the eight patterns above), not a brand's own artwork. Live footage
cannot be made here, only sourced.

## Grounds — commit to one per reel

Pick one look for the reel and hold it; switch only when the script switches world (the problem
beat dark, the product beat light). Every one of these is a committed field, never a tinted
off-white with margins.

- **paper** `#f3f1ec` warm off-white, near-black ink, one accent. The calm SaaS default — Ramp,
  Claude, launchvideo.dev. Texture: faint mesh in the accent's hue, grain.
- **ink** `#09090b` near-black, soft coloured bloom behind the subject, glass cards. Developer
  tools — a13n, Cline, Codex CLI.
- **flood** the brand colour, full bleed, black extended heavy caps, HUD corners. Brand moments —
  the Claude motion reel.
- **sky** blue-lavender mesh, frosted glass UI. AI products that want to feel light — Koast, Helium.
- **cinema** black, grain, vignette, light leak, serif. The emotional turn — AchX, trailers.
- **poster** cream paper, condensed caps, two loud inks, halftone. Energy, manifesto — Higgsfield.
- **cool** `#e8ecf3` grey-blue paper, near-black ink, one cobalt accent. Paper's colder sibling, for
  dashboards, data and anything that should read as product rather than film — Linear, Vercel, Stripe.

Set the accent per reel with `#root { --accent: … }`, taken from the product. One accent. A second
colour appears only as a mesh tint or a status colour (green for done, never decoration).

## Type — one sans, one serif, one mono

- **Sans (Inter Tight)** carries the voice. Weight 600–700, tracking −0.04 to −0.055em at display
  sizes. Tight tracking is the single cheapest signal of "designed".
- **Serif italic (Instrument Serif)** for the one word the line is about — `the first *launch*`,
  `What are we *editing*?`. In the accent colour, 1.08–1.14× the sans size so it sits optically level.
  One per line. If every line has one, none of them means anything.
- **Mono (JetBrains Mono)** for anything a machine says: model names, code, file paths, metadata,
  kickers. Small, spaced, muted.
- **Display (Archivo)** only in `flood` (extended, 900) and `poster` (condensed, 900) looks.

Sizes on a 1080 frame: hero word 200–260px, headline 90–120px, supporting line 30–40px, kicker
18–22px mono uppercase. The gap between headline and support is large on purpose — scale contrast
is the hierarchy.

**Centre by default.** In the films read closely, a single idea is centred with half the frame or
more empty (an observation, not a count). The exceptions are deliberate: bottom-left statements (dev tools), top-left serif headline over a chart.
A block of type pinned top-left at 72px with the rest of the frame blank is not one of them.

## Product surfaces — real, large, alive

- A UI card is **60–85% of the frame width**. At 30% it is a thumbnail and nothing in it can be read.
- It looks real: real labels, real numbers, plausible names, statuses, avatars. Grey skeleton bars
  only for what is deliberately out of focus behind something else.
- It has depth: radius 16–28, a large soft shadow, sitting on the ground rather than printed on it.
- It enters as an object — out of a 3D tilt (`rotationX` 16–28° → 0), from depth, or rising — and
  settles, then *something happens in it*.
- Something happening is the point: a cursor clicks and a status flips, a prompt is sent and steps
  resolve, a line of code lights. A UI that just appears and sits is a screenshot.
- The camera leans in toward whatever changed (`transform-origin` on it, scale 1.06–1.12).

## Motion — resolve, don't slide

Observed in the few films read frame by frame (**not counted** across the 809 — treat the numbers as
what those films did, not as an industry norm):

- **Entrances resolve from blur**: `opacity 0→1`, `filter blur(14–18px)→0`, `y 20–30px→0`,
  0.6–0.8s, `expo.out`. This is what the closely read films do; it is not a counted share.
- **Word stagger 0.07–0.1s**; char stagger 0.02–0.045s. The sentence finishes arriving within about
  a second.
- **Ease is expo/power4 out** for arrivals, `power3.inOut` for moves between states, `sine.inOut` for
  anything ambient. Never linear, except typing and continuous rotation.
- **Nothing is still.** Every layer has some slow motion over the whole beat: camera push
  (`RC.camera`), mesh or bloom drift (`RC.drift`), a ring that turns. Four held seconds of a
  perfectly static frame read as a slide.
- **Replace in place** instead of cutting: a word rolls to the next (`RC.roll`), a status flips, a
  list turns (`RC.wheel`). The frame stays; the content changes.
- **In-beat transitions** that are not fades: iris (`RC.iris`), wipe along the reading direction
  (`RC.wipe`), zoom through an element, blur out then blur in (`RC.blurOut` → `RC.words`).
- **Fast moves smear**: anything crossing the frame quickly gets directional motion blur
  (`RC.smear`) that peaks mid-move and is gone when it lands.
- **Clicks have consequences** 0.1–0.15s later. A cursor that clicks and nothing changes reads as
  a bug.

## Texture — under everything, never over the type

Grain on every look (`.rc-grain`, last in the root). A mesh or bloom behind. Dots or a fine grid for
data. HUD corners only in flood/cinema. Vignette only in cinema. Texture is what separates "a div
with a background colour" from a designed field.

## What this does not change

The rules in [step-4-compose.md](step-4-compose.md) still govern: the reading floor, frame 0
legible (every kit entrance takes `lead: true` for the first element), hard cuts between beats,
determinism, and `hyperframes check` passing with a non-zero sample count. Nothing here authorises
inventing a logo, a number or a testimonial — the patterns' "Lumen" and its figures are placeholders
that a real reel replaces with sourced material.

## The tally

`whatships-tally.tsv` has one row per film: `slug`, register (`MG` designed motion graphics, `LA`
live action, `SR` screen recording), ground (`L` light, `D` dark, `C` brand colour, `M` mixed) and
the moves seen. Move tags: `wb` text builds word by word · `big` huge type · `kin` kinetic type ·
`ser` italic serif accent · `hl` highlighter/box · `strike` strike-through · `roll`/`wheel` values
rolling · `ui` real product UI · `cur` cursor · `chat` prompt or chat · `code` · `dev` device frame ·
`tilt` 3D-tilted card · `fly` arrival from depth or collage · `num` big number · `mesh` gradient
ground · `hud` viewfinder corners · `obj` 3D or photographed object · `ill` illustration · `foot`
footage inside a designed film · `logo` brand mark · `icon` icon row · `bub` message bubbles ·
`sr` screen recording inside a designed film · `cap` captions.

Re-count with a few lines of script whenever the tally grows; the shares above came from exactly
that. It covers 809 of the 2,317 films on the site (35%), taken from the site's category listings in
order, so it over-represents the categories listed first.

## The polish bar — what the cleanest patterns have in common

Read from the clips that render cleanest (`inline-ui`, `strike-replace`, `device-flank`, `bars-compare`,
`agent-run`, `cursor-demo`, `stat-count`, `constellation`, `statement-roll`). A new pattern is not
done until it meets every line; most "off" drafts failed on the first four, and the polished ones
are the ones that also pass 10 and 11.

1. **Three colours, not six.** One ground, one ink, one accent, used the same way in every frame.
   A second hue appears only as a status (green for done). Primary-colour sets, rainbow stickers and
   emoji read as a toy, not a product.
2. **One hero.** One headline, in tight-tracked bold sans with one italic-serif accent word, and at
   most one small muted mono or support line. Nothing else competes with it for attention.
3. **The object is large and detailed.** It fills 60–85% of the frame width. Up close it has real
   labels, hairline dividers, a pill or avatar, mono micro-type, a radius and a large soft shadow.
   Small, sparse, generic clip-art in a big empty frame is the commonest failure.
4. **Layered depth.** A faint mesh tint in the corners, something behind the hero blurred out of
   focus, grain on top. A flat fill with nothing behind it looks unfinished.
5. **Motion resolves, it does not pop.** Type and objects come out of blur with a small rise,
   `expo.out`, 0.6–0.8s, staggered 70–100ms. No `back.out` overshoot on anything that is not a
   button press. No hard cuts inside a beat unless the pattern is *about* the cut.
6. **An action causes a consequence.** A click flips a status; a send starts the steps; a number
   lands and a pill confirms it 0.1–0.2s later. Decoration that does not cause or confirm anything
   is cut.
7. **A slow camera under everything.** Scale 1 → 1.03–1.06 over the whole beat, or a drifting
   background layer. Nothing is ever perfectly still.
8. **Every freeze frame is postable.** Pause at any time: the frame is composed, centred or
   deliberately off-centre, with clear margins and no half-drawn clutter.
9. **Few elements.** Under about eight visible things at once. If a frame needs a legend, it is two
   beats.
10. **Everything sits on the grid.** 84px margins, the headline top-left at 96, the content region
    336 to 996, 24px gutters, 36–40px inner padding, one radius family. The first glyph's *ink*, not
    its box, is on the margin (`--ox`). Cards that should be level are level to the pixel; an object
    a pen or cursor lands on is on fixed coordinates. `npm run measure` proves it — see
    [kit.md](kit.md#layout-discipline). A beat that is 3px off looks cheaper than one that is simply
    plain.
11. **Glass is the control layer, and only that.** Liquid Glass (Apple) is for the thing that floats
    over content and is operated or read in passing: a palette, a switch thumb, a receipt, a count.
    Never the content card, never glass on glass, one or two pieces per beat, always over something it
    can bend. See [kit.md](kit.md#glass).
