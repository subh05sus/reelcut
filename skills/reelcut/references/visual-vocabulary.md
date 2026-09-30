# Visual vocabulary — what a beat can be made of

Read this **before** composing, alongside [step-4-compose.md](step-4-compose.md).

## The problem this file exists to prevent

Type on a field is the easiest thing to compose and the easiest thing to overuse. A reel made
entirely of headlines is legible, tasteful, and not a motion-graphics video — it is a slide deck
that fades. The archetypes this skill used to ship contained **zero images, zero SVG and zero
canvas** between them, and the reel they came from measured 8.2% mean ink. They were replaced by
the kit and the patterns for exactly that reason.

A professional piece moves between registers. Type, then a real product surface, then a number
that counts, then a diagram that builds, then type again. The variety is not decoration — it is
what stops the viewer's eye from settling into a rhythm and disengaging.

## Check the registry before hand-building anything

```bash
npx hyperframes catalog --query "a terminal window typing a command"
npx hyperframes add <name>
```

Roughly **400 blocks and components** are already written, validated and seek-safe. The registry
covers the named things — charts, code and terminal windows, maps, device frames, film grain,
glitch, chromatic aberration, shimmer sweeps, confetti, scanlines — and search works offline with
nothing installed and no account.

Read `hyperframes-registry` for how blocks and components differ and how to wire them. **Search
before you hand-build.** Hand-building a chart that already exists is how a day disappears.

`hyperframes-animation` carries the motion side: atomic rules, multi-phase blueprints, the
transition catalog, and 24 named text effects. Reach for a named effect by name.

## Registers, and when each one earns the beat

**Type.** The default, and correct when the line *is* the content — a claim, a question, a
punchline. Rules in [step-4-compose.md](step-4-compose.md).

**A real product surface.** The strongest material you have, and the most underused. A browser or
device frame holding a real capture, entering as an object rather than a picture: it tilts, settles,
and the eye is led to one detail that highlights. Use when the beat says what the product *does*.
Capture rules are in [step-2-acquire.md](step-2-acquire.md) — crop to the detail, never show a full
browser window shrunk into the frame.

**A simulated interaction.** A cursor that travels a curved path, presses with a real press phase,
ripples, and causes something — a row selects, a toast confirms, a field fills. This is the single
most convincing register available, because it shows the product working rather than describing it.
It is also easy to do badly: a cursor that teleports or moves in a straight line at constant speed
reads as a diagram, not a hand. Curve the path, ease it, hold before the click, and make the click
*cause* the next thing.

**A number that resolves.** A counter that counts, a meter that fills, a bar that grows from its
axis. Only from an approved datum — see [step-3-data.md](step-3-data.md). The figure holds for its
reading floor *after* the animation resolves, not during it.

**A diagram that builds.** A flow, a tree, a comparison matrix, two sets overlapping. Build it in
the order the sentence explains it — a diagram that appears complete is an illustration; one that
assembles is an argument. Never more nodes than the line has clauses.

**Footage or imagery.** Full-bleed, treated, with the type sitting on it rather than beside it. Use
`media-use`'s treatments rather than improvising filters. A photograph at 20% of the frame is a
thumbnail; at 100% it is a ground.

**A logo moment.** Marks meeting, locking up, or facing off. Short, and never the whole beat unless
the beat is the sign-off.

## Structure, not just content

A beat is not only *what* is on screen. These carry as much:

- **Depth.** Foreground type over a receding surface reads as designed; everything on one plane
  reads as flat. Scale, blur and overlap do this without a camera.
- **Masking.** Reveal through a shape — a wipe, an expanding rule, a clip-path that opens along the
  reading direction. Far better than a fade, which says nothing.
- **Scale change within the beat.** Something arrives large and settles, or starts as a detail and
  pulls back to context. This is the closest thing to a camera move that survives a hard cut.
- **Texture.** Grain, a paper tone, a subtle gradient in the ground. Cheap, and the difference
  between "a div with a background colour" and a designed field. Keep it under the type, never over.

## Vary it deliberately

Track what each beat's register is as you go, and do not run the same one three times. Two
consecutive type beats are usually one beat too many; three is a slide deck.

When the script genuinely is all argument and no product, the variety has to come from
*structure* — a stacked list, then a spread field, then a single line, then a split. The
`one-word` and `constellation` patterns are opposites in exactly this way: one thing owning the
frame, then many things arriving around a centre.

## What still applies

Everything in [step-4-compose.md](step-4-compose.md). A richer register does not buy an exemption:

- the reading floor still governs every line
- frame 0 is still legible, opacity still leads position
- every boundary is still a hard cut
- determinism still holds — no clocks, no unseeded random, no `repeat: -1`
- `hyperframes check` still has to pass with a non-zero sample count

And the rule that matters most here: **a register is chosen because the sentence calls for it.**
A terminal window in a beat that has nothing to do with a terminal is the same failure as a
decorative divider, just more expensive.
