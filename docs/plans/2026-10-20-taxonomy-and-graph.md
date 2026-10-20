# Techniques taxonomy + graph engine

Planned with the owner on 2026-10-20 in four rounds of choices. The starting point was a reel Marlon sent
("let's copy this framework for the visual studio"), an art-direction teacher's *Taxonomy of Visuals*: every
image is filed by the mechanism that makes it work, not by its aesthetic, as Operation → Domain → Technique →
Execution. The project is **Iris™, *A Taxonomy of Visuals*, by Modern Art Direction**
(https://visuals.modernartdirection.com; beta, the full library behind membership or course access, no open licence,
image rights with their owners). We take the **idea of the framework**, credited as our inspiration, and nothing
else: ours is written in our own words from public Gestalt and semiotics principles and reelcut's own moves and
patterns, with our own look, and is not called Iris.

## Decisions

| | decided |
|---|---|
| Product | the reelcut studio |
| Jobs | steer composition · a browse page in the studio · tag & learn · brief → visual idea tool |
| Catalog | written fresh by us (Gestalt, semiotics), mapped onto the 26 moves and 89 patterns |
| Operations | Differentiate · Group · Sequence · Infer · **Reveal** · **Transform** (the last two are what only video can do) |
| Domains | Feature · Grouping · Space · Social · Semantic · Cultural · **Typographic** · **Interface** · **Sound** |
| Levels | Operation → Domain → Technique → **Timing** → Execution (Timing: build, snap, hold, morph, rhythm, delay) |
| Steering | every beat names its path in plan.md (with why) · personalities favour/ban techniques. No gate, no variety rule |
| Graph moves | node-graph world + camera · tree build + highlight · path card · image bloom / wall |
| Speaker | graphics only: no talking-head compositing, split screen or matting |
| Graph data | any structure, from the script: Claude writes the nodes and links as JSON |
| Graph images | library, captures, the owner's rendered reels **and reference frames** |
| Reference frames in reels | allowed. **This reverses a hard rule.** Guardrails: per-reel opt-in in Step 0 (default no), and every frame logged in report.md (film, moment, where it appears) |
| Scale | up to ~500 nodes: thumbnails in one sprite sheet, links on one layer, so 60 fps renders stay fast |
| Look | personality-driven, plus a new **Atlas** style (paper/ink grounds, thin coloured curves, serif + mono labels) |
| Browse page | a live graph on the same engine: click an operation, the tree highlights, the path card rolls, examples bloom; pin a technique to a reel |
| Idea tool | a 4th Create mode, **From a brief**: brief → operations → techniques → examples as cards → write the script / make the reel |
| Tagged | every beat reelcut makes · the 89 patterns · library assets (reference films are not tagged) |
| Delivery | all at once, one review at the end |

## What gets built

**1. The catalog — `src/taxonomy/`**
- `catalog.ts`: operations, domains, techniques (definition, cue for when to use it, the moves and patterns that
  perform it, a Timing default, a source note) and timings. One typed list, zod-validated; `catalog.json` for
  the page. v1 aims at ~60 techniques across the 9 domains.
- `paths.ts`: validating and printing a path (`differentiate/feature/complementary-pairing/snap`); suggesting
  paths for a beat from its kind, text and brief (`hook` → Differentiate/Reveal, `data` → Differentiate/Feature,
  `product` steps → Sequence, `quote` → Infer/Cultural, `cta` → Reveal …), ranked by the personality and learnings.
- `npm run techniques -- list|show|suggest "<line>"|for-pattern <id>|tag …`

**2. Steering composition** (skill + planner)
- Step 1 writes each beat's `path` and `why` into plan.md and reel.json (`beats[].technique`).
- Step 4 composes to that path: the pattern(s) it maps to, its Timing.
- Personalities get `techniques: { favour: [...], ban: [...] }` in the Personality page (a "Techniques" step) and
  `personality brief` prints them.

**3. The graph engine — `skills/reelcut/assets/kit/graph/`** (runs in HyperFrames and in the studio)
- Data: `{ nodes: [{ id, label, kind, group, image? }], links: [{ from, to }], focus? }`, from the script.
- Layouts: radial (hubs → chips → icons → images ring), tree (top-down levels), cluster (bloom around a node).
- Rendering: SVG for links (curved, per-group colour, dash-draw), DOM for labels and chips, one sprite-sheet
  canvas layer for ≤500 thumbnails; a camera (world transform) with `RC.graph.fly(to, zoom)`, `pullBack`, `pushIn`, `drift`.
- Moves: `tree(opNode)`: branches draw level by level, others dim · `pathCard(path)`: rows 01–05 stack in, a
  changed row rolls · `bloom(node, images)` / `wall(images)` · theme flip.
- Sprite build: `npm run graph -- sprites <images…>` → one atlas + map, cached by content.
- Patterns: `graph-world.html`, `graph-tree.html`, `graph-path-card.html`, `graph-bloom.html`; patterns.md rows.
- Atlas style in `src/personality/styles.ts` + its preview sample/showcase.

**4. Images for the graph**
- `npm run graph -- images --for <reel> [--refs]`: picks from the library, captures, rendered reels and, when the
  reel opted in, reference frames (via the watch tool's frames).
- The rule change lands in SKILL.md (Hard rules), reference-videos.md and the references store's comment: a
  reference may appear as a graph thumbnail only after Step 0's opt-in, and each one gets a report.md line.

**5. Studio**
- A **Techniques** page (sidebar): the live graph of the catalog; examples from patterns, rated beats, library
  assets and references; search; "Pin to this reel" sends the path to the Create chat.
- Create mode **From a brief**: paste a brief → cards (operation → technique → examples) → pick → "Write the
  script" (write mode, the picks carried in) or "Make the reel".
- Personality page: a Techniques step (favour/ban).

**6. Tag & learn**
- Every beat's path is stored with its rating ("Works" / not) and performance numbers; learnings score techniques
  per personality and format ("Semantic contrast hooks: 3 Works, best 3 s retention").
- Patterns: `technique` tags on each of the 89 (Claude proposes, the owner accepts in the Patterns page).
- Library: `npm run library -- annotate --techniques …`; the Review tab shows them.

## Risks and notes

- Reference frames in public reels are someone else's work. The opt-in and the log make it a choice, not an
  accident; they don't make it licensed.
- 500 thumbnails per frame: the sprite sheet and a single canvas keep the DOM small; check render time on a
  60 fps 4K beat early.
- Operation names like Differentiate / Group / Sequence are ordinary visual-communication verbs and many technique
  names are standard Gestalt terms; ours are defined in our own words, and none of Iris's graphics, data, examples or
  name are used. The Techniques page and techniques.md credit Iris (Modern Art Direction) as the inspiration.
