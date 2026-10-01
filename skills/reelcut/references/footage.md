# Footage — real recordings, used as they were recorded

When a beat shows a real thing happening — *download Claude*, *add the Higgsfield MCP*, *upload this skill
into Claude* — the honest picture is a recording of it happening. Drawing that as an animation is a
stand-in for the real step, and it is the one thing this reel should not do when a recording exists.

So recordings are library assets, and a composition **places** one instead of recreating it. What reaches
the frame is the recorded pixels.

## What may and may not be done to a recording

| may | how | never |
|---|---|---|
| **Trim** to one step | the moment's `in` and `out`, written as the video's start offset | cut inside it, reorder it, loop it |
| **Frame** it | a rounded window on the reel's ground, with a hairline and a shadow; or plain | restyle it, recolour it, put a device around a screen that was not on one |
| **Zoom** to a region | the recording moves inside its box (`RC.zoomTo`); a region is saved per reel format | crop the file, or stretch it |
| **Speed up** a long step | one even rate, **at most 2x**, so every step still happens in order | slow it down, or change the speed partway |
| **Hold** the last frame | when the step ends before the beat does: the result is what the viewer has to read | freeze it in the middle of the step |
| **Annotate** over it | a ring on a part (`RC.spot`), a step pill in glass (`.rc-fstep`), captions in the headline | draw into it, mask something that is in it |

The file is never rewritten, re-encoded or opened for writing. A moment is two numbers; a zoom is a
region; a speed is an attribute on the element that plays it.

## Getting recordings in

Like every asset: drop them on the studio's Library page (or whole folders, or point a watched folder at
where the Mac saves them), or `npm run library -- ingest recording.mov`. Each is checked by its bytes,
measured (size, length, frame rate, whether the frame rate varies, creation time, sound), and given a
preview and a **filmstrip**: eight frames across the recording, so a person can see all of it without
playing it. It waits in Review like anything dropped in.

Recordings are large. The upload limit is 500 MB a file; raise it with `REELCUT_MAX_FILE_MB=4000` before
starting the studio. A watched folder is read from disk and has the same limit.

Tell users how to record well:

- **Shift-Cmd-5** on a Mac (or the OS's own recorder). One step per take; start before the click and leave
  a second of the result at the end.
- **Do Not Disturb on**, other windows closed, a demo account. A notification in the corner of a
  recording cannot be removed afterwards — nothing here edits the picture.
- Record at the size you will show it: a 14-inch screen shrunk into a card makes its text unreadable
  (see *Will it be readable*).

## Marking moments

A script line wants one step, and a recording holds several. In the studio's **Footage** tab, scrub to the
start of a step, press *Mark in*, scrub to its end, press *Mark out*, and name what the viewer sees happen:
"download Claude". Add tags for the product and the action. Or from the command line:

```bash
npm run footage -- list
npm run footage -- moment add <asset> --label "download Claude" --in 2 --out 8.5 --tags claude,download,mac
npm run footage -- meta <asset> --app Claude --platform mac --recorded 2026-09-30
```

**Claude may propose; it may not decide.** `/reelcut tag-footage` has Claude look at each unmarked
recording's filmstrip and run `npm run footage -- propose …`. A proposal is shown in italics in the Footage
tab and cannot be matched to a script line until a person confirms it — because the label is what a script
line gets matched to, and a wrong one puts the wrong step in somebody's film. The filmstrip is eight frames,
so Claude's boundaries are coarse; the person sets the real ones.

## The gates a recording passes before it is used by itself

All of these, in the Footage tab (each is a tick in its checklist):

1. **Approved** — a person looked at the recording.
2. **Checked for private information** — a person watched *all of it* for emails, notifications, other
   windows, the menu bar, a colleague's name. This is its own tick, not implied by approving, and **Claude
   never sets it** (`npm run footage -- check` refuses without `--watched`, which is for when the user says
   they did). The render refuses a recording without it: there is no way to mask anything in a recording, so
   the check is the only protection there is.
3. **Dated** — recorded within 90 days, like a capture. The date comes from the file when it has one, or the
   person's. An unknown date is never treated as recent.
4. **A confirmed moment** — not one of Claude's proposals.
5. **Said yes to once** — the first time a moment is matched it is shown to the user, who is asked in Step 2.
   A render that uses it records that, and after that a fresh, exact match is used by itself. Moving the
   moment's start or end asks again.

Anything short of all five is a **proposal** that says what is missing.

## Finding the moment a line wants

The requirement says it is footage, and names the step:

```json
{ "name": "Download Claude", "reason": "step one of the install", "sceneUsage": "the install beat",
  "visualRole": "screen recording", "acceptedFormats": ["mp4", "mov"], "priority": "required",
  "assetKind": "identity", "form": "footage" }
```

`npm run intake -- --requirements out/requirements.json` looks for it in the recordings' moments (and never
matches a still by filename). `npm run footage -- find "download Claude" [--platform mac]` does the same by
hand. A match reads the moment's label and tags, and the recording's app and tags; **the step has to be in
the moment** — a recording of Claude does not answer "sign in" if the moment is "download". *Install* and
*download* are treated as the same step, with less confidence. A real recording is `identity`: if nothing
answers, it is a blocking gap whose ways out are *record it*, *mark a moment in a recording you have*,
*use another moment*, or *recompose the beat as an animation — a stand-in, not the real thing*. It is never
drawn.

## Placing it in a beat

