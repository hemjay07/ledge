# LEDGE — constraints

Every agent that designs, writes, reviews, or tests LEDGE reads this file first. A build that violates any line here fails review regardless of anything else.

## The never-list

1. **Never score, rank, predict, or recommend an individual token.** No per-token verdicts, badges, colours, "safety" labels, or probabilities. Aggregate cohorts only.
2. **Never print a wallet or deployer address as a subject.** Deployer statistics are aggregate distributions. The only addresses on the site are the Pons factory and LEDGE's own contracts, shown as provenance.
3. **Never show a number without its denominator.** Every rate carries `n`; every cohort carries its sample size; every figure carries the time window it was computed over.
4. **Never fake precision.** No confidence intervals, no decimals beyond what n supports, no extrapolations ("~220 of 19,000 today") presented as counts. Cohorts with n < 30 render as "not enough data (n=…)" — never as a percentage.
5. **Never hide an ugly number.** If the rate falls, the rate falls. If a finding reverses when more data arrives, we publish the reversal and keep the old value in the changelog.
6. **Never present the 5-minute cutoff as a definition of "rigged".** It is a descriptive threshold. Copy says "graduated inside 5 minutes" and "excluding launches that graduated inside 5 minutes" — never "organic" as a bare label without that definition within reach.
7. **Never let a stale number look fresh.** Every figure shows "updated N min ago". If the latest successful crawl is older than 2 hours, the page shows a stale banner at the top and the OG card renders the age prominently.
8. **Never require a wallet, an email, or an account to see anything.** No connect-wallet, no capture, no gating. `/number.json` is public and uncached-hostile (proper `Cache-Control`, no key).
9. **Never move a threshold or band quietly.** Any change to a definition (window, cutoff, bucket edges) is a dated entry on `/method` and in the repo changelog.
10. **Never negotiate position relative to Pons.** LEDGE measures the chain. No "official", no "partner", no "in collaboration with", no attacks either. Neutral instrument.

## The NOT-THIS copy list

None of the following appear anywhere on the site, the card, the README, or the token description:

- "Trade smarter", "know before you ape", "data-driven insights", "alpha", "edge", "signals"
- "We believe", "our mission", "in today's fast-moving…"
- Rocket, fire, chart-up, eyes, or any emoji in UI copy
- Risk warnings, "DYOR", "not financial advice" as boilerplate (the method page states what the numbers are and aren't — once, plainly)
- "Pro", "premium", "coming soon", "join the waitlist", "subscribe"
- "Connect wallet"
- Gradients, glows, purple/violet, hero illustrations, mascots
- Any sentence telling the reader what to do with a number

## Design posture

An instrument, not a dashboard. One number is the page. The distribution and cohorts are evidence beneath it. Type does the work; colour is reserved for the stale state and nothing else.

## Statistical posture

- Counts and rates only. No modelling in Phase 1.
- Every number on the site must be reproducible from the public data files with a one-line script documented on `/method`.
- The independent recompute in CI must match the rendered numbers exactly, or the deploy fails.
