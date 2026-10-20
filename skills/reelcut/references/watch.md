# Watching a video — the Think-Act-Observe loop

reelcut watches video the way a person does, not by reading a fixed stack of frames. You are the viewer;
`npm run watch` gives you a map of the video and senses to use wherever you decide: frames at any frame rate,
a zoom, a text reader, the transcript, and the sound. You decide where to look next, look, say what you saw,
and decide again.

It is used for five jobs here:

| job | when | recipe |
|---|---|---|
| **Ask about a video** | the owner drops a video or a link in the studio's *Ask about a video* mode, or types `/reelcut watch <video> [question]` | the loop below, plus [the recipes](#recipes) |
| **Self-review of a render** | automatically, after every master is joined (Step 5) | [Self-review](#self-review-of-a-render) |
| **Reference study** | `/reelcut study-references` | [References](#reference-study) |
| **Footage moments** | a beat needs a recorded step, and in `/reelcut tag-footage` | [Footage](#footage-moments) |
| **Compare** | "which of these hooks is strongest" | [Compare](#compare-videos) |

Everything about a video is cached in `~/.reelcut/watch/videos/<id>/` (the id comes from the file's
content): its measurements, transcript, on-screen text index, notes, the session and its budget, and every
image a look made. In the studio, every grid you look at appears in the chat, and the chat's **Watch** panel
shows the video with a timeline of where you looked, at what fps and why.

## The loop

**0. Frame the question.** In one line: what would answer it, and is that something *said* (transcript),
*shown* (frames, zoom), *written on screen* (ocr), a *moment* (motion, cuts, sound hits) or a *pattern*
across the whole video? Pick a depth: `quick` (40 frames: "what is this"), `normal` (150: most questions),
`deep` (500: every mistake, frame-exact QA, step extraction, comparisons, self-review).

**1. Map.** `npm run watch -- overview <video|url> --question "…" --depth normal`. It prints the metadata, a
timeline of segments (a motion sparkline, cuts, S speech / M music, what is said), the fast and still parts,
sound hits, notes from earlier sessions, and a **storyboard** grid. Read the storyboard image. For several
videos, pass them all; for one of our masters, add `--beats reel.json` and the timeline is the reel's beats,
each with its script line.

**2. Think: where does the answer live?** Say it before acting, and name what you will skip and why.

**3. Act with the cheapest sense that can settle it:**

| need | command (`npm run watch -- …`) | frames |
|---|---|---|
| where a word is said, shown or noted | `search <v> "pricing" "€"` | 0 |
| what is said in a range | `transcript <v> --from 1:40 --to 2:10 [--words]` | 0 |
| text on screen | `ocr <v> --at 1:49` or `--from A --to B --fps 1 --changes [--region top-right]` | 0 |
| sound: loudness, silence, music vs speech, hits | `audio <v> --from A --to B` | 0 |
| where it is fast or still, the cuts | `motion <v> --from A --to B` · `scenes <v>` | 0 |
| what is shown over a range | `frames <v> --from A --to B --count 9` (a timestamped grid) | n |
| exactly what happens in a fast part | `frames <v> --from 0:16.5 --to 0:18 --fps 10` | n |
| given moments | `frames <v> --at 0:12,0:47.5 [--single]` | n |
| small text, a detail | `zoom <v> --at 1:49 --region top-right` (or `x,y,w,h` fractions) | 1 |

Pass `--why "…"` on every look. It is the line the owner reads in the Watch panel, and it makes you say
what you expect to see. **Read every image a look returns** before you decide the next step.

**4. Observe, then decide.** Say what you actually saw, with its time, and whether it settles the question.
If it doesn't, narrow (a higher fps over a shorter range), widen (the next segment), or switch senses (a
blurry price can be OCR'd; a mumbled word can be read off the caption). Log the important observations:
`observe <v> "dialog opens at 0:17.6" --at 0:17.6`.

**5. Stop when the evidence is enough**, not when the budget runs out. A look refused for the budget (exit 3)
means narrow it first. Use `--over` only when the question truly needs more, and say so.

**6. Remember.** `note <v> "…" --at <t>` for what is durable: what the video is about, its structure, where
things are. The next overview starts from them.

### Habits

- Coarse to fine: `--count 6–9` over a range, then `--fps 4`, then `--fps 10–12` over a second or two where
  the motion map says it is fast, or where the order of events matters.
- A still part needs one frame. A fast part seen at 1 fps is a lie: re-watch the fast parts before you claim
  anything that happens in them.
- Never quote a number, a name, a price or a URL from a downscaled grid. Confirm it with `ocr` or `zoom`.
- Transcript segments marked `?` are low-confidence: check them against what is on screen, or say "probably".
- "It isn't in the video" needs proof: the terms you searched (speech and on-screen text) and the segments you
  checked.

### The answer

The direct answer first, in the owner's language. Then the **evidence**, each claim with its time and how you
know it (*seen*, *read on screen*, *heard*, *inferred*). Then **how I watched**, 3–8 lines. Then your
**confidence** and what would raise it. Hand over the moment when it helps, with `clip <v> --from A --to B
[--gif]`. Make `report <v> --answer answer.md` (an HTML watch path) for deep work, comparisons, or when asked.

## Recipes

**Summary + chapters.** Use the timeline segments, the long pauses and the cuts as candidate chapters. Read
the whole transcript (it costs no frames). For a video with little speech, follow the on-screen headings with
`ocr --from 0 --to end --fps 0.2 --changes`. Check each uncertain boundary with `frames --count 6` around it.
Output a TL;DR, then `0:00 Title — one line` per chapter, then key moments with their evidence. `note` the
chapter list.

**Reel / hook critique.** Use `deep`. Watch 0:00–0:03 at `--fps 10`: the first frame (it is the thumbnail in
the feed), motion or a face in the first 0.5 s, and the promise on screen and readable by 1.5 s (`zoom`/`ocr`
it). Check every text card for time on screen (about 0.3 s per word plus 0.5 s), the safe zone (for 9:16, not
the bottom 20% or the right 15%) and contrast. Check caption timing with `transcript --words` against `--fps 8`
frames. Then pacing: still parts over 2.5 s with nothing new are where people swipe away. Then sound: hits on
the cuts, music under the voice, silence at the start. Output a 1–10 hook score with the reason, then the
issues by impact with a timestamp and a concrete fix each, then what works.

**Find the moment.** `search` with the spoken words, the on-screen words, synonyms, and both languages when
the video is German. Bracket each hit with `--count 6`, then find the exact frame at `--fps 10`. Output
`m:ss.ss: what happens`, with the grid as proof, and say how you made sure none was missed.

**Video → steps.** The narration is the skeleton. `ocr --fps 0.5 --changes` finds every screen change; each
is a candidate step. Watch each click at `--fps 8` (the motion map spikes there) and `zoom` on what is
clicked or typed. Commands and URLs come from `ocr`/`zoom`, never from a grid. Output numbered steps with
times, exact commands in code blocks, a `--single` screenshot for the hard ones, and what the video assumed
but never showed.

## Self-review of a render

After every master is joined (Step 5), **watch it before telling the owner it is done**. This is report-only:
list the problems and **fix nothing** unless the owner asks, the same posture as `checkVideo`.

```bash
npm run watch -- overview out/master.mp4 --beats out/reel.json --question "self-review" --depth deep
```

Then, beat by beat, with the timeline in front of you:

1. **The hook (beat 1):** `frames --from 0 --to 3 --fps 10`. Is something on screen at frame 0? Is the
   promise readable by 1.5 s?
2. **Every text card:** `ocr` it, then compare it against the beat's `script:` line. Look for typos, a wrong
   word, or text cut off at the edge. Is it on screen long enough to read? `zoom` any text that looks small.
3. **Every fast part** the overview lists: re-watch it at `--fps 10–12`. Look for a jump, a flash, an element
   arriving late, or overlapping text.
4. **Every cut** (the beat boundaries): `frames --from <cut-0.3> --to <cut+0.3> --fps 10`. Look for a flash of
   an empty ground, a beat starting before its first element arrives, or a last frame held too long.
5. **The sound**, when there is a voiceover: `transcript --words` around each beat boundary. Does the cut land
   between words, never mid-word? Is the text on screen when its words are spoken? Check `audio` for hits that
   miss their cuts and music that is too loud under the voice.
6. **Footage beats:** `zoom` the recording. Is its text readable at the size shown? Is anything private
   showing (a tab strip, a notification, an email)?

Report it as a section **Self-review** in your reply: each finding as `beat-03 · 0:17.6 · what is wrong ·
the fix you would make`, worst first, with the grid that shows it. If nothing is wrong, say "Watched it
through: nothing to fix", with the moments you checked. `note` the master with what you checked, so a re-render
review starts from it. Add the findings to `report.md` under "Self-review".

## Reference study

`/reelcut study-references` used to tag a film from its 24-frame contact sheet. Watch it instead.
`overview <file>` (the `file` path from `npm run references -- queue --json`), then re-watch its
fast parts at `--fps 10`. Word-by-word builds, kinetic type, a cursor's path and rolling numbers only show up
between frames. `ocr --changes` shows how type is set (`kinetic`, `key-lines`, `minimal`, `none`). Then
`annotate` with the fixed words as before.

A reference is someone else's film, and the studio keeps numbers and fixed words from it, never pictures and
never sentences. So **`npm run watch -- forget <file>` when you have tagged it**: that removes every
grid, transcript and note the watch made of it. Never `note` a reference.

## Footage moments

When a beat needs a recorded step and `npm run footage -- find` has no moment for it, or `/reelcut tag-footage`
has recordings to index, **find the moment yourself**: don't read the 8-frame filmstrip and guess.

1. `overview <file> --depth deep` (the `file` path from `npm run footage -- queue --json`). In a screen recording, a spike in the motion map is a click or a page change.
2. `ocr --from 0 --to end --fps 1 --changes`: every change of text on screen is a candidate step boundary.
3. For the step the beat's line names, bracket it with `--count 6`, then find **the exact in and out** at
   `--fps 10`. *In* is about 0.3 s before the first visible action (the cursor starts moving to the button).
   *Out* is about 0.5 s after the result is fully on screen (the page has loaded, the dialog has settled).
4. Record it: `npm run footage -- propose <asset> --label "<what the viewer sees happen>" --in <in> --out <out>
   --tags …`. It applies at once, and its boundaries are frame-checked, not coarse.
5. Show the proof in your reply: the in and out frames (`frames --at <in>,<out> --single`) with the label. If
   the moment is longer than twice the beat's slot, say so (`npm run footage -- fit … --seconds`). Then offer a
   tighter moment rather than speeding past 2x.

Say anything private you saw (a tab strip, a notification, an email address) in the report, as before.

## Compare videos

`overview a b c` at the same depth. Then put the *same* probe on each, at equivalent moments: the first 3 s at
10 fps, the moment the price appears. Answer in a table, one row per video and a timestamp in every cell, then
give the verdict. `report a b c --answer answer.md` puts all the watch paths on one page.