```html
<div class="rc-footage" data-footage="3f2a9c1d5e7b8a40:m_ab12cd34" data-frame="window"
     style="left:84px; top:381px; width:912px">
  <div class="rc-fv">
    <i class="rc-spot" style="--x:.083; --y:.45; --w:.219; --h:.092"></i>
  </div>
</div>
```

The render turns the placeholder into the `<video>`: the trim (`data-media-start`), an even speed-up
(`data-playback-rate`), a held last frame (an `<img>` made from the recording's last frame) and the
recording's own shape (`--fw`, `--fh`). **None of those numbers is ever typed by hand**, so none can
disagree with the moment.

| attribute | | |
|---|---|---|
| `data-footage` | required | `<asset id>:<moment id>`, as `footage find` prints it |
| `data-at` | 0 | seconds into the beat the recording starts |
| `data-for` | the rest of the beat | the slot, in seconds |
| `data-frame` | `window` | `window` (rounded, lifted, hairline) or `plain` (square, flat, for a full-bleed use) |

Set the box's `left`, `top` and `width` on the grid ([kit.md](kit.md#layout-discipline)); the height follows
the recording's shape, so nothing is cropped or stretched. A 16:10 recording at 912 wide is 570 tall: top
`336 + (660 − 570) / 2 = 381` centres it in the content region. Anything that should move with a zoom goes
in `.rc-fv`; anything that should not goes outside the box.

The region saved for a format is drawn in the Footage tab (*Draw on the video*: drag a box; it keeps the
recording's proportions) or set with `--focus 1:1=x,y,w,h`.

Motion: the box enters with `RC.rise` (opacity and a rise), **never blurred** — it is the product, and it
is sharp from the first frame. `RC.zoomTo(tl, ".rc-footage", at, { region: [x, y, w, h] })` moves the
recording inside its box: `region` is fractions of the recording, or leave it out to use the region saved on
the moment for this format (`data-focus`, written by the render). Give a region the recording's own
proportions (width and height as the same fraction) and the view is exactly that region; the view is kept
inside the recording either way. `RC.spot` brings a ring onto the part it points at.

The pattern is [`patterns/footage/footage-window.html`](../assets/patterns/footage/footage-window.html).

## How a moment fits a beat

The beat is as long as the voiceover says. The recording adapts, in two directions only:

- **Longer than the slot** → played faster, one even rate, up to **2x**. A 6.5 s step in a 4.4 s beat plays
  at 1.48x.
- **Shorter** → it ends, and its last frame is held to the end of the beat. A hold over 1.5 s is reported:
  "the recording ends 2.1s before the beat does".
- **Past 2x** → it does not fit. The beat is refused, with the reasons and the ways out: mark a tighter
  moment (at most twice the slot), give the beat more time, split it into one step per beat, or compose it as
  an animation (a stand-in). It is never quietly cut and never hurried past what reads as the same recording.

`npm run footage -- fit <asset>:<moment> --seconds 4.4` says which before you write the beat.

## Will it be readable

A whole screen shrunk into a card is a smear — the same defect captures had. The same arithmetic applies:
UI text as recorded (estimated from the size, or the number a person entered) times the scale it is shown at
must reach 11 px. A full-screen 1920-wide recording at 912 px wide renders its 14 px text at 6.6 px: too small.
The fixes are the ones captures have: **zoom in** on the part that matters (save a region for the format,
then `RC.zoomTo`), or give it more of the frame, or record a smaller area.

`npm run measure -- compositions/beat-03.html 3 --format 1:1` measures each placed recording's box and says
which are illegible, counting the saved zoom region. `npm run footage -- fit … --format 9:16` does it
before the beat exists. Treat an ILLEGIBLE line as a failure of the beat.

## Sound

Muted by default: the voiceover owns the track. A recording with its own sound can be unmuted per recording
in the Footage tab (or `npm run footage -- meta <asset> --muted false`); it then plays at full level under
whatever else is mixed.

## Rendering

- Frames are pulled out of recordings as **PNG**, not JPEG (`--video-frame-format png`): JPEG smears the
  thin text of a recorded interface, which is the whole point of showing it.
- A recording of 32 MB or more is **hardlinked** into each project instead of copied, so a 2 GB `.mov` is
  not duplicated into every clip; on another drive, or a filesystem without links, it is copied.
- A recorder that only writes a frame when something changes (a *variable* frame rate) is noted in the
  Footage tab. HyperFrames renders it through a proxy for seeking; the original is untouched.
- The frame checker's `blank_panel` finding is **reported, not gated** for a beat with footage in it: a real
  interface has empty canvases and loading panels, and that is not a composition that forgot to draw.
- The render refuses, with the reason and the fix, a recording that is not approved, not checked for
  private information, a moment that is a proposal, a rejected file, or a moment too long for its slot.
  An old recording renders with a warning.

Put each placed recording in `report.md` with its provenance, like any asset: the moment, the file, who
recorded it and when, and what was checked.

## Where it breaks, and what stops it

1. **A stale or leaking recording.** A UI that has since changed passes every gate once it fills the slot,
   and a notification in the corner cannot be masked. → approval, a dated recording that goes stale at 90
   days, and a private-information check that only a person can tick and that the render enforces.
2. **A moment that does not fit.** A 40 s install in a 3 s beat, or a recorder with a variable frame rate. →
   the beat's length is the voiceover's; the recording adapts by an even rate to 2x or a held last frame,
   and otherwise is refused with options. Variable frame rates are detected on ingest and rendered through a
   proxy.
3. **Unreadable at the size shown.** → the capture legibility arithmetic, a saved zoom region per format,
   and `npm run measure`.
