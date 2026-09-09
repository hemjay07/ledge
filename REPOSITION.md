# Repositioning: from auditor to the ecosystem's stats layer

Decided 2026-09-09. This supersedes the product framing in `SPEC.md`; the method,
the data and the gates carry over unchanged.

## Why

The goal has always been creator fees from a token launched on pons. Three things
we verified this week make the auditor framing the wrong vehicle for it.

**The landlord problem.** The token launches on pons's own launchpad, so revenue
sits inside the building of the party the site was attacking. Leading with "64.6%
of your graduations are deployers filling their own curves" and then selling a
token in their venue invites a delisting that needs no legal theory. You cannot be
the adversary and the tenant at once.

**The audit site is the worst possible pre-sell for the token.** A homepage arguing
that 93.5% of launches take no buys recruits readers who now believe launches go
to zero. The site's own message worked against its own revenue.

**The opening is concrete.** `ponsfamily.com/analytics` currently renders "$0"
trading volume and "0" token launches with the note "Dune history is unavailable."
A platform with a $551.6M-FDV token and ~$35M of daily volume is shipping a dead
statistics tab. We hold 52,000 launches and 1,076 graduations, indexed hourly and
reproducible. That is not a nice-to-have pitch; it is a replacement for something
visibly broken.

And their own documentation already carries our thesis: *"Graduation only confirms
the threshold was reached. It is not a quality signal and does not guarantee future
liquidity, price, or an exit."* The self-fill finding is the empirical proof of a
caveat pons wrote themselves. It belongs in the method, as the reason the organic
rate is 0.71% rather than 2.00% — not in the masthead as an accusation.

**What is not the reason.** Not IP risk. The evidence there runs the other way:
`pumpportal.fun` monetises pump.fun's own name and TLD and has operated for years
behind nothing but a non-affiliation disclaimer; Etherscan is a nine-figure business
named off Ethereum; Unibot launched a token off Uniswap's name unchallenged. No UDRP
or suit against a genuine third-party crypto analytics site was found. A pons-derived
domain was never legally reckless — it is simply incoherent with asking pons to link
us, since their guidance says not to imply official status. So: no rename, and no
pons-derived domain.

## What the product becomes

Two registers under one roof. The instrument pages keep the broadsheet treatment
that makes the numbers credible; the discovery pages are dense, live and useful.

| Route | What it is | Register |
|---|---|---|
| `/` | Discovery: what is climbing now, what just graduated, the headline counts | discovery |
| `/live` | Every curve with activity, its fill against its own threshold, buys, distinct buyers | discovery |
| `/graduated` | All 1,076, sortable by volume, age, time-to-graduation | discovery |
| `/creators` | Earnings leaderboard and a fee calculator | discovery |
| `/t/{address}` | One launch: its facts, its cohort, its place on the clock | discovery |
| `/number` | The Pons Number and the share card | instrument |
| `/method` | Definitions, the self-fill finding, the recompute command | instrument |
| `/cohorts` | The cohort registers | instrument |

The Pons Number stays the flagship metric and keeps its own page and card. It stops
being the whole homepage.

## Constraints: what changes, and what does not

`CONSTRAINTS.md` is amended, not abandoned. Every relaxation below is a constraint
that was never about honesty; every retention has a commercial reason, not a moral one.

### Relaxed

1. **#1 splits.** Never *score*, never *predict*, never *recommend* an individual
   token — unchanged. But **ranking by a measured quantity, with the quantity shown,
   is permitted.** A ranking is an ordering of facts, not a claim about a future. This
   is what unlocks per-token pages and leaderboards, and those are the acquisition
   surface: one page per token, each a shareable artifact.
2. **#8 relaxes on email only.** No wallet connection is still required to see
   anything. An optional email field for the weekly dispatch is permitted — there is
   no integrity content in refusing to let a reader subscribe.
3. **The NOT-THIS copy list narrows.** Still banned: any claim that cannot be
   supported — "guaranteed", "safe", "risk-free", "will", and any per-token verdict
   vocabulary. No longer banned: energy. Forceful writing about true numbers is not
   dishonesty. Emoji stay out, as a matter of visual identity rather than principle.
