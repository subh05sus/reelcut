# Design system — how shipped launch films actually look

Read this **before composing any beat**. It is the distilled study of ~800 launch films from
[whatships.com](https://whatships.com) (contact sheets of every film, ~120 studied closely, a
handful frame by frame for timing). It replaces guesswork about "what looks professional" with
what the films that got shipped actually do.

The kit (`assets/kit/`) implements it; the patterns (`assets/patterns/`) demonstrate it. Neither is
a template. This file is the *why*.

## What the field looks like

Roughly a third of launch films are live action (founders talking, product in hand), a third are
screen-recorded product, and a third are motion typography and designed UI. reelcut makes the last
kind, and borrows from the middle one through captures. Within that third, the same moves recur so
often they are the grammar of the genre:

| move | seen in | kit / pattern |
|---|---|---|
| Sentence builds word by word, blurring into focus | most | `RC.words`, `word-build` |
| One key word in italic serif, accent colour | very common | `em.rc`, every paper pattern |
| Real UI, large, on a committed ground, soft shadow | most product films | `.rc-card/.rc-window`, `cursor-demo` |
| Prompt → thinking → steps → result | nearly every AI film | `.rc-prompt/.rc-step`, `agent-run` |
| Cursor that curves, clicks, and causes a change | very common | `RC.cursor/click`, `cursor-demo` |
| Slow camera push (scale 1 → 1.04–1.08) on everything | nearly all | `RC.camera` |
| Blur as depth: out-of-focus UI behind sharp type | common | `filter: blur()`, `statement-roll` |
| One huge word, then the next ("Faster. Better.") | common | `RC.roll`, `one-word` |
| Statement + full stop, huge, bottom-left | dev tools | `statement-roll` |
| Word list turning like a wheel, neighbours faded | common | `RC.wheel` |
| A product object *inside* the sentence | common | `inline-ui`, `device-flank` |
| Big counted number + one-line meaning | common | `RC.count`, `stat-count` |
| Minimal chart, muted bars, one accent bar | data beats | `.rc-bars`, `bars-compare` |
| Things arriving from depth around a centre | integrations | `RC.flyIn`, `constellation` |
| Mark → iris → full-bleed brand colour → name | brand intros | `RC.iris`, `brand-flood` |
| Logo lockup + URL, held | nearly every ending | `end-card` |

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

**Centre by default.** The shipped films centre a single idea with 50%+ of the frame empty. The
exceptions are deliberate: bottom-left statements (dev tools), top-left serif headline over a chart.
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

Measured from frame-by-frame study:

- **Entrances resolve from blur**: `opacity 0→1`, `filter blur(14–18px)→0`, `y 20–30px→0`,
  0.6–0.8s, `expo.out`. This, far more than any slide, is the look of a 2025–26 launch film.
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
