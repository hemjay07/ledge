# Launching the LEDGE token on Pons

Form fields for ponsfamily.com/launchpad/create. Copy exactly; the copy has been checked against CONSTRAINTS.md.

- **Name:** LEDGE
- **Ticker:** LEDGE
- **Image:** `design/logo/finals/token-1024.png`
- **Pair token:** ETH
- **Creator tax:** 3%
- **Website:** https://ledge.tools
- **Description (≤ 200 characters):**

  Most pons graduations finish inside 5 minutes. Some inside 10 seconds. LEDGE times every graduation from the factory contract, hourly. ledge.tools

  (146 characters.)

  The previous description read "The Pons Number. The share of Pons launches that
  graduate, counted from every launch on the factory contract, hourly, with the
  ones that graduated inside 5 minutes stripped out." It described the
  instrument instead of saying anything. Four independent assessments on
  2026-09-10 reached the same finding without conferring: a reader learns what
  LEDGE measures and no reason to look.

  The replacement leads with the measurement itself, which is the one thing no
  competitor holds. Measured 2026-09-10 across 2,382 graduations that have a
  launch on record: 61.3% finished inside 5 minutes, 37.2% inside 60 seconds,
  26.2% inside 30 seconds, 15.0% inside 10 seconds, median 156 seconds.

  Deliberately imprecise where precision would rot. "Most" and "some" survive
  the figures drifting; "61.3%" baked into a description that may be immutable
  would eventually be false, and a stale figure in the one line every buyer
  reads is the defect CONSTRAINTS 7 exists to prevent. The exact figures, with
  their n, live on the site where they are recomputed hourly.

  It states durations and stops. It does not say self-filled, rigged, fake or
  organic. CONSTRAINTS 6 binds here: the 5-minute mark is a descriptive
  threshold, never a definition of "rigged". A reader who sees "10 seconds"
  needs no help drawing the conclusion, and a description that draws it for
  them would be the verdict CONSTRAINTS 1 bans.

## What the token is

Patronage for a public instrument. The tool is free and complete without it.
Holders get nothing financial: no yield, no revenue share, no lock-up, no
promise.

That is the honest position and it is also, on the evidence of 2026-09-10, the
weakest part of this launch. Four assessors independently called it the
critical defect: a reader is given no reason to hold. The reference case, CHIT,
earned roughly 5 ETH with an unshipped testnet prototype and a token its own
documentation never mentions. What it had was a sentence a reader repeats and a
founder present in a room.

The one thing that can honestly be attached is speed, not access: the room hears
each graduation and its duration as it lands, because the bot posts it. That is
a fact arriving early, not a signal and not advice, so it survives CONSTRAINTS 1.
CONSTRAINTS 8 is not in the way either: it forbids gating the SITE behind a
wallet or an account, and every figure stays free and unkeyed at ledge.tools. A
Telegram room is not the site.

Not built yet. Until it is, the token is patronage, and saying otherwise in the
description would be the promise this file exists to avoid.

## First post (X or Telegram), with the card link

ledge.tools/number

One line above it, from the data at the time of posting, with its n. Example from 6 Sep 2026: "Of 35,085 Pons launches, 766 graduated. Excluding the ones that graduated inside 5 minutes: 1 in 138. Every number with its denominator."

## Sequence

1. Site live at ledge.tools with the stale banner off (DEPLOY.md §2).
2. Worker live (DEPLOY.md §3) so the lookup answers.
3. Launch the token from the account that will hold it.
4. Post the card link.
5. Set the website field on the Pons listing to ledge.tools if the form did not.
