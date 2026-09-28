# reelcut

**A script goes in. A folder of clips comes out.**

`reelcut` is a Claude skill. Give it a spoken script — plain text or an `.srt` — and it segments it
into beats, finds and verifies the assets each beat needs, captures real product screens, sources
data for any charts, composes every beat as HTML + GSAP, and renders one clip per beat plus a
master cut.

It is modelled on [`/brag`](https://github.com/latent-spaces/brag), and shares its central bet: the
quality comes from the model composing each beat against a small set of hard rules, not from
pouring text into templates. Rendering is [HyperFrames](https://hyperframes.heygen.com/).

## Install

```bash
/plugin marketplace add <owner>/reelcut
/plugin install reelcut@reelcut
```

Then run `/reelcut script.txt` in any directory.

## Requirements

- Node 22+
- FFmpeg on `PATH`
- `npx hyperframes` — check with `npx hyperframes doctor`
- For captures that need judgement (sign-in, cookie banners, scrolling to a section): the Claude in
  Chrome extension. Puppeteer handles unattended re-captures.

There is no model API key. The agent running the skill is the director.

## What it does

| step | |
|---|---|
| 1 | **Script to beats** — parse, segment, and write a brief per beat. Every line is checked against the reading floor before anything is composed. |
| 2 | **Acquire** — match assets you already provided, capture real product screens, fetch brand marks from official sources, draw only what is conceptual. Report every gap with its ways out. |
| 3 | **Data** — source figures with a URL and a verbatim quote, re-check the quote, and put it in front of you before it renders. |
| 4 | **Compose** — one HyperFrames sub-composition per beat, written for what that beat says. |
| 5 | **Render** — a clip per beat, a master on hard cuts, and a report of where everything came from. |

## The rules it will not bend

- **Nothing is invented.** Not a statistic, not a logo, not a claim. A generated logo is a
  fabricated logo.
- **Nothing secret leaves a capture.** Real product screens hold real customer data.
- **A capture that cannot be read is a failed capture** — measured, not eyeballed.
- **The reading floor.** A label needs ~0.8s settled; a sentence ~0.3s per word. The payoff gets
  the most time, not the least.

## Try the tools directly

The skill's steps are runnable on their own:

```bash
npm install
npm run beats -- examples/claude-vs-chatgpt.txt --short   # script → beats → a 15-25s cut
npm run check-video -- out/clips/beat-03.mp4              # the frame checker
npm test                                                  # 74 tests
```

## Layout

```
skills/reelcut/        the skill: SKILL.md, references, archetypes, scripts
src/                   the engine — planner, brief, verify, render
examples/              a real script to try it on
```

`src/` is plain TypeScript with one runtime dependency (`zod`). It was ported out of a larger
Remotion pipeline; what came across is the part that was never engine-specific — the beat planner,
the brief contract and its validators, the asset gap logic, and the frame checker.

## Credits

- Modelled on [`/brag`](https://github.com/latent-spaces/brag) by latent-spaces.
- Rendering by [HyperFrames](https://hyperframes.heygen.com/).
