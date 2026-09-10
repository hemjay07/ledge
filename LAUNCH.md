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

The operator who will launch this said, on 2026-09-10, that it matters more than
anything else: *"its very important to give the token utility a reason to buy the
token if the token is detached from the project the token will be useless."* Four
independent assessments the same day reached the identical conclusion without
conferring. So this section is the answer to that, and it starts with the part
nobody wants to say.

### The thing that has to be said first

**There is no honest utility for a free public statistics site's token that does
not either gate the statistics or promise a return.** Gating is out: CONSTRAINTS 8
says never require a wallet or an account to see anything, and `/number.json`
stays public and unkeyed, because an instrument that checks your wallet before it
answers is not a public instrument. Promising a return is out too, and for a
harder reason than taste: revenue share, yield and buybacks are the shape of a
security, and a solo developer in Nigeria promising them to strangers on a US
company's launchpad is not a risk worth taking for any amount of volume.

Everything below is written against that wall rather than pretending it is not
there. Anyone who tells you a tool token has utility without a gate or a promise
is describing one of the two and hoping you do not look.

### 1. The token is the subject, not a fee on the subject

LEDGE has measured 108,000 launches. Then it launches one.

Every reading this site takes of another launch, it takes of itself, in public,
from the same indexer, with no special treatment: its own curve fill against its
own threshold, its own buys and sells, its own distinct buyers in its own launch
block, its own time to graduation, and its own creator fees as they accrue. The
machinery already exists — `/t/{address}` renders exactly this for any token, and
LEDGE's own address is just another argument to it.

That is the reason to hold that survives contact with the wall above. It is not
access and it is not a promise. It is that this is the only token on the venue
whose complete launch telemetry is published, as it happens, by the instrument
that measures the venue — including the parts that look bad. If LEDGE graduates in
eight seconds with two distinct buyers, the site says so on its own front page,
under the same definitions it applies to everyone else.

That claim is worth something precisely because it can go wrong in public, and
nobody else can make it.

### 2. The room hears it as it lands

The bot posts each reading to the holders' room as the tick produces it: a
graduation and how long it took, a launch entering the graveyard, a curve taking
its first buys from many distinct wallets in its own block.

Be precise about what this is worth, because overselling it is how this becomes a
signal service. Every one of those facts is on the site, free, unkeyed, seconds
later. The edge is attention, not information: someone watching the site sees the
same thing. What the room gets is that it arrives without being watched for.

CONSTRAINTS 8 is untouched — it constrains the site, and a Telegram room is not
the site. CONSTRAINTS 1 is the one to keep watching: a fact broadcast quickly is
still a fact, and it stays on the right side of the line only for as long as the
message says what happened and never what it means or what to do. "Graduated in
8 s, 2 distinct buyers in its launch block" is a reading. "Worth a look" is a
signal, and the day the bot says it, this project is a different and worse thing.

### 3. Holders decide what gets measured next

The smallest of the three and the most real. What the index covers next — another
venue, another chain, a cohort nobody has cut — is put to the room. It is
governance over the roadmap, not over the numbers: no vote can change a
definition, move a threshold, or unpublish a finding, because those are settled
by CONSTRAINTS 9 and the recompute gate, and a token that could vote a bad number
away would make every good number worthless.

### What holders still do not get

No yield. No revenue share. No buyback. No airdrop. No early or exclusive access
to any figure. No say over any published number. The tool is free and complete
without the token, and it stays that way.

### Status

Section 1 needs LEDGE's own address, which does not exist until launch. Section 2
needs `TELEGRAM_BOT_TOKEN` and a room. Section 3 needs a room. None of the three
may be claimed in the token description or anywhere else until it is actually
running: an unbuilt promise in the one line every buyer reads is exactly the
defect this file exists to prevent.

## First post (X or Telegram), with the card link

ledge.tools/number

One line above it, from the data at the time of posting, with its n. Example from 6 Sep 2026: "Of 35,085 Pons launches, 766 graduated. Excluding the ones that graduated inside 5 minutes: 1 in 138. Every number with its denominator."

## Sequence

1. Site live at ledge.tools with the stale banner off (DEPLOY.md §2).
2. Worker live (DEPLOY.md §3) so the lookup answers.
3. Launch the token from the account that will hold it.
4. Post the card link.
5. Set the website field on the Pons listing to ledge.tools if the form did not.
