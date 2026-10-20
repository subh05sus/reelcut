# Techniques — what a beat must do, and how

Every beat does something to the viewer: it makes one thing stand out, ties things together, walks them through
steps, lets them work out a meaning, withholds and then shows, or turns one state into another. reelcut names
that, for every beat, before composing it:

```
Operation → Domain → Technique → Timing → Execution
differentiate / semantic / semantic-contrast / hold        → patterns, your beats, library images that do it
```

| level | the question | the values |
|---|---|---|
| **Operation** | what must the visual do? | `differentiate` · `group` · `sequence` · `infer` · `reveal` · `transform` |
| **Domain** | through which channel? | `feature` · `grouping` · `space` · `social` · `semantic` · `cultural` · `typographic` · `interface` · `sound` |
| **Technique** | by which move? | ~70, `npm run techniques -- list` |
| **Timing** | played how? | `build` · `snap` · `hold` · `morph` · `rhythm` · `delay` |
| **Execution** | where has it been done? | built-in patterns, beats you rated Works, tagged library images |

Classified by **mechanism, never by aesthetic**: "semantic contrast" is the same technique drawn in Claymation or
Swiss. The framework is inspired by **Iris™, *A Taxonomy of Visuals*, by Modern Art Direction**
(visuals.modernartdirection.com). Nothing of theirs is used: our operations, domains, techniques and every
definition are written in our own words from public visual-communication principles (Gestalt grouping, figure and
ground, semiotics) and reelcut's own moves and patterns. Timing, Reveal and Transform are ours because a reel moves.

```bash
npm run techniques -- list [--operation reveal] [--domain interface]
npm run techniques -- show semantic-contrast          # definition, patterns, your beats, library images, its score
npm run techniques -- suggest --kind data "Über 71.000 Follower in sechs Monaten"
npm run techniques -- plan out/reel.json             # each beat's path checked, or the best suggestion
npm run techniques -- ideas "Make our scheduler stand out: it replaces three tools"
npm run techniques -- check differentiate/semantic/semantic-contrast/hold
```

## Steering composition

**Step 1: name each beat's path.** For every beat, decide what it must *do* (the operation), then the technique,
and write both into plan.md and `reel.json`:

```json
{ "id": "beat-04", "kind": "data", "text": "…", "technique": "differentiate/typographic/big-number/build",
  "techniqueWhy": "the 71.000 is the claim; it has to be the biggest thing in the reel" }
```

- `npm run techniques -- suggest --kind <kind> "<line>" --near <prev-technique>` ranks techniques for the line by its
  words and kind, the default personality's **favoured** techniques, how techniques were **rated** in your reels,
  and (with `--near`) away from the neighbouring beat's. It is advice: you choose, and say why in `techniqueWhy`.
- A **banned** technique (the personality's Techniques step) is never used.
- A technique the owner **pinned** from the studio's Techniques page arrives as a chat message: use it for the beat
  it fits best, say which, and record it.
- Vary: a reel of nine beats that all `differentiate` is one note. `techniques -- plan` counts the operations used.
- `npm run render` reports a beat with no technique or an invalid path. It never blocks one.

**Step 4: compose to the path.** `npm run techniques -- show <technique>` lists the patterns that perform it: open the
first one, lift the move, recompose the frame for this line. The timing is how it plays: `build` arrives in order,
`snap` changes on a beat, `hold` lets it be read, `morph` shows two forms are one, `rhythm` repeats on a pulse,
`delay` makes them wait for the payoff.

**What it teaches.** Each rendered beat's technique is scored by its rating (Works +1, down −1). The Techniques
page shows it, suggestions use it, and the owner sees which techniques land for them.

## Graphs

For a beat about a **system** — a taxonomy, an ecosystem, categories and their members, "hundreds of examples", a
decision path — use the kit's graph engine (`RC.graph`, [kit.md](kit.md#the-graph-engine)). Claude writes the
structure from the script as data; the engine lays it out (radial, tree, cluster), draws its links, flies its
camera, lights a branch, blooms a node's members and fills a wall, all seek-safe. Four patterns show the moves:

| pattern | technique | the move |
|---|---|---|
| `graph-world` | pull-back, hub-and-spokes | six hubs, their branches, a cloud of examples; the camera starts close and pulls back; the world turns |
| `graph-tree` | hierarchy-tree, branch-highlight | choices along the top draw down level by level; one branch lights, then another |
| `graph-path-card` | path-card | a card's numbered rows stack in while the matching branch lights; a changed row rolls |
| `graph-bloom` | bloom | members burst out of one node along its links onto a spiral; a count lands |
| `graph-pulse` | ripple | the world waits, dimmed; a wave of light leaves one idea and everything it reaches lights in that idea's colour and keeps it; a second, local wave in another colour follows |

Rules: light **one** branch (or send one wave) at a time; a graph needs a headline that says what the structure means; keep labels at
16 px or more at the zoom the viewer sees them; up to ~500 nodes. The graph takes the reel's personality (its
tokens); the **Atlas** style (`data-style="atlas"`) is an editorial specimen look made for graphs.

