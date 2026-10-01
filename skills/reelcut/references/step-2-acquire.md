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
