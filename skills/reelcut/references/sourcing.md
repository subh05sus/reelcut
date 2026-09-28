# Sourcing — licence, provenance, and what must never ship

Everything acquired in step 2 or step 3 ends up in a video that gets posted. This file is the set
of rules that applies to all of it.

## Nothing secret leaves a capture

You are photographing real product screens. They hold real customer names, email addresses, order
and invoice numbers, internal hostnames, API keys in a settings pane, a colleague's avatar and
name in a sidebar.

Before a capture is used:

1. **Scan it.** Look at the captured DOM text, not just the pixels — names in a user menu, an
   account email in a header, anything matching an address, phone number, IBAN, card number, or a
   hostname that is not public.
2. **Mask or reject.** Substitute plausible fictional stand-ins, or crop the region out, or recapture
   from a demo account.
3. **Say so.** `report.md` records what was masked in which capture.

If you cannot tell whether something is real, treat it as real.

The same applies to the script itself: if the source material contains a customer's name or a real
internal URL, it does not go on screen.

## Marks and logos

A brand mark is `identity`. It comes from the brand's own press or brand page, or from the user,
and nowhere else.

- Record the **source URL** and the **licence terms** with the asset.
- Nominative use — showing a company's mark to refer to that company — is generally fine. Restyling
  a mark, recolouring it, cropping it, or implying endorsement is not.
- A mark from an image search, a logo aggregator or a blog is a **proposal**. Show where it came
  from and wait. Fan-made and superseded logos are common and both pass every downstream gate,
  because the slot is filled and the bounds are legal.
- Never draw one. `resolutionsFor` will not offer it.

## Photographs and stock imagery

Assume not licensed unless you can point at the licence.

- The client's own imagery: fine.
- A capture of a public web page, used to show that page: fine, subject to the secrets rule above.
- A photograph found by search, in a commercial video: **not** fine without a licence you can name.

If a beat wants an image and none is licensed, that is a gap. Report it with its options — the
honest answer is usually to recompose the beat as type.

## Figures and claims

See [step-3-data.md](step-3-data.md). In short: a number needs a source URL and a verbatim quote,
the quote is re-checked against the live page, and a human approves it before it can render.

## Fonts

A webfont fetched at render time breaks the determinism contract. HyperFrames localises Google
Fonts automatically and caches them — let it. Anything else must be licensed for embedding and
shipped with the project.

## The report

`out/report.md` carries one line per acquired thing:

```
asset   Claude Logo          anthropic.com/brand           licence: brand guidelines, nominative use
asset   ChatGPT chat screen  captured chat.openai.com      masked: account email in header
data    38% adoption 2025    example.org/study-2025        quote verified 2026-09-28
```

An asset with no provenance line does not ship. That is the check at the end of step 5.
