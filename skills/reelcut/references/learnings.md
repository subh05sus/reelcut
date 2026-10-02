# Learnings — what the studio remembers about your taste

The studio does not train a model. What makes the tenth reel better than the first is that Claude
starts it already knowing what you kept, what you sent back and what you said — as short rules you
can read, edit, switch off and take with you.

## What is recorded

Typed facts, called **signals**, never free text turned into instructions:

| signal | comes from |
|---|---|
| `used` | the render: each beat's look (`data-look`), accent (`--accent`), pattern (`pattern` in `reel.json`) and the reel's motion |
| `choice` | the Step 0 answers in `reel.json` → `direction`, the format, and whether sound effects were on |
| `thumb` | "Works" or "Not quite" on a beat in the studio's Reels tab, with an optional note |
| `rerender` | a beat sent back for another render from the studio: a weak "not quite" |
| `asset` | what you did with machine-written tags: kept (by approving) or removed |
| `reference` | facts from the reference films you kept: how they cut, their ground, and — once you accept them — the moves and text style Claude tagged. Rebuilt whenever a reference changes. See [reference-videos.md](reference-videos.md) |

A note you write is stored against the beat for you to read. It never becomes a rule by itself.

## From signals to rules

A rule is one sentence, a scope (everywhere, or one brand) and a state. They are **proposed** when the
evidence is plain: a look used in three different reels with no thumbs-down; two thumbs-up that
outnumber the thumbs-down two to one; two thumbs-down and no thumbs-up becomes an *avoid*. A use
nobody rated counts half a thumbs-up; a re-render counts a quarter of a thumbs-down and can never
create a rule alone. Confidence is a Wilson lower bound, so three agreeing uses read as a hunch and
ten as a habit, and it halves for every 90 days since the newest evidence. A rule nobody has reason to
believe any more is marked `expired`.

The text of an inferred rule is a template over typed values ("Prefer the "cool" look."), and a value
that is not one of a short list of things it may be is dropped. A sentence found in a script, a page
or a file cannot become a rule.

**Proposed rules do nothing.** Only rules that are **on** reach Claude: switched on by you
(Accept in the studio, or `npm run learnings -- accept <id>`), or written by you. Editing a rule's
sentence makes it yours; a pinned rule never expires. A preference and an avoid on the same subject in
the same scope are marked as a conflict and neither is applied until you resolve it.

## What Claude does with them

```bash
npm run learnings -- brief --script script.txt     # the rules that are on, grouped, with ids
```

Read at the start of Step 0 and again in Step 4. A brand's rules are included when the script names
the brand (or `--brand` does). Claude uses them to order the Step 0 options, to choose between
equally good compositions, and to avoid what you have turned away from. It writes the ids it applied
into `reel.json` as `appliedLearnings` and under **Applied learnings** in `plan.md`; the studio shows
them on the reel, so a rule that keeps getting thumbs-down is visible as the cause.

**Precedence:** the invocation's flags and direction, then this run's Step 0 answers, then learned
rules, then the design system's defaults. Learned rules never relax the reading floor, determinism,
hard cuts, the identity-asset rules, or anything in the Hard rules.

## Machine-written tags

Auto-tags on dropped assets teach the indexer your vocabulary: a tag you remove twice and never keep
is not suggested again (`tagStats` in the same file).

## Where it lives

`~/.reelcut/learnings.json`, next to the library, private to you. **Export** and **Import** in the
studio (or `npm run learnings -- export|import`) move rules and tag statistics between machines; the
raw signals, with their reel ids and notes, are never exported. An imported file is not trusted:
every rule is validated, its text cleaned, and inferred rules arrive as proposals.