### Images in a graph: atlases

Tiles show images from one **atlas**, a single JPEG holding up to 500 cells:

```bash
npm run graph -- atlas --tags claude,screenshot      # approved library images with these tags
npm run graph -- atlas --reels 6                     # posters and measured frames of your last six reels
npm run graph -- atlas --assets <id>,<id> shots/*.png
npm run graph -- atlas --refs 4                      # 4 frames from each reference film switched on in the studio
```

It prints the atlas path and a helper to paste into the composition (`node.image = img(i)`); the render copies the
atlas into the clip. With no images, `RC.graphTiles(n, seed)` gives seeded colour fields.

**Reference films are someone else's work.** Their frames may be graph thumbnails only when the reel opted in:
Step 0 asks "Use frames of your reference films as small thumbnails in the graph?" (default **no**), and the answer
goes in `reel.json` as `"referenceThumbnails": true`. The render refuses an atlas with reference frames otherwise,
and writes every image the graphs show, reference frames named with their film and moment, to `graph-sources.md`:
**copy it into report.md**.

## In the studio: plain names, previews, steering a beat

The studio shows every technique by its **plain line** (`src/taxonomy/plain.ts`: "Make the number stand out: big,
counting up"), never its path; paths stay in reel.json and plan.md. Each technique has a **preview clip**: its sample
line composed in the default personality's lead style, colours, type and motion (`npm run techniques -- previews`,
saved in `~/.reelcut/technique-previews/<personality>/`; the Techniques page offers to make them, and the studio
makes them again when the default personality is finished or changed). **Try a line** on the Techniques page draws
the owner's own line by three techniques the same way (`npm run techniques -- sketch "<line>" --only a,b,c`), so
they choose between moves on their words before a reel exists.

From a reel, the owner steers by technique, and the requests reach you as chat messages:

- **"Beat N: <plain line>"** — they picked another technique for that beat from its sheet: recompose it with that
  technique (the message names the path and the pattern to open), record `technique` and `techniqueWhy`, re-render
  only it. Same words, same length, same place.
- **"Beat N: show me 3 other ways"** — compose three alternatives with three different techniques as
  `<beat>-way1..3.html`, render them from a scratch manifest, ask which one with a single AskUserQuestion (each
  option's preview is the clip's path), then swap the chosen one in. The beat panel offers this when three beats in
  a row do the same operation (the reel-shape strip colours beats by operation).
- A star on a technique writes the default personality's `techniques.favour`; `suggest` ranks favourites first.

## From a brief

The studio's Create page has a mode **From a brief**: the owner pastes a brief or a campaign's big idea, and
`npm run techniques -- ideas "<brief>" --json` proposes operations and techniques with examples. Make them concrete
for the brief, offer three to five as one multiSelect AskUserQuestion (label: the technique and what it does here;
description: what the viewer sees; preview: the path), then write the script on the chosen directions and give
every beat its path.

## Tags

- **Patterns**: every built-in pattern is tagged with the techniques it performs (`src/taxonomy/patterns.ts`).
  They are used at once and shown "proposed" until the owner accepts them on the Techniques page
  (`npm run techniques -- accept --all`); the owner's own tags win (`techniques -- tag pattern <id> a,b`).
- **Library images**: `npm run techniques -- tag asset <id> semantic-contrast,odd-one-out --by claude` when you can
  see an asset shows a technique; the Techniques page lists them as examples.
