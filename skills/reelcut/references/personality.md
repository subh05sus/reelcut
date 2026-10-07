# The personality — how every reel looks, moves and sounds

The owner sets it up once in the studio's Personality page (http://localhost:5198/#personality): up to three of twenty
design styles, a colour scheme and a type pairing per style, motion, texture, signature moves, copy and voice, sound,
pacing and guardrails. Several can be saved; one is the default. Decisions behind it:
`docs/design/apple-glass/personality-decisions.md`.

## Step 0: confirm it, don't ask it again

```bash
npm run personality -- brief            # the default personality, in words
npm run personality -- brief --json     # all of it
```

When there is a default personality, say it in **one line** ("Using the gptmarlon personality: Claymation, Swiss and
UI / Product") and **skip every question it answers**: look and palette, type, motion, sound effects, music mood,
text on screen, format. An answer the user gives now still wins for this reel. When there is no personality, Step 0
asks as before. Write its id into `reel.json`:

```json
{ "personality": "p_4c7b4abd", "type": "<lead style's pairing>", "direction": { "motion": "<its energy>" }, … }
```

The render uses the named personality for whatever the reel does not say itself: its lead style's type pairing and its
motion energy.

## Step 1 and Step 4: compose each beat in its style

- **Which style:** the beat's kind (hook, statement, data, product, quote, call to action) → `beatStyles` in the
  personality. Weights say how much of the reel each style carries; keep roughly to them across the beats.
- **That style's colours:** set its scheme on the beat's root: `#root { --ground; --ink; --accent; --accent-2 }` from
  `palettes[style]` (or the style's first curated scheme). Never mix two styles' schemes in one beat.
- **That style's type:** `data-type="<fonts[style]>"` on the root.
- **That style's world:** its look (`look` in the catalog), its preferred moves (`moves.prefer`) and never its avoided
  ones, its motion note, its texture. Its saved preview (`~/.reelcut/style-previews/<style>-sample.mp4` and
  `-showcase.mp4`, and the composition generator in `src/personality/preview.ts`) shows how the kit draws it today:
  card shapes and layered shadows for Paper Cutout, matte bevelled clay with squash and stretch on held 12 fps frames,
  outlines that draw for Hand-Drawn and Linear, slabs for Isometric, gooey blobs for Liquid, a letterbox and grain for
  Cinematic, scanlines and a striped sunset for Retro / VHS, RGB split and slices for Glitch, a grid and one red block
  for Swiss. Styles marked "directed" have no look of their own in the kit yet: compose them with these treatments.
- **Signature moves:** the intro, logo reveal, lower third, end card, how a key word is emphasised, captions, the
  tagline: the same in every reel.
- **Copy and voice:** case, full stops, quote marks, numbers, emoji, the voice. Apply them to every word on screen.
- **Pacing:** text amount (`auto` follows the voiceover rule in direction.md), beat lengths, how long the payoff holds.
  The reading floor still wins.
- **Sound:** effect flavour and loudness for `sfx suggest`, the music mood and tempo for `npm run music -- find`.
- **Guardrails:** banned colours, fonts and moves never appear; no glass or confetti when they are off; the contrast
  floor for text; the owner's notes.

## Commands

| | |
|---|---|
| `npm run personality -- brief [--json]` | the default personality for Step 0 |
| `npm run personality -- previews [--only a,b] [--kind sample\|showcase\|both]` | render the 20 style previews the page shows (once; saved in `~/.reelcut/style-previews`) |
| `npm run personality -- mini <id>` | render a mini beat per chosen style in that personality's colours, type and motion (the page's "Render mini beats") |