4. **The design posture becomes two postures.** Instrument pages stay austere.
   Discovery pages may be dense, may update live, and may spend colour on a progress
   rule. The stale state keeps its own colour and remains unambiguous.

### Kept, with the reason

- **#3, every rate carries its denominator.** This is what lets a figure survive
  contact with a $551M company's communications team. Cheap; keep.
- **#4, no fake precision; n < 30 renders "not enough data".** Same reason.
- **#5, never hide an unflattering number.** It stays in the data and on `/method`.
  Moving it out of the masthead is a choice about which true thing leads, which is
  free; deleting it would forfeit the only citable thing we own.
- **#2, no wallet or deployer printed as a subject.** Kept for legal exposure, not
  for delicacy: naming individuals on a US LLC's platform invites a takedown we
  cannot fight.
- **#10, never imply partnership.** Their documentation forbids it explicitly. This
  is the one line that would actually end the relationship.
- **The reproducibility gate.** The only moat. Anyone can stand up a statistics site
  with invented figures in an afternoon, and many have; nobody can fake an index that
  regenerates from public chain data.

### New

11. **Reference pons in lowercase and link back to the app**, per their documentation.
    Carry a non-affiliation disclaimer in the footer and on `/method`.
12. **External figures are labelled external.** A number sourced from a third-party
    API rather than from the chain (DEX volume, for instance) is exempt from the
    recompute gate and must say on the page where it came from. An unlabelled
    external figure is the same defect as a missing denominator.

## What has to be built, and what it costs

Measured today, because the feasibility of the live board depended on it:

- **~564 curve events per minute** (~34,000/hour, ~812,000/day) across `CurveBuy`
  and `CurveSell`, filtered by topic0 only — curves are deployed per launch, so
  there is no address to filter on.
- **Only ~121 distinct curves see any activity in a five-minute window.** The live
  board is roughly 121 rows, not 19,000. This is the number that makes the whole
  thing tractable, and it corroborates the 93.5% no-buy finding from an independent
  direction.
- Capturing it costs **~2 extra `eth_getLogs` calls per tick** — nothing against the
  subrequest budget.
- **Store aggregates, never raw events.** Per token: buy count, sell count, distinct
  buyers, distinct first-block buyers, quote in, quote out, last activity. ~121 rows
  updated per window keeps D1 far inside its limits; 812,000 raw rows a day would not.

## Build order

**A. Foundation.** Amend `CONSTRAINTS.md` per the above. Add the non-affiliation
disclaimer and lowercase pons throughout. Index curve events into per-token
aggregates in the Worker. Register a neutral fallback domain. Gate: the existing
suites stay green; the new aggregate has its own tests and a reconciliation against
the launch record.

**B. The discovery product.** `/live` with fill against each launch's own threshold
(never assume 4.2 ETH — it is per pair token). Expand `/t/{address}` from a
post-mortem into a fact page. Reposition `/` around discovery. Gate: no page renders
a rate without its n; no page renders a score.

**C. The leaderboards.** `/graduated` sortable, `/creators` with earnings and a
calculator. Decide whether DEX volume comes from DexScreener — labelled external per
#12 — or is skipped until we index the pools ourselves.

**D. Outreach.** Rewrite `OUTREACH.md` to lead with the broken analytics tab rather
than the exposé, in that order: pons first, then the chain's data accounts, then the
journalists. Add the email field.

## Risks

**pons fixes their own analytics tab.** Our wedge closes. Mitigation: be first and be
better, and lead with the two things they are least likely to build — per-token fact
pages and the creator earnings leaderboard.

**The friendly framing forfeits the story.** The self-fill finding stays published on
`/method` and remains ours to lead with later, from a position that no longer depends
on their venue.

**The token still launches in their building.** Unchanged by anything here. It is the
reason the framing is friendly rather than adversarial, and it is worth saying plainly
that it is a structural dependency rather than a solved problem.
