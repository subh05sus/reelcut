# Higgsfield — optional AI video, with an automatic fallback

[Higgsfield](https://higgsfield.ai) generates images and video from models like Veo, Kling and Seedance, and
it has an MCP that Claude can call. It is **fast**: a background clip in about the time it takes to write a
composition. So reelcut can offer it for the beats where an AI clip is the honest thing — **and only
there**. Everything else is composed in HyperFrames, exactly as before.

It is optional at every level. Not connected, turned off, a beat that cannot be generated, a generation that
fails: the answer is always the same — **compose the beat in HyperFrames**.

## What it may and may not make

A model makes pictures of plausible things. It cannot make *the* Claude download page, *the* connector screen
or *the* logo, and a clip that pretends to is a fabrication in a film that gets posted. So:

| may | modes | never |
|---|---|---|
| a **background** of moving light and colour under real type | `atmosphere` | a real product screen, a UI, a recorded step |
| a whole beat for an **abstract idea** (a metaphor, a mood) | `whole-beat` | a named brand's mark or anything with lettering |
| a gentle **move on a still** from your library | `animate-still` | a logo, a screenshot or a capture; anything `identity` |

Eligibility is decided from what a beat **requires**, by code, not by feel: a beat with an `identity`
requirement, a footage requirement, or a `ui_simulation` / `logo` visual type is never eligible. A generated
clip is registered as **generic, never identity**, and every piece of lettering on it is HyperFrames', drawn
exact above the clip.

## The flow

### 1. Is it connected? (Step 0, before any question)

Search your tools for the Higgsfield MCP (ToolSearch for `higgsfield`). Connected means a tool that makes
video is available to you. **If it is not, do not ask anything**: say one line in the summary ("Higgsfield is
not connected, so every beat is composed in HyperFrames; connect it to generate backgrounds") and go on.

`npm run generate -- setting` shows the user's standing choice: `ask` (default), `always`, `never`. It is a
select in the studio's header too. `never` means no question and no generation.

### 2. Plan it

Write the beats' facts to a file and ask the code:

```bash
npm run generate -- plan --beats out/beats-gen.json --connected yes     # or no
```

```json
[ { "id": "beat-01", "visualType": "ai_clip" },
  { "id": "beat-02", "requirements": [{ "name": "Claude logo", "assetKind": "identity" }] },
  { "id": "beat-05", "abstract": true } ]
```

It prints, per beat, `GENERATE (mode)` or `hyperframes` **with the reason**, whether to ask, and the limit
(**6 clips a reel**). Same inputs, same plan. Put it under **Generation** in `plan.md`.

### 3. Ask once

Only when the plan says `ask`: one question, with the beats that can be generated and why the rest cannot.

> Use Higgsfield (AI video) for the beats that can be generated? It is faster than composing them.
> **Yes, this reel** · **No, this reel** · **Always** (remember) · **Never** (remember)

Show a **credit estimate** from the Higgsfield tool first and let one yes cover the reel's spend; never
generate more than was agreed. *Always* and *never* run `npm run generate -- setting always|never`.

### 4. Make a clip (your call, per beat)

```bash
npm run generate -- prompt --mode atmosphere --subject "the quiet hour before a launch" --seconds 4.4 --mood "calm, warm"
```

builds the prompt: a fixed frame, the idea in plain words (links, braces and control characters removed,
240 characters), the mood, and a suffix that **always** says *no text, no letters or numbers, no logos, no
user interface, no screens or devices showing software, no real people's faces or likeness.* A clip is 3 to
10 seconds, matched to the beat: generation is not retimed afterwards.

Call the Higgsfield tool with that prompt (for `animate-still`, with the library image), following the tool's
own schema. **Wait at most about 90 seconds per clip.** Save the file under `out/generated/`.

### 5. Register it

```bash
npm run generate -- add out/generated/beat-01.mp4 --mode atmosphere --model "Veo 3" \
  --prompt "<the prompt you sent>" --beat beat-01 --job <job id> --credits 12
```

It becomes a library video asset whose provenance records the model, the prompt, the job and the credits,
labelled **AI-generated** everywhere (the Library card, the reel's report). There is no approval step: a reel can
use it as soon as it is registered, and only a clip the user rejects is refused.

### 6. Place it

Under the beat's type, as a full-bleed plate:

```html
<div class="rc-footage" data-footage="<asset>:<moment>" data-frame="plain" data-fit="cover"></div>
<div class="scrim"></div>   <!-- keeps the type legible whatever the clip does -->
<div class="rc-head">…</div>
```

[`patterns/footage/generated-backdrop.html`](../assets/patterns/footage/generated-backdrop.html) is the
pattern. The render treats a generated clip differently from a recording: **trim only** — longer than the
beat, it is cut at the tail and never sped up (it has no steps to keep in order); shorter, its last frame is
held. It prints `[AI-generated]` for it. A whole-beat clip has no type over it: check it against the reading
floor and the voiceover by hand.

### 7. Log what happened

```bash
npm run generate -- record beat-01 --manifest out/reel.json --outcome generated --asset <id>
npm run generate -- record beat-02 --manifest out/reel.json --outcome fallback --reason "Higgsfield timed out after 90s"
```

`generated`, `fallback` (it was meant to be generated and something went wrong) or `skipped` (it never was).
The studio shows the log on the reel, and `report.md` lists each generated clip with its model, job and
credits.

## The fallback

| situation | what happens |
|---|---|
| not connected, or the setting is `never` | nothing is asked or generated; every beat is composed in HyperFrames |
| the beat needs something real | composed in HyperFrames; the plan says why |
| the tool errors, is not signed in, runs out of credits, rejects the prompt, or takes over ~90 s | **that beat** is composed in HyperFrames; `record … --outcome fallback --reason …` |
| over the limit of 6 clips | the rest are composed in HyperFrames |
| the clip was rejected when rendering | the beat is blocked with the reason; use another clip or compose the beat in HyperFrames |

A failure is never a reason to stop the reel, and never a reason to retry more than once.

## Determinism and cost

The saved file is the render input, so **re-rendering never calls Higgsfield**. Regenerating a clip is an
explicit act (a new `generate add`), not a side effect of a render. The 6-clip cap and the single agreed
estimate are what bound the spend.

## Where it breaks, and what stops it

1. **A clip that fabricates a product, a logo or text.** Eligibility by requirement kind; a prompt that forbids
   them; generic-only provenance; stills that look like marks or screens are never animated; real type is
   drawn by HyperFrames; the report labels it.
2. **Not connected, slow, out of credits.** Connection is checked before any question; one estimate and one
   yes per reel; a clip cap; a timeout; per-beat fallback, logged; saved clips mean no regeneration.
3. **A prompt that carries somebody's words.** The idea is cleaned to plain words and bounded, and the fixed
   suffix is always last.
