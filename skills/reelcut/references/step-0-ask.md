# Step 0 — Ask before cutting

Every `/reelcut` run starts with one short round of choices. Everything after this — the briefs,
the compositions, the render — is built on the answers, and a question asked now costs a click,
while the same question discovered after rendering costs the whole run.

## When

After `npm run beats` has segmented the script, and **before** writing a single brief. Asking before
the script has been read produces generic questions; asking after the briefs exist means the
answers arrive too late to shape them. Reading the beats first is what lets the options be about
*this* script — its length, its voice, the products it names, its densest line.

Skip the questions entirely when nobody is there to answer — an unattended run, a scheduled job,
or the user said "just do it" / "use the defaults". Then take the defaults below and record in
`plan.md` that they were defaults, not choices.

## What to ask

**Only what was not already said.** A flag, or freeform direction in the invocation ("make it feel
like late-90s broadcast"), is an answer. Never ask about something the user specified, and never
re-ask in a different form.

Use the AskUserQuestion tool, at most **two rounds of up to four questions**. Put the option you
would pick first, marked `(Recommended)`, and make every option's description say what it does to
*this* reel, not what the flag means in general.

### Round 1 — the edit

| Question | Ask when | Options — tailored to the script |
|---|---|---|
| **Text on screen** | no `--text` | `full` · `key-lines` · `minimal` · `none`. Recommend by voiceover: an `.srt` → `key-lines`, a `.txt` → `full`. Name the count: "key-lines puts about 5 of the 14 lines on screen". |
| **Length** | no `--short`, and the full script runs over ~30s | The whole script (say its length) · a 15–25s short cut (say which beats it keeps). |
| **Look and palette** | no `--palette` and no `--look` | 2–3 of the kit's looks (`paper`, `ink`, `flood`, `sky`, `cinema`, `poster` — see [design-system.md](design-system.md#grounds--commit-to-one-per-reel)), each with the accent it would use and a one-line register tied to this script. If the script names a product or brand, the first option uses *its* colour as the accent. Use `preview` to show ground, ink and accent side by side. "Other" lets the user type their own. |
| **Motion** | no `--motion` | `restrained` · `default` · `energetic`, each described against this script ("energetic suits the list in beats 4–7"). |

### Round 2 — production

| Question | Ask when | Options |
|---|---|---|
| **Format** | no `--format` | `1:1` · `9:16` · `16:9` · `4:5`, described by where it will be posted. |
| **Visual register** | no `--visuals`, and the script names a real product or states figures | "Real product screens" · "Data-forward" · "Typographic" — only the ones this script could actually support. |
| **Sound effects** | always, unless `--sfx` was given | With effects · Silent (default). |
| **Studio** | always | See below. |

If round 1 already covered everything that matters and nothing in round 2 is open except the
studio, ask the studio question on its own — do not pad a round.

### The studio question

Always the last question of the last round:

> Open the reelcut studio (http://localhost:5198) to watch the reel?

- **When the reel is done (Recommended)** — start it after render and open straight onto this reel.
- **Now** — start it immediately, to browse the library while the reel is made; it opens onto the
  reel when rendering finishes.
- **No** — don't start it. `npm run studio` any time later.

How to act on each is in [step-5-render.md](step-5-render.md#offer-the-studio). The answer given
here stands: step 5 does not ask again.

## Clarifications the script itself raises

Separate from the choices above, and only when the answer changes the output. Fold them into the
same rounds when there is room; never add a third round for them.

- **A beat reads `TIGHT`** — its line cannot be read in the time it has. Ask: cut the copy, split
  the beat, or drop the line to `key-lines`. Never speed it up.
- **Direction and script disagree** — a script full of quotable lines under `--text none`, say.
  Name the two ways out, as [direction.md](direction.md#when-direction-and-script-disagree) says.
- **The script names a product whose assets are not in the library** — ask whether the user has
  them (a folder, a login to capture from) before step 2 goes looking.

Do not ask about anything the rules already decide: the reading floor, hard cuts, determinism,
whether a logo may be drawn. Those are not choices.

## Record the answers

Carry them exactly as flags would have been carried: the answers become the direction, and
`describeDirection` writes them at the top of `plan.md` with a note of which were chosen and which
were defaults. Then continue to Step 1's questions for yourself — those are the director's, not the
user's.
