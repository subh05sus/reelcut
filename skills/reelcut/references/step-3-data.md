# Step 3 — Data and charts

Only runs when the script states a figure. If it does not, skip this step entirely — a chart nobody
asked for is filler.

## Why this step is the most dangerous one

A number on screen in a client's video is a factual claim they answer for. It is also the failure
that hides best: a fabricated statistic fills its slot, passes every layout gate, renders cleanly
and looks authoritative. Nothing downstream can catch it.

So the decision is human. The checking is not.

## A datum

```ts
{
  subject: "share of developers using AI daily",
  value: 62,
  unit: "%",
  period: "2025",
  sourceUrl: "https://survey.stackoverflow.co/2025/",
  quote: "62% of developers report using AI tools daily",   // verbatim, from that page
  quoteVerifiedAt: "2026-09-28T09:41:00Z",                  // set by the re-check, not by hand
  approvedBy: "user",                                        // set by the review, not by hand
}
```

`quote` is **verbatim**. Not a paraphrase, not a reconstruction, not the number pulled out of a
sentence you remember reading. If you cannot copy an exact string from the page that contains the
figure, you do not have a source.

## The procedure

1. **Search** for the figure the script states. Prefer the primary source — the survey, the filing,
   the company's own page — over an article reporting it.
2. **Read the page** and copy the exact sentence containing the number.
3. **Re-fetch and confirm** the quote still appears on the page. Record the timestamp.
4. **Present it for review**, all of it at once:

```
CLAIM     62% of developers use AI daily (2025)
SOURCE    https://survey.stackoverflow.co/2025/
QUOTE     "62% of developers report using AI tools daily"
CHECK     quote found on the live page, 2026-09-28 09:41
SCRIPT    "Die meisten Entwickler nutzen heute täglich KI."
          ^ does the source actually support what the script says?
```

That last line is the one that matters. The quote can be verbatim and current and still not support
the script's claim — "most developers" and "62%" are not the same statement, and "developers who
responded to this survey" is not "developers".

5. **Approve or reject.** Approval is recorded on the datum.

## What renders

A chart reads its figures from an **approved** datum. Composition refuses one with no approval
record — so a skipped review blocks the chart rather than shipping it. That is the whole design:
approval fatigue can only ever cost you a chart.

Axis labels, tick values and any number in the copy are read from the datum. Never retyped: a
transposed digit between the source and the SVG is invisible to every check here.

**The chart prints its source on the frame.** A small line under the axis with the source and the
year. It costs almost nothing, it is what a serious chart does anyway, and it means a wrong number
is exposed to the viewer's own scrutiny rather than hidden behind confident typography.

## Drawing the chart

It is a composition like any other, so step 4's laws apply — commit to the ground, type carries it,
the reading floor governs how long the figure holds.

Specific to charts:

- One series unless the script compares two. A chart with more lines than the sentence has clauses
  is decoration.
- Label the value directly on the mark. A legend is an extra lookup the viewer does not have time
  for at this speed.
- Animate the mark from its own baseline — a bar grows from its axis, a line draws left to right.
  Never animate the axis or the labels; they are the frame of reference.
- The figure holds for its reading floor after the animation resolves, not during it.
- No gridlines unless the comparison needs them.

## If you cannot source it

Say so, and treat it as a gap with the same options as a missing asset: find a different figure the
source actually supports, ask the user for their own data, or **recompose the beat without the
number**. A beat can make its point qualitatively. What it cannot do is state a figure nobody can
stand behind.
