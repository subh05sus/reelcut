# Reference videos — learning motion taste from films you admire

Drop motion-graphics films you like onto the studio's **References** tab (or `npm run references -- add
film.mp4`). reelcut measures how they cut and what they look like, Claude suggests what moves are in them,
and when several of them agree the studio **proposes a rule** that you can switch on. Over time the reels
start from your taste instead of from the defaults.

This is the same engine as [learnings.md](learnings.md): references are one more place signals come from.

## What a reference is, and is not

A reference is **someone else's film**. So:

- it lives in `~/.reelcut/references/`, with its **own index, apart from the asset library**. Nothing that
  matches assets, finds footage, places a recording or renders a reel reads that index, so a reference cannot
  end up in a reel however it is described;
- it stays on this computer: the learnings export carries rules, never references;
- what the studio keeps from it is **numbers and a few fixed words**, never the pictures and never a sentence.

## What is measured (no one has to watch it)

| measured | how | becomes |
|---|---|---|
| **Cuts** | ffmpeg's scene score; two cuts closer than 0.25 s are one | shots, **median shot length**, cuts a minute |
| **Pacing** | median shot ≤ 1.6 s `fast` · ≤ 3.5 s `medium` · else `slow` | a pacing token |
| **Ground** | mean brightness and saturation | `light` · `dark` · `brand` (a saturated colour) · `mixed` |
| **Colours** | the main colours across eight frames | shown on the card |
| **Movement** | mean change between frames a quarter-second apart | shown on the card |
| **Type share** | how much of the frame is ink against the ground | shown on the card |

Only the first three minutes of a long film are measured, and the card says so. A cut has to change the
picture a lot (a score over 0.3): a shade of cream to another shade of cream is one long shot.

## What Claude sees (`/reelcut study-references`)

Measurement cannot tell a product demo from a kinetic-type film. So each reference also gets a **contact
sheet** — 24 frames across it — and Claude tags what it sees, in the fixed words only:

```bash
npm run references -- queue --json          # id, name, sheet (an image), pacing, ground
npm run references -- annotate <id> --moves ui,cur,num --text key-lines --note "product demo, then a counter"
```

- **moves** are the tags `whatships-tally.tsv` uses (see [design-system.md](design-system.md)): `wb` text builds
  word by word · `big` huge type · `kin` kinetic type · `ser` italic serif accent · `hl` highlighter ·
  `strike` · `roll`/`wheel` values rolling · `ui` real product UI · `cur` cursor · `chat` · `code` · `dev`
  device frame · `tilt` · `fly` · `num` big number · `mesh` gradient ground · `hud` · `obj` · `ill` · `icon` ·
  `bub` · `logo` · `foot` footage · `sr` screen recording · `cap` captions. A word outside the list is refused.
- **text** is how type is set: `kinetic`, `key-lines`, `minimal`, `none`.
- **note** is for the person. It is stored and shown and **never becomes a rule**.

Claude's tags are **suggestions**. They teach the studio nothing until a person accepts them (the References
tab's *Accept these tags*), and Claude cannot change tags a person has reviewed. It never includes, excludes,
accepts or deletes a reference.

## From references to a rule

Every included reference contributes facts: its pacing and ground at once, and — once a person has accepted
them — its moves and text style. A **prefer** rule is *proposed* when:

- at least **three** distinct references show the fact, **and**
- they are the majority of the references that say anything about that kind of fact (more than half for a
  pacing, a ground or a text style; half for a move, which a film has several of). A reference nobody has
  tagged does not dilute a move three tagged ones share.

The sentence is a template over the fixed value ("Your references mostly cut fast (median shot under
1.6s)."), the confidence is the usual Wilson bound with a 90-day decay, and the status is **proposed**.
It appears in the **Learnings** tab and does nothing until a person switches it on. Switching a reference
off, or deleting it, rebuilds all reference evidence, so what it taught goes with it.

## What Claude does with it

```bash
npm run references -- brief          # the aggregate: median shot, ground split, accepted moves
npm run learnings -- brief           # the rules that are on, including the ones learned from references
```

Read both at Step 0 and Step 1. The first *describes* the references so a recommendation can be explained
("your references cut at about 1.9 s a shot"); only the second — active rules — steers the reel. A learned
pacing **never overrides the reading floor** ([SKILL.md](../SKILL.md#the-reading-floor)): a line still stays
on screen as long as it takes to read.

## Where it breaks, and what stops it

1. **A reference's content or a sentence in it becoming an instruction.** Separate store; never placed or
   exported; rules only from numbers and the fixed words; notes never feed a rule; at least three agreeing
   references and a person's approval before a rule acts; every reference can be switched off or deleted.
2. **One odd batch setting a taste.** Three agreeing *and* a majority; low counts read as low confidence;
   proposals only; conflicts between a preference and an avoid are held for a person.
3. **A label that is wrong.** Claude's tags count for nothing until a person accepts them.
