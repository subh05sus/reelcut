# The mascot pack

75 pixel poses of a Clawd, one `<rect>` per pixel, provided by the owner and cleared for this repo (2026-10-13). The
pack's own Clawd is bigger than Anthropic's minimal one and has a mouth, so it is **never drawn in a reel**: each pose
is re-cast onto the minimal Clawd the kit draws — its eyes, gaze, arms and legs — and keeps everything else (the
lightbulb, the laptop, the Z's, the confetti, the small Clawds) as pixel layers at the pack's proportions.

```bash
npm run clawd -- import            # re-cast this folder into assets/kit/ui/82-clawd-pack.js
npm run clawd -- poses --tag idea  # what came out
```

The conversion is `src/clawd/pack.ts`. Five poses have no Clawd body to read (it is hidden in a window, a costume or
behind a document) and are left out: `artboard-24cla2`, `malware-detection-window`, `professional-documentation-audit`,
`reading-data-document`, `stealth-ninja-security`. The fifteen unnamed artboards get names from what they show
(`ARTBOARD_NAMES`).

Clawd is Anthropic's character; reelcut draws it for reels about Claude and is not affiliated with Anthropic.
