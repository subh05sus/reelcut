# Techniques for the client: previews, steering from the reel, ease, approvals

Planned with the owner on 2026-10-20 in three rounds of choices. Builds on the techniques catalog and graph engine
(`2026-10-20-taxonomy-and-graph.md`). Users: Marlon as a creator now, agency work for brands later, so it is built
for one creator with approval flows in mind.

## Decisions

| | decided |
|---|---|
| Areas | visual previews · steer from the reel · ease & collaboration (insights later) |
| Users | both: a creator now, clients later |
| Names shown | plain English ("Make the number stand out: big, counting up"); paths stay in reel.json |
| Rendering | pre-render the catalog: a preview clip per technique |
| Preview look | the default personality; re-rendered when it changes |
| Preview content | one short sample line written for each technique |
| "3 ways" | on each beat (reel panel) and on the Techniques page (type a line) |
| Swap | a beat's chip opens the 3–5 best techniques for its line with their previews; pick → Claude recomposes and re-renders that beat |
| Ease | client approval boards · guided first run · technique recipes · one-tap favourites |
| Approvals cover | directions · script + beat plan · beat drafts · final master |
| Reel extras | reel-shape strip · variety hint · why-this-technique on each chip |
| Delivery | phases, a review after each |

## Phase 1 — see it, swap it

- **Plain names**: `plain` (one line, what it does for the viewer) and `sample` (its sample line) on every technique
  in the catalog; the studio shows `plain` everywhere, paths only in an "advanced" detail.
- **Preview clips**: `npm run techniques -- previews [--only id]` composes each technique's sample line in the default
  personality (from its first pattern, recomposed; the graph patterns for graph techniques) and renders ~2.5 s clips
  into `~/.reelcut/technique-previews/<personality>/<id>.mp4`; run in the background after the build and whenever the
  default personality changes (the studio shows "previews out of date" until then). The Techniques page plays them.
- **Chips on beats**: the reel panel's Beats view shows each beat's technique as a chip (plain name; tap for
  Claude's reason). Tap → a sheet with the 3–5 best techniques for that line (`suggest`), each with its preview;
  pick → a message to the chat: recompose this beat with that technique, re-render only it.
- **3 ways**: a beat's menu → "3 other ways": Claude composes three alternatives with different techniques, renders
  them small, the owner picks one, it replaces the beat. On the Techniques page: type a line → the same, as a sketch
  (rendered in the default personality, not into a reel).
- **Reel-shape strip** (beats coloured by operation, in the reel panel) and a **variety hint** (three beats in a row
  with the same operation → a note with one-tap alternatives).

## Phase 2 — easier every day

- **One-tap favourites**: a star on the graph, a technique's page and a beat's chip; writes the default
  personality's `techniques.favour`.
- **Technique recipes**: recipes (and series) carry a technique per beat kind (`hook: reveal/space/from-depth`…);
  "Save as a recipe" on a reel saves its techniques; Step 1 starts from them.
- **Guided first run**: on the first visit, a short tour of the Techniques page (what an operation is, how to star,
  swap and see 3 ways), then "make your first reel with suggestions", ending with "rate these beats so it learns you".

## Phase 3 — client approval boards

- One board per reel (or campaign), shared by the existing review link (the tunnel). Four stages, each optional:
  **directions** (techniques per beat, with their previews) → **script + beat plan** → **beat drafts** (each beat
  approved or commented) → **final master** (approve button on the existing review page).
- The client's approvals and comments come back into the Create chat as messages (as review comments do today);
  Claude waits for an approval before moving to the next stage when the reel has a board.
- The board shows the studio's plain names, never paths.

## Status (2026-10-20)

All three phases built and pushed. Tested: the 69 previews render in the plain look and in the owner's personality
and pass every gate; sketches of a German line; the Techniques page, beat sheet, reel panel and the client's board
page in screenshots; boards, decisions and the review server in tests. Untried: a live Claude run of "3 other ways"
and of a board's stages end to end, and a client reaching the board over the Cloudflare tunnel.

## Not now

Insights ("what works for you", weekly suggestions, competitor analysis by technique) — chosen for later.
