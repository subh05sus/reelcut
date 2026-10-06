# Step 2 — Acquire what the script needs

Each brief's `mustShow` becomes an `AssetRequirement`:

```ts
{
  name: "Claude Logo",
  reason: "The beat names two products",
  sceneUsage: "Beside the ChatGPT mark in the comparison beat",
  visualRole: "brand mark",
  acceptedFormats: ["svg", "png"],
  priority: "required" | "optional",
  assetKind: "identity" | "generic",
}
```

## `assetKind` is the field everything turns on

**`identity`** is a specific real-world thing that cannot be faked — a named company's logo, a real
screenshot of a real UI, a real captured interaction.

**`generic`** is conceptual — an arrow, a divider, a diagram element — where a drawn shape is an
honest stand-in.

The consequences are absolute:

- A missing **required identity** asset **blocks the reel**. There is no honest substitute for a
  specific real thing.
- A missing **generic** one never stalls anything. Draw it.
- **Drawing an identity asset is never an option**, and the code will not offer it to you.
  A generated logo is a fabricated logo.

## Resolve in this order

### 0. The library

`~/.reelcut/library` holds every asset an earlier reel acquired and verified, with where it came
from. `npm run intake` searches it first (below); `--tags chatgpt` narrows it to assets carrying
that tag, when the user asks for "the ChatGPT ones".

A library match is **`auto`** — use it without asking — only when all of these hold:

- the match is `exact`,
- the asset is `active` (superseded and retired assets are never offered),
- an `identity` asset has a source someone can check: a URL, a capture sidecar, or the user
  having handed it over,
- a capture was taken within the last 90 days.

Anything else is a **proposal** and says why. The rule exists because a brand that refreshed its
mark, or a product that redesigned the screen, would otherwise keep getting last year's version,
and that passes every later gate.

Use a library asset in a composition as `assets/library/<id>.<ext>`, exactly as intake prints it.
The render copies it in and records which reel used it.

When you accept a new identity asset, add it, so the next reel skips this whole step for it:

```bash
npm run library -- add assets/in/claude-logo.svg --kind identity --tags claude,anthropic,logo --url https://www.anthropic.com/brand --licence "brand guidelines, nominative use"
```

A capture's `*.png.json` sidecar is read automatically. When a mark changes, add the new one and
`npm run library -- supersede <old-id> <new-id>`.

A library asset has a **review state**. `approved` assets (added by hand, approved in the studio, or
from a folder the user marked trusted) can be applied by themselves when the match is exact and the
provenance checks out. `pending` ones (dropped in, not yet looked at) are only ever proposals, shown
with "not reviewed yet", and an asset the user rejected is never offered. A dropped file is never
assumed to be an identity asset: if the requirement is for a named brand's mark and the only
candidate is pending and generic, show it and ask the user to confirm in the studio.

`npm run library -- queue` lists what is waiting for Claude to look at, and `/reelcut tag-assets`
works through it (see SKILL.md). `npm run library -- status` says how much is pending.

### 0b. Footage — a real step, recorded

A `mustShow` that is a real thing being done ("download Claude", "add the Higgsfield MCP", "upload this
skill") is a requirement with `"form": "footage"` and the step as its name. It is answered by a **moment**
of a recording in the library, never by a drawing and never by a still matched on its filename:

```bash
npm run intake -- --requirements out/requirements.json   # footage requirements are matched to moments
npm run footage -- find "download Claude" --platform mac
npm run footage -- fit <asset>:<moment> --seconds 4.4    # does it fit the beat, and is its text readable
```

No approval, confirmation or private-information tick is needed: a recording, and the moments Claude indexed
on it, are used as soon as they match. A moment is used by itself when the match is exact, the recording is
dated within 90 days, and it has been said yes to once. **A first use, an old recording or a weaker match is a
proposal: show the user the moment (its label, length, recording and date) and ask once, and put every such
question in one message, before any composing starts, so nothing waits for an answer halfway through the
render.** A render that uses a moment records the yes; after that a fresh, exact match is used without asking.
Only a recording the user rejected is refused.

A recording on a **green screen** is found when it comes in and keyed in the background into a transparent
copy the render uses (see [footage.md](footage.md#green-screens)). Nothing to ask; mention it in the report.

Nothing matching is a blocking gap for a required real step. Its ways out are to record it, to mark a
moment in a recording the user already has (the studio's Footage tab), to use another moment, or to
compose an animation — which is a stand-in for the real step, and should be said to be. Full rules:
[footage.md](footage.md).

### 1. What was already provided

```bash
npm run intake -- --dir assets/in
```

`intakeDrops` scores each file against each open requirement and reports a confidence:

- **`exact`** — every significant word of the requirement's name is in the filename and the format
  fits. Safe to apply without asking.
- **`likely`** / **`guess`** — a proposal. Show it and wait.

One file answers at most one requirement. A single PNG cannot be both the product screenshot and
the logo, and letting it claim both hides a real gap behind a filled slot.

Assets handed over in the conversation count the same way — match them before searching for
anything.

### 2. Capture a real product screen

Use the **Claude in Chrome** extension when the capture needs judgement: signing in, dismissing a
cookie banner, scrolling to the right section, deciding what the crop should contain.

Capture the **element**, not the viewport:

```bash
npm run capture -- <url> --selector "<css>" --target-width 0.8 --must-contain "Passendes Modell"
```

Three things are checked and any of them fails the capture:

1. **Legibility.** `renderedPx = minFontSizePx × (targetWidthInFrame ÷ captureWidth)`. Below 11px
   the capture is refused and told what crop it needs. This is arithmetic, not a judgement — the
   browser knows the smallest computed `font-size` in the node.
2. **Consent or login pattern** in the captured DOM.
3. **`--must-contain`**, so a sign-in page cannot pass as a dashboard.

Read [sourcing.md](sourcing.md) before capturing anything. Real screens hold real customer data.

### 3. The brand's own source, for a mark

Only the brand's own press or brand page. Record the source URL and the licence terms with the
asset. A mark from a blog, a logo aggregator or an image search is a **proposal** that names where
it came from — never applied automatically, because a fan-made or superseded logo passes every
downstream gate exactly as a fabricated statistic does.

### 4. Draw it — `generic` only

A generic requirement that is atmosphere (a background, a mood) may be **generated with Higgsfield** instead
when it is connected and the user agreed in Step 0 — see [generate.md](generate.md). A generated clip is never an
answer to an `identity` or footage requirement, is registered as pending, and falls back to drawing or
composing it if anything goes wrong.

## Report what is still open

```ts
formatGapReport(reportAssetGaps([{ requirement, status: "acquisition_failed", detail: "login wall" }]))
```

The report names what is missing, whether it stops the reel, why the beat wants it, and the ordered
ways out — capture, official source, provide the file, substitute, draw, omit if optional, or
recompose the beat without it.

**`recompose` is always last and always present.** Changing the beat so it does not need the asset
is a real creative concession, but it means nothing is ever simply stuck.

Never end this step with "2 assets missing" and nothing else. That is the behaviour this replaces.
