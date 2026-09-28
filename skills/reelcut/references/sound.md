# Sound — only when asked for

Sound effects are **off unless `--sfx` is passed.** A run without it renders silent even if the
manifest places sounds, so a reel never gains audio nobody asked for.

## The set

Five effects in `assets/sfx/`, synthesised rather than recorded — see
`tools/generate-sfx.ts`. Each is a formula, so it is original, carries no licence, and regenerates
byte-identical. All are mono and normalised to the same −3 dBFS peak, so one volume setting behaves
the same across all of them.

| file | length | goes under |
|---|---|---|
| `whoosh.ogg` | 0.55s | a large element travelling across the frame, or a scale change moving a lot of area |
| `swipe.ogg` | 0.30s | a lighter lateral move — a card sliding in, a panel shifting |
| `tick.ogg` | 0.035s | a single keystroke or tap — a click landing, a toggle flipping |
| `typing.ogg` | 1.19s | a run of 12 keystrokes at ~10 a second, uneven like a person. Under text that types on |
| `thud.ogg` | 0.45s | something landing with weight — a card settling, a headline slamming in |

They will not out-shine a recorded library and are not meant to. At 0.35 under a voice, clean and
restrained beats rich and characterful.

## Placing them

In the manifest, per beat, relative to that beat's start:

```json
{ "id": "beat-03", "durationSeconds": 4.066, "composition": "compositions/beat-03.html",
  "sfx": [{ "source": "../../skills/reelcut/assets/sfx/thud.ogg", "at": 0.98 }] }
```

`at` is seconds from the start of **the beat**, not the reel. Inside a clip the sound stays where you
put it; in the master it is shifted onto the reel's timeline automatically. `volume` is optional
(0–1, default 0.35). Duration is probed from the file.

**Put the sound on the motion, not near it.** Read the composition's timeline and place the sound at
the moment the thing it belongs to *lands* — the end of the tween, not its start. A thud at the start
of a drop sounds like the element hit something invisible on the way down.

## The rules

**Restraint is the default.** The example reel is 18 seconds with three sounds: one slide, one drop,
one landing on the payoff. That is about right. A sound on every entrance is how a piece starts to sound like a
template.

**Sounds support motion; they do not announce it.** If a beat has no motion worth marking, it has no
sound.

**Match weight to weight.** A tap gets `tick`, a heavy landing `thud`, travel gets `whoosh` or
`swipe`. A whoosh under a badge sounds wrong in a way viewers notice without being able to say why.
A small element arriving on its own usually needs no sound at all.

**Leave space around the voice.** Effects sit at 0.35 so they never compete with speech. If the
script has a voiceover and a sound would land on a stressed word, move the sound, not the word.

**Typing stops when the text stops.** Start `typing` on the first character and set the cue's
`durationSeconds` to the type-on's length — the run is cut there, so no key sounds after the last
character lands. A type-on longer than 1.2s gets a second cue starting where the first ends. A key
with no character is a stutter, and viewers hear it.

```json
"sfx": [{ "source": "…/sfx/typing.ogg", "at": 0.3, "durationSeconds": 0.8 }]
```

## What `--sfx` does not do

It places and mixes effects. It does not add music, and it does not add or mix a voiceover — the
voice is the edit's job. The master carries the effects so the cut can be judged with them; the clips
carry their own beat's effects, beat-relative.

## Verifying

After rendering, confirm the sounds landed where they were placed:

```bash
ffmpeg -i out/master.mp4 -af silencedetect=noise=-45dB:d=0.05 -f null -
```

Each `silence_end` is a sound starting. On the example reel they land within ~5ms of the placed
times — the detector crossing its threshold during each sound's 4ms fade-in, well under one frame.
